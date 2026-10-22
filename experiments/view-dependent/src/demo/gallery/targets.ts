import * as THREE from 'three';
import type { BoothLayout } from './booth';
import { bottleTexture, bullseyeTexture } from './textures';

export type TargetKind = 'duck' | 'bottle' | 'hidden' | 'floater';

export const POINTS: Record<TargetKind, number> = { duck: 10, bottle: 15, hidden: 50, floater: 25 };

/** Anything that can be shot. Its meshes carry `userData.target = this`. */
export interface Target {
  kind: TargetKind;
  points: number;
  /** The object that moves; decals parent to the mesh that was hit. */
  object: THREE.Object3D;
  alive: boolean;
  hit(dir: THREE.Vector3): void;
  update(dt: number, t: number): void;
  reset(): void;
}

function tag(root: THREE.Object3D, target: Target): void {
  root.traverse((o) => {
    o.userData.target = target;
    if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
}

/** 0 → 1 over `dur`, eased out. */
const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

// ---- Tin duck --------------------------------------------------------------

interface DuckParts { body: THREE.BufferGeometry; head: THREE.BufferGeometry; tail: THREE.BufferGeometry; beak: THREE.BufferGeometry; wing: THREE.BufferGeometry; eye: THREE.BufferGeometry; mark: THREE.BufferGeometry; stand: THREE.BufferGeometry }

/** A flat, painted tin cut-out about 3.4 cm tall, facing +x, base at y = 0. */
function duckParts(): DuckParts {
  const S = 0.036; // overall size
  const thick = 0.0022;
  const ex = (shape: THREE.Shape, depth = thick) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 2, curveSegments: 18 });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number) => {
    const s = new THREE.Shape();
    s.absellipse(cx * S, cy * S, rx * S, ry * S, 0, Math.PI * 2, false, 0);
    return s;
  };
  const tail = new THREE.Shape();
  tail.moveTo(-0.42 * S, 0.42 * S); tail.lineTo(-0.58 * S, 0.62 * S); tail.lineTo(-0.2 * S, 0.5 * S); tail.closePath();
  const beak = new THREE.Shape();
  beak.moveTo(0.42 * S, 0.8 * S); beak.lineTo(0.68 * S, 0.74 * S); beak.lineTo(0.42 * S, 0.68 * S); beak.closePath();
  const stand = new THREE.Shape();
  stand.moveTo(-0.05 * S, 0); stand.lineTo(0.05 * S, 0); stand.lineTo(0.03 * S, 0.22 * S); stand.lineTo(-0.03 * S, 0.22 * S); stand.closePath();
  return {
    body: ex(ellipse(0, 0.4, 0.46, 0.22)),
    head: ex(ellipse(0.28, 0.76, 0.17, 0.16)),
    tail: ex(tail),
    beak: ex(beak),
    wing: ex(ellipse(-0.05, 0.42, 0.24, 0.11), thick * 1.8),
    eye: new THREE.CylinderGeometry(0.022 * S, 0.022 * S, thick * 2.2, 12).rotateX(Math.PI / 2).translate(0.32 * S, 0.8 * S, 0),
    mark: new THREE.CylinderGeometry(0.075 * S, 0.075 * S, thick * 2.0, 20).rotateX(Math.PI / 2).translate(0.2 * S, 0.34 * S, 0),
    stand: ex(stand, 0.004),
  };
}

class Duck implements Target {
  kind: TargetKind = 'duck';
  points = POINTS.duck;
  alive = true;
  readonly object = new THREE.Group();
  private pivot = new THREE.Group();
  private fall = 0;
  private x = 0;
  private lastX = 0;

  constructor(parts: DuckParts, mats: Mats, private row: Row, private offset: number) {
    const add = (g: THREE.BufferGeometry, m: THREE.Material) => this.pivot.add(new THREE.Mesh(g, m));
    add(parts.body, mats.tin); add(parts.head, mats.tin); add(parts.tail, mats.tin);
    add(parts.wing, mats.tinWing); add(parts.beak, mats.beak); add(parts.eye, mats.ink);
    add(parts.mark, mats.markRed); add(parts.stand, mats.iron);
    this.object.add(this.pivot);
    this.object.scale.x = row.dir;
    tag(this.object, this);
  }

  hit(): void { this.alive = false; }

  reset(): void { this.alive = true; this.fall = 0; this.pivot.rotation.x = 0; }

  update(dt: number, t: number): void {
    const { span, speed, dir, y, z } = this.row;
    const u = (((this.offset + (t * speed) / span) % 1) + 1) % 1;
    this.x = dir * (u * span - span / 2);
    // Wrapped around to the start: stand back up, out of sight.
    if (Math.abs(this.x - this.lastX) > span / 2) this.reset();
    this.lastX = this.x;
    this.object.position.set(this.x, y, z);
    // Knocked flat backwards on its hinge.
    this.fall = this.alive ? 0 : Math.min(1, this.fall + dt / 0.22);
    this.pivot.rotation.x = -1.45 * easeOut(this.fall) - (this.alive ? 0 : Math.sin(this.fall * Math.PI) * 0.15);
  }
}

interface Row { span: number; speed: number; dir: 1 | -1; y: number; z: number }

// ---- Milk bottles ------------------------------------------------------------

const BOTTLE_H = 0.026;
const BOTTLE_R = 0.0068;

function bottleGeometry(): THREE.LatheGeometry {
  // radius, height as fractions; v follows these points
  const prof: [number, number][] = [
    [0, 0], [0.92, 0], [1, 0.04], [1, 0.2], [1, 0.38], [1, 0.56], [0.97, 0.64], [0.78, 0.76], [0.56, 0.86], [0.5, 0.93], [0.56, 0.96], [0.54, 1], [0, 1],
  ];
  return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * BOTTLE_R, y * BOTTLE_H)), 28);
}

class Bottle implements Target {
  kind: TargetKind = 'bottle';
  points = POINTS.bottle;
  alive = true;
  readonly object: THREE.Mesh;
  /** Bottles this one stands on. */
  below: Bottle[] = [];
  private vel = new THREE.Vector3();
  private spin = new THREE.Vector3();
  private falling = false;
  private delay = 0;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, private home: THREE.Vector3, private floorY: number) {
    this.object = new THREE.Mesh(geo, mat);
    tag(this.object, this);
    this.reset();
  }

  hit(dir: THREE.Vector3): void {
    if (!this.alive) return;
    this.alive = false;
    this.knock(dir.clone().setY(0).normalize().multiplyScalar(0.35).add(new THREE.Vector3(0, 0.25, 0)), 0);
  }

  /** Lose support: tip off with a little push. */
  knock(v: THREE.Vector3, delay: number): void {
    if (this.falling) return;
    this.alive = false;
    this.falling = true;
    this.delay = delay;
    this.vel.copy(v);
    this.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 18);
  }

  get down(): boolean { return this.falling; }

  reset(): void {
    this.alive = true;
    this.falling = false;
    this.object.visible = true;
    this.object.position.copy(this.home);
    this.object.rotation.set(0, Math.random() * Math.PI * 2, 0);
  }

  update(dt: number): void {
    if (!this.falling) return;
    if (this.delay > 0) { this.delay -= dt; return; }
    this.vel.y -= 1.6 * dt; // miniature gravity reads better than 9.8 at this scale
    this.object.position.addScaledVector(this.vel, dt);
    this.object.rotation.x += this.spin.x * dt;
    this.object.rotation.y += this.spin.y * dt;
    this.object.rotation.z += this.spin.z * dt;
    if (this.object.position.y < this.floorY - 0.05) this.object.visible = false;
  }
}

/** Three-two-one pyramid. Restacks a moment after it's cleared. */
class Pyramid {
  bottles: Bottle[] = [];
  private clearedFor = 0;
  private sinceHit = 0;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, floorY: number, parent: THREE.Object3D) {
    const gap = BOTTLE_R * 2.15;
    const rows: Bottle[][] = [];
    for (let r = 0; r < 3; r++) {
      const row: Bottle[] = [];
      for (let i = 0; i < 3 - r; i++) {
        const b = new Bottle(geo, mat, new THREE.Vector3(x + (i - (2 - r) / 2) * gap, y + r * BOTTLE_H, z), floorY);
        if (r > 0) b.below = [rows[r - 1][i], rows[r - 1][i + 1]];
        parent.add(b.object);
        row.push(b);
        this.bottles.push(b);
      }
      rows.push(row);
    }
  }

  update(dt: number): void {
    // Anything left standing on a fallen bottle tumbles too.
    for (const b of this.bottles) {
      if (!b.down && b.below.some((s) => s.down)) {
        const side = b.below[0].down ? -1 : 1;
        b.knock(new THREE.Vector3(side * 0.08, 0.05, -0.05), 0.06 + Math.random() * 0.08);
      }
      b.update(dt);
    }
    const anyDown = this.bottles.some((b) => b.down);
    this.sinceHit = anyDown ? this.sinceHit + dt : 0;
    this.clearedFor = this.bottles.every((b) => b.down) ? this.clearedFor + dt : 0;
    if (this.clearedFor > 1.6 || this.sinceHit > 7) this.reset();
  }

  reset(): void {
    this.clearedFor = 0; this.sinceHit = 0;
    for (const b of this.bottles) b.reset();
  }
}

// ---- Bullseye plaques ----------------------------------------------------------

function plaqueGeometry(r: number): THREE.CylinderGeometry {
  // Groups: 0 rim, 1 top cap, 2 bottom cap. Turned so the top cap (the
  // bullseye) faces the viewer, +z.
  return new THREE.CylinderGeometry(r, r, r * 0.18, 32).rotateX(Math.PI / 2);
}

/** A bullseye on a stick behind cover; folds back when hit, rises again later. */
class HiddenPlaque implements Target {
  kind: TargetKind = 'hidden';
  points = POINTS.hidden;
  alive = true;
  /** Sits at the hinge, the far end of the stick. */
  readonly object = new THREE.Group();
  private sway = new THREE.Group();
  private down = 0;
  private timer = 0;

  /** @param hang hinge above (hung from the awning) rather than below. */
  constructor(mats: Mats, r: number, at: THREE.Vector3, stickLen: number, private hang = false) {
    const s = hang ? -1 : 1;
    const disc = new THREE.Mesh(plaqueGeometry(r), [mats.brass, mats.bullseye, mats.wood]);
    disc.position.y = s * stickLen;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, stickLen, 8), mats.iron);
    stick.position.y = s * stickLen / 2;
    this.sway.add(disc, stick);
    this.object.add(this.sway);
    this.object.position.copy(at).add(new THREE.Vector3(0, -s * stickLen, 0));
    tag(this.object, this);
  }

  hit(): void { this.alive = false; this.timer = 3.5; }

  reset(): void { this.alive = true; this.down = 0; this.timer = 0; }

  update(dt: number, t: number): void {
    if (!this.alive) {
      this.timer -= dt;
      if (this.timer <= 0) this.alive = true;
    }
    this.down += ((this.alive ? 0 : 1) - this.down) * Math.min(1, dt * (this.alive ? 5 : 14));
    // Fold away from the viewer; a gentle sway while up.
    this.object.rotation.x = (this.hang ? 1 : -1) * this.down * 1.5;
    this.sway.rotation.z = Math.sin(t * 1.3 + this.object.position.x * 40) * 0.04 * (1 - this.down);
  }
}

/** A bullseye hanging on a thread in front of the glass. */
class Floater implements Target {
  kind: TargetKind = 'floater';
  points = POINTS.floater;
  alive = true;
  readonly object = new THREE.Group();
  private disc: THREE.Mesh;
  private thread: THREE.Mesh;
  private gone = 0;
  private respawn = 0;

  constructor(mats: Mats, r: number, private home: THREE.Vector3, private topY: number, private phase: number) {
    this.disc = new THREE.Mesh(plaqueGeometry(r), [mats.brass, mats.bullseye, mats.wood]);
    this.thread = new THREE.Mesh(new THREE.CylinderGeometry(0.0003, 0.0003, 1, 4), mats.thread);
    this.object.add(this.disc, this.thread);
    tag(this.object, this);
    this.thread.castShadow = false;
  }

  hit(): void { this.alive = false; this.gone = 0; this.respawn = 2.5; }

  reset(): void { this.alive = true; this.gone = 0; this.respawn = 0; this.object.visible = true; this.disc.scale.setScalar(1); }

  update(dt: number, t: number): void {
    const bob = Math.sin(t * 1.1 + this.phase) * 0.006;
    const sway = Math.sin(t * 0.7 + this.phase * 2) * 0.004;
    this.object.position.set(this.home.x + sway, this.home.y + bob, this.home.z);
    // thread up to the top of the frame
    const len = this.topY - this.object.position.y;
    this.thread.scale.y = len;
    this.thread.position.y = len / 2;
    if (this.alive) {
      this.disc.rotation.set(0, Math.sin(t * 0.9 + this.phase) * 0.35, 0);
      return;
    }
    this.gone += dt;
    this.respawn -= dt;
    // spin away and shrink, then reappear
    this.disc.rotation.y += dt * 30;
    this.disc.scale.setScalar(Math.max(0.001, 1 - easeOut(this.gone / 0.4)));
    if (this.respawn <= 0) this.reset();
  }
}

// ---- The full set ------------------------------------------------------------------

interface Mats {
  tin: THREE.Material; tinWing: THREE.Material; beak: THREE.Material; ink: THREE.Material; markRed: THREE.Material;
  iron: THREE.Material; brass: THREE.Material; bullseye: THREE.Material; wood: THREE.Material; thread: THREE.Material; bottle: THREE.Material;
}

export class TargetSet {
  readonly group = new THREE.Group();
  readonly targets: Target[] = [];
  private pyramids: Pyramid[] = [];

  constructor(L: BoothLayout, env: THREE.Texture | null) {
    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ envMap: env, envMapIntensity: 0.6, ...o });
    const mats: Mats = {
      tin: std({ color: '#f2c230', metalness: 0.35, roughness: 0.32 }),
      tinWing: std({ color: '#e07b24', metalness: 0.35, roughness: 0.35 }),
      beak: std({ color: '#e0541c', metalness: 0.3, roughness: 0.4 }),
      ink: std({ color: '#111', roughness: 0.3 }),
      markRed: std({ color: '#c8202c', metalness: 0.3, roughness: 0.35 }),
      iron: std({ color: '#3a3836', metalness: 0.8, roughness: 0.45 }),
      brass: std({ color: '#d4a548', metalness: 0.9, roughness: 0.28, envMapIntensity: 1 }),
      bullseye: std({ map: bullseyeTexture(), roughness: 0.5 }),
      wood: std({ color: '#6b4426', roughness: 0.8 }),
      thread: new THREE.MeshBasicMaterial({ color: '#d8d0c0' }),
      bottle: std({ map: bottleTexture(), roughness: 0.12, metalness: 0, envMapIntensity: 1.2 }),
    };

    const { W, H } = L;

    // Two conveyors running opposite ways at different depths.
    const parts = duckParts();
    const span = W + 0.06;
    const rows: [Row, number][] = [
      [{ span, speed: 0.045, dir: 1, y: L.rowA.top - 0.012, z: L.rowA.z }, 7],
      [{ span, speed: 0.03, dir: -1, y: L.rowB.top - 0.01, z: L.rowB.z }, 8],
    ];
    for (const [row, n] of rows) {
      for (let i = 0; i < n; i++) this.add(new Duck(parts, mats, row, i / n));
    }

    // Bottle pyramids on the shelf.
    const geo = bottleGeometry();
    for (const x of L.shelf.xs) {
      const p = new Pyramid(geo, mats.bottle, x, L.shelf.top, L.shelf.z, L.floorY, this.group);
      this.pyramids.push(p);
      for (const b of p.bottles) this.targets.push(b);
    }

    // Hidden: one behind each barrel (lean sideways to see it), one tucked
    // up behind the valance (duck down to see it).
    for (const b of L.barrels) {
      const z = -0.27;
      // Where the barrel's centre line lands at that depth from a centred eye,
      // nudged outward so a small lean reveals it.
      const x = b.x * ((0.6 - z) / (0.6 - b.z)) + Math.sign(b.x) * 0.002;
      // Just below the barrel top's sight line, and above the front ducks'.
      this.add(new HiddenPlaque(mats, 0.0075, new THREE.Vector3(x, b.top - 0.022, z), 0.03));
    }
    this.add(new HiddenPlaque(mats, 0.0085, new THREE.Vector3(W * 0.12, L.valanceBottom + 0.019, -0.085), 0.009, true));

    // Floating in front of the glass.
    const fl: [number, number, number][] = [[-0.26, 0.18, 0.035], [0.08, -0.06, 0.055], [0.3, 0.26, 0.03]];
    fl.forEach(([fx, fy, z], i) => this.add(new Floater(mats, 0.011, new THREE.Vector3(fx * W, fy * H, z), H / 2 + 0.02, i * 2.1)));
  }

  private add(t: Target): void {
    this.targets.push(t);
    this.group.add(t.object);
  }

  update(dt: number, t: number): void {
    for (const tg of this.targets) if (tg.kind !== 'bottle') tg.update(dt, t);
    for (const p of this.pyramids) p.update(dt);
  }

  reset(): void {
    for (const tg of this.targets) if (tg.kind !== 'bottle') tg.reset();
    for (const p of this.pyramids) p.reset();
  }
}
