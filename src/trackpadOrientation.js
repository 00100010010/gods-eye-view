import * as Cesium from 'cesium';

const HEADING_RADIANS_PER_PIXEL = 0.0024;
const PITCH_RADIANS_PER_PIXEL = 0.0017;
const MIN_PITCH = Cesium.Math.toRadians(-89.5);
const MAX_PITCH = Cesium.Math.toRadians(-12);

/** Normalize a WheelEvent delta into CSS pixels. */
export function wheelDeltaPixels(value, deltaMode = 0, pageSize = 800) {
  const delta = Number(value) || 0;
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(1, Number(pageSize) || 800);
  return delta;
}

/**
 * Convert Shift + two-finger scrolling into a bounded heading/pitch change.
 * Ordinary scrolling remains Cesium zoom; the modifier makes orientation an
 * explicit gesture and avoids stealing page or mouse-wheel input.
 */
export function trackpadOrientationDelta(event, pageSize = 800) {
  if (!event?.shiftKey || event.ctrlKey || event.metaKey) return null;
  const horizontal = wheelDeltaPixels(event.deltaX, event.deltaMode, pageSize);
  const vertical = wheelDeltaPixels(event.deltaY, event.deltaMode, pageSize);
  if (Math.abs(horizontal) < 0.01 && Math.abs(vertical) < 0.01) return null;
  return {
    heading: -horizontal * HEADING_RADIANS_PER_PIXEL,
    pitch: vertical * PITCH_RADIANS_PER_PIXEL,
  };
}

/**
 * Add a Google-Maps-like trackpad orientation lane:
 * Shift + two fingers left/right rotates, up/down tilts. Two fingers without
 * Shift retain Cesium's native zoom behavior; Ctrl/drag and mouse controls are
 * untouched.
 */
export function installTrackpadOrientation(viewer) {
  const canvas = viewer?.scene?.canvas;
  if (!canvas?.addEventListener) return () => {};

  const onWheel = (event) => {
    const controller = viewer.scene?.screenSpaceCameraController;
    if (controller?.enableInputs === false || viewer.trackedEntity) return;
    const delta = trackpadOrientationDelta(event, canvas.clientHeight || 800);
    if (!delta) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    viewer.camera.cancelFlight?.();
    viewer.camera.setView({
      orientation: {
        heading: viewer.camera.heading + delta.heading,
        pitch: Cesium.Math.clamp(viewer.camera.pitch + delta.pitch, MIN_PITCH, MAX_PITCH),
        roll: 0,
      },
    });
    viewer.scene.requestRender?.();
  };

  canvas.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => canvas.removeEventListener('wheel', onWheel, { capture: true });
}
