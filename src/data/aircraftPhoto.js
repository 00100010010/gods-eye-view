const ICAO24_RE = /^[0-9a-f]{6}$/;
const PLANESPOTTERS_PHOTO_HOST = 't.plnspttrs.net';
const PLANESPOTTERS_PAGE_HOSTS = new Set(['planespotters.net', 'www.planespotters.net']);

/** Normalize a real six-character ICAO 24-bit transponder address. */
export function normalizeAircraftPhotoIcao(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ICAO24_RE.test(normalized) ? normalized : null;
}

function boundedText(value, maxLength = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeHttpsUrl(value, allowedHosts) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase())
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Reduce the public Planespotters response to the fields the browser needs.
 * URLs are host-allowlisted here so provider data can never become an open
 * redirect or an arbitrary image source in the authenticated application.
 */
export function normalizePlanespottersPhotoPayload(payload) {
  const photos = Array.isArray(payload?.photos) ? payload.photos : [];
  for (const raw of photos) {
    // Planespotters' guest-use terms explicitly permit the standard linked
    // thumbnail with author attribution. Prefer that 200 px variant even when
    // the API also supplies a larger preview.
    const image = raw?.thumbnail || raw?.thumbnail_large;
    const imageUrl = safeHttpsUrl(image?.src, new Set([PLANESPOTTERS_PHOTO_HOST]));
    const sourceUrl = safeHttpsUrl(raw?.link, PLANESPOTTERS_PAGE_HOSTS);
    const photographer = boundedText(raw?.photographer, 160);
    if (!imageUrl || !sourceUrl || !photographer) continue;

    const width = Number(image?.size?.width);
    const height = Number(image?.size?.height);
    return {
      id: boundedText(raw?.id, 32),
      photographer,
      imageUrl,
      sourceUrl,
      sourceName: 'Planespotters.net',
      width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
      height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
    };
  }
  return null;
}

/** Only real flight contacts are eligible; fictional TR-3B conversions are not. */
export function normalizeAircraftPhotoSelection(detail) {
  if (!detail || !['flights', 'military'].includes(detail.layerId)) return null;
  const icao24 = normalizeAircraftPhotoIcao(detail.id);
  if (!icao24) return null;
  const aircraftType = boundedText(detail.aircraftType, 100);
  if (/\bTR-3B\b/i.test(aircraftType)) return null;
  return {
    icao24,
    label: boundedText(detail.label, 80) || icao24.toUpperCase(),
    registration: boundedText(detail.registration, 32),
    aircraftType,
  };
}
