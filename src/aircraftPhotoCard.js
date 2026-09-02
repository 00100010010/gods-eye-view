import { normalizeAircraftPhotoSelection } from './data/aircraftPhoto.js';

function joinAircraftMetadata(selection) {
  return [
    selection.registration,
    selection.aircraftType,
    `ICAO ${selection.icao24.toUpperCase()}`,
  ].filter(Boolean).join(' · ');
}

function normalizeAircraftContextSelection(detail) {
  if (!detail || !['flights', 'military'].includes(detail.layerId)) return null;
  const aircraftId = String(detail.id ?? '').trim().toLowerCase();
  if (!aircraftId) return null;
  return {
    aircraftId,
    icao24: aircraftId,
    label: String(detail.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
      || aircraftId.toUpperCase(),
    registration: String(detail.registration ?? '').replace(/\s+/g, ' ').trim().slice(0, 32),
    aircraftType: String(detail.aircraftType ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
  };
}

function cleanContextValue(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || '—';
}

function contactContext(detail) {
  const context = detail?.context || detail?.properties || {};
  return {
    route: cleanContextValue(context.route),
    destination: cleanContextValue(context.destination),
    operator: cleanContextValue(context.operator),
    altitude: cleanContextValue(context.altitude),
    speed: cleanContextValue(context.speed),
    heading: cleanContextValue(context.heading),
    source: cleanContextValue(context.source || detail?.source),
    status: cleanContextValue(context.status),
  };
}

/**
 * Show a source-attributed photograph for the currently selected aircraft.
 * Requests are generation-guarded as well as aborted so a slow old lookup can
 * never replace the card for a newer click.
 */
export function initAircraftPhotoCard({ fetchImpl = fetch } = {}) {
  const card = document.getElementById('aircraft-photo-card');
  const image = document.getElementById('aircraft-photo-image');
  const imageLink = document.getElementById('aircraft-photo-link');
  const status = document.getElementById('aircraft-photo-status');
  const title = document.getElementById('aircraft-photo-title');
  const metadata = document.getElementById('aircraft-photo-meta');
  const credit = document.getElementById('aircraft-photo-credit');
  const contextFields = Object.fromEntries([
    'route',
    'destination',
    'operator',
    'altitude',
    'speed',
    'heading',
    'source',
    'status',
  ].map((key) => [key, document.getElementById(`aircraft-contact-${key}`)]));
  if (!card || !image || !imageLink || !status || !title || !metadata || !credit) return null;

  let generation = 0;
  let controller = null;
  let activeAircraftId = null;

  const resetMedia = (message) => {
    image.hidden = true;
    image.removeAttribute('src');
    image.alt = '';
    imageLink.hidden = true;
    imageLink.removeAttribute('href');
    credit.hidden = true;
    credit.removeAttribute('href');
    credit.textContent = '';
    status.hidden = false;
    status.textContent = message;
  };

  const hide = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    activeAircraftId = null;
    card.hidden = true;
    resetMedia('LOOKING UP AIRCRAFT PHOTO…');
  };

  const renderContext = (detail) => {
    const values = contactContext(detail);
    for (const [key, field] of Object.entries(contextFields)) {
      if (field) field.textContent = values[key];
    }
  };

  const showSelection = async (detail) => {
    const selection = normalizeAircraftContextSelection(detail);
    if (!selection) {
      hide();
      return;
    }

    generation += 1;
    const requestGeneration = generation;
    controller?.abort();
    controller = new AbortController();
    activeAircraftId = selection.aircraftId;
    title.textContent = selection.label;
    metadata.textContent = joinAircraftMetadata(selection);
    renderContext(detail);
    card.hidden = false;

    const photoSelection = normalizeAircraftPhotoSelection(detail);
    if (!photoSelection) {
      resetMedia('AIRCRAFT PHOTO UNAVAILABLE');
      controller = null;
      return;
    }
    resetMedia('LOOKING UP AIRCRAFT PHOTO…');

    try {
      const response = await fetchImpl(`/api/aircraft-photo/${photoSelection.icao24}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Aircraft photo request failed (${response.status})`);
      const payload = await response.json();
      if (requestGeneration !== generation || activeAircraftId !== selection.aircraftId) return;
      if (!payload?.found || !payload.photo?.imageUrl || !payload.photo?.sourceUrl) {
        resetMedia('NO MATCHING AIRCRAFT PHOTO');
        return;
      }

      const photo = payload.photo;
      status.hidden = true;
      image.alt = `${selection.label} aircraft — photo by ${photo.photographer}`;
      image.src = photo.imageUrl;
      image.hidden = false;
      imageLink.href = photo.sourceUrl;
      imageLink.hidden = false;
      credit.href = photo.sourceUrl;
      credit.textContent = `© ${photo.photographer} · ${photo.sourceName} ↗`;
      credit.hidden = false;
    } catch (error) {
      if (error?.name === 'AbortError' || requestGeneration !== generation) return;
      resetMedia('AIRCRAFT PHOTO UNAVAILABLE');
    }
  };

  const onSelected = (event) => { void showSelection(event.detail); };
  const onContextUpdated = (event) => {
    const selection = normalizeAircraftContextSelection(event.detail);
    if (!activeAircraftId || selection?.aircraftId !== activeAircraftId) return;
    renderContext(event.detail);
    title.textContent = selection.label;
    metadata.textContent = joinAircraftMetadata(selection);
  };
  const onCleared = (event) => {
    const clearedId = String(event.detail?.id ?? '').trim().toLowerCase();
    if (!activeAircraftId || !clearedId || clearedId === activeAircraftId) hide();
  };
  const onImageError = () => {
    if (!card.hidden) resetMedia('AIRCRAFT PHOTO UNAVAILABLE');
  };

  image.addEventListener('error', onImageError);
  window.addEventListener('gev:awareness-subject-selected', onSelected);
  window.addEventListener('gev:tracked-subject-context-updated', onContextUpdated);
  window.addEventListener('gev:awareness-subject-cleared', onCleared);

  return {
    hide,
    destroy() {
      hide();
      image.removeEventListener('error', onImageError);
      window.removeEventListener('gev:awareness-subject-selected', onSelected);
      window.removeEventListener('gev:tracked-subject-context-updated', onContextUpdated);
      window.removeEventListener('gev:awareness-subject-cleared', onCleared);
    },
  };
}
