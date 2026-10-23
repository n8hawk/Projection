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

Or double-click `start-demo.cmd` (it installs on first run, starts the server
and opens the browser; close its window to stop). Open http://localhost:5180 in
Chrome or Edge and allow the camera. The face
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

## The menu

The top of the panel holds the two choices that matter most:

- **Demo**: *Window* (just look), *Flashlight* (light the scene with a
  torch), *Shooting gallery* or *Sci-fi plaza*.
- **Scene**: grouped into *3D rooms* (the sci-fi plaza, the carnival booth, the grid room with
  splat targets), *Splat captures* (Spark's sample, everything in
  `public/splats`, a custom URL) and *Blank* (an empty grid room).

Below that, folding sections hold the options for the current demo, the
scene, **Tracking**, **Controller**, **Display** (screen and webcam
calibration, folded away once set) and **Advanced** (the webcam preview and
tracking numbers). Each section has its own *Reset*, and the panel remembers
your last demo, scene and settings.

## Controls

| Key | Action |
| --- | --- |
| 1 / 2 / 3 / 4 | Window / Flashlight / Shooting gallery / Sci-fi plaza |
| [ / ] | Previous / next scene |
| Space | Fire (hold for full auto in the plaza) |
| 0 | Reset the score (rebuild the plaza) |
| H | Hide or show the panel |
| F | Fullscreen |
| L | Flashlight on or off |
| R | Recentre the aim |
| M | Switch between webcam and mouse |
| C | Calibrate the webcam FOV at *Your distance* |

Mouse mode: move to look around, scroll to lean in or out.

**Motion** settings: *Smoothing* and *Responsiveness* tune a One Euro filter
(steady when still, quick when moving). *Prediction* extrapolates the head
forward to hide camera and render latency. *Parallax gain* above 1×
exaggerates the effect, which can help when filming the screen.

## Flashlight (PS5 controller)

Pick the *Flashlight* demo (or press **L**, or △ on the controller) to darken
the scene and light it with a torch held a little below your eyes. Aim it
with:

- **PS5 gyro**: press *Connect PS5 gyro* in the Controller section (Chrome or
  Edge, USB or Bluetooth) and point the controller. Hold it still for a second
  after connecting while it learns its drift. Press R3, the touchpad or **R**
  to recentre. If it turns the wrong way, use the invert toggles.
- **Right stick** on any controller.
- **Mouse**: the beam follows the pointer. In mouse head mode, hold Shift to
  move your head instead.

L1 / R1 narrow or widen the beam, the D-pad ◀ ▶ changes scene and ▲ ▼
changes demo. In splat scenes the light is Spark SDF colour edits
(`src/demo/flashlight.ts`); in the carnival booth it is a real three.js
spotlight that casts shadows.

## Shooting gallery (carnival booth)

A fully modelled, lit booth sized to your screen, built to show off the
window effect in layers:

- **At the glass**: the counter, candy-striped posts and a scalloped awning
  with string bulbs frame the view, and three bullseyes hang on threads
  *in front of* the glass.
- **Midground**: tin ducks on two conveyors running opposite ways, barrels and
  crates for cover, and milk-bottle pyramids on a shelf.
- **Background**: a painted backdrop half a metre behind the glass.

Aim with the gyro, the right stick or the mouse (the ring shows where the shot
will land and turns red over a live target), and fire with **R2**, **✕**, a
click or **Space**. Ducks score 10, bottles 15, floating targets 25. Three
hidden targets score 50: two sit behind the barrels (lean sideways to see
round them) and one is tucked behind the awning (duck down). Hits rumble the
controller, ring a bell and leave a mark that rides along with whatever you
hit. **Options** or **0** resets the score. The booth's code is in
`src/demo/gallery/`.

## Sci-fi plaza (plasma machine gun)

A wide shot over a ruined, alien-held city square at dusk, built for
shooting rather than for a booth. It is modelled at full size and shrunk
1:20 onto the screen, so the laptop looks out over a few hundred metres:

- **Up close**: low rubble and two broken columns just behind the glass.
  A squad crouches behind the left column and a turret sits behind the right
  one; lean (or rise) to peek round them.
- **The square**: burning wrecks, explosive barrels, a crashed dropship,
  drones patrolling at every depth, and an elevated highway whose pillars
  you can shoot out (the spans fall). A sniper's scope glints on the deck.
- **Far off**: the city skyline, walkers striding through it, an alien spire,
  a mothership with its beam on, and mountains under a dusk sky.

Hold **R2** (or click, or hold **Space** or **✕**) for full-auto plasma.
The gun overheats after about four seconds of fire and vents until it has
cooled to a third. Barrels set each other off, cover crumbles as you hit it,
wrecks flip when they blow, and drones, troopers, the turret and walkers go
down and come back after a while. **Options** or **0** rebuilds everything.

**The controller is the gun.** In this demo shots leave from the
controller's USB port and travel in a straight line along where it points,
so moving your head never changes where a shot lands. Set where you hold it
under *Controller → Where you hold it* (measured from the middle of the
screen to the USB port; the default is 18 cm below and 35 cm out), point the
port at the middle of the screen and press R3 or the touchpad to line it up.
*Pointer gain* 1× is a true laser pointer. With the mouse, the shot goes from
the port to whatever is under the pointer.

The open reticle sits where the shot will land. The dashed ring around it
is the aim assist (*Aim assist*, 3° by default): shots that pass that close
to an enemy hit it, and red brackets show what it has locked onto. The code
is in `src/demo/plaza/`.

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
