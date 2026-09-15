// Unit contract for when the app buys the 3D globe.
//
// ion bills Google Photorealistic 3D Tiles per "root tile", and one root tile
// is one reader. So the question this module answers is a billing question
// wearing a rendering costume: the app opens on the keyless satellite stack,
// and swaps in the photoreal mesh when the reader is close enough that the two
// stop being the same picture.
//
// The trap these pins exist for: `flyToDefaultCity()` descends to 600 m by
// ITSELF on every boot, so a rule that only read the altimeter would fire on
// every page load and save nothing at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTOREAL_ADOPTION_ALTITUDE_M,
  PHOTOREAL_ADOPTION_STACK,
  installPhotorealAdoption,
} from './photorealAdoption.js';

/** A camera whose rest event and altitude the test drives by hand. */
function fakeCamera(height = 1_800_000) {
  const listeners = [];
  return {
    positionCartographic: { height },
    moveEnd: {
      addEventListener: (fn) => listeners.push(fn),
      removeEventListener: (fn) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    },
    listenerCount: () => listeners.length,
    /**
     * Come to rest at `to` metres, and let every listener finish. Called with
     * no argument it rests wherever the altimeter currently says — which is
     * how the unreadable-altitude case is reachable at all.
     */
    async restAt(to) {
      if (to !== undefined && this.positionCartographic) this.positionCartographic.height = to;
      await Promise.all(listeners.slice().map((fn) => fn()));
    },
  };
}

/** A controller stub that records the stacks it was asked for. */
function fakeController({ activeId = PHOTOREAL_ADOPTION_STACK, canLoad = true } = {}) {
  const asked = [];
  return {
    asked,
    getActiveId: () => activeId,
    canLoadPhotoreal: () => canLoad,
    setStack: async (id) => { asked.push(id); activeId = id; },
    pick(id) { activeId = id; },
  };
}

test('the threshold is the height the app itself calls "arrived over a city"', () => {
  assert.equal(PHOTOREAL_ADOPTION_ALTITUDE_M, 25000);
  // Not OSM: from orbit an orthophoto and a photogrammetric mesh are the same
  // picture, and a drawing of the Earth is not.
  assert.equal(PHOTOREAL_ADOPTION_STACK, 'ign-ortho');
});

test('the boot descent arms the watch, it does not trip it', async () => {
  // THE point of the module. `flyToDefaultCity` sets 25 km and flies to 600 m
  // on every boot with no share state, so an altimeter-only rule would buy a
  // root tile on every page load — and this file would save nothing.
  const camera = fakeCamera(25000);
  const controller = fakeController();
  const adoption = installPhotorealAdoption({ camera }, controller);

  // Everything the boot flight does happens before `arm()`.
  await camera.restAt(600);
  assert.deepEqual(controller.asked, [], 'a visitor who only watched the descent pays nothing');
  assert.equal(adoption.isArmed(), false);

  adoption.arm();
  assert.equal(adoption.isArmed(), true);
  assert.deepEqual(controller.asked, [], 'arming is not itself a reason to buy');

  // Cesium raises `flyTo`'s `complete` BEFORE the camera's own `moveEnd`, so
  // the rest immediately after arming is still the boot flight landing. The
  // first browser probe of this module bought a root tile on an untouched boot
  // for exactly this reason.
  await camera.restAt(600);
  assert.deepEqual(controller.asked, [], 'the flight that armed the watch does not trip it');

  // The reader's own first rest, at the same altitude the app had already
  // taken them to, is what buys.
  await camera.restAt(600);
  assert.deepEqual(controller.asked, ['photoreal']);
});

test('a reader who stays high never buys', async () => {
  const camera = fakeCamera();
  const controller = fakeController();
  const adoption = installPhotorealAdoption({ camera }, controller);
  adoption.arm();
  await camera.restAt(1_800_000);   // the app's own arrival, swallowed

  for (const height of [1_800_000, 400_000, 25_001]) {
    await camera.restAt(height);
  }
  assert.deepEqual(controller.asked, []);
  assert.equal(adoption.isSpent(), false, 'still watching — they may yet come down');

  // 25 km exactly is close enough; the threshold is the arrival height.
  await camera.restAt(25_000);
  assert.deepEqual(controller.asked, ['photoreal']);
});

test('it buys once, and stops listening', async () => {
  const camera = fakeCamera();
  const controller = fakeController();
  const adoption = installPhotorealAdoption({ camera }, controller);
  adoption.arm();
  await camera.restAt(1_800_000);   // the app's own arrival, swallowed

  await camera.restAt(5000);
  await camera.restAt(900);
  await camera.restAt(300);
  assert.deepEqual(controller.asked, ['photoreal'], 'one root tile, not three');
  assert.equal(adoption.isSpent(), true);
  assert.equal(camera.listenerCount(), 0, 'the watch releases the camera it no longer needs');
});

test('a deliberate pick retires the watch', async () => {
  // An automatic switch that overrides somebody's choice is a bug. This holds
  // for a pick of the 3D globe itself, which is why the guard is on the ACTIVE
  // id rather than on a "did they choose" flag nobody would remember to set.
  const camera = fakeCamera();
  const controller = fakeController();
  const adoption = installPhotorealAdoption({ camera }, controller);
  adoption.arm();
  await camera.restAt(1_800_000);   // the app's own arrival, swallowed

  controller.pick('osm');
  await camera.restAt(300);
  assert.deepEqual(controller.asked, []);
  assert.equal(adoption.isSpent(), true);
  assert.equal(camera.listenerCount(), 0);
});

test('a build with no door, or one already refused, is not knocked on again', async () => {
  const camera = fakeCamera();
  const controller = fakeController({ canLoad: false });
  const adoption = installPhotorealAdoption({ camera }, controller);
  adoption.arm();
  await camera.restAt(1_800_000);   // the app's own arrival, swallowed

  await camera.restAt(300);
  assert.deepEqual(controller.asked, []);
  assert.equal(adoption.isSpent(), true);
});

test('a viewer with no camera is inert rather than fatal', () => {
  // Tests and tools build partial viewers; a basemap optimisation must never
  // be the thing that stops the app from opening.
  const adoption = installPhotorealAdoption({}, fakeController());
  adoption.arm();
  assert.equal(adoption.isArmed(), false);
  assert.equal(adoption.isSpent(), true);
  assert.doesNotThrow(() => adoption.dispose());
});

test('an unreadable altitude is treated as far away, never as close', async () => {
  // Fail-closed: the failure that costs money is buying when nobody asked.
  const camera = fakeCamera();
  const controller = fakeController();
  const adoption = installPhotorealAdoption({ camera }, controller);
  adoption.arm();
  await camera.restAt(1_800_000);   // the app's own arrival, swallowed

  camera.positionCartographic = null;
  await camera.restAt();
  assert.deepEqual(controller.asked, [], 'no altitude is not a low altitude');
  assert.equal(adoption.isSpent(), false, 'and it keeps watching for one it can read');

  camera.positionCartographic = { height: Number.NaN };
  await camera.restAt();
  assert.deepEqual(controller.asked, []);

  // A readable one still works afterwards.
  camera.positionCartographic = { height: 800 };
  await camera.restAt(800);
  assert.deepEqual(controller.asked, ['photoreal']);
});
