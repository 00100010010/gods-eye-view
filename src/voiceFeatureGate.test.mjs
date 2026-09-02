import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('the temporary voice gate prevents microphone initialization', () => {
  assert.match(main, /const VOICE_CONTROL_ENABLED = false;/);
  assert.doesNotMatch(main, /import \{ initGevVoiceCommands \} from/);
  assert.match(
    main,
    /if \(VOICE_CONTROL_ENABLED\) \{[\s\S]*?await import\('\.\/voice\/gevRealtime\.js'\)/,
  );
  assert.match(main, /window\.__godsEyeView\.voiceCommands = null;/);
});

test('the disabled microphone leaves no empty dock slot', () => {
  assert.match(html, /<body class="voice-control-disabled">/);
  assert.doesNotMatch(html, /voice is optional/);
  assert.match(css, /body\.voice-control-disabled #command-dock \{[\s\S]*?--dock-voice-width: 0px/);
  assert.match(css, /body\.voice-control-disabled #mobile-command-nav \{[\s\S]*?repeat\(4,/);
  assert.match(css, /body\.voice-control-disabled \.mobile-command-nav-spacer \{[\s\S]*?display: none/);
});
