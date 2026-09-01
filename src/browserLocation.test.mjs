import assert from 'node:assert/strict';
import test from 'node:test';
import {
  USER_LOCATION_OPTIONS,
  requestUserLocation,
  userLocationErrorMessage,
} from './browserLocation.js';

test('browser geolocation resolves validated coordinates without a network request', async () => {
  let receivedOptions = null;
  const result = await requestUserLocation({
    getCurrentPosition(success, _failure, options) {
      receivedOptions = options;
      success({ coords: { latitude: 48.8584, longitude: 2.2945, accuracy: 17 } });
    },
  });

  assert.deepEqual(result, { latitude: 48.8584, longitude: 2.2945, accuracyM: 17 });
  assert.equal(receivedOptions, USER_LOCATION_OPTIONS);
});

test('browser geolocation rejects unsupported and invalid positions', async () => {
  await assert.rejects(requestUserLocation(null), (error) => error.code === 'unsupported');
  await assert.rejects(requestUserLocation({
    getCurrentPosition(success) {
      success({ coords: { latitude: 120, longitude: 2, accuracy: 5 } });
    },
  }), (error) => error.code === 'invalid-position');
});

test('browser geolocation preserves permission error codes for useful UI copy', async () => {
  await assert.rejects(requestUserLocation({
    getCurrentPosition(_success, failure) {
      failure({ code: 1, message: 'denied' });
    },
  }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(userLocationErrorMessage(error), 'Location permission denied');
    return true;
  });
  assert.equal(userLocationErrorMessage({ code: 3 }), 'Location request timed out');
});
