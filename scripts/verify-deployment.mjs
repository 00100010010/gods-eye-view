import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';

const host = process.env.GEV_HOSTNAME || 'godseyeview.jimtrebes.fr';
const address = process.env.GEV_VERIFY_ADDRESS || '127.0.0.1';
const verifyTls = process.env.GEV_VERIFY_TLS === '1';
const credentialsPath = process.env.GEV_CREDENTIALS_FILE
  || '/root/.secrets/godseyeview-initial-credentials.txt';

const rawCredentials = await readFile(credentialsPath, 'utf8');
const username = rawCredentials.match(/^username: (.+)$/m)?.[1];
const password = rawCredentials.match(/^password: (.+)$/m)?.[1];
if (!username || !password) throw new Error('Could not load the first provisioned account');

function request(path, {
  protocol = 'https:',
  method = 'GET',
  headers = {},
  body = '',
} = {}) {
  const client = protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request({
      protocol,
      hostname: address,
      port: protocol === 'https:' ? 443 : 80,
      path,
      method,
      headers: { Host: host, ...headers },
      servername: host,
      rejectUnauthorized: protocol === 'https:' ? verifyTls : undefined,
      timeout: 10_000,
    }, (res) => {
      const chunks = [];
      const certificate = res.socket?.getPeerCertificate?.() || null;
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
        certificate,
      }));
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout requesting ${path}`)));
    req.on('error', reject);
    req.end(body);
  });
}

function cookiePair(response, name) {
  const setCookies = Array.isArray(response.headers['set-cookie'])
    ? response.headers['set-cookie']
    : [response.headers['set-cookie']].filter(Boolean);
  const serialized = setCookies.find((cookie) => cookie.startsWith(`${name}=`));
  return serialized?.split(';', 1)[0] || '';
}

function csrfFrom(response) {
  return response.body.toString('utf8').match(/name="csrf" value="([^"]+)"/)?.[1] || '';
}

const checks = [];
function expect(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail });
}

const redirect = await request('/', { protocol: 'http:' });
expect('HTTP redirects to HTTPS', [301, 302, 307, 308].includes(redirect.status), redirect.status);

const denied = await request('/');
expect('anonymous app redirected to in-page login', denied.status === 303 && denied.headers.location === '/login', `${denied.status} ${denied.headers.location || ''}`);
expect('browser auth challenge absent', !denied.headers['www-authenticate'], denied.headers['www-authenticate'] || 'absent');

const login = await request('/login');
const csrf = csrfFrom(login);
const loginCsrfCookie = cookiePair(login, '__Host-gev_login_csrf');
expect('custom login served', login.status === 200, login.status);
expect('custom login form present', login.body.includes(Buffer.from('Connexion privée')) && login.body.includes(Buffer.from('action="/auth/login"')), 'branded form');
expect('login is responsive', login.body.includes(Buffer.from('viewport-fit=cover')) && login.body.includes(Buffer.from('@media(max-width:480px)')), 'responsive CSS');
expect('login CSRF issued', Boolean(csrf && loginCsrfCookie), 'signed double-submit token');
expect('login not cached', String(login.headers['cache-control']).includes('no-store'), login.headers['cache-control']);
expect('login cannot be framed', String(login.headers['content-security-policy']).includes("frame-ancestors 'none'")
  && ['DENY', 'SAMEORIGIN'].includes(login.headers['x-frame-options']),
`${login.headers['x-frame-options']} + CSP frame-ancestors none`);
expect('login auth challenge absent', !login.headers['www-authenticate'], login.headers['www-authenticate'] || 'absent');

const formBody = new URLSearchParams({ csrf, username, password }).toString();
const wrongOrigin = await request('/auth/login', {
  method: 'POST',
  headers: {
    Origin: 'https://attacker.invalid',
    Cookie: loginCsrfCookie,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(formBody),
  },
  body: formBody,
});
expect('cross-origin login rejected', wrongOrigin.status === 403, wrongOrigin.status);

const badCsrfBody = new URLSearchParams({ csrf: 'invalid', username, password }).toString();
const badCsrf = await request('/auth/login', {
  method: 'POST',
  headers: {
    Origin: `https://${host}`,
    Cookie: loginCsrfCookie,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(badCsrfBody),
  },
  body: badCsrfBody,
});
expect('invalid login CSRF rejected', badCsrf.status === 403, badCsrf.status);

const authenticated = await request('/auth/login', {
  method: 'POST',
  headers: {
    Origin: `https://${host}`,
    Cookie: loginCsrfCookie,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(formBody),
  },
  body: formBody,
});
const sessionCookie = cookiePair(authenticated, '__Host-gev_session');
const sessionSetCookie = (authenticated.headers['set-cookie'] || []).find?.((cookie) => cookie.startsWith('__Host-gev_session=')) || '';
expect('credentials create session', authenticated.status === 303 && authenticated.headers.location === '/', `${authenticated.status} ${authenticated.headers.location || ''}`);
expect('session cookie issued', Boolean(sessionCookie), 'host-only session');
expect('session cookie hardened', /; Path=\/;.*; HttpOnly; Secure; SameSite=Strict/i.test(sessionSetCookie), 'Path=/; HttpOnly; Secure; SameSite=Strict');

const app = await request('/', { headers: { Cookie: sessionCookie } });
expect('session-authenticated app served', app.status === 200, app.status);
expect('manifest linked', app.body.includes(Buffer.from('manifest.webmanifest')), 'HTML link');
expect('logout control present', app.body.includes(Buffer.from('action="/auth/logout"')), 'POST form');
expect('device-location control present', app.body.includes(Buffer.from('id="locate-me"')), 'explicit GPS action');
expect('mobile tray close controls present', app.body.includes(Buffer.from('data-dock-close-target="control-panel"'))
  && app.body.includes(Buffer.from('data-dock-close-target="location-bar"')), 'LOCATION + PRESETS close actions');
expect('same-origin microphone and geolocation permitted', String(app.headers['permissions-policy']).includes('microphone=(self)')
  && String(app.headers['permissions-policy']).includes('geolocation=(self)'), app.headers['permissions-policy']);
expect('cross-origin map requests disclose origin only', app.headers['referrer-policy'] === 'strict-origin-when-cross-origin', app.headers['referrer-policy']);
expect('HSTS enabled', Number(app.headers['strict-transport-security']?.match(/max-age=(\d+)/)?.[1]) >= 31_536_000, app.headers['strict-transport-security']);
expect('nosniff enabled', app.headers['x-content-type-options'] === 'nosniff', app.headers['x-content-type-options']);

const apiDenied = await request('/api/tomtom/status');
expect('anonymous API denied with JSON', apiDenied.status === 401 && String(apiDenied.headers['content-type']).includes('application/json'), `${apiDenied.status} ${apiDenied.headers['content-type']}`);
expect('anonymous API has no browser challenge', !apiDenied.headers['www-authenticate'], apiDenied.headers['www-authenticate'] || 'absent');
const api = await request('/api/tomtom/status', { headers: { Cookie: sessionCookie } });
expect('session-authenticated API served', api.status === 200, api.status);

const basicCannotBypass = await request('/', {
  headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
});
expect('legacy BasicAuth cannot bypass session login', basicCannotBypass.status === 303, basicCannotBypass.status);

const manifest = await request('/manifest.webmanifest');
expect('manifest public', manifest.status === 200, manifest.status);
expect('manifest MIME', String(manifest.headers['content-type']).includes('manifest+json') || String(manifest.headers['content-type']).includes('application/json'), manifest.headers['content-type']);
const icon = await request('/icons/icon-192.png');
expect('install icon public', icon.status === 200, icon.status);
expect('install icon MIME', icon.headers['content-type'] === 'image/png', icon.headers['content-type']);
const sourceDenied = await request('/src/main.js');
expect('non-public source remains private', sourceDenied.status === 303, sourceDenied.status);
const dotSegmentDenied = await request('/logo.svg/../api/tomtom/status');
expect('public asset cannot dot-segment into API', dotSegmentDenied.status === 401, dotSegmentDenied.status);
const encodedSegmentDenied = await request('/logo.svg%2f..%2fapi%2ftomtom%2fstatus');
expect('public asset cannot encoded-segment into API', encodedSegmentDenied.status !== 200, encodedSegmentDenied.status);

const logout = await request('/auth/logout', {
  method: 'POST',
  headers: {
    Origin: `https://${host}`,
    Cookie: sessionCookie,
    'Content-Length': '0',
  },
});
const logoutCookie = (logout.headers['set-cookie'] || []).find?.((cookie) => cookie.startsWith('__Host-gev_session=')) || '';
expect('logout redirects to login', logout.status === 303 && logout.headers.location === '/login', `${logout.status} ${logout.headers.location || ''}`);
expect('logout clears session cookie', /Max-Age=0/.test(logoutCookie) && /Expires=Thu, 01 Jan 1970/.test(logoutCookie), 'expired session cookie');

const certificate = app.certificate || login.certificate || {};
const summary = {
  host,
  address,
  verifyTls,
  certificateSubject: certificate.subject?.CN || null,
  certificateIssuer: certificate.issuer?.CN || null,
  checks,
};
console.log(JSON.stringify(summary, null, 2));
if (checks.some((check) => !check.ok)) process.exit(1);
