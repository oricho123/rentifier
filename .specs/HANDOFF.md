# Handoff

**Date:** 2026-03-03
**Feature:** Facebook Playwright Migration
**Task:** Prototype validated, ready for full implementation

## Completed ✓

- Playwright prototype validated against live Facebook DOM (9 posts from 3 groups in ~30s)
- Validated DOM selectors:
  - Content: `[data-ad-rendering-role="story_message"]` (100% hit rate)
  - Author: `[data-ad-rendering-role="profile_name"] h2` (100%, strip " · Follow" suffix)
  - Post ID: `pcb.{postId}` from photo link hrefs (78% — text-only posts lack photo links)
  - Images: `img[src*="scontent"]` skip width < 100 (67% — expected for text-only posts)
- Confirmed: timestamps NOT in feed DOM — use `new Date().toISOString()` as fetch time
- Confirmed: tsx `page.evaluate()` must use string-based form (not callbacks) to avoid `__name` injection
- Updated `.specs/features/facebook-playwright/design.md` with validated selectors and extraction rates
- Playwright added as dependency (`packages/connectors` + root workspace devDep)
- Prototype script at `scripts/facebook-playwright-prototype.ts`

## In Progress

- Nothing active

## Pending

- Full Playwright connector implementation (Phase 1-5 in `.specs/features/facebook-playwright/tasks.md`):
  - Phase 1: `selectors.ts`, `parseCookieString()` in accounts.ts
  - Phase 2: Browser lifecycle, DOM extraction in rewritten `client.ts`
  - Phase 3: Update `FacebookConnector`, clean types/constants, rewrite tests
  - Phase 4: Update GitHub Actions workflow (add Playwright install step)
  - Phase 5: Update docs
- Pending specs from roadmap: facebook-pagination, ai-extraction, brokerage-detection, sublet-rent-classification

## Blockers

- None

## Context

- Branch: main
- Uncommitted files:
  - `.specs/features/facebook-playwright/` (spec, design, tasks)
  - `scripts/facebook-playwright-prototype.ts` (validated prototype)
  - `packages/connectors/package.json` (playwright dependency)
  - `requirements.txt`, `scripts/collect-facebook-python.ts`, `scripts/facebook-scraper-wrapper.py` (Python scraper experiment — can be deleted)
- Key insight: Facebook blocks all raw HTTP clients; only real browser engines work
- Design doc has full architecture, selectors, error handling, and migration path
