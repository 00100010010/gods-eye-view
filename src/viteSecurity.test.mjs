import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readLiteralDotenvValue, resolveAllowedHosts } from '../vite.config.js';

test('public binding keeps an explicit Host allowlist', () => {
  assert.deepEqual(resolveAllowedHosts({
    HOST: '0.0.0.0',
    GEV_ALLOWED_HOSTS: 'godseyeview.jimtrebes.fr, localhost,127.0.0.1',
  }), ['godseyeview.jimtrebes.fr', 'localhost', '127.0.0.1']);
});

test('missing public allowlist fails back to local names instead of allow-all', () => {
  assert.deepEqual(resolveAllowedHosts({ HOST: '0.0.0.0' }), [
    'localhost',
    '127.0.0.1',
    '.local',
  ]);
});

test('literal dotenv reader preserves bcrypt dollar markers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gev-vite-security-'));
  try {
    await writeFile(path.join(root, '.env'), "GEV_AUTH_USERS='operator:$2b$12$testhash'\n");
    const value = readLiteralDotenvValue(
      ['GEV_AUTH_USERS', 'GEV_BASIC_AUTH_USERS'],
      'development',
      root,
    );
    assert.equal(value, 'operator:$2b$12$testhash');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
