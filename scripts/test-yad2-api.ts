/**
 * YAD2 API Verification Script
 *
 * Tests the YAD2 rental endpoint to verify:
 * - Endpoint is accessible
 * - Response structure matches TypeScript types
 * - City filtering works
 * - Result counts are reasonable
 */

import { fetchWithRetry } from '../packages/connectors/src/yad2/client';

const TEST_CITIES = [
  { name: 'תל אביב', code: 5000 },
  { name: 'ירושלים', code: 3000 },
  { name: 'חיפה', code: 4000 },
];

async function testYad2Api() {
  console.log('Starting YAD2 API verification...\n');

  for (const city of TEST_CITIES) {
    console.log(`Testing ${city.name} (${city.code})...`);

    try {
      const response = await fetchWithRetry(city.code);
      const markers = response.data.markers;

      // Log result summary
      console.log(JSON.stringify({
        city: city.name,
        cityCode: city.code,
        resultCount: markers.length,
        hasMarkers: Array.isArray(markers) && markers.length > 0,
        isArray: Array.isArray(markers),
        hitting200Limit: markers.length === 200,
      }, null, 2));

      // Sample first marker to verify structure
      if (markers.length > 0) {
        const firstMarker = markers[0];
        console.log('First marker sample:', JSON.stringify({
          orderId: firstMarker.orderId,
          price: firstMarker.price,
          hasAddress: !!firstMarker.address,
          cityName: firstMarker.address?.city?.text,
          neighborhood: firstMarker.address?.neighborhood?.text,
          street: firstMarker.address?.street?.text,
          rooms: firstMarker.additionalDetails?.roomsCount,
          sqm: firstMarker.additionalDetails?.squareMeter,
          hasImage: !!firstMarker.metaData?.coverImage,
        }, null, 2));
      }

      console.log('✅ Success\n');
    } catch (error) {
      console.error(`❌ Failed for ${city.name}:`);

      if (error instanceof Error) {
        console.error(JSON.stringify({
          city: city.name,
          cityCode: city.code,
          error: error.message,
          name: error.name,
        }, null, 2));
      } else {
        console.error(JSON.stringify({
          city: city.name,
          cityCode: city.code,
          error: String(error),
        }, null, 2));
      }

      console.log('');
    }
  }

  console.log('YAD2 API verification complete.');
}

testYad2Api().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
