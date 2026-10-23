import * as THREE from 'three';
import type { AimRay } from '../core/aim';
import type { FlashlightSettings } from './flashlight';
import { Debris, Particles } from './plaza/particles';
import { Barrel, Prop, type PlazaFx } from './plaza/props';
import { PlazaSfx } from './plaza/sound';
import { glowTexture } from './plaza/textures';
import type { SceneLayout } from './scene';

/**
 * Flashlight blaster: the flashlight demo's room, plus a blaster in the torch
 * (R2) and a few of the plaza's red barrels on the floor that blow up, and set
 * each other off, when you hit them.
 *
 * Bolts fly in desk metres, from the torch along its beam. The barrels and
 * their effects live in a small scene-metre group (1 scene m = SCALE desk m)
 * standing on the room's floor, so the plaza's barrel code works unchanged.
 */
const SCALE = 0.035;
const FIRE_RATE = 8;
/** Bolt speed, desk metres per second: slow enough to watch it fly. */
const BOLT_SPEED = 3;
const MAX_BOLTS = 24;
/** Scene m/s²: a bit floaty, so explosions hang in the air. */
const GRAVITY = 30;
/** The plaza's blasts are sized for a street; shrink them for a shoebox. */
const FX = 0.22;
const BLAST = 0.35;

export interface BlasterSettings {
  sound: boolean;
  rumble: boolean;
}

export const DEFAULT_BLASTER: BlasterSettings = { sound: true, rumble: true };

interface Bolt {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  prop: Prop | null;
  normal: THREE.Vector3;
  t: number;
  dur: number;
  active: boolean;
}

export interface BlasterHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  prop: Prop | null;
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export class FlashlightBlaster implements PlazaFx {
  readonly root = new THREE.Group();
  /** Scene metres, standing on the room's floor. */
  readonly world = new THREE.Group();
  readonly sfx = new PlazaSfx();
  settings: BlasterSettings = { ...DEFAULT_BLASTER };
  onRumble: (strong: number, weak: number, ms: number) => void = () => { /* none */ };
  /** The room's walls and splat targets: where a ray meets them, or null. */
  hitRoom: (origin: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3 | null = () => null;

  wrecked = 0;
  private props: Prop[] = [];
  private hittables: THREE.Object3D[] = [];
  private glow = new Particles(3000, true);
  private smoke = new Particles(1200, false);
  private debris = new Debris(200);
  private bolts: Bolt[] = [];
  private flashes: { light: THREE.PointLight; life: number; peak: number }[] = [];
  /** The torch as a real light, so the barrels (not splats) light up too. */
  private beam = new THREE.SpotLight('#fff0dc', 0, 0, 0.1, 0.3, 2);
  private ambient = new THREE.HemisphereLight('#c8d0ff', '#40302c', 0.4);
  private muzzle = new THREE.PointLight('#9a8cff', 0, 0.25, 2);
  private raycaster = new THREE.Raycaster();
  private cooldown = 0;
  private layout: SceneLayout;
  private eye = new THREE.Vector3(0, 0, 0.6);
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();

  constructor(layout: SceneLayout) {
    this.layout = layout;
    this.root.name = 'blaster';
    this.world.scale.setScalar(SCALE);
    this.root.add(this.world, this.beam, this.beam.target, this.ambient, this.muzzle);
    this.world.add(this.glow.points, this.smoke.points, this.debris.mesh);
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight('#ffb070', 0, 0.35, 2);
      this.world.add(light);
      this.flashes.push({ light, life: 0, peak: 0 });
    }
    const boltGeo = new THREE.SphereGeometry(1, 10, 6);
    const glowTex = glowTexture();
    for (let i = 0; i < MAX_BOLTS; i++) {
      const mesh = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: C(1.6, 1.3, 4), toneMapped: false }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#8a6cff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      mesh.visible = glow.visible = false;
      mesh.renderOrder = glow.renderOrder = 7;
      mesh.raycast = () => { /* not solid */ };
      glow.raycast = () => { /* not solid */ };
      this.root.add(mesh, glow);
      this.bolts.push({ mesh, glow, from: new THREE.Vector3(), to: new THREE.Vector3(), prop: null, normal: new THREE.Vector3(), t: 0, dur: 0, active: false });
    }
    this.buildBarrels();
  }

  /** Follow the room when the screen size or room depth changes. */
  setLayout(layout: SceneLayout): void {
    const l = this.layout;
    if (l.width === layout.width && l.height === layout.height && l.depth === layout.depth) return;
    this.layout = layout;
    this.buildBarrels();
  }

  private buildBarrels(): void {
    for (const p of this.props) this.world.remove(p.object);
    this.props = [];
    this.hittables = [];
    const { width: W, depth: D } = this.layout;
    // Fractions of the room: a cluster at the back left, a pair on the right,
    // one alone at the back and one near the glass.
    const spots: [number, number][] = [
      [-0.3, -0.78], [-0.22, -0.84], [-0.25, -0.7],
      [0.27, -0.48], [0.34, -0.54],
      [0.04, -0.92],
      [-0.06, -0.32],
    ];
    for (const [fx, fz] of spots) {
      const b = new Barrel(new THREE.Vector3((fx * W) / SCALE, 0, (fz * D) / SCALE));
      b.space = this.world;
      this.props.push(b);
      this.world.add(b.object);
      b.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.hittables.push(o); });
    }
  }

  setEye(eye: { x: number; y: number; z: number }): void { this.eye.set(eye.x, eye.y, eye.z); }

  /** The torch as a three.js spotlight matching the splat flashlight's beam. */
  setBeam(ray: AimRay | null, f: FlashlightSettings): void {
    this.ambient.intensity = 0.15 + f.ambient * 0.8;
    if (!ray) { this.beam.intensity = 0; return; }
    this.beam.intensity = 0.5;
    this.beam.angle = THREE.MathUtils.degToRad(f.angleDeg) * 1.15;
    this.beam.penumbra = THREE.MathUtils.clamp(0.25 + f.softness * 10, 0, 1);
    this.beam.position.copy(ray.origin);
    this.beam.target.position.copy(ray.origin).add(ray.dir);
  }

  /** First thing along a ray (desk metres): a barrel, or the room. */
  cast(origin: THREE.Vector3, dir: THREE.Vector3, out: BlasterHit): BlasterHit | null {
    this.root.updateMatrixWorld();
    this.raycaster.set(origin, dir);
    let best = Infinity;
    out.prop = null;
    for (const h of this.raycaster.intersectObjects(this.hittables, false)) {
      if (!visibleUp(h.object)) continue;
      best = h.distance;
      out.point.copy(h.point);
      out.normal.copy(h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : this.v.copy(dir).negate());
      out.prop = (h.object.userData.prop as Prop | undefined) ?? null;
      break;
    }
    const room = this.hitRoom(origin, dir, this.w);
    if (room && room.distanceTo(origin) < best) {
      best = room.distanceTo(origin);
      out.point.copy(room);
      out.normal.copy(dir).negate();
      out.prop = null;
    }
    return best < Infinity ? out : null;
  }

  /** Hold to fire: one bolt on the press, then automatic. `target` sends the
   *  bolt to a spot already picked (the mouse picks it from your eye). */
  trigger(held: boolean, ray: AimRay, dt: number, target: BlasterHit | null = null): void {
    this.cooldown -= dt;
    if (!held || this.cooldown > 0) return;
    this.cooldown = 1 / FIRE_RATE;
    const hit = target ?? this.cast(ray.origin, ray.dir, { point: new THREE.Vector3(), normal: new THREE.Vector3(), prop: null });
    const b = this.bolts.find((x) => !x.active) ?? this.bolts[0];
    b.active = true;
    b.from.copy(ray.origin);
    b.to.copy(hit ? hit.point : this.v.copy(ray.origin).addScaledVector(ray.dir, 2));
    b.prop = hit?.prop ?? null;
    b.normal.copy(hit ? hit.normal : ray.dir).normalize();
    if (!hit) b.normal.negate();
    b.t = 0;
    b.dur = Math.max(0.02, b.from.distanceTo(b.to) / BOLT_SPEED);
    b.mesh.visible = b.glow.visible = false;
    this.sfx.shot(0);
    this.onRumble(0.05, 0.35, 40);
    this.muzzle.position.copy(ray.origin);
    this.muzzle.intensity = 0.03;
  }

  // ---- PlazaFx (scene metres) --------------------------------------------

  sparks(at: THREE.Vector3, normal: THREE.Vector3, n: number, hot: boolean, scale = 1): void {
    for (let i = 0; i < n; i++) {
      const vel = this.v.randomDirection().addScaledVector(normal, 1.4).normalize().multiplyScalar((2 + Math.random() * 4) * scale);
      this.glow.emit({
        pos: at.clone(), vel: vel.clone(), life: 0.25 + Math.random() * 0.3, size: 0.1 * scale, size1: 0.03 * scale,
        color: hot ? C(1.6, 1.1, 0.5) : C(0.9, 0.95, 1.3), color1: hot ? C(1, 0.3, 0.05) : C(0.4, 0.3, 0.9), gravity: GRAVITY * 0.6, drag: 1.5,
      });
    }
  }

  chips(at: THREE.Vector3, normal: THREE.Vector3, n: number, size: number, color: THREE.Color): void {
    for (let i = 0; i < n; i++) {
      const vel = this.v.randomDirection().multiplyScalar(2).addScaledVector(normal, 3 + Math.random() * 3).add(this.w.set(0, 3, 0));
      this.debris.spawn(at, vel, size, color);
    }
  }

  explode(at: THREE.Vector3, size: number): void {
    const s = size * FX;
    this.glow.emit({ pos: at.clone(), life: 0.22, size: s * 3, size1: s * 4, color: C(2, 1.7, 1.2) });
    for (let i = 0; i < 16; i++) {
      const vel = this.v.randomDirection().multiplyScalar(s * (1 + Math.random() * 2)).add(this.w.set(0, s * 0.8, 0));
      this.glow.emit({ pos: at.clone(), vel: vel.clone(), life: 0.5 + Math.random() * 0.5, size: s * 0.9, size1: s * 1.6, color: C(1.8, 1.1, 0.4), color1: C(0.7, 0.12, 0.03), drag: 3 });
    }
    for (let i = 0; i < 26; i++) {
      const vel = this.v.randomDirection().multiplyScalar(s * (3 + Math.random() * 5)).add(this.w.set(0, s * 2, 0));
      this.glow.emit({ pos: at.clone(), vel: vel.clone(), life: 0.6 + Math.random() * 0.6, size: 0.18 * s, size1: 0.05 * s, color: C(1.8, 1.2, 0.5), color1: C(1, 0.2, 0.02), gravity: GRAVITY, drag: 0.6 });
    }
    for (let i = 0; i < 8; i++) {
      const vel = this.v.randomDirection().multiplyScalar(s * 0.6).add(this.w.set(0.3, s * 0.8, 0));
      this.smoke.emit({ pos: at.clone().add(this.w.randomDirection().multiplyScalar(s * 0.4)), vel: vel.clone(), life: 2 + Math.random() * 1.5, size: s * 0.8, size1: s * 3, color: C(0.12, 0.09, 0.1), color1: C(0.25, 0.2, 0.22), alpha: 0.7, drag: 0.8 });
    }
    for (let i = 0; i < 6; i++) {
      const vel = this.v.randomDirection().multiplyScalar(s * 2.5).add(this.w.set(0, s * 3, 0));
      this.debris.spawn(at, vel, 0.12 * s, C(0.35, 0.08, 0.05), 5);
    }
    const f = this.flashes.reduce((a, b) => (a.life < b.life ? a : b));
    f.light.position.copy(at);
    f.peak = 0.02 * size;
    f.life = 1;
    const dist = this.toWorld(at.clone()).distanceTo(this.eye) / SCALE;
    this.sfx.explosion(size, dist);
    this.onRumble(Math.min(1, s * 0.5), Math.min(1, s * 0.4), 140 + s * 40);
  }

  smokePuff(at: THREE.Vector3, size: number): void {
    for (let i = 0; i < 6; i++) {
      const vel = this.v.randomDirection().multiplyScalar(size * 0.4).add(this.w.set(0, size * 0.2, 0));
      this.smoke.emit({ pos: at.clone(), vel: vel.clone(), life: 1.5 + Math.random(), size: size * 0.4, size1: size * 1.2, color: C(0.4, 0.34, 0.33), alpha: 0.5, drag: 1.2 });
    }
  }

  blast(at: THREE.Vector3, radius: number, damage: number, from: Prop): void {
    const r = radius * BLAST;
    for (const p of this.props) {
      if (p === from || !p.alive) continue;
      const c = p.center(new THREE.Vector3());
      const d = Math.max(0, c.distanceTo(at) - p.radius * 0.5);
      if (d >= r) continue;
      p.damage(Math.ceil(damage * (1 - d / r)), c, c.clone().sub(at).normalize(), this);
    }
  }

  burn(): void { /* barrels don't burn */ }

  destroyed(): void { this.wrecked++; }

  // ---- Frame -------------------------------------------------------------

  private toScene(v: THREE.Vector3): THREE.Vector3 { return this.world.worldToLocal(v); }
  private toWorld(v: THREE.Vector3): THREE.Vector3 { return this.world.localToWorld(v); }

  update(dt: number, t: number, camera: THREE.Camera, viewportPx: number): void {
    // Stand on the room's floor.
    this.world.position.set(0, -this.layout.height / 2, 0);
    this.root.updateMatrixWorld();
    const P = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    const scale = (viewportPx * P) / 2 * SCALE;
    this.glow.setScale(scale);
    this.smoke.setScale(scale);
    for (const p of this.props) p.update(dt, t, this);
    this.updateBolts(dt);
    this.glow.update(dt, 0);
    this.smoke.update(dt, 0);
    this.debris.update(dt, 0, GRAVITY);
    for (const f of this.flashes) {
      f.life = Math.max(0, f.life - dt * 2.5);
      f.light.intensity = f.peak * f.life * f.life;
    }
    this.muzzle.intensity *= Math.exp(-dt * 30);
  }

  private updateBolts(dt: number): void {
    for (const b of this.bolts) {
      if (!b.active) { b.mesh.visible = b.glow.visible = false; continue; }
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      const pos = this.w.lerpVectors(b.from, b.to, k);
      const dir = this.v.subVectors(b.to, b.from).normalize();
      b.mesh.visible = b.glow.visible = true;
      b.mesh.position.copy(pos);
      b.mesh.lookAt(pos.clone().add(dir));
      b.mesh.scale.set(0.0025, 0.0025, 0.014);
      b.glow.position.copy(pos);
      b.glow.scale.setScalar(0.03);
      this.glow.emit({ pos: this.toScene(pos.clone()), life: 0.12, size: 0.35, size1: 0.08, color: C(0.5, 0.4, 1.4), color1: C(0.2, 0.1, 0.6) });
      if (k < 1) continue;
      b.active = false;
      b.mesh.visible = b.glow.visible = false;
      this.land(b);
    }
  }

  private land(b: Bolt): void {
    const at = this.toScene(b.to.clone());
    // The scene group only scales and shifts, so directions carry over as-is.
    const normal = b.normal.clone();
    this.glow.emit({ pos: at.clone(), life: 0.14, size: 1, size1: 1.6, color: C(1.1, 1.2, 2.4) });
    this.sparks(at, normal, 6, false);
    const dist = b.to.distanceTo(this.eye) / SCALE;
    if (b.prop?.alive && b.prop.object.visible) {
      b.prop.damage(1, at, this.v.subVectors(b.to, b.from).normalize().clone(), this);
      this.sfx.impact(true, dist);
    } else this.sfx.impact(false, dist);
  }

  /** Put the barrels back. */
  reset(): void {
    for (const p of this.props) p.reset();
    this.glow.clear(); this.smoke.clear(); this.debris.clear();
    for (const b of this.bolts) b.active = false;
    this.wrecked = 0;
  }
}

function visibleUp(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
