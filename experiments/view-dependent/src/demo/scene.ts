import * as THREE from 'three';
import { SplatMesh, type PackedSplats } from '@sparkjsdev/spark';

// Hub palette
const CYAN = new THREE.Color('#90ECFF');
const VIOLET = new THREE.Color('#C182D4');
const GREEN = new THREE.Color('#62D289');
const AMBER = new THREE.Color('#FFB36B');

export interface SceneLayout {
  /** Screen size, metres. The room's opening matches the glass. */
  width: number;
  height: number;
  /** How far the room extends behind the glass, metres. */
  depth: number;
}

export interface SplatPlacement {
  scale: number;
  /** Extra push behind (-) or in front of (+) the glass, metres. */
  zOffset: number;
  yawDeg: number;
  /** Most captures are stored y-down; flip them upright. */
  flip: boolean;
}

/**
 * The demo world. Units are metres in screen space (the glass is the z = 0
 * plane), so the off-axis camera gives physically correct parallax.
 */
export class DemoScene {
  readonly root = new THREE.Group();
  private room = new THREE.Group();
  private procedural = new THREE.Group();
  private nebula: SplatMesh | null = null;
  private loadedHolder = new THREE.Group();
  private loaded: SplatMesh | null = null;
  private loadedFit = 1;
  private loadTicket = 0;
  layout: SceneLayout;
  placement: SplatPlacement = { scale: 1, zOffset: 0, yawDeg: 0, flip: true };

  constructor(layout: SceneLayout) {
    this.layout = layout;
    this.root.add(this.room, this.procedural, this.loadedHolder);
    this.rebuild();
  }

  setLayout(layout: SceneLayout): void {
    const l = this.layout;
    if (l.width === layout.width && l.height === layout.height && l.depth === layout.depth) return;
    this.layout = layout;
    this.rebuild();
  }

  set showRoom(v: boolean) { this.room.visible = v; }
  get showRoom(): boolean { return this.room.visible; }

  get hasLoadedSplat(): boolean { return !!this.loaded; }

  /** Show the loaded capture instead of the built-in targets (or back). */
  set showLoaded(v: boolean) {
    this.loadedHolder.visible = v && !!this.loaded;
    this.procedural.visible = !this.loadedHolder.visible;
  }

  /** Back to the built-in targets, dropping any capture still loading. */
  showBuiltIn(): void {
    this.loadTicket++;
    this.showLoaded = false;
  }

  /** Just the room, nothing in it. */
  showEmpty(): void {
    this.showBuiltIn();
    this.procedural.visible = false;
  }

  tick(time: number): void {
    if (this.nebula) this.nebula.rotation.z = time * 0.05;
    this.applyPlacement();
  }

  /** Load a .ply / .spz / .splat / .ksplat / .sog capture from a URL or File. */
  async loadSplat(src: string | File): Promise<void> {
    const ticket = ++this.loadTicket;
    const mesh = typeof src === 'string'
      ? new SplatMesh({ url: src })
      : new SplatMesh({ fileBytes: new Uint8Array(await src.arrayBuffer()), fileName: src.name });
    await mesh.initialized;
    // Switching scenes mid-load: only the latest request is shown.
    if (ticket !== this.loadTicket) { mesh.dispose(); return; }
    if (this.loaded) { this.loadedHolder.remove(this.loaded); this.loaded.dispose(); }
    const box = mesh.getBoundingBox(true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    mesh.position.copy(center).multiplyScalar(-1);
    this.loaded = mesh;
    this.loadedHolder.add(mesh);
    // Fit the capture to about 80% of the glass.
    const { width, height } = this.layout;
    this.loadedFit = Math.min((width * 0.8) / Math.max(1e-6, size.x), (height * 0.8) / Math.max(1e-6, size.y));
    this.showLoaded = true;
  }

  private applyPlacement(): void {
    const p = this.placement;
    const h = this.loadedHolder;
    h.scale.setScalar(this.loadedFit * p.scale);
    h.rotation.set(p.flip ? Math.PI : 0, THREE.MathUtils.degToRad(p.yawDeg), 0, 'YXZ');
    h.position.set(0, 0, -this.layout.depth * 0.45 + p.zOffset);
  }

  private rebuild(): void {
    for (const g of [this.room, this.procedural]) {
      for (const c of [...g.children]) {
        g.remove(c);
        if (c instanceof SplatMesh) c.dispose();
        else if (c instanceof THREE.LineSegments) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
      }
    }
    this.buildRoom();
    this.buildTargets();
  }

  /** A grid-lined box behind the glass, like Johnny Lee's 2007 Wii demo. */
  private buildRoom(): void {
    const { width: W, height: H, depth: D } = this.layout;
    const pts: number[] = [];
    const seg = (a: THREE.Vector3Tuple, b: THREE.Vector3Tuple) => pts.push(...a, ...b);
    const nx = 10, ny = Math.max(4, Math.round((10 * H) / W)), nz = Math.max(4, Math.round((10 * D) / W));
    for (let i = 0; i <= nx; i++) {
      const x = -W / 2 + (W * i) / nx;
      seg([x, -H / 2, 0], [x, -H / 2, -D]); // floor
      seg([x, H / 2, 0], [x, H / 2, -D]); // ceiling
      seg([x, -H / 2, -D], [x, H / 2, -D]); // back wall
    }
    for (let j = 0; j <= ny; j++) {
      const y = -H / 2 + (H * j) / ny;
      seg([-W / 2, y, 0], [-W / 2, y, -D]);
      seg([W / 2, y, 0], [W / 2, y, -D]);
      seg([-W / 2, y, -D], [W / 2, y, -D]);
    }
    for (let k = 0; k <= nz; k++) {
      const z = (-D * k) / nz;
      seg([-W / 2, -H / 2, z], [W / 2, -H / 2, z]);
      seg([-W / 2, H / 2, z], [W / 2, H / 2, z]);
      seg([-W / 2, -H / 2, z], [-W / 2, H / 2, z]);
      seg([W / 2, -H / 2, z], [W / 2, H / 2, z]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.28 });
    this.lines = new THREE.LineSegments(geo, mat);
    // Solid splat walls for the flashlight to light up (lines can't be lit).
    this.walls = new SplatMesh({ constructSplats: (sp) => wallSplats(sp, W, H, D) });
    this.room.add(this.lines, this.walls);
    this.litRoom = this.lit;
  }

  private lit = false;
  private lines: THREE.LineSegments | null = null;
  private walls: SplatMesh | null = null;
  private strings: THREE.LineSegments | null = null;
  private targets: { p: THREE.Vector3Tuple; r: number }[] = [];

  /** Swap the glowing grid lines for solid walls that a light can reveal. */
  set litRoom(v: boolean) {
    this.lit = v;
    // Faint rather than hidden in the dark, so the room stays easy to read.
    if (this.lines) (this.lines.material as THREE.LineBasicMaterial).opacity = v ? 0.1 : 0.28;
    // Lines can't be lit, so they'd glow in the dark.
    if (this.strings) this.strings.visible = !v;
    // Fade rather than hide: changing which splat meshes are visible makes
    // Spark rebuild its whole splat list.
    if (this.walls) this.walls.opacity = v ? 1 : 0;
  }

  /**
   * Where a ray first meets the built-in targets or the room's walls, solved
   * analytically so it's cheap enough to run every frame. Loaded captures
   * aren't tested; the ray lands on the wall behind them.
   */
  hitTest(origin: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
    let best = Infinity;
    if (this.procedural.visible) {
      for (const t of this.targets) {
        // Ray-sphere, nearest hit in front of the origin.
        const ox = origin.x - t.p[0], oy = origin.y - t.p[1], oz = origin.z - t.p[2];
        const b = ox * dir.x + oy * dir.y + oz * dir.z;
        const c = ox * ox + oy * oy + oz * oz - t.r * t.r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const d = -b - Math.sqrt(disc);
        if (d > 0.05 && d < best) best = d;
      }
    }
    if (this.room.visible) {
      // Inside of the box behind the glass: x = ±W/2, y = ±H/2, z = -D.
      const { width: W, height: H, depth: D } = this.layout;
      const planes: [number, number][] = [[0, -W / 2], [0, W / 2], [1, -H / 2], [1, H / 2], [2, -D]];
      for (const [axis, at] of planes) {
        const o = origin.getComponent(axis), v = dir.getComponent(axis);
        if (Math.abs(v) < 1e-6) continue;
        const d = (at - o) / v;
        if (d <= 0.05 || d >= best) continue;
        const x = origin.x + dir.x * d, y = origin.y + dir.y * d, z = origin.z + dir.z * d;
        // A little slack round the edges, so the very edge of the screen
        // still lands on the floor or wall it shows.
        const e = 2e-3;
        if (x >= -W / 2 - e && x <= W / 2 + e && y >= -H / 2 - e && y <= H / 2 + e && z <= e && z >= -D - e) best = d;
      }
    }
    return best < Infinity ? out.copy(origin).addScaledVector(dir, best) : null;
  }

  /** Splat "targets" at different depths, one floating in front of the glass,
   *  plus a slowly turning galaxy on the back wall. */
  private buildTargets(): void {
    const { width: W, height: H, depth: D } = this.layout;
    const targets: { p: THREE.Vector3Tuple; r: number; c: THREE.Color }[] = [
      { p: [-0.28 * W, 0.12 * H, -0.15 * D], r: 0.05 * H, c: CYAN },
      { p: [0.22 * W, -0.18 * H, -0.35 * D], r: 0.06 * H, c: VIOLET },
      { p: [0.05 * W, 0.22 * H, -0.65 * D], r: 0.07 * H, c: GREEN },
      { p: [-0.12 * W, -0.25 * H, -0.85 * D], r: 0.08 * H, c: AMBER },
      { p: [0.34 * W, 0.28 * H, -0.55 * D], r: 0.05 * H, c: CYAN },
      { p: [-0.02 * W, -0.02 * H, 0.12 * D], r: 0.04 * H, c: VIOLET }, // pops out of the glass
    ];

    this.targets = targets;
    const strings: number[] = [];
    for (const t of targets) {
      const mesh = new SplatMesh({ constructSplats: (s) => ballSplats(s, t.r, t.c) });
      mesh.position.set(...t.p);
      this.procedural.add(mesh);
      strings.push(...t.p, t.p[0], t.p[1], -D);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(strings, 3));
    this.strings = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    this.strings.visible = !this.lit;
    this.procedural.add(this.strings);

    this.nebula = new SplatMesh({ constructSplats: (s) => galaxySplats(s, Math.min(W, H) * 0.42) });
    this.nebula.position.set(0, 0, -D * 0.97);
    this.procedural.add(this.nebula);
  }
}

const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const IDENT = new THREE.Quaternion();
const WHITE = new THREE.Color(1, 1, 1);
const LIGHT = new THREE.Vector3(-0.5, 0.7, 0.6).normalize();

/** A shaded ball built from a few thousand small gaussians. */
function ballSplats(s: PackedSplats, r: number, color: THREE.Color): void {
  const n = 2600;
  for (let i = 0; i < n; i++) {
    // Mostly on the surface, with some fill so the ball isn't hollow.
    const dir = tmpP.randomDirection();
    const shade = 0.35 + 0.65 * Math.max(0, dir.dot(LIGHT));
    const rr = r * (i % 5 === 0 ? Math.cbrt(Math.random()) : 0.92 + Math.random() * 0.08);
    tmpC.copy(color).multiplyScalar(shade);
    if (dir.dot(LIGHT) > 0.92) tmpC.lerp(WHITE, 0.6); // highlight
    tmpS.setScalar(r * 0.09);
    s.pushSplat(dir.multiplyScalar(rr), tmpS, IDENT, 0.9, tmpC);
  }
}

/** Five walls of flat gaussians with a faint tile grid, open toward the glass. */
function wallSplats(s: PackedSplats, W: number, H: number, D: number): void {
  // About 60k splats regardless of room size.
  const area = W * H + 2 * W * D + 2 * H * D;
  const step = Math.sqrt(area / 60000);
  const tile = W / 10;
  const thin = step * 0.4;
  const wall = (n: THREE.Vector3Tuple, from: THREE.Vector3Tuple, u: THREE.Vector3Tuple, v: THREE.Vector3Tuple, lu: number, lv: number) => {
    tmpS.set(n[0] ? thin : step * 0.75, n[1] ? thin : step * 0.75, n[2] ? thin : step * 0.75);
    for (let a = step / 2; a < lu; a += step) {
      for (let b = step / 2; b < lv; b += step) {
        tmpP.set(from[0] + u[0] * a + v[0] * b, from[1] + u[1] * a + v[1] * b, from[2] + u[2] * a + v[2] * b);
        const onLine = (x: number) => Math.abs(((x + tile * 100) % tile) - tile / 2) > tile / 2 - step * 0.8;
        const grid = onLine(tmpP.x) || onLine(tmpP.y) || onLine(tmpP.z);
        const g = 0.32 + Math.random() * 0.06;
        tmpC.setRGB(g * 0.95, g, g * 1.1);
        if (grid) tmpC.lerp(CYAN, 0.45);
        s.pushSplat(tmpP, tmpS, IDENT, 1, tmpC);
      }
    }
  };
  wall([0, 0, 1], [-W / 2, -H / 2, -D], [1, 0, 0], [0, 1, 0], W, H); // back
  wall([0, 1, 0], [-W / 2, -H / 2, 0], [1, 0, 0], [0, 0, -1], W, D); // floor
  wall([0, 1, 0], [-W / 2, H / 2, 0], [1, 0, 0], [0, 0, -1], W, D); // ceiling
  wall([1, 0, 0], [-W / 2, -H / 2, 0], [0, 1, 0], [0, 0, -1], H, D); // left
  wall([1, 0, 0], [W / 2, -H / 2, 0], [0, 1, 0], [0, 0, -1], H, D); // right
}

/** A two-arm spiral of tiny gaussians. */
function galaxySplats(s: PackedSplats, radius: number): void {
  const n = 40000;
  for (let i = 0; i < n; i++) {
    const arm = i % 2;
    const t = Math.pow(Math.random(), 0.7);
    const a = t * 7 + arm * Math.PI + (Math.random() - 0.5) * 0.6;
    const spread = radius * 0.08 * (1 - t * 0.5);
    tmpP.set(
      Math.cos(a) * t * radius + (Math.random() - 0.5) * spread,
      Math.sin(a) * t * radius + (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * radius * 0.05,
    );
    tmpC.copy(VIOLET).lerp(CYAN, t).multiplyScalar(0.5 + Math.random() * 0.6);
    if (t < 0.12) tmpC.lerp(AMBER, 0.7);
    tmpS.setScalar(radius * (0.004 + Math.random() * 0.006));
    s.pushSplat(tmpP, tmpS, IDENT, 0.55, tmpC);
  }
}
