#!/usr/bin/env bun
// ─────────────────────────────────────────────
//  zero-anim.js  —  CLI entry point
//
//  Usage:
//    bun run zeroanim/zero-anim.js <script.anim> [options]
//
//  Options:
//    --out <dir>       Output directory (default: ./out)
//    --frames <dir>    Frame directory   (default: ./frames)
//    --keep-frames     Do not delete frame files after encoding
//    --fps <n>         Override fps from script
//    --dry-run         Parse + timeline only, no rendering
//    --renderer        Print detected renderer and exit
// ─────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { parseScript } from "./runtime/zero.js";
import { traverseAnimation } from "./lib/traverse.js";
import { buildTimeline } from "./lib/timeline.js";
import { renderFrame, renderAllFrames, OBJECT_RENDERERS } from "./lib/render-html.js";
import { captureAllFrames, detectRenderer } from "./lib/capture.js";

// Build the set of object type names from the renderer map.
// The parser uses this to enable simplified `type ( ... )` syntax.
const OBJECT_TYPES = new Set(Object.keys(OBJECT_RENDERERS));

// ── CLI args ──────────────────────────────────

const args = process.argv.slice(2);
function flag(name)     { return args.includes(name); }
function opt(name, def) { const i = args.indexOf(name); return i > -1 && args[i+1] ? args[i+1] : def; }

if (args.length === 0 || flag("--help")) {
  console.log(`
  zeroanim  —  ZeroJS Animation Framework

  Usage:
    bun run zeroanim/zero-anim.js <script.anim> [options]

  Options:
    --out <dir>      Output MP4 directory          (default: ./out)
    --frames <dir>   Temporary frames directory    (default: ./frames)
    --fps <n>        Override fps declared in script
    --keep-frames    Keep frame PNGs after encoding
    --dry-run        Parse + timeline, skip render
    --renderer       Show detected renderer and exit

  Examples:
    bun run zeroanim/zero-anim.js zeroanim/examples/hello.anim
    bun run zeroanim/zero-anim.js zeroanim/examples/countdown.anim --fps 30
  `);
  process.exit(0);
}

if (flag("--renderer")) {
  const { renderer, bin } = await detectRenderer();
  console.log(renderer
    ? `Renderer: ${renderer}\nPath:     ${bin}`
    : "No renderer found.\nSet CHROME_PATH or place Chromium under zeroanim/.playwright-browsers/chromium-*/chrome-linux64/chrome");
  process.exit(0);
}

// ── Load and parse script ─────────────────────

const scriptPath = args.find(a => !a.startsWith("--"));
if (!scriptPath) { console.error("Error: no .anim script specified."); process.exit(1); }

console.log(`\n[zeroanim] Parsing: ${scriptPath}`);
const scriptText = readFileSync(scriptPath, "utf8");

let zero;
try {
  zero = parseScript(scriptText, OBJECT_TYPES);
} catch (err) {
  console.error(`[zeroanim] Parse error:\n${err.message}`);
  process.exit(1);
}

// ── Extract animation data ────────────────────

let animData;
try {
  animData = traverseAnimation(zero);
} catch (err) {
  console.error(`[zeroanim] Animation structure error:\n${err.message}`);
  process.exit(1);
}

// Expose the script directory so renderers can resolve relative asset paths.
animData.scriptDir = path.dirname(path.resolve(scriptPath));

if (opt("--fps", null)) animData.fps = parseFloat(opt("--fps", String(animData.fps)));

const { fps, width, height, duration, title } = animData;
const totalFrames = Math.ceil(fps * duration);

console.log(`[zeroanim] Title:    ${title}`);
console.log(`[zeroanim] Size:     ${width}x${height}  @${fps}fps`);
console.log(`[zeroanim] Duration: ${duration}s  (${totalFrames} frames)`);
console.log(`[zeroanim] Scenes:   ${animData.scenes.length}`);

// ── Build timeline ────────────────────────────

console.log(`[zeroanim] Building timeline...`);
const frames = buildTimeline(animData);

if (flag("--dry-run")) {
  // Find first non-empty frame for preview
  const sample = frames.find(f => f.objects.length > 0) ?? frames[0];
  console.log(`[zeroanim] Dry run — frame ${sample.frameIndex} (t=${sample.time.toFixed(2)}s) sample:`);
  console.log(JSON.stringify(sample, null, 2));
  process.exit(0);
}

// ── Prepare directories ───────────────────────

const outDir    = path.resolve(opt("--out",    "./out"));
const framesDir = path.resolve(opt("--frames", "./frames"));

mkdirSync(outDir,    { recursive: true });
mkdirSync(framesDir, { recursive: true });

// ── Render single all-frames HTML file ────────

console.log(`[zeroanim] Writing animation HTML (${totalFrames} frames)...`);

const animHtmlPath = path.join(framesDir, "animation.html");
writeFileSync(animHtmlPath, renderAllFrames(frames, animData), "utf8");

// ── Screenshot frames ─────────────────────────

const { renderer } = await detectRenderer();
if (!renderer) {
  console.warn(`
[zeroanim] WARNING: No headless renderer found.
  Animation HTML written to: ${animHtmlPath}
  Set CHROME_PATH or place Chromium under zeroanim/.playwright-browsers/chromium-*/chrome-linux64/chrome
`);
  process.exit(1);
}

console.log(`[zeroanim] Capturing ${totalFrames} frames with ${renderer}...`);

try {
  await captureAllFrames(animHtmlPath, totalFrames, framesDir, width, height);
} catch (err) {
  console.error(`[zeroanim] Capture failed:\n${err.message}`);
  process.exit(1);
}

// ── Assemble MP4 with ffmpeg ──────────────────

const safeName = title.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
const outFile  = path.join(outDir, `${safeName}.mp4`);

console.log(`[zeroanim] Assembling MP4: ${outFile}`);

const ffCmd = [
  "ffmpeg -y",
  `-framerate ${fps}`,
  `-i "${path.join(framesDir, "frame_%06d.jpg")}"`,
  `-c:v libx264 -pix_fmt yuv420p -crf 18 -preset fast`,
  `"${outFile}"`,
].join(" ");

try {
  execSync(ffCmd, { stdio: "inherit" });
} catch (err) {
  console.error(`[zeroanim] ffmpeg failed: ${err.message}`);
  process.exit(1);
}

// ── Cleanup ───────────────────────────────────

if (!flag("--keep-frames")) {
  try { rmSync(animHtmlPath); } catch {}
  for (let i = 0; i < totalFrames; i++) {
    const n = String(i).padStart(6, "0");
    try { rmSync(path.join(framesDir, `frame_${n}.jpg`)); } catch {}
  }
}

console.log(`\n[zeroanim] Done! → ${outFile}\n`);
