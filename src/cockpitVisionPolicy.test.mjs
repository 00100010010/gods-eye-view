import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCockpitVisionStageIntensities,
  captureCockpitVisionBaseline,
  COCKPIT_VISION_MODES,
  normalizeCockpitVisionMode,
} from './cockpitVisionPolicy.js';

const createStages = () => ({
  noir: { uniforms: { intensity: 0.72, contrast: 1.3 } },
  retro: { uniforms: { intensity: 0.18, gain: 0.4 } },
  surveillance: { uniforms: { intensity: 0, grain: 0.6 } },
  thermal: { uniforms: { intensity: 0, heat: 0.8 } },
});

test('Cockpit only exposes the inherited Normal vision mode', () => {
  assert.deepEqual(COCKPIT_VISION_MODES, ['optical']);
  assert.equal(normalizeCockpitVisionMode('none'), 'optical');
  assert.equal(normalizeCockpitVisionMode('unknown'), 'optical');
});

test('Cockpit settles pending map crossfades before restoring Normal', () => {
  const stages = createStages();
  const transitions = new Map([
    ['noir', { from: 0, to: 1, start: 10 }],
    ['retro', { from: 1, to: 0, start: 10 }],
  ]);
  const restore = captureCockpitVisionBaseline(stages, transitions);
  assert.deepEqual(restore, { noir: 1, retro: 0, surveillance: 0, thermal: 0 });
  assert.equal(transitions.size, 0);
  applyCockpitVisionStageIntensities(stages, 'optical', restore);
  assert.equal(stages.noir.uniforms.intensity, 1);
  assert.equal(stages.retro.uniforms.intensity, 0);
});
