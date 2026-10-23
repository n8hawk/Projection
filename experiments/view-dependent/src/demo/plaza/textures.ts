import * as THREE from 'three';

// Textures for the plaza, painted on canvases at startup so nothing needs
// downloading.

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function rng(seed: number): () => number {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

/** Facade: dark concrete with a grid of windows, a few lit warm or cold.
 *  Returns the colour map and an emissive map for the lit windows. */
export function facadeTextures(seed: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const [c, g] = canvas(256, 256);
  const [e, ge] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = '#3a3138'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,230,220'},${r() * 0.06})`;
    g.fillRect(r() * 256, r() * 256, 4 + r() * 30, 2 + r() * 12);
  }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  const cols = 8, rows = 8;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const px = x * 32 + 7, py = y * 32 + 8;
    g.fillStyle = '#141116'; g.fillRect(px, py, 18, 18);
    const v = r();
    if (v < 0.12) { ge.fillStyle = `rgb(255,${140 + r() * 80 | 0},70)`; ge.fillRect(px, py, 18, 18); }
    else if (v < 0.17) { ge.fillStyle = 'rgb(90,200,255)'; ge.fillRect(px, py, 18, 18); }
    else if (v < 0.24) { g.fillStyle = '#05040a'; g.fillRect(px - 3, py - 3, 24, 26); } // blown out
  }
  // floor lines
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < rows; y++) g.fillRect(0, y * 32 + 30, 256, 2);
  return { map: texture(c), emissive: texture(e) };
}

/** Cracked asphalt with lane dashes; one tile is 28 m wide by 28 m long. */
export function roadTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const r = rng(3);
  g.fillStyle = '#2b2328'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,220,210'},${r() * 0.07})`;
    g.fillRect(r() * 512, r() * 512, 2 + r() * 10, 2 + r() * 10);
  }
  // curbs
  g.fillStyle = '#4b3f44'; g.fillRect(0, 0, 14, 512); g.fillRect(498, 0, 14, 512);
  // lane dashes
  g.fillStyle = 'rgba(230,200,150,0.55)';
  for (const x of [170, 340]) for (let y = 0; y < 512; y += 128) g.fillRect(x - 3, y + 20, 6, 70);
  // cracks and scorch marks
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.5;
  for (let i = 0; i < 18; i++) {
    let x = r() * 512, y = r() * 512;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const x = r() * 512, y = r() * 512, rad = 20 + r() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return texture(c);
}

/** Broken ground off the road: dirt and gravel. */
export function groundTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(9);
  g.fillStyle = '#2a2026'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,210,200'},${r() * 0.09})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 6, 1 + r() * 6);
  }
  return texture(c);
}

/** Rough concrete for cover pieces and barriers. */
export function concreteTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rng(21);
  g.fillStyle = '#6a5f63'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1200; i++) {
    g.fillStyle = `rgba(${r() < 0.55 ? '0,0,0' : '255,240,230'},${r() * 0.12})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 5, 1 + r() * 5);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(r() * 256, r() * 256); g.lineTo(r() * 256, r() * 256); g.stroke(); }
  return texture(c);
}

/** Yellow and black hazard stripes. */
export function hazardTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 32);
  g.fillStyle = '#e8b21e'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#16120e';
  for (let x = -32; x < 160; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); }
  return texture(c);
}

/** Soft round glow for sprites (white, tinted by the material). */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Scorch mark for hits. */
export function scorchTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(8,6,10,0.95)');
  gr.addColorStop(0.45, 'rgba(12,8,12,0.6)');
  gr.addColorStop(1, 'rgba(12,8,12,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
