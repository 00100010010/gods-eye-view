import assert from 'node:assert/strict';
import test from 'node:test';
import {
  trackpadOrientationDelta,
  wheelDeltaPixels,
} from './trackpadOrientation.js';

test('normal wheel and browser pinch remain owned by Cesium or the browser', () => {
  assert.equal(trackpadOrientationDelta({ deltaX: 10, deltaY: 20 }), null);
  assert.equal(trackpadOrientationDelta({ shiftKey: true, ctrlKey: true, deltaY: 20 }), null);
  assert.equal(trackpadOrientationDelta({ shiftKey: true, metaKey: true, deltaY: 20 }), null);
});

test('shift-trackpad deltas map horizontal motion to heading and vertical motion to pitch', () => {
  const delta = trackpadOrientationDelta({
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    deltaMode: 0,
    deltaX: 25,
    deltaY: -40,
  });
  assert.ok(delta.heading < 0);
  assert.ok(delta.pitch < 0);
  assert.equal(trackpadOrientationDelta({ shiftKey: true, deltaX: 0, deltaY: 0 }), null);
});

test('line and page wheel deltas normalize to CSS pixels', () => {
  assert.equal(wheelDeltaPixels(2, 0), 2);
  assert.equal(wheelDeltaPixels(2, 1), 32);
  assert.equal(wheelDeltaPixels(2, 2, 900), 1800);
});
