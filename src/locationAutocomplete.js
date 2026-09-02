import * as Cesium from 'cesium';
import { CITY_POIS } from './locations.js';

export const LOCATION_AUTOCOMPLETE_DEBOUNCE_MS = 280;
export const LOCATION_AUTOCOMPLETE_LIMIT = 6;

function normalizedSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function textMatchRank(value, query) {
  const normalized = normalizedSearchText(value);
  if (!normalized || !query) return null;
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  const wordIndex = normalized.indexOf(` ${query}`);
  if (wordIndex >= 0) return 2 + wordIndex / 1000;
  const containsIndex = normalized.indexOf(query);
  return containsIndex >= 0 ? 3 + containsIndex / 1000 : null;
}

/** Fast, keyless suggestions from the hand-framed city and landmark catalog. */
export function curatedLocationSuggestions(query, { limit = LOCATION_AUTOCOMPLETE_LIMIT } = {}) {
  const normalizedQuery = normalizedSearchText(query);
  if (!normalizedQuery) return [];

  const matches = [];
  for (const [cityId, city] of Object.entries(CITY_POIS)) {
    const cityRank = textMatchRank(city.name, normalizedQuery);
    if (cityRank !== null) {
      matches.push({
        key: `city:${cityId}`,
        kind: 'city',
        cityId,
        label: city.name,
        detail: 'CITY',
        rank: cityRank,
      });
    }
    city.pois.forEach((poi, poiIndex) => {
      const poiRank = textMatchRank(`${poi.name} ${city.name}`, normalizedQuery);
      if (poiRank === null) return;
      matches.push({
        key: `poi:${cityId}:${poiIndex}`,
        kind: 'poi',
        cityId,
        poiIndex,
        label: poi.name,
        detail: city.name,
        rank: poiRank + 0.1,
      });
    });
  }

  return matches
    .sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label))
    .slice(0, limit)
    .map(({ rank, ...suggestion }) => suggestion);
}

/** Best available geographic bias for the server-side Places text search. */
export function locationSuggestionBias(viewer) {
  const camera = viewer?.camera;
  const scene = viewer?.scene;
  const ellipsoid = scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
  const width = Number(scene?.canvas?.clientWidth || scene?.canvas?.width);
  const height = Number(scene?.canvas?.clientHeight || scene?.canvas?.height);
  let cartographic = null;

  if (camera?.pickEllipsoid && width > 0 && height > 0) {
    try {
      const center = camera.pickEllipsoid(new Cesium.Cartesian2(width / 2, height / 2), ellipsoid);
      if (center) cartographic = ellipsoid.cartesianToCartographic(center);
    } catch {
      // The camera position below is a safe fallback when the centre points at sky.
    }
  }
  cartographic ||= camera?.positionCartographic || null;
  if (!Number.isFinite(cartographic?.latitude) || !Number.isFinite(cartographic?.longitude)) {
    return null;
  }
  return {
    latitude: Cesium.Math.toDegrees(cartographic.latitude),
    longitude: Cesium.Math.toDegrees(cartographic.longitude),
  };
}

/** Debounced caller uses the existing authenticated, throttled Google proxy. */
export async function fetchLocationSuggestions(viewer, query, {
  signal,
  fetchImpl = globalThis.fetch,
  limit = LOCATION_AUTOCOMPLETE_LIMIT,
} = {}) {
  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery.length < 2 || typeof fetchImpl !== 'function') return [];
  const bias = locationSuggestionBias(viewer);
  if (!bias) return [];

  const params = new URLSearchParams({
    q: normalizedQuery,
    lat: bias.latitude.toFixed(6),
    lon: bias.longitude.toFixed(6),
    radiusM: '50000',
  });
  const response = await fetchImpl(`/api/google/text-search?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response?.ok) return [];
  const payload = await response.json().catch(() => ({}));
  if (!Array.isArray(payload.places)) return [];

  return payload.places
    .map((place, index) => {
      const label = String(place?.name || '').trim();
      const address = String(place?.address || '').trim();
      if (!label) return null;
      return {
        key: `remote:${place.id || `${label}:${address}:${index}`}`,
        kind: 'remote',
        label,
        detail: address || String(place?.primaryType || 'PLACE').trim(),
        searchQuery: address && !address.toLowerCase().includes(label.toLowerCase())
          ? `${label}, ${address}`
          : (address || label),
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

/** Keep curated camera poses first and remove provider duplicates. */
export function mergeLocationSuggestions(local, remote, limit = LOCATION_AUTOCOMPLETE_LIMIT) {
  const merged = [];
  const seen = new Set();
  for (const suggestion of [...(local || []), ...(remote || [])]) {
    const identity = normalizedSearchText(`${suggestion?.label} ${suggestion?.detail}`);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    merged.push(suggestion);
    if (merged.length >= limit) break;
  }
  return merged;
}
