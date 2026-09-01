/** Server-only authentication middleware for the Vite runtime. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const SESSION_COOKIE = '__Host-gev_session';
export const LOGIN_CSRF_COOKIE = '__Host-gev_login_csrf';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOGIN_CSRF_TTL_MS = 10 * 60 * 1000;
export const APP_PERMISSIONS_POLICY = 'camera=(), microphone=(self), geolocation=(self)';

const PUBLIC_PATHS = new Set([
  '/logo.svg',
  '/manifest.webmanifest',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
]);

function hmac(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseAuthUsers(raw) {
  const entries = String(raw || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length !== 2) throw new Error('GEV auth must contain exactly two accounts');

  const users = entries.map((entry) => {
    const separator = entry.indexOf(':');
    const username = separator >= 0 ? entry.slice(0, separator) : '';
    const hash = separator >= 0 ? entry.slice(separator + 1) : '';
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(username)) {
      throw new Error('GEV auth contains an invalid username');
    }
    if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash) || bcrypt.getRounds(hash) < 12) {
      throw new Error('GEV auth requires bcrypt hashes with cost 12 or higher');
    }
    return Object.freeze({ username, hash });
  });

  if (new Set(users.map(({ username }) => username)).size !== 2) {
    throw new Error('GEV auth usernames must be unique');
  }
  return Object.freeze(users);
}

export function validateSessionSecret(secret) {
  let decoded;
  try {
    decoded = Buffer.from(String(secret || ''), 'base64url');
  } catch {
    decoded = Buffer.alloc(0);
  }
  if (decoded.length < 32) {
    throw new Error('GEV_SESSION_SECRET must contain at least 32 random bytes encoded as base64url');
  }
  return String(secret);
}

export function createSessionToken(username, secret, now = Date.now(), ttlMs = SESSION_TTL_MS) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    u: username,
    iat: now,
    exp: now + ttlMs,
  })).toString('base64url');
  return `v1.${payload}.${hmac(`session:${payload}`, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  const [version, payload, signature, extra] = String(token || '').split('.');
  if (version !== 'v1' || !payload || !signature || extra) return null;
  if (!safeEqual(signature, hmac(`session:${payload}`, secret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsed?.v !== 1 || !/^[A-Za-z0-9._-]{1,32}$/.test(parsed?.u || '')) return null;
    if (!Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return null;
    if (parsed.iat > now + 60_000 || parsed.exp <= now || parsed.exp - parsed.iat > SESSION_TTL_MS) return null;
    return Object.freeze({ username: parsed.u, issuedAt: parsed.iat, expiresAt: parsed.exp });
  } catch {
    return null;
  }
}

export function createLoginCsrf(secret, now = Date.now()) {
  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = now + LOGIN_CSRF_TTL_MS;
  const value = `${nonce}.${expiresAt}`;
  return {
    token: nonce,
    cookie: `${value}.${hmac(`csrf:${value}`, secret)}`,
  };
}

export function verifyLoginCsrf(formToken, cookieValue, secret, now = Date.now()) {
  const [nonce, expiresAtRaw, signature, extra] = String(cookieValue || '').split('.');
  const expiresAt = Number(expiresAtRaw);
  if (!nonce || !signature || extra || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  if (!safeEqual(formToken, nonce)) return false;
  return safeEqual(signature, hmac(`csrf:${nonce}.${expiresAt}`, secret));
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && cookies[name] === undefined) cookies[name] = value;
  }
  return cookies;
}

export function serializeCookie(name, value, {
  maxAge,
  expires,
  path = '/',
  secure = true,
  httpOnly = true,
  sameSite = 'Strict',
} = {}) {
  const parts = [`${name}=${value}`, `Path=${path}`];
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (expires) parts.push(`Expires=${expires.toUTCString()}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  parts.push('Priority=High');
  return parts.join('; ');
}

export function isTrustedOrigin(req, expectedOrigin) {
  return safeEqual(req.headers?.origin, expectedOrigin);
}

export function forwardedClientKey(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return forwarded.at(-1) || String(req.socket?.remoteAddress || 'unknown');
}

export class FailedLoginLimiter {
  constructor({ windowMs = 15 * 60_000, maxPerClient = 8, globalMax = 80, maxKeys = 2048 } = {}) {
    this.windowMs = windowMs;
    this.maxPerClient = maxPerClient;
    this.globalMax = globalMax;
    this.maxKeys = maxKeys;
    this.clients = new Map();
    this.global = [];
  }

  #prune(now) {
    const cutoff = now - this.windowMs;
    this.global = this.global.filter((timestamp) => timestamp > cutoff);
    for (const [key, timestamps] of this.clients) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length) this.clients.set(key, recent);
      else this.clients.delete(key);
    }
  }

  check(key, now = Date.now()) {
    this.#prune(now);
    const timestamps = this.clients.get(key) || [];
    const blocked = timestamps.length >= this.maxPerClient || this.global.length >= this.globalMax;
    const oldest = timestamps[0] || this.global[0] || now;
    return {
      allowed: !blocked,
      retryAfter: blocked ? Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) : 0,
    };
  }

  registerFailure(key, now = Date.now()) {
    this.#prune(now);
    if (!this.clients.has(key) && this.clients.size >= this.maxKeys) {
      this.clients.delete(this.clients.keys().next().value);
    }
    const timestamps = this.clients.get(key) || [];
    timestamps.push(now);
    this.clients.set(key, timestamps);
    this.global.push(now);
    return this.check(key, now);
  }

  clear(key) {
    this.clients.delete(key);
  }
}

function securityHeaders(res, { html = false } = {}) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Same-origin keeps the browser's POST Origin non-null for the login form;
  // cross-origin navigations still receive no referrer information.
  res.setHeader('Referrer-Policy', html ? 'same-origin' : 'no-referrer');
  res.setHeader('Permissions-Policy', APP_PERMISSIONS_POLICY);
  if (html) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  }
}

function loginPage({ csrfToken, error = '', username = '' }) {
  const alert = error
    ? `<div class="alert" role="alert"><span aria-hidden="true">!</span>${escapeHtml(error)}</div>`
    : '';
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="same-origin">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#02070c">
  <title>Connexion · God's Eye View</title>
  <link rel="icon" type="image/svg+xml" href="/logo.svg">
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#02070c;color:#f0fbff}
    *{box-sizing:border-box}html,body{min-height:100%;margin:0}body{min-height:100svh;overflow-x:hidden;background:radial-gradient(circle at 50% 42%,rgba(9,92,114,.2),transparent 35%),linear-gradient(145deg,#02070c 0%,#06131b 58%,#010407 100%)}
    body::before{content:"";position:fixed;inset:-20%;pointer-events:none;background:repeating-linear-gradient(0deg,transparent 0 3px,rgba(125,239,255,.018) 3px 4px);mix-blend-mode:screen}
    .shell{position:relative;isolation:isolate;min-height:100svh;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left))}
    .orbit{position:fixed;z-index:-1;width:min(78vw,760px);aspect-ratio:1;border:1px solid rgba(101,226,244,.09);border-radius:50%;box-shadow:0 0 90px rgba(29,197,222,.08),inset 0 0 90px rgba(29,197,222,.04)}
    .orbit::before,.orbit::after{content:"";position:absolute;border:1px solid rgba(101,226,244,.07);border-radius:50%}.orbit::before{inset:13%;transform:rotateX(65deg)}.orbit::after{inset:28%;transform:rotateY(65deg)}
    .dialog{width:min(100%,440px);position:relative;padding:clamp(26px,7vw,42px);border:1px solid rgba(117,229,245,.24);border-radius:22px;background:linear-gradient(155deg,rgba(9,24,33,.96),rgba(2,9,14,.985));box-shadow:0 32px 90px rgba(0,0,0,.58),0 0 0 1px rgba(255,255,255,.025) inset,0 0 45px rgba(45,205,225,.08);backdrop-filter:blur(20px)}
    .dialog::before{content:"SECURE ACCESS";position:absolute;top:14px;right:18px;color:#5f8993;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em}
    .brand{display:flex;align-items:center;gap:13px;margin-bottom:25px}.brand img{width:52px;height:52px;filter:drop-shadow(0 0 16px rgba(100,234,251,.3))}.brand h1{margin:0;font-size:clamp(20px,6vw,26px);font-weight:650;letter-spacing:.03em}.brand h1 span{color:#71e4f3}.brand p{margin:4px 0 0;color:#6f9199;font:500 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em}
    h2{margin:0 0 8px;font-size:19px;font-weight:560} .intro{margin:0 0 24px;color:#91aab0;font-size:13px;line-height:1.55}
    label{display:block;margin:0 0 8px;color:#9fb6bc;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase}.field{margin-bottom:17px}
    input{appearance:none;width:100%;height:50px;border:1px solid #21424c;border-radius:11px;padding:0 14px;background:#020a0f;color:#f4fdff;font:500 16px/1 ui-monospace,SFMono-Regular,Menlo,monospace;outline:none;transition:border-color .16s,box-shadow .16s,background .16s}input:hover{border-color:#315e69}input:focus{border-color:#67dce9;background:#051117;box-shadow:0 0 0 3px rgba(74,215,233,.13)}
    button{width:100%;min-height:50px;margin-top:5px;border:1px solid #75e5f0;border-radius:11px;background:linear-gradient(110deg,#51cedd,#8deaf2);color:#031015;font-size:14px;font-weight:750;letter-spacing:.055em;text-transform:uppercase;cursor:pointer;box-shadow:0 10px 28px rgba(45,194,214,.15);transition:transform .14s,filter .14s}button:hover{filter:brightness(1.08)}button:active{transform:translateY(1px)}button:focus-visible{outline:3px solid rgba(126,236,247,.25);outline-offset:3px}
    .alert{display:flex;gap:10px;align-items:flex-start;margin:0 0 18px;padding:11px 12px;border:1px solid rgba(255,119,119,.35);border-radius:9px;background:rgba(120,22,25,.18);color:#ffc4c4;font-size:12px;line-height:1.45}.alert span{display:grid;flex:0 0 18px;height:18px;place-items:center;border:1px solid currentColor;border-radius:50%;font:700 11px/1 ui-monospace,monospace}
    .security{display:flex;align-items:center;justify-content:center;gap:8px;margin:21px 0 0;color:#57757d;font:500 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}.lock{width:8px;height:7px;border:1px solid #5e858d;border-radius:2px;position:relative}.lock::before{content:"";position:absolute;left:1px;right:1px;bottom:5px;height:5px;border:1px solid #5e858d;border-bottom:0;border-radius:5px 5px 0 0}
    @media(max-width:480px){.dialog{border-radius:18px;padding:30px 22px}.dialog::before{top:11px;right:14px}.brand{margin-bottom:22px}.brand img{width:46px;height:46px}.security{text-align:center}}
    @media(max-height:620px) and (orientation:landscape){.shell{padding-block:14px}.dialog{width:min(92vw,680px);padding:25px 30px}.brand{margin-bottom:13px}.brand img{width:39px;height:39px}h2{font-size:16px}.intro{margin-bottom:13px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:13px}.field{margin:0}.security{margin-top:12px}input,button{min-height:44px;height:44px}}
    @media(prefers-reduced-motion:no-preference){.orbit{animation:drift 18s ease-in-out infinite alternate}@keyframes drift{to{transform:scale(1.04) rotate(2deg)}}}
  </style>
</head>
<body>
  <div class="shell"><div class="orbit" aria-hidden="true"></div>
    <main class="dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div class="brand"><img src="/logo.svg" alt=""><div><h1>GOD'S EYE <span>VIEW</span></h1><p>NO PLACE LEFT BEHIND</p></div></div>
      <h2 id="login-title">Connexion privée</h2>
      <p class="intro">Cet espace est réservé aux deux comptes autorisés.</p>
      ${alert}
      <form method="post" action="/auth/login">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <div class="fields">
          <div class="field"><label for="username">Identifiant</label><input id="username" name="username" value="${escapeHtml(username)}" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" required autofocus></div>
          <div class="field"><label for="password">Mot de passe</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required></div>
        </div>
        <button type="submit">Ouvrir la console</button>
      </form>
      <p class="security"><span class="lock" aria-hidden="true"></span>Connexion chiffrée · session signée · 12 heures</p>
    </main>
  </div>
</body>
</html>`;
}

function sendHtml(req, res, status, body, extraHeaders = {}) {
  securityHeaders(res, { html: true });
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    ...extraHeaders,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function redirect(res, location, cookies = []) {
  securityHeaders(res);
  const headers = { Location: location, 'Content-Length': '0' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(303, headers);
  res.end();
}

function freshCsrfCookie(secret, secureCookies) {
  const csrf = createLoginCsrf(secret);
  return {
    ...csrf,
    serialized: serializeCookie(LOGIN_CSRF_COOKIE, csrf.cookie, {
      maxAge: LOGIN_CSRF_TTL_MS / 1000,
      secure: secureCookies,
    }),
  };
}

function expiredCookie(name, secureCookies) {
  return serializeCookie(name, '', {
    maxAge: 0,
    expires: new Date(0),
    secure: secureCookies,
  });
}

async function readForm(req, limit = 8192) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') {
    const error = new Error('Unsupported form content type');
    error.statusCode = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Form is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function createAppAuthPlugin({
  usersRaw,
  sessionSecret,
  hostname = 'localhost',
  required = false,
  secureCookies = true,
  limiter = new FailedLoginLimiter(),
} = {}) {
  const enabled = Boolean(usersRaw);
  if (!enabled && required) throw new Error('GEV authentication is required but no user registry is configured');
  if (!enabled) return { name: 'gev-app-auth-disabled' };

  const users = parseAuthUsers(usersRaw);
  const secret = validateSessionSecret(sessionSecret);
  const expectedOrigin = `https://${hostname}`;

  const install = (server) => {
    server.middlewares.use(async (req, res, next) => {
      try {
        // Vite owns authenticated application responses after this middleware,
        // so publish the capability boundary before handing the response on.
        // Camera stays disabled; microphone and geolocation are same-origin only.
        res.setHeader('Permissions-Policy', APP_PERMISSIONS_POLICY);
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        const method = String(req.method || 'GET').toUpperCase();
        const cookies = parseCookies(req.headers.cookie);
        const session = verifySessionToken(cookies[SESSION_COOKIE], secret);
        const authenticated = Boolean(
          session && users.some(({ username }) => username === session.username),
        );

        if ((method === 'GET' || method === 'HEAD') && PUBLIC_PATHS.has(pathname)) {
          next();
          return;
        }

        if ((method === 'GET' || method === 'HEAD') && pathname === '/login') {
          if (authenticated) {
            redirect(res, '/');
            return;
          }
          const csrf = freshCsrfCookie(secret, secureCookies);
          sendHtml(req, res, 200, loginPage({ csrfToken: csrf.token }), { 'Set-Cookie': csrf.serialized });
          return;
        }

        if (method === 'POST' && pathname === '/auth/login') {
          if (!isTrustedOrigin(req, expectedOrigin)) {
            sendHtml(req, res, 403, loginPage({ csrfToken: '', error: 'Requête de connexion refusée.' }));
            return;
          }

          const key = forwardedClientKey(req);
          const availability = limiter.check(key);
          if (!availability.allowed) {
            const csrf = freshCsrfCookie(secret, secureCookies);
            sendHtml(req, res, 429, loginPage({
              csrfToken: csrf.token,
              error: 'Trop de tentatives. Réessaie dans quelques minutes.',
            }), {
              'Set-Cookie': csrf.serialized,
              'Retry-After': String(availability.retryAfter),
            });
            return;
          }

          const form = await readForm(req);
          const username = String(form.get('username') || '').trim();
          const password = String(form.get('password') || '');
          if (!verifyLoginCsrf(form.get('csrf'), cookies[LOGIN_CSRF_COOKIE], secret)) {
            const csrf = freshCsrfCookie(secret, secureCookies);
            sendHtml(req, res, 403, loginPage({
              csrfToken: csrf.token,
              error: 'La session de connexion a expiré. Réessaie.',
              username,
            }), { 'Set-Cookie': csrf.serialized });
            return;
          }

          const account = users.find((candidate) => candidate.username === username);
          const candidatePassword = password.length <= 256 ? password : '__invalid_password__';
          const passwordMatches = await bcrypt.compare(candidatePassword, account?.hash || users[0].hash);
          if (!account || !passwordMatches) {
            limiter.registerFailure(key);
            const csrf = freshCsrfCookie(secret, secureCookies);
            sendHtml(req, res, 401, loginPage({
              csrfToken: csrf.token,
              error: 'Identifiant ou mot de passe incorrect.',
              username,
            }), { 'Set-Cookie': csrf.serialized });
            return;
          }

          limiter.clear(key);
          const token = createSessionToken(account.username, secret);
          redirect(res, '/', [
            serializeCookie(SESSION_COOKIE, token, {
              maxAge: SESSION_TTL_MS / 1000,
              secure: secureCookies,
            }),
            expiredCookie(LOGIN_CSRF_COOKIE, secureCookies),
          ]);
          return;
        }

        if (pathname === '/auth/logout') {
          if (method !== 'POST') {
            securityHeaders(res);
            res.writeHead(405, { Allow: 'POST', 'Content-Length': '0' });
            res.end();
            return;
          }
          if (!authenticated || !isTrustedOrigin(req, expectedOrigin)) {
            securityHeaders(res);
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden');
            return;
          }
          redirect(res, '/login', [expiredCookie(SESSION_COOKIE, secureCookies)]);
          return;
        }

        if ((method === 'GET' || method === 'HEAD') && pathname === '/api/auth/session') {
          securityHeaders(res);
          if (!authenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Authentication required' }));
            return;
          }
          res.writeHead(204, { 'Content-Length': '0' });
          res.end();
          return;
        }

        if (authenticated) {
          next();
          return;
        }

        if (pathname.startsWith('/api/')) {
          securityHeaders(res);
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Authentication required' }));
          return;
        }

        if (method === 'GET' || method === 'HEAD') {
          redirect(res, '/login');
          return;
        }

        securityHeaders(res);
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Authentication required');
      } catch (error) {
        const status = Number(error?.statusCode) || 500;
        if (status >= 500) console.error('[Auth]', error?.message || String(error));
        if (!res.headersSent) {
          securityHeaders(res);
          res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        res.end(status >= 500 ? 'Internal server error' : error.message);
      }
    });
  };

  return {
    name: 'gev-app-auth',
    configureServer: install,
    configurePreviewServer: install,
  };
}
