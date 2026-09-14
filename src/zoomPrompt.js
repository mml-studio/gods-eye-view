/**
 * @module zoomPrompt
 *
 * "Zoome pour voir cette couche" — said in the middle of the screen, where the
 * eye already is.
 *
 * Thirteen layers refuse to draw above a ceiling of their own, and every one of
 * them says so honestly: `powerGrid` publishes a guidance status and a sentence,
 * the manager prints that sentence under the row, and `layerFeedState()` takes
 * care that the chip stays green because a zoom gate is not a fault. All of that
 * is correct and none of it is SEEN. The sentence lands in a sub-line, in small
 * type, in a panel that can be collapsed to a 0×0 box — while the reader is
 * looking at a globe 1 000 km below, wondering why the layer they just switched
 * on drew nothing.
 *
 * So this module states it once, centrally, and — for the three layers that can
 * — offers to do it: `ensureViewGate()` already solves the view that fits under
 * a layer's ceiling and flies there (`data/viewGate.js`). Until now nothing in
 * the app called it.
 *
 * ── What it is careful about ────────────────────────────────────────────────
 *
 * • **It speaks for SWITCHED-ON layers only.** Thirteen layers are gated; at a
 *   continental camera twelve of them are outside their gate at the same time.
 *   A card that listed every layer that COULD be waiting would be a wall, and
 *   would be nagging about layers nobody asked for. A gate is only news for a
 *   layer the reader has turned on and is waiting for.
 *
 * • **It borrows the layer's own words.** The message is the layer's
 *   `loadingLabel` — the same string the panel row prints, never a second
 *   sentence written here that could drift from it. A layer that publishes no
 *   sentence gets a neutral fallback rather than an invented ceiling.
 *
 * • **It aggregates.** One card, up to three rows, then "+N autres". Three
 *   cards stacked in the middle of a globe is a modal dialog by accident.
 *
 * • **It is not a first-run card.** Dismissal is remembered against the SET of
 *   waiting layers (the signature), not forever: closing it while the grid
 *   waits keeps it closed for that situation, and a different set of layers
 *   waiting later is different news.
 */

/**
 * Statuses that mean "the camera is the reason nothing drew".
 *
 * A subset of the manager's `GUIDANCE_STATUSES`, deliberately: `empty` (nothing
 * mapped here), `idle` (nothing asked yet) and `out-of-gate` (the drawing on
 * screen is real, the camera has simply moved off the box it was read for) are
 * guidance, but zooming is not what answers them.
 */
export const ZOOM_PROMPT_STATUSES = Object.freeze(new Set(['zoom-in', 'too-high', 'too-wide']));

/** Rows printed before the card collapses the rest into a count. */
export const ZOOM_PROMPT_MAX_ROWS = 3;

/** What a waiting layer that published no sentence of its own is given. */
export const ZOOM_PROMPT_FALLBACK_MESSAGE = 'Zoome pour charger cette couche';

/**
 * How long the card takes to leave, in ms.
 *
 * Pressing « Zoomer ici » used to leave the card standing for the whole flight
 * and the settle behind it — 1,6 s of camera, then the 600/1 600 ms re-reads
 * the shell schedules — because the card only withdrew once the LAYER stopped
 * being gated. That reads as a button that did nothing. The press is the
 * answer to the card's question, so the card goes on the press, and comes back
 * only if the flight failed to satisfy the gate.
 *
 * Short enough to read as the same gesture, long enough not to be a cut.
 */
export const ZOOM_PROMPT_LEAVE_MS = 140;

/**
 * Capitalize a layer's sentence without touching the rest of it.
 *
 * The layers disagree about their own first letter — `roadStatusFrance` writes
 * "Zoome sous 20°", `sharedMobilityFrance` writes "zoome pour charger" — and in
 * a row prefixed by a source name neither reads wrong. On a card the sentence
 * starts the line, so it starts like a sentence.
 * @param {string} text
 * @returns {string}
 */
export function zoomPromptSentence(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * The sentence a waiting layer is presented with.
 *
 * `loadingLabel` first — that is the guidance slot, and what the panel row
 * prints. `error` second, because a layer that stored its prompt in the fault
 * field is still entitled to be read (the manager's `_buildMetaText` makes the
 * same allowance for the same reason).
 * @param {object} [stats] Layer `getStats()` result.
 * @returns {string}
 */
export function zoomPromptMessage(stats = {}) {
  const label = typeof stats?.loadingLabel === 'string' ? stats.loadingLabel.trim() : '';
  if (label) return zoomPromptSentence(label);
  const fault = stats?.error || stats?.lastError;
  if (fault) return zoomPromptSentence(String(fault));
  return ZOOM_PROMPT_FALLBACK_MESSAGE;
}

/**
 * The card's heading.
 * @param {number} total Layers waiting, including those past the row cap.
 * @returns {string}
 */
export function zoomPromptTitle(total) {
  return total > 1 ? `${total} couches attendent un zoom` : 'Zoome pour voir cette couche';
}

/**
 * Which switched-on layers are waiting for a closer camera.
 *
 * @param {Array<object>} [layers] Manager `getAll()` rows.
 * @param {{canFly?: function(string): boolean, epoch?: number}} [options]
 *   `canFly` answers whether the layer can carry the camera itself — i.e. whether
 *   its module exposes `ensureViewGate()`. Asked per layer rather than read off
 *   a list here, so the card gains a button the moment a layer gains the method.
 *   `epoch` counts finished flights; see `renderSignature`.
 * @returns {?{rows: Array<object>, hiddenCount: number, total: number, title: string,
 *   signature: string, renderSignature: string}}
 *   Null when nothing is waiting, which is the normal case.
 */
export function zoomPromptModel(layers = [], { canFly = () => false, epoch = 0 } = {}) {
  const waiting = [];
  for (const layer of layers) {
    if (!layer?.enabled) continue;
    // A coordinator with no row of its own (`military-awareness`) has no place
    // on a card either: the reader cannot act on a layer they were never shown.
    if (layer.showInTogglePanel === false) continue;
    // A layer mid-toggle has no settled verdict about the camera yet, and its
    // row is printing ENABLING. Speaking for it would mean announcing a gate
    // that the load about to run may clear on its own.
    const lifecycleState = layer.lifecycleState || '';
    if (lifecycleState === 'enabling' || lifecycleState === 'disabling') continue;
    const stats = layer.stats || {};
    // A load in flight is not a refusal, whatever the last verdict said.
    if (stats.loading === true) continue;
    const status = typeof stats.status === 'string' ? stats.status.toLowerCase() : '';
    if (!ZOOM_PROMPT_STATUSES.has(status)) continue;
    waiting.push({
      id: layer.id,
      label: String(layer.label || layer.name || layer.id),
      message: zoomPromptMessage(stats),
      canFly: canFly(layer.id) === true,
    });
  }
  if (!waiting.length) return null;
  return {
    rows: waiting.slice(0, ZOOM_PROMPT_MAX_ROWS),
    hiddenCount: Math.max(0, waiting.length - ZOOM_PROMPT_MAX_ROWS),
    total: waiting.length,
    title: zoomPromptTitle(waiting.length),
    // Identity of the SITUATION, not of the card: the ids that are waiting, in
    // panel order. A dismissal is remembered against this, so the same card
    // does not come back on the next camera stop — and a different set of
    // layers waiting does bring one.
    signature: waiting.map((row) => row.id).join('|'),
    // Identity of the CARD — what is actually printed on it. A layer can change
    // its sentence without the set of waiting layers changing (a parcel gate
    // that starts naming a count, a ceiling crossed in the other direction),
    // and a card keyed on the situation alone would go on showing the old
    // words. `epoch` is in it because a FAILED flight changes nothing else:
    // without it the button stays disabled on "Zoom en cours…" forever.
    renderSignature: [
      epoch,
      ...waiting.map((row) => `${row.id}:${row.canFly ? 1 : 0}:${row.message}`),
    ].join('|'),
  };
}

/**
 * Whether a model should be on screen right now.
 * @param {?object} model {@link zoomPromptModel} result.
 * @param {string} [dismissedSignature] Signature the reader closed, if any.
 * @param {boolean} [exclusiveSurface] Some other surface owns the screen
 *   (`firstRunExperience.exclusiveSurfaceActive`): cockpit, playback, recording,
 *   clean view. The card yields rather than drawing over them.
 * @param {string} [flyingSignature] The situation a flight is under way FOR.
 *   Not a dismissal: it is released when the flight settles, so a flight that
 *   failed to reach the gate brings the card straight back. Without it, the
 *   card the press dismissed would reappear on the next scheduled re-read,
 *   mid-flight, while the camera is still moving.
 * @param {boolean} [subjectFocused] The reader has CLICKED something — a
 *   followed contact, a selected feature. Not an exclusive surface: the globe
 *   is still the globe and every other control stays where it was. But the
 *   card draws in the middle of the screen, which is exactly where a followed
 *   plane is, and it speaks about layers UNDER that plane which the reader did
 *   not ask about at that moment. The gate has not gone anywhere — the panel
 *   row still says so, and the card comes back the moment the subject is let
 *   go, because this is read fresh on every pass rather than remembered.
 * @returns {boolean}
 */
export function zoomPromptVisible(
  model,
  dismissedSignature = '',
  exclusiveSurface = false,
  flyingSignature = '',
  subjectFocused = false,
) {
  if (!model || exclusiveSurface || subjectFocused) return false;
  if (flyingSignature && model.signature === flyingSignature) return false;
  return model.signature !== dismissedSignature;
}

/**
 * Pending fade-outs, keyed by mount point.
 *
 * A WeakMap rather than a property on the element: the host is a DOM node the
 * app owns, and a harness reading it back should find markup, not bookkeeping.
 */
const zoomPromptHideTimers = new WeakMap();

/**
 * Take the card off the screen, through a short fade when the DOM can do one.
 *
 * The synchronous path is not a fallback for old browsers — it is what the unit
 * tests and the manager's stub document take, and what any caller gets when the
 * card was already hidden. Nothing waits on the fade: `hidden` is set at the end
 * of it either way.
 * @param {HTMLElement} host
 * @returns {void}
 */
function hideZoomPrompt(host) {
  const finish = () => {
    host.hidden = true;
    host.dataset.signature = '';
    host.dataset.leaving = '';
    host.classList?.remove?.('zoom-prompt-leaving');
    if (typeof host.replaceChildren === 'function') host.replaceChildren();
    zoomPromptHideTimers.delete(host);
  };
  if (host.hidden || host.dataset.leaving === '1') {
    if (host.dataset.leaving !== '1') finish();
    return;
  }
  if (typeof host.classList?.add !== 'function' || typeof setTimeout !== 'function') {
    finish();
    return;
  }
  host.dataset.leaving = '1';
  host.classList.add('zoom-prompt-leaving');
  clearTimeout(zoomPromptHideTimers.get(host));
  zoomPromptHideTimers.set(host, setTimeout(finish, ZOOM_PROMPT_LEAVE_MS));
}

/**
 * Paint the card.
 *
 * Rebuilt only when the situation changes. `setCoverageView()` repaints the
 * panel on every camera stop, so a card rebuilt unconditionally would replace
 * its own button under the reader's cursor on every nudge of the globe.
 *
 * Tolerant of the partial `document` stubs the manager's unit tests install:
 * without a real mount point there is simply no card, exactly as
 * `_refreshMapLegend` does with the on-map key.
 *
 * @param {?HTMLElement} host Mount point (`#zoom-prompt`).
 * @param {?object} model {@link zoomPromptModel} result, or null to hide.
 * @param {{onFly?: function(string): any, onDismiss?: function(string): any}} [handlers]
 * @returns {boolean} Whether a card is on screen after this call.
 */
export function renderZoomPrompt(host, model, handlers = {}) {
  if (!host || typeof host.querySelector !== 'function') return false;
  if (!model) {
    hideZoomPrompt(host);
    return false;
  }
  // A card coming back while the previous one is still fading has to cancel
  // that fade, or it would finish by hiding the new one.
  if (host.dataset.leaving === '1') {
    clearTimeout(zoomPromptHideTimers.get(host));
    zoomPromptHideTimers.delete(host);
    host.dataset.leaving = '';
    host.classList?.remove?.('zoom-prompt-leaving');
  }
  host.hidden = false;
  if (host.dataset.signature === model.renderSignature) return true;
  host.dataset.signature = model.renderSignature;

  const doc = host.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return true;

  const header = doc.createElement('div');
  header.className = 'zoom-prompt-header';
  const title = doc.createElement('span');
  title.className = 'zoom-prompt-title';
  title.textContent = model.title;
  header.appendChild(title);

  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'zoom-prompt-close';
  close.title = 'Fermer';
  close.setAttribute('aria-label', 'Fermer');
  close.textContent = '✕';
  close.addEventListener('click', () => handlers.onDismiss?.(model.signature));
  header.appendChild(close);

  const list = doc.createElement('div');
  list.className = 'zoom-prompt-rows';
  for (const row of model.rows) {
    const item = doc.createElement('div');
    item.className = 'zoom-prompt-row';

    const label = doc.createElement('div');
    label.className = 'zoom-prompt-layer';
    label.textContent = row.label;
    item.appendChild(label);

    const message = doc.createElement('div');
    message.className = 'zoom-prompt-message';
    message.textContent = row.message;
    item.appendChild(message);

    if (row.canFly) {
      const fly = doc.createElement('button');
      fly.type = 'button';
      fly.className = 'zoom-prompt-fly';
      fly.textContent = 'Zoomer ici';
      fly.addEventListener('click', () => {
        // The flight takes about 1,6 s and can retry twice. A button that stays
        // pressable through it would queue a second solve against a camera the
        // first one is still moving — and it stays pressable for the length of
        // the fade, which is the whole point of disabling it here rather than
        // relying on the card being gone.
        //
        // It does NOT relabel itself. The card is leaving on this very press;
        // a word changing inside a fading card is a flicker, not a status.
        fly.disabled = true;
        fly.setAttribute('aria-busy', 'true');
        handlers.onFly?.(row.id);
      });
      item.appendChild(fly);
    }
    list.appendChild(item);
  }

  if (model.hiddenCount > 0) {
    const more = doc.createElement('div');
    more.className = 'zoom-prompt-more';
    more.textContent = model.hiddenCount > 1
      ? `+${model.hiddenCount} autres couches`
      : '+1 autre couche';
    list.appendChild(more);
  }

  host.replaceChildren(header, list);
  return true;
}
