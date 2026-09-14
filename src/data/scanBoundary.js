/**
 * The edge of what a scan looked at, drawn on the ground.
 *
 * WHY THIS EXISTS, in the reader's own words: « j'ai l'impression que le nombre
 * d'éléments affiché est limité — y a qu'un pan de la vue qui est dessiné ».
 * They were right about the fact and the layer gave them no way to know it. A
 * disc of markers in the middle of an otherwise empty city looks like a broken
 * layer; the same disc with its edge drawn looks like a probe, which is what it
 * is. The boundary converts an apparent fault into a stated limit, and it costs
 * one polyline.
 *
 * IT IS AN INSTRUMENT MARK, NOT DATA, and everything about it says so: dashed,
 * dim, one colour for every layer that draws one, and marked
 * {@link SCAN_BOUNDARY_KIND} so `cardFromEntity` refuses to index it. That
 * refusal has to be explicit: an entity with no name and no description is
 * still given a card by the shell, titled with its own id, because a polyline
 * yields a position through `polylineAnchor`. A reader must never be able to
 * click "the edge of the scan" and be shown a panel called `dvf:scan-edge`.
 *
 * NEVER COUNTED. The layers return the number of subjects they drew, and that
 * number reaches the panel row; a boundary that incremented it would make every
 * count in the app one too many.
 *
 * @module data/scanBoundary
 */

import * as Cesium from 'cesium';
import { SCAN_BOUNDARY_KIND, discRing } from './scanCells.js';

export { SCAN_BOUNDARY_KIND };

/**
 * The instrument colour, shared by every layer that draws a boundary.
 *
 * One colour on purpose. Two layers scanning the same ground draw two edges —
 * the DVF's 300 m disc and the DPE's 200 m one — and if each wore its own
 * ramp's accent, a reader would try to decode the edges as classes. A single
 * neutral that belongs to no ramp reads as chrome.
 */
export const SCAN_BOUNDARY_CSS = '#8fa3bd';


const BOUNDARY_ALPHA = 0.55;
const BOUNDARY_WIDTH_PX = 1.2;
const DASH_LENGTH_PX = 12;

/** 96 segments: a 1 km circle stays a circle at the widest these layers draw. */
const CIRCLE_SEGMENTS = 96;

/**
 * Draw the edge of a scan — a circle for the disc regime, a rectangle for the
 * box one.
 *
 * @param {object} dataSource The layer's own data source.
 * @param {object} options
 * @param {string} options.id Stable entity id, unique per layer.
 * @param {?{lat: number, lon: number}} [options.centre] Disc centre.
 * @param {?number} [options.radiusM] Disc radius; with `centre`, draws a circle.
 * @param {?object} [options.box] `{south, west, north, east}`; draws a rectangle.
 * @returns {boolean} Whether anything was drawn.
 */
export function drawScanBoundary(dataSource, { id, centre, radiusM, box }) {
  if (!dataSource || !id) return false;
  let ring = null;
  if (box && [box.south, box.west, box.north, box.east].every(Number.isFinite)) {
    // Densified along each side, not four corners: a rectangle in degrees is
    // not a straight line on a globe, and at the coarse band's 9 km a four-point
    // outline cuts visibly inside its own box.
    ring = [];
    const steps = 24;
    const lerp = (a, b, t) => a + ((b - a) * t);
    for (let i = 0; i < steps; i += 1) ring.push([lerp(box.west, box.east, i / steps), box.south]);
    for (let i = 0; i < steps; i += 1) ring.push([box.east, lerp(box.south, box.north, i / steps)]);
    for (let i = 0; i < steps; i += 1) ring.push([lerp(box.east, box.west, i / steps), box.north]);
    for (let i = 0; i < steps; i += 1) ring.push([box.west, lerp(box.north, box.south, i / steps)]);
  } else if (centre && Number.isFinite(centre.lat) && Number.isFinite(centre.lon)
    && Number.isFinite(radiusM) && radiusM > 0) {
    ring = discRing(centre.lon, centre.lat, radiusM, CIRCLE_SEGMENTS);
  }
  if (!ring || ring.length < 3) return false;
  const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
  dataSource.entities.add({
    id,
    // No `name` and no `description`, AND the kind that makes the refusal
    // explicit — see the header for why the first two are not enough.
    properties: { kind: SCAN_BOUNDARY_KIND },
    polyline: {
      positions: [...positions, positions[0]],
      width: BOUNDARY_WIDTH_PX,
      // A FRESH MATERIAL EVERY TIME. Sharing one across polylines is the
      // `destroy` crash documented in `cesium-polylinecollection-traps`, and a
      // boundary is rebuilt on every scan.
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString(SCAN_BOUNDARY_CSS).withAlpha(BOUNDARY_ALPHA),
        dashLength: DASH_LENGTH_PX,
      }),
      clampToGround: true,
    },
  });
  return true;
}
