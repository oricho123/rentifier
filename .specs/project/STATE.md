# State

**Last Updated:** 2026-02-21
**Current Work:** Project initialization - Planning phase

---

## Recent Decisions (Last 60 days)

### AD-001: Cloudflare as sole infrastructure provider (2026-02-21)

**Decision:** Use Cloudflare Workers + D1 + Cron Triggers + KV for all compute, storage, and scheduling.
**Reason:** Generous free tier covers projected usage; single-vendor simplicity reduces operational overhead for a solo developer.
**Trade-off:** Locked into Cloudflare's runtime constraints (10ms CPU per request on free tier, D1's SQLite dialect). Migration to another platform would require rewriting worker entry points and DB layer.
**Impact:** All three services (collector, processor, notify) are Cloudflare Workers with separate `wrangler.toml` configs.

### AD-002: TypeScript monorepo with pnpm workspaces (2026-02-21)

**Decision:** Structure the project as a monorepo with shared packages rather than separate repos or a single flat app.
**Reason:** Shared types, DB schema, connector interfaces, and extraction logic across three workers. Monorepo keeps everything in sync without publishing packages.
**Trade-off:** Slightly more complex initial setup; CI must handle selective deployment.
**Impact:** Repo structure uses `apps/` for workers and `packages/` for shared code.

### AD-003: YAD2 as first data source, Facebook deferred (2026-02-21)

**Decision:** Start with YAD2 instead of Facebook. Facebook connector deferred to M4.
**Reason:** Facebook scraping has significant legal (ToS) and technical (anti-bot) barriers. YAD2 is a more accessible starting point to prove the system works.
**Trade-off:** Facebook is arguably the richest source for Israeli rentals; deferring it delays full market coverage.
**Impact:** M2 focuses entirely on YAD2. Facebook connector research happens in M4 with proper legal consideration.

### AD-004: Rules-first extraction, AI as fallback (2026-02-21)

**Decision:** Use regex/rule-based extraction as the primary method. AI (Cloudflare Workers AI or similar) only for ambiguous cases.
**Reason:** Keeps costs at zero for the majority of listings. Structured sources like YAD2 may already provide parsed fields, reducing AI need further.
**Trade-off:** Rules require maintenance as source formats change; may miss nuanced listings.
**Impact:** `packages/extraction` implements a pipeline: rules first, confidence check, AI fallback if below threshold.

---

## Active Blockers

*None currently.*

---

## Lessons Learned

*None yet.*

---

## Preferences

**Model Guidance Shown:** never
