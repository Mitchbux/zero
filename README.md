# zeroanim — ZeroJS Animation Framework

A frame-by-frame animation framework built on the **ZeroJS DSL**.  
Write animations in a minimal human-readable syntax. The pipeline renders each frame as HTML, screenshots it with **Chromium** (via Puppeteer), and assembles the output into an **MP4** with **ffmpeg**.

---

## Quick Start

```bash
# Run the hello-world example
bun run zero-anim.js examples/hello.anim

# Output: ./out/hello_world.mp4
```

Chromium is expected at `zeroanim/.playwright-browsers/chromium-*/chrome-linux64/chrome`.  
Override with `CHROME_PATH=/path/to/chrome` if you have it elsewhere.

---

## Pipeline

```
 .anim script
     │
     ▼ ZeroJS parser  (zero.js runtime)
 Zero object tree
     │
     ▼ traverse.js
 Animation data model  (plain JS objects)
     │
     ▼ timeline.js
 Per-frame state  (one object array per frame)
     │
     ▼ render-html.js
 Single animation.html  (all frames embedded as JSON, JS-driven)
     │
     ▼ Chromium  (via puppeteer-core — one page load, N screenshots)
 JPEG frames  (full CSS + font rendering; async writes, rAF-synced)
     │
     ▼ ffmpeg  libx264 / yuv420p
 output.mp4
```

---

## ZeroJS DSL Reference

ZeroJS is a minimal data-description language. Every animation script is a **ZeroJS program** — the animation keywords are just node names that the framework interprets at render time.

### Core Syntax

| Token | Meaning |
|-------|---------|
| `NodeName ( ... )` | Create a node and open its scope |
| `key "value"` | Assign a string value to a property |
| `key 'value'` | Same, single-quoted |
| `,` | Separate siblings (return to parent scope) |
| `+` | Push an indexed positive child (array item) |
| `-` | Push an indexed negative child |
| `*` | Pop back to parent (end of array item) |
| `[name] { code }` | Define a named indexer (computed property) |
| `{ code }` | Define a getter (evaluated JS block) |
| `# comment` | Line comment |

### Animation Block

Every script must have exactly one `Animation ( ... )` block at the top level.

```
Animation (
  title "My Title",
  fps "24",
  width "1280",
  height "720",
  duration "5.0",
  background "#0f0f1a",
  font "Georgia",

  ... objects ...
)
```

| Property | Default | Description |
|----------|---------|-------------|
| `title` | `"Animation"` | Used as the output filename |
| `fps` | `"24"` | Frames per second |
| `width` | `"1280"` | Canvas width in pixels |
| `height` | `"720"` | Canvas height in pixels |
| `duration` | `"5.0"` | Total duration in seconds |
| `background` | `"#000000"` | Canvas background color |
| `font` | `"sans-serif"` | Default font family |

---

## Object Types

Objects are placed inside `Animation ( ... )` or `Scene ( ... )` blocks.  
Use `+(` / `)**` to create multiple objects of the same type (see [The `)**` Rule](#multi-object-array-syntax--the--rule) below).

### `text`

Renders text at a position.

```
text (
  content "Hello, World!",
  x "50%",
  y "45%",
  color "#ffffff",
  size "72",
  font "Georgia",
  weight "700",
  align "center",
  letterspacing "2",
  bgcolor "transparent",
  radius "0",
  fadein "0.0" "1.0",
  fadeout "4.0" "5.0"
)
```

### `rect`

Filled rectangle.

```
rect (
  x "10%",
  y "20%",
  width "80%",
  height "4",
  color "#e94560",
  radius "2",
  border "0",
  bordercolor "transparent",
  fadein "0.5" "1.0"
)
```

### `circle`

Filled circle, positioned by center.

```
circle (
  cx "50%",
  cy "50%",
  r "120",
  color "#3a0ca3",
  fadein "0.0" "0.8"
)
```

### `image`

Renders an image (file path or URL).

```
image (
  src "assets/logo.png",
  x "50%",
  y "50%",
  width "300",
  height "auto",
  radius "8",
  fadein "0.0" "0.5"
)
```

---

## Arbitrary CSS via `style.*`

Any object can receive extra CSS declarations using dot-notation `style.<property>` keys.  
Property names use underscores; they are converted to CSS kebab-case on output.

```
rect (
  x "20%",
  y "30%",
  width "60%",
  height "40%",
  color "#1a1a2e",
  style.box_shadow "0 8px 32px rgba(0,0,0,0.6)",
  style.backdrop_filter "blur(12px)",
  style.border_radius "16px"
)
```

---

## Effect Keywords

### `fadein start end`

Fades opacity from 0 to 1 between `start` and `end` seconds.

```
fadein "0.0" "1.0"
```

| Arg | Type | Description |
|-----|------|-------------|
| `start` | seconds | Opacity = 0 before this |
| `end` | seconds | Opacity = 1 after this |

### `fadeout start end`

Fades opacity from 1 to 0 between `start` and `end` seconds.

```
fadeout "4.0" "5.0"
```

### `moveto x y start end`

Linearly interpolates the object's position from its initial `x,y` to the given `x,y`.

```
moveto "640" "200" "1.0" "2.5"
```

### `scaleto factor start end`

Scales the object from `1.0` to `factor` over the interval.

```
scaleto "1.5" "0.0" "0.8"   # grow 50% in first 0.8s
```

### `colorto hex start end`

Interpolates `color` from its initial value to `hex`.

```
colorto "#4cc9f0" "1.0" "3.0"
```

### `rotateto degrees start end`

Rotates from 0° to `degrees`.

```
rotateto "360" "0.0" "2.0"
```

---

## Timecodes

Timecodes can be expressed in multiple formats:

| Format | Example | Resolves to |
|--------|---------|-------------|
| Decimal seconds | `"2.5"` | 2.5 s |
| `MM:SS` | `"0:30"` | 30 s |
| `HH:MM:SS` | `"0:01:30"` | 90 s |
| Frame number | `"f60"` | frame 60 (fps-relative) |

---

## Scenes

Use `Scene ( ... )` blocks to group objects that share a start `timecode`. Objects inside a scene use scene-relative time.

```
Animation (
  fps "24",
  duration "10.0",
  background "#000",

  Scene (
    timecode "0.0",
    text (
      content "Act I",
      x "50%", y "50%",
      color "#fff", size "72",
      fadein "0.0" "1.0",
      fadeout "2.5" "3.0"
    )
  )

  Scene (
    timecode "3.0",
    text (
      content "Act II",
      x "50%", y "50%",
      color "#f72585", size "72",
      fadein "0.0" "1.0",
      fadeout "2.5" "3.0"
    )
  )
)
```

---

## Pixel Shader Box

Renders a **GLSL fragment shader inside a box**. The box is positioned and
sized with the standard `x` / `y` / `width` / `height` fields (top-left anchored,
percentages or pixels). The GLSL source is supplied inline via the `glsl`
property and runs with WebGL (software-rendered via SwiftShader in headless
Chromium, so no GPU is required).

```
shader (
  x "12%",
  y "19%",
  width "76%",
  height "68%",
  radius "12",
  fadein "0.3" "1.2",
  glsl "precision highp float;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform float u_time;
    varying vec2 v_texCoord;
    void main() {
      vec4 image = texture2D(u_texture, v_texCoord);
      float t = u_time;
      vec3 effect = vec3(0.5 + 0.5 * sin(t + v_texCoord.x * 6.0));
      gl_FragColor = vec4(image.rgb + effect, 1.0);
    }"
)
```

| Property | Default | Description |
|----------|---------|-------------|
| `x` | `"50%"` | Box left edge |
| `y` | `"50%"` | Box top edge |
| `width` | `"auto"` (→ full canvas) | Box width (px or %) |
| `height` | `"auto"` (→ full canvas) | Box height (px or %) |
| `radius` | `"0"` | Corner radius in pixels (clips the canvas) |
| `glsl` | `""` | Inline GLSL ES 1.00 fragment source |

**Shader contract** — the source must be **GLSL ES 1.00** (classic WebGL): declare
your own `precision` and write the result to `gl_FragColor`. The harness provides:

- `uniform sampler2D u_texture` — texture slot 0 (see [Shader Texture Sources](#shader-texture-sources) below)
- `uniform sampler2D u_texture2` — texture slot 1 (only present when `source_image2` is set)
- `uniform vec2 u_resolution` — the box size in pixels
- `uniform float u_time` — current frame time in seconds
- `varying vec2 v_texCoord` — NDC coordinates `−1..1` across the box

> The `glsl` value is an ordinary quoted string, so it may span multiple lines.
> It must not contain a literal `"` character.

See `examples/shader.anim` for a procedural-glow example and `examples/logo.anim`
for a `source_text` + glitch-corruption example.

---

### Shader Texture Sources

By default `u_texture` is a 1×1 black pixel — enough to make `texture2D` defined
without producing any visible image. You can replace it with richer content using
one of the three source properties below. Only one primary source is active at a
time (`source_image` takes precedence over `source_text`).

#### `source_text` — rendered text as a texture

Pre-renders a string to a Canvas 2D element (black background, white stroke
outlines) and uploads the result as `u_texture`. This lets your shader operate
on typography without any external asset file.

```
shader (
  x "0", y "0", width "1280", height "720",
  source_text "ZERO",
  source_font "bold 330px Impact",
  source_stroke_width "10",
  glsl "..."
)
```

| Property | Default | Description |
|----------|---------|-------------|
| `source_text` | — | The string to render. Drawn centered in the box with `strokeText`. |
| `source_font` | `"bold 330px Impact"` | Canvas 2D font shorthand (`"<weight> <size> <family>"`). |
| `source_stroke_width` | `"8"` | Stroke line width in pixels (`context.lineWidth`). |

The canvas is rendered at the shader box's pixel dimensions (`width × height`),
so UV coordinates map exactly to the text bounding box.

#### `source_image` — an image file as a texture

Loads an image from a file path (relative to the `.anim` script) or an `https://`
URL and uploads it as `u_texture`, cover-cropped to fit the shader box.

```
shader (
  x "0", y "0", width "1280", height "720",
  source_image "assets/photo.jpg",
  glsl "..."
)
```

| Property | Default | Description |
|----------|---------|-------------|
| `source_image` | — | Path (relative to the `.anim` file) or `https://` URL of the source image. |

The image is cover-cropped (aspect-ratio preserved, centred) to the exact pixel
dimensions of the shader box before upload. `v_texCoord` spans the full `0..1`
range regardless of the original image aspect ratio.

#### `source_image2` — a second image as `u_texture2`

Loads a second image and binds it to texture unit 1 as `uniform sampler2D u_texture2`.
Use this for blend/wipe effects that need two image inputs.

```
shader (
  x "0", y "0", width "1280", height "720",
  source_image  "assets/from.jpg",
  source_image2 "assets/to.jpg",
  glsl "precision highp float;
    uniform sampler2D u_texture;
    uniform sampler2D u_texture2;
    uniform float u_time;
    varying vec2 v_texCoord;
    void main() {
      vec2 uv = v_texCoord * 0.5 + 0.5;
      float t = clamp(u_time / 3.0, 0.0, 1.0);
      vec4 a = texture2D(u_texture,  uv);
      vec4 b = texture2D(u_texture2, uv);
      gl_FragColor = mix(a, b, t);
    }"
)
```

| Property | Default | Description |
|----------|---------|-------------|
| `source_image2` | — | Path or URL for the second image, bound to `u_texture2`. |

`source_image2` can be combined with `source_text` or `source_image` on `u_texture`.

---

## Roadmap / Keyword Evolution

### v0.1  _(current)_
- `fadein`, `fadeout`
- `moveto`, `scaleto`, `colorto`, `rotateto`
- `text`, `rect`, `circle`, `image`
- `shader` — GLSL fragment shader rendered inside a box (WebGL)
  - `source_text` — Canvas 2D pre-rendered text as `u_texture`
  - `source_image` / `source_image2` — image files as `u_texture` / `u_texture2`
- `timecode` (single value)
- `Scene` blocks
- `style.*` — arbitrary CSS properties on any object

### v0.2  _(planned)_
- **`timecode` array** — multiple keyframe timestamps on a single object  
  ```
  timecode "0.0" "1.5" "3.0" "5.0"
  ```
  Paired with a `keyframe` array, enables multi-stop interpolation.
- **`keyframe`** — per-stop property overrides matched to timecode array  
  ```
  keyframe +( opacity "0", x "0%" )**
  keyframe +( opacity "1", x "50%" )**
  ```
- `blur startValue endValue start end` — CSS/WebGL blur ramp
- `glow color intensity start end` — drop-shadow glow effect

### v0.3  _(future)_
- `audio` node — embed audio cues synced to timecodes (extracted by ffmpeg)
- `loop count` — repeat an object's timeline N times
- `easing` property — override the easing curve per effect (`linear`, `bounce`, `elastic`, …)
- `mask src` — alpha-mask an object with another object's alpha channel
- `group` — composite multiple objects as a single unit with shared transforms
- Custom GLSL vertex shaders for mesh distortion

---

## CLI Reference

```
bun run zeroanim/zero-anim.js <script.anim> [options]

Options:
  --out <dir>        Output directory for MP4          (default: ./out)
  --frames <dir>     Temporary JPEG/HTML directory     (default: ./frames)
  --fps <n>          Override fps from script
  --keep-frames      Do not delete frames after encoding
  --dry-run          Parse + build timeline, print first non-empty frame, exit
  --renderer         Print detected renderer and exit
  --help             Show this help
```

---

## Directory Layout

```
zeroanim/
├── zero-anim.js              CLI entry point (bun)
├── package.json
├── runtime/
│   └── zero.js               ZeroJS parser + Zero class (ES module)
├── lib/
│   ├── traverse.js           Walk Zero tree → animation data model
│   ├── timeline.js           Per-frame interpolation + easing
│   ├── render-html.js        Single-file HTML generator (all frames embedded)
│   └── capture.js            Chromium screenshot via puppeteer-core (JPEG, async writes)
├── .playwright-browsers/     Chromium binary (chromium-*/chrome-linux64/chrome)
├── examples/
│   ├── hello.anim            Hello World (2 text objects, fade in/out)
│   ├── countdown.anim        3-2-1 countdown with scale effect
│   ├── slide.anim            Text slide with rect and multiple lines
│   ├── shader.anim           GLSL pixel shader rendered inside a box
│   └── logo.anim             source_text + WebGL glitch/corruption effect
├── frames/                   Temporary animation.html + JPEG frames (auto-cleaned)
└── out/                      Output MP4 files
```

---

## Requirements

| Tool | Version | Role |
|------|---------|------|
| **Bun** | ≥ 1.0 | Runs the animation script |
| **Chromium** | 120+ | HTML→JPEG renderer (full CSS + fonts + WebGL) |
| **puppeteer-core** | ≥ 25.1 | Chromium launch and screenshot API |
| **ffmpeg** | ≥ 6.0 | Assembles JPEG frames → MP4 |

---

## Chromium / Puppeteer Setup

`capture.js` locates Chromium in this order:

1. `CHROME_PATH` environment variable (highest priority)
2. A Chromium build at `zeroanim/.playwright-browsers/chromium-*/chrome-linux64/chrome`
3. System commands: `chromium`, `chromium-browser`, `google-chrome`

### Replit / NixOS _(zero configuration)_

`capture.js` automatically prepends the correct Nix store paths to `LD_LIBRARY_PATH`
so the bundled Chromium finds its shared libraries. Nothing extra is needed.

### Linux (Debian / Ubuntu)

Install Chromium via the system package manager **or** Google Chrome directly:

```bash
# Option A — Chromium (open-source build)
sudo apt-get update && sudo apt-get install -y chromium-browser

# Option B — Google Chrome (stable)
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y ./google-chrome-stable_current_amd64.deb
```

The binary is usually auto-detected. Override with:

```bash
export CHROME_PATH=/usr/bin/chromium-browser   # or /usr/bin/google-chrome
```

If Chromium exits with a missing-library error, install the sandbox dependencies:

```bash
sudo apt-get install -y \
  libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libasound2
```

### macOS

Install Chrome via Homebrew or the official installer:

```bash
# Option A — Homebrew cask
brew install --cask google-chrome

# Option B — Chromium (open-source)
brew install --cask chromium
```

Chrome is auto-detected at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
Override with:

```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### Windows

1. Download and install **Google Chrome** from <https://www.google.com/chrome/> or
   **Chromium** from <https://www.chromium.org/getting-involved/download-chromium/>.
2. Set `CHROME_PATH` to the executable (PowerShell):

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

Or add it permanently to your user environment variables via System Properties.

> **Windows Subsystem for Linux (WSL2):** Follow the Linux instructions inside WSL.
> Make sure `bun`, `ffmpeg`, and Chromium are all installed inside the WSL environment,
> not the Windows host.

### Using a custom / downloaded Chromium

Point `CHROME_PATH` at any Chromium-compatible binary:

```bash
export CHROME_PATH=/opt/chromium/chrome
bun run zeroanim/zero-anim.js examples/hello.anim
```

The launcher flags passed to every Chromium instance are:

| Flag | Purpose |
|------|---------|
| `--no-sandbox` | Required in most CI / container environments |
| `--disable-setuid-sandbox` | Companion to `--no-sandbox` |
| `--disable-dev-shm-usage` | Prevents crashes when `/dev/shm` is small |
| `--enable-unsafe-swiftshader` | Software WebGL — enables GLSL shaders without a GPU |
| `--use-gl=angle --use-angle=swiftshader` | Routes WebGL through the SwiftShader CPU renderer |
| `--ignore-gpu-blocklist` | Ensures SwiftShader is used even on blocked GPUs |
| `--allow-file-access-from-files` | Lets `file://` pages load local images / fonts |

---

## ZeroJS Syntax Cheatsheet

```
# Line comment
Animation (             # open node
  title "Name",         # string property
  fps "24",

  text (               # child node
    content "Hi",
    fadein "0" "1",
    fadeout "4" "5"
  )

  rect (
    x "10%", y "80%",
    width "80%", height "3",
    color "#e94560",
    style (
     box_shadow "0 2px 8px #000"
    )
  )

  shader (
    x "0", y "0", width "1280", height "720",
    source_text "HELLO",         # text → u_texture
    source_font "bold 200px Impact",
    source_stroke_width "8",
    glsl "..."
  )

  shader (
    x "0", y "0", width "1280", height "720",
    source_image  "assets/a.jpg",  # image → u_texture
    source_image2 "assets/b.jpg",  # image → u_texture2
    glsl "..."
  )
)

[indexName]             # computed indexer
{ return that["key"]; } # getter JS block (that = current Zero node)
```
