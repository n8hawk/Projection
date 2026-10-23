import * as THREE from 'three';
import type { PlazaAim, SciFiPlaza } from './plaza';

/**
 * The plaza's 2D overlay: an open reticle where the shot will land (four thin
 * arcs round an empty middle, so you can see what you're aiming at), the
 * aim-assist ring around it, lock brackets on the enemy it's pulling onto,
 * hit markers, the heat gauge and a kill count.
 */
export class PlazaHud {
  readonly canvas = document.createElement('canvas');
  private g = this.canvas.getContext('2d')!;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor() {
    this.canvas.className = 'plaza-hud';
  }

  /** Canvas pixel position of a world point, or null when behind the eye. */
  private toPx(p: THREE.Vector3, camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 | null {
    out.copy(p).project(camera);
    if (out.z > 1) return null;
    out.set((out.x + 1) / 2 * this.canvas.width, (1 - out.y) / 2 * this.canvas.height, 0);
    return out;
  }

  draw(camera: THREE.Camera, plaza: SciFiPlaza, aim: PlazaAim | null, rayDir: THREE.Vector3 | null, show: boolean): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = this.g;
    g.clearRect(0, 0, w, h);
    c.hidden = !show;
    if (!show) return;
    const u = dpr;

    if (aim && rayDir && plaza.settings.crosshair) {
      const p = this.toPx(aim.point, camera, this.a);
      if (p) {
        const x = p.x, y = p.y;
        // Assist ring: the cone's width where the shot lands.
        const cone = THREE.MathUtils.degToRad(plaza.settings.assistDeg);
        const side = new THREE.Vector3().crossVectors(rayDir, new THREE.Vector3(0, 1, 0)).normalize();
        const edge = this.b.copy(aim.point).addScaledVector(side, Math.tan(cone) * aim.distance);
        const q = this.toPx(edge, camera, edge);
        const ring = q ? Math.min(46 * u, Math.max(20 * u, Math.hypot(q.x - x, q.y - y))) : 30 * u;
        const locked = !!aim.lock;
        g.save();
        // Dark under-stroke so the ring reads on bright sky and dark rubble.
        g.setLineDash([5 * u, 5 * u]);
        g.strokeStyle = 'rgba(0,0,0,0.55)';
        g.lineWidth = 3.5 * u;
        g.beginPath(); g.arc(x, y, ring, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = locked ? 'rgba(255,120,90,0.95)' : 'rgba(170,230,255,0.9)';
        g.lineWidth = 1.8 * u;
        g.beginPath(); g.arc(x, y, ring, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        const hot = plaza.overheated;
        for (const [col, lw] of [['rgba(0,0,0,0.5)', 3.5 * u], [hot ? 'rgba(255,140,90,0.95)' : 'rgba(240,250,255,0.95)', 1.6 * u]] as const) {
          g.strokeStyle = col; g.lineWidth = lw;
          for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4;
            g.beginPath(); g.arc(x, y, 10 * u, a - 0.45, a + 0.45); g.stroke();
          }
        }
        g.fillStyle = 'rgba(240,250,255,0.95)';
        g.beginPath(); g.arc(x, y, 1.4 * u, 0, Math.PI * 2); g.fill();
        // Hit marker.
        const hitAge = Math.min(plaza.sinceHit, plaza.sinceKill);
        if (hitAge < 0.18) {
          const kill = plaza.sinceKill < 0.18;
          g.strokeStyle = kill ? 'rgba(255,80,60,0.95)' : 'rgba(255,255,255,0.9)';
          g.lineWidth = 2 * u;
          const r0 = 7 * u, r1 = (kill ? 15 : 11) * u;
          for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            g.beginPath(); g.moveTo(x + sx * r0, y + sy * r0); g.lineTo(x + sx * r1, y + sy * r1); g.stroke();
          }
        }
        g.restore();
      }
      if (aim.lock) {
        const l = this.toPx(aim.lockPoint, camera, this.b);
        if (l) {
          g.strokeStyle = 'rgba(255,110,80,0.95)';
          g.lineWidth = 2 * u;
          const s = 18 * u, k = 7 * u;
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            g.beginPath(); g.moveTo(l.x + sx * s, l.y + sy * (s - k)); g.lineTo(l.x + sx * s, l.y + sy * s); g.lineTo(l.x + sx * (s - k), l.y + sy * s); g.stroke();
          }
        }
      }
    }

    // Heat gauge, bottom left.
    const x0 = 20 * u, y0 = h - 26 * u;
    g.font = `700 ${12 * u}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(8,6,14,0.55)';
    g.fillRect(x0 - 10 * u, y0 - 34 * u, 250 * u, 48 * u);
    const blink = plaza.overheated && Math.floor(performance.now() / 180) % 2 === 0;
    g.fillStyle = plaza.overheated ? (blink ? '#ff7a5a' : '#ffb08a') : '#c9b8ff';
    g.fillText(plaza.overheated ? 'VENTING' : `PLASMA HEAT ${Math.round(plaza.heat * 100)}%`, x0, y0 - 18 * u);
    for (let i = 0; i < 20; i++) {
      const t = i / 19, on = plaza.heat > i / 20;
      g.fillStyle = on ? `rgb(${120 + t * 135 | 0},${230 - t * 150 | 0},${255 - t * 120 | 0})` : 'rgba(255,255,255,0.12)';
      g.fillRect(x0 + i * 11.5 * u, y0 - 10 * u, 8 * u, 14 * u);
    }

    // Tally, top left.
    g.textAlign = 'left';
    g.font = `700 ${20 * u}px "Chakra Petch", "Segoe UI", sans-serif`;
    g.fillStyle = '#ffd08a';
    g.fillText(`${plaza.kills} KILLS`, 20 * u, 36 * u);
    g.font = `500 ${12 * u}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
    g.fillStyle = 'rgba(255,230,210,0.8)';
    const acc = plaza.shots ? Math.round((100 * plaza.hits) / plaza.shots) : 0;
    g.fillText(`${plaza.wrecked} THINGS WRECKED · ${acc}% ON TARGET`, 20 * u, 56 * u);

    // Callout, top centre.
    if (plaza.callout.age < 1.6) {
      g.textAlign = 'center';
      g.globalAlpha = Math.min(1, (1.6 - plaza.callout.age) * 2);
      g.font = `700 ${22 * u}px "Chakra Petch", "Segoe UI", sans-serif`;
      g.fillStyle = plaza.callout.text === 'OVERHEAT' ? '#ff8a6a' : '#ffe0a0';
      g.fillText(plaza.callout.text, w / 2, 70 * u);
      g.globalAlpha = 1;
      g.textAlign = 'left';
    }
  }
}
