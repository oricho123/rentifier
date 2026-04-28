import type { CleanupOpts, CleanupResult, DB } from '@rentifier/db';

export async function runCleanup(db: DB, opts: CleanupOpts): Promise<CleanupResult> {
  if (!Number.isFinite(opts.retentionDays) || opts.retentionDays <= 0) {
    throw new Error(`Invalid retentionDays: ${opts.retentionDays}`);
  }
  if (!Number.isFinite(opts.batchSize) || opts.batchSize <= 0) {
    throw new Error(`Invalid batchSize: ${opts.batchSize}`);
  }
  if (!Number.isFinite(opts.maxDeletesPerRun) || opts.maxDeletesPerRun <= 0) {
    throw new Error(`Invalid maxDeletesPerRun: ${opts.maxDeletesPerRun}`);
  }

  const startedAt = Date.now();
  const result: CleanupResult = {
    listings_deleted: 0,
    listings_raw_deleted: 0,
    duplicates_deleted: 0,
    orphan_notifications_deleted: 0,
    capped: false,
    ms: 0,
  };

  let totalDeleted = 0;

  const runBatched = async (
    fn: (rd: number, bs: number) => Promise<number>,
  ): Promise<number> => {
    let acc = 0;
    while (totalDeleted < opts.maxDeletesPerRun) {
      const remaining = opts.maxDeletesPerRun - totalDeleted;
      const batch = Math.min(opts.batchSize, remaining);
      const deleted = await fn(opts.retentionDays, batch);
      acc += deleted;
      totalDeleted += deleted;
      if (deleted < batch) break;
    }
    if (totalDeleted >= opts.maxDeletesPerRun) {
      result.capped = true;
    }
    return acc;
  };

  result.duplicates_deleted = await runBatched((rd, bs) =>
    db.deleteOrphanedDuplicates(rd, bs),
  );
  result.listings_deleted = await runBatched((rd, bs) =>
    db.deleteOldListings(rd, bs),
  );
  result.listings_raw_deleted = await runBatched((rd, bs) =>
    db.deleteOldRawListings(rd, bs),
  );

  result.orphan_notifications_deleted = await db.deleteOrphanedNotifications();

  result.ms = Date.now() - startedAt;
  return result;
}
