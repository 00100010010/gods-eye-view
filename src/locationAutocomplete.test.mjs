import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  curatedLocationSuggestions,
  fetchLocationSuggestions,
  locationSuggestionBias,
  mergeLocationSuggestions,
} from './locationAutocomplete.js';

test('curated autocomplete responds immediately and ignores accents and case', () => {
  const paris = curatedLocationSuggestions('PAR');
  assert.equal(paris[0]?.kind, 'city');
  assert.match(paris[0]?.label || '', /Paris/i);

  const landmark = curatedLocationSuggestions('eiffel');
  assert.equal(landmark[0]?.kind, 'poi');
  assert.match(landmark[0]?.label || '', /Eiffel/i);
});

test('suggestion bias prefers the visible globe centre and falls back to the camera', () => {
  const center = Cesium.Cartesian3.fromDegrees(2.2945, 48.8584);
  const centered = locationSuggestionBias({
    camera: {
      pickEllipsoid: () => center,
      positionCartographic: Cesium.Cartographic.fromDegrees(-97.7431, 30.2672),
    },
    scene: { canvas: { clientWidth: 390, clientHeight: 844 }, globe: { ellipsoid: Cesium.Ellipsoid.WGS84 } },
  });
  assert.ok(Math.abs(centered.latitude - 48.8584) < 0.001);
  assert.ok(Math.abs(centered.longitude - 2.2945) < 0.001);

  const fallback = locationSuggestionBias({
    camera: { positionCartographic: Cesium.Cartographic.fromDegrees(-97.7431, 30.2672) },
  });
  assert.ok(Math.abs(fallback.latitude - 30.2672) < 0.001);
});

test('remote autocomplete stays same-origin and returns safe navigation labels', async () => {
  const calls = [];
  const suggestions = await fetchLocationSuggestions({
    camera: { positionCartographic: Cesium.Cartographic.fromDegrees(2.35, 48.86) },
  }, 'Louvre', {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => ({
          places: [{
            id: 'louvre',
            name: 'Musée du Louvre',
            address: 'Rue de Rivoli, 75001 Paris, France',
            primaryType: 'museum',
          }],
        }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^\/api\/google\/text-search\?/);
  assert.match(calls[0].url, /q=Louvre/);
  assert.equal(calls[0].options.headers.Accept, 'application/json');
  assert.deepEqual(suggestions, [{
    key: 'remote:louvre',
    kind: 'remote',
    label: 'Musée du Louvre',
    detail: 'Rue de Rivoli, 75001 Paris, France',
    searchQuery: 'Musée du Louvre, Rue de Rivoli, 75001 Paris, France',
  }]);
});

test('short queries are keyless and curated entries win duplicate merging', async () => {
  let fetched = false;
  assert.deepEqual(await fetchLocationSuggestions({}, 'a', {
    fetchImpl: async () => { fetched = true; },
  }), []);
  assert.equal(fetched, false);

  const local = [{ key: 'city:paris', kind: 'city', label: 'Paris', detail: 'CITY' }];
  const remote = [
    { key: 'remote:paris', kind: 'remote', label: 'Paris', detail: 'CITY' },
    { key: 'remote:louvre', kind: 'remote', label: 'Louvre', detail: 'Paris' },
  ];
  assert.deepEqual(mergeLocationSuggestions(local, remote), [local[0], remote[1]]);
});
