# Handoff

**Date:** 2026-03-03
**Feature:** Facebook Playwright Migration + Extraction Improvements
**Task:** Implementation complete — PR #32 (7 commits)

## Completed ✓

- Full Playwright connector implementation (all 5 phases)
- E2E validated: 11-13 posts from 3 groups, dedup works, normalize works
- 210 tests passing, 0 typecheck errors
- Fixed Cloudflare Worker deploy: extracted `FacebookNormalizer` to prevent Playwright bundling in Workers
- Added `--local` flag for local E2E testing against local D1 database
- "See more" expansion: clicks all truncated post buttons before extraction
- Improved Hebrew extraction: `שכירות`/`שכ'ד` price prefix, `ב` prefix, `ת״א` city, `חד'` bedrooms, negation-aware tags
- Post ID extraction: 4 fallback strategies (timestamp links, group-specific URLs, broad numeric IDs, content hash)
- Known limitation: Sponsored/ad posts get `txt_` hash IDs (Facebook hides post IDs from DOM for sponsored content)
- PR #32 pushed with 7 commits

## In Progress

- Nothing active

## Pending

- Merge PR #32 after CI passes
- Monitor first few GitHub Actions cron runs for session stability
- Clean up exploration artifacts: `requirements.txt`, `scripts/collect-facebook-python.ts`, `scripts/facebook-scraper-wrapper.py`
- Pending specs from roadmap: facebook-pagination, ai-extraction, brokerage-detection, sublet-rent-classification

## Blockers

- None

## Context

- Branch: `feat/facebook-playwright` (PR #32, 7 commits)
- Facebook connector now runs ONLY from GitHub Actions (`scripts/collect-facebook.ts`), not from Cloudflare Worker
- Local testing: `set -a && source .env && set +a && pnpm collect:facebook:local`
- Sponsored posts get `txt_` hash IDs — Facebook intentionally hides post IDs from DOM for these posts
- CI workflow updated: Playwright chromium install step, timeout 5→10min
