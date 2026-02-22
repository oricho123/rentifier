# Design: Telegram Bot Improvements

**Feature:** Telegram Bot Improvements
**Status:** Designed
**Created:** 2026-02-22

---

## Architecture Overview

### High-Level Approach

Keep the existing architecture (CommandRouter → Command handlers) and layer in:
1. **I18n module** - Centralized Hebrew strings
2. **Keyboard builders** - Reusable inline keyboard generators
3. **Callback query handler** - New router for button interactions
4. **Bot menu configurator** - Startup hook to set Telegram command menu

**No database changes needed.** All improvements are UI/UX layer only.

---

## Component Design

### 1. I18n Module (`src/i18n/he.ts`)

**Purpose:** Centralized Hebrew strings with type safety

**Structure:**
```typescript
export const he = {
  commands: {
    start: {
      welcome_new: 'ברוכים הבאים ל-Rentifier, {name}! 🏠',
      welcome_back: 'שלום שוב, {name}!',
      description: 'הרשמה או הצגת חשבון',
      // ...
    },
    filter: {
      description: 'יצירת פילטר חיפוש חדש',
      step_name: 'תן לפילטר שם (לדוגמה: "תל אביב 2 חדרים"):',
      step_cities: 'באילו עיירות לחפש?',
      // ...
    },
    // ... other commands
  },
  common: {
    skip: 'דלג',
    cancel: 'ביטול',
    confirm: 'אישור',
    next: 'הבא',
    previous: 'הקודם',
    // ...
  },
  errors: {
    user_not_found: '❌ משתמש לא נמצא. אנא שלח /start תחילה.',
    invalid_price: '❌ מחיר לא תקין. אנא הזן מספר חיובי.',
    // ...
  },
};

// Type-safe string formatter
export function t(key: string, params?: Record<string, string>): string {
  // Navigate nested object by key path
  // Replace {param} placeholders
}
```

**Design decisions:**
- Nested structure mirrors command organization
- Type-safe access via helper function
- Simple placeholder replacement `{name}` → actual value
- No runtime translation switching (Hebrew only)

---

### 2. Keyboard Builders (`src/keyboards/builders.ts`)

**Purpose:** Reusable inline keyboard generators

**Key builders:**

```typescript
export class KeyboardBuilder {
  // Quick action keyboard for welcome screen
  static quickActions(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: '➕ צור פילטר', callback_data: 'quick:filter' }],
        [{ text: '📋 רשימת פילטרים', callback_data: 'quick:list' }],
      ],
    };
  }

  // Skip/Continue keyboard for filter creation
  static skipContinue(step: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: '⏭️ דלג', callback_data: `filter:skip:${step}` }],
        [{ text: '❌ ביטול', callback_data: 'filter:cancel' }],
      ],
    };
  }

  // City quick-select keyboard
  static cities(): InlineKeyboardMarkup {
    const cities = ['תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון'];
    return {
      inline_keyboard: [
        ...cities.map(city => [{ text: city, callback_data: `city:${city}` }]),
        [{ text: '⏭️ דלג', callback_data: 'filter:skip:cities' }],
      ],
    };
  }

  // Filter action keyboard (for /list)
  static filterActions(filterId: number): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '✏️ ערוך', callback_data: `filter:edit:${filterId}` },
          { text: '🗑️ מחק', callback_data: `filter:delete:${filterId}` },
        ],
      ],
    };
  }

  // Confirmation keyboard (for destructive actions)
  static confirm(action: string, id: number): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '✅ אישור', callback_data: `confirm:${action}:${id}` },
          { text: '❌ ביטול', callback_data: 'cancel' },
        ],
      ],
    };
  }

  // Pagination keyboard
  static pagination(page: number, totalPages: number, prefix: string): InlineKeyboardMarkup {
    const buttons = [];
    if (page > 0) {
      buttons.push({ text: '⬅️ הקודם', callback_data: `${prefix}:page:${page - 1}` });
    }
    if (page < totalPages - 1) {
      buttons.push({ text: 'הבא ➡️', callback_data: `${prefix}:page:${page + 1}` });
    }
    return { inline_keyboard: [buttons] };
  }
}
```

**Design decisions:**
- Static methods for stateless builders
- Callback data format: `{action}:{subaction}:{id}`
- Max callback data length: 64 bytes (Telegram limit)
- Use emojis for visual hierarchy

---

### 3. Callback Query Router (`src/callbacks/router.ts`)

**Purpose:** Handle all inline keyboard button clicks

**Structure:**
```typescript
export class CallbackQueryRouter {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService,
    private stateManager: ConversationStateManager
  ) {}

  async route(update: TelegramUpdate): Promise<void> {
    const query = update.callback_query;
    if (!query?.data) return;

    const chatId = String(query.message.chat.id);
    const data = query.data;

    // Parse callback data: "action:subaction:param"
    const [action, subaction, param] = data.split(':');

    // Answer callback query immediately (Telegram requirement)
    await this.answerCallbackQuery(query.id);

    // Route to handler
    switch (action) {
      case 'quick':
        await this.handleQuickAction(chatId, subaction);
        break;
      case 'filter':
        await this.handleFilterAction(chatId, subaction, param, query.message);
        break;
      case 'city':
        await this.handleCitySelect(chatId, subaction);
        break;
      case 'confirm':
        await this.handleConfirm(chatId, subaction, param);
        break;
      case 'cancel':
        await this.handleCancel(chatId);
        break;
      default:
        console.warn('Unknown callback action:', action);
    }
  }

  private async answerCallbackQuery(queryId: string, text?: string): Promise<void> {
    await fetch(`${this.telegram.baseUrl}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: queryId, text }),
    });
  }

  // ... handler methods
}
```

**Design decisions:**
- Colon-separated callback data format (`action:subaction:param`)
- Always answer callback query immediately (UX requirement)
- Reuse existing conversation state for multi-step flows
- Edit original message when possible (smoother UX than new message)

---

### 4. Bot Menu Configurator (`src/bot-menu.ts`)

**Purpose:** Set Telegram command menu on startup

**Structure:**
```typescript
export async function configureBotMenu(botToken: string): Promise<void> {
  const commands = [
    { command: 'start', description: 'הרשמה או הצגת חשבון' },
    { command: 'filter', description: 'יצירת פילטר חיפוש חדש' },
    { command: 'list', description: 'הצגת כל הפילטרים שלך' },
    { command: 'pause', description: 'השהיית התראות' },
    { command: 'resume', description: 'המשך התראות' },
    { command: 'delete', description: 'מחיקת פילטר' },
    { command: 'help', description: 'הצגת עזרה ופקודות' },
  ];

  const response = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });

  if (!response.ok) {
    console.error('Failed to set bot commands:', await response.text());
  }
}
```

**Integration point:**
Call in `apps/notify/src/index.ts` startup hook:
```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Configure bot menu on first request (idempotent)
    await configureBotMenu(env.TELEGRAM_BOT_TOKEN);

    // ... existing webhook handler
  }
};
```

**Design decisions:**
- Call on every worker startup (idempotent, no harm)
- Fail gracefully if Telegram API is down
- Commands hardcoded (no need for dynamic configuration yet)

---

### 5. Enhanced Command Handlers

**Changes to existing handlers:**

**StartCommand:**
- Translate all messages to Hebrew
- Add quick-action keyboard to welcome message
- Use `KeyboardBuilder.quickActions()`

**FilterCommand:**
- Replace text prompts with inline keyboards where applicable
- Show progress indicator: "שלב {current} מתוך {total}"
- Use `KeyboardBuilder.skipContinue()` for optional fields
- Use `KeyboardBuilder.cities()` for city selection
- Handle callback queries for skip/city actions

**ListCommand:**
- Format each filter with inline action buttons
- Use `KeyboardBuilder.filterActions(filterId)`
- Paginate if > 10 filters
- Use `KeyboardBuilder.pagination()`

**DeleteCommand:**
- Show confirmation keyboard before deletion
- Use `KeyboardBuilder.confirm('delete', filterId)`
- Handle callback query for confirmation

**PauseCommand / ResumeCommand:**
- Add confirmation keyboard (optional, nice-to-have)
- Translate messages to Hebrew

**HelpCommand:**
- Translate to Hebrew
- Match command descriptions from bot menu

---

## Data Flow

### Filter Creation with Inline Keyboards

```
User clicks "צור פילטר" button
  ↓
CallbackQueryRouter receives callback_query
  ↓
Routes to handleQuickAction('filter')
  ↓
Initializes conversation state (step: 'name')
  ↓
Sends message: "תן לפילטר שם:" + skip/cancel keyboard
  ↓
User types text reply
  ↓
CommandRouter detects conversation state
  ↓
FilterCommand.handleStateReply() processes name
  ↓
Updates state (step: 'cities')
  ↓
Sends message: "באילו עיירות?" + city quick-select keyboard
  ↓
User clicks "תל אביב" button
  ↓
CallbackQueryRouter receives callback_query
  ↓
Routes to handleCitySelect('תל אביב')
  ↓
Updates conversation state with selected city
  ↓
Continues to next step (price_min)...
```

**Key insight:** Callback queries can update conversation state mid-flow, allowing hybrid text/button interactions.

---

### Filter List with Actions

```
User sends /list command
  ↓
ListCommand.execute()
  ↓
Fetch user's filters from database
  ↓
For each filter:
  - Format summary in Hebrew
  - Add inline action keyboard (✏️ ערוך, 🗑️ מחק)
  - Send message
  ↓
User clicks "🗑️ מחק" on filter #5
  ↓
CallbackQueryRouter receives callback_query (data: "filter:delete:5")
  ↓
Routes to handleFilterAction('delete', '5')
  ↓
Sends confirmation message with confirm/cancel keyboard
  ↓
User clicks "✅ אישור"
  ↓
CallbackQueryRouter receives callback_query (data: "confirm:delete:5")
  ↓
Routes to handleConfirm('delete', '5')
  ↓
Calls botService.deleteFilter(userId, 5)
  ↓
Sends success message: "✅ הפילטר נמחק"
```

---

## API Changes

### New Telegram Client Methods

Add to `TelegramClient`:

```typescript
// Answer callback query (required within 30s of button click)
async answerCallbackQuery(
  queryId: string,
  text?: string,
  showAlert?: boolean
): Promise<void>;

// Edit message text (for updating messages with inline keyboards)
async editMessageText(
  chatId: string,
  messageId: number,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
  replyMarkup?: InlineKeyboardMarkup
): Promise<TelegramSendResult>;

// Edit message reply markup only (for updating keyboards)
async editMessageReplyMarkup(
  chatId: string,
  messageId: number,
  replyMarkup: InlineKeyboardMarkup
): Promise<TelegramSendResult>;
```

### Webhook Handler Changes

Update `apps/notify/src/webhook/handler.ts`:

```typescript
export async function handleWebhook(
  update: TelegramUpdate,
  env: Env
): Promise<Response> {
  const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const botService = new BotService(env.DB);
  const stateManager = new ConversationStateManager(env.DB);
  const commandRouter = new CommandRouter(telegram, botService, stateManager);
  const callbackRouter = new CallbackQueryRouter(telegram, botService, stateManager);

  // Route based on update type
  if (update.message) {
    await commandRouter.route(update.message);
  } else if (update.callback_query) {
    await callbackRouter.route(update);
  }

  return new Response('OK', { status: 200 });
}
```

---

## File Structure

```
apps/notify/src/
├── i18n/
│   ├── he.ts                    # Hebrew strings
│   └── index.ts                 # Type-safe translator
├── keyboards/
│   └── builders.ts              # Reusable keyboard builders
├── callbacks/
│   ├── router.ts                # Callback query router
│   └── handlers.ts              # Callback action handlers
├── bot-menu.ts                  # Bot command menu configurator
├── telegram-client.ts           # MODIFIED: Add new methods
├── commands/
│   ├── start.ts                 # MODIFIED: Hebrew + keyboards
│   ├── filter.ts                # MODIFIED: Hebrew + keyboards
│   ├── list.ts                  # MODIFIED: Hebrew + keyboards
│   ├── delete.ts                # MODIFIED: Hebrew + keyboards
│   ├── pause.ts                 # MODIFIED: Hebrew
│   ├── resume.ts                # MODIFIED: Hebrew
│   └── help.ts                  # MODIFIED: Hebrew
├── webhook/
│   ├── handler.ts               # MODIFIED: Add callback routing
│   └── types.ts                 # MODIFIED: Add callback_query types
└── index.ts                     # MODIFIED: Call configureBotMenu()
```

---

## Database Impact

**No database changes required.**

Existing schema supports all new features:
- Conversation state (already exists)
- User filters (already exists)
- No need to store callback query history

---

## Testing Strategy

### Unit Tests

1. **I18n module**
   - Verify placeholder replacement
   - Test nested key access
   - Edge case: missing keys

2. **Keyboard builders**
   - Verify correct JSON structure
   - Test callback data format
   - Validate callback data length < 64 bytes

3. **Callback router**
   - Test callback data parsing
   - Verify routing to correct handlers
   - Edge case: malformed callback data

### Integration Tests

1. **Filter creation flow**
   - Text input + button clicks
   - Skip buttons work correctly
   - City quick-select updates state

2. **Filter list management**
   - Edit/delete buttons appear
   - Confirmation flow works
   - Pagination for >10 filters

3. **Bot menu**
   - Commands appear in Telegram
   - Descriptions in Hebrew

### Manual Testing Checklist

- [ ] Test on Telegram iOS
- [ ] Test on Telegram Android
- [ ] Test on Telegram Desktop
- [ ] Test on Telegram Web
- [ ] Verify RTL rendering
- [ ] Test Hebrew character encoding
- [ ] Verify emoji rendering
- [ ] Test callback query timeout handling

---

## Deployment Strategy

### Phase 1: Infrastructure (Non-Breaking)
- Add i18n module
- Add keyboard builders
- Add callback router (not yet wired)
- Deploy (no user-facing changes)

### Phase 2: Bot Menu
- Add bot-menu.ts
- Call from index.ts startup
- Deploy (users see Hebrew command menu)

### Phase 3: Command Migration (One at a Time)
- Migrate HelpCommand to Hebrew
- Deploy + test
- Migrate StartCommand to Hebrew + keyboards
- Deploy + test
- Migrate ListCommand to Hebrew + keyboards
- Deploy + test
- Migrate FilterCommand to Hebrew + keyboards
- Deploy + test
- Migrate DeleteCommand to Hebrew + keyboards
- Deploy + test
- Migrate PauseCommand and ResumeCommand
- Deploy + test

### Phase 4: Polish
- Add progress indicators
- Fine-tune messages based on user feedback
- Optimize callback data format

**Rollback plan:** Each phase is independently deployable. If issues arise, revert to previous commit (git revert).

---

## Performance Considerations

### Callback Query Response Time
- Target: < 100ms to answer callback query
- Current: DB queries take ~20ms on D1
- Mitigation: Answer query immediately, process async if needed

### Inline Keyboard Size
- Telegram limit: 4KB per message
- Current largest keyboard: cities (5 buttons × ~50 bytes) = ~250 bytes
- Headroom: 16x safety margin

### Database Load
- No additional queries needed
- Callback queries reuse existing conversation state
- No performance impact expected

---

## Security Considerations

### Callback Data Validation
- Always validate filter IDs belong to requesting user
- Check user permissions before destructive actions
- Sanitize callback data input (prevent injection)

**Example:**
```typescript
async handleFilterDelete(chatId: string, filterIdStr: string): Promise<void> {
  const filterId = parseInt(filterIdStr, 10);
  if (isNaN(filterId)) {
    // Invalid ID, ignore
    return;
  }

  const user = await this.botService.getUserByChatId(chatId);
  if (!user) {
    await this.telegram.sendMessage(chatId, he.errors.user_not_found);
    return;
  }

  // Verify filter belongs to user
  const success = await this.botService.deleteFilter(user.id, filterId);
  // ...
}
```

### Callback Query Replay Protection
- Not needed (Telegram handles this)
- Each callback query has unique `query.id`
- Answering twice is safe (idempotent)

---

## Accessibility

### Screen Readers
- Ensure button text is descriptive
- Use emojis sparingly (some screen readers read them verbatim)
- Provide text alternatives for icon-only buttons

### Keyboard Navigation
- Telegram handles this automatically
- No additional work needed

---

## Internationalization (Future)

Current design supports future i18n:
- Replace `he.ts` with `i18n/locales/he.ts`
- Add `i18n/locales/en.ts`, `i18n/locales/ru.ts`, etc.
- Add user language preference to `users` table
- Lookup locale based on user preference

---

## Open Questions

**Q1: Should we support mixed Hebrew/English for tech-savvy users?**
- **Decision:** Hebrew only for M3. English support deferred to future milestone.

**Q2: How to handle very long filter lists (e.g., 50+ filters)?**
- **Decision:** Paginate with 10 filters per page. Add search/filter feature in future.

**Q3: Should filter edit flow reuse filter creation flow?**
- **Decision:** Yes. Pre-populate conversation state with existing filter values.

**Q4: How to handle callback queries during conversation state?**
- **Decision:** Allow hybrid flows. Callback queries can update state mid-conversation.

---

## Implementation Notes

### Order of Implementation

1. **Foundation** (can be done in parallel)
   - i18n module
   - Keyboard builders
   - Callback router (skeleton)

2. **Bot menu** (depends on i18n)
   - bot-menu.ts
   - Wire into index.ts

3. **Simple commands first** (low risk)
   - HelpCommand
   - StartCommand
   - PauseCommand / ResumeCommand

4. **Complex commands** (higher risk)
   - ListCommand (edit/delete actions)
   - DeleteCommand (confirmation flow)
   - FilterCommand (multi-step with keyboards)

### Code Review Checklist

- [ ] All user-facing strings in Hebrew
- [ ] Callback data format documented
- [ ] Callback data length < 64 bytes
- [ ] Always answer callback queries
- [ ] User permission checks before actions
- [ ] Error handling for callback failures
- [ ] RTL formatting tested
- [ ] Emojis used consistently

---

## Success Criteria

**Technical:**
- Zero breaking changes to existing functionality
- All existing tests still pass
- New callback router has >90% test coverage
- Bot menu configured successfully on startup

**User Experience:**
- Users report improved discoverability
- Filter creation time reduced (measured via conversation state TTL)
- Fewer support questions about commands

**Code Quality:**
- Centralized Hebrew strings (no hardcoded text in handlers)
- Reusable keyboard builders (DRY principle)
- Clean callback routing (no spaghetti conditionals)
