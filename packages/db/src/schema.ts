export interface Source {
  id: number;
  name: string;
  enabled: boolean;
  created_at: string;
}

export interface SourceState {
  source_id: number;
  cursor: string | null;
  last_run_at: string | null;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
}

export interface ListingRaw {
  id: number;
  source_id: number;
  source_item_id: string;
  url: string;
  raw_json: string;
  fetched_at: string;
  processed_at: string | null;
}

export interface ListingRow {
  id: number;
  source_id: number;
  source_item_id: string;
  title: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  price_period: string | null;
  bedrooms: number | null;
  city: string | null;
  neighborhood: string | null;
  street: string | null;
  house_number: string | null;
  area_text: string | null;
  url: string;
  posted_at: string | null;
  ingested_at: string;
  tags_json: string | null;
  relevance_score: number | null;
  floor: number | null;
  square_meters: number | null;
  property_type: string | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
}

export interface User {
  id: number;
  telegram_chat_id: string;
  display_name: string;
  created_at: string;
}

export interface FilterRow {
  id: number;
  user_id: number;
  name: string;
  min_price: number | null;
  max_price: number | null;
  min_bedrooms: number | null;
  max_bedrooms: number | null;
  cities_json: string | null;
  neighborhoods_json: string | null;
  keywords_json: string | null;
  must_have_tags_json: string | null;
  exclude_tags_json: string | null;
  enabled: boolean;
  created_at: string;
}

export interface NotificationSent {
  user_id: number;
  listing_id: number;
  filter_id: number | null;
  sent_at: string;
  channel: string;
}

export interface WorkerState {
  worker_name: string;
  last_run_at: string;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
}
