import type { DB, ListingRaw, ListingRow } from '@rentifier/db';
import type { Connector } from '@rentifier/connectors';
import type { ListingCandidate, ListingDraft } from '@rentifier/core';
import { MockConnector, Yad2Connector, FacebookNormalizer } from '@rentifier/connectors';
import { extractAll, isNonRentalPost, shouldInvokeAI, aiExtract, mergeExtractionResults, DEDUP_THRESHOLD, type AiProvider, type AiExtractorMetrics, type AiExtractDetailedResult, type AiExtractorConfig, DEFAULT_AI_CONFIG } from '@rentifier/extraction';

export interface ProcessingResult {
  processed: number;
  failed: number;
  errors: ProcessingError[];
  aiMetrics?: AiExtractorMetrics;
}

export interface ProcessingError {
  sourceId: number;
  sourceItemId: string;
  error: string;
}

const SOURCE_PRIORITY: Record<string, number> = {
  facebook: 100,
  yad2: 50,
  mock: 0,
};

class ConnectorRegistry {
  private connectors = new Map<string, Connector>();

  register(name: string, connector: Connector): void {
    this.connectors.set(name, connector);
  }

  getByName(name: string): Connector | undefined {
    return this.connectors.get(name);
  }
}

function createDefaultRegistry(): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register('mock', new MockConnector());
  registry.register('yad2', new Yad2Connector());
  registry.register('facebook', new FacebookNormalizer());
  return registry;
}

export async function processBatch(db: DB, batchSize: number = 50, ai?: AiProvider, aiConfig?: Partial<AiExtractorConfig>): Promise<ProcessingResult> {
  const registry = createDefaultRegistry();
  const unprocessed = await db.getUnprocessedRawListings(batchSize);

  if (unprocessed.length === 0) {
    console.log(JSON.stringify({ event: 'batch_start', batchSize, unprocessedCount: 0 }));
    return { processed: 0, failed: 0, errors: [] };
  }

  console.log(JSON.stringify({ event: 'batch_start', batchSize, unprocessedCount: unprocessed.length }));

  const result: ProcessingResult = { processed: 0, failed: 0, errors: [] };

  // AI metrics tracking
  const aiMetrics: AiExtractorMetrics = {
    called: 0,
    succeeded: 0,
    failed: 0,
    skippedBudget: 0,
    avgLatencyMs: 0,
  };
  let totalLatency = 0;

  for (const raw of unprocessed) {
    try {
      // Step 1: Parse raw JSON — collector stores the full ListingCandidate
      const candidate = JSON.parse(raw.raw_json) as ListingCandidate;

      // Step 2: Find connector by source name from DB
      const source = await db.getSourceById(raw.source_id);
      const connector = source ? registry.getByName(source.name) : undefined;

      if (!connector) {
        result.failed++;
        result.errors.push({
          sourceId: raw.source_id,
          sourceItemId: raw.source_item_id,
          error: `No connector found for source ${source?.name ?? raw.source_id}`,
        });
        continue;
      }

      // Step 3: Skip search/wanted posts
      if (isNonRentalPost(`${candidate.rawTitle} ${candidate.rawDescription}`)) {
        console.log(JSON.stringify({
          event: 'item_skipped_non_rental',
          sourceId: raw.source_id,
          sourceItemId: raw.source_item_id,
        }));
        await db.markRawListingProcessed(raw.id);
        continue;
      }

      // Step 4: Normalize via connector
      const draft: ListingDraft = connector.normalize(candidate);

      // Step 5: Extract structured data (regex-based)
      let extraction = extractAll(draft.title, draft.description);

      // Step 5a: AI extraction (optional, gated)
      let aiWasUsed = false;
      if (ai && source) {
        const textLength = `${draft.title} ${draft.description}`.length;
        const shouldUseAI = shouldInvokeAI(extraction, source.name, textLength);

        if (shouldUseAI) {
          const maxCalls = aiConfig?.maxCallsPerBatch ?? DEFAULT_AI_CONFIG.maxCallsPerBatch;
          if (aiMetrics.called < maxCalls) {
            // For Facebook posts, title === description, so don't duplicate
            const aiText = source.name === 'facebook'
              ? draft.description
              : `${draft.title}\n\n${draft.description}`;
            const aiResult = await aiExtract(aiText, ai, aiConfig);

            aiMetrics.called++;
            totalLatency += aiResult.latencyMs;

            if (aiResult.ok) {
              extraction = mergeExtractionResults(extraction, aiResult.data);
              aiMetrics.succeeded++;
              aiWasUsed = true;
              console.log(JSON.stringify({
                event: 'ai_call_success',
                sourceItemId: raw.source_item_id,
                latencyMs: aiResult.latencyMs,
                fieldsExtracted: [
                  aiResult.data.price && 'price',
                  aiResult.data.city && 'city',
                  aiResult.data.neighborhood && 'neighborhood',
                  aiResult.data.street && 'street',
                  aiResult.data.bedrooms != null && 'bedrooms',
                  aiResult.data.floor != null && 'floor',
                  aiResult.data.squareMeters != null && 'squareMeters',
                  aiResult.data.entryDate && 'entryDate',
                ].filter(Boolean),
              }));
            } else {
              aiMetrics.failed++;
              console.log(JSON.stringify({
                event: 'ai_call_failed',
                sourceItemId: raw.source_item_id,
                latencyMs: aiResult.latencyMs,
                reason: aiResult.reason,
              }));
            }
          } else {
            aiMetrics.skippedBudget++;
            console.log(JSON.stringify({
              event: 'ai_call_skipped_budget',
              sourceItemId: raw.source_item_id,
            }));
          }
        }
      }

      // Step 5b: Check for cross-source duplicate
      let duplicateOf: number | null = null;
      let shouldSwap = false;
      let swapTargetId: number | null = null;

      const city = extraction.location?.city ?? draft.city ?? null;
      const bedrooms = extraction.bedrooms ?? draft.bedrooms ?? null;
      const price = extraction.price?.amount ?? draft.price ?? null;

      if (city && bedrooms != null && price != null) {
        const match = await db.findDuplicate({
          city,
          bedrooms,
          price,
          street: extraction.street ?? draft.street ?? null,
          house_number: draft.houseNumber ?? null,
          neighborhood: extraction.location?.neighborhood ?? draft.neighborhood ?? null,
          latitude: draft.latitude ?? null,
          longitude: draft.longitude ?? null,
          source_id: raw.source_id,
          source_item_id: raw.source_item_id,
        });

        if (match) {
          const matchSourceObj = await db.getSourceById(match.sourceId);
          const matchPriority = SOURCE_PRIORITY[matchSourceObj?.name ?? ''] ?? 0;
          const currentPriority = SOURCE_PRIORITY[source?.name ?? ''] ?? 0;

          if (currentPriority > matchPriority) {
            // New listing has higher priority — will swap after upsert
            shouldSwap = true;
            swapTargetId = match.id;
            console.log(JSON.stringify({ event: 'duplicate_found', sourceItemId: raw.source_item_id, duplicateOf: match.id, swapped: true }));
          } else {
            duplicateOf = match.id;
            console.log(JSON.stringify({ event: 'duplicate_found', sourceItemId: raw.source_item_id, duplicateOf: match.id, swapped: false }));
          }
        }
      }

      // Step 6: Build listing row for upsert
      const listingRow: Omit<ListingRow, 'id' | 'ingested_at'> = {
        source_id: raw.source_id,
        source_item_id: raw.source_item_id,
        title: draft.title,
        description: draft.description,
        price: extraction.price?.amount ?? draft.price ?? null,
        currency: extraction.price?.currency ?? draft.currency ?? null,
        price_period: extraction.price?.period ?? draft.pricePeriod ?? null,
        bedrooms: extraction.bedrooms ?? draft.bedrooms ?? null,
        city: extraction.location?.city ?? draft.city ?? null,
        neighborhood: extraction.location?.neighborhood ?? draft.neighborhood ?? null,
        street: extraction.street ?? draft.street ?? null,
        house_number: draft.houseNumber ?? null,
        area_text: null,
        url: draft.url,
        posted_at: draft.postedAt?.toISOString() ?? null,
        tags_json: extraction.tags.length > 0 ? JSON.stringify(extraction.tags) : null,
        relevance_score: extraction.overallConfidence > 0 ? extraction.overallConfidence : null,
        floor: extraction.floor ?? draft.floor ?? null,
        square_meters: extraction.squareMeters ?? draft.squareMeters ?? null,
        property_type: draft.propertyType ?? null,
        latitude: draft.latitude ?? null,
        longitude: draft.longitude ?? null,
        image_url: draft.imageUrl ?? null,
        entry_date: extraction.entryDate ?? null,
        ai_extracted: aiWasUsed ? 1 : 0,
        duplicate_of: duplicateOf,
      };

      const newListingId = await db.upsertListing(listingRow);

      // Handle canonical swap (higher priority source arrived)
      if (shouldSwap && swapTargetId != null) {
        await db.swapCanonical(newListingId, swapTargetId);
        console.log(JSON.stringify({ event: 'duplicate_swapped', newCanonical: newListingId, oldCanonical: swapTargetId }));
      }

      await db.markRawListingProcessed(raw.id);
      result.processed++;

      console.log(JSON.stringify({
        event: 'item_processed',
        sourceItemId: raw.source_item_id,
        city: listingRow.city,
        price: listingRow.price,
        bedrooms: listingRow.bedrooms,
        neighborhood: listingRow.neighborhood,
        street: listingRow.street,
        aiUsed: aiWasUsed,
        duplicateOf: listingRow.duplicate_of,
        confidence: listingRow.relevance_score,
      }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({
        event: 'item_failed',
        sourceId: raw.source_id,
        sourceItemId: raw.source_item_id,
        error: errorMessage,
      }));
      result.failed++;
      result.errors.push({
        sourceId: raw.source_id,
        sourceItemId: raw.source_item_id,
        error: errorMessage,
      });
    }
  }

  // Calculate average latency
  if (aiMetrics.called > 0) {
    aiMetrics.avgLatencyMs = totalLatency / aiMetrics.called;
    result.aiMetrics = aiMetrics;
  }

  console.log(JSON.stringify({ event: 'batch_complete', ...result }));
  return result;
}
