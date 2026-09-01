import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAircraftPhotoIcao,
  normalizeAircraftPhotoSelection,
  normalizePlanespottersPhotoPayload,
} from './aircraftPhoto.js';

test('aircraft photo ICAO validation accepts only a real six-digit hex address', () => {
  assert.equal(normalizeAircraftPhotoIcao(' 89649D '), '89649d');
  assert.equal(normalizeAircraftPhotoIcao('~12345'), null);
  assert.equal(normalizeAircraftPhotoIcao('javascript:alert(1)'), null);
});

test('Planespotters photo normalization keeps attribution and allowlisted HTTPS URLs', () => {
  assert.deepEqual(normalizePlanespottersPhotoPayload({
    photos: [{
      id: '1899881',
      photographer: '  Jane   Doe  ',
      link: 'https://www.planespotters.net/photo/1899881/example',
      thumbnail_large: {
        src: 'https://t.plnspttrs.net/12345/1899881_280.jpg',
        size: { width: 420, height: 280 },
      },
      thumbnail: {
        src: 'https://t.plnspttrs.net/12345/1899881_t.jpg',
        size: { width: 200, height: 133 },
      },
    }],
  }), {
    id: '1899881',
    photographer: 'Jane Doe',
    imageUrl: 'https://t.plnspttrs.net/12345/1899881_t.jpg',
    sourceUrl: 'https://www.planespotters.net/photo/1899881/example',
    sourceName: 'Planespotters.net',
    width: 200,
    height: 133,
  });

  assert.equal(normalizePlanespottersPhotoPayload({
    photos: [{
      link: 'https://evil.example/photo',
      thumbnail: { src: 'https://evil.example/image.jpg' },
    }],
  }), null);

  assert.equal(normalizePlanespottersPhotoPayload({
    photos: [{
      photographer: '',
      link: 'https://www.planespotters.net/photo/1/example',
      thumbnail: { src: 'https://t.plnspttrs.net/example_t.jpg' },
    }],
  }), null, 'an uncredited photo cannot be shown');
});

test('aircraft photo selection handles both flight layers and rejects TR-3B fiction', () => {
  assert.deepEqual(normalizeAircraftPhotoSelection({
    layerId: 'military',
    id: 'ae1234',
    label: 'RCH123',
    registration: '12-3456',
    aircraftType: 'Boeing C-17A',
  }), {
    icao24: 'ae1234',
    label: 'RCH123',
    registration: '12-3456',
    aircraftType: 'Boeing C-17A',
  });
  assert.equal(normalizeAircraftPhotoSelection({
    layerId: 'military', id: 'ae1234', aircraftType: 'TR-3B',
  }), null);
  assert.equal(normalizeAircraftPhotoSelection({ layerId: 'satellites', id: 'abcdef' }), null);
});
