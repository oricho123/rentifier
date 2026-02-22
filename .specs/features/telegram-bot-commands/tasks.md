# Telegram Bot Commands — Tasks

## T1: Create conversation_state migration

**File:** `packages/db/migrations/0006_conversation_state.sql`
**Depends on:** None

Create a new migration for the `conversation_state` table:
- `chat_id` TEXT PRIMARY KEY
- `command` TEXT NOT NULL (e.g., '/filter')
- `step` TEXT NOT NULL (current step in multi-step flow)
- `data_json` TEXT NOT NULL (JSON-serialized conversation data)
- `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
- `expires_at` TEXT NOT NULL (for TTL-based cleanup)
- Index on `expires_at` for efficient cleanup queries

**Verify:** Migration file exists. Can be applied with `wrangler d1 migrations apply`. `pnpm typecheck` passes.

---

## T2: Create Telegram Bot API types

**File:** `apps/notify/src/webhook/types.ts`
**Depends on:** None

Define TypeScript interfaces for Telegram Bot API objects:
- `TelegramUpdate` (update_id, message, callback_query)
- `TelegramMessage` (message_id, from, chat, date, text)
- `TelegramUser` (id, is_bot, first_name, last_name, username)
- `TelegramChat` (id, type)
- `TelegramCallbackQuery` (id, from, message, data)
- `InlineKeyboardButton` (text, callback_data)
- `InlineKeyboardMarkup` (inline_keyboard)

**Verify:** File exists and exports all interfaces. `pnpm typecheck` passes.

---

## T3: Extend TelegramClient with inline keyboard support

**File:** `apps/notify/src/telegram-client.ts`
**Depends on:** T2

Add `sendInlineKeyboard()` method to existing `TelegramClient` class:
- Parameters: `chatId`, `text`, `keyboard: InlineKeyboardMarkup`
- Send POST request to `/sendMessage` with `reply_markup` field
- Reuse existing error handling logic from `sendMessage()`
- Return `TelegramSendResult`

**Verify:** `pnpm typecheck` passes. Method can be called with inline keyboard markup.

---

## T4: Implement ConversationStateManager

**File:** `apps/notify/src/conversation-state.ts`
**Depends on:** T1

Implement conversation state management:
- `getState(chatId)`: Query `conversation_state` table, filter by `expires_at > now()`, parse `data_json`
- `setState(chatId, state)`: Upsert state with 10-minute TTL (expires_at = now + 10 min), serialize `data` to JSON
- `clearState(chatId)`: Delete state for given chat_id

**Verify:** `pnpm typecheck` passes. Class can be instantiated with `DatabaseService`.

---

## T5: Implement BotService

**File:** `apps/notify/src/bot-service.ts`
**Depends on:** None

Implement user and filter CRUD operations:
- `getUserByChatId(chatId)`: SELECT from `users` by `telegram_chat_id`
- `createUser(chatId, displayName)`: INSERT into `users`
- `getFilterCount(userId)`: COUNT enabled filters for user
- `getFilters(userId)`: SELECT all filters for user
- `createFilter(userId, data)`: INSERT filter with JSON-serialized cities/keywords
- `deleteFilter(userId, filterId)`: DELETE filter (verify user_id matches)
- `pauseAllFilters(userId)`: UPDATE all user's filters to `enabled = 0`
- `resumeAllFilters(userId)`: UPDATE all user's filters to `enabled = 1`

**Verify:** `pnpm typecheck` passes. All methods use parameterized queries (no SQL injection).

---

## T6: Create command handler interfaces

**File:** `apps/notify/src/commands/interface.ts`
**Depends on:** T2

Define command handler interfaces:
- `CommandHandler` interface with `execute(message, args)` method
- `StatefulCommandHandler` interface extending `CommandHandler` with `handleStateReply(message, state)` method
- `ConversationState` interface (chatId, command, step, data, createdAt)
- Export types for use in command implementations

**Verify:** File exists and exports all interfaces. `pnpm typecheck` passes.

---

## T7: Implement StartCommand

**File:** `apps/notify/src/commands/start.ts`
**Depends on:** T5, T6

Implement `/start` command handler:
- Check if user exists via `botService.getUserByChatId()`
- If new user: create user, send welcome message with command list
- If existing user: send welcome back message with filter count
- No conversation state needed (single-step command)

**Verify:** `pnpm typecheck` passes. Command can be instantiated with `TelegramClient` and `BotService`.

---

## T8: Implement HelpCommand

**File:** `apps/notify/src/commands/help.ts`
**Depends on:** T6

Implement `/help` command handler:
- Send message listing all commands with brief descriptions:
  - `/start` - Register or view your account
  - `/filter` - Create a new search filter
  - `/list` - View your active filters
  - `/edit <id>` - Edit an existing filter
  - `/delete <id>` - Delete a filter
  - `/pause` - Pause all notifications
  - `/resume` - Resume all notifications
  - `/help` - Show this help message

**Verify:** `pnpm typecheck` passes. Command sends formatted help text.

---

## T9: Implement ListCommand

**File:** `apps/notify/src/commands/list.ts`
**Depends on:** T5, T6

Implement `/list` command handler:
- Get user via `botService.getUserByChatId()`
- Fetch filters via `botService.getFilters(userId)`
- If no filters: suggest creating one with `/filter`
- If filters exist: format each filter (ID, name, criteria summary, enabled status)
- Send formatted list as Telegram message

**Verify:** `pnpm typecheck` passes. Command displays filter list correctly.

---

## T10: Implement PauseCommand

**File:** `apps/notify/src/commands/pause.ts`
**Depends on:** T5, T6

Implement `/pause` command handler:
- Get user via `botService.getUserByChatId()`
- Call `botService.pauseAllFilters(userId)`
- Send confirmation message: "Notifications paused. Send /resume to re-enable."

**Verify:** `pnpm typecheck` passes. All user filters set to `enabled = 0` in database.

---

## T11: Implement ResumeCommand

**File:** `apps/notify/src/commands/resume.ts`
**Depends on:** T5, T6

Implement `/resume` command handler:
- Get user via `botService.getUserByChatId()`
- Call `botService.resumeAllFilters(userId)`
- Send confirmation message: "Notifications resumed. You'll receive new listing alerts."

**Verify:** `pnpm typecheck` passes. All user filters set to `enabled = 1` in database.

---

## T12: Implement DeleteCommand

**File:** `apps/notify/src/commands/delete.ts`
**Depends on:** T5, T6

Implement `/delete <id>` command handler:
- Parse filter ID from args
- If no ID provided: send usage error "Usage: /delete <filter_id>"
- Get user via `botService.getUserByChatId()`
- Call `botService.deleteFilter(userId, filterId)`
- If deletion successful: send confirmation "Filter deleted."
- If filter not found: send error "Filter not found or you don't have permission."

**Verify:** `pnpm typecheck` passes. Only user's own filters can be deleted.

---

## T13: Implement FilterCommand (multi-step)

**File:** `apps/notify/src/commands/filter.ts`
**Depends on:** T4, T5, T6

Implement `/filter` command handler with multi-step flow:

1. `execute()`: Initialize conversation state with step='name', send prompt "Give it a name:"
2. `handleStateReply()` with state-based routing:
   - **step='name'**: Store name, advance to 'cities', send city selection prompt
   - **step='cities'**: Parse comma-separated cities, advance to 'price_min', send prompt
   - **step='price_min'**: Parse min price (or 'skip'), advance to 'price_max', send prompt
   - **step='price_max'**: Parse max price (or 'skip'), advance to 'rooms_min', send prompt
   - **step='rooms_min'**: Parse min bedrooms (or 'skip'), advance to 'rooms_max', send prompt
   - **step='rooms_max'**: Parse max bedrooms (or 'skip'), advance to 'keywords', send prompt
   - **step='keywords'**: Parse keywords (or 'skip'), call `botService.createFilter()`, clear state, send confirmation

3. Include helper methods:
   - `formatFilterSummary(data)`: Generate human-readable summary of filter criteria
   - Input validation for numeric fields (price, rooms must be positive numbers)

**Verify:** `pnpm typecheck` passes. Full filter creation flow works end-to-end. State persists between messages and expires after 10 minutes.

---

## T14: Implement EditCommand (multi-step)

**File:** `apps/notify/src/commands/edit.ts`
**Depends on:** T4, T5, T6

Implement `/edit <id>` command handler:

1. `execute()`: Parse filter ID, fetch existing filter, initialize state with current values, send "Editing filter X. Send new name or 'skip':"
2. `handleStateReply()`: Similar flow to FilterCommand but pre-populate with existing values
3. On completion: update filter via `botService.updateFilter()`, clear state, send confirmation

**Note:** For v1, edit can re-use the same multi-step flow as create. Future enhancement: allow editing individual fields.

**Verify:** `pnpm typecheck` passes. Filter updates correctly in database.

---

## T15: Implement CommandRouter

**File:** `apps/notify/src/commands/router.ts`
**Depends on:** T7-T14

Implement command routing logic:
- Constructor: Initialize map of command strings to handler instances
- `route(message)`:
  1. Check if user has active conversation state via `stateManager.getState()`
  2. If state exists: route to handler's `handleStateReply()` method
  3. If no state: parse command from message text, route to handler's `execute()` method
  4. If command not found: send "Unknown command. Send /help"

**Verify:** `pnpm typecheck` passes. Router correctly dispatches commands and conversation state replies.

---

## T16: Implement webhook handler

**File:** `apps/notify/src/webhook/handler.ts`
**Depends on:** T15

Implement `handleWebhook()` function:
1. Validate `X-Telegram-Bot-Api-Secret-Token` header against `env.TELEGRAM_WEBHOOK_SECRET`
2. Return 403 if invalid
3. Parse request body as `TelegramUpdate`
4. Extract `message` from update (ignore non-text messages)
5. Initialize dependencies (db, telegram, stateManager, botService, commandRouter)
6. Call `commandRouter.route(message)`
7. Return 200 OK to Telegram
8. Catch errors and return 500 (log error for debugging)

**Verify:** `pnpm typecheck` passes. Webhook validates secret token and routes messages.

---

## T17: Update notify worker entry point

**File:** `apps/notify/src/index.ts`
**Depends on:** T16

Add `fetch()` handler to worker export:
- Check if `pathname === '/webhook'` and `method === 'POST'`
- Call `handleWebhook(request, env)`
- Return 404 for all other routes
- Keep existing `scheduled()` handler unchanged

Add `TELEGRAM_WEBHOOK_SECRET` to `Env` interface.

**Verify:** `pnpm typecheck` passes. Worker exports both `scheduled` and `fetch` handlers.

---

## T18: Add BotService method: updateFilter

**File:** `apps/notify/src/bot-service.ts`
**Depends on:** T5

Add `updateFilter(userId, filterId, data)` method to `BotService`:
- UPDATE filters SET (all fields) WHERE id = ? AND user_id = ?
- Return boolean indicating success
- Verify user_id matches to prevent cross-user updates

**Verify:** `pnpm typecheck` passes. Filter can be updated.

---

## T19: Add wrangler.json configuration for webhook secret

**File:** `apps/notify/wrangler.json`
**Depends on:** None

Add placeholder for `TELEGRAM_WEBHOOK_SECRET` in wrangler.json (or document that it must be set via `wrangler secret put`):

```json
{
  "vars": {
    "TELEGRAM_WEBHOOK_SECRET": "PLACEHOLDER_SET_VIA_WRANGLER_SECRET"
  }
}
```

**Note:** The actual secret value must be set via:
```bash
wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production
```

**Verify:** Configuration documented. Secret can be accessed via `env.TELEGRAM_WEBHOOK_SECRET` in worker.

---

## T20: Create webhook registration script

**File:** `scripts/setup-webhook.ts`
**Depends on:** None

Create a Node.js script to register the webhook with Telegram:
- Read `TELEGRAM_BOT_TOKEN` and `WEBHOOK_URL` from environment
- Call `https://api.telegram.org/bot<token>/setWebhook`
- Send POST with `{ url, secret_token }` payload
- Log response (success or error)

Add to `package.json` scripts:
```json
{
  "scripts": {
    "setup-webhook": "tsx scripts/setup-webhook.ts"
  }
}
```

**Verify:** Script runs successfully. Telegram confirms webhook is set.

---

## T21: Add local development webhook endpoint

**File:** `apps/notify/src/index.ts`
**Depends on:** T17

For local development, add a `GET /webhook` endpoint that triggers a test update:
- Construct a fake `TelegramUpdate` with a `/start` message
- Pass to `handleWebhook()` for testing
- Return response with "Test update processed"

This allows testing webhook logic locally without ngrok.

**Verify:** `curl http://localhost:8787/webhook` triggers test message processing.

---

## T22: Add unit tests for BotService

**File:** `apps/notify/src/__tests__/bot-service.test.ts`
**Depends on:** T5

Test cases:
1. `getUserByChatId()` returns user if exists, null if not
2. `createUser()` inserts new user and returns it
3. `getFilterCount()` returns correct count
4. `createFilter()` inserts filter with correct JSON serialization
5. `deleteFilter()` only deletes if user_id matches
6. `pauseAllFilters()` sets all user's filters to enabled=0
7. `resumeAllFilters()` sets all user's filters to enabled=1

Use in-memory D1 database for testing (wrangler provides this).

**Verify:** All tests pass. `pnpm test` exits 0.

---

## T23: Add unit tests for command handlers

**File:** `apps/notify/src/commands/__tests__/commands.test.ts`
**Depends on:** T7-T14

Test cases:
1. **StartCommand**: new user gets welcome, existing user sees filter count
2. **HelpCommand**: sends help text
3. **ListCommand**: shows filters, handles empty state
4. **PauseCommand**: pauses filters, sends confirmation
5. **ResumeCommand**: resumes filters, sends confirmation
6. **DeleteCommand**: deletes filter, validates ownership
7. **FilterCommand**: multi-step flow creates filter with all fields
8. **EditCommand**: multi-step flow updates existing filter

Mock `TelegramClient`, `BotService`, and `ConversationStateManager`.

**Verify:** All tests pass. `pnpm test` exits 0.

---

## T24: Add integration test for webhook flow

**File:** `apps/notify/src/__tests__/webhook.test.ts`
**Depends on:** T16

Test cases:
1. Webhook validates secret token (403 on mismatch)
2. Webhook ignores non-text messages (200 OK, no action)
3. Webhook routes `/start` to StartCommand
4. Webhook routes unknown commands to error message
5. Webhook handles conversation state correctly (multi-step flow)

Use test D1 database and mock Telegram API calls.

**Verify:** All tests pass. Webhook processes updates end-to-end.

---

## T25: Update ROADMAP.md

**File:** `.specs/project/ROADMAP.md`
**Depends on:** T1-T24 complete

Update roadmap to mark "Telegram Bot Commands" as IN PROGRESS or DONE (depending on completion status).

**Verify:** ROADMAP.md reflects current project status.

---

## T26: Update STATE.md with implementation notes

**File:** `.specs/project/STATE.md`
**Depends on:** T1-T24 complete

Add decision record for conversation state storage choice (D1 vs KV).
Add any lessons learned during implementation.

**Verify:** STATE.md updated with relevant context for future sessions.

---

## Implementation Order

```
Phase 1: Database & Types (parallel)
T1 (migration) ──┐
T2 (types)       ├──▶ T3 (extend TelegramClient)
                 │
                 ├──▶ T4 (ConversationStateManager)
                 │
                 └──▶ T5 (BotService) ──▶ T18 (updateFilter)

Phase 2: Command Handlers (depends on Phase 1)
T6 (interfaces) ──┐
                  ├──▶ T7 (StartCommand)
                  ├──▶ T8 (HelpCommand)
                  ├──▶ T9 (ListCommand)
                  ├──▶ T10 (PauseCommand)
                  ├──▶ T11 (ResumeCommand)
                  ├──▶ T12 (DeleteCommand)
                  ├──▶ T13 (FilterCommand)
                  └──▶ T14 (EditCommand)

Phase 3: Routing & Integration (depends on Phase 2)
T15 (CommandRouter) ──▶ T16 (webhook handler) ──▶ T17 (worker entry point)

Phase 4: Configuration & Tooling (can run in parallel with Phase 1-3)
T19 (wrangler config)
T20 (webhook setup script)
T21 (local dev endpoint)

Phase 5: Testing (depends on Phase 3)
T22 (BotService tests)
T23 (command tests)
T24 (webhook integration tests)

Phase 6: Documentation (depends on all above)
T25 (update ROADMAP)
T26 (update STATE)
```

**Critical path:** T1 → T5 → T6 → T7-T14 → T15 → T16 → T17

**Parallelizable tasks:**
- T1, T2, T19, T20 can all start immediately
- T7-T14 can run in parallel after T6 completes
- T22-T24 can run in parallel after T17 completes

---

## Estimated Complexity

- **Simple tasks (1-2 hours):** T1, T2, T7, T8, T9, T10, T11, T12, T19, T20, T25, T26
- **Medium tasks (3-4 hours):** T3, T4, T5, T6, T15, T16, T17, T18, T21, T22, T23
- **Complex tasks (5-8 hours):** T13, T14, T24

**Total estimated effort:** ~50-70 hours (full implementation + testing)

---

## Manual Setup Steps (Post-Implementation)

After all tasks complete, the following manual steps are required:

1. **Apply database migration:**
   ```bash
   wrangler d1 migrations apply rentifier --remote
   ```

2. **Set webhook secret:**
   ```bash
   wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production
   # Enter a random secure token (e.g., generated via `openssl rand -hex 32`)
   ```

3. **Deploy notify worker:**
   ```bash
   pnpm --filter @rentifier/notify deploy
   ```

4. **Register webhook with Telegram:**
   ```bash
   TELEGRAM_BOT_TOKEN=<your-token> \
   WEBHOOK_URL=https://notify.rentifier.workers.dev/webhook \
   TELEGRAM_WEBHOOK_SECRET=<same-token-as-step-2> \
   pnpm setup-webhook
   ```

5. **Test webhook:**
   - Send `/start` to the bot on Telegram
   - Verify welcome message is received
   - Check D1 database for new user record

6. **Create a test filter:**
   - Send `/filter` to the bot
   - Complete the multi-step flow
   - Verify filter is saved in database
   - Check that notify worker matches listings against the filter (wait for cron trigger)
