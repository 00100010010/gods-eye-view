import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initAircraftPhotoCard } from './aircraftPhotoCard.js';

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }
}

class FakeElement extends FakeTarget {
  constructor() {
    super();
    this.hidden = false;
    this.textContent = '';
    this.alt = '';
    this.src = '';
    this.href = '';
  }
  removeAttribute(name) {
    if (name === 'src') this.src = '';
    if (name === 'href') this.href = '';
  }
}

function installFakeDom() {
  const ids = [
    'aircraft-photo-card',
    'aircraft-photo-image',
    'aircraft-photo-link',
    'aircraft-photo-status',
    'aircraft-photo-title',
    'aircraft-photo-meta',
    'aircraft-photo-credit',
    'aircraft-contact-route',
    'aircraft-contact-destination',
    'aircraft-contact-operator',
    'aircraft-contact-altitude',
    'aircraft-contact-speed',
    'aircraft-contact-heading',
    'aircraft-contact-source',
    'aircraft-contact-status',
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  const fakeWindow = new FakeTarget();
  globalThis.document = { getElementById: (id) => elements.get(id) || null };
  globalThis.window = fakeWindow;
  return { elements, fakeWindow };
}

test('aircraft photo card ignores an older lookup and clears with the selected aircraft', async (t) => {
  const priorDocument = globalThis.document;
  const priorWindow = globalThis.window;
  t.after(() => {
    globalThis.document = priorDocument;
    globalThis.window = priorWindow;
  });

  const { elements, fakeWindow } = installFakeDom();
  const requests = [];
  const card = initAircraftPhotoCard({
    fetchImpl: (url) => new Promise((resolve) => requests.push({ url, resolve })),
  });

  const select = (id, label) => fakeWindow.dispatchEvent({
    type: 'gev:awareness-subject-selected',
    detail: {
      layerId: 'flights',
      id,
      label,
      aircraftType: 'Boeing 737-800',
      context: { route: 'CDG → JFK', destination: 'JFK', source: 'OpenSky Network' },
    },
  });
  select('abcdef', 'OLD123');
  select('123456', 'NEW456');
  assert.equal(requests.length, 2);
  assert.equal(elements.get('aircraft-photo-title').textContent, 'NEW456');
  assert.equal(elements.get('aircraft-contact-destination').textContent, 'JFK');

  requests[0].resolve({
    ok: true,
    json: async () => ({ found: true, photo: {
      imageUrl: 'https://t.plnspttrs.net/old_t.jpg',
      sourceUrl: 'https://www.planespotters.net/photo/old',
      photographer: 'Old Photographer',
      sourceName: 'Planespotters.net',
    } }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('aircraft-photo-image').src, '');

  requests[1].resolve({
    ok: true,
    json: async () => ({ found: true, photo: {
      imageUrl: 'https://t.plnspttrs.net/new_t.jpg',
      sourceUrl: 'https://www.planespotters.net/photo/new',
      photographer: 'New Photographer',
      sourceName: 'Planespotters.net',
    } }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('aircraft-photo-image').src, 'https://t.plnspttrs.net/new_t.jpg');
  assert.equal(elements.get('aircraft-photo-credit').textContent, '© New Photographer · Planespotters.net ↗');

  fakeWindow.dispatchEvent({
    type: 'gev:tracked-subject-context-updated',
    detail: {
      layerId: 'flights',
      id: '123456',
      label: 'NEW456',
      context: { route: 'CDG → LAX', destination: 'LAX', status: 'live' },
    },
  });
  assert.equal(elements.get('aircraft-contact-route').textContent, 'CDG → LAX');
  assert.equal(elements.get('aircraft-contact-destination').textContent, 'LAX');

  fakeWindow.dispatchEvent({
    type: 'gev:awareness-subject-cleared',
    detail: { layerId: 'flights', id: '123456', reason: 'deliberate' },
  });
  assert.equal(elements.get('aircraft-photo-card').hidden, true);

  fakeWindow.dispatchEvent({
    type: 'gev:awareness-subject-selected',
    detail: {
      layerId: 'military',
      id: 'ae1234',
      label: 'UNKNOWN',
      aircraftType: 'TR-3B',
      context: { destination: '', status: 'live', source: 'adsb.lol' },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2, 'a non-photographiable aircraft does not call the photo API');
  assert.equal(elements.get('aircraft-photo-card').hidden, false, 'aircraft context remains visible without a photo');
  assert.equal(elements.get('aircraft-photo-status').textContent, 'AIRCRAFT PHOTO UNAVAILABLE');
  assert.equal(elements.get('aircraft-contact-destination').textContent, '—');
  card.destroy();
});
