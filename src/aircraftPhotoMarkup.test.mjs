import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

test('tracked-aircraft context card is persistent, source-attributed, and initialized', () => {
  assert.match(html, /id="aircraft-photo-card"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(html, /id="aircraft-photo-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /id="aircraft-photo-image"[^>]*referrerpolicy="no-referrer"/);
  assert.match(html, /id="aircraft-photo-credit"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /id="aircraft-photo-close"/);
  for (const field of ['route', 'destination', 'operator', 'altitude', 'speed', 'heading', 'source', 'status']) {
    assert.match(html, new RegExp(`id="aircraft-contact-${field}"`));
  }
  assert.match(main, /initAircraftPhotoCard\(\)/);
});

test('aircraft context card has phone-safe compact positioning', () => {
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?#aircraft-photo-card\s*\{[\s\S]*?width: min\(300px, calc\(100vw - 20px\)\)/);
  assert.match(css, /#aircraft-photo-card\s*\{[\s\S]*?grid-template-columns: 116px minmax\(0, 1fr\)/);
});
