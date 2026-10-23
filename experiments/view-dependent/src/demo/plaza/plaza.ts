import * as THREE from 'three';
import { buildEnvironment, type Environment } from './environment';
import { Debris, Particles } from './particles';
import {
  Barrel, Cover, Dropship, Drone, Prop, Sniper, Soldier, Turret, Walker, Wreck, buildHighway, type PlazaFx,
} from './props';
import { PlazaSfx } from './sound';
import { glowTexture } from './textures';

/**
 * Fallen Plaza: a wide, open sci-fi battlefield for the plasma machine gun.
 *
 * The world is modelled in scene metres and shrunk onto the screen at 1:20,
 * so a 34 cm laptop panel looks out over a street a few hundred metres long.
 * You look down from a rubble heap a few metres up: low cover right behind
 * the glass, the street and its wrecks in the middle, a highway, the city
 * and walkers far off. Moving your head peeks round the cover nearest you.
 */
export const PLAZA_SCALE = 0.05;
/** Height of the street below the screen's centre, metres on the desk. Low
 *  enough that a controller held under the screen is above the street. */
export const PLAZA_GROUND_Y = -0.22;

export interface PlazaSettings {
  sound: boolean;
  rumble: boolean;
  crosshair: boolean;
  /** Aim assist cone, degrees: shots this close to an enemy hit it. */
  assistDeg: number;
  bloom: boolean;
}

export const DEFAULT_PLAZA: PlazaSettings = { sound: true, rumble: true, crosshair: true, assistDeg: 3, bloom: true };

/** What the gun is pointing at right now. World space (metres on the desk). */
export interface PlazaAim {
  point: THREE.Vector3;
  /** The enemy the shot would hit, straight on or through aim assist. */
  lock: Prop | null;
  /** Where the lock is, for the reticle's brackets. */
  lockPoint: THREE.Vector3;
  /** Distance from the gun, metres on the desk. */
  distance: number;
  hit: boolean;
}

interface Bolt {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** What it will hit, and where on it (that object's own coordinates). */
  object: THREE.Object3D | null;
  local: THREE.Vector3;
  normal: THREE.Vector3;
  t: number;
  dur: number;
  active: boolean;
}

const FIRE_RATE = 12;
const HEAT_PER_SHOT = 0.022;
const COOL_RATE = 0.45;
const VENT_RATE = 0.7;
const BOLT_SPEED = 700; // scene m/s
const MAX_BOLTS = 48;
const GRAVITY = 18;

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export class SciFiPlaza implements PlazaFx {
  readonly root = new THREE.Group();
  /** Scene metres; everything below lives in here. */
  readonly world = new THREE.Group();
  readonly sfx = new PlazaSfx();
  readonly fog = new THREE.FogExp2('#4e2440', 0.012);
  settings: PlazaSettings = { ...DEFAULT_PLAZA };
  /** Main hooks this up to the controller's motors. */
  onRumble: (strong: number, weak: number, ms: number) => void = () => { /* none */ };

  kills = 0;
  wrecked = 0;
  shots = 0;
  hits = 0;
  heat = 0;
  overheated = false;
  /** Short message for the HUD ("DRONE DOWN"), with its age in seconds. */
  callout = { text: '', age: 99 };
  /** Time since the last kill, for the hit marker. */
  sinceKill = 99;
  sinceHit = 99;

  private env: Environment;
  private props: Prop[] = [];
  private hittables: THREE.Object3D[] = [];
  private glow = new Particles(7000, true);
  private smoke = new Particles(3000, false);
  private debris = new Debris(600);
  private bolts: Bolt[] = [];
  private flashes: { light: THREE.PointLight; life: number; peak: number }[] = [];
  private fireLights: THREE.PointLight[] = [];
  private muzzle = new THREE.PointLight('#9a8cff', 0, 0.9, 2);
  private raycaster = new THREE.Raycaster();
  private cooldown = 0;
  private sinceShot = 99;
  private eyeScene = new THREE.Vector3(0, 4.4, 12);
  private emberT = 0;
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();

  constructor() {
    this.root.name = 'plaza';
    this.world.scale.setScalar(PLAZA_SCALE);
    this.world.position.y = PLAZA_GROUND_Y;
    this.root.add(this.world);
    Prop.space = this.world;

    this.env = buildEnvironment();
    this.world.add(this.env.group);
    this.world.add(this.glow.points, this.smoke.points, this.debris.mesh);

    // Dusk: purple sky light, a warm low sun behind the city, cool fill from us.
    const hemi = new THREE.HemisphereLight('#7a5aa0', '#3a1c20', 0.9);
    const sun = new THREE.DirectionalLight('#ff9a60', 0.9);
    sun.position.set(150, 120, -800);
    const fill = new THREE.DirectionalLight('#7a8cff', 0.9);
    fill.position.set(-40, 60, 200);
    this.world.add(hemi, sun, sun.target, fill);
    this.root.add(this.muzzle);

    this.buildProps();
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight('#ffb070', 0, 2, 2);
      this.world.add(light);
      this.flashes.push({ light, life: 0, peak: 0 });
    }
    // A few fixed fire lights on the nearest blazes.
    for (const p of [new THREE.Vector3(-4, 2, -22), new THREE.Vector3(-12, 3, -44), new THREE.Vector3(-6, 2, -58)]) {
      const l = new THREE.PointLight('#ff7a30', 0.05, 1.6, 2);
      l.position.copy(p);
      this.world.add(l);
      this.fireLights.push(l);
    }
    const boltGeo = new THREE.SphereGeometry(1, 10, 6);
    const glowTex = glowTexture();
    for (let i = 0; i < MAX_BOLTS; i++) {
      const mesh = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: C(1.6, 1.3, 4), toneMapped: false }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#8a6cff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      mesh.visible = glow.visible = false;
      mesh.renderOrder = glow.renderOrder = 7;
      this.world.add(mesh, glow);
      this.bolts.push({ mesh, glow, from: new THREE.Vector3(), to: new THREE.Vector3(), object: null, local: new THREE.Vector3(), normal: new THREE.Vector3(), t: 0, dur: 0, active: false });
    }
    this.raycaster.far = 400;
  }

  private buildProps(): void {
    const P = (x: number, z: number, y = 0) => new THREE.Vector3(x, y, z);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const add = (...ps: Prop[]) => { for (const p of ps) { this.props.push(p); this.world.add(p.object); } };

    // Low cover right behind the glass, plus two broken columns. The left
    // column hides a squad (lean left to see them), the right one a turret
    // (lean right).
    add(
      new Cover(P(-9, -5), V(5, 1.5, 1.1), 0.2, 0, true),
      new Cover(P(-4.5, -7), V(2.4, 3.3, 1.6), 0.05, 0.02),
      new Cover(P(4.5, -8), V(2.4, 3.3, 1.4), -0.05, -0.02),
      new Cover(P(9, -5), V(3.4, 1.9, 2), -0.35, 0.1),
      new Cover(P(-1, -9), V(2.2, 1.2, 1.4), 0.6, 0.08),
      new Cover(P(1.8, -6), V(1.6, 1.1, 1.2), 1.1, -0.1),
    );
    let seed = 5;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 14; i++) {
      const x = (rnd() < 0.5 ? -1 : 1) * (1.5 + rnd() * 14);
      const s = 0.5 + rnd() * 0.8;
      add(new Cover(P(x, -14 - rnd() * 16), V(s * 1.3, s, s * 1.1), rnd() * 3, (rnd() - 0.5) * 0.4));
    }

    // Crouched behind the left column, 17 m past it.
    add(new Soldier(P(-9.6, -24), 0.4, 1, true), new Soldier(P(-8.6, -24.6), 0.2, 2, true), new Soldier(P(-7.6, -23.8), 0.5, 3, true));
    add(new Turret(P(9.6, -26), 0.75));
    add(new Dropship(P(-13, -44), 0.5));
    add(
      new Wreck(P(-4, -22), 0.4, true), new Wreck(P(7, -34), -0.8, false), new Wreck(P(-6, -58), 1.3, true),
      new Wreck(P(9, -85), 0.2, false), new Wreck(P(-8, -120), 2, true), new Wreck(P(3, -150), -0.5, false),
    );
    for (const [x, z] of [[3, -18], [3.9, -18.6], [3.3, -19.5], [-7.5, -36], [-6.8, -36.8], [6, -48], [6.8, -48.5], [6.3, -49.4], [-3, -75], [-2.2, -75.4], [10, -100], [10.8, -100.6]]) add(new Barrel(P(x, z)));
    const drones: [number, number, number, number, number, number][] = [
      [0, -45, 18, 10, 12, 0.35], [-10, -90, 25, 15, 22, -0.25], [15, -130, 30, 20, 30, 0.2],
      [0, -26, 8, 5, 8, 0.5], [30, -220, 40, 30, 45, -0.15], [-40, -300, 50, 40, 60, 0.12],
    ];
    drones.forEach(([cx, cz, rx, rz, y, speed], i) => add(new Drone({ cx, cz, rx, rz, y, speed }, i)));
    add(...buildHighway(-170, 10));
    add(new Soldier(P(-30, -170, 10.8), 0, 4), new Soldier(P(-34, -170.5, 10.8), 0.3, 5), new Sniper(P(40, -169, 10.8), -0.2));
    add(new Walker(-800, 14, 1.6, 1), new Walker(-1000, -10, 2, 2), new Walker(-660, 9, 1.3, 3));

    for (const p of this.props) p.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.hittables.push(o); });
    this.hittables.push(...this.env.solid);
  }

  // ---- Space helpers -------------------------------------------------------

  private toScene(v: THREE.Vector3): THREE.Vector3 { return this.world.worldToLocal(v); }
  private toWorld(v: THREE.Vector3): THREE.Vector3 { return this.world.localToWorld(v); }

  /** Where your eyes are, so sounds and effects can scale with distance. */
  setEye(eye: { x: number; y: number; z: number }): void {
    this.eyeScene.set(eye.x, eye.y, eye.z);
    this.toScene(this.eyeScene);
  }

  /** First solid thing along a world-space ray. */
  private cast(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Intersection | null {
    this.raycaster.set(origin, dir);
    for (const h of this.raycaster.intersectObjects(this.hittables, false)) {
      if (visibleUp(h.object)) return h;
    }
    return null;
  }

  /**
   * Where a shot along this ray goes. Straight hits win; otherwise the
   * nearest enemy inside the assist cone that the gun can see.
   */
  aimAt(origin: THREE.Vector3, dir: THREE.Vector3, out: PlazaAim): PlazaAim {
    this.root.updateMatrixWorld();
    const h = this.cast(origin, dir);
    out.hit = !!h;
    out.point.copy(h ? h.point : this.v.copy(origin).addScaledVector(dir, 60));
    out.distance = h ? h.distance : 60;
    out.lock = null;
    const direct = h ? (h.object.userData.prop as Prop | undefined) : undefined;
    if (direct?.alive && direct.enemy) {
      out.lock = direct;
      out.lockPoint.copy(h!.point);
      return out;
    }
    const cone = THREE.MathUtils.degToRad(this.settings.assistDeg);
    if (cone <= 0) return out;
    const cands: [number, Prop, THREE.Vector3][] = [];
    for (const p of this.props) {
      if (!p.alive || !p.enemy || !p.object.visible) continue;
      const c = this.toWorld(p.center(new THREE.Vector3()));
      const to = this.w.subVectors(c, origin);
      const along = to.dot(dir);
      if (along <= 0) continue;
      const off = Math.sqrt(Math.max(0, to.lengthSq() - along * along));
      // Measure from the target's edge, so big targets are easier still.
      const ang = Math.atan2(Math.max(0, off - p.radius * PLAZA_SCALE * 0.6), along);
      if (ang < cone) cands.push([ang, p, c]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [, p, c] of cands.slice(0, 3)) {
      const d = this.w.subVectors(c, origin).normalize();
      const sight = this.cast(origin, d);
      if (sight && sight.object.userData.prop === p) {
        out.lock = p;
        out.lockPoint.copy(sight.point);
        out.point.copy(sight.point);
        out.distance = sight.distance;
        out.hit = true;
        return out;
      }
    }
    return out;
  }

  /**
   * Hold to fire (full auto). Origin and direction are in world space: the
   * controller's USB port and where it points.
   */
  trigger(held: boolean, origin: THREE.Vector3, dir: THREE.Vector3, dt: number, aim: PlazaAim): void {
    this.cooldown -= dt;
    this.sinceShot += dt;
    if (!held || this.overheated || this.cooldown > 0) return;
    this.cooldown = 1 / FIRE_RATE;
    this.sinceShot = 0;
    this.shots++;
    this.heat = Math.min(1, this.heat + HEAT_PER_SHOT);
    if (this.heat >= 1) { this.overheated = true; this.sfx.vent(); this.say('OVERHEAT'); }

    const target = this.aimAt(origin, dir, aim);
    const from = this.toScene(this.v.copy(origin)).clone();
    const to = this.toScene(this.w.copy(target.point)).clone();
    const b = this.bolts.find((x) => !x.active) ?? this.bolts[0];
    b.active = true;
    b.from.copy(from);
    b.to.copy(to);
    b.t = 0;
    b.dur = Math.max(0.03, from.distanceTo(to) / BOLT_SPEED);
    b.object = null;
    if (target.hit) {
      const h = this.cast(origin, this.v.subVectors(target.point, origin).normalize());
      if (h) {
        b.object = h.object;
        b.local.copy(h.object.worldToLocal(h.point.clone()));
        b.normal.copy(h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : this.v.copy(dir).negate());
      }
    }
    this.sfx.shot(this.heat);
    this.onRumble(0.05, 0.35, 40);
    // Muzzle flash at the port.
    this.muzzle.position.copy(origin);
    this.muzzle.intensity = 0.25;
    this.glow.emit({ pos: from.clone(), life: 0.06, size: 1.2, size1: 2, color: C(0.8, 0.7, 2) });
  }

  private say(text: string): void { this.callout = { text, age: 0 }; }

  // ---- PlazaFx -----------------------------------------------------------

  /** Effects far away are scaled up so they still read. */
  private far(at: THREE.Vector3): number { return Math.max(1, at.distanceTo(this.eyeScene) / 35); }

  sparks(at: THREE.Vector3, normal: THREE.Vector3, n: number, hot: boolean, scale = 1): void {
    const k = scale * this.far(at);
    for (let i = 0; i < n; i++) {
      const vel = this.v.randomDirection().addScaledVector(normal, 1.4).normalize().multiplyScalar((4 + Math.random() * 8) * Math.sqrt(k));
      this.glow.emit({
        pos: at.clone(), vel: vel.clone(), life: 0.25 + Math.random() * 0.35, size: 0.12 * k, size1: 0.03 * k,
        color: hot ? C(1.6, 1.1, 0.5) : C(0.9, 0.95, 1.3), color1: hot ? C(1, 0.3, 0.05) : C(0.4, 0.3, 0.9), gravity: GRAVITY * 0.6, drag: 1.5,
      });
    }
  }

  chips(at: THREE.Vector3, normal: THREE.Vector3, n: number, size: number, color: THREE.Color): void {
    const k = this.far(at);
    for (let i = 0; i < n; i++) {
      const vel = this.v.randomDirection().multiplyScalar(3).addScaledVector(normal, 4 + Math.random() * 4).add(this.w.set(0, 3, 0));
      this.debris.spawn(at, vel.multiplyScalar(Math.sqrt(k)), size * k, color);
    }
    this.smoke.emit({ pos: at.clone(), vel: normal.clone().multiplyScalar(1.2), life: 1.2, size: 0.6 * k, size1: 2.4 * k, color: C(0.42, 0.36, 0.38), alpha: 0.5, drag: 1 });
  }

  explode(at: THREE.Vector3, size: number): void {
    const s = size;
    this.glow.emit({ pos: at.clone(), life: 0.22, size: s * 3, size1: s * 4, color: C(2, 1.7, 1.2) });
    for (let i = 0; i < 16; i++) {
      const vel = this.v.randomDirection().multiplyScalar(s * (1 + Math.random() * 2)).add(this.w.set(0, s * 0.8, 0));
      this.glow.emit({ pos: at.clone(), vel: vel.clone(), life: 0.5 + Math.random() * 0.5, size: s * 0.9, size1: s * 1.6, color: C(1.8, 1.1, 0.4), color1: C(0.7, 0.12, 0.03), drag: 3 });
    }
    for (let i = 0; i < 26; i++) {
      const vel = this.v.randomDirection().multiplyScalar(s * (3 + Math.random() * 5)).add(this.w.set(0, s * 2, 0));
      this.glow.emit({ pos: at.clone(), vel: vel.clone(), life: 0.6 + Math.random() * 0.6, size: 0.18 * s, size1: 0.05 * s, color: C(1.8, 1.2, 0.5), color1: C(1, 0.2, 0.02), gravity: GRAVITY, drag: 0.6 });
    }
    for (let i = 0; i < 10; i++) {
      const vel = this.v.randomDirection().multiplyScalar(s * 0.6).add(this.w.set(0.6, s * 0.6, 0));
      this.smoke.emit({ pos: at.clone().add(this.w.randomDirection().multiplyScalar(s * 0.4)), vel: vel.clone(), life: 2.5 + Math.random() * 1.5, size: s * 0.8, size1: s * 3, color: C(0.12, 0.09, 0.1), color1: C(0.25, 0.2, 0.22), alpha: 0.75, drag: 0.8 });
    }
    const chunks = Math.min(14, 3 + Math.round(s * 1.5));
    for (let i = 0; i < chunks; i++) {
      const vel = this.v.randomDirection().multiplyScalar(s * 2.5).add(this.w.set(0, s * 3, 0));
      this.debris.spawn(at, vel, 0.12 * s, C(0.12, 0.1, 0.1), 5);
    }
    const f = this.flashes.reduce((a, b) => (a.life < b.life ? a : b));
    f.light.position.copy(at);
    f.peak = 0.08 * s;
    f.life = 1;
    const dist = at.distanceTo(this.eyeScene);
    this.sfx.explosion(s, dist);
    this.onRumble(Math.min(1, s * 0.35 / (1 + dist * 0.02)), Math.min(1, s * 0.25 / (1 + dist * 0.01)), 120 + s * 30);
  }

  smokePuff(at: THREE.Vector3, size: number): void {
    for (let i = 0; i < 10; i++) {
      const vel = this.v.randomDirection().multiplyScalar(size * 0.5).add(this.w.set(0, size * 0.2, 0));
      this.smoke.emit({ pos: at.clone(), vel: vel.clone(), life: 2 + Math.random() * 1.5, size: size * 0.5, size1: size * 1.6, color: C(0.4, 0.34, 0.33), alpha: 0.6, drag: 1.2 });
    }
  }

  blast(at: THREE.Vector3, radius: number, damage: number, from: Prop): void {
    for (const p of this.props) {
      if (p === from || !p.alive) continue;
      const c = p.center(new THREE.Vector3());
      const d = Math.max(0, c.distanceTo(at) - p.radius * 0.5);
      if (d >= radius) continue;
      const dir = c.clone().sub(at).normalize();
      p.damage(Math.ceil(damage * (1 - d / radius)), c, dir, this);
    }
  }

  burn(at: THREE.Vector3, size: number, dt: number): void {
    // Big fires get bigger flames, not more of them.
    const n = dt * Math.min(size, 3) * 26;
    for (let i = 0; i < n || Math.random() < n - i; i++) {
      const pos = at.clone().add(this.v.set((Math.random() - 0.5) * size, Math.random() * size * 0.3, (Math.random() - 0.5) * size));
      this.glow.emit({ pos, vel: this.w.set((Math.random() - 0.5), 1.4 + Math.random(), (Math.random() - 0.5)).multiplyScalar(size).clone(), life: 0.45 + Math.random() * 0.4, size: size * 0.7, size1: size * 0.15, color: C(1.7, 1, 0.35), color1: C(0.9, 0.15, 0.03), drag: 1 });
    }
    if (Math.random() < dt * size * 5) {
      this.smoke.emit({ pos: at.clone().add(this.v.set(0, size, 0)), vel: new THREE.Vector3(0.6 * size, 1.6 * size, 0), life: 3 + Math.random() * 2, size: size * 0.8, size1: size * 3.2, color: C(0.1, 0.08, 0.09), color1: C(0.22, 0.17, 0.2), alpha: 0.55, drag: 0.4 });
    }
  }

  destroyed(prop: Prop): void {
    if (prop.enemy) {
      this.kills++;
      this.sinceKill = 0;
      this.sfx.kill();
      this.say(`${prop.kind === 'sniper' ? 'SNIPER' : prop.kind.toUpperCase()} DOWN`);
    } else {
      this.wrecked++;
      if (prop.kind === 'pillar') this.say('HIGHWAY DOWN');
    }
  }

  // ---- Frame ---------------------------------------------------------------

  update(dt: number, t: number, camera: THREE.Camera, viewportPx: number): void {
    this.root.updateMatrixWorld();
    // Pixels per scene metre at one metre from the eye.
    const P = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    const scale = (viewportPx * P) / 2 * PLAZA_SCALE;
    this.glow.setScale(scale);
    this.smoke.setScale(scale);

    for (const p of this.props) p.update(dt, t, this);
    for (const [pos, size] of this.env.fires) this.burn(pos, size, dt);
    // Embers drifting through the near air.
    this.emberT += dt;
    while (this.emberT > 0.05) {
      this.emberT -= 0.05;
      const pos = new THREE.Vector3((Math.random() - 0.5) * 60, Math.random() * 12, -5 - Math.random() * 60);
      this.glow.emit({ pos, vel: new THREE.Vector3(1.5 + Math.random(), 0.6 + Math.random() * 0.6, 0), life: 3, size: 0.08, color: C(1.6, 0.7, 0.2), color1: C(0.6, 0.1, 0) });
    }
    for (const g of this.env.glows) (g.material as THREE.SpriteMaterial).opacity = 0.45 + 0.1 * Math.sin(t * 3 + g.position.z);
    for (const [i, l] of this.fireLights.entries()) l.intensity = 0.05 + 0.02 * Math.sin(t * 13 + i * 2) + 0.015 * Math.sin(t * 29 + i);

    this.updateBolts(dt);
    this.glow.update(dt, 0.05);
    this.smoke.update(dt, 0.05);
    this.debris.update(dt, 0, GRAVITY);
    for (const f of this.flashes) {
      f.life = Math.max(0, f.life - dt * 2.5);
      f.light.intensity = f.peak * f.life * f.life;
    }
    this.muzzle.intensity *= Math.exp(-dt * 30);

    // Heat bleeds off when you ease off; venting runs it down to a third.
    if (this.overheated) {
      this.heat = Math.max(0, this.heat - VENT_RATE * dt);
      if (this.heat <= 0.3) this.overheated = false;
    } else if (this.sinceShot > 0.15) this.heat = Math.max(0, this.heat - COOL_RATE * dt);
    this.callout.age += dt;
    this.sinceKill += dt;
    this.sinceHit += dt;
  }

  private updateBolts(dt: number): void {
    for (const b of this.bolts) {
      if (!b.active) { b.mesh.visible = b.glow.visible = false; continue; }
      // Follow a moving target.
      if (b.object) b.to.copy(this.toScene(b.object.localToWorld(this.v.copy(b.local))));
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      const pos = this.w.lerpVectors(b.from, b.to, k);
      const dir = this.v.subVectors(b.to, b.from).normalize();
      const far = this.far(pos);
      b.mesh.visible = b.glow.visible = true;
      b.mesh.position.copy(pos);
      b.mesh.lookAt(pos.clone().add(dir));
      b.mesh.scale.set(0.14 * far, 0.14 * far, 1.6 * far);
      b.glow.position.copy(pos);
      b.glow.scale.setScalar(1.6 * far);
      this.glow.emit({ pos: pos.clone(), life: 0.12, size: 0.5 * far, size1: 0.1 * far, color: C(0.5, 0.4, 1.4), color1: C(0.2, 0.1, 0.6) });
      if (k < 1) continue;
      b.active = false;
      b.mesh.visible = b.glow.visible = false;
      this.land(b);
    }
  }

  private land(b: Bolt): void {
    const at = b.to.clone();
    // The scene group only scales and shifts, so directions carry over as-is.
    const normal = b.normal.clone();
    const far = this.far(at);
    // Plasma splash.
    this.glow.emit({ pos: at.clone(), life: 0.14, size: 1.4 * far, size1: 2.4 * far, color: C(1.1, 1.2, 2.4) });
    this.glow.emit({ pos: at.clone().addScaledVector(normal, 0.2), life: 0.3, size: 0.7 * far, size1: 0.2 * far, color: C(0.6, 0.4, 1.6) });
    if (!b.object) return;
    const prop = b.object.userData.prop as Prop | undefined;
    const dir = this.w.subVectors(b.to, b.from).normalize().clone();
    this.sparks(at, normal, 6, false);
    if (prop) {
      const wasAlive = prop.alive;
      prop.damage(1, at, dir, this);
      if (wasAlive) { this.hits++; this.sinceHit = 0; }
      this.sfx.impact(true, at.distanceTo(this.eyeScene));
    } else {
      this.chips(at, normal, 2, 0.15 * Math.min(4, far), C(0.35, 0.3, 0.3));
      this.sfx.impact(false, at.distanceTo(this.eyeScene));
    }
  }

  /** Put everything back: cover, barrels, enemies, the highway. */
  reset(): void {
    for (const p of this.props) p.reset();
    this.glow.clear(); this.smoke.clear(); this.debris.clear();
    for (const b of this.bolts) b.active = false;
    this.kills = 0; this.wrecked = 0; this.shots = 0; this.hits = 0;
    this.heat = 0; this.overheated = false;
    this.callout = { text: '', age: 99 };
  }

}

function visibleUp(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
