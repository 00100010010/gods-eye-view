/** Browser geolocation options shared by the LOCATION panel and its tests. */
export const USER_LOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 12_000,
  maximumAge: 60_000,
});

/**
 * Ask the browser for the device's current location.
 *
 * Coordinates stay in the browser: this helper does not call an application or
 * provider API. The geolocation implementation is injectable so the contract
 * can be tested without a browser permission prompt.
 *
 * @param {Geolocation|null|undefined} geolocation
 * @returns {Promise<{latitude:number, longitude:number, accuracyM:number|null}>}
 */
export function requestUserLocation(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      const error = new Error('Browser geolocation is unavailable');
      error.code = 'unsupported';
      reject(error);
      return;
    }

    geolocation.getCurrentPosition((position) => {
      const latitude = Number(position?.coords?.latitude);
      const longitude = Number(position?.coords?.longitude);
      const rawAccuracy = Number(position?.coords?.accuracy);
      if (
        !Number.isFinite(latitude)
        || latitude < -90
        || latitude > 90
        || !Number.isFinite(longitude)
        || longitude < -180
        || longitude > 180
      ) {
        const error = new Error('Browser returned invalid coordinates');
        error.code = 'invalid-position';
        reject(error);
        return;
      }
      resolve({
        latitude,
        longitude,
        accuracyM: Number.isFinite(rawAccuracy) && rawAccuracy >= 0 ? rawAccuracy : null,
      });
    }, (cause) => {
      const error = new Error(cause?.message || 'Could not determine current location');
      error.code = Number.isFinite(Number(cause?.code)) ? Number(cause.code) : 'unknown';
      reject(error);
    }, USER_LOCATION_OPTIONS);
  });
}

/** Convert browser geolocation failures into short, user-facing copy. */
export function userLocationErrorMessage(error) {
  switch (error?.code) {
    case 1: return 'Location permission denied';
    case 2: return 'Current location unavailable';
    case 3: return 'Location request timed out';
    case 'unsupported': return 'Geolocation is not supported on this device';
    case 'invalid-position': return 'The device returned an invalid location';
    default: return 'Could not determine your location';
  }
}
