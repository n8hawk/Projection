# View-dependent demo (webcam + Gaussian splat)

A standalone experiment for head-coupled ("window") rendering. A webcam tracks
your eyes with MediaPipe Face Landmarker, and an off-axis camera renders the
scene so the laptop screen behaves like a pane of glass into a box. Splats are
drawn with [Spark](https://sparkjs.dev) inside a normal three.js scene.

It's kept apart from the hub app on purpose, but `src/core/` has no UI or
scene code so it can become a "Viewer" input source later.

## Run it (Windows, Node 24)

```powershell
cd C:\N8\Claude_Projects\Projection\experiments\view-dependent
npm install
npm run dev
```

Open http://localhost:5180 in Chrome or Edge and allow the camera. The face
model (`public/models`, about 4 MB) and the MediaPipe runtime (copied from
`node_modules` by `vite.config.ts`) are served locally, so it works offline.
`npm run build` produces a static `dist/` folder you can host anywhere.

## Calibrate (two minutes)

1. **Screen**: pick your panel from the preset list, or measure the lit area
   and type width and height in cm (the default is a 16" 16:10 panel). Press **F** for fullscreen.
2. **Webcam offset**: the distance from the centre of the screen to the lens.
   For a top-centre webcam that's Y = half the screen height plus about 0.7 cm.
3. **Field of view**: sit square to the screen with your eyes a measured
   distance from the webcam (a tape measure helps), enter it in
   *Your distance*, and press **Calibrate FOV** (or **C**).
4. Enter your own IPD if you know it (glasses prescriptions often list it).
   It scales the distance estimate.

When it's right, the front edge of the grid room stays glued to the screen
edges as you move, and the ball floating in front of the glass seems to hang
in the air. If moving left makes the scene swing the wrong way, tick
*Mirror left/right*.

## Controls

| Key | Action |
| --- | --- |
| H | Hide or show the panel |
| F | Fullscreen |
| M | Switch between webcam and mouse |
| C | Calibrate the webcam FOV at *Your distance* |
| [ / ] | Previous / next scene |

Mouse mode: move to look around, scroll to lean in or out.

**Motion** settings: *Smoothing* and *Responsiveness* tune a One Euro filter
(steady when still, quick when moving). *Prediction* extrapolates the head
forward to hide camera and render latency. *Parallax gain* above 1×
exaggerates the effect, which can help when filming the screen.

## Scenes and your own splats

Pick a scene from the **Scene** dropdown, or step through them with `[` and
`]`. The list holds the built-in targets, Spark's sample butterfly and every
capture in `public/splats/`: drop a `.ply`, `.spz`, `.splat`, `.ksplat` or
`.sog` file in that folder and reload the page (see its README for free
samples). You can also drop a file on the page, use **Open file…**, or paste a
URL and press **Load URL**. Captures from Polycam, Scaniverse, Luma, Postshot
or KIRI work.

Each capture is fitted to the glass; adjust *Splat scale*, *Splat depth*
(negative is behind the glass) and *Splat turn*, and untick *Flip upright* if
it appears upside down. Placement is remembered per scene.

## Layout

```
src/core/            engine-agnostic, plugin-ready
  types.ts           EyeSample, ViewerTracker, Calibration
  webcamTracker.ts   MediaPipe face landmarks -> eye position in metres
  mouseTracker.ts    fallback tracker
  oneEuro.ts         One Euro filter
  eyeFilter.ts       smoothing + latency prediction
  offAxis.ts         Kooima generalized perspective projection
  screenWindow.ts    where the canvas sits on the physical screen
src/demo/            this page only: scene, settings, panel
src/main.ts          wiring and the frame loop
```

Screen space is metres with the origin at the centre of the display, +x to the
viewer's right, +y up and +z out of the glass toward the viewer. `applyOffAxis`
takes any rectangle, not only the screen, which is what projected surfaces
will need.

## Known limits

- One viewer, one eye point (the midpoint between the eyes).
- Depth comes from the apparent IPD, so it's only as good as the IPD and FOV
  calibration. Turning your head is partly corrected using the face mesh.
- In a window (not fullscreen) the canvas position on screen is estimated from
  the browser's window metrics, which ignore some chrome. Fullscreen is exact.
- A typical 30 fps webcam adds 30 to 60 ms of lag; a 60 fps camera helps.
