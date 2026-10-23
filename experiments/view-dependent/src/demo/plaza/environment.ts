import * as THREE from 'three';
import { concreteTexture, facadeTextures, glowTexture, groundTexture, rng, roadTexture } from './textures';

/**
 * The plaza's static backdrop, in scene metres (1 = one metre in the story;
 * the plaza scales it down onto the screen). The glass is z = 0, the street
 * runs away along -z, the ground is y = 0 and you crouch at z ≈ +12.
 *
 * Depth bands, near to far: rubble cover (props) · street and ruined blocks
 * (20–400 m) · the elevated highway (170 m) · the city skyline (600–1200 m)
 * · walkers and the alien spire · mountains (3 km) under a dusk sky.
 */
export interface Environment {
  group: THREE.Group;
  /** Meshes shots can chip (sparks and debris, but they don't break). */
  solid: THREE.Object3D[];
  /** Places that burn for the whole show: [position, size]. */
  fires: [THREE.Vector3, number][];
  /** Side-street glows and other lights to flicker. */
  glows: THREE.Sprite[];
  /** Where drones patrol and walkers roam, so the props can use it. */
  streetHalfWidth: number;
}

export const SKY_RADIUS = 6000;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 zenith = vec3(0.025, 0.03, 0.10);
  vec3 mid = vec3(0.14, 0.08, 0.26);
  vec3 low = vec3(0.50, 0.16, 0.30);
  vec3 hor = vec3(1.05, 0.42, 0.20);
  vec3 c = mix(hor, low, smoothstep(0.0, 0.06, h));
  c = mix(c, mid, smoothstep(0.05, 0.22, h));
  c = mix(c, zenith, smoothstep(0.2, 0.7, h));
  // The sun has just set at the far end of the street.
  float toward = max(0.0, dot(normalize(vec3(vDir.x, 0.0, vDir.z)), vec3(0.15, 0.0, -1.0)));
  c += vec3(0.9, 0.35, 0.12) * pow(toward, 6.0) * exp(-max(h, 0.0) * 14.0) * 0.8;
  if (h < 0.0) c = mix(hor * 0.5, vec3(0.06, 0.03, 0.05), smoothstep(0.0, 0.08, -h));
  gl_FragColor = vec4(c, 1.0);
}`;

export function buildEnvironment(): Environment {
  const group = new THREE.Group();
  group.name = 'plaza-environment';
  const solid: THREE.Object3D[] = [];
  const fires: [THREE.Vector3, number][] = [];
  const glows: THREE.Sprite[] = [];
  const r = rng(42);
  const glowTex = glowTexture();

  // ---- Sky, stars and a far haze band ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.renderOrder = -10;
  sky.position.z = -400;
  group.add(sky);
  {
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const az = r() * Math.PI * 2, el = 0.12 + r() * 1.3;
      const d = SKY_RADIUS * 0.95;
      pos.set([Math.cos(el) * Math.sin(az) * d, Math.sin(el) * d, -400 - Math.cos(el) * Math.cos(az) * d], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffeedd', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
    group.add(stars);
  }

  // ---- Ground: the boulevard and the broken lots either side ----
  const roadTex = roadTexture();
  roadTex.repeat.set(1, 1400 / 28);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(28, 1400), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -690);
  road.receiveShadow = true;
  group.add(road);
  solid.push(road);
  const gTex = groundTexture();
  gTex.repeat.set(160, 160);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: gTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -2500);
  group.add(ground);
  solid.push(ground);

  // ---- Ruined blocks along the street, with side streets between ----
  const concrete = concreteTexture();
  const facades = [11, 23, 37, 51].map((s) => facadeTextures(s));
  const blockMats = facades.map((f) => new THREE.MeshStandardMaterial({
    map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9, roughness: 0.9,
  }));
  const topMat = new THREE.MeshStandardMaterial({ color: '#2a2228', roughness: 1, map: concrete });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const addBlock = (x: number, z: number, w: number, d: number, h: number) => {
    const mat = blockMats[(r() * blockMats.length) | 0];
    const geo = box.clone();
    // Facade texture tiles every 12 m.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4);
      const sx = face < 2 ? d : w, sy = face === 2 || face === 3 ? d : h;
      uv.setXY(i, uv.getX(i) * sx / 12, uv.getY(i) * sy / 12);
    }
    const m = new THREE.Mesh(geo, [mat, mat, topMat, topMat, mat, mat]);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    group.add(m);
    solid.push(m);
    // Broken crown: a few smaller chunks, some leaning.
    const chunks = 1 + (r() * 3 | 0);
    for (let k = 0; k < chunks; k++) {
      const cw = w * (0.2 + r() * 0.4), cd = d * (0.2 + r() * 0.5), ch = 2 + r() * h * 0.25;
      const c = new THREE.Mesh(box, topMat);
      c.scale.set(cw, ch, cd);
      c.position.set(x + (r() - 0.5) * (w - cw), h + ch / 2 - 0.5, z + (r() - 0.5) * (d - cd));
      c.rotation.z = (r() - 0.5) * 0.25;
      group.add(c);
      solid.push(c);
    }
    if (r() < 0.3) fires.push([new THREE.Vector3(x + (r() - 0.5) * w * 0.6, h + 0.5, z), 2 + r() * 3]);
  };
  // The square is wide open up front; the blocks start well back and get
  // taller with distance, so the view opens out instead of closing in.
  for (const side of [-1, 1]) {
    let z = side < 0 ? -95 : -80;
    while (z > -620) {
      const w = 16 + r() * 18, d = 14 + r() * 20;
      const h = 8 + r() * r() * (18 + -z * 0.09);
      const x = side * (52 + w / 2 + r() * 12 + (-z - 80) * 0.03);
      addBlock(x, z - d / 2, w, d, h);
      z -= d + 8 + r() * 16;
      // Side street glow in the gap.
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: r() < 0.5 ? '#46b8ff' : '#ff7a3a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 }));
      s.position.set(x - side * (w / 2 + 2), 4, z + 5);
      s.scale.setScalar(14);
      group.add(s);
      glows.push(s);
    }
  }

  // Low ruins scattered over the square: broken walls and a toppled monument.
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (22 + r() * 26), z = -28 - r() * 70;
    const w = 3 + r() * 9, h = 1.2 + r() * 3.5;
    const wall = new THREE.Mesh(box, topMat);
    wall.scale.set(w, h, 0.8 + r() * 0.8);
    wall.position.set(x, h / 2, z);
    wall.rotation.y = (r() - 0.5) * 1.2;
    group.add(wall);
    solid.push(wall);
  }
  {
    const plinth = new THREE.Mesh(box, topMat);
    plinth.scale.set(8, 3, 8);
    plinth.position.set(-20, 1.5, -66);
    const statue = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 9, 7), topMat);
    statue.position.set(-15, 1.4, -63);
    statue.rotation.z = Math.PI / 2 - 0.2;
    statue.rotation.y = 0.6;
    group.add(plinth, statue);
    solid.push(plinth, statue);
  }
  // Street lamps down both kerbs, a few still lit.
  {
    const pole = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#24202a', roughness: 0.6, metalness: 0.6 });
    for (let z = -24; z > -420; z -= 26) for (const side of [-1, 1]) {
      const m = new THREE.Mesh(pole, poleMat);
      const bent = r() < 0.3;
      m.position.set(side * 15, 3.5, z + side * 6);
      if (bent) m.rotation.z = side * (0.3 + r() * 0.5);
      group.add(m);
      solid.push(m);
      if (!bent && r() < 0.7) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffc27a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
        s.position.set(side * 15, 7.1, z + side * 6);
        s.scale.setScalar(2.2);
        group.add(s);
      }
    }
  }

  // ---- The far skyline: hundreds of towers, instanced ----
  {
    const n = 420;
    const f = facadeTextures(77);
    f.map.repeat.set(2, 6); f.emissive.repeat.set(2, 6);
    const mat = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.8, roughness: 1 });
    const towers = new THREE.InstancedMesh(box, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const z = -640 - r() * 700, x = (r() - 0.5) * 2600;
      const w = 18 + r() * 40, h = 25 + r() * r() * r() * 260;
      s.set(w, h, 18 + r() * 40);
      p.set(x, h / 2, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.4);
      towers.setMatrixAt(i, m.compose(p, q, s));
    }
    group.add(towers);
    solid.push(towers);
    for (let i = 0; i < 14; i++) fires.push([new THREE.Vector3((r() - 0.5) * 1800, 2, -660 - r() * 600), 8 + r() * 8]);
  }

  // ---- Elevated highway crossing the street, one span already down ----
  // (the pillars and deck spans are props, so they can be shot down)

  // ---- Mountains far beyond the city ----
  {
    const pts: number[] = [];
    const idx: number[] = [];
    const n = 120;
    for (let i = 0; i <= n; i++) {
      const x = -5000 + (10000 * i) / n;
      const h = 180 + r() * 420 + Math.sin(i * 0.37) * 120;
      pts.push(x, -20, -3200 - r() * 400, x, h, -3200 - r() * 400);
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    const mtn = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#5a2a48', fog: false, side: THREE.DoubleSide }));
    mtn.renderOrder = -9;
    group.add(mtn);
  }

  // ---- The alien spire ----
  {
    const spire = new THREE.Group();
    spire.position.set(620, 0, -1900);
    const dark = new THREE.MeshStandardMaterial({ color: '#1e1428', roughness: 0.6, metalness: 0.6 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 40, 1100, 6), dark);
    shaft.position.y = 550;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(70, 260, 3), dark);
    fin.position.y = 420;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1000, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 2.2), fog: false }));
    core.position.set(0, 560, 22);
    const top = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#a8ecff', blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    top.position.y = 1110; top.scale.setScalar(320);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#3a7cff', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.5 }));
    halo.position.y = 600; halo.scale.set(500, 1100, 1);
    spire.add(shaft, fin, core, top, halo);
    group.add(spire);
    glows.push(top);
  }

  // ---- Mothership hanging over the city, its tractor beam on ----
  {
    const ship = new THREE.Group();
    ship.position.set(-520, 820, -1700);
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 16), new THREE.MeshStandardMaterial({ color: '#100c18', roughness: 0.5, metalness: 0.7 }));
    hull.scale.set(620, 70, 380);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hull.material);
    dome.scale.set(220, 70, 160); dome.position.y = 40;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(470, 7, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 2.4), fog: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -28; ring.scale.set(1, 0.62, 1);
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.7, 0.9), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(70, 240, 860, 24, 1, true), beamMat);
    beam.position.y = -460;
    ship.add(hull, dome, ring, beam);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const l = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff4a3a', blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      l.position.set(Math.cos(a) * 560, -10, Math.sin(a) * 340);
      l.scale.setScalar(60);
      ship.add(l);
    }
    group.add(ship);
  }

  // A low sun glow at the end of the street, behind the city.
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff8a4a', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.22 }));
  sun.position.set(300, 60, -3000);
  sun.scale.set(3200, 900, 1);
  group.add(sun);

  for (const o of solid) o.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.receiveShadow = true; });
  return { group, solid, fires, glows, streetHalfWidth: 14 };
}
