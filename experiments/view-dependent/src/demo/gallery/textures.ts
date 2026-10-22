import * as THREE from 'three';

// Painted-look textures drawn on canvases at startup, so the booth needs no
// image files and stays offline-friendly.

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

/** Seeded random so the booth looks the same on every load. */
function rng(seed: number): () => number {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

/** Weathered planks running horizontally. */
export function woodTexture(base = '#8a5a34', planks = 6, seed = 7): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const r = rng(seed);
  const ph = 512 / planks;
  for (let i = 0; i < planks; i++) {
    const shade = 0.85 + r() * 0.3;
    g.fillStyle = base;
    g.globalAlpha = 1;
    g.fillRect(0, i * ph, 512, ph);
    g.fillStyle = `rgba(${shade > 1 ? 255 : 0},${shade > 1 ? 230 : 0},${shade > 1 ? 200 : 0},${Math.abs(shade - 1) * 0.6})`;
    g.fillRect(0, i * ph, 512, ph);
    // grain
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(40,20,8,${0.08 + r() * 0.12})`;
      g.lineWidth = 1 + r() * 2;
      const y = i * ph + r() * ph;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 2 * r());
      g.stroke();
    }
    // knots
    if (r() > 0.5) {
      g.fillStyle = 'rgba(50,25,10,0.5)';
      g.beginPath(); g.ellipse(r() * 512, i * ph + ph / 2, 10 + r() * 8, 5, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(20,10,4,0.7)';
    g.fillRect(0, i * ph, 512, 3);
  }
  return texture(c);
}

/** Candy stripes (red and cream), optionally diagonal for posts. */
export function stripeTexture(a = '#c8202c', b = '#f3e6c8', stripes = 8, diagonal = false): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = b; g.fillRect(0, 0, 256, 256);
  g.fillStyle = a;
  const s = 256 / stripes;
  for (let i = -stripes; i < stripes * 2; i += 2) {
    g.beginPath();
    if (diagonal) {
      g.moveTo(i * s, 0); g.lineTo((i + 1) * s, 0); g.lineTo((i + 1) * s + 256, 256); g.lineTo(i * s + 256, 256);
    } else {
      g.rect(i * s, 0, s, 256);
    }
    g.fill();
  }
  // a little fabric/paint wear
  const r = rng(3);
  for (let k = 0; k < 400; k++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.06})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  return texture(c, [1, 1]);
}

/** Awning valance: stripes with a scalloped, transparent bottom edge. */
export function valanceTexture(scallops: number): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 192);
  const sw = 1024 / scallops;
  g.save();
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(1024, 0); g.lineTo(1024, 110);
  for (let i = scallops - 1; i >= 0; i--) g.arc(i * sw + sw / 2, 110, sw / 2, 0, Math.PI, false);
  g.closePath();
  g.clip();
  for (let i = 0; i < scallops; i++) {
    g.fillStyle = i % 2 ? '#f3e6c8' : '#c8202c';
    g.fillRect(i * sw, 0, sw, 192);
  }
  // gold trim
  g.strokeStyle = '#e8b64a'; g.lineWidth = 10;
  g.beginPath(); g.moveTo(0, 14); g.lineTo(1024, 14); g.stroke();
  g.restore();
  g.strokeStyle = '#e8b64a'; g.lineWidth = 6;
  g.beginPath();
  for (let i = 0; i < scallops; i++) g.arc(i * sw + sw / 2, 110, sw / 2 - 3, Math.PI, 0, true);
  g.stroke();
  const t = texture(c);
  return t;
}

/** The painted backdrop: night sky, big top, ferris wheel, banner. */
export function backdropTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(2048, 1280);
  const r = rng(11);
  const sky = g.createLinearGradient(0, 0, 0, 1280);
  sky.addColorStop(0, '#0d1033'); sky.addColorStop(0.55, '#3a2357'); sky.addColorStop(1, '#a8506a');
  g.fillStyle = sky; g.fillRect(0, 0, 2048, 1280);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,245,220,${0.3 + r() * 0.7})`;
    const s = r() * 3 + 1;
    g.fillRect(r() * 2048, r() * 700, s, s);
  }
  // moon
  g.fillStyle = '#f6e7b8'; g.beginPath(); g.arc(1700, 220, 70, 0, Math.PI * 2); g.fill();
  // ferris wheel silhouette
  g.strokeStyle = 'rgba(30,18,40,0.9)'; g.lineWidth = 10;
  g.beginPath(); g.arc(420, 640, 300, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(420, 640); g.lineTo(420 + Math.cos(a) * 300, 640 + Math.sin(a) * 300); g.stroke();
    g.fillStyle = '#ffd166';
    g.beginPath(); g.arc(420 + Math.cos(a) * 300, 640 + Math.sin(a) * 300, 12, 0, Math.PI * 2); g.fill();
  }
  g.beginPath(); g.moveTo(420, 640); g.lineTo(300, 1280); g.moveTo(420, 640); g.lineTo(540, 1280); g.stroke();
  // big top tent
  const tx = 1350, ty = 520;
  for (let i = 0; i < 10; i++) {
    g.fillStyle = i % 2 ? '#f3e6c8' : '#b51d2a';
    g.beginPath(); g.moveTo(tx, ty);
    g.lineTo(tx - 520 + i * 104, 1000); g.lineTo(tx - 520 + (i + 1) * 104, 1000); g.closePath(); g.fill();
  }
  g.fillStyle = '#b51d2a'; g.fillRect(tx - 520, 1000, 1040, 280);
  g.fillStyle = '#2a1408'; g.beginPath(); g.moveTo(tx - 70, 1280); g.lineTo(tx, 1060); g.lineTo(tx + 70, 1280); g.fill();
  g.fillStyle = '#e8b64a'; g.beginPath(); g.moveTo(tx, ty - 90); g.lineTo(tx + 70, ty - 60); g.lineTo(tx, ty - 30); g.fill();
  g.fillStyle = '#5a3a1a'; g.fillRect(tx - 4, ty - 90, 8, 90);
  // hills
  g.fillStyle = '#1d1430';
  g.beginPath(); g.moveTo(0, 1120);
  for (let x = 0; x <= 2048; x += 64) g.lineTo(x, 1100 + Math.sin(x * 0.004) * 40);
  g.lineTo(2048, 1280); g.lineTo(0, 1280); g.fill();
  // banner
  g.save();
  g.translate(1024, 170);
  g.fillStyle = '#e8b64a'; g.fillRect(-560, -90, 1120, 180);
  g.fillStyle = '#7a1018'; g.fillRect(-540, -72, 1080, 144);
  g.fillStyle = '#ffe6a8';
  g.font = 'bold 110px Georgia, "Times New Roman", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('STEP RIGHT UP!', 0, 6);
  g.restore();
  // painted-canvas texture
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.03})`;
    g.fillRect(r() * 2048, r() * 1280, 3, 3);
  }
  return texture(c);
}

/** A red/white bullseye with a gold rim. */
export function bullseyeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rings = ['#e8b64a', '#c8202c', '#f7f1e3', '#c8202c', '#f7f1e3', '#c8202c'];
  rings.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath(); g.arc(128, 128, 128 - i * 20, 0, Math.PI * 2); g.fill();
  });
  g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(128, 128, 12, 0, Math.PI * 2); g.fill();
  return texture(c);
}

/** Counter front: deep red with gold stars and a scroll border. */
export function counterTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = '#7a1018'; g.fillRect(0, 0, 1024, 128);
  g.strokeStyle = '#e8b64a'; g.lineWidth = 6; g.strokeRect(8, 8, 1008, 112);
  g.fillStyle = '#e8b64a';
  for (let i = 0; i < 9; i++) {
    const x = 60 + i * 113, y = 64, R = 22, r = 9;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rad = k % 2 ? r : R;
      g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    g.fill();
  }
  return texture(c);
}

/** Soft dark scorch used for bullet marks (alpha texture). */
export function scorchTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(10,6,4,1)');
  grad.addColorStop(0.35, 'rgba(30,18,10,0.85)');
  grad.addColorStop(1, 'rgba(30,18,10,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return texture(c);
}

/** Round soft spark sprite. */
export function sparkTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(32, 32);
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.3, 'rgba(255,200,90,0.9)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return texture(c);
}

/** Milk bottle: white glass with a red band and gold pinstripes. The lathe's
 *  v runs along the profile, so bands are placed by profile position. */
export function bottleTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 256);
  g.fillStyle = '#eef2f2'; g.fillRect(0, 0, 64, 256);
  // canvas y is flipped relative to v
  g.fillStyle = '#c8202c'; g.fillRect(0, 256 - 150, 64, 60);
  g.fillStyle = '#e8b64a'; g.fillRect(0, 256 - 156, 64, 6); g.fillRect(0, 256 - 90, 64, 6);
  g.fillStyle = '#c8202c'; g.fillRect(0, 0, 64, 22);
  return texture(c);
}

/** Wooden crate face: planks inside a darker frame with a diagonal brace. */
export function crateTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(5);
  for (let i = 0; i < 5; i++) {
    const l = 0.8 + r() * 0.25;
    g.fillStyle = `rgb(${Math.round(176 * l)},${Math.round(124 * l)},${Math.round(72 * l)})`;
    g.fillRect(0, i * 51.2, 256, 51.2);
    g.fillStyle = 'rgba(40,20,8,0.6)'; g.fillRect(0, i * 51.2, 256, 2);
  }
  for (let k = 0; k < 120; k++) {
    g.strokeStyle = `rgba(60,30,10,${0.05 + r() * 0.1})`;
    const y = r() * 256;
    g.beginPath(); g.moveTo(0, y); g.lineTo(256, y + (r() - 0.5) * 6); g.stroke();
  }
  g.strokeStyle = '#5b3518'; g.lineWidth = 26; g.strokeRect(13, 13, 230, 230);
  g.beginPath(); g.moveTo(26, 230); g.lineTo(230, 26); g.stroke();
  g.fillStyle = '#2a2a2a';
  for (const [x, y] of [[13, 13], [243, 13], [13, 243], [243, 243]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  return texture(c);
}

/** Barrel staves with two iron hoops (cylinder UVs: u around, v up). */
export function barrelTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  const r = rng(9);
  const staves = 16;
  for (let i = 0; i < staves; i++) {
    const l = 0.75 + r() * 0.3;
    g.fillStyle = `rgb(${Math.round(150 * l)},${Math.round(92 * l)},${Math.round(48 * l)})`;
    g.fillRect((i * 512) / staves, 0, 512 / staves, 256);
    g.fillStyle = 'rgba(30,14,4,0.7)'; g.fillRect((i * 512) / staves, 0, 2, 256);
  }
  for (const y of [34, 222]) {
    g.fillStyle = '#3b3633'; g.fillRect(0, y - 12, 512, 24);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, y - 12, 512, 4);
  }
  return texture(c);
}

/** Brass-on-red score popup ("+50"). */
export function popupTexture(text: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.font = 'bold 84px Georgia, "Times New Roman", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 12; g.strokeStyle = '#5a0c12'; g.strokeText(text, 128, 68);
  g.fillStyle = '#ffd36b'; g.fillText(text, 128, 68);
  return texture(c);
}
