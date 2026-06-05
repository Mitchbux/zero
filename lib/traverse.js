// ─────────────────────────────────────────────
//  traverse.js  —  Walk a parsed Zero tree and
//  extract animation data into plain JS objects
// ─────────────────────────────────────────────

import { Z, Zero } from "../runtime/zero.js";
import { OBJECT_RENDERERS } from "./render-html.js";

// Set of recognised object type names — driven by the renderer map so that
// adding a new type in render-html.js is the only change needed.
const OBJECT_TYPES = new Set(Object.keys(OBJECT_RENDERERS));

// Read the first string value from a Zero node (or null)
function zval(nodePath) {
  const node = Z(nodePath);
  if (!node) return null;
  const v = node._list.get(0);
  return v !== undefined ? String(v) : null;
}

// Read all string values from a Zero node as an array
function zvals(nodePath) {
  const node = Z(nodePath);
  if (!node) return [];
  const out = [];
  for (const [, v] of node._list.entries()) {
    if (v !== undefined) out.push(String(v));
  }
  return out;
}

// Parse a timecode string into fractional seconds.
// Supports: "2.5"  |  "0:30"  |  "0:01:30"  |  "f60" (frame 60 at given fps)
export function parseTimecode(tc, fps = 24) {
  if (!tc) return 0;
  const s = String(tc).trim();
  if (s.startsWith("f")) return parseInt(s.slice(1), 10) / fps;
  const parts = s.split(":").map(Number);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// Extract a single animated object node at `basePath`
function extractObject(basePath, type) {
  const obj = { type };

  const fields = [
    "content", "src",
    "x", "y", "z",
    "width", "height",
    "color", "bgcolor", "opacity",
    "size", "font", "weight", "align", "letterspacing",
    "cx", "cy", "r", "radius",
    "border", "bordercolor",
    "glsl",
    "source_text", "source_font", "source_stroke_width",
    "source_image", "source_image2",
  ];

  for (const f of fields) {
    const v = zval(basePath + "." + f);
    if (v !== null) obj[f] = v;
  }

  // fadein: two values — start end
  const fi = zvals(basePath + ".fadein");
  if (fi.length >= 2) obj.fadein = { start: parseFloat(fi[0]), end: parseFloat(fi[1]) };

  // fadeout: two values — start end
  const fo = zvals(basePath + ".fadeout");
  if (fo.length >= 2) obj.fadeout = { start: parseFloat(fo[0]), end: parseFloat(fo[1]) };

  // moveto: x y start end
  const mt = zvals(basePath + ".moveto");
  if (mt.length >= 4) obj.moveto = { x: parseFloat(mt[0]), y: parseFloat(mt[1]), start: parseFloat(mt[2]), end: parseFloat(mt[3]) };

  // scaleto: factor start end
  const st = zvals(basePath + ".scaleto");
  if (st.length >= 3) obj.scaleto = { factor: parseFloat(st[0]), start: parseFloat(st[1]), end: parseFloat(st[2]) };

  // colorto: hex start end
  const ct = zvals(basePath + ".colorto");
  if (ct.length >= 3) obj.colorto = { color: ct[0], start: parseFloat(ct[1]), end: parseFloat(ct[2]) };

  // rotateto: degrees start end
  const rt = zvals(basePath + ".rotateto");
  if (rt.length >= 3) obj.rotateto = { deg: parseFloat(rt[0]), start: parseFloat(rt[1]), end: parseFloat(rt[2]) };

  // timecodes (keyframe array under object)
  const tcNode = Z(basePath + ".timecode");
  if (tcNode) {
    obj.timecodes = [];
    for (const [, v] of tcNode._list.entries()) {
      if (v !== undefined) obj.timecodes.push(String(v));
    }
  }

  // style: arbitrary CSS properties applied verbatim to the element.
  // Any child of the `style` sub-node becomes a CSS declaration.
  // e.g.  style +( box-shadow: 0 4px 12px #000; filter: blur(2px); )**
  const stylePrefix = basePath + ".style.";
  const styleProps = {};
  for (const key of Zero.storage.keys()) {
    if (!key.startsWith(stylePrefix)) continue;
    const prop = key.slice(stylePrefix.length);
    // Only direct children (no further dots) are CSS property names
    if (prop.includes(".")) continue;
    const v = zval(key);
    if (v !== null) styleProps[prop] = v;
  }
  if (Object.keys(styleProps).length > 0) obj.style = styleProps;

  return obj;
}

// Collect all object nodes that are *direct* children of `parentPath`, in the
// exact order they were declared in the script.
//
// The Zero runtime stores objects under per-type container nodes
// (e.g. zero.Animation.text|0, zero.Animation.circle|0), so grouping by type
// would scramble cross-type declaration order. Instead we walk Zero's storage
// Map, which preserves insertion order = script declaration order, and pick out
// the direct object instances.
function collectObjects(parentPath) {
  const prefix  = parentPath + ".";
  const indexed = new Set();   // types that have |idx instances
  const matches = [];          // { key, type, isIndexed } in declaration order

  for (const key of Zero.storage.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    // rest must be exactly "<type>" or "<type>|<idx>" — no further nesting
    const m = rest.match(/^([A-Za-z]+)(\|(-?\d+))?$/);
    if (!m) continue;
    const type = m[1];
    if (!OBJECT_TYPES.has(type)) continue;
    const isIndexed = m[2] !== undefined;
    if (isIndexed) indexed.add(type);
    matches.push({ key, type, isIndexed });
  }

  const objects = [];
  for (const { key, type, isIndexed } of matches) {
    // Skip the bare container node when indexed instances exist for that type
    if (!isIndexed && indexed.has(type)) continue;
    const node = Z(key);
    if (!node || typeof node !== "object") continue;
    const obj = extractObject(key, type);
    // Bare single-instance node must actually carry data
    if (!isIndexed && Object.keys(obj).length <= 1) continue;
    objects.push(obj);
  }

  return objects;
}

// Extract scenes from zero.Animation
function extractScenes(animPath) {
  const scenes = [];
  const sceneNode = Z(animPath + ".Scene");
  if (sceneNode) {
    // Multiple scenes via + operator
    for (const [idx, child] of sceneNode._list.entries()) {
      if (child && typeof child === "object") {
        const sp = animPath + ".Scene|" + idx;
        scenes.push({
          timecode: zval(sp + ".timecode") ?? "0",
          objects: collectObjects(sp),
        });
      }
    }
    // Single scene
    if (scenes.length === 0) {
      scenes.push({
        timecode: zval(animPath + ".Scene.timecode") ?? "0",
        objects: collectObjects(animPath + ".Scene"),
      });
    }
  } else {
    // Flat layout: objects directly under Animation
    scenes.push({
      timecode: "0",
      objects: collectObjects(animPath),
    });
  }
  return scenes;
}

// ── Main export ───────────────────────────────

export function traverseAnimation(zeroRoot) {
  const animPath = "zero.Animation";
  const anim = Z(animPath);

  if (!anim) {
    throw new Error(
      "No Animation node found in script.\n" +
      "Your .anim file must have a top-level  Animation ( ... )  block."
    );
  }

  const fps      = parseFloat(zval(animPath + ".fps")      ?? "24");
  const width    = parseInt(  zval(animPath + ".width")    ?? "1280", 10);
  const height   = parseInt(  zval(animPath + ".height")   ?? "720",  10);
  const duration = parseFloat(zval(animPath + ".duration") ?? "5");
  const bg       = zval(animPath + ".background") ?? "#000000";
  const font     = zval(animPath + ".font")       ?? "sans-serif";
  const title    = zval(animPath + ".title")      ?? "Animation";

  const scenes = extractScenes(animPath);

  return { fps, width, height, duration, background: bg, font, title, scenes };
}
