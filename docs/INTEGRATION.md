# Connecting an app to Projection Studio

**Audience:** a Claude (or a person) working in *another* project, such as a VFX Forge generator, that should feed visuals into Projection Studio, Nathan's projection mapping hub.
**Hub repo:** https://github.com/n8hawk/Projection (TypeScript, Vite, React 18, Zustand 4, three.js 0.186, WebGL2).
**Status as of 2026-10-31:** the hub is a phase 1/2 prototype. It has **no plugin system yet**. Section 3 describes what exists today; section 4 is a **proposal** for the plugin contract. Don't build against section 4 as if the hub already implements it. Treat it as the target shape, and expect it to change once the hub side is written.

Drop this file into your project (for example as `docs/PROJECTION_HUB.md`) and point your CLAUDE.md at it.

---

## 1. TL;DR for the other app

1. **Works today, no code on the hub:** export a **seamless loop** as **MP4, WebM or GIF** (or a PNG/JPG still) and import it in the hub's Sources panel. It plays on the timeline and gets Speed, Opacity, Scale, Rotate, the layer effects and the live macros. Sprite sheets are **not** understood (a sheet would show as one still image), so export a video or GIF.
2. **Works today with a small hub change:** if your visual is a **single fragment shader** that is a pure function of position and time, it can be added as a built-in generator (`vec3 gen(vec2 p, float t)`, section 3.4).
3. **Proposed, not built yet:** a **native plugin module** that renders into a texture the hub gives you, declares a parameter schema that becomes knobs and automation, and receives time, tempo and controller input (section 4). This is the plan for multi-pass generators like VFX Forge.
4. **Fallbacks, not built yet:** frames pushed from a separate window or iframe, or a networked render node (section 5).

To be ready for option 3, structure your generator now so that **rendering is separate from your UI**: one object that, given a GL context, a size, a time and a flat `Record<string, number>` of params, draws one frame. Everything below explains why.

---

## 2. What the hub is

A browser app (PWA, works offline) for building a projection show in a simulated 3D room, mapping it onto real surfaces, and sending it to a projector over HDMI. Primary target is a Windows gaming laptop in Chrome/Edge; a high-end iPad is a later, secondary target, so plugins must not rely on desktop-only APIs.

### 2.1 Pages and processes

There are **two pages**, both on the same origin:

| Page | File | Job |
|---|---|---|
| Editor | `index.html` → `src/main.tsx` | UI (Rehearsal, Map, Live screens), state, timeline, previews |
| Output | `output.html` → `src/output.tsx` | No UI. Renders the show fullscreen on the projector |

They talk over a `BroadcastChannel` named `projection-studio` (`src/state/sync.ts`). The editor sends the whole `Show` JSON and a `Transport` whenever either changes. **Each page has its own WebGL context and its own `Engine` and renders every frame itself.** Time is not streamed: both pages compute show time from the transport anchor and `Date.now()`.

**Consequence for you:** a generator runs **twice**, once in the editor preview and once on the output page, in separate GL contexts. Both copies must produce the same picture from the same inputs. That means:
- Your output must be a function of `(time, params, inputs)`, not of hidden state built up in your own UI.
- Any feedback or simulation state (trails, particles) lives inside your instance and is rebuilt per context. Small drift between the preview and the projector is fine; the projector is the one that matters.
- Randomness must be seeded, not `Math.random()` per frame.

### 2.2 Code layout

- `src/model/` show types (`types.ts`), starter show, timeline and auto-map operations, time helpers.
- `src/state/` Zustand store with undo and autosave to `localStorage` (`store.ts`), editor/output sync (`sync.ts`).
- `src/engine/` the compositor (`Engine.ts`), GLSL (`shaders.ts`), effect and param definitions (`effects.ts`), corner-pin and warp maths (`quad.ts`), projector maths (`projector.ts`), the 3D rehearsal room (`Stage.ts`), media loading (`media.ts`, `idb.ts`), gamepad (`gamepad.ts`, `pads.ts`), and the editor render loop (`loop.ts`).
- `src/ui/` React screens and controls.

### 2.3 Render pipeline (per frame, `Engine.render`)

```
for each layer (bottom → top), not muted, with surfaces:
  clip = the clip on that layer at the current show time
  render clip source → layer target A (1280×720)
      generator: fullscreen shader with uTime, uScale, uRotate, uHue
      media:     video / GIF / image texture, cover-fit, same uniforms
  run the layer's enabled effects (Kaleidoscope, Color, Trails), ping-ponging A ↔ B
  for each surface on the layer: draw the layer texture through that surface's
      corner pin or warp grid, with clip opacity, surface soft edge and brightness
draw masks (black polygons) on top
master pass: brightness / blackout → engine.output (1280×720)
```

The output page letterboxes `engine.output` into the display at 16:9. **The working resolution is fixed at 1280×720** (`OUTPUT_W`, `OUTPUT_H` in `src/engine/projector.ts`), RGBA8, linear filtering, no depth buffer. three.js colour management is off, so textures are treated as raw values. Render in the same space you'd show on screen (no sRGB conversion).

### 2.4 The show document

Everything the hub knows lives in one plain-JSON `Show` (`src/model/types.ts`). The parts that matter to a source:

```ts
export type ClipSource =
  | { kind: 'generator'; gen: string }       // built-in shader id, e.g. 'neon-drift'
  | { kind: 'media'; mediaId: string };      // an imported file in show.media

export interface ClipParams {
  speed: number;   // 0..4 ×
  opacity: number; // 0..1
  scale: number;   // 0.25..4 ×
  rotate: number;  // degrees -180..180
}

export interface Clip {
  id: string; layerId: string; name: string;
  start: number; duration: number;   // seconds on the show timeline
  source: ClipSource;
  params: ClipParams;
}

export interface Layer {
  id: string; name: string; color: string;
  surfaceIds: string[];               // which mapped surfaces show this layer
  effects: Effect[];                  // per-layer chain
  muted: boolean;
}

export interface LiveControls {
  brightness: number; blackout: boolean;
  speed: number;   // macro multiplier on every clip
  hue: number;     // degrees, added to every layer
  fxMix: number;   // 0..1 wet amount of every effect
  freeze: boolean;
  testPattern: boolean;
}

export interface Transport {
  playing: boolean;
  anchorTime: number;  // show time at anchorWall
  anchorWall: number;  // Date.now() when last started or seeked
  loop: boolean;
}
```

Because the show is JSON that is saved, undone and posted between windows, **anything you add to it must be JSON-serializable** (no functions, no class instances, no textures).

### 2.5 Clip time

A clip doesn't see raw show time. The engine keeps a per-layer **phase**: it starts at `(showTime - clip.start) * rate` when the clip begins or after a seek, then advances by `dt * clip.params.speed * live.speed` each frame, and stops advancing while `live.freeze` is on. So the Speed knob changes rate smoothly without jumping. Your generator receives this phase as its time. It can go backwards on a seek and resets when the clip changes.

### 2.6 Parameters today

Params are described by `ParamDef` (`src/engine/effects.ts`) and drawn as arc knobs:

```ts
export interface ParamDef {
  key: string; label: string;      // label is UPPERCASE in the UI
  min: number; max: number; def: number; step?: number;
  format: (v: number) => string;   // e.g. 1.25×, 40%, +90°
}
```

There is **no automation lane yet** and no MIDI/OSC. The only live inputs are the four macros and the PS5/standard gamepad (left stick ↕ Speed, right stick ↔ Hue, R2 FX mix, Triangle Freeze, Cross play/pause, Options blackout).

Naming rule from Nathan: params should be named for **projection visuals**, not audio or DAW terms (Kaleidoscope / Segments / Zoom, not Cutoff / Resonance).

Visual style of the hub, if your app wants to match: active cyan `#90ECFF`, violet `#C182D4`, green `#62D289`, chassis `#18191B`, panel `#242528`, text `#E9ECF1` / `#9A9EA5`, Archivo + JetBrains Mono, uppercase tracked labels.

---

## 3. Getting your visuals in today

### 3.1 Export a loop (no hub changes)

Supported imports: `video/*` (MP4/WebM, H.264 or VP9 in Chrome), `image/gif`, `image/png`, `image/jpeg`, `image/webp`. Files are stored in the browser's IndexedDB (`projection-studio` database, `media` store), so they survive reloads and both pages can read them.

Guidelines for your exporter:
- **16:9, 1280×720** is the native size. Other aspects are cover-fit (cropped), not stretched.
- **Seamless loops.** Videos loop natively; the hub seeks them to `phase % duration`.
- **Black, not transparent, background.** Layers are composited with opacity, and alpha in the source is ignored (the media shader outputs alpha 1). Black is "no light" on a projector, which is what you want.
- GIFs are decoded with `ImageDecoder` (Chrome/Edge). Without it, a GIF shows its first frame only.
- WebM (VP9) at a high bitrate keeps glow and gradients cleaner than GIF.

### 3.2 Contribute a built-in shader generator (small hub PR)

If the visual is one fragment shader, add an entry to `GENERATORS` in `src/engine/shaders.ts`:

```ts
export interface GeneratorDef {
  id: string;     // stable, kebab-case; saved in shows as source.gen
  name: string;   // shown on the source tile
  thumb: string;  // CSS background for the tile
  body: string;   // GLSL that defines vec3 gen(vec2 p, float t)
}
```

The hub wraps `body` like this (`generatorFrag`):

```glsl
// provided: uniform float uTime, uScale, uRotate, uHue, uAspect;
// helpers: hueShift(vec3, deg), hash(float), hash2(vec2), rot(vec2, deg), PI,
//          constants CYAN, VIOLET, GREEN
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);   // centred, y up, x ≈ ±0.89, y ±0.5
  p = rot(p, uRotate) / max(uScale, 0.01);
  vec3 col = gen(p, uTime);
  gl_FragColor = vec4(hueShift(col, uHue), 1.0);
}
```

Limits: one pass, no extra uniforms, no textures, no custom params beyond the four clip params. Return linear-ish RGB in 0..1 on a black background. This is the right path for simple looks; it is the wrong path for VFX Forge, which needs multiple passes and its own parameters.

---

## 4. Proposed plugin contract (not implemented)

This is the plan agreed in principle with Nathan ("option 1") and deferred until he asks for it. The hub side does not exist. The shapes below are designed to fit the current engine with minimal change, so build your renderer so it *could* sit behind them.

### 4.1 Goals

- A generator **renders into a texture** the hub owns, at the hub's resolution.
- Its **param schema** becomes knobs in the Properties panel, can be driven by the live macros and controller, and later by automation lanes, MIDI and OSC.
- It **receives time and tempo** (clip phase, show time, and BPM/beat once the hub has a tempo).
- It runs in **both** the editor and output pages and on iPad later, so: WebGL2 only, no Node APIs, no network at render time, offline-capable.

### 4.2 Module shape

A plugin is an ES module whose default export is a `HubPlugin`:

```ts
// projection-hub-plugin.d.ts — copy into your project as-is.

export type ParamFormat = 'number' | 'int' | 'percent' | 'degrees' | 'multiplier' | 'seconds';

export interface PluginParam {
  key: string;          // stable; saved in shows. Never rename once shipped.
  label: string;        // short, uppercase in the hub UI, visual terms
  min: number;
  max: number;
  default: number;
  step?: number;        // omit for continuous
  format?: ParamFormat; // replaces the hub's format function, so the schema stays JSON
  group?: string;       // optional knob grouping, e.g. 'SHAPE', 'GLOW'
  /** Hint for which live macro may drive this param. */
  macro?: 'speed' | 'hue' | 'fxMix';
}

/** Discrete options (shape type, palette) are an int param plus labels. */
export interface PluginChoiceParam extends PluginParam {
  format: 'int';
  options: string[];    // value i shows options[i]
}

export interface PluginManifest {
  id: string;           // globally unique, e.g. 'vfx-forge.plasma-burst'
  name: string;         // shown on the source tile
  version: string;      // semver; the hub stores it with each clip
  thumb?: string;       // CSS background or data: URL for the tile
  params: (PluginParam | PluginChoiceParam)[];
  presets?: { name: string; values: Record<string, number> }[];
  /** True when the visual depends on previous frames (trails, particles). */
  stateful?: boolean;
  /** Natural loop length in seconds if the look is a seamless loop. */
  loopSeconds?: number;
}

export interface FrameInfo {
  /** Clip phase in seconds (already scaled by clip speed × live speed, frozen by Freeze). */
  time: number;
  /** Phase change since the last frame. Can be negative or large after a seek. */
  dt: number;
  /** Raw show-timeline time in seconds. */
  showTime: number;
  playing: boolean;
  /** True when time jumped (seek, clip start). Reset any simulation state. */
  reset: boolean;
  /** Proposed; undefined until the hub has a tempo. */
  bpm?: number;
  /** Beats since show start, fractional. Proposed. */
  beat?: number;
  /** Live macros, read-only; the hub already applies hue/scale/rotate after you. */
  live: { hue: number; fxMix: number; speed: number };
  /** Latest controller snapshot, if any. Same shape as src/engine/pads.ts. */
  pads?: { index: number; id: string; axes: number[]; buttons: { pressed: boolean; value: number }[] }[];
  /** Proposed; 0..1 levels once audio reactivity exists. */
  audio?: { level: number; low: number; mid: number; high: number };
}

export interface RenderTarget {
  framebuffer: WebGLFramebuffer;  // bind this and draw into it
  width: number;                  // currently always 1280
  height: number;                 // currently always 720
}

export interface PluginInstance {
  /** Draw one frame into target. Must leave no GL state that matters (see 4.4). */
  render(frame: FrameInfo, params: Readonly<Record<string, number>>, target: RenderTarget): void;
  /** Called when the working resolution changes (not yet, but planned for multi-projector). */
  resize?(width: number, height: number): void;
  dispose(): void;
}

export interface PluginContext {
  gl: WebGL2RenderingContext;
  width: number;
  height: number;
  /** 'editor' preview or the 'output' projector page. Don't branch the look on it. */
  role: 'editor' | 'output';
  /** Resolve a file shipped next to the module (textures, LUTs). */
  assetUrl(path: string): string;
}

export interface HubPlugin {
  manifest: PluginManifest;
  create(ctx: PluginContext): PluginInstance | Promise<PluginInstance>;
}
```

### 4.3 Example plugin

```ts
import type { HubPlugin, PluginInstance } from './projection-hub-plugin';

const plugin: HubPlugin = {
  manifest: {
    id: 'vfx-forge.plasma-burst',
    name: 'Plasma Burst',
    version: '0.1.0',
    params: [
      { key: 'intensity', label: 'INTENSITY', min: 0, max: 2, default: 1, format: 'multiplier' },
      { key: 'glow', label: 'GLOW', min: 0, max: 1, default: 0.6, format: 'percent', group: 'GLOW' },
      { key: 'seed', label: 'SEED', min: 0, max: 999, default: 7, step: 1, format: 'int' },
    ],
    loopSeconds: 4,
  },
  create({ gl, width, height }): PluginInstance {
    // Build programs, buffers and any private framebuffers here, once.
    const prog = buildPrograms(gl);          // your code
    const glowFbo = makeFbo(gl, width, height);
    return {
      render(frame, params, target) {
        // Your private passes first...
        gl.bindFramebuffer(gl.FRAMEBUFFER, glowFbo.fb);
        gl.viewport(0, 0, width, height);
        drawPlasma(gl, prog, frame.time, params);
        // ...then the final pass into the hub's target.
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
        drawComposite(gl, prog, glowFbo.tex, params);
      },
      dispose() { /* delete programs, textures, framebuffers */ },
    };
  },
};
export default plugin;
```

### 4.4 Rules a plugin must follow

- **Use the given `gl`, don't create a context or canvas.** The hub shares one context across all previews (three.js underneath).
- **Draw the final image into `target.framebuffer`, full frame, opaque, black background.** Alpha is ignored.
- **Assume nothing about GL state on entry and restore nothing on exit**; the hub will call `renderer.resetState()` around you. But don't leave `gl.UNPACK_FLIP_Y_WEBGL` or similar global pixel-store flags changed.
- **No allocation per frame.** Create programs, buffers and textures in `create`; reuse them.
- **Deterministic from inputs.** Seed randomness from a `seed` param. Respect `frame.reset` for simulations.
- **Don't apply hue, scale or rotate yourself** if you want the hub's clip/live controls to behave the same as on other sources. (The hub will run its usual hue/scale/rotate step on your texture.)
- **Budget:** several layers can run at once at 60 fps on a laptop GPU, and the editor renders every source twice (preview and projector page). Aim for under ~2 ms per frame at 1280×720 on a laptop RTX GPU, and keep a cheaper path in mind for iPad.
- **WebGL2 / GLSL ES 3.00 only.** Float render targets need `EXT_color_buffer_float`, which iPad may lack; fall back to `RGBA8` or half float.
- **No network at render time.** The hub must work offline. Ship assets with the module.

### 4.5 How the hub would wire it (for whoever builds the hub side)

- `ClipSource` gains `{ kind: 'plugin'; plugin: string; version: string; params: Record<string, number> }`. Params live on the clip so they save, undo and sync like everything else.
- A plugin registry module shared by `src/main.tsx` and `src/output.tsx`, so both pages can load the same plugins.
- In `Engine.renderLayer`, a third branch: get or create the instance for `(layerId, pluginId)`, pass the clip phase as `frame.time`, render into a private render target via `renderer.properties.get(rt).__webglFramebuffer` with `resetState()` before and after, then run the existing hue/scale/rotate pass and the layer effects as for media.
- The Properties panel builds knobs from `manifest.params`, the Sources panel lists plugins next to generators and loops.
- Missing plugin on load: the clip stays in the show and renders black with a warning, so shows don't break.

### 4.6 Packaging and loading (open)

Planned in this order:
1. **Bundled:** plugin source lives in the hub repo under `src/plugins/<id>/` (copied in, or as a git submodule / npm workspace from the other repo). Simplest, works offline and in the PWA cache, type-checked with the hub.
2. **Dynamic:** the hub `import()`s a module from a URL or a local folder (File System Access API), caches it for offline use. Needed for adding plugins without rebuilding the hub.

Either way, keep your plugin **dependency-free or self-bundled** (one ES module, no bare imports) and **don't import three.js** unless the hub decides to hand you its renderer; the raw `WebGL2RenderingContext` keeps you independent of the hub's three.js version.

---

## 5. Fallbacks (not implemented)

For apps that can't become a module, or must keep running as their own page.

### 5.1 Frame push from another window or iframe

The other app runs its own canvas and sends frames to the hub:

```ts
// In the other app, each frame (or at 30 fps):
const bmp = await createImageBitmap(canvas);          // or canvas.transferToImageBitmap() on OffscreenCanvas
hubWindow.postMessage({ type: 'hub-frame', source: 'vfx-forge', frame: bmp }, hubOrigin, [bmp]);
```

The hub would upload it as a texture for a `{ kind: 'external'; source: string }` clip. Notes:
- A cross-origin iframe's canvas can't be read directly by the hub (it's tainted), so push frames with `postMessage` and transferable `ImageBitmap`s. Same-origin pages can share a canvas directly.
- Costs a GPU→CPU→GPU round trip per frame and adds about one frame of latency. Fine at 1280×720 for one or two sources.
- The output page needs frames too, so the other app must send to both pages, or the hub forwards them. A `BroadcastChannel` works only same-origin.
- The other app should still accept params and time from the hub by `postMessage` (`{ type: 'hub-params', params }`, `{ type: 'hub-time', time, playing }`) so knobs and the timeline drive it.
- Last resort for any app: `getDisplayMedia()` tab capture into a video texture. Needs a user prompt every session and adds latency.

### 5.2 Networked render node

A separate machine or process renders and streams video to the projector box, or the hub streams its output to a node next to the projector (the planned wireless path). Likely WebRTC. Spout/NDI/Syphon are native-only and not reachable from a browser without a helper app. Nothing here is designed yet.

---

## 6. Checklist for the other app

- [ ] Rendering is a separate object from your UI: `create(gl, w, h)` → `render(time, params, framebuffer)` → `dispose()`.
- [ ] All params are numbers in a flat object, with min/max/default, stable keys and visual-language labels. Choices are int indexes.
- [ ] Output is a function of time, params and seed. No `Math.random()` per frame, no state that only your UI knows.
- [ ] Draws into a framebuffer you're given, at whatever size you're given (1280×720 today), on black.
- [ ] Seamless loops where the look loops; expose the loop length.
- [ ] WebGL2 only, no new canvas, no per-frame allocation, offline assets, iPad-safe fallbacks.
- [ ] Until the hub has plugins: an exporter to 1280×720 WebM/MP4 or GIF on black, which the hub imports today.

## 7. Open questions and limits

- **Plugin system:** not built. Contract above is a proposal; field names may change when the hub side is written.
- **Tempo:** the hub has no BPM, beat clock or tap tempo yet. `bpm` and `beat` are placeholders.
- **Automation:** no automation lanes, MIDI or OSC yet. Params will be static per clip at first, plus macros and controller.
- **Resolution:** fixed 1280×720 for now. Multi-projector and higher resolutions are planned; implement `resize`.
- **Alpha/blend modes:** layers composite with opacity only. No additive or alpha-keyed blending of sources yet.
- **Two renders:** editor and output each render every source. Heavy plugins cost double while editing.
- **Loading model** (bundled vs dynamic import) and plugin trust/sandboxing are undecided. Assume bundled first.
- **Audio input** for reactive visuals is planned, not designed.
- **Interactive scenes** (stateful game-like plugins that know the mapped surfaces, e.g. a platformer jumping across boxes) are planned for later and will need a richer contract than a texture generator: surface geometry, physics and events. Not covered here.

When the hub side lands, this file in the hub repo (`docs/INTEGRATION.md`) is the source of truth. Re-copy it into your project.
