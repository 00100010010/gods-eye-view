import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

test('the image builds optimized assets and serves preview instead of Vite dev', () => {
  assert.match(dockerfile, /RUN npm run build/);
  assert.match(dockerfile, /CMD \["npm", "run", "preview"/);
  assert.doesNotMatch(dockerfile, /CMD \["npm", "run", "dev"/);
});

test('runtime browser configuration loads before the application bundle', () => {
  const runtime = html.indexOf("await import(/* @vite-ignore */ '/runtime-config.js')");
  const main = html.indexOf("await import('/src/main.js')");
  assert.ok(runtime > 0 && main > runtime);
});

test('runtime configuration exposes only upstream browser-visible provider keys', () => {
  const endpoint = config.slice(config.indexOf('export function runtimeConfigEndpoint()'), config.indexOf('/**\n * Main Vite configuration factory'));
  assert.match(endpoint, /GOOGLE_MAPS_API_KEY/);
  assert.match(endpoint, /CESIUM_ION_TOKEN/);
  for (const secret of ['OPENAI_API_KEY', 'AISSTREAM_API_KEY', 'FIRMS_MAP_KEY', 'TOMTOM_API_KEY']) {
    assert.doesNotMatch(endpoint, new RegExp(secret));
  }
  const plugins = config.slice(config.indexOf('plugins: ['), config.indexOf('server: {', config.indexOf('plugins: [')));
  assert.ok(plugins.indexOf('createAppAuthPlugin') < plugins.indexOf('runtimeConfigEndpoint()'));
});

test('every application API middleware is installed for optimized preview', () => {
  assert.match(config, /const applicationMiddleware = \[[\s\S]*?\]\.map\(withPreviewMiddleware\)/);
  assert.match(config, /preview: \{[\s\S]*?strictPort: true,[\s\S]*?allowedHosts: resolveAllowedHosts\(env\)/);
  assert.match(config, /runtimeConfigEndpoint\(\),[\s\S]*?keySetupEndpoint\(\)/);
});

