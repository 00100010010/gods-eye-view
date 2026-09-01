import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlanespottersAircraftPhoto } from '../../vite.config.js';

test('aircraft photo fetch uses the fixed Planespotters endpoint and a bounded signal', async () => {
  let request = null;
  const photo = await fetchPlanespottersAircraftPhoto('89649D', {
    timeoutMs: 100,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        photos: [{
          id: '1',
          photographer: 'Photographer',
          link: 'https://www.planespotters.net/photo/1/example',
          thumbnail: {
            src: 'https://t.plnspttrs.net/example_t.jpg',
            size: { width: 200, height: 133 },
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(request.url, 'https://api.planespotters.net/pub/photos/hex/89649d');
  assert.equal(request.options.headers.Accept, 'application/json');
  assert.match(request.options.headers['User-Agent'], /GodsEyeView/);
  assert.match(request.options.headers['User-Agent'], /https:\/\/godseyeview\.jimtrebes\.fr/);
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.equal(photo.photographer, 'Photographer');
});

test('aircraft photo fetch rejects invalid identity without contacting upstream', async () => {
  let called = false;
  await assert.rejects(
    fetchPlanespottersAircraftPhoto('../etc/passwd', {
      fetchImpl: async () => { called = true; },
    }),
    /Invalid ICAO24/,
  );
  assert.equal(called, false);
});
