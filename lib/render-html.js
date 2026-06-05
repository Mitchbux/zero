// ─────────────────────────────────────────────
//  render-html.js  —  Generate a self-contained
//  HTML file for a single animation frame
// ─────────────────────────────────────────────

import path from "path";

// Derive a stable HTML id from an image source path (no special chars).
function _imgId(src) {
  return "zimg_" + src.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(-48);
}

// Convert a source path to a file:// URL usable as an <img src>.
function _toFileUrl(src, scriptDir) {
  if (!src) return "";
  if (/^(file|https?):\/\//.test(src)) return src;
  if (src.startsWith("/")) return "file://" + src;
  return "file://" + path.resolve(scriptDir || process.cwd(), src);
}

// Resolve a coordinate value.
// Strings ending in % are kept as-is; numbers are treated as pixels.
function coord(v) {
  const s = String(v ?? "0").trim();
  return s.endsWith("%") ? s : s + "px";
}

function px(v) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "0px" : n + "px";
}

// Resolve a size value to integer pixels against a basis dimension.
// "76%" against 1280 -> 973; "400" -> 400; "auto"/invalid -> basis.
function resolvePx(v, basis) {
  const s = String(v ?? "").trim();
  if (s.endsWith("%"))
    return Math.max(1, Math.round((parseFloat(s) / 100) * basis));
  const n = parseFloat(s);
  return isNaN(n) ? basis : Math.max(1, Math.round(n));
}

// Build CSS transform for an object state.
// Text is anchored at its center: when x/y are percentages we prepend
// translate(-50%, ...) so x:50% means "center the text at 50%". Other types
// position themselves directly (rect/image: top-left via x/y, circle: cx/cy/r),
// so they must NOT get the centering shift.
function cssTransform(state) {
  const parts = [];
  if (state.type === "text") {
    const xPct = String(state.x ?? "")
      .trim()
      .endsWith("%");
    const yPct = String(state.y ?? "")
      .trim()
      .endsWith("%");
    if (xPct || yPct)
      parts.push(`translate(${xPct ? "-50%" : "0"}, ${yPct ? "-50%" : "0"})`);
  }
  if (state.scale !== undefined && Math.abs(state.scale - 1) > 0.0001)
    parts.push(`scale(${state.scale.toFixed(4)})`);
  if (state.rotate !== undefined && Math.abs(state.rotate) > 0.0001)
    parts.push(`rotate(${state.rotate.toFixed(2)}deg)`);
  return parts.length ? parts.join(" ") : "none";
}

// Build one CSS rule block for absolute-positioned objects.
// z-index defaults to the object's index in the script so that objects
// declared later in the .anim file always appear on top of earlier ones.
function objectCSS(id, state, idx) {
  const x = coord(state.x);
  const y = coord(state.y);

  // Build extra CSS declarations from the `style` sub-block (if any).
  // Property keys use underscores in the DSL (e.g. box_shadow, background_color)
  // and are converted to CSS kebab-case here (box_shadow → box-shadow).
  const extraLines = state.style
    ? Object.entries(state.style)
        .map(([k, v]) => `    ${k.replace(/_/g, "-")}: ${v};`)
        .join("\n")
    : "";

  const base = `
  #${id} {
    position: absolute;
    left: ${x};
    top: ${y};
    opacity: ${state.opacity.toFixed(4)};
    transform: ${cssTransform(state)};
    transform-origin: center center;
    z-index: ${state.z != null ? parseInt(state.z, 10) : (state.order ?? idx)};${extraLines ? "\n" + extraLines : ""}
  }`;
  return base;
}

// Render a text object
function renderText(id, state) {
  const css = `
  #${id} span {
    color: ${state.color};
    font-size: ${px(state.size)};
    font-family: '${state.font}', sans-serif;
    font-weight: ${state.weight};
    text-align: ${state.align};
    letter-spacing: ${px(state.letterspacing)};
    white-space: pre-wrap;
    display: block;
    background: ${state.bgcolor};
    border-radius: ${px(state.radius)};
    border: ${state.border}px solid ${state.bordercolor};
    padding: 4px 8px;
  }`;
  const html = `<div id="${id}"><span>${escapeHtml(state.content)}</span></div>`;
  return { css, html };
}

// Render a rectangle
function renderRect(id, state) {
  const css = `
  #${id} {
    width: ${coord(state.width)};
    height: ${coord(state.height)};
    background: ${state.color};
    border-radius: ${px(state.radius)};
    border: ${state.border}px solid ${state.bordercolor};
  }`;
  const html = `<div id="${id}"></div>`;
  return { css, html };
}

// Render a circle
function renderCircle(id, state) {
  const r = parseFloat(state.r ?? "50");
  const cx = coord(state.cx ?? "50%");
  const cy = coord(state.cy ?? "50%");
  const css = `
  #${id} {
    position: absolute !important;
    left: calc(${cx} - ${r}px);
    top: calc(${cy} - ${r}px);
    width: ${r * 2}px;
    height: ${r * 2}px;
    border-radius: 50%;
    background: ${state.color};
    border: ${state.border}px solid ${state.bordercolor};
  }`;
  const html = `<div id="${id}"></div>`;
  return { css, html };
}

// Render an image
function renderImage(id, state) {
  const css = `
  #${id} img {
    width: ${coord(state.width)};
    height: ${coord(state.height)};
    object-fit: contain;
    border-radius: ${px(state.radius)};
    border: ${state.border}px solid ${state.bordercolor};
  }`;
  const html = `<div id="${id}"><img src="${escapeHtml(state.src)}" alt="" /></div>`;
  return { css, html };
}

// Render a pixel shader inside a box (WebGL1 fragment shader).
//
// The box is positioned/sized by the standard object fields (x, y, width,
// height). The GLSL fragment source is supplied verbatim via the `glsl`
// property and must be GLSL ES 1.00 (the classic WebGL flavour): it declares
// its own `precision`, uniforms, and writes to `gl_FragColor`.
//
// The harness provides the uniforms/varyings the shader expects:
//   uniform sampler2D u_texture;   (bound to a 1x1 black base image)
//   uniform vec2 u_resolution;     (box size in pixels)
//   uniform float u_time;          (current frame time in seconds)
//   varying vec2 v_texCoord;       (0..1 across the box)
function renderShader(id, state, ctx = {}) {
  const animW = ctx.width ?? 1280;
  const animH = ctx.height ?? 720;
  const time = Number(ctx.time ?? 0);

  const wVal = state.width === "auto" ? "100%" : state.width;
  const hVal = state.height === "auto" ? "100%" : state.height;
  const bw = resolvePx(wVal, animW);
  const bh = resolvePx(hVal, animH);

  // Embed the GLSL safely as a JS string literal (escapes newlines/quotes).
  // Also neutralise any literal "</script>" so the source can't break out of
  // the inline <script>; "<\/" is identical to "</" once the JS string parses.
  const fragJS = JSON.stringify(String(state.glsl ?? "").trim()).replace(
    /<\//g,
    "<\\/",
  );
  const cid = `${id}-c`;

  const css = `
  #${id} {
    width: ${coord(wVal)};
    height: ${coord(hVal)};
    overflow: hidden;
    border-radius: ${px(state.radius)};
  }
  #${id} canvas { display: block; width: 100%; height: 100%; }`;

  const html = `<div id="${id}"><canvas id="${cid}" width="${bw}" height="${bh}"></canvas></div>
<script>
(function () {
  var cv = document.getElementById(${JSON.stringify(cid)});
  if (!cv) return;
  var opts = { preserveDrawingBuffer: true, antialias: true };
  var gl = cv.getContext("webgl", opts) || cv.getContext("experimental-webgl", opts);
  if (!gl) { console.error("WebGL unavailable"); return; }

  var vsrc = "attribute vec2 a_pos; varying vec2 v_texCoord; " +
             "void main(){ v_texCoord = a_pos ; gl_Position = vec4(a_pos, 0.0, 1.0); }";
  var fsrc = ${fragJS};

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error("shader compile: " + gl.getShaderInfoLog(s));
    return s;
  }

  var prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsrc));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    console.error("program link: " + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  // ── Texture 0 (u_texture): source_image > source_text > 1×1 black ──
  var tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  ${state.source_image
    ? `(function(){
        var _si = document.getElementById(${JSON.stringify(_imgId(state.source_image))});
        if (_si && _si.complete && _si.naturalWidth > 0) {
          var tc = document.createElement('canvas');
          tc.width = ${bw}; tc.height = ${bh};
          var c2 = tc.getContext('2d');
          var iAR = _si.naturalWidth / _si.naturalHeight;
          var cAR = ${(bw / bh).toFixed(6)};
          var sx, sy, sw, sh;
          if (iAR > cAR) { sh = _si.naturalHeight; sw = sh * cAR; sx = (_si.naturalWidth - sw) / 2; sy = 0; }
          else { sw = _si.naturalWidth; sh = sw / cAR; sx = 0; sy = (_si.naturalHeight - sh) / 2; }
          c2.drawImage(_si, sx, sy, sw, sh, 0, 0, ${bw}, ${bh});
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tc);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                        new Uint8Array([0, 0, 0, 255]));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
      })()`
    : state.source_text
      ? `(function(){
          var tc = document.createElement('canvas');
          tc.width = ${bw}; tc.height = ${bh};
          var c2 = tc.getContext('2d');
          c2.fillStyle = '#000000';
          c2.fillRect(0, 0, ${bw}, ${bh});
          c2.strokeStyle = '#ffffff';
          c2.lineWidth = ${parseFloat(String(state.source_stroke_width ?? "8"))};
          if ('letterSpacing' in c2) c2.letterSpacing = '12px';
          c2.font = ${JSON.stringify(String(state.source_font ?? "bold 330px Impact"))};
          c2.textAlign = 'center';
          c2.textBaseline = 'middle';
          c2.strokeText(${JSON.stringify(String(state.source_text))}, ${bw * 0.5}, ${bh * 0.5});
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tc);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        })()`
      : `gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                      new Uint8Array([0, 0, 0, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);`}
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  ${state.source_image2
    ? `(function(){
        var tex2 = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tex2);
        var _si2 = document.getElementById(${JSON.stringify(_imgId(state.source_image2))});
        if (_si2 && _si2.complete && _si2.naturalWidth > 0) {
          var tc2 = document.createElement('canvas');
          tc2.width = ${bw}; tc2.height = ${bh};
          var c3 = tc2.getContext('2d');
          var iAR2 = _si2.naturalWidth / _si2.naturalHeight;
          var cAR2 = ${(bw / bh).toFixed(6)};
          var sx2, sy2, sw2, sh2;
          if (iAR2 > cAR2) { sh2 = _si2.naturalHeight; sw2 = sh2 * cAR2; sx2 = (_si2.naturalWidth - sw2) / 2; sy2 = 0; }
          else { sw2 = _si2.naturalWidth; sh2 = sw2 / cAR2; sx2 = 0; sy2 = (_si2.naturalHeight - sh2) / 2; }
          c3.drawImage(_si2, sx2, sy2, sw2, sh2, 0, 0, ${bw}, ${bh});
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tc2);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                        new Uint8Array([0, 0, 0, 255]));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var uTex2 = gl.getUniformLocation(prog, "u_texture2");
        if (uTex2) gl.uniform1i(uTex2, 1);
        gl.activeTexture(gl.TEXTURE0);
      })()`
    : ""}

  var uTex = gl.getUniformLocation(prog, "u_texture");
  if (uTex) gl.uniform1i(uTex, 0);
  var uRes = gl.getUniformLocation(prog, "u_resolution");
  if (uRes) gl.uniform2f(uRes, ${bw}.0, ${bh}.0);
  var uTime = gl.getUniformLocation(prog, "u_time");
  if (uTime) gl.uniform1f(uTime, ${time.toFixed(5)});

  gl.viewport(0, 0, ${bw}, ${bh});
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.finish();
})();
<\/script>`;

  return { css, html };
}

// ── Object type registry ──────────────────────
//
// Maps each object type name to its render function.
// Keys are used by the parser to recognise object types (enabling the
// simplified `name ( ... )` syntax instead of `name +( ... )** `).
// Values are called by renderFrame to produce the CSS + HTML for each object.
// To add a new object type: add an entry here and a renderXxx function above.

export const OBJECT_RENDERERS = {
  text: renderText,
  rect: renderRect,
  circle: renderCircle,
  image: renderImage,
  shader: renderShader,
};

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Helpers shared by both renderers ─────────

function buildFrameParts(frame, animData) {
  const { width, height } = animData;
  const { time, objects } = frame;

  const cssParts = [];
  const htmlParts = [];

  objects.forEach((state, i) => {
    const id = `obj_${i}_${state.type}`;

    // Base positioning CSS (i used as default z-index so script order = paint order)
    cssParts.push(objectCSS(id, state, i));

    // Look up the renderer for this object type; fall back to an empty div.
    // The context (canvas size + current time) is needed by time-driven
    // renderers such as the WebGL shader box; other renderers ignore it.
    const rendererFn = OBJECT_RENDERERS[state.type];
    const piece = rendererFn
      ? rendererFn(id, state, { width, height, time })
      : { css: "", html: `<div id="${id}"></div>` };

    cssParts.push(piece.css);
    htmlParts.push(piece.html);
  });

  return { css: cssParts.join("\n"), html: htmlParts.join("\n") };
}

// ── Single-frame HTML (legacy / dry-run) ─────

export function renderFrame(frame, animData) {
  const { width, height, background, font } = animData;
  const { css, html } = buildFrameParts(frame, animData);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  background: ${background};
  font-family: '${font}', sans-serif;
  position: relative;
}
${css}
</style>
</head>
<body>
${html}
</body>
</html>
`;
}

// ── All-frames HTML (single file, JS-driven) ──
//
// Embeds every frame's CSS + HTML as a JSON array.
// Exposes window.renderFrame(i) so the capture driver can switch frames
// without reloading the page.
//
// Inline <script> tags (e.g. WebGL shaders) are re-executed after each
// innerHTML update by replacing them with freshly created <script> nodes.

export function renderAllFrames(frames, animData) {
  const { width, height, background, font } = animData;

  const frameData = frames.map(frame => buildFrameParts(frame, animData));

  // JSON-encode the array; escape </script> so the embedded string can't
  // break out of the surrounding <script> block.
  const framesJson = JSON.stringify(frameData).replace(/<\/script>/gi, "<\\/script>");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style id="frame-css">
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  background: ${background};
  font-family: '${font}', sans-serif;
  position: relative;
}
</style>
</head>
<body>
<div id="stage"></div>
${(() => {
    const seen = new Map();
    for (const frame of frames) {
      for (const obj of frame.objects ?? []) {
        for (const key of ["source_image", "source_image2"]) {
          const src = obj[key];
          if (src && !seen.has(src)) seen.set(src, _toFileUrl(src, animData.scriptDir));
        }
      }
    }
    if (seen.size === 0) return "";
    const tags = [...seen.entries()].map(
      ([src, url]) => `<img id="${_imgId(src)}" src="${url}" style="display:none">`
    ).join("\n");
    return `<div id="_zimgs" style="display:none">\n${tags}\n</div>`;
  })()}
<script>
var FRAMES = ${framesJson};
var frameStyleEl = document.getElementById("frame-css");
var baseCSS = frameStyleEl.textContent;
var stage = document.getElementById("stage");

function renderFrame(i) {
  var f = FRAMES[i];
  frameStyleEl.textContent = baseCSS + f.css;
  stage.innerHTML = f.html;
  // Re-execute inline <script> tags (innerHTML does not run them).
  // Required for WebGL shader boxes.
  var scripts = stage.querySelectorAll("script");
  for (var s = 0; s < scripts.length; s++) {
    var old = scripts[s];
    var fresh = document.createElement("script");
    fresh.textContent = old.textContent;
    old.parentNode.replaceChild(fresh, old);
  }
}

renderFrame(0);

// captureFrame(i): renders frame i and waits for the browser to paint
// before returning. Used by the Puppeteer capture loop so each screenshot
// fires only after the frame is fully drawn — more reliable than
// relying on Puppeteer's implicit paint wait, especially for WebGL shaders.
window.captureFrame = function(i) {
  window.renderFrame(i);
  return new Promise(function(resolve) { requestAnimationFrame(resolve); });
};
<\/script>
</body>
</html>
`;
}
