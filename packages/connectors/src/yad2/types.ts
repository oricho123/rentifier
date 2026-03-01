/** Raw Yad2 API response */
export interface Yad2ApiResponse {
  data: {
    markers: Yad2Marker[];
  };
}

/** Single listing marker from the map endpoint */
export interface Yad2Marker {
  orderId: string;
  token: string;
  price: number | null;
  adType: number;
  categoryId: number;
  subcategoryId: number;
  address: {
    city: { text: string; id?: number };
    area: { text: string; id?: number };
    neighborhood: { text: string; id?: number };
    street: { text: string; id?: number };
    house: { number: string | null; floor: number | null };
    coords: { lat: number; lon: number };
  };
  additionalDetails: {
    roomsCount: number | null;
    squareMeter: number | null;
    property: { text: string; id?: number };
    propertyCondition: { id: number | null };
  };
  metaData: {
    coverImage: string | null;
    images: string[];
    squareMeterBuild: number | null;
  };
}

/** Cursor state persisted in source_state.cursor */
export interface Yad2CursorState {
  lastFetchedAt: string | null;
  knownOrderIds: string[];
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  lastCityIndex: number;
  /** Track result counts per city for coverage monitoring (cityCode → last result count) */
  resultCounts?: Record<number, number>;
}
