import * as THREE from 'three';
import { concreteTexture, glowTexture, hazardTexture, rng } from './textures';

/**
 * Everything in the plaza that reacts to being shot: cover that crumbles,
 * barrels that blow (and set each other off), burning wrecks, drones, the
 * hidden squad and turret, far walkers, and the highway, whose spans fall
 * when you take out a pillar. Scene metres, as in environment.ts.
 */
export type PropKind = 'cover' | 'barrel' | 'wreck' | 'dropship' | 'drone' | 'soldier' | 'turret' | 'sniper' | 'walker' | 'pillar' | 'span';

/** What props can ask the plaza to do. */
export interface PlazaFx {
  sparks(at: THREE.Vector3, normal: THREE.Vector3, n: number, hot: boolean, scale?: number): void;
  chips(at: THREE.Vector3, normal: THREE.Vector3, n: number, size: number, color: THREE.Color): void;
  explode(at: THREE.Vector3, size: number): void;
  smokePuff(at: THREE.Vector3, size: number): void;
  /** Damage everything within `radius`, falling off with distance. */
  blast(at: THREE.Vector3, radius: number, damage: number, from: Prop): void;
  burn(at: THREE.Vector3, size: number, dt: number): void;
  destroyed(prop: Prop): void;
}

export abstract class Prop {
  abstract kind: PropKind;
  readonly object = new THREE.Group();
  hp: number;
  alive = true;
  /** Aim assist pulls shots onto enemies near the crosshair. */
  enemy = false;
  /** Rough size, for aim assist and blasts. */
  radius = 1;
  /** Seconds until a destroyed prop comes back (Infinity: only on reset). */
  respawn = Infinity;
  protected deadFor = 0;
  protected tmp = new THREE.Vector3();

  constructor(public maxHp: number) { this.hp = maxHp; }

  /** The plaza's scene group; props live in its (scene metre) coordinates. */
  static space: THREE.Object3D | null = null;
  /** This prop's own scene group, when it isn't in the plaza (the blaster room). */
  space: THREE.Object3D | null = null;
  /** Where the middle of the prop is, in its own coordinates. */
  protected centerOffset = new THREE.Vector3();

  /** Centre in scene coordinates. */
  center(out: THREE.Vector3): THREE.Vector3 {
    this.object.updateWorldMatrix(true, false);
    this.object.localToWorld(out.copy(this.centerOffset));
    const space = this.space ?? Prop.space;
    return space ? space.worldToLocal(out) : out;
  }

  /** Register meshes as this prop's hit boxes. */
  protected tag(): void {
    this.object.traverse((o) => {
      o.userData.prop = this;
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
  }

  damage(n: number, at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void {
    if (!this.alive) return;
    this.hp -= n;
    this.onHit(at, dir, fx);
    if (this.hp <= 0) {
      this.alive = false;
      this.deadFor = 0;
      this.onDestroy(at, dir, fx);
      fx.destroyed(this);
    }
  }

  protected onHit(_at: THREE.Vector3, _dir: THREE.Vector3, _fx: PlazaFx): void { /* optional */ }
  protected abstract onDestroy(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void;

  update(dt: number, t: number, fx: PlazaFx): void {
    if (!this.alive) {
      this.deadFor += dt;
      if (this.deadFor > this.respawn) this.reset();
    }
    this.tick(dt, t, fx);
  }

  protected tick(_dt: number, _t: number, _fx: PlazaFx): void { /* optional */ }

  reset(): void { this.hp = this.maxHp; this.alive = true; this.deadFor = 0; this.object.visible = true; }
}

const glowTex = glowTexture();
const concrete = concreteTexture();
const glowSprite = (color: string, size: number, opacity = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.setScalar(size);
  return s;
};
const lit = (color: string, r = 0.85, m = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, flatShading: true });
const glowMat = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });

const CONCRETE = new THREE.Color('#6b6064');

// ---- Cover: chunks of rubble and concrete you crouch behind ----------------

export class Cover extends Prop {
  kind: PropKind = 'cover';
  private mesh: THREE.Mesh;
  private size: THREE.Vector3;
  private baseScale = new THREE.Vector3();

  constructor(at: THREE.Vector3, size: THREE.Vector3, rotY: number, tilt: number, hazard = false) {
    super(Math.max(3, Math.round(size.x * size.y * size.z * 1.6)));
    const mat = new THREE.MeshStandardMaterial({ color: '#8a7c80', map: concrete, roughness: 0.95, flatShading: true });
    const geo = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
    // Knock the corners about so it reads as broken concrete, not a box.
    const p = geo.attributes.position as THREE.BufferAttribute;
    const rr = rng(Math.round(at.x * 100 + at.z * 7) + 99);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.88 + rr() * 0.24), p.getY(i) * (0.92 + rr() * 0.12), p.getZ(i) * (0.88 + rr() * 0.24));
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, hazard ? [mat, mat, mat, mat, new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.8 }), mat] : mat);
    this.size = size.clone();
    this.mesh.scale.copy(size);
    this.baseScale.copy(size);
    this.object.add(this.mesh);
    this.object.position.copy(at).setY(at.y + size.y / 2);
    this.object.rotation.set(0, rotY, tilt);
    this.radius = size.length() / 2;
    this.tag();
  }

  protected onHit(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void {
    fx.chips(at, dir.clone().negate(), 3, 0.12 * Math.min(2, this.size.y), CONCRETE);
    // Wear down visibly as it takes damage.
    const k = 0.55 + 0.45 * (this.hp / this.maxHp);
    this.mesh.scale.set(this.baseScale.x, this.baseScale.y * k, this.baseScale.z);
    this.mesh.position.y = -this.baseScale.y * (1 - k) / 2;
  }

  protected onDestroy(_at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void {
    const c = this.center(this.tmp);
    fx.chips(c, dir.clone().negate().setY(1), 14, 0.25 * Math.min(2, this.size.y), CONCRETE);
    fx.smokePuff(c, this.radius * 1.6);
    this.object.visible = false;
  }

  reset(): void { super.reset(); this.mesh.scale.copy(this.baseScale); this.mesh.position.y = 0; }
}

// ---- Explosive barrel ------------------------------------------------------

export class Barrel extends Prop {
  kind: PropKind = 'barrel';
  private fuse = -1;

  constructor(at: THREE.Vector3) {
    super(2);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 14), new THREE.MeshStandardMaterial({ color: '#b02618', roughness: 0.55, metalness: 0.35 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.22, 14), new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6 }));
    band.position.y = 0.15;
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.42, 14), glowMat(2.2, 0.5, 0.15));
    cap.rotation.x = -Math.PI / 2; cap.position.y = 0.61;
    this.object.add(body, band, cap);
    this.object.position.copy(at).setY(0.6);
    this.radius = 0.8;
    this.respawn = 25;
    this.tag();
  }

  /** Set off by a nearby blast: goes up a moment later, so chains ripple. */
  protected onDestroy(): void { this.fuse = 0.12 + Math.random() * 0.15; }

  protected tick(dt: number, _t: number, fx: PlazaFx): void {
    if (this.fuse < 0) return;
    this.fuse -= dt;
    if (this.fuse > 0) return;
    this.fuse = -1;
    const c = this.center(this.tmp).clone();
    this.object.visible = false;
    fx.explode(c, 4);
    fx.blast(c, 9, 6, this);
  }
}

// ---- Burning wreck (a car, flips when it blows) -----------------------------

export class Wreck extends Prop {
  kind: PropKind = 'wreck';
  private vel = new THREE.Vector3();
  private spin = new THREE.Vector3();
  private home = new THREE.Vector3();
  private homeRot = new THREE.Euler();
  private flying = false;

  constructor(at: THREE.Vector3, rotY: number, private burning: boolean) {
    super(10);
    const paint = lit('#2c2a30', 0.7, 0.4);
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 1.9), paint);
    body.position.y = 0.75;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 1.7), paint);
    cab.position.set(-0.2, 1.45, 0);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.4, 1.72), lit('#100c12', 0.2, 0.8));
    glass.position.set(-0.2, 1.5, 0);
    this.object.add(body, cab, glass);
    for (const [x, z] of [[-1.4, 0.95], [1.4, 0.95], [-1.4, -0.95], [1.4, -0.95]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10), lit('#0c0a0c'));
      w.rotation.x = Math.PI / 2; w.position.set(x, 0.38, z);
      this.object.add(w);
    }
    this.object.position.copy(at);
    this.object.rotation.y = rotY;
    this.home.copy(at);
    this.homeRot.copy(this.object.rotation);
    this.radius = 2.4;
    this.tag();
  }

  protected onHit(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void {
    fx.sparks(at, dir.clone().negate(), 8, true);
  }

  protected onDestroy(_at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void {
    const c = this.center(this.tmp).clone().setY(1);
    fx.explode(c, 5);
    fx.blast(c, 8, 4, this);
    this.flying = true;
    this.burning = true;
    this.vel.set(dir.x * 3 + (Math.random() - 0.5) * 3, 9 + Math.random() * 4, dir.z * 3);
    this.spin.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 5);
  }

  protected tick(dt: number, _t: number, fx: PlazaFx): void {
    if (this.flying) {
      this.vel.y -= 20 * dt;
      this.object.position.addScaledVector(this.vel, dt);
      this.object.rotation.x += this.spin.x * dt;
      this.object.rotation.z += this.spin.z * dt;
      if (this.object.position.y < 0 && this.vel.y < 0) {
        this.object.position.y = 0;
        this.flying = false;
        // Land on its roof or side.
        this.object.rotation.x = Math.round(this.object.rotation.x / (Math.PI / 2)) * (Math.PI / 2);
        this.object.rotation.z = Math.round(this.object.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
        fx.smokePuff(this.object.position.clone().setY(0.5), 4);
      }
    }
    if (this.burning) fx.burn(this.center(this.tmp).setY(this.object.position.y + 1.4), 1.6, dt);
  }

  reset(): void {
    super.reset();
    this.flying = false;
    this.object.position.copy(this.home);
    this.object.rotation.copy(this.homeRot);
  }
}

// ---- The crashed dropship (mid cover; takes a beating, then goes up) --------

export class Dropship extends Prop {
  kind: PropKind = 'dropship';
  constructor(at: THREE.Vector3, rotY: number) {
    super(40);
    const hull = lit('#4a4252', 0.55, 0.6);
    const dark = lit('#221c28', 0.7, 0.4);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 16, 8, 1), hull);
    body.rotation.z = Math.PI / 2; body.scale.set(1, 1, 0.6);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.4, 5, 8), hull);
    nose.rotation.z = -Math.PI / 2; nose.position.x = 10.4; nose.scale.set(1, 1, 0.6);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 14), dark);
    wing.position.set(-2, 0.6, 0); wing.rotation.x = 0.25;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.4), dark);
    fin.position.set(-7, 3, 0); fin.rotation.z = -0.4;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(12, 0.15, 0.15), glowMat(0.4, 1.6, 2.2));
    strip.position.set(1, -0.4, 1.95);
    this.object.add(body, nose, wing, fin, strip);
    // Nose dug in, tail up.
    this.object.position.copy(at).setY(2);
    this.object.rotation.set(0.1, rotY, -0.16);
    this.radius = 8;
    this.tag();
  }

  protected onHit(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void { fx.sparks(at, dir.clone().negate(), 10, true); }

  protected onDestroy(_at: THREE.Vector3, _dir: THREE.Vector3, fx: PlazaFx): void {
    const c = this.center(this.tmp).clone();
    fx.explode(c, 10);
    fx.explode(c.clone().add(new THREE.Vector3(5, 1, 0)), 7);
    fx.blast(c, 14, 8, this);
    this.object.visible = false;
  }

  protected tick(dt: number, _t: number, fx: PlazaFx): void {
    if (this.alive) fx.burn(this.center(this.tmp).add(new THREE.Vector3(-3, 2.2, 0)), 2.6, dt);
  }
}

// ---- Drone: patrols, bobs, spins down in flames when shot ------------------

export class Drone extends Prop {
  kind: PropKind = 'drone';
  enemy = true;
  private falling = false;
  private vel = new THREE.Vector3();
  private phase: number;
  private eye: THREE.Sprite;
  private beam: THREE.Mesh;

  constructor(private path: { cx: number; cz: number; rx: number; rz: number; y: number; speed: number }, seed: number) {
    super(2);
    this.phase = seed * 1.7;
    const shell = lit('#1c1a24', 0.4, 0.8);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), shell);
    body.scale.set(1.3, 0.45, 1.3);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), shell);
    dome.position.y = 0.25;
    this.object.add(body, dome);
    for (const s of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.18, 12), shell);
      pod.position.set(s * 1.6, 0, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.18), shell);
      arm.position.set(s * 0.9, 0, 0);
      this.object.add(pod, arm);
    }
    const red = seed % 2 === 0;
    this.eye = glowSprite(red ? '#ff3a2a' : '#4ad8ff', 1.6);
    this.eye.position.set(0, -0.15, 0.95);
    const eyeCore = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), red ? glowMat(3, 0.4, 0.3) : glowMat(0.5, 2.2, 3));
    eyeCore.position.set(0, -0.12, 0.95);
    this.beam = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, 9, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: red ? '#ff4a3a' : '#4ad8ff', transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.position.y = -4.6;
    this.beam.raycast = () => { /* searchlight isn't solid */ };
    this.object.add(eyeCore, this.eye, this.beam);
    this.radius = 2.2;
    this.respawn = 6;
    this.tag();
    this.place(0);
  }

  private place(t: number): void {
    const p = this.path, a = t * p.speed + this.phase;
    this.object.position.set(p.cx + Math.cos(a) * p.rx, p.y + Math.sin(t * 1.3 + this.phase) * 0.8, p.cz + Math.sin(a) * p.rz);
    // Face along the path, leaning into the turn.
    this.object.rotation.set(0, -a + (p.speed > 0 ? 0 : Math.PI), Math.sin(a * 2) * 0.15);
  }

  protected onHit(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void { fx.sparks(at, dir.clone().negate(), 14, true, 1.4); }

  protected onDestroy(_at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void {
    this.falling = true;
    this.vel.copy(dir).multiplyScalar(6).setY(2);
    fx.explode(this.center(this.tmp).clone(), 1.6);
    this.beam.visible = false;
    this.eye.visible = false;
  }

  protected tick(dt: number, t: number, fx: PlazaFx): void {
    if (this.alive) { this.place(t); return; }
    if (!this.falling) { this.object.visible = false; return; }
    this.vel.y -= 14 * dt;
    this.object.position.addScaledVector(this.vel, dt);
    this.object.rotation.y += 9 * dt;
    this.object.rotation.z += 3 * dt;
    fx.burn(this.object.position, 0.7, dt);
    if (this.object.position.y < 0.5) {
      this.falling = false;
      const c = this.object.position.clone().setY(0.6);
      fx.explode(c, 3);
      fx.blast(c, 5, 3, this);
      this.object.visible = false;
    }
  }

  reset(): void { super.reset(); this.falling = false; this.beam.visible = true; this.eye.visible = true; }
}

// ---- Alien trooper -------------------------------------------------------

export class Soldier extends Prop {
  kind: PropKind = 'soldier';
  enemy = true;
  private fall = 0;
  private home = new THREE.Vector3();
  private body = new THREE.Group();

  constructor(at: THREE.Vector3, faceY: number, private seed: number, crouch = false) {
    super(1);
    const armor = lit('#2a2630', 0.6, 0.5);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), armor);
    torso.position.y = 1.25;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.32), armor);
    legs.position.y = 0.45;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), armor);
    head.position.y = 1.85; head.scale.set(1, 1.15, 1.1);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), glowMat(0.6, 3, 1));
    visor.position.set(0, 1.88, 0.22);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.9), lit('#141218', 0.5, 0.7));
    gun.position.set(0.32, 1.2, 0.35);
    this.body.add(torso, legs, head, visor, gun);
    if (crouch) { this.body.scale.y = 0.7; this.centerOffset.set(0, 0.85, 0); }
    this.object.add(this.body);
    this.object.position.copy(at);
    this.object.rotation.y = faceY;
    this.home.copy(at);
    if (!crouch) this.centerOffset.set(0, 1.2, 0);
    this.radius = 1.1;
    this.respawn = 9;
    this.tag();
  }


  protected onDestroy(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void {
    fx.sparks(at, dir.clone().negate(), 16, false, 1);
    this.fall = 0.0001;
  }

  protected tick(dt: number, t: number): void {
    if (this.alive) {
      // Idle: shifting weight, scanning.
      this.body.rotation.y = Math.sin(t * 0.7 + this.seed) * 0.35;
      this.body.position.y = Math.sin(t * 2 + this.seed) * 0.02;
      return;
    }
    if (this.fall > 0 && this.fall < 1) {
      this.fall = Math.min(1, this.fall + dt * 2.4);
      this.body.rotation.x = -this.fall * this.fall * Math.PI / 2;
    }
  }

  reset(): void { super.reset(); this.fall = 0; this.body.rotation.set(0, 0, 0); this.object.position.copy(this.home); }
}

// ---- Turret tucked behind the broken wall ----------------------------------

export class Turret extends Prop {
  kind: PropKind = 'turret';
  enemy = true;
  private head = new THREE.Group();
  constructor(at: THREE.Vector3, size = 1) {
    super(6);
    const dark = lit('#1e1b26', 0.5, 0.7);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 1.4, 8), dark);
    base.position.y = 0.7;
    const housing = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), dark);
    housing.scale.set(1.1, 0.7, 1.1);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.6, 8), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.z = 1.6;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), glowMat(1.6, 3, 0.6));
    eye.position.set(0, 0.2, 0.95);
    this.head.add(housing, barrel, eye, glowSprite('#b4ff6a', 2.4, 0.8).translateZ(1).translateY(0.2));
    this.head.position.y = 1.8;
    this.object.add(base, this.head);
    this.object.position.copy(at);
    this.object.scale.setScalar(size);
    this.centerOffset.set(0, 1.6, 0);
    this.radius = 1.8 * size;
    this.respawn = 20;
    this.tag();
  }
  protected onHit(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void { fx.sparks(at, dir.clone().negate(), 12, true); }
  protected onDestroy(_at: THREE.Vector3, _dir: THREE.Vector3, fx: PlazaFx): void {
    const c = this.center(this.tmp).clone().setY(1.6);
    fx.explode(c, 3.5);
    fx.blast(c, 5, 2, this);
    this.object.visible = false;
  }
  protected tick(_dt: number, t: number): void { this.head.rotation.y = Math.sin(t * 0.5) * 0.6 - 0.3; }
}

// ---- Sniper on a rooftop, given away by a scope glint -----------------------

export class Sniper extends Soldier {
  kind: PropKind = 'sniper';
  private glint: THREE.Sprite;
  constructor(at: THREE.Vector3, faceY: number) {
    super(at, faceY, 3);
    this.glint = glowSprite('#cfefff', 3.2);
    this.glint.position.set(0.32, 1.25, 0.9);
    this.object.add(this.glint);
    this.respawn = 14;
  }
  protected tick(dt: number, t: number): void {
    super.tick(dt, t);
    // Catches the light now and then.
    const g = Math.max(0, Math.sin(t * 1.1)) ** 8;
    this.glint.visible = this.alive;
    this.glint.scale.setScalar(1 + g * 5);
  }
}

// ---- Walker: a tripod war machine striding across the far districts --------

export class Walker extends Prop {
  kind: PropKind = 'walker';
  enemy = true;
  private legs: THREE.Group[] = [];
  private body = new THREE.Group();
  private collapse = 0;
  private x0: number;

  constructor(private z: number, private speed: number, private scale: number, seed: number) {
    super(18);
    this.x0 = (seed % 2 ? -1 : 1) * 500;
    const hull = lit('#2a1e30', 0.6, 0.5);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), hull);
    shell.scale.set(9, 4, 7);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 12), hull);
    gun.position.set(4, -1, 6);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), glowMat(4, 0.35, 0.25));
    eye.position.set(0, 0.5, 6.6);
    this.body.add(shell, gun, eye, glowSprite('#ff3a2a', 14).translateZ(6.8).translateY(0.5));
    this.body.position.y = 30;
    this.object.add(this.body);
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 18, 6), hull);
      upper.position.y = -9;
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 20, 6), hull);
      lower.position.y = -28;
      leg.add(upper, lower);
      leg.position.y = 30;
      leg.rotation.y = (i / 3) * Math.PI * 2;
      this.legs.push(leg);
      this.object.add(leg);
    }
    this.object.scale.setScalar(scale);
    this.centerOffset.set(0, 30, 0);
    this.radius = 14 * scale;
    this.respawn = 30;
    this.tag();
  }


  protected onHit(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void { fx.sparks(at, dir.clone().negate(), 10, true, 4); }

  protected onDestroy(_at: THREE.Vector3, _dir: THREE.Vector3, fx: PlazaFx): void {
    fx.explode(this.center(this.tmp).clone(), 26 * this.scale);
    this.collapse = 0.0001;
  }

  protected tick(dt: number, t: number, fx: PlazaFx): void {
    if (this.collapse > 0) {
      this.collapse = Math.min(1, this.collapse + dt * 0.5);
      const k = this.collapse;
      this.body.position.y = 30 * (1 - k * k) + 3 * k * k;
      this.body.rotation.z = k * 0.6;
      for (const leg of this.legs) { leg.position.y = this.body.position.y; leg.rotation.x = k * 1.1; }
      if (k >= 1) { this.object.visible = false; fx.explode(this.center(this.tmp).clone(), 20 * this.scale); this.collapse = 0; }
      else if (Math.random() < dt * 4) fx.explode(this.center(this.tmp).clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, 0, 0).multiplyScalar(this.scale)), 8 * this.scale);
      return;
    }
    if (!this.alive) return;
    // Stride across, wrapping around far off to either side.
    const span = 1000;
    const x = ((this.x0 + t * this.speed) % span + span * 1.5) % span - span / 2;
    this.object.position.set(x, 0, this.z);
    this.object.rotation.y = this.speed > 0 ? Math.PI / 2 : -Math.PI / 2;
    const step = t * Math.abs(this.speed) * 0.12;
    this.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(step + i * 2.1) * 0.35 + 0.25; });
    this.body.position.y = 30 + Math.sin(step * 2) * 0.8;
  }

  reset(): void {
    super.reset();
    this.collapse = 0;
    this.body.rotation.set(0, 0, 0);
    for (const leg of this.legs) leg.rotation.x = 0;
  }
}

// ---- Highway: pillars hold up deck spans; lose a pillar, lose the spans ----

export class Span extends Prop {
  kind: PropKind = 'span';
  supports: Pillar[] = [];
  private fall = 0;
  private pivotSide = 1;
  private deck: THREE.Mesh;

  constructor(x0: number, x1: number, z: number, y: number) {
    super(Infinity);
    const len = x1 - x0;
    this.deck = new THREE.Mesh(new THREE.BoxGeometry(len, 1.6, 14), new THREE.MeshStandardMaterial({ color: '#4a3c44', map: concrete, roughness: 0.9 }));
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 1, 0.3), lit('#3a3036'));
    rail.position.set(0, 1.3, 6.8);
    const rail2 = rail.clone(); rail2.position.z = -6.8;
    const lights = new THREE.Mesh(new THREE.BoxGeometry(len * 0.98, 0.12, 0.12), glowMat(2.4, 1.5, 0.8));
    lights.position.set(0, -0.85, 6.9);
    this.object.add(this.deck, rail, rail2, lights);
    this.object.position.set((x0 + x1) / 2, y, z);
    this.radius = len / 2;
    this.tag();
  }

  protected onHit(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void { fx.chips(at, dir.clone().negate(), 3, 0.6, CONCRETE); }
  protected onDestroy(): void { /* spans fall when their pillars go */ }

  /** A pillar under one end gave way. */
  drop(side: number): void {
    if (this.fall > 0) return;
    this.alive = false;
    this.fall = 0.0001;
    this.pivotSide = side;
  }

  protected tick(dt: number, _t: number, fx: PlazaFx): void {
    if (this.fall <= 0 || this.fall >= 1) return;
    this.fall = Math.min(1, this.fall + dt * 0.7);
    const k = this.fall * this.fall;
    const h = this.object.userData.y0 as number;
    this.object.position.y = h - (h - 1) * k;
    this.object.rotation.z = this.pivotSide * k * 0.35;
    if (this.fall >= 1) {
      const c = this.center(this.tmp).clone();
      fx.smokePuff(c, 22);
      fx.chips(c.setY(2), new THREE.Vector3(0, 1, 0.3), 20, 2.2, CONCRETE);
    }
  }

  reset(): void {
    super.reset();
    this.fall = 0;
    this.object.position.y = this.object.userData.y0;
    this.object.rotation.set(0, 0, this.object.userData.rz0 ?? 0);
    if (this.object.userData.down) this.alive = false;
  }
}

export class Pillar extends Prop {
  kind: PropKind = 'pillar';
  spans: Span[] = [];
  constructor(x: number, z: number, h: number) {
    super(14);
    const col = new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), new THREE.MeshStandardMaterial({ color: '#4a3c44', map: concrete, roughness: 0.95 }));
    col.position.y = h / 2;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(6, 1.4, 12), col.material);
    cap.position.y = h - 0.7;
    this.object.add(col, cap);
    this.object.position.set(x, 0, z);
    this.centerOffset.set(0, 5, 0);
    this.radius = 3;
    this.tag();
  }
  protected onHit(at: THREE.Vector3, dir: THREE.Vector3, fx: PlazaFx): void { fx.chips(at, dir.clone().negate(), 4, 0.6, CONCRETE); }
  protected onDestroy(at: THREE.Vector3, _dir: THREE.Vector3, fx: PlazaFx): void {
    fx.explode(at, 6);
    fx.smokePuff(this.center(this.tmp).clone(), 14);
    this.object.visible = false;
    for (const s of this.spans) s.drop(Math.sign(this.object.position.x - s.object.position.x) || 1);
  }
  reset(): void { super.reset(); }
}

/** A highway across the street at depth `z`, deck at height `y`, with one
 *  span already collapsed over the middle of the street. */
export function buildHighway(z: number, y: number): Prop[] {
  const props: Prop[] = [];
  const xs: number[] = [];
  for (let x = -420; x <= 420; x += 42) xs.push(x);
  const pillars = xs.map((x) => new Pillar(x, z, y - 0.8));
  props.push(...pillars);
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const s = new Span(x0, x1, z, y);
    s.object.userData.y0 = y;
    s.supports = [pillars[i], pillars[i + 1]];
    pillars[i].spans.push(s); pillars[i + 1].spans.push(s);
    // The span over the street is already down.
    if (x0 <= 0 && x1 > 0) {
      s.object.position.y = y * 0.45;
      s.object.userData.y0 = y * 0.45;
      s.object.rotation.z = 0.32;
      s.object.userData.rz0 = 0.32;
      s.object.userData.down = true;
      s.alive = false;
    }
    props.push(s);
  }
  return props;
}
