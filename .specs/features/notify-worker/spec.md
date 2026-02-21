# Notify Worker Specification

## Problem Statement

Once canonical listings exist, users need to be notified about new matches. The notify worker runs on a short cron cycle, finds listings that match user filters and haven't been sent yet, formats a Telegram message, sends it, and records the send to prevent duplicates. For M1, there is a single user (the developer) with a hardcoded chat_id.

## Goals

- [ ] Cron-triggered worker that matches new listings against user filters
- [ ] Sends formatted Telegram messages for each match
- [ ] Tracks sent notifications to guarantee no duplicate sends
- [ ] Works for a single user in M1, extensible to multi-user in M3

## Out of Scope

- Multi-user registration or Telegram bot commands (deferred to M3)
- WhatsApp or email notification channels
- Notification batching / digest mode (send individual messages for now)
- Rich media in messages (images, inline buttons beyond "Open Link")

---

## User Stories

### P1: Find Unsent Matches

**User Story**: As the notify worker, I want to find new listings matching user filters that haven't been sent yet so that users are notified exactly once per matching listing.

**Why P1**: The core purpose of the notify worker.

**Acceptance Criteria**:

1. WHEN the notify worker runs THEN it SHALL query all enabled filters for all users
2. WHEN a filter specifies `max_price = 5000` and a listing has `price = 4500` THEN the listing SHALL match
3. WHEN a filter specifies `min_bedrooms = 3` and a listing has `bedrooms = 2` THEN the listing SHALL NOT match
4. WHEN a filter specifies `cities_json = ["תל אביב"]` and a listing has `city = "תל אביב"` THEN it SHALL match
5. WHEN a filter specifies `keywords_json = ["מרוהטת"]` and the listing description contains "מרוהטת" THEN it SHALL match
6. WHEN a matching listing already has a row in `notifications_sent` for that user THEN it SHALL be excluded from results
7. WHEN a listing has null price and the filter specifies a price range THEN the listing SHALL NOT match (null fails range checks)

**Independent Test**: Create a user with a filter, insert a matching listing — verify it appears as unsent. Insert `notifications_sent` row — verify it no longer appears.

---

### P1: Send Telegram Notification

**User Story**: As the notify worker, I want to send a formatted Telegram message for each match so that the user sees listing details in their chat.

**Why P1**: The notification is the user-facing output of the entire system.

**Acceptance Criteria**:

1. WHEN a match is found THEN the worker SHALL send a Telegram message via `POST https://api.telegram.org/bot<token>/sendMessage`
2. WHEN formatting the message THEN it SHALL include: title, price (formatted with currency), bedrooms, city/neighborhood, and a link to the original listing
3. WHEN the Telegram API returns success THEN `notifications_sent` SHALL be inserted with `(user_id, listing_id, sent_at, channel='telegram')`
4. WHEN the Telegram API returns an error (rate limit, network) THEN the notification SHALL NOT be recorded as sent (will retry on next cron run)
5. WHEN the bot token is required THEN it SHALL be read from Cloudflare secrets (not hardcoded)

**Independent Test**: Mock the Telegram API, run the notify worker with a matching listing — verify the API was called with the correct message format and `notifications_sent` was recorded.

---

### P1: Idempotent Notification Tracking

**User Story**: As the notify worker, I want `notifications_sent` to guarantee uniqueness per `(user_id, listing_id)` so that re-running the worker never sends duplicates.

**Why P1**: Duplicate notifications are the most common user complaint in notification systems.

**Acceptance Criteria**:

1. WHEN a notification is sent THEN `INSERT INTO notifications_sent (user_id, listing_id, sent_at, channel) VALUES (?, ?, ?, ?)` SHALL succeed
2. WHEN the same `(user_id, listing_id)` is inserted again THEN the insert SHALL be silently ignored (ON CONFLICT DO NOTHING)
3. WHEN the worker crashes after sending but before recording THEN the next run SHALL re-send (acceptable trade-off: occasional duplicate is better than missed notification)

**Independent Test**: Call the send+record flow twice for the same listing — verify only one `notifications_sent` row and only one Telegram API call on the second run.

---

### P2: Message Formatting

**User Story**: As a user, I want Telegram messages to be well-formatted and readable so that I can quickly decide if a listing is worth viewing.

**Why P2**: Important for UX but the system works with basic text initially.

**Acceptance Criteria**:

1. WHEN a message is formatted THEN it SHALL use Telegram's MarkdownV2 or HTML parse mode
2. WHEN price is present THEN it SHALL be displayed as "₪4,500/month" (localized)
3. WHEN bedrooms is present THEN it SHALL be displayed as "3 rooms" / "3 חדרים"
4. WHEN a listing URL is present THEN it SHALL be a clickable link
5. WHEN optional fields (neighborhood, tags) are present THEN they SHALL be included; if absent, omitted (no "N/A")

**Independent Test**: Format a listing with all fields, format one with missing fields — verify output is readable and correct.

---

## Edge Cases

- WHEN a user has no enabled filters THEN the worker SHALL skip that user without error
- WHEN a listing matches multiple filters for the same user THEN only ONE notification SHALL be sent (dedup by `(user_id, listing_id)`)
- WHEN the Telegram rate limit is hit (30 messages/second) THEN the worker SHALL stop sending and let the next cron run continue
- WHEN a user's `telegram_chat_id` is invalid THEN the Telegram API error SHALL be logged and that user skipped
- WHEN there are 0 new matches THEN the worker SHALL exit cleanly with no messages sent

---

## Success Criteria

- [ ] New matching listings trigger Telegram notifications within the cron interval (5 minutes)
- [ ] No duplicate notifications are ever sent for the same (user, listing) pair
- [ ] Telegram messages are formatted with price, rooms, location, and link
- [ ] Bot token is stored as a Cloudflare secret, never in code
- [ ] Worker handles Telegram API errors gracefully without crashing
