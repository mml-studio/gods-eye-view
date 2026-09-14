import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { pickOverlayLabelId } from './overlayLabelPick.js';
import { isOwnedByOtherLayer, registerPickOwner, unregisterPickOwner } from './pickRegistry.js';

/**
 * USGS earthquakes — last 24 hours, M2.5+, drawn as a 3D phenomenon.
 *
 * ── What this draws ─────────────────────────────────────────────────────────
 *
 *   · a POINT at the epicentre, clamped to the ground, whose diameter is in
 *     CONSTANT SCREEN PIXELS and carries the MAGNITUDE;
 *   · a vertical LINE rising from that epicentre whose length, in world
 *     metres at 1:1, is the FOCAL DEPTH — an inverted depth ruler, not the
 *     position of the focus (see "why the ruler points up");
 *   · one COLOUR shared by the point and its ruler, carrying the AGE of the
 *     event inside the 24 h window (A2).
 *
 * ── What it replaced, and why ───────────────────────────────────────────────
 *
 * Until this rewrite the layer drew one CLAMP_TO_GROUND ellipse per event of
 * radius `2^magnitude × 1000` metres, tinted red / orange / yellow by depth
 * band. Two faults, both named in `docs/REPRESENTATION.md`:
 *
 * (1) THE RADIUS MEASURED NOTHING. `2^M × 1000 m` is not the rupture area, not
 *     the felt radius, not an isoseismal, not a ShakeMap contour. It is a
 *     decorative exponential wearing the costume of a measurement: 5.6 km at
 *     M2.5, 128 km at M7, 512 km at M9. A reader saw a footprint and there was
 *     no footprint. Worse, it was drawn in WORLD units, so the mark also broke
 *     B2 — screen size on a globe is already spent on depth, and a distant M7
 *     could render smaller than a nearby M3 under a legend claiming otherwise.
 *
 * (2) DEPTH — a continuous quantitative variable — WAS ENCODED IN HUE, red →
 *     orange → yellow. B4: « la teinte n'ordonne pas ». That ramp reads as a
 *     SEVERITY scale, so a 600 km-deep event, whose depth is the single
 *     remarkable thing about it, was painted yellow and therefore "mild".
 *
 * ── A3 · what each channel carried, and what it carries now ────────────────
 *
 *   | channel        | before                    | now                        |
 *   |----------------|---------------------------|----------------------------|
 *   | world radius   | 2^magnitude (meaningless) | not used                   |
 *   | hue            | depth band                | AGE in the 24 h window     |
 *   | fill alpha     | M5+ emphasis (redundant)  | constant                   |
 *   | outline width  | M5+ emphasis (redundant)  | constant                   |
 *   | screen pixels  | not used                  | MAGNITUDE                  |
 *   | world height   | not used                  | DEPTH, 1:1                 |
 *
 * The M5+ emphasis was a second, coarser copy of the magnitude channel; with
 * magnitude now on a continuous pixel scale it is deleted rather than kept
 * "for punch". Alpha and outline width are constants and say nothing.
 *
 * ── Magnitude → pixels: the relation, and why this one ─────────────────────
 *
 * `pixelSize = 6 + 3 × (M − 2.5)`, clamped to the frozen domain M2.5…M9.5
 * (C1 — the feed floor and the largest instrumentally recorded earthquake,
 * Valdivia 1960 at Mw 9.5). So M2.5 → 6 px, M5 → 13.5 px, M7 → 19.5 px,
 * M9 → 25.5 px, and every whole magnitude step is the same 3 px step.
 *
 * The two alternatives were rejected with arithmetic, not taste:
 *
 *   · AREA ∝ ENERGY, the Bertin proportional circle applied to what the event
 *     actually released. Mw = ⅔·log₁₀(M₀) − 6.06, so one magnitude unit is
 *     ×31.6 of seismic moment and the diameter would go as 10^(0.75·M): from
 *     M2.5 to M9 that is a factor 10^4.875 ≈ 75 000. A 6 px M2.5 makes a
 *     450 000 px M9. Undrawable, so unusable.
 *   · AREA ∝ MAGNITUDE, treating the published number as if it were a count.
 *     Diameter would go as √M: M9 would be 1.9× the diameter of M2.5. The most
 *     important event on the map would be twice a background tremor. Under-
 *     stating by 4 decimal orders is not more honest than overstating.
 *
 * A diameter LINEAR IN MAGNITUDE encodes the number the feed publishes and the
 * number the reader has heard on the radio, and it puts equal magnitude steps
 * at equal pixel steps — which is exactly how the scale is quoted. The key says
 * so in six words and the card of any event says it again with that event's own
 * numbers: the mark measures the MAGNITUDE, not the energy. An M7 disc is 3.25×
 * the M2.5 disc across while releasing about 5.6 million times the energy, and
 * that gap belongs written down, not hidden in a radius.
 *
 * Pixels, not metres: `PointGraphics.pixelSize` is constant on screen and is
 * never composed with `scaleByDistance` here (B2). Deliberately no
 * `scaleByDistance`, no `translucencyByDistance`, no `distanceDisplayCondition`
 * on the mark — any of the three would multiply the thematic size by a
 * function of range and reintroduce the inversion this rewrite removes.
 *
 * ── Depth → a vertical ruler, and why it points UP ─────────────────────────
 *
 * A focus IS below its epicentre and a globe CAN draw it there, so the first
 * design put the stem underground. It cannot be made honest, and the reason is
 * that the globe is opaque. Three options were built and looked at in a real
 * browser (Chromium, dev server, live USGS feed, 2026-09-03):
 *
 *   (a) STEM UNDERGROUND WITH `disableDepthTestDistance`. Built and looked at.
 *       It draws THROUGH THE PLANET, and the size of that lie was counted
 *       rather than guessed: parked over the antipode of the day's deepest
 *       event (Fiji, 581 km), 26 of the 28 M2.5+ events were on the FAR
 *       hemisphere and all 26 projected inside the 1440×900 viewport. With the
 *       depth test defeated the frame therefore shows 28 marks of which 26 are
 *       phantoms — verified on screen, with Fijian and Tongan events painted
 *       over Mali, Niger, Türkiye and the United Kingdom. That is the X-ray
 *       image F1 forbids, and a hemisphere the reader is not looking at
 *       leaking into the one they are.
 *       A second failure, subtler and worse, showed up in the grazing view: an
 *       underground stem drawn with `depthFailMaterial` projects into exactly
 *       the same screen direction as a line lying FLAT on the water running
 *       toward the camera. Seen from above, "down" and "toward me" are the
 *       same pixels. The sign cannot mean depth even when the reader is
 *       willing to believe it does.
 *   (b) STEM UNDERGROUND WITH `scene.globe.translucency`. Measured for the
 *       record before being rejected. `frontFaceAlpha = 0.45`, same camera,
 *       same live feed, took the WHOLE SCENE from a 0.30 ms median
 *       `scene.render()` to 1.30–2.40 ms median and 3.50–7.30 ms p90 across
 *       two runs — a factor of four to eight, paid by every other enabled
 *       layer, for one layer's symbology. And the scope objection stands on
 *       its own: `scene.globe` is a GLOBAL object owned by no layer, and
 *       turning the planet transparent repaints every other reading on the
 *       map. One layer's symbology may not redefine the planet.
 *   (c) THE RULER ABOVE THE SURFACE — chosen. The line rises from the
 *       epicentre and its LENGTH is the depth, at 1:1. It is a declared
 *       reading device, not a position claim, and the legend says exactly
 *       that: « la tige monte, le foyer descend ». A1 is satisfied because the
 *       sign asserts no position that was not measured — the only position it
 *       asserts is the epicentre, which IS measured, and the only length it
 *       asserts is the depth, which IS measured. At the antipode nothing from
 *       the far hemisphere appears at all: the two marks genuinely in view are
 *       the two marks drawn.
 *
 * 1:1 and not exaggerated, which self-scales rather well. Seen on screen on
 * the live feed, on the Fiji event at 581 km and its 145 km neighbour:
 *
 *   · 1 400 km slant range, 40° pitch — the 581 km ruler runs off the top of
 *     the frame while the 145 km one is about a third of its height. The two
 *     depths are read against each other in one glance, which is the whole
 *     point and is what the old three colour bands could never do.
 *   · 900 km range, 4° pitch (horizon view) — both rulers stand vertically
 *     against the sky, unambiguous, and the epicentre marks sit on the limb.
 *   · 40 km regional altitude — a 10 km ruler is the tall object in frame.
 *
 * The one honest limit, and it is inherent to any vertical encoding on a
 * globe: AT NADIR A VERTICAL LINE HAS NO SCREEN LENGTH. Straight down over the
 * Fiji event from 14 000 km, the 581 km ruler is foreshortened to nothing and
 * only the magnitude marks read. The ruler's legibility is a function of
 * camera PITCH, not of altitude, and the reader tilts to read depth exactly as
 * they would to read any prism on this globe. That is stated rather than
 * papered over with a billboard.
 *
 * An exaggeration factor would have had to be published, defended and
 * remembered; 1:1 needs none of that, and it keeps the ruler measurable
 * against the anchored ground scale (F2).
 *
 * DATUM, stated because it is a real approximation. USGS publishes depth below
 * sea level, and the ruler's foot is placed on the WGS84 ellipsoid (h = 0),
 * not on the terrain: the anchor and the measurement then share one datum, and
 * two readers of the same share link get the same ruler. The cost is that over
 * relief the first kilometres of the ruler are inside the mountain — up to
 * ~8.8 km at the extreme, more usually a few hundred metres — so the VISIBLE
 * ruler under-reads by the local elevation. It is not corrected by sampling
 * terrain: `globe.getHeight()` answers from whatever tiles happen to be
 * loaded, which would make the same event draw a different length in two
 * sessions. A deterministic small error beats a non-reproducible small
 * correction. The epicentre point is CLAMP_TO_GROUND, so it always sits on the
 * visible surface and the ruler emerges exactly from it.
 *
 * ── Colour → age, freed by the geometry (A2) ───────────────────────────────
 *
 * Four frozen bands — ≤1 h, 1–6 h, 6–12 h, 12–24 h — on a single warm hue
 * varying in VALUE, so the order survives greyscale as B4 demands. Measured
 * sRGB relative luminance: 0.891 → 0.603 → 0.320 → 0.105, strictly decreasing,
 * every neighbouring pair separated by a factor ≥ 1.5. An event twenty minutes
 * old and one twenty-three hours old are now different marks without opening
 * anything.
 *
 * The bands are DOMAIN thresholds (C1): they are hours, not quantiles, they are
 * never recomputed from the current feed or the current view, and the same
 * event reads the same in two sessions.
 *
 * ── A1 · the three fallbacks, all visible, all counted ─────────────────────
 *
 *   · AGE NOT PUBLISHED (no `time`, or a timestamp more than 5 min in the
 *     future, i.e. a clock nobody can trust): slate `#7f8c99`, off the warm
 *     ramp entirely, with its own legend row and count. Its greyscale
 *     luminance (0.256) does sit between the 6–12 h and 12–24 h bands, and
 *     that is accepted rather than fixed: « non publié » is a NOMINAL state,
 *     not a rank on the ordered scale, and B4 gives hue exactly that job —
 *     hue differentiates, value orders.
 *   · DEPTH NOT PUBLISHED: no ruler at all, and the point is drawn HOLLOW —
 *     transparent fill, coloured ring. A missing ruler alone would be
 *     ambiguous with a shallow one, so the shape carries the distinction and
 *     the legend counts the row.
 *   · DEPTH MEASURED AT OR ABOVE SEA LEVEL (USGS publishes 0.0 km, and
 *     negative depths for shallow and induced events): a floor ruler of 1 km
 *     is drawn, because « mesuré à zéro » must not render as « non mesuré ».
 *     Same argument as `choroplethPrism`'s 1 px baseline, same legend row.
 *
 * ── A5 · what is clipped ───────────────────────────────────────────────────
 *
 * Every event above M2.5 in the feed is DRAWN. What is capped is the floating
 * magnitude LABEL: {@link EARTHQUAKE_OVERLAY_COHORT_LIMIT} of them, selected
 * by descending magnitude with the event id as tie-break
 * ({@link selectEarthquakeOverlayCohort}). The key publishes
 * « n étiquettes / N séismes » and the criterion, in its `note` slot, whenever
 * the cap bites.
 *
 * ── D1 · what the key answers, and what the card answers ───────────────────
 *
 * The key used to hold both — a numbered tick for each of four magnitudes,
 * another four for depth, and four titled paragraphs of caveat. Measured in
 * Chrome at 1440×900 on the live feed of 2026-09-10 (29 events, this layer
 * alone), that key was 827 px of content inside the 216 px window the rail
 * gives it: THREE QUARTERS OF IT WAS SCROLLED OUT OF SIGHT of the map it
 * exists to key. It is now 215 px, so on that feed it fits without scrolling
 * at all — 31 lines and 375 words become 11 and 93. The split runs along the
 * line CARTOGRAPHIE D1 draws:
 *
 *   · THE KEY answers « what does this colour mean », because that is the one
 *     question no shape answers by itself, and it publishes the DOMAIN of the
 *     two channels that are shapes — M2.5…M9.5 and 0…700 km. That is what
 *     #141 did to the buoy scale and #166 to the road ladder: a graduated
 *     ruler of one ink whose rows differ only in size is not a key, it is the
 *     mark reprinted n times, and one line stating its bounds replaces it.
 *   · THE CARD answers « what is THIS event », on click, in the words of
 *     someone who has never read a seismology page: how hard it shook, where,
 *     when, how deep.
 *
 * The A1 fallbacks split the same way. « profondeur non publiée » keeps its
 * key row, because a hollow ring is a shape a reader decodes WRONG without a
 * key — they read it as a small event. « tige plancher » and the label cap do
 * not: neither is visible on the map as anything, both are disclosures, and
 * disclosures have their own slot (`note`) under the classes they qualify.
 *
 * ── D3 · the card stopped explaining its own rendering ─────────────────────
 *
 * The card shipped by #175 opened on « 13,2 px : la magnitude, pas l’énergie —
 * +1 sur l’échelle vaut ×31,6 d’énergie », closed on « us7000th81 », and told
 * the reader between the two that « la tige porte cette longueur VERS LE
 * HAUT ». Three of its six lines were about the MARK. A reader who clicks a
 * dot is asking about an earthquake, not about a disc: the pixel diameter of
 * the thing they just clicked is the one fact they can already see, the USGS
 * event id is an opaque string with nowhere to paste it, and the ruler's
 * direction is a property of the drawing.
 *
 * None of that is lost, because none of it was ever the card's to hold: the
 * key already publishes « Ni énergie, ni emprise » under the magnitude row and
 * « À l’échelle 1:1, et vers le haut » under the depth row, `buildEarthquakeNote`
 * already carries the 1 km floor rupture, and the event id still travels as the
 * overlay entry's own `id` (`earthquake-card:us7000th81`). What the card prints
 * now is what only the card can say about THIS event, plus the two things that
 * turn a number into a fact for a reader who does not know the scale:
 *
 *   · A PLAIN-LANGUAGE CLASS for the magnitude ({@link EARTHQUAKE_MAGNITUDE_CLASSES})
 *     and one sentence of what that class does at the surface. « M4,9 » is a
 *     number no one outside the field can place; « secousse modérée — ressentie
 *     sur place, dégâts rares » is the same measurement, decoded.
 *   · A GAUGE ({@link magnitudeGauge}) spanning the layer's own frozen domain,
 *     M2.5…M9.5, so the card and the key agree on where the scale stops. Full
 *     cells filled against empty ones, never the `▁▂▃▄` ramp `sparkline.js`
 *     owns: bars of differing HEIGHT mean a series over time everywhere else
 *     in this repo, and one magnitude is not a series.
 *
 * The depth line keeps the datum wording it had — « sous le niveau de la mer »,
 * signed, never a double negative — and trades the ruler's direction for the
 * one thing depth changes for a reader: shallow shakes harder
 * ({@link EARTHQUAKE_DEPTH_CLASSES}, the 70/300 km boundaries seismology uses).
 *
 * The clock moved from UTC to the READER's local day, against the D2 argument
 * below that two readers of one share link must read the same card. D2 loses
 * here: « 2026-09-13 19:41 UTC » is unreadable at a glance for the audience
 * this fork is in French for, and the ambiguity it trades into — whose evening
 * is 21 h 41 — is closed by naming the clock on the line (« chez vous »)
 * instead of by making everyone read Zulu.
 *
 * ── F1 · occlusion policy: regime (a), occluded ────────────────────────────
 *
 * Point and ruler both keep the depth test. Behind a mountain or a
 * photorealistic building they disappear, like anything else in the world.
 * Nothing here is drawn as "guessed", because nothing here needs to be.
 *
 * ── Performance ────────────────────────────────────────────────────────────
 *
 * The pin inherited from the 2026-08-20 hunt still holds and still matters:
 * axes/geometry are STATIC, redefined only when a poll brings new data, and a
 * `CallbackProperty` must never come back. Measured then, parked camera over
 * SF at 40 km, on the shipped 58-event feed:
 *
 *   58 clamped discs, callback axes → 32.4 ms/frame, 30 fps
 *   58 clamped discs, static axes   →  1.4 ms/frame, 60 fps
 *
 * The new geometry costs less than that, by construction and by measurement.
 * By construction: the CLAMP_TO_GROUND ellipses were N ground primitives, each
 * needing a classification pass against terrain and tiles; they are gone. What
 * replaces them BATCHES — N points collapse into one `PointPrimitiveCollection`
 * and N rulers into one `PolylineCollection` — so the draw-call count stops
 * growing with the feed.
 *
 * By measurement, 2026-09-03, headless Chromium on the dev server, camera
 * parked obliquely over the Atlantic, a SYNTHETIC 600-event feed (21× the 28
 * events the live feed carried that day), `scene.render()` + `gl.finish()`,
 * 120 timed frames per run, layer toggled ON/OFF three times to cancel drift:
 *
 *   600 points + 600 rulers ON → 1.00 ms median  (p10 0.70 / p90 1.60)
 *   layer OFF                  → 0.80 ms median  (p10 0.50 / p90 1.40)
 *
 * i.e. +0.20 ms at 600 events, which is inside this rig's own noise: the
 * difference between two consecutive OFF runs was 0.50 ms. On the live 28-event
 * feed the layer is not measurable at all. The number to distrust is the
 * absolute one — this is a software rasteriser (SwiftShader), not the GPU a
 * reader has — but the SHAPE holds: the cost does not scale with the feed, and
 * it never approaches the 32.4 ms the callback axes used to cost.
 *
 * Nothing is per-frame. The AGE colour is the one thing here that changes with
 * the clock, and it is rebanded ON POLL — every 60 s — not per frame: the
 * narrowest band is one hour, so a band boundary is crossed at worst 60 polls
 * late by 60 s, i.e. 1.7 % of the narrowest band. Paying 60 fps to sharpen
 * that would be the exact trade the 2026-08-20 hunt refused. With no per-frame
 * animator the layer still holds no continuous-render lock; the manager's
 * `layer-tick` / `layer-visibility` requests cover every mutation it makes.
 */

const API_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

export const EARTHQUAKE_OVERLAY_SOURCE_ID = 'earthquakes';
export const EARTHQUAKE_OVERLAY_COHORT_LIMIT = 96;
export const EARTHQUAKE_OVERLAY_COLLISION_CAPACITY = 48;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
  hitTest: hitTestWorldOverlay,
});

// ---------------------------------------------------------------------------
// Magnitude → constant screen pixels (B2)
// ---------------------------------------------------------------------------

/** Feed floor. Micro-quakes below this are not drawn and never were. */
export const EARTHQUAKE_MAG_FLOOR = 2.5;
/** Top of the frozen display domain: Valdivia 1960, the largest ever recorded. */
export const EARTHQUAKE_MAG_DOMAIN_MAX = 9.5;
/** Diameter of an event sitting exactly on the feed floor. */
export const EARTHQUAKE_MAG_BASE_PX = 6;
/** Diameter added per whole magnitude unit — the scale's own step, in pixels. */
export const EARTHQUAKE_MAG_PX_PER_UNIT = 3;
/**
 * Seismic moment ratio for one whole magnitude unit.
 *
 * Mw = ⅔·log₁₀(M₀) − 6.06, so one unit is 10^1.5 ≈ 31.6 of moment. Printed on
 * every card next to the magnitude, because that ratio is the exact distance
 * between what the disc says (a number) and what the event did (an energy),
 * and the disc cannot carry it — see the header.
 */
export const EARTHQUAKE_ENERGY_RATIO_PER_UNIT = 31.6;

/**
 * Screen diameter, in constant pixels, for one magnitude.
 *
 * Linear in magnitude by design — see the header. Clamped to the frozen
 * domain at both ends so a mis-parsed feed cannot produce a 400 px blob, and
 * so the mark keeps the same meaning session to session (C1).
 * @param {number} magnitude USGS magnitude.
 * @returns {number|null} Pixels, or null when the magnitude is not a number.
 */
export function magnitudePixelSize(magnitude) {
  // `typeof` before `Number()`: `Number(null)` is 0, so a feed field that is
  // absent would otherwise come back as a drawable floor-sized mark instead of
  // an unmeasured one (A1).
  if (typeof magnitude !== 'number' || !Number.isFinite(magnitude)) return null;
  const mag = magnitude;
  const clamped = Math.min(EARTHQUAKE_MAG_DOMAIN_MAX, Math.max(EARTHQUAKE_MAG_FLOOR, mag));
  const px = EARTHQUAKE_MAG_BASE_PX
    + EARTHQUAKE_MAG_PX_PER_UNIT * (clamped - EARTHQUAKE_MAG_FLOOR);
  return Math.round(px * 10) / 10;
}

// ---------------------------------------------------------------------------
// Depth → world metres of vertical ruler
// ---------------------------------------------------------------------------

/** No exaggeration: one metre of ruler is one metre of depth. */
export const EARTHQUAKE_DEPTH_SCALE = 1;
/**
 * Shortest ruler drawn for a MEASURED depth, in metres.
 *
 * A1: an event the network placed at 0.0 km — or above sea level, which USGS
 * publishes as a negative depth — still gets a mark, because "measured at
 * zero" and "not measured" may not share a sign.
 */
export const EARTHQUAKE_DEPTH_FLOOR_M = 1000;
/** Deepest earthquake ever located, in km — the ruler's reference top. */
export const EARTHQUAKE_DEPTH_MAX_KM = 700;

/**
 * Ruler length in metres for one published depth.
 * @param {number} depthKm Depth below sea level, in km, as USGS publishes it.
 * @returns {number|null} Metres of ruler, or null when depth is not published.
 */
export function depthRulerMetres(depthKm) {
  // Same `typeof` guard as {@link magnitudePixelSize}, and for the same
  // reason: GeoJSON writes a missing third coordinate as `null`, and
  // `Number(null)` is a perfectly finite 0 km.
  if (typeof depthKm !== 'number' || !Number.isFinite(depthKm)) return null;
  return Math.max(EARTHQUAKE_DEPTH_FLOOR_M, depthKm * 1000 * EARTHQUAKE_DEPTH_SCALE);
}

// ---------------------------------------------------------------------------
// Age → colour (A2, B4, C1)
// ---------------------------------------------------------------------------

/**
 * A timestamp may run this far ahead of the local clock and still be believed.
 * Beyond it the client's clock, the server's, or the feed is wrong, and an age
 * computed from it is not a measurement.
 */
export const EARTHQUAKE_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * The frozen age ramp. One warm hue, four values, strictly decreasing
 * luminance — the order survives a greyscale conversion (B4), and the bounds
 * are hours of the wall clock, never quantiles of the current feed (C1).
 */
export const EARTHQUAKE_AGE_BANDS = Object.freeze([
  Object.freeze({
    id: 'h1', maxAgeMs: 3600e3, color: '#fff1c9', label: 'moins d’1 h',
    blurb: 'Secousse de la dernière heure. La bande la plus claire de l’échelle.',
  }),
  Object.freeze({
    id: 'h6', maxAgeMs: 6 * 3600e3, color: '#ffc247', label: '1 à 6 h',
    blurb: 'Entre une et six heures.',
  }),
  Object.freeze({
    id: 'h12', maxAgeMs: 12 * 3600e3, color: '#e07a1f', label: '6 à 12 h',
    blurb: 'Entre six et douze heures.',
  }),
  Object.freeze({
    id: 'h24', maxAgeMs: Number.POSITIVE_INFINITY, color: '#8c4a17', label: '12 à 24 h',
    blurb: 'Le fond de la fenêtre : la secousse sort de la carte au prochain relevé. '
      + 'Le flux USGS « all_day » livre parfois quelques minutes de plus que 24 h ; '
      + 'ces événements tombent dans cette bande, ils ne sont pas écartés.',
  }),
]);

/**
 * The mark for an event whose time is not usable. Deliberately cool and
 * desaturated: off the warm ramp, so it cannot be misread as a rank on it.
 */
export const EARTHQUAKE_AGE_UNKNOWN = Object.freeze({
  id: 'unknown', color: '#7f8c99', label: 'âge non publié',
  blurb: 'Horodatage absent du flux, ou postérieur de plus de cinq minutes à l’horloge '
    + 'locale. L’âge n’est pas mesuré, donc il n’est pas peint sur l’échelle : ce gris '
    + 'bleuté n’est pas une cinquième ancienneté.',
});

/**
 * Which age band an event falls in.
 * @param {number|null|undefined} timeMs USGS event time, epoch ms.
 * @param {number} nowMs Reference instant — the poll's, not the frame's.
 * @returns {{id: string, color: string, label: string, blurb: string}} Band or unknown.
 */
export function ageBandFor(timeMs, nowMs) {
  // `typeof` again, for the third time and the same reason: `Number(null)` is
  // 0, and an epoch of 0 would have read as an event from 1970 — the OLDEST
  // band — rather than as an event whose time was never published.
  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return EARTHQUAKE_AGE_UNKNOWN;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return EARTHQUAKE_AGE_UNKNOWN;
  const t = timeMs;
  const now = nowMs;
  const age = now - t;
  if (age < -EARTHQUAKE_CLOCK_SKEW_TOLERANCE_MS) return EARTHQUAKE_AGE_UNKNOWN;
  const clamped = Math.max(0, age);
  for (const band of EARTHQUAKE_AGE_BANDS) {
    if (clamped < band.maxAgeMs) return band;
  }
  return EARTHQUAKE_AGE_BANDS[EARTHQUAKE_AGE_BANDS.length - 1];
}

// ---------------------------------------------------------------------------
// Legend (D1)
// ---------------------------------------------------------------------------

/** French thousands separator, flattened so the legend wraps identically everywhere. */
function fr(value) {
  // ICU groups with U+202F or U+00A0 depending on its version; both are
  // flattened so the legend measures and wraps identically everywhere.
  return Number(value).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ');
}

/**
 * An empty tally, so a legend built before the first poll is still shaped
 * like the one built after it.
 * @returns {object} Zeroed counters.
 */
export function emptyEarthquakeTally() {
  const byAge = {};
  for (const band of EARTHQUAKE_AGE_BANDS) byAge[band.id] = 0;
  byAge[EARTHQUAKE_AGE_UNKNOWN.id] = 0;
  return {
    drawn: 0,
    byAge,
    noDepth: 0,
    depthFloor: 0,
    labelled: 0,
    magMax: null,
    depthMaxKm: null,
  };
}

/** Provenance and clock, printed once above the classes (E1). */
export const EARTHQUAKE_LEGEND_NOTE = 'USGS, flux « all_day » M2,5+ · relevé toutes '
  + 'les 60 s. Cliquer un point ouvre sa fiche.';

/**
 * The key: the two shape channels reduced to their DOMAIN, then the colour.
 *
 * Reading order is « what is the biggest thing this mark can say » first, then
 * the ramp, then the one fallback a shape gets wrong on its own. The full
 * argument for the split lives in the header under D1; the short version is
 * that this block sits over the map and a caveat only lands next to the number
 * it qualifies, which is on the card ({@link buildEarthquakeCard}).
 *
 * Entry shape is the repo's `{label, color, count?, blurb?}`; `color: null`
 * renders an aligned empty swatch for the rows that state a domain rather than
 * key a colour.
 *
 * @param {object} tally From {@link emptyEarthquakeTally}, filled by a poll.
 * @returns {Array<object>} Legend entries.
 */
export function buildEarthquakeLegend(tally) {
  const t = tally || emptyEarthquakeTally();
  const entries = [];

  // Two rows, no ticks. Four discs of one ink differing only in diameter, and
  // four bars of one ink differing only in height, are the mark reprinted
  // eight times; what a reader cannot get from the mark is where the scale
  // STOPS, and that is a bound, not a row. Same move as #141 on the buoys and
  // #166 on the road ladder.
  entries.push({
    label: `Point — magnitude, M${fr(EARTHQUAKE_MAG_FLOOR)} à M${fr(EARTHQUAKE_MAG_DOMAIN_MAX)}`,
    color: null,
    // The energy ratio lives here and nowhere else since D3: it qualifies the
    // MARK's scale, which is what this row keys, not any one event.
    blurb: `${EARTHQUAKE_MAG_BASE_PX} px au plancher, +${EARTHQUAKE_MAG_PX_PER_UNIT} px `
      + `par unité, à toute distance. Ni énergie — +1 vaut `
      + `×${decimal(EARTHQUAKE_ENERGY_RATIO_PER_UNIT)} —, ni emprise.`,
  });
  entries.push({
    label: `Tige — profondeur du foyer, 0 à ${fr(EARTHQUAKE_DEPTH_MAX_KM)} km`,
    color: null,
    // The label already binds length to depth; what no shape says is the SCALE
    // and the DIRECTION, so those are what the line is spent on.
    blurb: 'À l’échelle 1:1, et vers le haut : la tige monte, le foyer descend.',
  });

  entries.push({
    label: 'Couleur — âge dans la fenêtre de 24 h',
    color: null,
  });
  for (const band of EARTHQUAKE_AGE_BANDS) {
    entries.push({
      label: band.label,
      color: band.color,
      count: t.byAge?.[band.id] ?? 0,
    });
  }
  if (t.byAge?.[EARTHQUAKE_AGE_UNKNOWN.id]) {
    entries.push({
      label: EARTHQUAKE_AGE_UNKNOWN.label,
      color: EARTHQUAKE_AGE_UNKNOWN.color,
      count: t.byAge[EARTHQUAKE_AGE_UNKNOWN.id],
      blurb: 'Hors rampe : ce gris n’est pas une cinquième ancienneté.',
    });
  }

  // The one A1 fallback that stays: a hollow ring is not merely undecoded, it
  // is decoded WRONG — as a small event — so the shape earns its row.
  if (t.noDepth) {
    entries.push({
      label: 'profondeur non publiée — point creux, aucune tige',
      color: null,
      count: t.noDepth,
      blurb: 'Une tige absente seule se confondrait avec une secousse superficielle.',
    });
  }

  return entries;
}

/**
 * The A5 slot: what the layer had to leave out, under the classes it qualifies.
 *
 * Two disclosures, and neither is a mark a reader can point at — which is
 * exactly why they belong here rather than in the key. The floor rupture is
 * the only place the 1:1 is broken in the whole layer, and the label cap is
 * the only place the map shows less than the feed carries.
 *
 * @param {object} tally From {@link emptyEarthquakeTally}, filled by a poll.
 * @returns {string} One sentence per live disclosure, or '' when neither bites.
 */
export function buildEarthquakeNote(tally) {
  const t = tally || emptyEarthquakeTally();
  const parts = [];
  if (t.depthFloor) {
    parts.push(`${fr(t.depthFloor)} foyer${t.depthFloor > 1 ? 's' : ''} à moins d’1 km : `
      + `tige dessinée au plancher d’1 km, seule rupture du 1:1 — « mesuré à zéro » `
      + `n’est pas « non mesuré ».`);
  }
  if (t.drawn > t.labelled) {
    parts.push(`Les ${fr(t.drawn)} secousses sont dessinées ; seules les `
      + `${fr(t.labelled)} plus fortes magnitudes portent une étiquette.`);
  }
  return parts.join(' ');
}

/**
 * Build the source-owned presentation for one ambient magnitude label.
 * Magnitude formatting deliberately remains here instead of moving into the
 * shared renderer.
 * @param {object} input
 * @param {string} input.id Stable USGS or deterministic fallback id.
 * @param {Cesium.Cartesian3} input.position Ground anchor shared with the mark.
 * @param {number} input.magnitude USGS magnitude.
 * @param {string} input.accent Source-owned accent — the event's AGE colour.
 * @returns {object}
 */
export function createEarthquakeOverlayEntry({ id, position, magnitude, accent }) {
  const mag = Number(magnitude);
  return {
    id: String(id),
    position,
    variant: 'label',
    title: `M${mag.toFixed(1)}`,
    accent,
    priority: Math.round(mag * 1000),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    // The label is a CLICK SURFACE, not a caption — see `overlayLabelPick.js`.
    // `M4.1` is several times the target area of the 6–13 px disc it names, it
    // reads like a button, and until it published a hit rectangle every click
    // that landed on it fell through to bare terrain.
    interactive: true,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the largest events, with stable identity as the tie-break. */
export function selectEarthquakeOverlayCohort(
  entries,
  limit = EARTHQUAKE_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(0, Math.min(
    EARTHQUAKE_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

// ---------------------------------------------------------------------------
// The card — one event, on click
// ---------------------------------------------------------------------------

export const EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID = 'earthquakes-selected';
export const EARTHQUAKE_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
/**
 * Accent for the card and for the ring the click puts under it.
 *
 * Off the age ramp on purpose, and off it by hue rather than by value: the
 * ramp is one warm hue ordered by lightness, so a cool cyan can never be read
 * as a fifth age — the same argument the « âge non publié » slate is chosen on.
 */
export const EARTHQUAKE_SELECTED_COLOR = '#7ee8fa';
/**
 * Reading measure for the card, under the host's 420 px ceiling.
 *
 * 300 px while the card was six terse lines; 320 since D3 made it prose.
 * Measured in Chrome at `fontDetail`, the padding leaves 296 px, and every
 * line the card GENERATES sets inside it — the place line (278 px) and the
 * source line (277 px) were each overflowing 300 px by a pixel or two, which
 * costs a whole rendered line for nothing. What can still wrap is a place
 * string long enough to need it (« 1 234 km à l’est-nord-est d’Ambon,
 * Indonesia »), which is the feed's, not the layout's. Still far under 420: at
 * this size a 420 px measure runs past comfortable reading width while covering
 * a band of globe the reader is looking at.
 */
export const EARTHQUAKE_CARD_MAX_WIDTH_PX = 320;
/** Pixels the selection ring clears the mark by, so the disc stays readable. */
const SELECTION_RING_MARGIN_PX = 9;
/** How deep to look for one of our marks under a click. */
const DRILL_PICK_LIMIT = 8;

/** One decimal, French comma, for a magnitude or a depth. */
function decimal(value) {
  return Number(value).toFixed(1).replace('.', ',');
}

/**
 * A depth in km, without the decimal USGS pads whole numbers with.
 *
 * A magnitude always keeps its decimal — M5 and M5,0 are different claims about
 * precision, and the scale is read to a tenth. A depth is not: « 10,0 km » and
 * « 520,0 km » spend a character on a zero that carries nothing, on the one
 * line of the card a reader is most likely to quote out loud.
 * @param {number} km Absolute depth, km.
 * @returns {string}
 */
function depthText(km) {
  return Number.isInteger(km) ? fr(km) : decimal(km);
}

/** Two-digit clock field. */
function pad2(value) {
  return String(value).padStart(2, '0');
}

/** Month names, hand-held rather than left to ICU — see below. */
const MONTHS_FR = Object.freeze([
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]);

/** Local midnight opening the calendar day an instant falls in. */
function localMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The instant the event happened, on the READER's calendar.
 *
 * The feed is worldwide and this used to print Zulu for that reason (D2). D3
 * overrules it: a date-time stamp in UTC is the single most technical thing a
 * non-specialist can be handed, and this fork's reader is reading French. What
 * UTC bought — one unambiguous clock — is bought back for four characters by
 * naming whose clock it is, « chez vous », which also forestalls the misreading
 * UTC never fixed either: that 21 h 41 was the evening WHERE IT SHOOK.
 *
 * Assembled from the getters and {@link MONTHS_FR} rather than through
 * `toLocaleString`, because `hour: '2-digit'` renders midnight as `24` on some
 * ICU builds — the trap `fraicheurFeed.js` documents. The hour is deliberately
 * NOT zero-padded: French writes « 9 h 05 », not « 09 h 05 ».
 *
 * @param {number} timeMs Epoch ms.
 * @param {number} [nowMs] Reference instant deciding aujourd’hui / hier.
 * @returns {string} `hier à 21 h 41 chez vous`.
 */
export function formatEarthquakeInstant(timeMs, nowMs = Date.now()) {
  const d = new Date(timeMs);
  const clock = `${d.getHours()} h ${pad2(d.getMinutes())}`;
  // Rounded, not floored: a DST day is 23 or 25 hours long, and « hier » must
  // not become « le 13 septembre » twice a year.
  const days = Math.round((localMidnight(new Date(nowMs)) - localMidnight(d)) / 86_400_000);
  if (days === 0) return `aujourd’hui à ${clock} chez vous`;
  if (days === 1) return `hier à ${clock} chez vous`;
  return `le ${d.getDate()} ${MONTHS_FR[d.getMonth()]} à ${clock} chez vous`;
}

// ---------------------------------------------------------------------------
// Decoding the numbers for a reader who does not know the scales (D3)
// ---------------------------------------------------------------------------

/**
 * What a magnitude MEANS, in descending order — first match wins.
 *
 * The bands are the whole-unit ones every agency publishes, and the effects are
 * hedged on purpose (« peut », « rares »): what a given magnitude does at the
 * surface depends on depth, distance and what is built there, and two of those
 * three are on the card already.
 */
export const EARTHQUAKE_MAGNITUDE_CLASSES = Object.freeze([
  { min: 8, label: 'séisme dévastateur', effect: 'Destruction sur des centaines de km.' },
  { min: 7, label: 'séisme majeur', effect: 'Dégâts graves sur toute une région.' },
  { min: 6, label: 'séisme destructeur', effect: 'Bâtiments endommagés jusqu’à 100 km.' },
  { min: 5, label: 'secousse forte', effect: 'Peut endommager les bâtiments fragiles.' },
  { min: 4, label: 'secousse modérée', effect: 'Ressentie sur place, dégâts rares.' },
  { min: 3, label: 'secousse faible', effect: 'Ressentie près de l’épicentre, sans dégât.' },
  { min: Number.NEGATIVE_INFINITY, label: 'secousse très faible', effect: 'Rarement ressentie, sans dégât.' },
]);

/**
 * The class one magnitude falls in.
 * @param {number} magnitude USGS magnitude.
 * @returns {{min:number,label:string,effect:string}|null} Null when unmeasured.
 */
export function classifyEarthquakeMagnitude(magnitude) {
  if (typeof magnitude !== 'number' || !Number.isFinite(magnitude)) return null;
  return EARTHQUAKE_MAGNITUDE_CLASSES.find((band) => magnitude >= band.min) ?? null;
}

/** Cells in the magnitude gauge — 14 over 7 units of domain, so one cell is 0,5. */
export const EARTHQUAKE_GAUGE_CELLS = 14;
const GAUGE_FILLED = '█';
/**
 * The EMPTY cell, chosen against five candidates rendered at 10.5 px in Chrome
 * with the shipped JetBrains Mono fallback chain.
 *
 * `─` wins because it is the only one that reads as ONE object with the filled
 * cells: a solid slab that continues as a thin rule, i.e. « filled up to here,
 * and the track goes on to there ». `░` — the obvious first choice — dithers
 * into visual static at this size and sits within a hair of `█`'s lightness, so
 * the bar reads as a grey smear rather than a measurement. `▁` puts the empty
 * track on the BASELINE, so the bar looks like it drops a step, and it is the
 * sparkline ramp besides. `▪`/`▯` leave gaps and read as a row of items. A
 * space leaves the track's extent invisible, which is the one thing a gauge
 * exists to show.
 */
const GAUGE_EMPTY = '─';

/**
 * A gauge placing one magnitude inside the layer's frozen domain.
 *
 * FULL-height cells, filled against empty — never the `▁▂▃▄▅▆▇█` ramp that
 * `sparkline.js` owns, where a differing HEIGHT means a sample in a series. One
 * magnitude is not a series, and a reader who has seen the comptage sparklines
 * elsewhere in this app would read a ramp as twelve hours of history.
 *
 * The domain is {@link EARTHQUAKE_MAG_FLOOR}…{@link EARTHQUAKE_MAG_DOMAIN_MAX},
 * i.e. exactly what the key publishes, so the two surfaces cannot disagree about
 * where the scale stops. An event sitting ON the floor still lights one cell,
 * for `choroplethPrism`'s reason: an empty bar reads as « no data », and this
 * one is data.
 *
 * @param {number} magnitude USGS magnitude.
 * @returns {string|null} `█████░░░░░░░░░`, or null when unmeasured.
 */
export function magnitudeGauge(magnitude) {
  if (typeof magnitude !== 'number' || !Number.isFinite(magnitude)) return null;
  const span = EARTHQUAKE_MAG_DOMAIN_MAX - EARTHQUAKE_MAG_FLOOR;
  const clamped = Math.min(EARTHQUAKE_MAG_DOMAIN_MAX, Math.max(EARTHQUAKE_MAG_FLOOR, magnitude));
  const filled = Math.min(
    EARTHQUAKE_GAUGE_CELLS,
    Math.max(1, Math.round(((clamped - EARTHQUAKE_MAG_FLOOR) / span) * EARTHQUAKE_GAUGE_CELLS)),
  );
  return GAUGE_FILLED.repeat(filled) + GAUGE_EMPTY.repeat(EARTHQUAKE_GAUGE_CELLS - filled);
}

/**
 * What a depth changes for someone standing above it — descending, first match wins.
 *
 * 70 km and 300 km are the boundaries seismology already uses for shallow /
 * intermediate / deep, so the card is not inventing a classification.
 */
export const EARTHQUAKE_DEPTH_CLASSES = Object.freeze([
  // Kept to one short clause each, and to within a few characters of one
  // another: the depth sentence is the only line of the card that wraps, and a
  // long qualifier turns its two rendered lines into three.
  { min: 300, label: 'très profond, rarement ressenti en surface' },
  { min: 70, label: 'profondeur moyenne, secousse atténuée' },
  { min: Number.NEGATIVE_INFINITY, label: 'peu profond, donc ressenti plus fort' },
]);

/**
 * The surface consequence of one published depth.
 * @param {number} depthKm Depth below sea level, in km, as USGS publishes it.
 * @returns {string|null} Null when depth is not published.
 */
export function describeEarthquakeDepth(depthKm) {
  if (typeof depthKm !== 'number' || !Number.isFinite(depthKm)) return null;
  return EARTHQUAKE_DEPTH_CLASSES.find((band) => depthKm >= band.min)?.label ?? null;
}

/** The sixteen compass points USGS abbreviates, in French. */
const COMPASS_FR = Object.freeze({
  N: 'nord', NNE: 'nord-nord-est', NE: 'nord-est', ENE: 'est-nord-est',
  E: 'est', ESE: 'est-sud-est', SE: 'sud-est', SSE: 'sud-sud-est',
  S: 'sud', SSW: 'sud-sud-ouest', SW: 'sud-ouest', WSW: 'ouest-sud-ouest',
  W: 'ouest', WNW: 'ouest-nord-ouest', NW: 'nord-ouest', NNW: 'nord-nord-ouest',
});

/** `86 km SSW of Isangel, Vanuatu` — the shape most of the feed arrives in. */
const USGS_BEARING_PLACE = /^(\d+(?:[.,]\d+)?)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/i;

/**
 * USGS's place string, in French where its grammar is mechanical.
 *
 * Only the bearing form is translated, because only it has a grammar rather
 * than a vocabulary: a distance, one of sixteen abbreviations, and a proper
 * noun that stays exactly as its own country writes it. The other forms the
 * feed carries — « South of the Fiji Islands », « off the east coast of
 * Honshu, Japan », « Balleny Islands region » — would need a phrasebook and a
 * gazetteer of endonyms to translate without inventing places, so they are
 * passed through untouched rather than half-guessed. On the 24 h M2.5+ feed the
 * bearing form is the large majority of events.
 *
 * The two elisions French needs are both mechanical here: « à l’est » /
 * « au nord » on the bearing's initial vowel, and « d’Isangel » / « de
 * Mraighah » on the place's. An initial `h` takes « de », which is right for
 * « de Honiara » and wrong for « d’Hawaï » — the rarer case, and a wrong
 * apostrophe is worse than a missing one.
 *
 * @param {string} place Raw USGS `properties.place`.
 * @returns {string} French where recognised, verbatim otherwise.
 */
export function frenchEarthquakePlace(place) {
  const text = String(place ?? '').trim();
  const match = USGS_BEARING_PLACE.exec(text);
  if (!match) return text;
  const bearing = COMPASS_FR[match[2].toUpperCase()];
  if (!bearing) return text;
  const distance = fr(Number(String(match[1]).replace(',', '.')));
  const toward = /^[eo]/.test(bearing) ? 'à l’' : 'au ';
  const name = match[3].trim();
  const of = /^[aeiouyàâäéèêëîïôöûü]/i.test(name) ? 'd’' : 'de ';
  return `${distance} km ${toward}${bearing} ${of}${name}`;
}

/**
 * How long ago.
 *
 * Hours are FLOORED, never rounded: the narrowest age band is one hour, so
 * « il y a 2 h » for a 90-minute-old event would put the card on the far side
 * of a band boundary from the colour beside it. Flooring cannot do that.
 *
 * The minutes past the hour used to be printed too — « il y a 11 h 11 ». On a
 * line that now also carries a wall clock (« hier à 21 h 41 chez vous »), a
 * second `h`-separated pair reads as a second time of day. The precision it
 * carried is not lost: the exact instant is on the same line, three words to
 * the left.
 * @param {number} ageMs Milliseconds since the event.
 * @returns {string}
 */
function formatAgo(ageMs) {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  return `il y a ${Math.floor(minutes / 60)} h`;
}

/** Printed under the gauge's top end: 9,5 is Valdivia 1960, and nothing since. */
const GAUGE_TOP_NOTE = 'record mondial';
/** The publisher, expanded once — « USGS » names nothing to a French reader. */
const EARTHQUAKE_SOURCE_LINE = 'Source : USGS, institut géologique américain';

/**
 * The card for one clicked event.
 *
 * Seven lines answering, in order, the questions a reader actually asks: how
 * hard did it shake, how does that compare, what does that do, where, when, how
 * deep. Nothing here describes the mark the reader just clicked — see the
 * header under D3 for what moved out and where each piece went.
 *
 * Kept as a newline-joined string, like every sibling card in the repo, so the
 * overlay host owns the wrapping and the first line is the title. One sentence
 * per line and none of them hand-wrapped, with the single deliberate exception
 * the depth block documents below.
 *
 * @param {object} record `{id, magnitude, depthKm, place, timeMs}`.
 * @param {number} nowMs Reference instant for the clock and age lines.
 * @returns {string} Title on the first line, details below.
 */
export function buildEarthquakeCard(record, nowMs) {
  // `Number(null)` is 0 and `Number(undefined)` is NaN — the A1 asymmetry
  // {@link magnitudePixelSize} guards against, and the one that would put
  // « secousse très faible » on an event nobody measured. Numeric strings are
  // still accepted; absence is not.
  const rawMag = record?.magnitude;
  const mag = rawMag === null || rawMag === undefined || rawMag === ''
    ? Number.NaN
    : Number(rawMag);
  const magClass = classifyEarthquakeMagnitude(mag);

  // The title carries the number AND its class, because the number alone is
  // the thing this whole rewrite exists to stop shipping bare.
  const lines = [magClass
    ? `Magnitude ${decimal(mag)} — ${magClass.label}`
    : 'Magnitude non publiée'];

  const gauge = magnitudeGauge(mag);
  if (gauge) {
    lines.push(`${fr(EARTHQUAKE_MAG_FLOOR)} ${gauge} `
      + `${fr(EARTHQUAKE_MAG_DOMAIN_MAX)} ${GAUGE_TOP_NOTE}`);
  }
  if (magClass) lines.push(magClass.effect);

  const place = frenchEarthquakePlace(record?.place);
  if (place) lines.push(`📍 ${place}`);

  const timeMs = record?.timeMs;
  if (typeof timeMs === 'number' && Number.isFinite(timeMs)) {
    // E1 — the instant REPRESENTED, then the distance to now. Both, because
    // one alone is either unreadable at a glance or unanchored in the day.
    lines.push(`🕐 ${formatEarthquakeInstant(timeMs, nowMs)} · ${formatAgo(nowMs - timeMs)}`);
  } else {
    lines.push('🕐 date non publiée par l’USGS');
  }

  const depthKm = record?.depthKm;
  if (typeof depthKm !== 'number' || !Number.isFinite(depthKm)) {
    // Why the point is a hollow ring stays in the key, where the shape is:
    // what the card owes THIS event is that the number does not exist.
    lines.push('↓ profondeur non publiée par l’USGS');
  } else {
    // USGS publishes negative depths for foci above sea level, so the datum is
    // named with the sign rather than assumed: « −1,2 km sous le niveau de la
    // mer » would be a double negative describing a hillside.
    const datum = depthKm < 0 ? 'au-dessus du niveau de la mer' : 'sous le niveau de la mer';
    // Two lines, hand-set, and the only place on this card the host's wrap is
    // pre-empted. Joined into one sentence this measures 491–542 px against a
    // 296 px measure, so it ALWAYS wrapped — and the host wraps flush left, so
    // the continuation « profond, donc ressenti plus fort » started a column
    // of its own and read as a fifth bullet. Two complete lines, the second
    // indented under the first, is what the shipped card already did for its
    // « tige au plancher » continuation. Both fit, at every class.
    lines.push(`↓ foyer à ${depthText(Math.abs(depthKm))} km ${datum}`);
    lines.push(`   ${describeEarthquakeDepth(depthKm)}`);
  }

  lines.push(EARTHQUAKE_SOURCE_LINE);
  return lines.join('\n');
}

/**
 * The protected card entry for the selected event.
 * @param {object} record `{id, magnitude, depthKm, place, timeMs}`.
 * @param {Cesium.Cartesian3} position Ground anchor shared with the mark.
 * @param {number} nowMs Reference instant for the age line.
 * @returns {object|null}
 */
export function createEarthquakeSelectedOverlayEntry(record, position, nowMs) {
  if (!record || !position) return null;
  const [title, ...details] = buildEarthquakeCard(record, nowMs).split('\n');
  return {
    id: `earthquake-card:${record.id}`,
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title,
    details,
    accent: EARTHQUAKE_SELECTED_COLOR,
    // Narrower than the 420 px host ceiling: these lines are prose, and a
    // 420 px measure at this size runs past the comfortable reading width
    // while covering a band of globe the reader is looking at.
    maxWidthPx: EARTHQUAKE_CARD_MAX_WIDTH_PX,
    interactive: false,
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

/**
 * Map one earthquake's raw plain values to a JSON-safe analyst record
 * (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. Falls back to an index-based id
 * when the USGS event id is absent.
 * @param {Object|null|undefined} raw - Plain values pulled off the entity:
 *   {id, mag, place, time, depth, lat, lon}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, magnitude: number|null, depthKm: number|null,
 *   lat: number|null, lon: number|null, timeMs: number|null, place: string|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `QUAKE-${String(index).padStart(4, '0')}`,
    magnitude: num(raw?.mag),
    depthKm: num(raw?.depth),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    timeMs: num(raw?.time), // USGS epoch ms
    place: text(raw?.place),
  };
}

/** Constant ring around every mark: contrast against the globe, never a datum. */
const MARK_OUTLINE_COLOR = Cesium.Color.fromCssColorString('#0b1016').withAlpha(0.85);
/** Ring width, in pixels. Constant — it used to double the magnitude channel. */
const MARK_OUTLINE_WIDTH = 1.5;
/** Ruler width, in pixels. Constant: the ruler's datum is its LENGTH. */
const DEPTH_RULER_WIDTH_PX = 2;
/** Ruler alpha. Constant, so the line never competes with the age ramp. */
const DEPTH_RULER_ALPHA = 0.85;

/** Id prefix for the marks, and the prefix the click handler claims. */
const MARK_ID_PREFIX = 'earthquake:';
/** Id of the single ring entity the click leaves under the selected mark. */
const SELECTION_RING_ID = 'earthquake-selection-ring';

export function createEarthquakesLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  // Cesium registers DOM listeners in the ScreenSpaceEventHandler constructor,
  // and this layer's lifecycle is exercised headless. The factory is the seam
  // that keeps the click ORDER — mark, then floating label, then empty space —
  // under test off-browser; the Escape listener still needs a real `document`.
  screenSpaceEventHandlerFactory = (viewer) => (
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  ),
  now = () => Date.now(),
} = {}) {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _tally = emptyEarthquakeTally();
  let _viewer = null;
  let _clickHandler = null;
  /** @type {Map<string, {record: object, position: Cesium.Cartesian3, pixelSize: number}>} */
  const _drawn = new Map();
  let _selectedId = null;

  /** Republish the selected card — on click, and after a poll rebuilt the marks. */
  function publishSelected() {
    const drawn = _selectedId ? _drawn.get(_selectedId) : null;
    if (!drawn) return;
    const entry = createEarthquakeSelectedOverlayEntry(drawn.record, drawn.position, now());
    if (!entry) return;
    overlayHost.setEntries(
      EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID,
      [entry],
      EARTHQUAKE_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
  }

  /**
   * The click acknowledgement, as a SEPARATE entity rather than a repaint.
   *
   * Every channel the mark owns is a datum: its diameter is the magnitude, its
   * fill is the age, and its outline is the age too when the depth is missing
   * (the hollow A1 mark). There is nothing left to borrow for "you clicked
   * this", so the selection is a second object — a cursor sitting around the
   * mark, one ring, removed on deselect. It keeps the depth test like
   * everything else in this layer (F1, regime (a)).
   */
  function syncSelectionRing() {
    if (!_dataSource) return;
    const existing = _dataSource.entities.getById(SELECTION_RING_ID);
    if (existing) _dataSource.entities.remove(existing);
    const drawn = _selectedId ? _drawn.get(_selectedId) : null;
    if (!drawn) return;
    _dataSource.entities.add({
      id: SELECTION_RING_ID,
      position: drawn.position,
      point: {
        pixelSize: drawn.pixelSize + SELECTION_RING_MARGIN_PX,
        color: Cesium.Color.TRANSPARENT,
        outlineColor: Cesium.Color.fromCssColorString(EARTHQUAKE_SELECTED_COLOR),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  function clearSelection() {
    if (!_selectedId) return false;
    _selectedId = null;
    overlayHost.clearSource(EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID);
    syncSelectionRing();
    return true;
  }

  function selectEvent(id) {
    if (!_drawn.has(id)) return false;
    _selectedId = id;
    syncSelectionRing();
    publishSelected();
    governorRequestRender('earthquakes-select');
    return true;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && clearSelection()) {
      governorRequestRender('earthquakes-deselect');
    }
  }

  /**
   * Install the click-to-open handler.
   *
   * `drillPick`, not `pick`: an epicentre disc is 6 to 27 px of a shared
   * `PointPrimitiveCollection` and it sits under whatever else the reader has
   * switched on — a charging point, a gauge, a photorealistic roof. A plain
   * pick returns the top-most primitive, so on a busy view the layer would
   * simply look dead.
   *
   * Then the label plane, which the depth buffer knows nothing about, and only
   * then empty space. `isWorldPick` rather than `!picked` for that last test:
   * over the photoreal tileset every pick is non-null (`pickRegistry`).
   */
  function installClickHandler(viewer) {
    if (_clickHandler || !viewer?.scene?.canvas) return;
    _clickHandler = screenSpaceEventHandlerFactory(viewer);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const drilled = viewer.scene.drillPick(click.position, DRILL_PICK_LIMIT) || [];
      let sawSibling = false;
      for (const hit of drilled) {
        const id = typeof hit?.id === 'string' ? hit.id : hit?.id?.id;
        if (typeof id !== 'string') continue;
        if (_drawn.has(id)) {
          selectEvent(id);
          return;
        }
        if (isOwnedByOtherLayer(layer.id, id)) sawSibling = true;
      }
      const labelled = pickOverlayLabelId(click.position, {
        sourceId: EARTHQUAKE_OVERLAY_SOURCE_ID,
        has: (renderId) => _drawn.has(`${MARK_ID_PREFIX}${renderId}`),
        hitTest: overlayHost.hitTest,
      });
      if (labelled) {
        selectEvent(`${MARK_ID_PREFIX}${labelled}`);
        return;
      }
      // A click that landed on a sibling's marker is that sibling's click, not
      // a dismissal: closing this card would make selecting a neighbouring
      // layer silently destroy the reading next to it.
      if (sawSibling) return;
      if (clearSelection()) governorRequestRender('earthquakes-deselect');
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
  }

  function removeClickHandler() {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
  }

  const layer = {
  id: 'earthquakes',
  name: 'Earthquakes (24h)',
  icon: '🌋',
  source: 'USGS',
  updateInterval: 60000,

  init(viewer) {
    _viewer = viewer;
    _dataSource = new Cesium.CustomDataSource('earthquakes');
    _dataSource.show = false;
    viewer.dataSources.add(_dataSource);
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _enabled = false;
    _tally = emptyEarthquakeTally();
    _drawn.clear();
    _selectedId = null;
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    overlayHost.setVisible(EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Earthquakes] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _viewer = viewer || _viewer;
    // No continuous-render hold: point and ruler are static geometry, so the
    // layer has no per-frame animator to keep the render loop alive for. The
    // click path requests a frame on select and on deselect instead.
    if (_dataSource) _dataSource.show = true;
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, true);
    overlayHost.setVisible(EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID, true);
    registerPickOwner(layer.id, (pickedId) => _drawn.has(String(pickedId)));
    installClickHandler(_viewer);
  },

  disable(viewer) {
    _enabled = false;
    clearSelection();
    removeClickHandler();
    unregisterPickOwner(layer.id);
    if (_dataSource) _dataSource.show = false;
    overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    overlayHost.clearSource(EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID, false);
  },

  async update(viewer) {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        _lastError = `USGS HTTP ${response.status}`;
        console.warn(`[Data:Earthquakes] API returned ${response.status}`);
        return false;
      }

      const geojson = await response.json();
      if (!geojson || !Array.isArray(geojson.features)) {
        _lastError = 'Malformed USGS response';
        return false;
      }

      _dataSource.entities.removeAll();
      _drawn.clear();
      let count = 0;
      const overlayEntries = [];
      const tally = emptyEarthquakeTally();
      // ONE reference instant for the whole poll, so two events of identical
      // time can never land in two bands because the loop took a millisecond.
      const nowMs = now();

      for (const feature of geojson.features) {
        const [lon, lat, depthKm] = feature.geometry.coordinates;
        const mag = feature.properties.mag;
        const place = feature.properties.place;
        const time = feature.properties.time;

        // `mag < 2.5` alone let a NaN magnitude through — `NaN < 2.5` is false
        // — and it would have drawn a mark of size NaN. The floor is stated
        // positively instead, on the same guard the pixel scale uses.
        if (magnitudePixelSize(mag) === null || mag < EARTHQUAKE_MAG_FLOOR) continue;

        count++;
        const pixelSize = magnitudePixelSize(mag);
        const band = ageBandFor(time, nowMs);
        const color = Cesium.Color.fromCssColorString(band.color);
        const rulerM = depthRulerMetres(depthKm);
        const hasDepth = rulerM !== null;

        tally.byAge[band.id] += 1;
        if (!hasDepth) tally.noDepth += 1;
        else if (depthKm * 1000 <= EARTHQUAKE_DEPTH_FLOOR_M) tally.depthFloor += 1;
        if (tally.magMax === null || mag > tally.magMax) tally.magMax = mag;
        if (hasDepth && (tally.depthMaxKm === null || depthKm > tally.depthMaxKm)) {
          tally.depthMaxKm = depthKm;
        }

        const position = Cesium.Cartesian3.fromDegrees(lon, lat);
        const stableId = feature.id || `event-${count}`;
        const markId = `${MARK_ID_PREFIX}${stableId}`;
        // The card's material, resolved on the poll rather than off the entity
        // on click: `properties.foo.getValue(now)` is a Cesium round-trip per
        // field, and the whole point of a card is that it is already assembled
        // when the click lands.
        _drawn.set(markId, {
          record: {
            id: feature.id ?? stableId,
            magnitude: mag,
            depthKm: hasDepth ? depthKm : null,
            place,
            timeMs: typeof time === 'number' && Number.isFinite(time) ? time : null,
          },
          position,
          pixelSize,
        });
        _dataSource.entities.add({
          id: markId,
          position,
          point: {
            // Constant screen pixels. No scaleByDistance, ever — see B2 in the
            // header: composing a thematic size with a range function inverts
            // the very hierarchy the legend promises.
            pixelSize,
            // A1: an unpublished depth empties the disc, so "shallow" and
            // "unmeasured" cannot share a mark.
            color: hasDepth ? color : Cesium.Color.TRANSPARENT,
            outlineColor: hasDepth ? MARK_OUTLINE_COLOR : color,
            outlineWidth: hasDepth ? MARK_OUTLINE_WIDTH : 2.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          // The depth ruler. Static positions — a CallbackProperty here would
          // rebuild the polyline batch every frame, which is the 2026-08-20
          // cliff in another costume.
          polyline: hasDepth ? {
            positions: [
              Cesium.Cartesian3.fromDegrees(lon, lat, 0),
              Cesium.Cartesian3.fromDegrees(lon, lat, rulerM),
            ],
            width: DEPTH_RULER_WIDTH_PX,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(DEPTH_RULER_ALPHA)),
            // Straight in space: a geodesic arc between two points on the same
            // vertical is a degenerate case Cesium does not need to solve.
            arcType: Cesium.ArcType.NONE,
          } : undefined,
          properties: {
            // Analyst seam (additive): the USGS event id (e.g. "us7000abcd").
            usgsId: feature.id ?? null,
            mag,
            place,
            time,
            depth: depthKm,
            ageBand: band.id,
          },
        });
        overlayEntries.push(createEarthquakeOverlayEntry({
          id: String(stableId),
          position,
          magnitude: mag,
          accent: band.color,
        }));
      }

      const cohort = selectEarthquakeOverlayCohort(overlayEntries);
      tally.drawn = count;
      tally.labelled = cohort.length;

      if (_enabled) {
        overlayHost.setEntries(
          EARTHQUAKE_OVERLAY_SOURCE_ID,
          cohort,
          {
            cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT,
            collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
            moving: false,
          },
        );
      }

      // The poll rebuilt every mark, so the open card lost both its ring and
      // its anchor. Re-seat it when the event is still in the window and drop
      // it when the feed has aged it out — a card left standing over an event
      // the layer no longer draws is a reading with nothing under it.
      if (_selectedId && !_drawn.has(_selectedId)) clearSelection();
      else if (_selectedId) {
        syncSelectionRing();
        publishSelected();
      }

      _tally = tally;
      _count = count;
      _lastUpdate = now();
      _lastError = null;
      console.log(`[Data:Earthquakes] Updated: ${_count} events (M2.5+)`);
      return true;

    } catch (e) {
      console.warn('[Data:Earthquakes] Fetch error:', e);
      _lastError = 'USGS network error';
      return false;
    }
  },

  destroy(viewer) {
    _enabled = false;
    removeClickHandler();
    unregisterPickOwner(layer.id);
    overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    overlayHost.clearSource(EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_dataSource) {
      viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
    }
    _viewer = null;
    _drawn.clear();
    _selectedId = null;
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _tally = emptyEarthquakeTally();
  },

  /**
   * Snapshot the layer's in-memory earthquake records as plain JSON-safe
   * objects for the analyst query engine. On-demand only (called at most
   * once per spoken query) — zero per-frame cost, no listeners, no caching.
   * Returns [] while the layer is disabled or empty.
   * @param {number} [maxCount=2000] - Maximum records to return (truncation).
   * @returns {Array<Object>} See mapAnalystRecord for the record shape.
   */
  getAnalystRecords(maxCount = 2000) {
    if (!_dataSource || !_dataSource.show) return [];
    const entities = _dataSource.entities.values;
    if (!entities.length) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
    const at = Cesium.JulianDate.now();
    const result = [];
    for (const entity of entities) {
      if (result.length >= limit) break;
      // The selection ring shares the collection and carries no properties;
      // without this guard the analyst would be handed one all-null record per
      // open card, and « combien de séismes » would answer one too many.
      if (entity.id === SELECTION_RING_ID) continue;
      const cartesian = entity.position ? entity.position.getValue(at) : null;
      const carto = cartesian ? Cesium.Cartographic.fromCartesian(cartesian) : null;
      const p = entity.properties;
      result.push(mapAnalystRecord({
        id: p?.usgsId?.getValue(at) ?? null,
        mag: p?.mag?.getValue(at),
        place: p?.place?.getValue(at),
        time: p?.time?.getValue(at),
        depth: p?.depth?.getValue(at),
        lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
        lon: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
      }, result.length));
    }
    return result;
  },

  /**
   * The on-map key (D1): the colour ramp, and the DOMAIN of the two channels
   * that are shapes. What each mark means for one event is on its card, and
   * what the layer had to leave out is in `note` — see the header under D1.
   *
   * Read from the tally the LAST POLL left behind rather than recomputed from
   * the entity collection: the panel asks for this on every refresh, and
   * walking N entities to rebuild four counters that only change once a minute
   * would put layer work on the interaction path.
   * @returns {{chips: Array<object>, legend: Array<object>, note: string,
   *   legendNote: string}}
   */
  getRowControls() {
    return {
      chips: [],
      legend: buildEarthquakeLegend(_tally),
      note: buildEarthquakeNote(_tally),
      legendNote: EARTHQUAKE_LEGEND_NOTE,
    };
  },

  getStats() {
    return {
      count: _count,
      lastUpdate: _lastUpdate,
      error: _lastError,
      legend: buildEarthquakeLegend(_tally),
    };
  },
  };
  return layer;
}

const earthquakesLayer = createEarthquakesLayer();

export default earthquakesLayer;
