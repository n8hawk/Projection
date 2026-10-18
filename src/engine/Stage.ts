import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BoxDef, StageDef } from '../model/types';
import { boxMatrix, makeProjectorCamera } from './projector';

const PROJ_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Projective texturing: each fragment looks itself up in the projector's image,
// and the projector's depth map decides whether something blocks the light.
const PROJ_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
uniform sampler2D tProj;
uniform sampler2D tShadow;
uniform mat4 uProjVP;
uniform vec3 uProjPos;
uniform float uNear;
uniform float uFar;
uniform vec3 uBase;
uniform float uAmbient;
uniform float uLumens;
uniform vec3 uTint;
float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
void main() {
  vec3 col = uBase * uAmbient + uTint;
  vec4 pc = uProjVP * vec4(vWorld, 1.0);
  if (pc.w > 0.0) {
    vec3 ndc = pc.xyz / pc.w;
    if (abs(ndc.x) <= 1.0 && abs(ndc.y) <= 1.0 && ndc.z <= 1.0) {
      vec2 uv = ndc.xy * 0.5 + 0.5;
      float sceneD = linearDepth(texture2D(tShadow, uv).r);
      float fragD = linearDepth(ndc.z * 0.5 + 0.5);
      float lit = fragD - 0.03 <= sceneD ? 1.0 : 0.0;
      float facing = max(dot(normalize(vNormal), normalize(uProjPos - vWorld)), 0.0);
      col += texture2D(tProj, uv).rgb * uBase * lit * mix(0.35, 1.0, facing) * uLumens;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export type StageView = 'audience' | 'top' | 'projector';

/** The rehearsal room: walls, boxes and a virtual projector that throws the output onto them. */
export class Stage {
  readonly scene = new THREE.Scene();
  readonly projCam = new THREE.PerspectiveCamera();
  readonly audienceCam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
  readonly topCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  private shadowRT: THREE.WebGLRenderTarget;
  private uniformsShared: Record<string, THREE.IUniform>;
  private boxGroup = new THREE.Group();
  private boxMeshes = new Map<string, THREE.Mesh>();
  private projectorBody: THREE.Mesh;
  private frustum: THREE.LineSegments;
  private selection: THREE.LineSegments;
  private controls: OrbitControls | null = null;
  private lastStage = '';
  private depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });

  constructor(projTex: THREE.Texture) {
    this.shadowRT = new THREE.WebGLRenderTarget(1024, 576);
    this.shadowRT.depthTexture = new THREE.DepthTexture(1024, 576);
    this.shadowRT.depthTexture.type = THREE.UnsignedIntType;
    this.uniformsShared = {
      tProj: { value: projTex },
      tShadow: { value: this.shadowRT.depthTexture },
      uProjVP: { value: new THREE.Matrix4() },
      uProjPos: { value: new THREE.Vector3() },
      uNear: { value: 0.1 },
      uFar: { value: 60 },
      uAmbient: { value: 0.1 },
      uLumens: { value: 1 },
    };
    const room = this.surfaceMat(0.82);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), this.surfaceMat(0.55));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 1);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), room);
    wall.position.set(0, 3, -3);
    this.scene.add(floor, wall, this.boxGroup);

    const grid = new THREE.GridHelper(14, 28, 0x2d4e60, 0x1c3640);
    grid.position.set(0, 0.002, 1);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.userData.helper = true;
    this.scene.add(grid);

    this.projectorBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.3), new THREE.MeshBasicMaterial({ color: 0x313237 }));
    this.projectorBody.userData.helper = true;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), new THREE.MeshBasicMaterial({ color: 0x90ecff }));
    lens.position.z = -0.151;
    lens.rotation.y = Math.PI;
    this.projectorBody.add(lens);
    this.frustum = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x90ecff, transparent: true, opacity: 0.45 }));
    this.frustum.userData.helper = true;
    this.selection = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x90ecff }));
    this.selection.userData.helper = true;
    this.selection.visible = false;
    this.scene.add(this.projectorBody, this.frustum, this.selection);

    this.audienceCam.position.set(4.2, 3.2, 6.5);
    this.audienceCam.lookAt(0, 0.8, -1);
    this.topCam.position.set(0, 11, 2.2);
    this.topCam.lookAt(0, 0, 0.6);
  }

  private surfaceMat(gray: number, tint = new THREE.Color(0, 0, 0)): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: PROJ_VERT,
      fragmentShader: PROJ_FRAG,
      uniforms: { ...this.uniformsShared, uBase: { value: new THREE.Color(gray, gray, gray) }, uTint: { value: tint } },
    });
  }

  attachControls(el: HTMLElement): void {
    this.controls?.dispose();
    this.controls = new OrbitControls(this.audienceCam, el);
    this.controls.target.set(0, 0.8, -1);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();
  }

  detachControls(): void {
    this.controls?.dispose();
    this.controls = null;
  }

  setControlsEnabled(on: boolean): void {
    if (this.controls) this.controls.enabled = on;
  }

  sync(stage: StageDef, selectedBox: string | null): void {
    const key = JSON.stringify(stage);
    if (key !== this.lastStage) {
      this.lastStage = key;
      this.rebuild(stage);
    }
    const sel = selectedBox ? this.boxMeshes.get(selectedBox) : undefined;
    if (sel) {
      this.selection.geometry.dispose();
      this.selection.geometry = new THREE.EdgesGeometry((sel.geometry as THREE.BoxGeometry));
      this.selection.matrixAutoUpdate = false;
      this.selection.matrix.copy(sel.matrix);
      this.selection.matrixWorldNeedsUpdate = true;
      this.selection.visible = true;
    } else {
      this.selection.visible = false;
    }
  }

  private rebuild(stage: StageDef): void {
    makeProjectorCamera(stage.projector, this.projCam);
    this.uniformsShared.uProjVP.value.multiplyMatrices(this.projCam.projectionMatrix, this.projCam.matrixWorldInverse);
    this.uniformsShared.uProjPos.value.copy(this.projCam.position);
    this.uniformsShared.uNear.value = this.projCam.near;
    this.uniformsShared.uFar.value = this.projCam.far;
    this.uniformsShared.uAmbient.value = stage.ambient;
    this.uniformsShared.uLumens.value = stage.projector.brightness;

    this.projectorBody.position.copy(this.projCam.position);
    this.projectorBody.quaternion.copy(this.projCam.quaternion);

    // Frustum lines out to just past the aim point.
    const dist = this.projCam.position.distanceTo(new THREE.Vector3(...stage.projector.target)) + 3;
    const pts: THREE.Vector3[] = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
      const v = new THREE.Vector3(x, y, 0.5).unproject(this.projCam).sub(this.projCam.position).normalize();
      return this.projCam.position.clone().add(v.multiplyScalar(dist));
    });
    for (let i = 0; i < 4; i++) {
      pts.push(this.projCam.position, corners[i], corners[i], corners[(i + 1) % 4]);
    }
    this.frustum.geometry.dispose();
    this.frustum.geometry = new THREE.BufferGeometry().setFromPoints(pts);

    const seen = new Set<string>();
    for (const b of stage.boxes) {
      seen.add(b.id);
      let mesh = this.boxMeshes.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.surfaceMat(0.9));
        mesh.userData.boxId = b.id;
        this.boxMeshes.set(b.id, mesh);
        this.boxGroup.add(mesh);
      }
      this.placeBox(mesh, b);
    }
    for (const [id, mesh] of this.boxMeshes) {
      if (!seen.has(id)) {
        this.boxGroup.remove(mesh);
        mesh.geometry.dispose();
        this.boxMeshes.delete(id);
      }
    }
  }

  private placeBox(mesh: THREE.Mesh, b: BoxDef): void {
    mesh.geometry.dispose();
    const g = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
    g.translate(0, b.size[1] / 2, 0);
    mesh.geometry = g;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(boxMatrix(b));
    mesh.matrixWorldNeedsUpdate = true;
  }

  /** Renders the projector's depth map; call once per frame before any view. */
  updateShadow(renderer: THREE.WebGLRenderer): void {
    const helpers = this.scene.children.filter((c) => c.userData.helper);
    helpers.forEach((h) => (h.visible = false));
    const sel = this.selection.visible;
    this.scene.overrideMaterial = this.depthMat;
    renderer.setRenderTarget(this.shadowRT);
    renderer.render(this.scene, this.projCam);
    this.scene.overrideMaterial = null;
    renderer.setRenderTarget(null);
    helpers.forEach((h) => (h.visible = true));
    this.selection.visible = sel;
  }

  render(renderer: THREE.WebGLRenderer, view: StageView, aspect: number): void {
    this.controls?.update();
    const cam = view === 'projector' ? this.projCam : view === 'top' ? this.topCam : this.audienceCam;
    if (cam !== this.projCam) {
      (cam as THREE.PerspectiveCamera).aspect = aspect;
      (cam as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    this.projectorBody.visible = view !== 'projector';
    this.frustum.visible = view !== 'projector';
    renderer.setClearColor(0x0e100f, 1);
    renderer.clear();
    renderer.render(this.scene, cam);
    this.projectorBody.visible = true;
    this.frustum.visible = true;
  }

  /** Box under a point in the viewport (normalized device coordinates), or null. */
  pick(ndcX: number, ndcY: number, view: StageView): string | null {
    const cam = view === 'projector' ? this.projCam : view === 'top' ? this.topCam : this.audienceCam;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    const hit = ray.intersectObjects([...this.boxMeshes.values()], false)[0];
    return hit ? (hit.object.userData.boxId as string) : null;
  }

  /** Point on the floor under the cursor, for dragging boxes. */
  floorPoint(ndcX: number, ndcY: number, view: StageView): THREE.Vector3 | null {
    const cam = view === 'projector' ? this.projCam : view === 'top' ? this.topCam : this.audienceCam;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
  }
}
