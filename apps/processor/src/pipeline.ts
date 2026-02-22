import type { DB, ListingRaw, ListingRow } from '@rentifier/db';
import type { Connector } from '@rentifier/connectors';
import type { ListingCandidate, ListingDraft } from '@rentifier/core';
import { MockConnector, Yad2Connector } from '@rentifier/connectors';
import { extractAll } from '@rentifier/extraction';

export interface ProcessingResult {
  processed: number;
  failed: number;
  errors: ProcessingError[];
}

export interface ProcessingError {
  sourceId: number;
  sourceItemId: string;
  error: string;
}

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
  return registry;
}

export async function processBatch(db: DB, batchSize: number = 50): Promise<ProcessingResult> {
  const registry = createDefaultRegistry();
  const unprocessed = await db.getUnprocessedRawListings(batchSize);

  if (unprocessed.length === 0) {
    console.log(JSON.stringify({ event: 'batch_start', batchSize, unprocessedCount: 0 }));
    return { processed: 0, failed: 0, errors: [] };
  }

  console.log(JSON.stringify({ event: 'batch_start', batchSize, unprocessedCount: unprocessed.length }));

  const result: ProcessingResult = { processed: 0, failed: 0, errors: [] };

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

      // Step 3: Normalize via connector
      const draft: ListingDraft = connector.normalize(candidate);

      // Step 5: Extract structured data
      const extraction = extractAll(draft.title, draft.description);

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
        street: draft.street ?? null,
        house_number: draft.houseNumber ?? null,
        area_text: null,
        url: draft.url,
        posted_at: draft.postedAt?.toISOString() ?? null,
        tags_json: extraction.tags.length > 0 ? JSON.stringify(extraction.tags) : null,
        relevance_score: extraction.overallConfidence > 0 ? extraction.overallConfidence : null,
        floor: draft.floor ?? null,
        square_meters: draft.squareMeters ?? null,
        property_type: draft.propertyType ?? null,
        latitude: draft.latitude ?? null,
        longitude: draft.longitude ?? null,
        image_url: draft.imageUrl ?? null,
      };

      await db.upsertListing(listingRow);
      await db.markRawListingProcessed(raw.id);
      result.processed++;

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

  console.log(JSON.stringify({ event: 'batch_complete', ...result }));
  return result;
}
