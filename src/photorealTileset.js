/**
 * GOOGLE PHOTOREALISTIC 3D TILES — two doors, tried in order.
 *
 * Door 1, the fork's own Google key. Google withdrew `3dtiles` and satellite
 * imagery from projects billed to an EEA address on 2025-07-08. The block is
 * keyed on the BILLING ADDRESS of the project, never on where the reader sits,
 * and it is surgical: on the very same key `createSession mapType:roadmap`
 * still answers 200 — which is why this repo's Google 2D stacks work while the
 * "Google 3D" chip is grey. No amount of billing repair moves it, and Google
 * does not let an existing billing account change country.
 *
 * Door 2, Cesium ion. ion publishes the same tileset as asset 2275207 under
 * CESIUM's Google contract: its endpoint hands back a plain
 * `tile.googleapis.com/v1/3dtiles/root.json` URL carrying Cesium's own key, so
 * the project Google sees is Cesium's, in the US. Measured from France on
 * 2026-09-09 with a free ion Community token: root.json 200, and a descent
 * over the Eiffel Tower pulled real glTF meshes down to a 16 m geometric
 * error. The door Google shut is open one hop to the left.
 *
 * The order is not cosmetic. A key billed OUTSIDE the EEA serves the tiles on
 * the operator's own quota and with no extra credit; the free ion tier is
 * "personal and non-commercial use" and serves an "Upgrade for commercial
 * use." credit that Cesium requires on screen (`IonResource` attaches it, and
 * the credit container is pinned visible — see `creditAttribution.test.mjs`).
 * So ion is the fallback, never the preference.
 *
 * Nothing is attempted when neither credential exists: an empty attempt list
 * beats "call it and catch", which spends a doomed round-trip on boot and then
 * reports a network error as if something had gone wrong. Nothing has — that
 * is the keyless build.
 */

/**
 * ion asset for Google Photorealistic 3D Tiles. The same id CesiumJS itself
 * falls back to inside `createGooglePhotorealistic3DTileset()` when no Google
 * key is configured — we open it explicitly rather than by clearing a global,
 * so a key that IS configured (for geocoding, for the 2D stacks) cannot
 * silently close this door.
 */
export const GOOGLE_PHOTOREAL_ION_ASSET_ID = 2275207;

/**
 * Window flag that closes the photoreal door for a whole browser session.
 *
 * WHY A SWITCH EXISTS AT ALL. ion meters this tileset by "root tiles", and its
 * definition of one is a single successful `GET /v1/assets/<id>/endpoint` —
 * so **one boot of this app is one billed session**, whatever the reader then
 * does or doesn't look at. The free Community tier allows 1 000 a month;
 * `scripts/` holds 113 harnesses that each boot the app, across a dozen
 * workspaces sharing one token, and on 2026-09-15 they took the account to
 * 1 001 of 1 000 by the fifteenth of the month. The contrast that proved it
 * was in the same invoice: Bing imagery, which only loads when somebody CLICKS
 * its chip, stood at 15.
 *
 * TWO DOORS, DELIBERATELY. `?photoreal=0` is the one a human types; the window
 * flag is the one `scripts/lib/qa-first-run.mjs` installs with
 * `evaluateOnNewDocument`. The harness fleet cannot use the URL, for the same
 * reason the first-run card is not suppressed with `?welcome=0`: harnesses
 * assert on, rebuild and compose URLs mid-run (share links, `?map=`, deep
 * links), so a query param silently falls off exactly when a run navigates —
 * and here that would not just lose the saving, it would flip the surface
 * regime under a height assertion halfway through.
 *
 * NOT A FALLBACK, AND NOT A FAILURE. A build that boots with this set has no
 * tileset, so the photoreal chip is unavailable — but it did not fail, it was
 * never asked. `MapStackController` is told separately (`photorealDisabled`)
 * so the chip says that rather than blaming the credentials.
 */
export const PHOTOREAL_DISABLE_GLOBAL = '__GEV_DISABLE_PHOTOREAL__';

/**
 * Whether this session must not spend an ion root tile on the 3D globe.
 *
 * @param {object} [scope] - Global to read; injected so this is testable.
 * @returns {boolean}
 */
export function photorealDisabled(scope = globalThis) {
  if (scope?.[PHOTOREAL_DISABLE_GLOBAL] === true) return true;
  // Only the explicit `0`. `?photoreal=1` and a missing param both mean "load
  // it" — an unrecognised value must not quietly disable the app's own default
  // basemap, which is the one thing a typo here could cost.
  return new URLSearchParams(scope?.location?.search || '').get('photoreal') === '0';
}

/**
 * Tileset options, mirroring the ones CesiumJS applies in
 * `createGooglePhotorealistic3DTileset()`. Returned fresh each call because
 * Cesium writes its own defaults into the object it is handed.
 * @returns {object}
 */
export function photorealTilesetOptions() {
  return {
    cacheBytes: 1536 * 1024 * 1024,
    maximumCacheOverflowBytes: 1024 * 1024 * 1024,
    enableCollision: true,
  };
}

/** @returns {string} A one-line cause, whatever shape the thrower used. */
function describe(error) {
  if (!error) return 'unknown error';
  if (error instanceof Error) return (error.message || error.name || 'error').trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  const message = String(error?.message || error?.error || '').trim();
  if (message) return message;
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch { /* circular — fall through */ }
  return String(error);
}

/**
 * Loads Google Photorealistic 3D Tiles through whichever door opens.
 *
 * @param {object} Cesium - The CesiumJS namespace (injected so this is testable).
 * @param {object} options
 * @param {string} [options.googleApiKey] - Google Maps Platform key, if the build has one.
 * @param {string} [options.ionToken] - Cesium ion access token, if the build has one.
 * @param {(source: string) => void} [options.onAttempt] - Called with `google-key` / `ion` before each try.
 * @returns {Promise<{tileset: object|null, source: string|null, errors: Array<{source: string, message: string}>}>}
 */
export async function loadPhotorealTileset(Cesium, {
  googleApiKey = '',
  ionToken = '',
  onAttempt = null,
} = {}) {
  const attempts = [];
  if (googleApiKey) {
    attempts.push({
      source: 'google-key',
      // The key is passed EXPLICITLY rather than read from
      // `Cesium.GoogleMaps.defaultApiKey`, so the ion attempt below is not at
      // the mercy of a global set elsewhere in boot.
      run: () => Cesium.createGooglePhotorealistic3DTileset(
        { key: googleApiKey, onlyUsingWithGoogleGeocoder: true },
        photorealTilesetOptions(),
      ),
    });
  }
  if (ionToken) {
    attempts.push({
      source: 'ion',
      run: async () => {
        const resource = await Cesium.IonResource.fromAssetId(
          GOOGLE_PHOTOREAL_ION_ASSET_ID,
          { accessToken: ionToken },
        );
        return Cesium.Cesium3DTileset.fromUrl(resource, photorealTilesetOptions());
      },
    });
  }

  const errors = [];
  for (const attempt of attempts) {
    if (onAttempt) onAttempt(attempt.source);
    try {
      const tileset = await attempt.run();
      if (tileset) return { tileset, source: attempt.source, errors };
      errors.push({ source: attempt.source, message: 'no tileset returned' });
    } catch (error) {
      errors.push({ source: attempt.source, message: describe(error) });
    }
  }
  return { tileset: null, source: null, errors };
}

/**
 * The failure line the map-source chip shows. Names the door when both were
 * tried, because "failed to load" on a build that has a key AND an ion token
 * otherwise hides which one is actually broken.
 * @param {Array<{source: string, message: string}>} errors
 * @returns {string}
 */
export function describePhotorealFailure(errors) {
  const listed = (errors || []).filter((entry) => entry && entry.message);
  if (!listed.length) return '';
  if (listed.length === 1) return listed[0].message;
  const LABELS = { 'google-key': 'Google key', ion: 'Cesium ion' };
  return listed.map((entry) => `${LABELS[entry.source] || entry.source}: ${entry.message}`).join(' · ');
}
