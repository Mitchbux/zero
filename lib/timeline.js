// ─────────────────────────────────────────────
//  timeline.js  —  Compute per-frame visual state
//  from the animation data model
// ─────────────────────────────────────────────

import { parseTimecode } from "./traverse.js";

// ── Easing functions ──────────────────────────

export const Easing = {
  linear:    t => t,
  easeIn:    t => t * t,
  easeOut:   t => t * (2 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  bounce:    t => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
    if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
    t -= 2.625 / 2.75;
    return 7.5625 * t * t + 0.984375;
  },
  elastic: t => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
  },
};

// ── Interpolation helpers ─────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function lerp(a, b, t) { return a + (b - a) * t; }

// Compute a 0..1 progress value for a transition at time `t`
function progress(t, start, end, easing = "easeInOut") {
  if (t <= start) return 0;
  if (t >= end)   return 1;
  const raw = (t - start) / (end - start);
  return (Easing[easing] ?? Easing.easeInOut)(raw);
}

// Parse a CSS color "#rrggbb" to {r,g,b}
function hexToRgb(hex) {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex({ r, g, b }) {
  return "#" + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
}

function lerpColor(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex({
    r: lerp(ca.r, cb.r, t),
    g: lerp(ca.g, cb.g, t),
    b: lerp(ca.b, cb.b, t),
  });
}

// ── Per-frame state for a single object ──────

function computeObjectAtTime(obj, t) {
  // Base state — copy scalar fields
  const state = {
    type:    obj.type,
    x:       obj.x       ?? "50%",
    y:       obj.y       ?? "50%",
    z:       obj.z,
    width:   obj.width   ?? "auto",
    height:  obj.height  ?? "auto",
    color:   obj.color   ?? "#ffffff",
    bgcolor: obj.bgcolor ?? "transparent",
    opacity: parseFloat(obj.opacity ?? "1"),
    size:    parseFloat(obj.size    ?? "32"),
    font:    obj.font    ?? "sans-serif",
    weight:  obj.weight  ?? "400",
    align:   obj.align   ?? "left",
    content: obj.content ?? "",
    src:     obj.src     ?? "",
    cx:      obj.cx      ?? "50%",
    cy:      obj.cy      ?? "50%",
    r:       obj.r       ?? "50",
    radius:  obj.radius  ?? "0",
    border:  obj.border  ?? "0",
    bordercolor: obj.bordercolor ?? "transparent",
    letterspacing: obj.letterspacing ?? "0",
    glsl:               obj.glsl               ?? null,
    source_text:         obj.source_text         ?? null,
    source_font:         obj.source_font         ?? null,
    source_stroke_width: obj.source_stroke_width  ?? null,
    source_image:        obj.source_image         ?? null,
    source_image2:       obj.source_image2        ?? null,
    style:              obj.style              ?? null,
    scale:   1,
    rotate:  0,
    visible: true,
  };

  // Determine base opacity from fadein/fadeout
  let opacity = state.opacity;
  let inWindow = true;

  if (obj.fadein) {
    const { start, end } = obj.fadein;
    if (t < start) { inWindow = false; opacity = 0; }
    else if (t <= end) { opacity *= progress(t, start, end, "easeOut"); }
  }

  if (obj.fadeout && inWindow) {
    const { start, end } = obj.fadeout;
    if (t >= end) { inWindow = false; opacity = 0; }
    else if (t >= start) { opacity *= 1 - progress(t, start, end, "easeIn"); }
  }

  state.opacity = clamp(opacity, 0, 1);
  state.visible = state.opacity > 0.001;

  // moveto: interpolate x,y
  if (obj.moveto) {
    const { x, y, start, end } = obj.moveto;
    const p = progress(t, start, end, "easeInOut");
    const ox = parseFloat(state.x); const oy = parseFloat(state.y);
    state.x = String(lerp(ox, x, p));
    state.y = String(lerp(oy, y, p));
  }

  // scaleto: interpolate scale
  if (obj.scaleto) {
    const { factor, start, end } = obj.scaleto;
    const p = progress(t, start, end, "easeInOut");
    state.scale = lerp(1, factor, p);
  }

  // colorto: interpolate color
  if (obj.colorto) {
    const { color, start, end } = obj.colorto;
    const p = progress(t, start, end, "easeInOut");
    state.color = lerpColor(state.color, color, p);
  }

  // rotateto: interpolate rotation
  if (obj.rotateto) {
    const { deg, start, end } = obj.rotateto;
    const p = progress(t, start, end, "easeInOut");
    state.rotate = lerp(0, deg, p);
  }

  return state;
}

// ── Compute the full timeline ─────────────────

export function buildTimeline(animData) {
  const { fps, duration, scenes } = animData;
  const totalFrames = Math.ceil(fps * duration);
  const frames = [];

  // Assign every object a stable paint order from its declaration position
  // in the script (across scenes, top to bottom). This is used as the default
  // z-index so script order = stacking order, regardless of which objects are
  // visible/filtered in any given frame.
  const objOrder = new Map();
  let orderCounter = 0;
  for (const scene of scenes)
    for (const obj of scene.objects)
      objOrder.set(obj, orderCounter++);

  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps;

    // Find which scenes are active at time t
    const activeObjects = [];
    for (const scene of scenes) {
      const sceneStart = parseTimecode(scene.timecode, fps);
      if (t < sceneStart) continue;

      for (const obj of scene.objects) {
        const state = computeObjectAtTime(obj, t - sceneStart);
        if (state.visible) {
          state.order = objOrder.get(obj);
          activeObjects.push(state);
        }
      }
    }

    frames.push({ frameIndex: f, time: t, objects: activeObjects });
  }

  return frames;
}
