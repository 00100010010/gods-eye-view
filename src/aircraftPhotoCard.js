import { normalizeAircraftPhotoSelection } from './data/aircraftPhoto.js';

function joinAircraftMetadata(selection) {
  return [
    selection.registration,
    selection.aircraftType,
    `ICAO ${selection.icao24.toUpperCase()}`,
  ].filter(Boolean).join(' · ');
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
  const close = document.getElementById('aircraft-photo-close');
  if (!card || !image || !imageLink || !status || !title || !metadata || !credit || !close) return null;

  let generation = 0;
  let controller = null;
  let activeIcao = null;

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
    activeIcao = null;
    card.hidden = true;
    resetMedia('LOOKING UP AIRCRAFT PHOTO…');
  };

  const showSelection = async (detail) => {
    const selection = normalizeAircraftPhotoSelection(detail);
    if (!selection) {
      hide();
      return;
    }

    generation += 1;
    const requestGeneration = generation;
    controller?.abort();
    controller = new AbortController();
    activeIcao = selection.icao24;
    title.textContent = selection.label;
    metadata.textContent = joinAircraftMetadata(selection);
    resetMedia('LOOKING UP AIRCRAFT PHOTO…');
    card.hidden = false;

    try {
      const response = await fetchImpl(`/api/aircraft-photo/${selection.icao24}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Aircraft photo request failed (${response.status})`);
      const payload = await response.json();
      if (requestGeneration !== generation || activeIcao !== selection.icao24) return;
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
  const onCleared = (event) => {
    if (!activeIcao || !event.detail?.id || event.detail.id === activeIcao) hide();
  };
  const onOtherEntitySelected = () => hide();
  const onImageError = () => {
    if (!card.hidden) resetMedia('AIRCRAFT PHOTO UNAVAILABLE');
  };

  close.addEventListener('click', hide);
  image.addEventListener('error', onImageError);
  window.addEventListener('gev:awareness-subject-selected', onSelected);
  window.addEventListener('gev:awareness-subject-cleared', onCleared);
  window.addEventListener('gev:entity-selected', onOtherEntitySelected);
  window.addEventListener('gev:entity-selection-cleared', onOtherEntitySelected);

  return {
    hide,
    destroy() {
      hide();
      close.removeEventListener('click', hide);
      image.removeEventListener('error', onImageError);
      window.removeEventListener('gev:awareness-subject-selected', onSelected);
      window.removeEventListener('gev:awareness-subject-cleared', onCleared);
      window.removeEventListener('gev:entity-selected', onOtherEntitySelected);
      window.removeEventListener('gev:entity-selection-cleared', onOtherEntitySelected);
    },
  };
}
