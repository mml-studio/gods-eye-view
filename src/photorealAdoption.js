/**
 * WHEN THE 3D GLOBE IS WORTH BUYING.
 *
 * Cesium ion meters Google Photorealistic 3D Tiles by "root tile", and one root
 * tile is one successful request for the tileset — so the fetch is the charge,
 * and it is charged per reader. The free tier is 1 000 a month; the paid ones
 * are 5 000 for $149 and 10 000 for $499. At one root tile per visitor, a
 * public opening on the photoreal globe plateaus at about 160 visitors a day
 * for the most expensive plan, and a single post that works exceeds it in an
 * afternoon.
 *
 * So the app opens on a keyless satellite basemap and adopts the 3D globe when
 * the reader is close enough for it to be the thing they came for. Above the
 * threshold the two are the same picture — an orthophoto and a photogrammetric
 * mesh seen from orbit are indistinguishable — and below it they are not
 * remotely the same picture, because one has buildings.
 *
 * WHY THE APP'S OWN ARRIVAL DOES NOT COUNT, which is the whole subtlety here.
 * `flyToDefaultCity()` sets the camera at 25 km over Paris and then flies it to
 * **600 m** in four seconds, on every boot with no share state. A rule that
 * only read the altimeter would therefore fire on every single page load, five
 * seconds in, and this module would save nothing at all while making the first
 * five seconds worse. The reader's own movement is the signal, not the
 * altitude the app took them to by itself — so the boot flight arms the watch
 * rather than triggering it, and the next rest below the threshold is the one
 * that buys.
 *
 * ARMING SWALLOWS ONE REST, and that is not belt-and-braces. Measured here on
 * 2026-09-15: Cesium raises `flyTo`'s `complete` callback BEFORE the camera's
 * own `moveEnd` for the same flight, so a watch armed from `complete` is armed
 * in time to be tripped by the very flight that armed it — which is exactly
 * what the first browser probe of this module did, buying a root tile on a
 * boot nobody had touched. The first rest after arming is therefore the app's
 * own arrival, by construction, and is skipped.
 *
 * A visitor who lands, watches the descent and leaves costs nothing. A visitor
 * who takes hold of the camera gets the 3D globe on their first rest.
 *
 * WHAT NEVER FIRES IT. A deliberate pick from the map-source tray — including
 * a pick of `photoreal` itself — retires this for the session: an automatic
 * switch that overrides somebody's choice is a bug, not a feature. So does a
 * refused purchase, which the controller has already greyed the chip for.
 */

/**
 * Altitude, in metres, under which the photoreal mesh is the better picture.
 *
 * 25 km is not a guess: it is `DEFAULT_CITY_VIEW.approachAltitudeM`, the height
 * the app itself considers "arrived over a city", and the same height
 * `groundHeight` uses to stop paying for terrain samples. Above it a reader is
 * looking at a region, not at a place.
 */
export const PHOTOREAL_ADOPTION_ALTITUDE_M = 25000;

/**
 * What the app opens on instead of the 3D globe.
 *
 * The keyless satellite stack, not OSM: from orbit an orthophoto and a
 * photogrammetric mesh are the same picture, and a drawing of the Earth is
 * not. It also costs the account nothing — IGN's Géoplateforme is keyless and
 * the world base beneath it is free — which is the entire reason this stack
 * and not Google's 2D cartography, which is metered.
 */
export const PHOTOREAL_ADOPTION_STACK = 'ign-ortho';

/**
 * Watch the camera and adopt the 3D globe once, when it is worth it.
 *
 * @param {object} viewer - Cesium viewer.
 * @param {object} controller - The live {@link MapStackController}.
 * @param {object} [options]
 * @param {number} [options.altitudeM] - Threshold; see {@link PHOTOREAL_ADOPTION_ALTITUDE_M}.
 * @param {string} [options.fromStackId] - Only adopt while THIS stack is still
 *   the active one. Anything else means the reader has chosen, or another
 *   mechanism has.
 * @param {(info: {altitudeM: number}) => void} [options.onAdopt] - Diagnostics.
 * @returns {{arm: () => void, dispose: () => void, isArmed: () => boolean, isSpent: () => boolean}}
 */
export function installPhotorealAdoption(viewer, controller, {
  altitudeM = PHOTOREAL_ADOPTION_ALTITUDE_M,
  fromStackId = PHOTOREAL_ADOPTION_STACK,
  onAdopt = null,
} = {}) {
  let armed = false;
  let spent = false;
  let listening = false;
  // See ARMING SWALLOWS ONE REST above.
  let skipNextRest = false;

  const camera = viewer?.camera;
  if (!camera?.moveEnd) {
    return { arm() {}, dispose() {}, isArmed: () => false, isSpent: () => true };
  }

  const dispose = () => {
    spent = true;
    armed = false;
    if (listening) {
      camera.moveEnd.removeEventListener(onRest);
      listening = false;
    }
  };

  function currentAltitude() {
    const height = camera.positionCartographic?.height;
    return Number.isFinite(height) ? height : Number.POSITIVE_INFINITY;
  }

  async function onRest() {
    if (!armed || spent) return;
    if (skipNextRest) {
      // The app's own arrival. Not a reason to buy anything.
      skipNextRest = false;
      return;
    }
    // The reader has moved on — to another basemap, or to the 3D globe by
    // hand. Either way this watch has nothing left to decide.
    if (controller.getActiveId() !== fromStackId) {
      dispose();
      return;
    }
    if (!controller.canLoadPhotoreal()) {
      // No door, or a door that has already been tried and refused. Retrying
      // would re-bill a root tile to re-learn the same answer.
      dispose();
      return;
    }
    const height = currentAltitude();
    if (height > altitudeM) return;

    // Spend BEFORE the await: a second rest arriving while the tileset is in
    // flight must not start a second adoption.
    dispose();
    onAdopt?.({ altitudeM: height });
    await controller.setStack('photoreal');
  }

  return {
    /**
     * Start watching. Called once the app's OWN opening move has finished, so
     * the descent it performs by itself is not mistaken for the reader zooming
     * in — see the note at the top of this file.
     */
    arm() {
      if (spent || armed) return;
      armed = true;
      skipNextRest = true;
      if (!listening) {
        camera.moveEnd.addEventListener(onRest);
        listening = true;
      }
    },
    dispose,
    isArmed: () => armed,
    isSpent: () => spent,
  };
}
