import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const host = process.env.GEV_HOSTNAME || 'godseyeview.jimtrebes.fr';
const credentialsPath = process.env.GEV_CREDENTIALS_FILE
  || '/root/.secrets/godseyeview-initial-credentials.txt';
const outputDir = process.env.GEV_RESPONSIVE_OUTPUT || '/tmp/gods-eye-view-responsive';
const rawCredentials = await readFile(credentialsPath, 'utf8');
const username = rawCredentials.match(/^username: (.+)$/m)?.[1];
const password = rawCredentials.match(/^password: (.+)$/m)?.[1];
if (!username || !password) throw new Error('Could not load the first provisioned account');

const devices = [
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'ipad-portrait', width: 768, height: 1024 },
  { name: 'ipad-landscape', width: 1024, height: 768 },
];

await mkdir(outputDir, { recursive: true, mode: 0o700 });

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

const results = [];
await browser.defaultBrowserContext().overridePermissions(`https://${host}`, ['geolocation']);

async function waitForHitTarget(page, selector, timeout = 10_000) {
  await page.waitForFunction((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      rect.left + (rect.width / 2),
      rect.top + (rect.height / 2),
    );
    return topmost === target || target.contains(topmost);
  }, { timeout }, selector);
}

try {
  for (const device of devices) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewport({
      width: device.width,
      height: device.height,
      deviceScaleFactor: 1,
      isMobile: device.width <= 844,
      hasTouch: true,
    });
    // Pages share the default browser context. Clear the prior viewport's
    // session so every device validates the login itself, not a warm session.
    await page.deleteCookie(
      { name: '__Host-gev_session', domain: host, path: '/' },
      { name: '__Host-gev_login_csrf', domain: host, path: '/' },
    );
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

    if (device.name === 'phone-portrait') {
      await page.screenshot({
        path: path.join(outputDir, 'phone-login.png'),
        fullPage: false,
      });
    }
    const loginLayout = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
      return dialog ? {
        x: Math.round(dialog.x),
        y: Math.round(dialog.y),
        right: Math.round(dialog.right),
        bottom: Math.round(dialog.bottom),
        width: Math.round(dialog.width),
        height: Math.round(dialog.height),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      } : null;
    });
    if (!loginLayout) throw new Error(`Custom login missing at ${device.name}`);
    if (loginLayout.x < 0 || loginLayout.right > loginLayout.viewportWidth || loginLayout.y < 0 || loginLayout.bottom > loginLayout.viewportHeight) {
      throw new Error(`Custom login outside viewport at ${device.name}`);
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

    if (device.name === 'phone-portrait') {
      await page.screenshot({
        path: path.join(outputDir, 'phone-first-run.png'),
        fullPage: false,
      });
    }

    await page.evaluate(() => document.querySelector('#first-run-launcher')?.remove());
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    let commandDockActions = null;
    if (device.name === 'phone-portrait') {
      await page.setGeolocation({ latitude: 48.8584, longitude: 2.2945, accuracy: 25 });
      await page.click('#location-bar .location-toolbar');
      await page.waitForFunction(() => !document.querySelector('#location-bar')?.classList.contains('collapsed'));
      await waitForHitTarget(page, '#locate-me');
      await page.click('#locate-me');
      await page.waitForFunction(() => (
        document.querySelector('#location-mini-city')?.textContent?.includes('My location')
        && document.querySelector('#locate-me')?.getAttribute('aria-busy') === 'false'
      ), { timeout: 15_000 });
      const locationClose = await page.$eval(
        '#location-bar .dock-tray-close',
        (element) => {
          const rect = element.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height) };
        },
      );
      await page.click('#location-bar .dock-tray-close');
      await page.waitForFunction(() => document.querySelector('#location-bar')?.classList.contains('collapsed'));

      await page.click('#control-panel-toggle');
      await page.waitForFunction(() => !document.querySelector('#control-panel')?.classList.contains('collapsed'));
      await waitForHitTarget(page, '#control-panel .dock-tray-close');
      const presetsClose = await page.$eval(
        '#control-panel .dock-tray-close',
        (element) => {
          const rect = element.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height) };
        },
      );
      await page.click('#control-panel .dock-tray-close');
      await page.waitForFunction(() => document.querySelector('#control-panel')?.classList.contains('collapsed'));
      commandDockActions = { locationClose, presetsClose, geolocationCentered: true };
    }

    const layout = await page.evaluate(() => {
      const rectFor = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
        };
      };

      const overlaps = (a, b) => Boolean(a && b
        && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y);
      const title = rectFor('#title-bar');
      const actions = rectFor('#top-center-actions');
      const style = rectFor('#style-indicator');
      const leftRail = rectFor('#left-panel-stack');
      const rightRail = rectFor('#right-context-rail');
      const dock = rectFor('#command-dock');
      const visibleControls = [...document.querySelectorAll('button, input, select, a[href], [role="button"]')]
        .filter((element) => {
          if (element.closest('#cesium-credits')) return false;
          const rect = element.getBoundingClientRect();
          const computed = getComputedStyle(element);
          return computed.display !== 'none'
            && computed.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0
            && rect.right > 0
            && rect.bottom > 0
            && rect.left < innerWidth
            && rect.top < innerHeight;
        });
      const smallControls = visibleControls.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.id || element.getAttribute('aria-label') || element.textContent.trim().slice(0, 28),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }).filter(({ width, height }) => width < 40 || height < 40);

      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        },
        title,
        actions,
        style,
        leftRail,
        rightRail,
        dock,
        topCollision: overlaps(title, actions) || overlaps(actions, style) || overlaps(title, style),
        railCollision: overlaps(leftRail, rightRail),
        smallControls,
      };
    });
    layout.commandDockActions = commandDockActions;

    await page.screenshot({
      path: path.join(outputDir, `${device.name}.png`),
      fullPage: false,
    });

    if (device.name === 'phone-portrait') {
      await page.click('#data-panel .panel-collapse-btn');
      await page.waitForFunction(() => !document.querySelector('#data-panel')?.classList.contains('collapsed'));
      await new Promise((resolve) => setTimeout(resolve, 350));
      layout.expandedPanel = await page.evaluate(() => {
        const panel = document.querySelector('#data-panel')?.getBoundingClientRect();
        const otherRail = document.querySelector('#right-context-rail');
        const otherStyle = otherRail ? getComputedStyle(otherRail) : null;
        if (!panel) return null;
        return {
          x: Math.round(panel.x),
          y: Math.round(panel.y),
          width: Math.round(panel.width),
          height: Math.round(panel.height),
          right: Math.round(panel.right),
          bottom: Math.round(panel.bottom),
          otherRailHidden: otherStyle?.visibility === 'hidden' && otherStyle?.pointerEvents === 'none',
        };
      });
      await page.screenshot({
        path: path.join(outputDir, 'phone-panel-open.png'),
        fullPage: false,
      });
    }

    const failures = [];
    if (response?.status() !== 200) failures.push(`HTTP ${response?.status()}`);
    if (pageErrors.length) failures.push(`${pageErrors.length} page error(s)`);
    if (layout.document.width > layout.viewport.width) failures.push('horizontal overflow');
    if (layout.topCollision) failures.push('top-bar collision');
    if (layout.railCollision) failures.push('panel-rail collision');
    if (layout.smallControls.length) failures.push(`${layout.smallControls.length} touch target(s) below 40px`);
    if (layout.commandDockActions) {
      const { locationClose, presetsClose, geolocationCentered } = layout.commandDockActions;
      if (!geolocationCentered) failures.push('device geolocation did not center the map');
      if (locationClose.width < 40 || locationClose.height < 40) failures.push('LOCATION close target below 40px');
      if (presetsClose.width < 40 || presetsClose.height < 40) failures.push('PRESETS close target below 40px');
    }
    if (layout.expandedPanel) {
      const panel = layout.expandedPanel;
      if (panel.x < 0 || panel.y < 0 || panel.right > layout.viewport.width || panel.bottom > layout.viewport.height) {
        failures.push('expanded panel outside viewport');
      }
      if (!panel.otherRailHidden) failures.push('opposite rail visible over expanded panel');
    }

    results.push({ ...device, loginLayout, layout, pageErrors, failures });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ outputDir, results }, null, 2));
if (results.some(({ failures }) => failures.length)) process.exitCode = 1;
