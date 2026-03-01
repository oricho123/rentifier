# Handoff: Yad2 Radware Block Fix — GitHub Actions Scraper

**Date:** 2026-03-01
**PRs:** #18 (fix), #19 (docs + local dev)
**Status:** ✅ Merged to main

---

## Problem

The Yad2Connector running inside Cloudflare Workers (AS13335) is hard-blocked by Radware Bot Manager on yad2.co.il. This is not a header/cookie issue — the entire ASN is flagged. Every request from a Worker returns either a 200 with captcha HTML or a 403.

**Why it works locally:** `wrangler dev` routes outbound requests through the developer's local machine IP, which is not flagged.

**What made it worse:** During investigation, `mobile-app: false` and `mainsite: true` headers were temporarily added. These caused a regression from 200+captcha to 403 and were reverted.

**Evidence from source_state:**
- `lastFetchedAt: 2026-02-28T06:01:02Z` — last successful fetch was the day before
- `consecutiveFailures: 5` — circuit breaker tripped
- `circuitOpenUntil: 2026-03-01T14:01:00Z` — Worker was skipping yad2 entirely

---

## Solution

Move yad2 scraping from Cloudflare Workers to GitHub Actions. GitHub runner IPs are not flagged by Radware.

### Architecture

```
GitHub Actions cron (*/30 * * * *)
  ↓
scripts/collect-yad2.ts  (tsx + @rentifier/connectors)
  ↓ D1 REST API
Cloudflare D1  (source_state cursor + listings_raw)
  ↑
Processor + Notify Workers (unchanged)
```

**Single writer:** Only GitHub Actions writes yad2 cursor state in production. The Collector Worker no longer touches it.

---

## Files Changed

### New Files
| File | Purpose |
|------|---------|
| `scripts/collect-yad2.ts` | Standalone yad2 scraper: reads cursor from D1 REST API, calls `Yad2Connector.fetchNew()`, writes candidates + new cursor back |
| `.github/workflows/collect-yad2.yml` | Cron every 30 min + `workflow_dispatch` for manual testing |

### Modified Files
| File | Change |
|------|--------|
| `apps/collector/src/registry.ts` | Yad2Connector removed from default registry; conditionally registered when `ENABLE_YAD2_CONNECTOR=true` |
| `apps/collector/src/collector.ts` | Pass `env` to `createDefaultRegistry(env)` |
| `apps/collector/src/index.ts` | Add `ENABLE_YAD2_CONNECTOR?: string` to `Env` interface |
| `packages/connectors/src/yad2/constants.ts` | Revert bad headers (`mobile-app`, `mainsite`); add commented alternative endpoint list |
| `README.md` | Updated architecture diagram, cron table, local dev instructions |
| `.specs/features/m2-yad2-production-readiness/spec.md` | Radware risk marked resolved; GitHub Actions Scraper section added |
| `.specs/features/m2-yad2-production-readiness/design.md` | Post-implementation section: AS13335 block explanation, single-writer constraint |

### Local Dev Only (gitignored, not committed)
| File | Content |
|------|---------|
| `apps/collector/.dev.vars` | `ENABLE_YAD2_CONNECTOR=true` |

---

## Required Setup (Production)

Three GitHub Actions secrets must be set (repo → Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `CF_API_TOKEN` | CF token with **D1:Edit** permission |
| `CF_D1_DATABASE_ID` | D1 database ID (`554a9f64-3cfb-4e27-b83c-0f92907c8794`) |

---

## Remaining Deployment Steps

- [ ] Add the 3 GitHub Actions secrets above (if not done)
- [ ] Deploy updated Collector Worker (removes yad2 from Worker cron):
  ```bash
  cd apps/collector && pnpm exec wrangler deploy
  ```
- [ ] Verify first GitHub Actions run succeeds:
  - GitHub → Actions → "Collect Yad2 Listings" → check logs
  - Look for `{"event":"collect_complete","candidateCount":N}` with N > 0

---

## Local Development

To enable yad2 scraping locally (`wrangler dev`):

```bash
echo "ENABLE_YAD2_CONNECTOR=true" > apps/collector/.dev.vars
```

This file is gitignored — each developer creates it manually.

---

## Known State at Handoff

- `listings_raw` is populated with data from **Feb 28** (last successful Worker fetch before block)
- Circuit breaker was open; Worker was skipping yad2 on every cron run
- GitHub Actions workflow has never run yet — first run will happen after secrets are set
- Processor + Notify Workers are unaffected and working normally

---

## What Was NOT Changed

- No changes to Processor or Notify Workers
- No changes to D1 schema or migrations
- No changes to `Yad2Connector` business logic (circuit breaker, retry, cursor, city rotation)
- `pnpm-lock.yaml` unchanged (no new dependencies introduced)

---

## Next Session Starting Point

1. Confirm GitHub Actions secrets are set
2. Trigger `workflow_dispatch` and verify `collect_complete` log
3. Monitor circuit breaker status in source_state — it should reset after first successful GitHub Actions run
4. If yad2 is still returning 403 from GitHub Actions (unlikely), try alternative endpoints documented in `constants.ts` comments
