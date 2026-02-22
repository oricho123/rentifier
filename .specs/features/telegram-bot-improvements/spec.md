# Feature Specification: Telegram Bot Improvements

**Status:** Specified
**Created:** 2026-02-22
**Milestone:** M3 - Multi-User & Filters

---

## Overview

Enhance the Telegram bot to feel more native, interactive, and localized for Israeli users. The bot currently works but feels basic—it uses English text, lacks interactive elements, and doesn't leverage Telegram's rich UX features.

---

## Problem Statement

**Current pain points:**

1. **Language barrier:** All bot text is in English, but the target audience is Israeli Hebrew speakers
2. **Poor discoverability:** Commands aren't visible in Telegram's native menu (BotCommands API not configured)
3. **Limited interactivity:** Minimal use of inline keyboards, callback queries, or interactive elements
4. **Basic UX:** Text-only flows feel dated compared to modern Telegram bots
5. **No quick actions:** Users must type commands manually; no quick-reply buttons or shortcuts

**User impact:**
- New users struggle to discover features
- Hebrew speakers find the bot awkward to use
- Multi-step flows feel tedious without visual aids
- Bot feels unprofessional compared to other Israeli rental services

---

## Goals

### Primary Goals

1. **Hebrew localization:** All bot messages in Hebrew with proper RTL support
2. **Native command menu:** Commands appear in Telegram's built-in menu (slash command autocomplete)
3. **Interactive flows:** Use inline keyboards, callback queries, and reply keyboards for common actions
4. **Better UX:** Visual hierarchy, emojis, formatted summaries, progress indicators

### Non-Goals

- Translation system / multi-language support (Hebrew only for now)
- Voice message support
- Image/photo handling
- Advanced analytics or usage tracking

---

## Requirements

### Functional Requirements

**FR-1: Hebrew Localization**
- All bot messages must be in Hebrew
- Support RTL text formatting
- Use appropriate Hebrew terminology for real estate (דירה, חדרים, מחיר, etc.)
- Maintain English for technical identifiers (filter IDs, error codes)

**FR-2: Telegram Bot Menu Integration**
- Configure BotCommands API via `setMyCommands` on bot startup
- Display all 7 commands with Hebrew descriptions
- Commands visible in Telegram's native command menu (type `/` to see list)

**FR-3: Interactive Filter Creation**
- Replace text-based multi-step flow with inline keyboard prompts
- Use callback queries for skip/confirm actions
- Show progress indicator during filter creation (e.g., "שלב 2 מתוך 6")
- Provide quick-reply buttons for common cities (תל אביב, ירושלים, חיפה, etc.)

**FR-4: Interactive List Management**
- `/list` shows filters with inline action buttons (✏️ ערוך, 🗑️ מחק)
- Callback queries handle filter edit/delete directly (no typing IDs)
- Confirmation prompts before deletion

**FR-5: Rich Message Formatting**
- Use bold, italic, code formatting appropriately
- Add relevant emojis consistently (🏠 for apartments, 💰 for price, 📍 for location)
- Format prices with thousands separators (5,000 ₪ not 5000)
- Use Telegram's HTML parsing mode

**FR-6: Quick Actions**
- Welcome message includes quick-action inline keyboard (➕ צור פילטר, 📋 רשימת פילטרים)
- `/pause` and `/resume` provide one-tap confirmation buttons
- Filter summary at end of creation includes "צור פילטר נוסף" button

### Non-Functional Requirements

**NFR-1: Backward Compatibility**
- Existing database schema unchanged
- Existing conversation state mechanism preserved
- API contract with Telegram unchanged (standard Bot API v7.0+)

**NFR-2: Performance**
- Callback query responses under 100ms (Telegram best practice)
- No additional database queries for UI rendering
- Inline keyboard JSON < 4KB per message

**NFR-3: Maintainability**
- Centralized Hebrew strings in a single constants file
- Reusable keyboard builders for common patterns
- Callback data format documented and versioned

---

## User Stories

**US-1: New user discovery**
> As a new Israeli user, I want to see available commands in Hebrew when I type `/`, so I can discover features without reading documentation.

**US-2: Filter creation without typing**
> As a user creating a filter, I want to click buttons instead of typing "skip" repeatedly, so the process feels faster and more modern.

**US-3: Managing filters visually**
> As a user with multiple filters, I want to edit or delete them by clicking buttons in the list, so I don't have to remember filter IDs.

**US-4: Understanding bot responses**
> As a Hebrew speaker, I want all bot messages in Hebrew, so I don't have to translate in my head.

**US-5: Quick filter creation**
> As a returning user, I want a "Create Filter" button in the welcome message, so I can start immediately without typing `/filter`.

---

## Acceptance Criteria

### Hebrew Localization
- ✅ All user-facing messages in Hebrew
- ✅ Command descriptions in Hebrew (via BotCommands API)
- ✅ Error messages in Hebrew
- ✅ Help text in Hebrew
- ✅ RTL formatting verified in Telegram desktop and mobile

### Command Menu
- ✅ Typing `/` shows 7 commands with Hebrew descriptions
- ✅ Menu configured on bot worker startup
- ✅ Menu persists across bot restarts

### Interactive Filter Creation
- ✅ Each filter creation step uses inline keyboard where applicable
- ✅ "דלג" (skip) button available for optional fields
- ✅ Common cities available as quick-select buttons
- ✅ Progress indicator shows current step (e.g., "שלב 3 מתוך 6")
- ✅ Validation errors show retry button

### Interactive List Management
- ✅ `/list` displays each filter with inline action buttons
- ✅ Edit button initiates filter editing flow
- ✅ Delete button shows confirmation prompt
- ✅ Confirmation includes filter name for safety
- ✅ No need to type filter IDs manually

### Rich Formatting
- ✅ Prices formatted with ₪ symbol and thousands separator
- ✅ Consistent emoji usage across all messages
- ✅ Bold used for emphasis (filter names, important values)
- ✅ Code formatting for technical identifiers if needed

### Quick Actions
- ✅ Welcome message has "צור פילטר" and "רשימת פילטרים" buttons
- ✅ Filter creation complete message has "צור פילטר נוסף" button
- ✅ Pause/resume commands show one-tap confirmation

---

## Edge Cases

**EC-1: Long filter lists**
- If user has >10 filters, paginate with "הבא"/"הקודם" buttons
- Callback data must fit within Telegram's 64-byte limit

**EC-2: Callback query timeouts**
- If callback query fails, fall back to command-based flow
- Show error message in Hebrew: "⚠️ הפעולה נכשלה, אנא נסה שוב"

**EC-3: Concurrent edits**
- If user starts editing two filters simultaneously, clear old conversation state
- Show warning: "הפעולה הקודמת בוטלה"

**EC-4: Hebrew text in inline keyboard buttons**
- Verify proper rendering across platforms (iOS, Android, Desktop, Web)
- Test with mixed Hebrew/English (e.g., "מחק Filter #3")

**EC-5: Callback data versioning**
- If callback format changes in future, old callbacks should gracefully degrade
- Include version prefix in callback data (e.g., `v1:delete:123`)

---

## Out of Scope

- Translation to other languages (English, Arabic, Russian)
- Voice message parsing for filter creation
- Location-based city selection (send location → auto-detect city)
- Inline query mode (typing `@rentifier_bot` in any chat)
- Payment integration for premium features
- Analytics dashboard for bot usage

---

## Dependencies

### Internal
- Existing `TelegramClient` class (apps/notify/src/telegram-client.ts)
- Existing command handlers (apps/notify/src/commands/*.ts)
- Conversation state manager (apps/notify/src/conversation-state.ts)
- BotService for database operations (apps/notify/src/bot-service.ts)

### External
- Telegram Bot API v7.0+ (already in use)
- No new third-party libraries required
- Cloudflare Workers runtime (no changes needed)

---

## Risks & Mitigations

**Risk 1: Hebrew text encoding issues**
- **Likelihood:** Low
- **Impact:** Medium
- **Mitigation:** UTF-8 is standard in Cloudflare Workers; test thoroughly with real Telegram clients

**Risk 2: Callback data size limits**
- **Likelihood:** Medium
- **Impact:** Medium
- **Mitigation:** Use short callback data format (e.g., `d:123` for delete filter 123); document max length

**Risk 3: Translation quality**
- **Likelihood:** Medium
- **Impact:** Low
- **Mitigation:** Get native Hebrew speaker to review all strings before deployment

**Risk 4: Inline keyboard complexity**
- **Likelihood:** Low
- **Impact:** Low
- **Mitigation:** Start simple (static keyboards), iterate based on user feedback

---

## Success Metrics

**Quantitative:**
- 90%+ of messages use inline keyboards vs pure text
- 100% of user-facing text in Hebrew
- Command menu configured and tested
- Filter creation time reduced by 30% (fewer manual text inputs)

**Qualitative:**
- Bot feels modern and responsive
- Users discover features without reading docs
- Hebrew speakers report improved experience
- Fewer "how do I..." support questions

---

## Future Enhancements

- Multi-language support (English, Russian, Arabic)
- Location-based city selection
- Inline query mode for sharing filters
- Voice message parsing for filter criteria
- Payment integration for premium features
- Rich media in listing notifications (photos, maps)
