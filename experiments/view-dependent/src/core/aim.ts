import * as THREE from 'three';
import type { Vec3 } from './types';
import type { WindowRect } from './offAxis';
import { PS, type PadReader } from './gamepad';
import { OneEuro } from './oneEuro';
import type { DualSenseGyro } from './dualsenseHid';

// A reusable "aim ray" for interaction experiments (flashlight now; spray
// paint, shooting, grabbing later). Sources, most recently used wins:
//  - DualSense gyro over WebHID (point the controller),
//  - the right stick on any controller,
//  - the mouse (a ray through the pointer, as seen from the eye).

export type AimSource = 'gyro' | 'stick' | 'mouse' | 'none';

export interface AimRay {
  origin: THREE.Vector3;
  /** Unit direction, screen space (metres, +z toward the viewer). */
  dir: THREE.Vector3;
  source: AimSource;
  /** R2 pressure, 0..1 (left mouse button counts as 1). */
  trigger: number;
}

export interface AimSettings {
  /** Degrees of aim per degree of controller turn. */
  gyroGain: number;
  /** Stick aim speed at full tilt, degrees per second. */
  stickSpeed: number;
  invertYaw: boolean;
  invertPitch: boolean;
  /** Controller aim smoothing, 0 (raw) to 1 (heavy). Steadies small hand
   *  tremor while fast sweeps stay quick. */
  smoothing: number;
}

export const DEFAULT_AIM: AimSettings = { gyroGain: 1.5, stickSpeed: 90, invertYaw: false, invertPitch: false, smoothing: 0.4 };

/** Where the hand is relative to the eye: a bit below and in front. */
const HAND_OFFSET = new THREE.Vector3(0, -0.22, -0.1);
const MAX_YAW = 80;
const MAX_PITCH = 70;
/** Pointer travel that takes the aim from a controller in use (a deliberate
 *  move), and the travel that counts as motion at all. */
const MOUSE_TAKEOVER_PX = 40;
const MOUSE_MOVE_PX = 4;
/** A controller counts as in use for this long after it last moved the aim. */
const PAD_HOLD_MS = 2000;

export class AimController {
  /** Degrees; 0/0 points straight into the screen. */
  yaw = 0;
  pitch = 0;
  readonly ray: AimRay = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), source: 'none', trigger: 0 };
  /** Aim from the eye, like down a gun's sights, so whatever is under the
   *  crosshair is what's hit at any depth (shooting). Otherwise every source
   *  aims from the hand (torch). From the hand, the hit point's place on
   *  screen leaps whenever the depth it lands at changes. */
  fromEye = false;

  private mouseNdc: { x: number; y: number } | null = null;
  private mouseDown = false;
  private mouseAt = -Infinity;
  private mouseX: number | null = null;
  private mouseY = 0;
  private mouseTravel = 0;
  private padAt = -Infinity;
  private tmp = new THREE.Vector3();
  private yawFilter = new OneEuro();
  private pitchFilter = new OneEuro();

  constructor(public settings: AimSettings, private el: HTMLElement) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouseNdc = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      // Chrome also sends pointermove while the pointer sits still (when the
      // layout or cursor under it changes), and a hand resting on a touchpad
      // nudges it. Only deliberate motion takes the aim from a controller in
      // use; otherwise the aim flicks between the gyro and the cursor.
      const now = performance.now();
      if (this.mouseX !== null) this.mouseTravel += Math.hypot(e.clientX - this.mouseX, e.clientY - this.mouseY);
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      const needed = now - this.padAt < PAD_HOLD_MS ? MOUSE_TAKEOVER_PX : MOUSE_MOVE_PX;
      if (this.mouseTravel < needed) return;
      this.mouseTravel = 0;
      this.mouseAt = now;
    });
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) this.mouseDown = true; });
    window.addEventListener('pointerup', () => { this.mouseDown = false; });
  }

  /** Point straight into the screen again (also fixes gyro drift). */
  recenter(): void { this.yaw = 0; this.pitch = 0; this.yawFilter.reset(); this.pitchFilter.reset(); }

  /**
   * @param depth how far behind the glass the mouse ray should meet the
   *   pointer, so the beam lands under the cursor around the scene's middle.
   */
  update(dt: number, eye: Vec3, rect: WindowRect, pad: PadReader, gyro: DualSenseGyro | null, depth: number): AimRay {
    const s = this.settings;
    const now = performance.now();
    const sy = s.invertYaw ? -1 : 1;
    const sp = s.invertPitch ? -1 : 1;
    let source: AimSource = this.ray.source;

    if (gyro?.connected) {
      const d = gyro.takeDelta();
      // Turning the controller left is a positive rotation about its up axis.
      this.yaw -= sy * d.yaw * s.gyroGain;
      this.pitch += sp * d.pitch * s.gyroGain;
      if (Math.abs(d.yaw) + Math.abs(d.pitch) > 0.05) { this.padAt = now; this.mouseTravel = 0; source = 'gyro'; }
    }
    const rx = pad.axis(2), ry = pad.axis(3);
    if (rx || ry) {
      this.yaw += sy * rx * s.stickSpeed * dt;
      this.pitch -= sp * ry * s.stickSpeed * dt;
      this.padAt = now;
      this.mouseTravel = 0;
      if (!gyro?.connected) source = 'stick';
    }
    if (pad.edge(PS.r3) || pad.edge(PS.touchpad)) this.recenter();
    this.yaw = THREE.MathUtils.clamp(this.yaw, -MAX_YAW, MAX_YAW);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -MAX_PITCH, MAX_PITCH);

    const hand = this.ray.origin.set(eye.x, eye.y, eye.z);
    if (!this.fromEye) hand.add(HAND_OFFSET);
    if (this.mouseNdc && this.mouseAt > this.padAt) {
      // Through the pointer's spot on the glass, from the eye, out to `depth`.
      const { pa, pb, pc } = rect;
      const onGlass = this.tmp.copy(pa)
        .addScaledVector(pb.clone().sub(pa), this.mouseNdc.x)
        .addScaledVector(pc.clone().sub(pa), 1 - this.mouseNdc.y);
      const t = (eye.z + depth) / Math.max(1e-3, eye.z);
      const target = new THREE.Vector3(eye.x, eye.y, eye.z).lerp(onGlass, t);
      this.ray.dir.subVectors(target, hand).normalize();
      // Keep the angles in step so a controller picks up where the mouse left off.
      this.yaw = THREE.MathUtils.radToDeg(Math.atan2(this.ray.dir.x, -this.ray.dir.z));
      this.pitch = THREE.MathUtils.radToDeg(Math.asin(this.ray.dir.y));
      source = 'mouse';
      // Start the controller smoothing fresh from wherever the mouse left it.
      this.yawFilter.reset();
      this.pitchFilter.reset();
    } else {
      // One Euro: strong smoothing when nearly still, little when sweeping.
      let yaw = this.yaw, pitch = this.pitch;
      if (s.smoothing > 0) {
        for (const f of [this.yawFilter, this.pitchFilter]) {
          f.minCutoff = THREE.MathUtils.lerp(10, 0.5, s.smoothing);
          f.beta = 0.04;
        }
        yaw = this.yawFilter.filter(yaw, now);
        pitch = this.pitchFilter.filter(pitch, now);
      }
      const y = THREE.MathUtils.degToRad(yaw), p = THREE.MathUtils.degToRad(pitch);
      this.ray.dir.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
      if (source === 'mouse' || source === 'none') source = pad.pad ? 'stick' : 'none';
    }
    this.ray.source = source;
    this.ray.trigger = Math.max(pad.pad?.buttons[PS.r2]?.value ?? 0, this.mouseDown ? 1 : 0);
    return this.ray;
  }
}
