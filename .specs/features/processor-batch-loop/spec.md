# Processor: Process All Unprocessed Items

**Feature:** Allow processor to loop until all unprocessed items are handled
**Status:** Specified
**Created:** 2026-02-22
**Priority:** Optional Enhancement

## Problem Statement

Currently, the processor processes exactly 50 items per cron trigger, even if 200+ items are waiting. This means:
- With 200 items waiting, it takes 4 cron cycles (4 × 15 min = 60 minutes) to process all
- Users see a lag between collector fetching data and processor finishing

## Proposed Solution

Add a `PROCESS_ALL` mode that loops until no unprocessed items remain:

```typescript
export default {
  async scheduled(event, env, ctx) {
    const db = createDB(env.DB);
    const batchSize = env.BATCH_SIZE ? parseInt(env.BATCH_SIZE, 10) : 50;
    const processAll = env.PROCESS_ALL === 'true';

    let totalProcessed = 0;
    let totalFailed = 0;

    do {
      const result = await processBatch(db, batchSize);
      totalProcessed += result.processed;
      totalFailed += result.failed;

      if (!processAll || result.processed === 0) break;
    } while (true);

    console.log({ totalProcessed, totalFailed });
  }
}
```

## Trade-offs

**Pros:**
- Faster end-to-end latency (collector → processor → notify)
- Single cron run handles backlog

**Cons:**
- Could exceed CPU time limits on large backlogs
- Less predictable execution time

## Recommendation

**Keep current design** unless you're seeing user-facing latency issues. The batched approach is:
- Safer (won't timeout)
- More predictable
- Still fast enough (15-minute processing lag is acceptable for rental listings)

If you DO need faster processing:
1. Increase `BATCH_SIZE` to 100-200 (safer)
2. OR reduce cron frequency (every 5 min instead of 15 min)
3. AVOID `PROCESS_ALL` unless you have CPU limit headroom

## Out of Scope
- Parallel processing (would require multiple workers or queue system)
- Streaming/incremental processing
