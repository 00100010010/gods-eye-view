import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import {
  APP_PERMISSIONS_POLICY,
  FailedLoginLimiter,
  SESSION_COOKIE,
  createAppAuthPlugin,
  createLoginCsrf,
  createSessionToken,
  forwardedClientKey,
  isTrustedOrigin,
  parseAuthUsers,
  parseCookies,
  serializeCookie,
  validateSessionSecret,
  verifyLoginCsrf,
  verifySessionToken,
} from '../scripts/serverAuth.js';

const secret = Buffer.alloc(48, 7).toString('base64url');
const hashOne = bcrypt.hashSync('first-test-password', 12);
const hashTwo = bcrypt.hashSync('second-test-password', 12);

test('browser capabilities are restricted to required same-origin features', () => {
  assert.equal(APP_PERMISSIONS_POLICY, 'camera=(), microphone=(self), geolocation=(self)');
});

test('auth registry requires exactly two unique bcrypt cost-12 accounts', () => {
  const users = parseAuthUsers(`jim:${hashOne},guest:${hashTwo}`);
  assert.deepEqual(users.map(({ username }) => username), ['jim', 'guest']);
  assert.throws(() => parseAuthUsers(`jim:${hashOne}`), /exactly two/);
  assert.throws(() => parseAuthUsers(`jim:${hashOne},jim:${hashTwo}`), /unique/);
  assert.throws(() => parseAuthUsers(`jim:${bcrypt.hashSync('weak', 10)},guest:${hashTwo}`), /cost 12/);
});

test('session token is signed, expires and rejects tampering', () => {
  const token = createSessionToken('jim', secret, 1_000, 5_000);
  assert.equal(verifySessionToken(token, secret, 2_000)?.username, 'jim');
  assert.equal(verifySessionToken(`${token}x`, secret, 2_000), null);
  assert.equal(verifySessionToken(token, secret, 6_001), null);
  assert.throws(() => validateSessionSecret('too-short'), /at least 32/);
  assert.equal(validateSessionSecret(secret), secret);
});

test('login CSRF binds form nonce, signed cookie and expiry', () => {
  const csrf = createLoginCsrf(secret, 10_000);
  assert.equal(verifyLoginCsrf(csrf.token, csrf.cookie, secret, 11_000), true);
  assert.equal(verifyLoginCsrf(`${csrf.token}x`, csrf.cookie, secret, 11_000), false);
  assert.equal(verifyLoginCsrf(csrf.token, `${csrf.cookie}x`, secret, 11_000), false);
  assert.equal(verifyLoginCsrf(csrf.token, csrf.cookie, secret, 10_000 + 10 * 60_000 + 1), false);
});

test('session cookies carry host-only browser protections', () => {
  const cookie = serializeCookie('__Host-gev_session', 'signed', { maxAge: 43_200 });
  assert.match(cookie, /^__Host-gev_session=signed; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict;/);
  assert.deepEqual(parseCookies('one=a; __Host-gev_session=signed; malformed'), {
    one: 'a',
    '__Host-gev_session': 'signed',
  });
});

test('failed-login limiter locks a client, expires and ignores a spoofed leftmost forwarded address', () => {
  const limiter = new FailedLoginLimiter({ windowMs: 1_000, maxPerClient: 2, globalMax: 10 });
  assert.equal(limiter.check('client', 0).allowed, true);
  limiter.registerFailure('client', 10);
  limiter.registerFailure('client', 20);
  assert.equal(limiter.check('client', 30).allowed, false);
  assert.equal(limiter.check('client', 1_021).allowed, true);
  assert.equal(forwardedClientKey({
    headers: { 'x-forwarded-for': 'spoofed, 203.0.113.7' },
    socket: { remoteAddress: '172.18.0.2' },
  }), '203.0.113.7');
});

test('state-changing authentication accepts only the exact HTTPS origin', () => {
  assert.equal(isTrustedOrigin({ headers: { origin: 'https://godseyeview.jimtrebes.fr' } }, 'https://godseyeview.jimtrebes.fr'), true);
  assert.equal(isTrustedOrigin({ headers: { origin: 'https://evil.example' } }, 'https://godseyeview.jimtrebes.fr'), false);
  assert.equal(isTrustedOrigin({ headers: {} }, 'https://godseyeview.jimtrebes.fr'), false);
});

async function requestSessionProbe(cookie = '') {
  let middleware;
  createAppAuthPlugin({
    usersRaw: `jim:${hashOne},guest:${hashTwo}`,
    sessionSecret: secret,
    hostname: 'godseyeview.jimtrebes.fr',
  }).configureServer({
    middlewares: { use(handler) { middleware = handler; } },
  });

  const headers = {};
  const response = {
    headersSent: false,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    writeHead(status, nextHeaders = {}) {
      this.status = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(nextHeaders)) headers[name.toLowerCase()] = value;
    },
    end(body = '') { this.body = body; },
  };
  await middleware({
    method: 'GET',
    url: '/api/auth/session',
    headers: { cookie },
    socket: {},
  }, response, () => { throw new Error('Session probe escaped the auth gate'); });
  return { status: response.status, body: response.body, headers };
}

test('session probe is private and distinguishes a live signed session', async () => {
  const denied = await requestSessionProbe();
  assert.equal(denied.status, 401);
  assert.equal(denied.headers['cache-control'], 'no-store, max-age=0');

  const token = createSessionToken('jim', secret);
  const allowed = await requestSessionProbe(`${SESSION_COOKIE}=${token}`);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.body, '');
});
