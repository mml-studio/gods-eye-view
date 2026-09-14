export const CCTV_FOCUS_REQUEST_EVENT = 'gev:cctv-request-focus';
export const CCTV_WORLD_CLICK_FOCUS_DURATION_SEC = 1.9;
export const CCTV_ACTIVATION_RESULT = Object.freeze({
  ACTIVATED: 'activated',
  UNCHANGED: 'unchanged',
  NOT_FOUND: 'not-found',
});
/**
 * Public result codes for explicit CCTV camera flights.
 *
 * Here rather than in `data/cctv.js` so a consumer that only has to READ an
 * outcome — the voice actions do exactly that, four times — does not drag the
 * layer's 211 kB of frustum geometry and media plumbing into the boot chunk.
 */
export const CCTV_FOCUS_RESULT = Object.freeze({
  FOCUSED: 'focused',
  NO_ACTIVE_CAMERA: 'no-active-camera',
  TRACKING_HOLDS_VIEW: 'tracking-holds-view',
  COCKPIT_ACTIVE: 'cockpit-active',
});

/**
 * Activate a camera selected by an in-world user click, then request the UI's
 * cockpit-safe explicit focus path. Programmatic activation and auto-hop do not
 * call this function, so they cannot emit the request.
 *
 * UNCHANGED dispatches too, carrying `alreadyActive`. Clicking a camera is how
 * an operator asks to SEE it, and the answer — the snapshot — is painted in
 * `#cctv-panel`, not in the world. Suppressing the request on UNCHANGED made
 * the most ordinary gesture in the layer inert: enabling CCTV activates the
 * nearest camera on its own, so the very first camera a visitor clicks is
 * routinely the one already active, and that click did nothing at all. The
 * activation path stays suppressed (re-running it rewrites the plane geometry
 * and flashes the monitor); only the request that reveals and re-frames it is
 * restored.
 *
 * `alreadyActive` is diagnostic — it tells a reader (and `qa-cctv-v2`) why one
 * activation can produce three requests. The flight deliberately does NOT
 * branch on it: a click on a camera means "take me there and show me it"
 * whichever click it is, and a second click that behaved differently from the
 * first would be the surprising half.
 *
 * @param {string} cameraId - Clicked camera ID.
 * @param {(cameraId: string) => string} activate - Discriminated CCTV activation callback.
 * @param {EventTarget} [eventTarget=window] - Dispatch target.
 * @returns {boolean} Whether the click reached a real camera and sent the request.
 */
export function activateCctvCameraFromWorldClick(
  cameraId,
  activate,
  eventTarget = window,
) {
  if (!cameraId || typeof activate !== 'function') return false;
  const result = activate(cameraId);
  if (result !== CCTV_ACTIVATION_RESULT.ACTIVATED
    && result !== CCTV_ACTIVATION_RESULT.UNCHANGED) return false;
  eventTarget.dispatchEvent(new CustomEvent(CCTV_FOCUS_REQUEST_EVENT, {
    detail: { cameraId, alreadyActive: result === CCTV_ACTIVATION_RESULT.UNCHANGED },
  }));
  return true;
}

/**
 * Register the UI focus-request listener and return an idempotent disposer that
 * removes the exact callback reference supplied to addEventListener.
 * @param {EventTarget|Object} eventTarget - Window-like event target.
 * @param {(event: Event) => void} listener - Stable listener callback.
 * @returns {() => void} Listener disposer.
 */
export function registerCctvFocusRequestListener(eventTarget, listener) {
  if (!eventTarget?.addEventListener || !eventTarget?.removeEventListener
    || typeof listener !== 'function') return () => {};
  eventTarget.addEventListener(CCTV_FOCUS_REQUEST_EVENT, listener);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    eventTarget.removeEventListener(CCTV_FOCUS_REQUEST_EVENT, listener);
  };
}

/**
 * Route one CCTV world-click request through StyleManager's existing explicit
 * focus policy, preserving tracking release and cockpit refusal behavior.
 *
 * `revealPanel` runs FIRST and unconditionally, ahead of the cockpit and
 * tracking refusals the focus policy applies to the flight. The two answer
 * different questions: whether the camera may move, and where the operator
 * reads the snapshot they just clicked for. A cockpit refusal legitimately
 * holds the view; it is not a reason to leave the frame in a closed drawer.
 *
 * @param {CustomEvent|Object} event - Focus-request event.
 * @param {(activate: Function, focus: Function) => *} runExplicitFocus - Policy path.
 * @param {(cameraId: string, durationSec: number) => *} focusCamera - CCTV flight callback.
 * @param {(cameraId: string) => void} [revealPanel] - Panel disclosure callback.
 * @returns {*} Focus-path result, or false for a malformed request.
 */
export function routeCctvFocusRequest(event, runExplicitFocus, focusCamera, revealPanel) {
  const cameraId = event?.detail?.cameraId;
  if (typeof cameraId !== 'string' || !cameraId || typeof runExplicitFocus !== 'function') {
    return false;
  }
  revealPanel?.(cameraId);
  return runExplicitFocus(
    () => cameraId,
    (selectedId) => focusCamera(selectedId, CCTV_WORLD_CLICK_FOCUS_DURATION_SEC),
  );
}
