# Projection Studio (phase 1 prototype)

Browser-based projection mapping: build a show in a simulated 3D room, map it to surfaces, then send it to a projector.

## Run it

Needs Node 18+ and Chrome or Edge (best on the gaming laptop).

```
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (works offline as a PWA)
npm run preview    # serve the build
```

## What's in phase 1

- **Rehearsal**: 3D room with a back wall, three boxes and a virtual projector that throws the real output onto them (with shadows). Orbit the camera, drag boxes across the floor, add or delete boxes, and set the projector's throw ratio, distance, height, aim, brightness and room light. Views: Audience, Top, Projector POV.
- **Auto-map faces**: finds every box face the projector can see and pins a surface to it. When you move a box or the projector, a green "mapping is stale" flag appears until you re-run it. Re-mapping keeps layer assignments.
- **Map**: corner-pin quads with perspective-correct warping. Drag corners or whole surfaces, nudge with the arrow keys (1 px, Shift for 10 px), type exact values, choose which layers play on each surface, and show a test pattern.
- **Warp grids**: turn any surface into a 2×2 up to 8×6 grid and drag the points to bend the image around curves and dents. The image is smoothed between points. Flatten or go back to four corners at any time.
- **Masks**: black polygons drawn over every layer, to keep light off things. Double-click an edge to add a point, right-click a point to remove it.
- **Soft edge and brightness** per surface.
- **Cylinders** in the rehearsal stage. Auto-map gives the curved side a warp grid and the top a quad.
- **Timeline**: layers (bottom to top) with clips. Drag sources in, move clips between layers, resize from the right edge, snap to 0.5 s (hold Shift to move freely). Overlaps are overwritten the way a video editor does it. Mute per layer. Cue markers on the ruler.
- **Sources**: six built-in shader generators (Neon Drift, Glitch Lines, Waves, Plasma, Grid Pulse, Tide) plus imported VJ loops: MP4, WebM, GIF, PNG and JPG. Imported files are kept in the browser's IndexedDB, so they survive a reload.
- **Clip controls**: Speed, Opacity, Scale, Rotate.
- **Layer effects**: Kaleidoscope (segments, rotate, zoom), Color (hue, saturate, bright), Trails (length, soften, drift).
- **Live**: cue list with GO, clip pads that swap what a layer is playing, master brightness, blackout, test pattern, and macros (Speed, Hue, FX mix, Freeze).
- **Game controller** (PS5 or any standard pad): left stick ↕ for speed, right stick ↔ for hue, R2 for FX mix, Triangle for freeze, Cross to play or pause, Options for blackout.
- **Go Live**: opens the output page in its own window, placed on the second display when Chrome's window placement permission is granted. Click it (or press F) to go fullscreen. The editor and output stay in sync over BroadcastChannel.
- Undo/redo (Ctrl+Z, Ctrl+Shift+Z) and autosave to the browser.

Keys: Space play/pause, 1/2/3 switch screens, Delete removes the selected clip, box or surface, Enter fires the next cue on the Live screen.

## Not yet (next phases)

Multiple projectors and edge blending, sphere and real-world shape detection, audio reactivity, MIDI/OSC, PS5 gyro/rumble/light bar (needs WebHID), the interactive platformer layer, the networked wireless render node, and the iPad performance mode.

## Layout

- `src/model`: show types, the starter template, timeline and auto-map operations
- `src/state`: Zustand store (undo, autosave) and editor/output sync
- `src/engine`: compositor, shaders, corner pin math, projector math, 3D stage, media loading, gamepad, render loop
- `src/ui`: React screens and controls
- `output.html` + `src/output.tsx`: the projector page
