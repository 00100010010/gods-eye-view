import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const host = process.env.GEV_HOSTNAME || 'godseyeview.jimtrebes.fr';
const credentialsPath = process.env.GEV_CREDENTIALS_FILE
  || '/root/.secrets/godseyeview-initial-credentials.txt';
const rawCredentials = await readFile(credentialsPath, 'utf8');
const username = rawCredentials.match(/^username: (.+)$/m)?.[1];
const password = rawCredentials.match(/^password: (.+)$/m)?.[1];
if (!username || !password) throw new Error('Could not load the first provisioned account');

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  headless: true,
  acceptInsecureCerts: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-quic',
    '--enable-webgl',
    '--use-angle=swiftshader',
    `--host-resolver-rules=MAP ${host} 127.0.0.1, EXCLUDE localhost`,
  ],
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const osmTile = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No OpenStreetMap tile response observed')), 45_000);
    page.on('response', (tileResponse) => {
      if (!tileResponse.url().startsWith('https://tile.openstreetmap.org/')) return;
      clearTimeout(timer);
      resolve({
        status: tileResponse.status(),
        blocked: tileResponse.headers()['x-blocked'] || null,
        cacheControl: tileResponse.headers()['cache-control'] || null,
        referer: tileResponse.request().headers().referer || null,
      });
    });
  });
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await page.goto(`https://${host}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      break;
    } catch (error) {
      if (attempt || !String(error?.message).includes('ERR_NETWORK_CHANGED')) throw error;
    }
  }
  const login = await page.evaluate(() => ({
    url: location.pathname,
    title: document.title,
    hasDialog: document.querySelector('[role="dialog"]')?.getAttribute('aria-modal') === 'true',
    hasForm: Boolean(document.querySelector('form[action="/auth/login"]')),
  }));
  if (login.url !== '/login' || !login.hasDialog || !login.hasForm) {
    throw new Error('The custom in-page login was not served');
  }
  await page.type('#username', username);
  await page.type('#password', password);
  [response] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => (
    Boolean(window.__godsEyeView?.mapStackController?.getActiveId?.())
    && document.querySelector('#loading-screen')?.classList.contains('hidden')
  ), { timeout: 45_000 });

  const simplifiedUi = await page.evaluate(() => {
    const retiredSelectors = [
      '#title-bar',
      '#style-indicator',
      '#share-btn',
      '#scope-toggle',
      '#bloom-toggle',
      '#scene-panel',
      '.style-btn',
    ];
    const present = retiredSelectors.filter((selector) => document.querySelector(selector));
    const clearButton = document.querySelector('#clear-selected-layers');
    return {
      present,
      clearInsideDataPanel: Boolean(clearButton?.closest('#data-panel')),
    };
  });

  const trackpadBefore = await page.evaluate(() => {
    const viewer = window.__godsEyeView?.viewer;
    return viewer ? { heading: viewer.camera.heading, pitch: viewer.camera.pitch } : null;
  });
  const globeCanvas = await page.$('.cesium-widget canvas');
  const globeBox = await globeCanvas?.boundingBox();
  if (globeBox) {
    await page.mouse.move(globeBox.x + globeBox.width / 2, globeBox.y + globeBox.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.wheel({ deltaX: 80, deltaY: 40 });
    await page.keyboard.up('Shift');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const trackpadAfter = await page.evaluate(() => {
    const viewer = window.__godsEyeView?.viewer;
    return viewer ? { heading: viewer.camera.heading, pitch: viewer.camera.pitch } : null;
  });
  const trackpadOrientation = {
    available: Boolean(trackpadBefore && trackpadAfter && globeBox),
    headingChanged: Boolean(trackpadBefore && trackpadAfter
      && Math.abs(trackpadAfter.heading - trackpadBefore.heading) > 0.001),
    pitchChanged: Boolean(trackpadBefore && trackpadAfter
      && Math.abs(trackpadAfter.pitch - trackpadBefore.pitch) > 0.001),
  };
  // Upstream now starts keyless sessions on Esri imagery and keeps OSM as its
  // automatic fallback. Select OSM explicitly so this production check still
  // validates the real volunteer tile server request and its browser Referer.
  await page.evaluate(() => (
    window.__godsEyeView.mapStackController.setStack('osm', { silent: true })
  ));
  await page.waitForFunction(() => (
    window.__godsEyeView?.mapStackController?.getActiveId?.() === 'osm'
  ), { timeout: 45_000 });
  const osm = await osmTile;

  const runtime = await page.evaluate(() => ({
    title: document.title,
    activeStack: window.__godsEyeView.mapStackController.getActiveId(),
    googleTilesLoaded: Boolean(window.__godsEyeView.tileset),
    registeredLayers: window.__godsEyeView.dataManager.layers.size,
    loadingHidden: document.querySelector('#loading-screen')?.classList.contains('hidden'),
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
  }));
  const session = (await page.cookies()).find((cookie) => cookie.name === '__Host-gev_session');
  const sessionHardened = Boolean(session?.httpOnly && session?.secure && session?.sameSite === 'Strict');
  console.log(JSON.stringify({
    status: response?.status(),
    login,
    sessionHardened,
    runtime,
    simplifiedUi,
    trackpadOrientation,
    osm,
    pageErrors,
  }, null, 2));
  if (response?.status() !== 200
      || !sessionHardened
      || pageErrors.length
      || simplifiedUi.present.length
      || !simplifiedUi.clearInsideDataPanel
      || !trackpadOrientation.available
      || !trackpadOrientation.headingChanged
      || !trackpadOrientation.pitchChanged
      || runtime.activeStack !== 'osm'
      || !runtime.loadingHidden
      || osm.status !== 200
      || osm.blocked
      || osm.referer !== `https://${host}/`) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
