import * as THREE from 'three';
import type { Calibration } from './types';
import type { WindowRect } from './offAxis';

/**
 * Works out where the browser canvas sits on the physical display, in metres
 * of screen space, so a windowed (non-fullscreen) view still acts like the
 * right piece of glass. Browsers don't report the window chrome exactly, so
 * this is an estimate; fullscreen is exact.
 */
export function canvasWindowRect(cal: Calibration, el: HTMLElement, followWindow: boolean): WindowRect {
  const W = cal.screenWidthCm / 100;
  const H = cal.screenHeightCm / 100;
  const fullscreen = !!document.fullscreenElement;
  if (fullscreen || !followWindow) return rectFrom(-W / 2, W / 2, -H / 2, H / 2);

  const mx = W / screen.width; // metres per CSS pixel
  const my = H / screen.height;
  const border = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  // On multi-monitor setups screenX/Y are relative to the primary display;
  // availLeft/availTop (Chromium) give this display's offset.
  const s = screen as Screen & { availLeft?: number; availTop?: number };
  const left = window.screenX - (s.availLeft ?? 0) + border;
  const top = window.screenY - (s.availTop ?? 0) + Math.max(0, window.outerHeight - window.innerHeight - border);
  const r = el.getBoundingClientRect();
  const x0 = (left + r.left - screen.width / 2) * mx;
  const x1 = (left + r.right - screen.width / 2) * mx;
  const y1 = -(top + r.top - screen.height / 2) * my;
  const y0 = -(top + r.bottom - screen.height / 2) * my;
  return rectFrom(x0, x1, y0, y1);
}

function rectFrom(x0: number, x1: number, y0: number, y1: number): WindowRect {
  return {
    pa: new THREE.Vector3(x0, y0, 0),
    pb: new THREE.Vector3(x1, y0, 0),
    pc: new THREE.Vector3(x0, y1, 0),
  };
}

/** Diagonal size in inches + aspect ratio -> visible width/height in cm. */
export function panelSizeCm(diagonalIn: number, aspectW: number, aspectH: number): { w: number; h: number } {
  const diagCm = diagonalIn * 2.54;
  const k = diagCm / Math.hypot(aspectW, aspectH);
  return { w: +(aspectW * k).toFixed(1), h: +(aspectH * k).toFixed(1) };
}
