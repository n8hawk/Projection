import * as THREE from 'three';
import { Engine } from './engine/Engine';
import { openChannel, type Overlay } from './state/sync';
import { readPads } from './engine/pads';
import { meshOutline } from './engine/quad';
import { transportTime } from './model/time';
import type { Show, Transport, Vec2 } from './model/types';

// The output page: no UI, just the composed show, full screen on the projector.

const canvas = document.createElement('canvas');
document.body.append(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(1);
const engine = new Engine(renderer);

// Mapping helpers are drawn on a 2D canvas on top, and only while not live.
const helpers = document.createElement('canvas');
helpers.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
document.body.append(helpers);
const ctx = helpers.getContext('2d')!;

let show: Show | null = null;
let transport: Transport | null = null;
let overlay: Overlay = { live: false, outlines: true, selectedId: null, point: 0 };

const channel = openChannel((m) => {
  if (m.type === 'state') {
    show = m.show;
    transport = m.transport;
    hint.textContent = 'CLICK OR PRESS F FOR FULLSCREEN';
  } else if (m.type === 'overlay') {
    overlay = m.overlay;
  }
});

const ACTIVE = '#90ECFF', MUTED = '#9A9EA5', GREEN = '#62D289', MASK = '#F08A96';

/** Outlines, labels and points, in the same places as the editor's Map screen. */
function drawHelpers(x0: number, y0: number, vw: number, vh: number): void {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
  if (helpers.width !== W || helpers.height !== H) { helpers.width = W; helpers.height = H; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (!show || overlay.live) return;
  const u = vh / 720; // scale line widths and text with the output size
  const at = ([x, y]: Vec2): Vec2 => [x0 + x * vw, y0 + y * vh];
  const poly = (pts: Vec2[], stroke: string, width: number, dash: number[] = []) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = at(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.setLineDash(dash.map((d) => d * u));
    ctx.lineWidth = width * u;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  ctx.font = `600 ${Math.round(13 * u)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const s of show.surfaces) {
    const sel = s.id === overlay.selectedId;
    if (!overlay.outlines && !sel) continue;
    const outline = s.mesh ? meshOutline(s.mesh) : s.corners;
    const color = sel ? ACTIVE : s.bind ? GREEN : MUTED;
    poly(outline, color, sel ? 3 : 2, s.bind && !sel ? [6, 5] : []);
    if (sel && s.mesh) {
      const m = s.mesh;
      const pt = (i: number, j: number) => at(m.points[j * (m.cols + 1) + i]);
      ctx.strokeStyle = 'rgba(144,236,255,0.45)';
      ctx.lineWidth = 1.5 * u;
      for (let j = 0; j <= m.rows; j++) { ctx.beginPath(); for (let i = 0; i <= m.cols; i++) { const [x, y] = pt(i, j); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); }
      for (let i = 0; i <= m.cols; i++) { ctx.beginPath(); for (let j = 0; j <= m.rows; j++) { const [x, y] = pt(i, j); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); }
    }
    const cx = outline.reduce((a, c) => a + c[0], 0) / outline.length;
    const cy = outline.reduce((a, c) => a + c[1], 0) / outline.length;
    const [tx, ty] = at([cx, cy]);
    ctx.fillStyle = color;
    ctx.fillText(s.name.toUpperCase(), tx, ty);
  }
  for (const m of show.masks ?? []) {
    poly(m.points, MASK, m.id === overlay.selectedId ? 3 : 2, m.id === overlay.selectedId ? [] : [4, 4]);
  }

  // Points of the selected surface or mask; the one being nudged is filled.
  const surf = show.surfaces.find((s) => s.id === overlay.selectedId);
  const mask = (show.masks ?? []).find((m) => m.id === overlay.selectedId);
  const pts = surf ? (surf.mesh ? surf.mesh.points : surf.corners) : mask ? mask.points : [];
  const color = mask ? MASK : ACTIVE;
  pts.forEach((p, i) => {
    const [x, y] = at(p);
    ctx.beginPath();
    ctx.arc(x, y, (surf?.mesh ? 6 : 9) * u, 0, Math.PI * 2);
    ctx.fillStyle = i === overlay.point ? color : '#18191B';
    ctx.fill();
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = color;
    ctx.stroke();
  });

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = GREEN;
  ctx.fillText('MAPPING · PRESS GO LIVE IN THE EDITOR TO HIDE', x0 + 12 * u, y0 + 12 * u);
}
channel.post({ type: 'hello' });
window.addEventListener('beforeunload', () => channel.post({ type: 'bye' }));

const hint = document.createElement('div');
hint.textContent = 'WAITING FOR THE EDITOR…';
hint.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);font:600 12px/1 system-ui;letter-spacing:.14em;color:#90ECFF;background:rgba(24,25,27,.85);padding:10px 14px;border-radius:4px;transition:opacity .4s';
document.body.append(hint);
const fullscreen = () => void document.documentElement.requestFullscreen?.().catch(() => undefined);
window.addEventListener('click', fullscreen);
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'f') fullscreen(); });
document.addEventListener('fullscreenchange', () => { hint.style.opacity = document.fullscreenElement ? '0' : '1'; });

let frames = 0;
let last = performance.now();
const frame = () => {
  requestAnimationFrame(frame);
  // Controllers only report to the focused window; when that's us, pass them to the editor.
  if (document.hasFocus()) {
    const pads = readPads();
    if (pads.length) channel.post({ type: 'gamepad', pads });
  }
  const w = window.innerWidth, h = window.innerHeight;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  // Letterbox the 16:9 output into whatever the display is.
  let vw = w, vh = w / (16 / 9);
  if (vh > h) { vh = h; vw = h * (16 / 9); }
  if (show && transport) {
    engine.render(show, transportTime(transport, show.duration), transport.playing);
    renderer.setViewport((w - vw) / 2, (h - vh) / 2, vw, vh);
    engine.blit(engine.output.texture);
    renderer.setViewport(0, 0, w, h);
  }
  drawHelpers((w - vw) / 2, (h - vh) / 2, vw, vh);
  frames++;
  const t = performance.now();
  if (t - last > 1000) {
    channel.post({ type: 'output-status', fps: Math.round((frames * 1000) / (t - last)), width: screen.width, height: screen.height });
    frames = 0;
    last = t;
  }
};
requestAnimationFrame(frame);
