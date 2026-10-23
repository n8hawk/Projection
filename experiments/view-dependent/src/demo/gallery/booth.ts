import * as THREE from 'three';
import {
  backdropTexture, barrelTexture, counterTexture, crateTexture, stripeTexture, valanceTexture, woodTexture,
} from './textures';

/**
 * The static stall: counter, candy-striped posts, scalloped valance with
 * string bulbs, striped awning ceiling, wallpapered sides, conveyor planks,
 * barrels, crates, a bottle shelf and the painted backdrop, plus its lights.
 *
 * Screen space, metres: the glass is z = 0 and its opening is W × H, so the
 * counter and valance sit right at the glass and frame the view.
 */
export interface BoothLayout {
  W: number;
  H: number;
  /** Booth depth behind the glass. */
  D: number;
  /** Key heights and depths the targets are placed against. */
  floorY: number;
  counterTop: number;
  valanceBottom: number;
  rowA: { z: number; top: number };
  rowB: { z: number; top: number };
  shelf: { z: number; top: number; xs: number[] };
  barrels: { x: number; z: number; r: number; top: number }[];
}

export function boothLayout(W: number, H: number): BoothLayout {
  const yB = -H / 2, yT = H / 2;
  const floorY = yB - 0.01;
  return {
    W, H, D: 0.5,
    floorY,
    counterTop: yB + 0.022,
    valanceBottom: yT - 0.035,
    rowA: { z: -0.1, top: yB + 0.04 },
    rowB: { z: -0.4, top: yB + H * 0.48 },
    shelf: { z: -0.3, top: yB + H * 0.4, xs: [-W * 0.25, W * 0.25] },
    barrels: [-1, 1].map((s) => ({ x: s * W * 0.22, z: -0.16, r: 0.016, top: yB + H * 0.36 })),
  };
}

export interface BoothBuild {
  group: THREE.Group;
  /** Lights the gallery dims when the torch is on. */
  lights: THREE.Light[];
  /** Base intensity for each light, matching `lights`. */
  baseIntensity: number[];
  bulbs: THREE.MeshStandardMaterial;
}

export function buildBooth(L: BoothLayout, env: THREE.Texture | null): BoothBuild {
  const { W, H, D } = L;
  const yB = -H / 2, yT = H / 2;
  const g = new THREE.Group();
  g.name = 'booth';

  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ envMap: env, envMapIntensity: 0.35, ...o });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], at: THREE.Vector3Tuple, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...at);
    m.castShadow = cast;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // --- Materials ---------------------------------------------------------
  const darkWood = woodTexture('#5e3a1f', 4, 21);
  const plankWood = woodTexture('#8a5a34', 7, 7);
  const redWood = woodTexture('#8f241e', 3, 13);
  const floorMat = std({ map: woodTexture('#4a2e18', 10, 3), roughness: 0.85 });
  const counterTopMat = std({ map: darkWood, roughness: 0.45, metalness: 0 });
  const counterFront = std({ map: counterTexture(), roughness: 0.55 });
  const postTex = stripeTexture('#c8202c', '#f3e6c8', 6, true);
  postTex.wrapS = postTex.wrapT = THREE.RepeatWrapping;
  postTex.repeat.set(1, 4);
  const postMat = std({ map: postTex, roughness: 0.35 });
  const brass = std({ color: '#d4a548', metalness: 0.9, roughness: 0.3, envMapIntensity: 1 });
  const awningTex = stripeTexture('#b51d2a', '#f3e6c8', 10);
  const awningMat = std({ map: awningTex, color: '#cfc4b8', roughness: 0.9, side: THREE.DoubleSide });
  const wallTex = stripeTexture('#5c1a22', '#cdb98f', 14);
  wallTex.repeat.set(2, 1);
  const wallMat = std({ map: wallTex, roughness: 0.85 });
  const plankMat = std({ map: redWood, roughness: 0.6 });
  const trimMat = std({ color: '#e8b64a', metalness: 0.6, roughness: 0.35 });
  const crateMat = std({ map: crateTexture(), roughness: 0.8 });
  const barrelMat = std({ map: barrelTexture(), roughness: 0.7 });
  const barrelTop = std({ map: plankWood, roughness: 0.8 });
  const shelfMat = std({ map: plankWood, roughness: 0.7 });
  const backdropTex = backdropTexture();
  const backdropMat = std({ map: backdropTex, emissiveMap: backdropTex, emissive: '#ffffff', emissiveIntensity: 0.12, roughness: 0.95, envMapIntensity: 0.1 });

  // --- Floor, walls, ceiling, backdrop -------------------------------------
  const floor = add(new THREE.PlaneGeometry(W, D), floorMat, [0, L.floorY, -D / 2], false);
  floor.rotation.x = -Math.PI / 2;
  for (const s of [-1, 1]) {
    const wall = add(new THREE.PlaneGeometry(D, H + 0.05), wallMat, [s * W / 2, 0, -D / 2], false);
    wall.rotation.y = -s * Math.PI / 2;
  }
  // Awning seen from below: canvas sloping gently down toward the back.
  const ceil = add(new THREE.PlaneGeometry(W, D + 0.02), awningMat, [0, yT - 0.006, -D / 2 + 0.01], false);
  ceil.rotation.x = Math.PI / 2 - 0.02;
  const backdrop = add(new THREE.PlaneGeometry(W, (W * 1280) / 2048), backdropMat, [0, yB + (W * 1280) / 2048 / 2 - 0.01, -D], false);
  backdrop.receiveShadow = true;

  // --- Counter at the glass -----------------------------------------------
  const cDepth = 0.06, cFront = 0.02;
  const top = add(new THREE.BoxGeometry(W + 0.04, 0.008, cDepth), counterTopMat, [0, L.counterTop - 0.004, cFront - cDepth / 2]);
  top.castShadow = false;
  const lipH = L.counterTop - 0.008 - (yB - 0.03);
  add(new THREE.BoxGeometry(W + 0.04, lipH, 0.004), counterFront, [0, L.counterTop - 0.008 - lipH / 2, cFront - 0.002], false);
  // brass rail along the front edge
  const rail = add(new THREE.CylinderGeometry(0.0022, 0.0022, W + 0.04, 16), brass, [0, L.counterTop + 0.001, cFront - 0.003]);
  rail.rotation.z = Math.PI / 2;

  // --- Posts --------------------------------------------------------------
  const postR = 0.0075;
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - postR - 0.004);
    const h = yT - L.counterTop + 0.03;
    add(new THREE.CylinderGeometry(postR, postR, h, 24), postMat, [x, L.counterTop + h / 2, 0.004]);
    add(new THREE.SphereGeometry(postR * 1.35, 20, 14), brass, [x, L.counterTop + 0.002, 0.004]);
  }

  // --- Valance and bulbs ----------------------------------------------------
  const scallops = 9;
  const vTex = valanceTexture(scallops);
  const vMat = std({ map: vTex, alphaTest: 0.5, roughness: 0.85, side: THREE.DoubleSide });
  const vH = (yT + 0.004) - L.valanceBottom + 0.012;
  add(new THREE.PlaneGeometry(W + 0.03, vH), vMat, [0, yT + 0.004 - vH / 2, 0.012]);
  const bulbs = new THREE.MeshStandardMaterial({ color: '#fff2c8', emissive: '#ffcf7a', emissiveIntensity: 2.2, roughness: 0.3 });
  const wireMat = new THREE.MeshBasicMaterial({ color: '#1a1410' });
  const string = (z: number, y0: number, sag: number, n: number, r: number, span: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      pts.push(new THREE.Vector3(-span / 2 + span * u, y0 - sag * 4 * u * (1 - u), z));
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.00035, 5), wireMat));
    const geo = new THREE.SphereGeometry(r, 14, 10);
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const p = new THREE.Vector3(-span / 2 + span * u, y0 - sag * 4 * u * (1 - u) - r * 1.1, z);
      const b = new THREE.Mesh(geo, bulbs);
      b.position.copy(p);
      g.add(b);
      out.push(p);
    }
    return out;
  };
  const front = string(0.016, L.valanceBottom + 0.004, 0.008, 9, 0.0032, W - 0.03);
  string(-0.24, yT - 0.012, 0.012, 11, 0.0024, W - 0.01);

  // --- Midground: conveyor planks, barrels, crates, bottle shelf ------------
  const plank = (z: number, topY: number) => {
    const h = topY - L.floorY;
    add(new THREE.BoxGeometry(W, h, 0.012), plankMat, [0, L.floorY + h / 2, z + 0.008]);
    add(new THREE.BoxGeometry(W, 0.003, 0.014), trimMat, [0, topY - 0.0015, z + 0.008]);
  };
  plank(L.rowA.z, L.rowA.top);
  plank(L.rowB.z, L.rowB.top);

  for (const b of L.barrels) {
    const h = b.top - L.floorY;
    const barrel = add(new THREE.CylinderGeometry(b.r * 0.92, b.r * 0.92, h, 28, 1, false), [barrelMat, barrelTop, barrelTop], [b.x, L.floorY + h / 2, b.z]);
    // a slight bulge reads as a barrel rather than a pipe
    const pos = barrel.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / h;
      const k = 1 + 0.12 * (1 - 4 * y * y);
      if (Math.hypot(pos.getX(i), pos.getZ(i)) > 1e-5) { pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
    }
    barrel.geometry.computeVertexNormals();
  }

  // crates stacked in the front corners
  const crate = (x: number, y: number, z: number, s: number, rot: number) => {
    const m = add(new THREE.BoxGeometry(s, s, s), crateMat, [x, y + s / 2, z]);
    m.rotation.y = rot;
  };
  crate(-W / 2 + 0.03, L.floorY, -0.05, 0.045, 0.15);
  crate(W / 2 - 0.032, L.floorY, -0.055, 0.042, -0.2);
  crate(W / 2 - 0.035, L.floorY + 0.042, -0.058, 0.03, 0.35);

  // bottle shelf: a narrow table across the booth
  const sh = L.shelf;
  add(new THREE.BoxGeometry(W, 0.006, 0.05), shelfMat, [0, sh.top - 0.003, sh.z]);
  const skirt = sh.top - 0.006 - L.floorY;
  add(new THREE.BoxGeometry(W, skirt, 0.004), plankMat, [0, L.floorY + skirt / 2, sh.z + 0.024]);

  // --- Lights ---------------------------------------------------------------
  const lights: THREE.Light[] = [];
  const hemi = new THREE.HemisphereLight('#ffe2b8', '#3a1c22', 0.5);
  g.add(hemi); lights.push(hemi);

  // Key light hung behind the valance, raking down into the booth.
  const key = new THREE.SpotLight('#ffd9a6', 0.9, 0, 0.85, 0.55, 2);
  key.position.set(-W * 0.12, yT - 0.016, -0.02);
  key.target.position.set(W * 0.04, yB, -D * 0.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.02;
  key.shadow.camera.far = 1.2;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.0008;
  key.shadow.radius = 3;
  g.add(key, key.target); lights.push(key);

  // Warm glow from the front bulbs.
  for (const i of [1, 4, 7]) {
    // Hung a little below and behind the bulbs so the canvas above isn't blown out.
    const p = new THREE.PointLight('#ffb35c', 0.02, 0, 2);
    p.position.copy(front[i]).add(new THREE.Vector3(0, -0.02, -0.03));
    g.add(p); lights.push(p);
  }
  // Fill on the backdrop so the deep layer reads.
  const back = new THREE.SpotLight('#ffc9e0', 0.18, 0, 0.9, 0.8, 2);
  back.position.set(0, yT - 0.02, -0.22);
  back.target.position.set(0, yB + H * 0.4, -D);
  g.add(back, back.target); lights.push(back);

  return { group: g, lights, baseIntensity: lights.map((l) => l.intensity), bulbs };
}
