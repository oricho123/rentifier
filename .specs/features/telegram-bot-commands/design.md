# Telegram Bot Commands — Design

## Architecture

The Telegram bot functionality extends the notify worker by adding a webhook endpoint and command processing layer. The notify worker currently runs on a cron schedule; we'll add an HTTP fetch handler to process incoming Telegram updates.

```
Telegram Bot API
       │
       │ POST /webhook (Telegram Update)
       ▼
┌──────────────────────────────────────┐
│   Notify Worker (apps/notify)       │
│                                       │
│  ┌─────────────────────────────────┐ │
│  │ fetch() handler                 │ │
│  │  - Webhook validation           │ │
│  │  - Update parsing               │ │
│  │  - Command routing              │ │
│  └──────────┬──────────────────────┘ │
│             │                         │
│             ▼                         │
│  ┌─────────────────────────────────┐ │
│  │ Command Handlers                │ │
│  │  - StartCommand                 │ │
│  │  - FilterCommand (multi-step)   │ │
│  │  - ListCommand                  │ │
│  │  - EditCommand (multi-step)     │ │
│  │  - DeleteCommand                │ │
│  │  - PauseCommand                 │ │
│  │  - ResumeCommand                │ │
│  │  - HelpCommand                  │ │
│  └──────────┬──────────────────────┘ │
│             │                         │
│             ▼                         │
│  ┌─────────────────────────────────┐ │
│  │ BotService                      │ │
│  │  - getUserByChatId()            │ │
│  │  - createUser()                 │ │
│  │  - getFilters()                 │ │
│  │  - createFilter()               │ │
│  │  - updateFilter()               │ │
│  │  - deleteFilter()               │ │
│  │  - pauseAllFilters()            │ │
│  │  - resumeAllFilters()           │ │
│  └──────────┬──────────────────────┘ │
│             │                         │
│             ▼                         │
│  ┌─────────────────────────────────┐ │
│  │ ConversationStateManager        │ │
│  │  - getState()                   │ │
│  │  - setState()                   │ │
│  │  - clearState()                 │ │
│  └──────────┬──────────────────────┘ │
│             │                         │
│             ▼                         │
│  ┌─────────────────────────────────┐ │
│  │ TelegramClient (existing)       │ │
│  │  - sendMessage()                │ │
│  │  - sendInlineKeyboard() (new)   │ │
│  └─────────────────────────────────┘ │
│                                       │
└───────────────┬───────────────────────┘
                │
                ▼
         D1 Database
    ┌──────────────────┐
    │ users            │
    │ filters          │
    │ conversation_state│
    └──────────────────┘
```

## Component Design

### 1. Worker Entry Point Update (`apps/notify/src/index.ts`)

Add an HTTP fetch handler alongside the existing scheduled handler:

```typescript
export default {
  // Existing cron handler
  async scheduled(event, env, ctx) { ... },

  // New webhook handler
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    return new Response('Not Found', { status: 404 });
  }
}
```

### 2. Webhook Handler (`apps/notify/src/webhook/handler.ts`)

Validates and routes Telegram updates:

```typescript
export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  try {
    // 1. Validate webhook authenticity (check secret token header)
    const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 403 });
    }

    // 2. Parse Telegram update
    const update = await request.json() as TelegramUpdate;

    // 3. Extract message and user info
    const message = update.message;
    if (!message || !message.text) {
      return new Response('OK', { status: 200 }); // Ignore non-text messages
    }

    // 4. Route to command handler
    const db = createDB(env.DB);
    const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
    const stateManager = new ConversationStateManager(db);
    const botService = new BotService(db);
    const commandRouter = new CommandRouter(telegram, botService, stateManager);

    await commandRouter.route(message);

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
```

### 3. Telegram Types (`apps/notify/src/webhook/types.ts`)

TypeScript interfaces for Telegram Bot API objects:

```typescript
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message: TelegramMessage;
  data: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}
```

### 4. Command Router (`apps/notify/src/commands/router.ts`)

Routes commands to appropriate handlers:

```typescript
export class CommandRouter {
  private handlers: Map<string, CommandHandler>;

  constructor(
    private telegram: TelegramClient,
    private botService: BotService,
    private stateManager: ConversationStateManager
  ) {
    this.handlers = new Map([
      ['/start', new StartCommand(telegram, botService)],
      ['/filter', new FilterCommand(telegram, botService, stateManager)],
      ['/list', new ListCommand(telegram, botService)],
      ['/edit', new EditCommand(telegram, botService, stateManager)],
      ['/delete', new DeleteCommand(telegram, botService)],
      ['/pause', new PauseCommand(telegram, botService)],
      ['/resume', new ResumeCommand(telegram, botService)],
      ['/help', new HelpCommand(telegram)],
    ]);
  }

  async route(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const text = message.text?.trim() || '';

    // Check if user is in a conversation state
    const state = await this.stateManager.getState(chatId);
    if (state) {
      // User is in the middle of a multi-step flow
      const handler = this.handlers.get(state.command);
      if (handler && 'handleStateReply' in handler) {
        await (handler as StatefulCommandHandler).handleStateReply(message, state);
        return;
      }
    }

    // Parse command (e.g., "/filter" or "/delete 3")
    const [command, ...args] = text.split(/\s+/);
    const handler = this.handlers.get(command);

    if (handler) {
      await handler.execute(message, args);
    } else {
      // Unknown command
      await this.telegram.sendMessage(
        chatId,
        "Unknown command. Send /help to see available commands."
      );
    }
  }
}
```

### 5. Command Handler Interface (`apps/notify/src/commands/interface.ts`)

```typescript
export interface CommandHandler {
  execute(message: TelegramMessage, args: string[]): Promise<void>;
}

export interface StatefulCommandHandler extends CommandHandler {
  handleStateReply(message: TelegramMessage, state: ConversationState): Promise<void>;
}

export interface ConversationState {
  chatId: string;
  command: string;
  step: string;
  data: Record<string, any>;
  createdAt: string;
}
```

### 6. StartCommand (`apps/notify/src/commands/start.ts`)

```typescript
export class StartCommand implements CommandHandler {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService
  ) {}

  async execute(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const displayName = [message.from.first_name, message.from.last_name]
      .filter(Boolean)
      .join(' ');

    // Check if user exists
    let user = await this.botService.getUserByChatId(chatId);

    if (!user) {
      // Create new user
      user = await this.botService.createUser(chatId, displayName);

      await this.telegram.sendMessage(
        chatId,
        `Welcome to Rentifier, ${displayName}! 🏠\n\n` +
        `I'll help you find rental apartments in Israel.\n\n` +
        `Available commands:\n` +
        `/filter - Create a new search filter\n` +
        `/list - View your active filters\n` +
        `/pause - Pause notifications\n` +
        `/resume - Resume notifications\n` +
        `/help - Show all commands`
      );
    } else {
      // Existing user
      const filterCount = await this.botService.getFilterCount(user.id);

      await this.telegram.sendMessage(
        chatId,
        `Welcome back, ${displayName}!\n\n` +
        `You have ${filterCount} active filter${filterCount === 1 ? '' : 's'}.\n\n` +
        `Send /help to see available commands.`
      );
    }
  }
}
```

### 7. FilterCommand (Multi-step) (`apps/notify/src/commands/filter.ts`)

```typescript
export class FilterCommand implements StatefulCommandHandler {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService,
    private stateManager: ConversationStateManager
  ) {}

  async execute(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);

    // Initialize conversation state
    await this.stateManager.setState(chatId, {
      command: '/filter',
      step: 'name',
      data: {},
    });

    await this.telegram.sendMessage(
      chatId,
      "Let's create a new filter! First, give it a name (e.g., 'Tel Aviv 2BR'):"
    );
  }

  async handleStateReply(message: TelegramMessage, state: ConversationState): Promise<void> {
    const chatId = String(message.chat.id);
    const text = message.text?.trim() || '';

    switch (state.step) {
      case 'name':
        state.data.name = text;
        state.step = 'cities';
        await this.stateManager.setState(chatId, state);
        await this.sendCitySelection(chatId);
        break;

      case 'cities':
        // Parse city selection (callback data from inline keyboard)
        // For simplicity, accept comma-separated city names
        state.data.cities = text.split(',').map(c => c.trim());
        state.step = 'price_min';
        await this.stateManager.setState(chatId, state);
        await this.telegram.sendMessage(chatId, "Min price (ILS/month) or skip:");
        break;

      case 'price_min':
        state.data.minPrice = text === 'skip' ? null : parseFloat(text);
        state.step = 'price_max';
        await this.stateManager.setState(chatId, state);
        await this.telegram.sendMessage(chatId, "Max price (ILS/month) or skip:");
        break;

      case 'price_max':
        state.data.maxPrice = text === 'skip' ? null : parseFloat(text);
        state.step = 'rooms_min';
        await this.stateManager.setState(chatId, state);
        await this.telegram.sendMessage(chatId, "Min bedrooms or skip:");
        break;

      case 'rooms_min':
        state.data.minBedrooms = text === 'skip' ? null : parseInt(text);
        state.step = 'rooms_max';
        await this.stateManager.setState(chatId, state);
        await this.telegram.sendMessage(chatId, "Max bedrooms or skip:");
        break;

      case 'rooms_max':
        state.data.maxBedrooms = text === 'skip' ? null : parseInt(text);
        state.step = 'keywords';
        await this.stateManager.setState(chatId, state);
        await this.telegram.sendMessage(chatId, "Keywords (comma-separated) or skip:");
        break;

      case 'keywords':
        state.data.keywords = text === 'skip' ? null : text.split(',').map(k => k.trim());

        // Save filter
        const user = await this.botService.getUserByChatId(chatId);
        if (!user) {
          await this.telegram.sendMessage(chatId, "Error: User not found. Please /start first.");
          await this.stateManager.clearState(chatId);
          return;
        }

        await this.botService.createFilter(user.id, {
          name: state.data.name,
          minPrice: state.data.minPrice,
          maxPrice: state.data.maxPrice,
          minBedrooms: state.data.minBedrooms,
          maxBedrooms: state.data.maxBedrooms,
          cities: state.data.cities,
          keywords: state.data.keywords,
        });

        await this.stateManager.clearState(chatId);
        await this.telegram.sendMessage(
          chatId,
          `✅ Filter "${state.data.name}" created!\n\n` +
          this.formatFilterSummary(state.data)
        );
        break;
    }
  }

  private async sendCitySelection(chatId: string): Promise<void> {
    await this.telegram.sendMessage(
      chatId,
      "Select cities (comma-separated):\nTel Aviv, Jerusalem, Haifa, Herzliya, Ramat Gan, etc."
    );
  }

  private formatFilterSummary(data: any): string {
    const parts = [];
    if (data.cities) parts.push(`Cities: ${data.cities.join(', ')}`);
    if (data.minPrice) parts.push(`Min price: ${data.minPrice} ILS`);
    if (data.maxPrice) parts.push(`Max price: ${data.maxPrice} ILS`);
    if (data.minBedrooms) parts.push(`Min rooms: ${data.minBedrooms}`);
    if (data.maxBedrooms) parts.push(`Max rooms: ${data.maxBedrooms}`);
    if (data.keywords) parts.push(`Keywords: ${data.keywords.join(', ')}`);
    return parts.join('\n');
  }
}
```

### 8. BotService (`apps/notify/src/bot-service.ts`)

Database operations for user and filter management:

```typescript
export class BotService {
  constructor(private db: DatabaseService) {}

  async getUserByChatId(chatId: string): Promise<User | null> {
    const result = await this.db.query(
      'SELECT * FROM users WHERE telegram_chat_id = ?',
      [chatId]
    );
    return result[0] || null;
  }

  async createUser(chatId: string, displayName: string): Promise<User> {
    await this.db.execute(
      'INSERT INTO users (telegram_chat_id, display_name) VALUES (?, ?)',
      [chatId, displayName]
    );
    return this.getUserByChatId(chatId)!;
  }

  async getFilterCount(userId: number): Promise<number> {
    const result = await this.db.query(
      'SELECT COUNT(*) as count FROM filters WHERE user_id = ? AND enabled = 1',
      [userId]
    );
    return result[0].count;
  }

  async getFilters(userId: number): Promise<Filter[]> {
    return this.db.query(
      'SELECT * FROM filters WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  async createFilter(userId: number, data: FilterCreateData): Promise<void> {
    await this.db.execute(
      `INSERT INTO filters (
        user_id, name, min_price, max_price, min_bedrooms, max_bedrooms,
        cities_json, keywords_json, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        userId,
        data.name,
        data.minPrice,
        data.maxPrice,
        data.minBedrooms,
        data.maxBedrooms,
        data.cities ? JSON.stringify(data.cities) : null,
        data.keywords ? JSON.stringify(data.keywords) : null,
      ]
    );
  }

  async deleteFilter(userId: number, filterId: number): Promise<boolean> {
    const result = await this.db.execute(
      'DELETE FROM filters WHERE id = ? AND user_id = ?',
      [filterId, userId]
    );
    return result.changes > 0;
  }

  async pauseAllFilters(userId: number): Promise<void> {
    await this.db.execute(
      'UPDATE filters SET enabled = 0 WHERE user_id = ?',
      [userId]
    );
  }

  async resumeAllFilters(userId: number): Promise<void> {
    await this.db.execute(
      'UPDATE filters SET enabled = 1 WHERE user_id = ?',
      [userId]
    );
  }
}
```

### 9. ConversationStateManager (`apps/notify/src/conversation-state.ts`)

Manages multi-step conversation state using D1:

```typescript
export class ConversationStateManager {
  constructor(private db: DatabaseService) {}

  async getState(chatId: string): Promise<ConversationState | null> {
    const result = await this.db.query(
      'SELECT * FROM conversation_state WHERE chat_id = ? AND expires_at > datetime("now")',
      [chatId]
    );

    if (!result[0]) return null;

    return {
      chatId: result[0].chat_id,
      command: result[0].command,
      step: result[0].step,
      data: JSON.parse(result[0].data_json),
      createdAt: result[0].created_at,
    };
  }

  async setState(chatId: string, state: Partial<ConversationState>): Promise<void> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min TTL

    await this.db.execute(
      `INSERT INTO conversation_state (chat_id, command, step, data_json, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         command = excluded.command,
         step = excluded.step,
         data_json = excluded.data_json,
         expires_at = excluded.expires_at`,
      [
        chatId,
        state.command || '',
        state.step || '',
        JSON.stringify(state.data || {}),
        expiresAt,
      ]
    );
  }

  async clearState(chatId: string): Promise<void> {
    await this.db.execute('DELETE FROM conversation_state WHERE chat_id = ?', [chatId]);
  }
}
```

### 10. Database Migration for conversation_state

New migration: `packages/db/migrations/0006_conversation_state.sql`

```sql
CREATE TABLE conversation_state (
  chat_id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  step TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_conversation_state_expires ON conversation_state(expires_at);
```

### 11. TelegramClient Extension

Add inline keyboard support to existing `TelegramClient`:

```typescript
async sendInlineKeyboard(
  chatId: string,
  text: string,
  keyboard: InlineKeyboardMarkup
): Promise<TelegramSendResult> {
  try {
    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: keyboard,
      }),
    });

    // ... (same error handling as sendMessage)
  } catch (error) {
    // ... (same error handling)
  }
}
```

### 12. Webhook Registration Script

Utility script to register webhook with Telegram: `scripts/setup-webhook.ts`

```typescript
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL; // e.g., https://notify.rentifier.workers.dev/webhook
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secretToken,
  }),
});

console.log(await response.json());
```

## File Structure

```
apps/notify/src/
├── index.ts                     # Entry point (add fetch handler)
├── bot-service.ts               # User/filter CRUD operations
├── conversation-state.ts        # State management
├── telegram-client.ts           # Extended with inline keyboard
├── webhook/
│   ├── handler.ts               # Webhook validation & routing
│   └── types.ts                 # Telegram API types
└── commands/
    ├── interface.ts             # Command handler interfaces
    ├── router.ts                # Command routing logic
    ├── start.ts                 # /start handler
    ├── filter.ts                # /filter handler (multi-step)
    ├── list.ts                  # /list handler
    ├── edit.ts                  # /edit handler (multi-step)
    ├── delete.ts                # /delete handler
    ├── pause.ts                 # /pause handler
    ├── resume.ts                # /resume handler
    └── help.ts                  # /help handler

packages/db/migrations/
└── 0006_conversation_state.sql  # New table for conversation state

scripts/
└── setup-webhook.ts             # Webhook registration utility
```

## Security Considerations

1. **Webhook Validation**: Always check `X-Telegram-Bot-Api-Secret-Token` header
2. **User Isolation**: All filter operations must verify `user_id` matches the requesting chat
3. **Input Sanitization**: Validate all numeric inputs (price, rooms) to prevent injection
4. **Rate Limiting**: Cloudflare Workers automatically rate-limits; consider tracking per-user command frequency
5. **Secrets Management**: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` must be Cloudflare secrets (never committed to code)

## Local Development

For local testing (wrangler dev), Telegram cannot send webhooks to localhost. Options:
1. Use ngrok/cloudflared tunnel to expose local dev server
2. Use Telegram's long-polling mode for local testing (separate dev script)
3. Deploy to Cloudflare preview environment for webhook testing

Recommendation: Add a `GET /webhook` endpoint that triggers a test update locally for development.

## Dependencies

No new npm dependencies required. All functionality uses:
- Cloudflare Workers `fetch` API
- Existing `TelegramClient` class
- Existing `createDB()` factory
