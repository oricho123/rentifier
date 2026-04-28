/**
 * Minimal ray-casting point-in-polygon.
 *
 * Kept dependency-free so Strategy A's P1 can inline this same ~40 lines
 * into the Worker bundle if the spike picks polygons. GeoJSON conventions:
 *   - coordinates are [lng, lat]
 *   - rings are closed (first point == last point)
 *   - Polygon = [outerRing, ...holes]
 *   - MultiPolygon = Polygon[]
 */

export type Point = [number, number]; /** [lng, lat] */
export type Ring = Point[];
export type PolygonCoords = Ring[];
export type MultiPolygonCoords = PolygonCoords[];

export interface NamedFeature {
  name: string;
  type: 'Polygon' | 'MultiPolygon';
  coordinates: PolygonCoords | MultiPolygonCoords;
}

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, poly: PolygonCoords): boolean {
  if (poly.length === 0) return false;
  if (!pointInRing(lng, lat, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) {
    if (pointInRing(lng, lat, poly[h])) return false;
  }
  return true;
}

export function pointInFeature(lng: number, lat: number, feature: NamedFeature): boolean {
  if (feature.type === 'Polygon') {
    return pointInPolygon(lng, lat, feature.coordinates as PolygonCoords);
  }
  const multi = feature.coordinates as MultiPolygonCoords;
  for (const poly of multi) {
    if (pointInPolygon(lng, lat, poly)) return true;
  }
  return false;
}

/**
 * Find the first feature whose polygon contains the point.
 * Returns null if none match.
 */
export function findContainingFeature(
  lng: number,
  lat: number,
  features: NamedFeature[],
): NamedFeature | null {
  for (const f of features) {
    if (pointInFeature(lng, lat, f)) return f;
  }
  return null;
}
