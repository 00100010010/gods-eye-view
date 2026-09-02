import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const mobile = fs.readFileSync(new URL('./mobileNavigation.js', import.meta.url), 'utf8');

test('phone navigation keeps four primary tools and closes the disabled microphone slot', () => {
  const nav = html.slice(html.indexOf('<nav id="mobile-command-nav"'), html.indexOf('</nav>', html.indexOf('<nav id="mobile-command-nav"')));
  assert.equal((nav.match(/<button/g) || []).length, 4);
  assert.match(nav, /data-mobile-panel="location-bar"/);
  assert.match(nav, /data-mobile-panel="data-panel"/);
  assert.match(nav, /class="mobile-command-nav-spacer"/);
  assert.match(nav, /data-mobile-panel="global-context-panel"/);
  assert.match(nav, /id="mobile-more-toggle"[^>]*aria-expanded="false"/);
  assert.match(css, /grid-template-columns: 1fr 1fr 1\.15fr 1fr 1fr/);
  assert.match(html, /<body class="voice-control-disabled">/);
  assert.match(css, /body\.voice-control-disabled #mobile-command-nav \{[\s\S]*?repeat\(4,/);
  assert.match(css, /body\.voice-control-disabled \.mobile-command-nav-spacer \{[\s\S]*?display: none/);
});

test('advanced tools move into one closable mobile menu', () => {
  const menu = html.slice(html.indexOf('<aside id="mobile-more-menu"'), html.indexOf('</aside>', html.indexOf('<aside id="mobile-more-menu"')));
  for (const panel of ['control-panel', 'pp-toggles']) {
    assert.match(menu, new RegExp(`data-mobile-panel="${panel}"`));
  }
  assert.doesNotMatch(menu, /data-mobile-panel="cctv-panel"/);
  for (const action of ['reset', 'logout']) {
    assert.match(menu, new RegExp(`data-mobile-action="${action}"`));
  }
  assert.doesNotMatch(menu, /data-mobile-panel="scene-panel"/);
  assert.doesNotMatch(menu, /data-mobile-action="(?:clear|share)"/);
  assert.match(menu, /id="mobile-more-close"[^>]*aria-label="Close more tools"/);
});

test('mobile panels are transient one-at-a-time sheets with four exit paths', () => {
  assert.match(mobile, /persist: false/);
  assert.match(mobile, /if \(panel !== target && !panel\.classList\.contains\('collapsed'\)\) collapsePanel\(panel\.id\)/);
  assert.match(mobile, /backdrop\.addEventListener\('click', closeAll\)/);
  assert.match(mobile, /event\.key !== 'Escape'/);
  assert.match(mobile, /if \(distance > 72\) collapsePanel\(panel\.id\)/);
  assert.match(css, /height: min\(64dvh, 34rem\) !important/);
  assert.match(css, /bottom: max\(calc\(2vh \+ 7\.5rem\), calc\(env\(safe-area-inset-bottom\) \+ 7\.5rem\)\) !important/);
});

test('mobile Location is an accessible autocomplete sheet sized for touch', () => {
  assert.match(html, /type="search"[^>]*id="location-search"[^>]*role="combobox"/);
  assert.match(html, /id="location-search"[^>]*aria-controls="location-suggestions"/);
  assert.match(html, /id="location-suggestions"[^>]*role="listbox"/);
  assert.match(css, /#command-dock #location-bar:not\(\.collapsed\) \.location-city-row \{[\s\S]*?display: grid !important/);
  assert.match(css, /#command-dock #location-bar:not\(\.collapsed\) \.location-search-wrap \{[\s\S]*?grid-template-columns: 44px minmax\(0, 1fr\) 44px/);
  assert.match(css, /#command-dock #location-bar:not\(\.collapsed\) \.location-suggestion \{[\s\S]*?min-height: 48px/);
});

test('failed map artwork is replaced by a persistent accessible message', () => {
  assert.match(html, /id="map-source-notice" role="alert"[^>]*hidden/);
  assert.match(html, /id="map-source-retry"/);
  assert.match(html, /id="map-source-choose"/);
  assert.match(html, /id="map-source-dismiss"[^>]*aria-label=/);
});
