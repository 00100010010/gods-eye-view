import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

test('selected-aircraft photo card is source-attributed, closable, and initialized', () => {
  assert.match(html, /id="aircraft-photo-card"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(html, /id="aircraft-photo-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /id="aircraft-photo-image"[^>]*referrerpolicy="no-referrer"/);
  assert.match(html, /id="aircraft-photo-credit"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /id="aircraft-photo-close"[^>]*aria-label="Close aircraft photo"/);
  assert.match(main, /initAircraftPhotoCard\(\)/);
});

test('aircraft photo card has phone-safe positioning and tap target', () => {
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?#aircraft-photo-card\s*\{[\s\S]*?width: min\(300px, calc\(100vw - 20px\)\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?#aircraft-photo-close\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
});
