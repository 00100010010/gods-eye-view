import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installCesiumSessionRecovery,
  isProtectedCesiumModuleFailure,
  recoverExpiredSession,
} from './sessionRecovery.js';

const fieldError = new TypeError(
  'Failed to fetch dynamically imported module: '
  + 'https://godseyeview.jimtrebes.fr/cesium/Workers/createGroundPolylineGeometry.js',
);

test('recognizes only protected Cesium dynamic-module failures', () => {
  assert.equal(isProtectedCesiumModuleFailure(fieldError), true);
  assert.equal(isProtectedCesiumModuleFailure(new Error('Failed to fetch dynamically imported module: /src/ui.js')), false);
  assert.equal(isProtectedCesiumModuleFailure(new Error('/cesium/Workers/example.js returned invalid geometry')), false);
});

test('redirects to login only after the session gate confirms expiry', async () => {
  const navigations = [];
  const locationRef = { replace(path) { navigations.push(path); } };
  assert.equal(await recoverExpiredSession({
    fetchImpl: async () => ({ status: 401 }),
    locationRef,
  }), true);
  assert.deepEqual(navigations, ['/login']);

  assert.equal(await recoverExpiredSession({
    fetchImpl: async () => ({ status: 204 }),
    locationRef,
  }), false);
  assert.deepEqual(navigations, ['/login']);
});

test('render hook ignores unrelated failures and coalesces expiry probes', async () => {
  let listener;
  let releaseProbe;
  let probes = 0;
  const probe = new Promise((resolve) => { releaseProbe = resolve; });
  const viewer = {
    scene: {
      renderError: {
        addEventListener(next) {
          listener = next;
          return () => {};
        },
      },
    },
  };
  installCesiumSessionRecovery(viewer, {
    fetchImpl: async () => {
      probes += 1;
      await probe;
      return { status: 204 };
    },
    locationRef: { replace() {} },
  });

  listener(null, new Error('ordinary WebGL failure'));
  listener(null, fieldError);
  listener(null, fieldError);
  assert.equal(probes, 1);
  releaseProbe();
  await probe;
});
