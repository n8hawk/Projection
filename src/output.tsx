import * as THREE from 'three';
import { Engine } from './engine/Engine';
import { openChannel } from './state/sync';
import { transportTime } from './model/time';
import type { Show, Transport } from './model/types';

// The output page: no UI, just the composed show, full screen on the projector.

const canvas = document.createElement('canvas');
document.body.append(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(1);
const engine = new Engine(renderer);

let show: Show | null = null;
let transport: Transport | null = null;

const channel = openChannel((m) => {
  if (m.type === 'state') {
    show = m.show;
    transport = m.transport;
    hint.textContent = 'CLICK OR PRESS F FOR FULLSCREEN';
  }
});
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
  const w = window.innerWidth, h = window.innerHeight;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  if (show && transport) {
    engine.render(show, transportTime(transport, show.duration), transport.playing);
    // Letterbox the 16:9 output into whatever the display is.
    let vw = w, vh = w / (16 / 9);
    if (vh > h) { vh = h; vw = h * (16 / 9); }
    renderer.setViewport((w - vw) / 2, (h - vh) / 2, vw, vh);
    engine.blit(engine.output.texture);
    renderer.setViewport(0, 0, w, h);
  }
  frames++;
  const t = performance.now();
  if (t - last > 1000) {
    channel.post({ type: 'output-status', fps: Math.round((frames * 1000) / (t - last)), width: screen.width, height: screen.height });
    frames = 0;
    last = t;
  }
};
requestAnimationFrame(frame);
