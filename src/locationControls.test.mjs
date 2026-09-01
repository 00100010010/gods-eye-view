import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const browserLocation = fs.readFileSync(new URL('./browserLocation.js', import.meta.url), 'utf8');

test('LOCATION exposes an accessible, explicit device-location action', () => {
  assert.match(
    html,
    /id="locate-me"[^>]*type="button"[^>]*aria-label="Use my current location"[^>]*aria-busy="false"/,
  );
  assert.match(ui, /this\._locateMeBtn\?\.addEventListener\('click', \(\) => void this\.useCurrentLocation\(\)\)/);
  assert.match(ui, /async useCurrentLocation\(\) \{/);
  assert.match(ui, /const position = await requestUserLocation\(\);/);
  assert.match(ui, /if \(!this\._reassertNavigationHandoff\(generation\)\) return \{ ok: false \};/);
  assert.match(ui, /flyToUserLocation\(this\.viewer, position\)/);
  assert.doesNotMatch(browserLocation, /\bfetch\s*\(/, 'device coordinates must remain local');
});

test('both command-dock trays expose a tactile close action', () => {
  assert.match(html, /data-dock-close-target="control-panel"[^>]*aria-label="Close visual presets"/);
  assert.match(html, /data-dock-close-target="location-bar"[^>]*aria-label="Close location tray"/);
  assert.match(ui, /this\._setCommandDockPanelPinState\(panelId, false, \{ syncShare: false \}\);/);
  assert.match(ui, /this\.setPanelCollapsed\(panelId, true, \{ explicit: true \}\);/);
});
