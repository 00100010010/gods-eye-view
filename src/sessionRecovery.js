const CESIUM_WORKER_PATH = '/cesium/Workers/';

/**
 * Cesium loads some geometry workers only when their first matching primitive
 * appears. If the fixed-duration login session expired while the map remained
 * open, that late module request is redirected to the login HTML and Chromium
 * reports a dynamic-import failure instead of an authentication error.
 *
 * Keep the check deliberately narrow: unrelated render failures must retain
 * Cesium's normal diagnostics rather than being mistaken for an expired login.
 */
export function isProtectedCesiumModuleFailure(error) {
  const message = String(error?.message || error || '');
  return message.includes(CESIUM_WORKER_PATH)
    && /failed to fetch dynamically imported module|importing a module script failed/i.test(message);
}

/** Probe the server-side session gate and replace a dead map with the login. */
export async function recoverExpiredSession({
  fetchImpl = globalThis.fetch,
  locationRef = globalThis.location,
} = {}) {
  if (typeof fetchImpl !== 'function') return false;

  try {
    const response = await fetchImpl('/api/auth/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.status !== 401) return false;
    locationRef?.replace?.('/login');
    return true;
  } catch {
    // Offline and genuine asset failures should stay visible in Cesium's own
    // error panel. Only a confirmed 401 is allowed to navigate away.
    return false;
  }
}

/** Install the recovery before any lazily-created Cesium geometry can render. */
export function installCesiumSessionRecovery(viewer, options = {}) {
  let probeInFlight = false;
  const onRenderError = (_scene, error) => {
    if (probeInFlight || !isProtectedCesiumModuleFailure(error)) return;
    probeInFlight = true;
    void recoverExpiredSession(options).finally(() => {
      probeInFlight = false;
    });
  };

  return viewer?.scene?.renderError?.addEventListener?.(onRenderError) || (() => {});
}
