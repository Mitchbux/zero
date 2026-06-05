// ─────────────────────────────────────────────
//  capture.js  —  Screenshot HTML frames to JPEG
//
//  Uses Puppeteer-core with the local Chromium binary.
//  Loads the all-frames HTML once, then calls window.captureFrame(i)
//  (which renders and waits for rAF) before each screenshot.
//
//  Speed improvements over the original PNG approach:
//    1. JPEG encoding (~2-3× faster than PNG, smaller temp files)
//    2. Async file writes — disk I/O is fire-and-forget; capture loop
//       proceeds immediately while the previous frame is still writing
//    3. In-page captureFrame(i) — the page itself calls renderFrame then
//       waits for requestAnimationFrame so Puppeteer only fires the CDP
//       screenshot after the browser has fully painted
// ─────────────────────────────────────────────

import { spawnSync }                    from "child_process";
import { existsSync, readdirSync }      from "fs";
import { writeFile }                    from "fs/promises";
import path                             from "path";

// ── Nix store LD_LIBRARY_PATH for Chromium on NixOS / Replit ──────────
const CHROME_NIX_LIBS = [
  "/nix/store/3ybnl9nq86s7jz0i8pzqlrabjgdxzrjz-glib-2.84.3-bin/lib",
  "/nix/store/gpb87pb8s826aggy1s3f352alp40dkj8-nspr-4.36/lib",
  "/nix/store/2jsrwgic869zynqljiqa4g7dqzpwm2yd-nss-3.101.2/lib",
  "/nix/store/qrij2csr7p6jsfa40d7h4ckzqg4wd5w2-at-spi2-core-2.56.2/lib",
  "/nix/store/xpszkfp1gaf8jfmcsll93xg0pb4c0rk7-libdrm-2.4.124/lib",
  "/nix/store/zbydgvn9gypb3vg88mzydn88ky6cibaz-dbus-1.14.10/lib",
  "/nix/store/0046rn5sgi6l38zl81bg2r02zlzxqqbc-libXext-1.3.6/lib",
  "/nix/store/prjwp9nyczsza4kga6a2bcb3qz1mvxg7-cairo-1.18.2/lib",
  "/nix/store/jfpaxm9dvrrv3xsdbz5y3myj7sxkp7hj-pango-1.56.3-bin/lib",
  "/nix/store/1nsvsrqp5zm96r9p3rrq3yhlyw8jiy91-libX11-1.8.12/lib",
  "/nix/store/2y2hhlki6macaj9j1409q1j6i33l6igf-libxcb-1.17.0/lib",
  "/nix/store/94grp8dx897wmf0x3azpdbgzj3krz7v5-libXfixes-6.0.1/lib",
  "/nix/store/yw5xqn8lqinrifm9ij80nrmf0i6fdcbx-alsa-lib-1.2.13/lib",
  "/nix/store/l0d83xf43lsyhzqziy0am1cidhkcxs9q-expat-2.7.1/lib",
  "/nix/store/sisfq9wihyqqjzmrpik9b4xksifw97ha-libxkbcommon-1.8.1/lib",
  "/nix/store/wilz94hzz4q3fss6qvv625zvww4a6s4s-mesa-libgbm-25.0.1/lib",
  "/nix/store/5flwv7rri80114p8vlz7l8qf8z5i557h-systemd-minimal-libs-257.6/lib",
  "/nix/store/4phl6z95v2i4525y0zpmi9v6ac0n4bx7-libXcomposite-0.4.6/lib",
  "/nix/store/5fcbi2lycw2hz7rbn3nl5nrhhk2ki8dd-libXrandr-1.5.4/lib",
  "/nix/store/h8143a07cf1vw41s49h0zahnq13zim94-libXdamage-1.1.6/lib",
].join(":");

// ── Locate the Chromium binary ────────────────────────────────────────

const HERE = path.dirname(new URL(import.meta.url).pathname);

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH))
    return process.env.CHROME_PATH;

  // Chromium downloaded alongside this project (primary)
  // HERE is zeroanim/lib/ — go up one level to reach zeroanim/.playwright-browsers
  const browsersBase = path.join(HERE, "../.playwright-browsers");
  if (existsSync(browsersBase)) {
    const dirs = readdirSync(browsersBase)
      .filter(d => d.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const d of dirs) {
      const bin = path.join(browsersBase, d, "chrome-linux64/chrome");
      if (existsSync(bin)) return bin;
    }
  }

  // System Chromium fallback
  for (const c of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      const r = spawnSync("which", [c], { encoding: "utf8" });
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    } catch {}
  }

  return null;
}

// ── Public: detectRenderer ────────────────────────────────────────────

export async function detectRenderer() {
  const bin = findChrome();
  return bin ? { renderer: "chrome", bin } : { renderer: null, bin: null };
}

// ─────────────────────────────────────────────────────────────────────
//  Puppeteer single-file capture
//
//  Loads animation.html once, then calls window.captureFrame(i) (which
//  renders the frame and waits for requestAnimationFrame) and takes a
//  JPEG screenshot in a tight loop — no page reloads.
//  File writes are fire-and-forget so disk I/O never stalls the loop.
// ─────────────────────────────────────────────────────────────────────

async function captureWithChrome(htmlPath, frameCount, framesDir, width, height, chromeBin) {
  if (!process.env.LD_LIBRARY_PATH) {
    process.env.LD_LIBRARY_PATH = CHROME_NIX_LIBS;
  }

  const puppeteer = (await import("puppeteer-core")).default;

  const browser = await puppeteer.launch({
    executablePath: chromeBin,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      // Software WebGL (SwiftShader) so shader objects render without a GPU
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--ignore-gpu-blocklist",
      // Allow file:// pages to load other file:// resources (images, etc.)
      "--allow-file-access-from-files",
    ],
  });

  const reportEvery = Math.max(1, Math.floor(frameCount / 20));

  // Pending async file writes — awaited after the capture loop.
  const pendingWrites = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(`file://${path.resolve(htmlPath)}`, { waitUntil: "load" });

    for (let i = 0; i < frameCount; i++) {
      // captureFrame(i) is injected by render-html.js into the page.
      // For i=0 the page already rendered frame 0 on load, but calling
      // captureFrame(0) is harmless — it re-renders and waits for rAF,
      // guaranteeing the browser has painted before we screenshot.
      await page.evaluate((n) => window.captureFrame(n), i);

      const n      = String(i).padStart(6, "0");
      const jpgOut = path.join(framesDir, `frame_${n}.jpg`);

      // Capture JPEG as base64 string — faster to encode than PNG and
      // smaller on disk (irrelevant quality loss: ffmpeg re-encodes anyway).
      const data = await page.screenshot({
        type:     "jpeg",
        quality:  90,
        encoding: "base64",
        clip:     { x: 0, y: 0, width, height },
      });

      // Fire-and-forget the write so the next screenshot starts immediately.
      pendingWrites.push(writeFile(jpgOut, Buffer.from(data, "base64")));

      if (i % reportEvery === 0 || i === frameCount - 1) {
        const pct = Math.round(((i + 1) / frameCount) * 100);
        process.stdout.write(`\r  [${pct.toString().padStart(3)}%] ${i + 1}/${frameCount} frames`);
      }
    }

    process.stdout.write("\n");

    // Wait for all outstanding disk writes before closing.
    await Promise.all(pendingWrites);

    await page.close();
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Public entry point
// ─────────────────────────────────────────────────────────────────────

export async function captureAllFrames(htmlPath, frameCount, framesDir, width, height) {
  const { renderer, bin } = await detectRenderer();

  if (!renderer) {
    throw new Error(
      `[zeroanim] Chromium not found.\n` +
      `  Set CHROME_PATH to point at your Chrome/Chromium binary, or place\n` +
      `  a Chromium build under zeroanim/.playwright-browsers/chromium-*/chrome-linux64/chrome\n`
    );
  }

  await captureWithChrome(htmlPath, frameCount, framesDir, width, height, bin);
}
