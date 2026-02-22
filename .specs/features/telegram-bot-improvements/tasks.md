# Tasks: Telegram Bot Improvements

**Feature:** Telegram Bot Improvements
**Status:** Ready for Implementation
**Created:** 2026-02-22

---

## Task Organization

Tasks are grouped into phases. Each phase can be deployed independently.

**Dependency notation:**
- `→` Sequential dependency (must complete in order)
- `||` Parallel (can work simultaneously)

---

## Phase 1: Foundation (Infrastructure)

### Task 1.1: Create I18n Module

**Description:**
Create centralized Hebrew strings module with type-safe accessor.

**Files to create:**
- `apps/notify/src/i18n/he.ts` - Hebrew strings
- `apps/notify/src/i18n/index.ts` - Translator function

**Implementation:**
```typescript
// he.ts structure
export const he = {
  commands: {
    start: { ... },
    filter: { ... },
    list: { ... },
    // etc
  },
  common: { skip: 'דלג', cancel: 'ביטול', ... },
  errors: { ... },
};

// index.ts
export function t(key: string, params?: Record<string, string>): string
```

**Verification:**
- [ ] All command messages translated to Hebrew
- [ ] Placeholder replacement works: `t('welcome', {name: 'John'})` → "ברוכים הבאים John"
- [ ] TypeScript compiles without errors
- [ ] Unit test: verify nested key access
- [ ] Unit test: verify placeholder replacement

**Dependencies:** None

**Complexity:** Small (2-3 hours)

---

### Task 1.2: Create Keyboard Builders

**Description:**
Create reusable inline keyboard builders for common UI patterns.

**Files to create:**
- `apps/notify/src/keyboards/builders.ts`

**Builders to implement:**
- `KeyboardBuilder.quickActions()` - Welcome screen buttons
- `KeyboardBuilder.skipContinue(step)` - Skip/cancel for filter creation
- `KeyboardBuilder.cities()` - City quick-select
- `KeyboardBuilder.filterActions(filterId)` - Edit/delete buttons
- `KeyboardBuilder.confirm(action, id)` - Confirmation dialog
- `KeyboardBuilder.pagination(page, total, prefix)` - Next/previous

**Verification:**
- [ ] All builders return valid `InlineKeyboardMarkup` JSON
- [ ] Callback data format: `{action}:{subaction}:{param}`
- [ ] All callback data < 64 bytes
- [ ] TypeScript compiles without errors
- [ ] Unit test: verify JSON structure for each builder
- [ ] Unit test: verify callback data length

**Dependencies:** None

**Complexity:** Small (2-3 hours)

---

### Task 1.3: Create Callback Query Router Skeleton

**Description:**
Create callback query router infrastructure without wiring to webhook yet.

**Files to create:**
- `apps/notify/src/callbacks/router.ts`
- `apps/notify/src/callbacks/handlers.ts` (optional, for organizing handlers)

**Implementation:**
```typescript
export class CallbackQueryRouter {
  async route(update: TelegramUpdate): Promise<void> {
    // Parse callback data
    // Answer query immediately
    // Route to appropriate handler
  }

  private async answerCallbackQuery(queryId: string): Promise<void>
  private async handleQuickAction(chatId: string, action: string): Promise<void>
  private async handleFilterAction(chatId: string, action: string, param: string): Promise<void>
  // ... other handlers
}
```

**Verification:**
- [ ] Router parses callback data correctly
- [ ] Router answers callback queries
- [ ] Skeleton handlers exist (can be stubs)
- [ ] TypeScript compiles without errors
- [ ] Unit test: verify callback data parsing
- [ ] Unit test: verify routing logic

**Dependencies:** None

**Complexity:** Medium (3-4 hours)

---

### Task 1.4: Extend Telegram Client

**Description:**
Add new methods to `TelegramClient` for callback query handling and message editing.

**Files to modify:**
- `apps/notify/src/telegram-client.ts`

**Methods to add:**
```typescript
async answerCallbackQuery(
  queryId: string,
  text?: string,
  showAlert?: boolean
): Promise<void>

async editMessageText(
  chatId: string,
  messageId: number,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
  replyMarkup?: InlineKeyboardMarkup
): Promise<TelegramSendResult>

async editMessageReplyMarkup(
  chatId: string,
  messageId: number,
  replyMarkup: InlineKeyboardMarkup
): Promise<TelegramSendResult>
```

**Verification:**
- [ ] All three methods implemented
- [ ] Methods handle HTTP errors gracefully
- [ ] Return types match existing `sendMessage` pattern
- [ ] TypeScript compiles without errors
- [ ] Can call methods without runtime errors (manual test)

**Dependencies:** None

**Complexity:** Small (1-2 hours)

---

### Task 1.5: Update Webhook Types

**Description:**
Add `callback_query` type definitions to webhook types.

**Files to modify:**
- `apps/notify/src/webhook/types.ts`

**Types to add:**
```typescript
export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;  // NEW
}
```

**Verification:**
- [ ] Types compile without errors
- [ ] Types match Telegram Bot API v7.0+ spec
- [ ] Existing code still works with new optional field

**Dependencies:** None

**Complexity:** Trivial (30 minutes)

---

## Phase 2: Bot Menu Configuration

### Task 2.1: Create Bot Menu Configurator

**Description:**
Create module to set Telegram bot command menu with Hebrew descriptions.

**Files to create:**
- `apps/notify/src/bot-menu.ts`

**Implementation:**
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

  await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
}
```

**Verification:**
- [ ] Function calls Telegram `setMyCommands` API
- [ ] All 7 commands included
- [ ] Descriptions in Hebrew
- [ ] Graceful error handling if API fails
- [ ] Can be called multiple times (idempotent)

**Dependencies:** Task 1.1 (for Hebrew strings)

**Complexity:** Small (1 hour)

---

### Task 2.2: Wire Bot Menu to Worker Startup

**Description:**
Call `configureBotMenu()` on worker startup.

**Files to modify:**
- `apps/notify/src/index.ts`

**Implementation:**
```typescript
import { configureBotMenu } from './bot-menu';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Configure bot menu on startup (idempotent)
    await configureBotMenu(env.TELEGRAM_BOT_TOKEN);

    // Existing webhook handler...
  }
}
```

**Verification:**
- [ ] Function called on worker startup
- [ ] Worker still handles webhooks correctly
- [ ] Bot menu visible in Telegram (manual test: type `/` in chat)
- [ ] Commands show Hebrew descriptions
- [ ] No performance degradation

**Dependencies:** Task 2.1

**Complexity:** Trivial (30 minutes)

---

## Phase 3: Simple Command Migrations

### Task 3.1: Migrate HelpCommand to Hebrew

**Description:**
Translate help text to Hebrew.

**Files to modify:**
- `apps/notify/src/commands/help.ts`

**Changes:**
- Replace English strings with `t()` calls
- Use Hebrew command descriptions matching bot menu

**Verification:**
- [ ] All text in Hebrew
- [ ] Command descriptions match bot menu
- [ ] Formatting preserved (bold, newlines)
- [ ] Manual test: `/help` shows Hebrew text
- [ ] Manual test: RTL rendering correct on mobile/desktop

**Dependencies:** Task 1.1

**Complexity:** Trivial (30 minutes)

---

### Task 3.2: Migrate StartCommand to Hebrew + Quick Actions

**Description:**
Translate start command and add quick-action inline keyboard.

**Files to modify:**
- `apps/notify/src/commands/start.ts`

**Changes:**
- Replace English strings with `t()` calls
- Add `KeyboardBuilder.quickActions()` to welcome message
- Format filter count in Hebrew (e.g., "3 פילטרים פעילים")

**Verification:**
- [ ] Welcome message in Hebrew
- [ ] Quick action buttons appear (➕ צור פילטר, 📋 רשימת פילטרים)
- [ ] Buttons work (handled by callback router, see Task 4.1)
- [ ] Filter count formatted correctly
- [ ] Manual test: `/start` for new user
- [ ] Manual test: `/start` for existing user

**Dependencies:** Task 1.1, Task 1.2

**Complexity:** Small (1 hour)

---

### Task 3.3: Migrate PauseCommand to Hebrew

**Description:**
Translate pause command messages.

**Files to modify:**
- `apps/notify/src/commands/pause.ts`

**Changes:**
- Replace English strings with `t()` calls

**Verification:**
- [ ] All messages in Hebrew
- [ ] Manual test: `/pause` pauses filters
- [ ] Database updated correctly

**Dependencies:** Task 1.1

**Complexity:** Trivial (20 minutes)

---

### Task 3.4: Migrate ResumeCommand to Hebrew

**Description:**
Translate resume command messages.

**Files to modify:**
- `apps/notify/src/commands/resume.ts`

**Changes:**
- Replace English strings with `t()` calls

**Verification:**
- [ ] All messages in Hebrew
- [ ] Manual test: `/resume` resumes filters
- [ ] Database updated correctly

**Dependencies:** Task 1.1

**Complexity:** Trivial (20 minutes)

---

## Phase 4: Complex Command Migrations

### Task 4.1: Wire Callback Router to Webhook

**Description:**
Connect callback query router to webhook handler so button clicks are processed.

**Files to modify:**
- `apps/notify/src/webhook/handler.ts`

**Changes:**
```typescript
import { CallbackQueryRouter } from '../callbacks/router';

export async function handleWebhook(update: TelegramUpdate, env: Env): Promise<Response> {
  // ... existing setup

  const callbackRouter = new CallbackQueryRouter(telegram, botService, stateManager);

  if (update.message) {
    await commandRouter.route(update.message);
  } else if (update.callback_query) {
    await callbackRouter.route(update);  // NEW
  }

  return new Response('OK', { status: 200 });
}
```

**Verification:**
- [ ] Callback queries routed correctly
- [ ] Text messages still work
- [ ] No errors in worker logs
- [ ] Manual test: click button, verify callback handled

**Dependencies:** Task 1.3, Task 1.5

**Complexity:** Small (1 hour)

---

### Task 4.2: Implement Quick Action Handlers

**Description:**
Implement handlers for quick action buttons (צור פילטר, רשימת פילטרים).

**Files to modify:**
- `apps/notify/src/callbacks/router.ts`

**Implementation:**
```typescript
private async handleQuickAction(chatId: string, action: string): Promise<void> {
  switch (action) {
    case 'filter':
      // Delegate to FilterCommand
      await this.filterCommand.execute({ chat: { id: chatId }, ... });
      break;
    case 'list':
      // Delegate to ListCommand
      await this.listCommand.execute({ chat: { id: chatId }, ... });
      break;
  }
}
```

**Verification:**
- [ ] Quick action "צור פילטר" starts filter creation
- [ ] Quick action "רשימת פילטרים" shows filter list
- [ ] Callback query answered immediately
- [ ] Manual test: click buttons in welcome message

**Dependencies:** Task 4.1

**Complexity:** Small (1-2 hours)

---

### Task 4.3: Migrate ListCommand to Hebrew + Action Buttons

**Description:**
Translate list command and add edit/delete buttons to each filter.

**Files to modify:**
- `apps/notify/src/commands/list.ts`

**Changes:**
- Replace English strings with `t()` calls
- Add `KeyboardBuilder.filterActions(filterId)` to each filter message
- Format prices with thousands separator: `5,000 ₪`
- Add pagination if > 10 filters (use `KeyboardBuilder.pagination()`)

**Verification:**
- [ ] All messages in Hebrew
- [ ] Each filter has edit/delete buttons
- [ ] Prices formatted correctly
- [ ] Pagination works for large lists
- [ ] Manual test: `/list` with 0 filters
- [ ] Manual test: `/list` with 1-10 filters
- [ ] Manual test: `/list` with >10 filters (pagination)

**Dependencies:** Task 1.1, Task 1.2

**Complexity:** Medium (3-4 hours)

---

### Task 4.4: Implement Filter Action Handlers (Edit/Delete)

**Description:**
Implement callback handlers for edit/delete filter buttons.

**Files to modify:**
- `apps/notify/src/callbacks/router.ts`

**Implementation:**
```typescript
private async handleFilterAction(
  chatId: string,
  action: string,
  param: string,
  message: TelegramMessage
): Promise<void> {
  const filterId = parseInt(param, 10);

  switch (action) {
    case 'edit':
      // Show confirmation or start edit flow
      await this.handleFilterEdit(chatId, filterId);
      break;
    case 'delete':
      // Show confirmation dialog
      await this.handleFilterDeleteConfirm(chatId, filterId, message);
      break;
  }
}

private async handleFilterDeleteConfirm(
  chatId: string,
  filterId: number,
  originalMessage: TelegramMessage
): Promise<void> {
  // Edit original message to show confirmation
  const filter = await this.botService.getFilter(filterId);
  const confirmText = t('filter.delete_confirm', { name: filter.name });
  const keyboard = KeyboardBuilder.confirm('delete', filterId);

  await this.telegram.editMessageText(
    chatId,
    originalMessage.message_id,
    confirmText,
    'HTML',
    keyboard
  );
}
```

**Verification:**
- [ ] Delete button shows confirmation dialog
- [ ] Edit button initiates edit flow (can be stub for now)
- [ ] Confirmation includes filter name
- [ ] User permission validated (filter belongs to user)
- [ ] Manual test: click delete, verify confirmation
- [ ] Manual test: click edit (stub message OK for now)

**Dependencies:** Task 4.3, Task 4.1

**Complexity:** Medium (3-4 hours)

---

### Task 4.5: Implement Delete Confirmation Handler

**Description:**
Handle delete confirmation button click.

**Files to modify:**
- `apps/notify/src/callbacks/router.ts`

**Implementation:**
```typescript
private async handleConfirm(chatId: string, action: string, param: string): Promise<void> {
  const id = parseInt(param, 10);

  switch (action) {
    case 'delete':
      await this.handleFilterDelete(chatId, id);
      break;
  }
}

private async handleFilterDelete(chatId: string, filterId: number): Promise<void> {
  const user = await this.botService.getUserByChatId(chatId);
  if (!user) {
    await this.telegram.sendMessage(chatId, t('errors.user_not_found'));
    return;
  }

  const success = await this.botService.deleteFilter(user.id, filterId);

  if (success) {
    await this.telegram.sendMessage(chatId, t('filter.deleted'));
  } else {
    await this.telegram.sendMessage(chatId, t('errors.filter_not_found'));
  }
}
```

**Verification:**
- [ ] Clicking "אישור" deletes filter
- [ ] Clicking "ביטול" cancels without deleting
- [ ] Success message in Hebrew
- [ ] Database updated correctly
- [ ] User permission validated
- [ ] Manual test: full delete flow
- [ ] Manual test: cancel delete flow

**Dependencies:** Task 4.4

**Complexity:** Small (1-2 hours)

---

### Task 4.6: Migrate DeleteCommand to Hebrew

**Description:**
Translate delete command (direct `/delete <id>` usage).

**Files to modify:**
- `apps/notify/src/commands/delete.ts`

**Changes:**
- Replace English strings with `t()` calls
- Add confirmation keyboard (reuse logic from callback handler)

**Note:** This handles the direct `/delete 5` command, separate from the button flow.

**Verification:**
- [ ] All messages in Hebrew
- [ ] Confirmation works
- [ ] Manual test: `/delete 5`
- [ ] Manual test: `/delete 999` (non-existent filter)

**Dependencies:** Task 1.1, Task 1.2

**Complexity:** Small (1 hour)

---

### Task 4.7: Migrate FilterCommand to Hebrew + Interactive Flow

**Description:**
Translate filter creation command and add inline keyboards for interactive flow.

**Files to modify:**
- `apps/notify/src/commands/filter.ts`

**Changes:**
- Replace all English strings with `t()` calls
- Add `KeyboardBuilder.skipContinue(step)` to each step
- Add `KeyboardBuilder.cities()` for city selection step
- Add progress indicator: "שלב {n} מתוך 6"
- Format prices with ₪ symbol
- Handle callback queries for skip/city selection (via callback router)

**Verification:**
- [ ] All messages in Hebrew
- [ ] Progress indicator shows on each step
- [ ] Skip buttons work
- [ ] City quick-select works
- [ ] Can still type text responses (hybrid flow)
- [ ] Manual test: full filter creation with buttons
- [ ] Manual test: full filter creation with text only
- [ ] Manual test: mixed buttons + text
- [ ] Manual test: validation errors (invalid price, etc.)

**Dependencies:** Task 1.1, Task 1.2, Task 4.1

**Complexity:** Large (6-8 hours)

---

### Task 4.8: Implement Filter Creation Callback Handlers

**Description:**
Handle callback queries during filter creation (skip, city selection, cancel).

**Files to modify:**
- `apps/notify/src/callbacks/router.ts`

**Implementation:**
```typescript
private async handleFilterAction(chatId: string, action: string, param: string): Promise<void> {
  const state = await this.stateManager.getState(chatId);

  switch (action) {
    case 'skip':
      // Skip current step, advance to next
      await this.filterCommand.handleSkip(chatId, state, param);
      break;
    case 'cancel':
      // Cancel filter creation
      await this.stateManager.clearState(chatId);
      await this.telegram.sendMessage(chatId, t('filter.cancelled'));
      break;
  }
}

private async handleCitySelect(chatId: string, city: string): Promise<void> {
  const state = await this.stateManager.getState(chatId);
  if (!state || state.command !== '/filter' || state.step !== 'cities') {
    return; // Invalid state
  }

  // Update state with selected city
  state.data.cities = [city];
  state.step = 'price_min';
  await this.stateManager.setState(chatId, state);

  // Continue to next step
  await this.filterCommand.continueFromState(chatId, state);
}
```

**Verification:**
- [ ] Skip button advances to next step
- [ ] City selection updates state and continues
- [ ] Cancel button clears state and shows message
- [ ] Invalid state handled gracefully
- [ ] Manual test: skip all optional fields
- [ ] Manual test: select city from quick-select
- [ ] Manual test: cancel mid-flow

**Dependencies:** Task 4.7

**Complexity:** Medium (3-4 hours)

---

## Phase 5: Polish & Testing

### Task 5.1: Add BotService Method for Filter Lookup

**Description:**
Add helper method to fetch a single filter with user validation.

**Files to modify:**
- `apps/notify/src/bot-service.ts`

**Method to add:**
```typescript
async getFilter(userId: number, filterId: number): Promise<Filter | null> {
  const result = await this.d1
    .prepare('SELECT * FROM filters WHERE id = ? AND user_id = ?')
    .bind(filterId, userId)
    .first<Filter>();
  return result ?? null;
}
```

**Verification:**
- [ ] Method returns filter if found
- [ ] Method returns null if not found or wrong user
- [ ] TypeScript compiles
- [ ] Used in callback handlers for validation

**Dependencies:** None

**Complexity:** Trivial (20 minutes)

---

### Task 5.2: Standardize Price Formatting

**Description:**
Create helper function for consistent price formatting across all commands.

**Files to create:**
- `apps/notify/src/utils/formatters.ts`

**Function to add:**
```typescript
export function formatPrice(price: number): string {
  return `${price.toLocaleString('he-IL')} ₪`;
}

export function formatPriceRange(min?: number | null, max?: number | null): string {
  if (!min && !max) return '—';
  const minStr = min ? formatPrice(min) : '—';
  const maxStr = max ? formatPrice(max) : '—';
  return `${minStr} - ${maxStr}`;
}
```

**Verification:**
- [ ] Prices use thousands separators
- [ ] Currency symbol (₪) always present
- [ ] Null/undefined handled gracefully
- [ ] Used consistently in all commands
- [ ] Manual test: view filter with prices

**Dependencies:** None

**Complexity:** Small (1 hour)

---

### Task 5.3: Add Filter Edit Flow (Stretch Goal)

**Description:**
Implement filter editing (currently shows stub message).

**Files to modify:**
- `apps/notify/src/callbacks/router.ts`
- `apps/notify/src/commands/filter.ts`

**Implementation:**
- Fetch existing filter
- Pre-populate conversation state with current values
- Reuse filter creation flow
- Show current values in prompts (e.g., "מחיר מינימלי (נוכחי: 3,000 ₪):")

**Verification:**
- [ ] Edit button works
- [ ] Current values shown in prompts
- [ ] Can update individual fields
- [ ] Can skip fields to keep current value
- [ ] Manual test: edit all fields
- [ ] Manual test: edit some fields
- [ ] Manual test: cancel edit

**Dependencies:** Task 4.4

**Complexity:** Medium (4-5 hours)

**Priority:** Low (can defer to future milestone)

---

### Task 5.4: Comprehensive Manual Testing

**Description:**
End-to-end testing of all flows on multiple platforms.

**Test cases:**

**Platform testing:**
- [ ] Telegram iOS
- [ ] Telegram Android
- [ ] Telegram Desktop (Windows/Mac/Linux)
- [ ] Telegram Web

**Feature testing:**
- [ ] Bot menu visible with Hebrew descriptions
- [ ] Welcome message with quick actions
- [ ] Filter creation (full flow, all steps)
- [ ] Filter creation (skip all optional fields)
- [ ] Filter creation (cancel mid-flow)
- [ ] Filter list (0 filters)
- [ ] Filter list (1-10 filters)
- [ ] Filter list (>10 filters, pagination)
- [ ] Filter delete (full flow)
- [ ] Filter delete (cancel)
- [ ] Filter edit (if implemented)
- [ ] Pause/resume notifications
- [ ] Help command

**Edge cases:**
- [ ] Hebrew RTL rendering
- [ ] Long filter names (>50 chars)
- [ ] Very long filter lists (50+ filters)
- [ ] Concurrent operations (two users at once)
- [ ] Invalid input during filter creation
- [ ] Network errors (simulate API failure)

**Dependencies:** All previous tasks

**Complexity:** Medium (4-6 hours)

---

### Task 5.5: Update Documentation

**Description:**
Update deployment docs and README with new features.

**Files to modify:**
- `DEPLOYMENT.md` - Add Hebrew localization notes
- `README.md` - Update bot features list
- `.specs/project/STATE.md` - Record completion

**Documentation to add:**
- Hebrew localization approach
- Callback query handling architecture
- Testing checklist for Hebrew UI
- Screenshots (optional)

**Verification:**
- [ ] DEPLOYMENT.md updated
- [ ] README.md updated
- [ ] STATE.md updated
- [ ] All docs in sync

**Dependencies:** Task 5.4

**Complexity:** Small (1-2 hours)

---

## Summary

### Task Count by Phase

- **Phase 1 (Foundation):** 5 tasks
- **Phase 2 (Bot Menu):** 2 tasks
- **Phase 3 (Simple Commands):** 4 tasks
- **Phase 4 (Complex Commands):** 8 tasks
- **Phase 5 (Polish):** 5 tasks

**Total:** 24 tasks

### Estimated Effort

- **Small tasks:** 14 (1-3 hours each) = ~28 hours
- **Medium tasks:** 7 (3-5 hours each) = ~28 hours
- **Large tasks:** 1 (6-8 hours) = ~7 hours
- **Trivial tasks:** 2 (<1 hour each) = ~1 hour

**Total estimated effort:** 64 hours (~8 working days)

### Critical Path

```
Phase 1 (Foundation) → Phase 2 (Bot Menu) → Phase 3 (Simple) → Phase 4 (Complex) → Phase 5 (Polish)
```

**Minimum viable deliverable (MVP):**
- Phase 1: Tasks 1.1, 1.2, 1.4, 1.5
- Phase 2: Tasks 2.1, 2.2
- Phase 3: Tasks 3.1, 3.2
- Phase 4: Tasks 4.1, 4.3

**MVP effort:** ~20 hours (~2.5 days)

---

## Deployment Strategy

### Deploy After Each Phase

**Phase 1 deployment:**
- No user-facing changes
- Infrastructure ready for subsequent phases
- Risk: Low

**Phase 2 deployment:**
- Bot menu visible to users
- Commands still in English (not yet migrated)
- Risk: Low (purely additive)

**Phase 3 deployment:**
- Help, Start, Pause, Resume in Hebrew
- Quick action buttons work
- Filter creation still in English
- Risk: Low (simple commands)

**Phase 4 deployment:**
- All commands in Hebrew
- Full interactive experience
- Risk: Medium (complex flows)

**Phase 5 deployment:**
- Polish and optimizations
- Documentation updates
- Risk: Low

### Rollback Plan

Each phase is independently deployable. If issues arise:
1. Identify failing task
2. Git revert to previous working commit
3. Redeploy
4. Fix issue offline
5. Redeploy when ready

### Feature Flags (Optional)

If risk tolerance is low, add feature flag:
```typescript
const HEBREW_UI_ENABLED = env.HEBREW_UI_ENABLED === 'true';

if (HEBREW_UI_ENABLED) {
  // Use Hebrew + keyboards
} else {
  // Use existing English flow
}
```

Enable for testing in staging environment, then production.

---

## Testing Checklist

### Unit Tests

- [ ] I18n: placeholder replacement
- [ ] I18n: nested key access
- [ ] Keyboard builders: JSON structure
- [ ] Keyboard builders: callback data format
- [ ] Callback router: data parsing
- [ ] Callback router: routing logic
- [ ] Price formatter: thousands separator
- [ ] Price formatter: null handling

### Integration Tests

- [ ] Filter creation with text input
- [ ] Filter creation with button clicks
- [ ] Filter creation with mixed input
- [ ] Filter list with action buttons
- [ ] Filter delete with confirmation
- [ ] Quick actions from welcome screen
- [ ] Bot menu configuration

### Manual Tests

See Task 5.4 for comprehensive checklist.

---

## Dependencies Graph

```
1.1 (i18n) ──┬──> 2.1 (bot menu) ──> 2.2 (wire menu)
             │
             ├──> 3.1 (help) ──┐
             ├──> 3.2 (start) ─┤
             ├──> 3.3 (pause) ─┤──> (Phase 3 complete)
             ├──> 3.4 (resume) ┘
             │
             └──> 4.3 (list) ──> 4.4 (actions) ──> 4.5 (confirm)
                                                      │
1.2 (keyboards) ─┴──────────────────────────────────┘
                                                      │
1.3 (callback) + 1.5 (types) ──> 4.1 (wire) ────────┤
                                   │                  │
                                   └──> 4.2 (quick) ──┤
                                                      │
                                                      ├──> 4.7 (filter cmd) ──> 4.8 (filter callbacks)
                                                      │
1.4 (client) ─────────────────────────────────────────┘

5.1 (lookup) ──┬
5.2 (format) ──┼──> 5.4 (testing) ──> 5.5 (docs)
5.3 (edit) ────┘
```

---

## Risk Assessment

### High-Risk Tasks
- **Task 4.7:** Filter command migration (most complex flow)
- **Task 4.8:** Filter callback handlers (state management complexity)

**Mitigation:**
- Break into smaller subtasks if needed
- Extensive manual testing
- Deploy to staging first

### Medium-Risk Tasks
- **Task 4.1:** Wire callback router (integration point)
- **Task 4.3:** List command with pagination

**Mitigation:**
- Thorough integration testing
- Monitor logs after deployment

### Low-Risk Tasks
- All Phase 1, 2, 3 tasks
- All Phase 5 tasks

---

## Open Questions

**Q: Should we implement filter edit in Phase 4 or defer to future milestone?**
- **Recommendation:** Defer (Task 5.3 marked as stretch goal)
- **Reason:** Not blocking for MVP, adds complexity

**Q: Should we add analytics tracking (button click rates, etc.)?**
- **Recommendation:** Defer to future milestone
- **Reason:** Out of scope for M3

**Q: Should we support English fallback for users who prefer it?**
- **Recommendation:** No, Hebrew only for M3
- **Reason:** Simplifies implementation, can add later

---

## Next Steps

1. **Review tasks** with team/stakeholders
2. **Prioritize** MVP vs nice-to-have
3. **Assign** tasks to developer(s)
4. **Set up** staging environment
5. **Begin Phase 1** implementation
