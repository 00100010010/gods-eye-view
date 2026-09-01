import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const responsive = css.slice(css.indexOf('/* ── Touch-responsive workspace'));

test('the viewport supports device safe areas without disabling zoom', () => {
  const viewport = html.match(/<meta name="viewport" content="([^"]+)"/i)?.[1] || '';
  assert.match(viewport, /width=device-width/);
  assert.match(viewport, /initial-scale=1(?:\.0)?/);
  assert.match(viewport, /viewport-fit=cover/);
  assert.doesNotMatch(viewport, /user-scalable=no|maximum-scale=1/);
});

test('tablet rails stay in separate map corridors with touch-sized controls', () => {
  assert.ok(responsive.length > 0, 'touch-responsive workspace rules are missing');
  const tablet = responsive.match(
    /@media \(max-width: 1024px\) \{([\s\S]*?)\n\}\n\n@media \(max-width: 720px\)/,
  )?.[1] || '';
  assert.match(tablet, /#left-panel-stack \{[\s\S]*?width: min\(340px, calc\(50vw - 24px\)\)/);
  assert.match(tablet, /#right-context-rail \{[\s\S]*?width: min\(340px, calc\(50vw - 24px\)\)/);
  assert.match(tablet, /#top-center-actions button \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(tablet, /\.panel-collapse-btn,[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/);
  assert.match(tablet, /env\(safe-area-inset-top\)/);
  assert.match(tablet, /env\(safe-area-inset-bottom\)/);
});

test('phone panels use compact launchers and one expanded map sheet', () => {
  const phone = responsive.match(
    /@media \(max-width: 720px\) \{([\s\S]*?)\n\}\n\n\/\* A landscape phone/,
  )?.[1] || '';
  assert.match(phone, /#left-panel-stack,[\s\S]*?#right-context-rail \{[\s\S]*?width: min\(11rem, calc\(50vw - 16px\)\)/);
  assert.match(phone, /#left-panel-stack:has\(> \[data-panel-id\]:not\(\.collapsed\)\) \{[\s\S]*?width: auto;[\s\S]*?overflow: hidden;/);
  assert.match(phone, /#right-context-rail:has\(> #pp-toggles:not\(\.collapsed\), > \[data-panel-id\]:not\(\.collapsed\)\) \{[\s\S]*?width: auto;/);
  assert.match(phone, /#left-panel-stack:has\([\s\S]*?\) > \[data-panel-id\]\.collapsed \{[\s\S]*?display: none;/);
  assert.match(phone, /body:has\(#left-panel-stack > \[data-panel-id\]:not\(\.collapsed\)\) #right-context-rail,[\s\S]*?visibility: hidden;/);
  assert.match(phone, /body:not\(\.cockpit-mode\) #intel-hud\.active :is\([\s\S]*?display: none !important;/);
  assert.match(phone, /#command-dock \{[\s\S]*?--dock-side-compact:[\s\S]*?min-height: 4\.25rem;/);
  assert.match(phone, /#command-dock > #location-bar,[\s\S]*?translateY\(calc\(0px - env\(safe-area-inset-bottom\)\)\)/);
  assert.match(phone, /#command-dock \.location-toolbar-label::after \{[\s\S]*?content: 'LOCATE';[\s\S]*?display: inline;/);
  assert.match(phone, /#command-dock #control-panel \.panel-title::after \{[\s\S]*?content: 'PRESETS';[\s\S]*?display: inline;/);
  assert.match(phone, /#first-run-launcher \{[\s\S]*?max-height: calc\(100dvh - 170px\)/);
});

test('short landscape phones get a height-aware layout', () => {
  const landscape = responsive.match(
    /@media \(max-width: 900px\) and \(max-height: 600px\) \{([\s\S]*?)\n\}\n\n@media \(hover: none\)/,
  )?.[1] || '';
  assert.match(landscape, /:root \{ --touch-rail-top: 58px; \}/);
  assert.match(landscape, /bottom: max\(82px/);
  assert.match(landscape, /#first-run-launcher \{[\s\S]*?max-height: calc\(100dvh - 132px\)/);
});
