import { describe, it, expect, vi } from 'vitest';
import type { DB } from '@rentifier/db';
import { runCleanup } from '../cleanup-service';

function makeDb(overrides: Partial<DB> = {}): DB {
  return {
    deleteOrphanedDuplicates: vi.fn().mockResolvedValue(0),
    deleteOldListings: vi.fn().mockResolvedValue(0),
    deleteOldRawListings: vi.fn().mockResolvedValue(0),
    deleteOrphanedNotifications: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as DB;
}

describe('runCleanup', () => {
  it('calls deletions in correct order: duplicates → listings → raw → orphan notifs', async () => {
    const calls: string[] = [];
    const db = makeDb({
      deleteOrphanedDuplicates: vi.fn().mockImplementation(async () => {
        calls.push('duplicates');
        return 0;
      }),
      deleteOldListings: vi.fn().mockImplementation(async () => {
        calls.push('listings');
        return 0;
      }),
      deleteOldRawListings: vi.fn().mockImplementation(async () => {
        calls.push('raw');
        return 0;
      }),
      deleteOrphanedNotifications: vi.fn().mockImplementation(async () => {
        calls.push('orphans');
        return 0;
      }),
    });

    await runCleanup(db, { retentionDays: 30, batchSize: 500, maxDeletesPerRun: 50_000 });

    expect(calls).toEqual(['duplicates', 'listings', 'raw', 'orphans']);
  });

  it('stops looping when a batch returns less than batchSize', async () => {
    const db = makeDb({
      deleteOldListings: vi.fn().mockResolvedValue(3),
    });

    const result = await runCleanup(db, {
      retentionDays: 30,
      batchSize: 500,
      maxDeletesPerRun: 50_000,
    });

    expect(result.listings_deleted).toBe(3);
    expect(db.deleteOldListings).toHaveBeenCalledTimes(1);
  });

  it('continues looping while batch is full (deleted == batchSize)', async () => {
    let i = 0;
    const db = makeDb({
      deleteOldListings: vi.fn().mockImplementation(async (_rd, bs) => {
        i++;
        return i < 3 ? bs : 0;
      }),
    });

    const result = await runCleanup(db, {
      retentionDays: 30,
      batchSize: 10,
      maxDeletesPerRun: 50_000,
    });

    expect(result.listings_deleted).toBe(20);
    expect(db.deleteOldListings).toHaveBeenCalledTimes(3);
  });

  it('marks result.capped=true when maxDeletesPerRun is reached', async () => {
    const db = makeDb({
      deleteOrphanedDuplicates: vi.fn().mockImplementation(async (_rd, bs) => bs),
    });

    const result = await runCleanup(db, {
      retentionDays: 30,
      batchSize: 100,
      maxDeletesPerRun: 250,
    });

    expect(result.capped).toBe(true);
    expect(result.duplicates_deleted).toBeGreaterThanOrEqual(250);
    expect(db.deleteOldListings).not.toHaveBeenCalled();
  });

  it('reduces final batch size to fit within maxDeletesPerRun', async () => {
    let lastBatchSeen = 0;
    const db = makeDb({
      deleteOrphanedDuplicates: vi.fn().mockImplementation(async (_rd, bs) => {
        lastBatchSeen = bs;
        return bs;
      }),
    });

    await runCleanup(db, { retentionDays: 30, batchSize: 100, maxDeletesPerRun: 250 });

    expect(lastBatchSeen).toBe(50);
  });

  it('throws on retentionDays <= 0', async () => {
    const db = makeDb();
    await expect(
      runCleanup(db, { retentionDays: 0, batchSize: 500, maxDeletesPerRun: 50_000 }),
    ).rejects.toThrow(/retentionDays/);
  });

  it('throws on non-finite retentionDays', async () => {
    const db = makeDb();
    await expect(
      runCleanup(db, { retentionDays: NaN, batchSize: 500, maxDeletesPerRun: 50_000 }),
    ).rejects.toThrow(/retentionDays/);
  });

  it('throws on batchSize <= 0', async () => {
    const db = makeDb();
    await expect(
      runCleanup(db, { retentionDays: 30, batchSize: 0, maxDeletesPerRun: 50_000 }),
    ).rejects.toThrow(/batchSize/);
  });

  it('records elapsed ms', async () => {
    const db = makeDb();
    const result = await runCleanup(db, {
      retentionDays: 30,
      batchSize: 500,
      maxDeletesPerRun: 50_000,
    });
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('calls deleteOrphanedNotifications exactly once (single statement)', async () => {
    const db = makeDb();
    await runCleanup(db, { retentionDays: 30, batchSize: 500, maxDeletesPerRun: 50_000 });
    expect(db.deleteOrphanedNotifications).toHaveBeenCalledTimes(1);
  });
});
