import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { boothLayout, buildBooth, type BoothBuild } from './booth';
import { TargetSet, type Target } from './targets';
import { Effects } from './effects';
import { Sfx } from './sound';

export interface GalleryHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  object: THREE.Object3D;
  target: Target | null;
}

export interface GalleryShot extends GalleryHit {
  scored: number;
}

/** The carnival shooting gallery: a fully lit 3D booth sized to the screen. */
export class CarnivalGallery {
  readonly root = new THREE.Group();
  readonly sfx = new Sfx();
  score = 0;
  shots = 0;
  hits = 0;

  private booth: BoothBuild | null = null;
  private targets: TargetSet | null = null;
  private fx = new Effects();
  private hittables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private env: THREE.Texture | null = null;
  private size = { W: 0, H: 0 };
  private torch = new THREE.SpotLight('#fff1d6', 0, 0, 0.1, 0.3, 2);
  private torchOn = false;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.root.name = 'carnival';
    this.torch.castShadow = true;
    this.torch.shadow.mapSize.set(1024, 1024);
    this.torch.shadow.camera.near = 0.02;
    this.torch.shadow.camera.far = 1.5;
    this.torch.shadow.normalBias = 0.0008;
    this.root.add(this.torch, this.torch.target, this.fx.group);
    this.raycaster.near = 0.02;
  }

  /** (Re)build for a screen of W × H metres. Cheap to call; skips if unchanged. */
  build(W: number, H: number): void {
    if (this.size.W === W && this.size.H === H) return;
    this.size = { W, H };
    if (!this.env) {
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    for (const old of [this.booth?.group, this.targets?.group]) {
      if (!old) continue;
      this.root.remove(old);
      old.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    }
    this.fx.clearMarks();
    const L = boothLayout(W, H);
    this.booth = buildBooth(L, this.env);
    this.targets = new TargetSet(L, this.env);
    this.root.add(this.booth.group, this.targets.group);
    this.hittables = [];
    for (const g of [this.booth.group, this.targets.group]) {
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.hittables.push(o); });
    }
  }

  update(dt: number, t: number): void {
    this.targets?.update(dt, t);
    this.fx.update(dt);
  }

  /** First thing the ray meets (targets and booth alike). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3): GalleryHit | null {
    this.root.updateMatrixWorld();
    this.raycaster.set(origin, dir);
    const hits = this.raycaster.intersectObjects(this.hittables, false);
    for (const h of hits) {
      if (!h.object.visible || !visibleUp(h.object)) continue;
      const target = (h.object.userData.target as Target | undefined) ?? null;
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate();
      if (normal.dot(dir) > 0) normal.negate();
      return { point: h.point, normal, object: h.object, target };
    }
    return null;
  }

  /** Fire along a ray. Returns what was hit, with the points scored. */
  shoot(origin: THREE.Vector3, dir: THREE.Vector3): GalleryShot | null {
    this.shots++;
    this.sfx.shot();
    const hit = this.raycast(origin, dir);
    if (!hit) return null;
    const t = hit.target;
    if (t && t.alive) {
      t.hit(dir);
      this.hits++;
      this.score += t.points;
      this.fx.burst(hit.point, hit.normal, true);
      this.fx.popup(hit.point.clone().addScaledVector(hit.normal, 0.004).add(new THREE.Vector3(0, 0.01, 0)), `+${t.points}`);
      this.fx.mark(hit.object, hit.point, hit.normal, 0.004);
      if (t.kind === 'bottle') this.sfx.clink(); else this.sfx.ding(t.points);
      return { ...hit, scored: t.points };
    }
    this.fx.burst(hit.point, hit.normal, false);
    this.fx.mark(hit.object, hit.point, hit.normal);
    this.sfx.thud();
    return { ...hit, scored: 0 };
  }

  resetScore(): void {
    this.score = 0; this.shots = 0; this.hits = 0;
    this.targets?.reset();
    this.fx.clearMarks();
  }

  /**
   * Flashlight demo inside the booth: dim the stall and light it with a
   * real spotlight from the hand. Pass null to turn it off.
   */
  setTorch(ray: { origin: THREE.Vector3; dir: THREE.Vector3 } | null, angleDeg = 10, softness = 0.3, ambient = 0.3): void {
    const on = !!ray;
    if (on !== this.torchOn && this.booth) {
      this.booth.lights.forEach((l, i) => { l.intensity = this.booth!.baseIntensity[i] * (on ? ambient * 0.35 : 1); });
      this.booth.bulbs.emissiveIntensity = on ? 0.4 : 2.2;
    }
    this.torchOn = on;
    this.torch.intensity = on ? 2.5 : 0;
    this.torch.visible = on;
    if (!ray) return;
    this.torch.position.copy(ray.origin);
    this.torch.target.position.copy(ray.origin).add(ray.dir);
    this.torch.angle = THREE.MathUtils.degToRad(Math.max(2, angleDeg) * 1.3);
    this.torch.penumbra = THREE.MathUtils.clamp(softness, 0.05, 1);
  }
}

function visibleUp(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
