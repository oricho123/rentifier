# Telegram Bot Commands — Specification

## Overview

Implement an interactive Telegram bot that allows users to register, create and manage rental listing filters, and control their notification preferences. The bot responds to commands via webhook and stores user data in the existing D1 database schema.

## Background

The current system can fetch listings from Yad2 and process them into the `listings` table, but there's no way for users to interact with the system. The notify worker runs on a cron schedule but has no registered users or active filters to match against. We need to build the interactive Telegram bot layer that allows users to:

1. Register their Telegram chat ID
2. Create filters with criteria (price, rooms, cities, neighborhoods, keywords)
3. View, edit, and delete their filters
4. Pause and resume notifications

The database schema already includes `users`, `filters`, and `notifications_sent` tables. The notify worker already has a `TelegramClient` class for sending messages. We need to add:
- A webhook handler for receiving Telegram updates
- Command routing and processing logic
- Filter CRUD operations
- User registration flow

## Requirements

### Functional

**User Registration (FR1)**
1. Users send `/start` to the bot
2. Bot welcomes them and explains available commands
3. Bot creates a user record with their `telegram_chat_id` and `display_name` (Telegram first_name + last_name)
4. If user already exists, bot acknowledges and shows their current filter count

**Filter Management (FR2)**
5. Users send `/filter` to begin creating a new filter
6. Bot guides users through a conversational flow to set filter criteria:
   - Filter name (required)
   - Cities (multi-select from a predefined list: Tel Aviv, Jerusalem, Haifa, Herzliya, etc.)
   - Price range (min/max in ILS per month)
   - Room count range (min/max bedrooms)
   - Neighborhoods (optional text input, comma-separated)
   - Keywords (optional text input, comma-separated)
   - Tags to include (optional: "has-images", "new", "renovated", etc.)
   - Tags to exclude (optional)
7. Bot saves the filter to the database with `enabled = 1`
8. Bot confirms filter creation with a summary

**Filter Listing (FR3)**
9. Users send `/list` to see all their active filters
10. Bot displays each filter's name, criteria summary, and ID
11. If no filters exist, bot suggests creating one with `/filter`

**Filter Editing (FR4)**
12. Users send `/edit <filter_id>` to modify an existing filter
13. Bot shows current criteria and allows users to change any field
14. Bot updates the filter in the database
15. Bot confirms the update

**Filter Deletion (FR5)**
16. Users send `/delete <filter_id>` to remove a filter
17. Bot asks for confirmation
18. Bot deletes the filter from the database
19. Bot confirms deletion

**Notification Control (FR6)**
20. Users send `/pause` to disable all their filters (set `enabled = 0`)
21. Bot confirms notifications are paused
22. Users send `/resume` to re-enable all filters (set `enabled = 1`)
23. Bot confirms notifications are resumed

**Help (FR7)**
24. Users send `/help` to see command list and usage examples
25. Bot displays all available commands with brief descriptions

### Non-Functional

**NFR1: Webhook-based updates**
- The bot must receive Telegram updates via webhook (not polling) to work within Cloudflare Workers environment
- Webhook endpoint: `POST /webhook` on the notify worker
- Telegram will send updates for all incoming messages and commands

**NFR2: Conversational state management**
- Multi-step flows (like `/filter`) require maintaining conversation state between messages
- State can be stored in D1 with a `conversation_state` table or in Cloudflare KV (ephemeral, TTL-based)
- State should expire after 10 minutes of inactivity

**NFR3: Input validation**
- Price and room ranges must be positive numbers
- Cities must match a predefined list (to avoid free-text typos)
- Filter names must be unique per user (max 50 chars)
- Chat IDs must be valid Telegram chat IDs (numeric string)

**NFR4: Security**
- Webhook must validate Telegram updates using the bot token (check `X-Telegram-Bot-Api-Secret-Token` header or validate update authenticity)
- Users can only access their own filters (no cross-user data leaks)

**NFR5: Error handling**
- If a command fails, bot sends a friendly error message
- If the database is unavailable, bot responds with "Service temporarily unavailable"
- Invalid command arguments trigger usage help

**NFR6: Performance**
- Command processing must complete within Cloudflare Workers 30s wall-clock limit
- Filter creation should complete in <3 seconds (user perceives as instant)

### Configuration

**Cities list**
- Predefined list of Israeli cities supported by Yad2 connector: Tel Aviv, Jerusalem, Haifa, Herzliya, Ramat Gan, Givatayim, Beer Sheva, Netanya, Rishon LeZion, Petah Tikva
- Displayed as inline keyboard buttons during filter creation

**Tags list**
- Supported tags: "has-images", "new", "renovated", "needs-renovation", "ground-floor", "high-floor", "penthouse", "garden-apartment"
- Displayed as inline keyboard buttons during filter creation

**Webhook setup**
- Registered via Telegram Bot API: `setWebhook` endpoint
- Webhook URL format: `https://notify.rentifier.workers.dev/webhook`
- Must be HTTPS (Cloudflare Workers provides this by default)

## Out of Scope

- Editing individual filter fields (v1 supports full filter edit only)
- Filter templates or presets
- Sharing filters between users
- Geo-polygon or map-based filtering
- AI-powered filter suggestions
- Filter performance analytics
- Notification frequency throttling (handled by notify worker cron schedule)
- Multi-language support (Hebrew UI is out of scope; English only for v1)

## Constraints

- Must run within Cloudflare Workers (no long-polling; webhook only)
- Must use existing D1 database schema (tables: `users`, `filters`, `notifications_sent`)
- Must reuse existing `TelegramClient` class for sending messages
- Conversational state storage must fit within D1 or KV free tier limits
- Bot token must be stored as a Cloudflare secret (`TELEGRAM_BOT_TOKEN`)

## Success Criteria

- User can run `/start` and see a welcome message
- User can create a filter with `/filter` and receive a confirmation
- User can list filters with `/list` and see their active filters
- User can delete a filter with `/delete <id>` and receive confirmation
- User can pause/resume notifications with `/pause` and `/resume`
- Filter matches are logged in `notifications_sent` table (tested manually by creating a filter and waiting for matching listings)
- Webhook receives and processes Telegram updates correctly (verified via Telegram Bot API test messages)
- All commands complete within 3 seconds (user-perceivable instant response)

## Dependencies

- Telegram Bot API (external service)
- Existing `users` and `filters` tables in D1
- Existing `TelegramClient` class in notify worker
- Bot token configured as Cloudflare secret
- Webhook registered via `setWebhook` API call (manual setup step)

## Acceptance Tests

1. **User Registration**: Send `/start` → receive welcome message, user record created in DB
2. **Filter Creation**: Send `/filter` → complete flow → filter saved with all criteria
3. **Filter Listing**: Send `/list` → see all active filters with summaries
4. **Filter Deletion**: Send `/delete 1` → confirm → filter removed from DB
5. **Pause Notifications**: Send `/pause` → all filters set to `enabled = 0`
6. **Resume Notifications**: Send `/resume` → all filters set to `enabled = 1`
7. **Invalid Command**: Send `/unknown` → receive error message with `/help` suggestion
8. **Concurrent Users**: Two users create filters simultaneously → both succeed, no cross-user data
9. **State Expiry**: Start `/filter` flow, wait 10 minutes, send next message → state expired, flow restarted
10. **Webhook Validation**: Send invalid update payload → webhook rejects with 403
