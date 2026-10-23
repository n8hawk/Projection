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
  /** Where the controller is held, cm in screen space (see `AimOrigin`
   *  'port'): left/right of the screen centre, up/down, and out from the glass. */
  portXCm: number;
  portYCm: number;
  portZCm: number;
  /** Gyro gain when firing from the port. 1 is a true laser pointer: shots
   *  land exactly where the controller points. */
  portGain: number;
  /**
   * Where the port is taken to be. The gyro only reports how the controller
   * turns, never where it is, so this is a choice:
   *  - 'screen': a muzzle just behind the glass at the bottom middle of the
   *    screen. Recentring means "straight ahead", so the beam runs level
   *    into the scene like a laser pointer held at the window.
   *  - 'hand': the measured spot where you hold it (portX/Y/ZCm). True to
   *    the room, but from below the screen every shot climbs up into the scene.
   */
  muzzleAt: 'screen' | 'hand';
  /** Screen muzzle height, as a fraction of the screen height from its bottom edge. */
  muzzleHeight: number;
}

export const DEFAULT_AIM: AimSettings = {
  gyroGain: 1.5, stickSpeed: 90, invertYaw: false, invertPitch: false, smoothing: 0.4,
  portXCm: 0, portYCm: -18, portZCm: 35, portGain: 1,
  muzzleAt: 'screen', muzzleHeight: 0.12,
};

/** The screen muzzle sits this far behind the glass, metres. */
const MUZZLE_BEHIND = 0.01;

/**
 * Where the aim ray starts:
 *  - 'hand': a little below the eye, following the head (torch).
 *  - 'eye': down the sights, so the crosshair is what's hit (gallery).
 *  - 'port': the controller's USB port, at a fixed spot in front of the
 *    screen. The ray is the controller's own pointing line, so head movement
 *    never changes where a shot goes. Recentring means "I'm pointing at the
 *    middle of the screen".
 */
export type AimOrigin = 'hand' | 'eye' | 'port';

/** The USB port sits on the controller's front edge, above its centre. */
const PORT_FORWARD = 0.05;
const PORT_UP = 0.015;

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
  /** See `AimOrigin`. From the hand, the hit point's place on screen leaps
   *  whenever the depth it lands at changes. */
  origin: AimOrigin = 'hand';

  private mouseNdc: { x: number; y: number } | null = null;
  private mouseDown = false;
  private mouseAt = -Infinity;
  private mouseX: number | null = null;
  private mouseY = 0;
  private mouseTravel = 0;
  private padAt = -Infinity;
  private tmp = new THREE.Vector3();
  private base = new THREE.Quaternion();
  /** The controller's turn since recentring, integrated in its own frame so
   *  a tilted or rolled grip still turns the aim the way the hand turns. */
  private orient = new THREE.Quaternion();
  private dq = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private up = new THREE.Vector3();
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

  /**
   * The pointer's line of sight from the eye, for scenes that find what's
   * under the cursor themselves (then aim the port at it). Null when the
   * mouse isn't the one aiming.
   */
  pointerRay(eye: Vec3, rect: WindowRect, out: THREE.Vector3): THREE.Vector3 | null {
    if (this.ray.source !== 'mouse' || !this.mouseNdc) return null;
    const { pa, pb, pc } = rect;
    out.copy(pa)
      .addScaledVector(pb.clone().sub(pa), this.mouseNdc.x)
      .addScaledVector(pc.clone().sub(pa), 1 - this.mouseNdc.y);
    return out.sub(new THREE.Vector3(eye.x, eye.y, eye.z)).normalize();
  }

  /** Point straight into the screen again (also fixes gyro drift). */
  recenter(): void {
    this.yaw = 0; this.pitch = 0;
    this.orient.identity();
    this.yawFilter.reset(); this.pitchFilter.reset();
    // A recentre is a controller action: the controller has the aim now.
    this.padAt = performance.now();
    this.mouseTravel = 0;
  }

  /** Yaw/pitch (degrees) of the controller's pointing line from `orient`. */
  private anglesFromOrient(): void {
    const f = this.tmp.set(0, 0, -1).applyQuaternion(this.orient);
    this.yaw = THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z));
    this.pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)));
  }

  /** Rebuild `orient` from yaw/pitch (drops roll). */
  private orientFromAngles(): void {
    this.orient.setFromEuler(this.euler.set(THREE.MathUtils.degToRad(this.pitch), -THREE.MathUtils.degToRad(this.yaw), 0, 'YXZ'));
  }

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

    const port = this.origin === 'port';
    if (gyro?.connected) {
      const d = gyro.takeDelta();
      const gain = port ? s.portGain : s.gyroGain;
      // Turning the controller left is a positive rotation about its up axis.
      // Gyro axes match ours: x right (pitch up), y up (turn left), z toward
      // you (roll). Turn by the small rotation in the controller's own frame.
      const r = THREE.MathUtils.degToRad(gain);
      const v = this.tmp.set(sp * d.pitch * r, sy * d.yaw * r, d.roll * r);
      const ang = v.length();
      if (ang > 1e-7) {
        this.orient.multiply(this.dq.setFromAxisAngle(v.divideScalar(ang), ang)).normalize();
        this.anglesFromOrient();
      }
      if (Math.abs(d.yaw) + Math.abs(d.pitch) > 0.05) { this.padAt = now; this.mouseTravel = 0; source = 'gyro'; }
    }
    const rx = pad.axis(2), ry = pad.axis(3);
    if (rx || ry) {
      this.yaw += sy * rx * s.stickSpeed * dt;
      this.pitch -= sp * ry * s.stickSpeed * dt;
      this.orientFromAngles();
      this.padAt = now;
      this.mouseTravel = 0;
      if (!gyro?.connected) source = 'stick';
    }
    if (pad.edge(PS.r3) || pad.edge(PS.touchpad)) this.recenter();
    if (Math.abs(this.yaw) > MAX_YAW || Math.abs(this.pitch) > MAX_PITCH) {
      this.yaw = THREE.MathUtils.clamp(this.yaw, -MAX_YAW, MAX_YAW);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -MAX_PITCH, MAX_PITCH);
      this.orientFromAngles();
    }

    const hand = this.ray.origin.set(eye.x, eye.y, eye.z);
    const screenMuzzle = port && s.muzzleAt === 'screen';
    if (screenMuzzle) {
      // Bottom middle of the screen, just behind the glass; yaw 0 / pitch 0
      // is straight into the scene.
      const { pa, pb, pc } = rect;
      hand.addVectors(pa, pb).multiplyScalar(0.5).addScaledVector(this.tmp.subVectors(pc, pa), s.muzzleHeight);
      hand.z -= MUZZLE_BEHIND;
      this.base.identity();
    } else if (port) {
      // Yaw 0 / pitch 0 points from the controller at the middle of the screen.
      hand.set(s.portXCm / 100, s.portYCm / 100, s.portZCm / 100);
      this.base.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.tmp.copy(hand).negate().normalize());
    } else if (this.origin === 'hand') hand.add(HAND_OFFSET);
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
      const local = this.tmp.copy(this.ray.dir);
      if (port) local.applyQuaternion(this.base.clone().invert());
      this.yaw = THREE.MathUtils.radToDeg(Math.atan2(local.x, -local.z));
      this.pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(local.y, -1, 1)));
      this.orientFromAngles();
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
      if (port && !screenMuzzle) {
        this.ray.dir.applyQuaternion(this.base);
        // From the controller's centre out to the port, which turns with it.
        this.up.set(0, 1, 0).applyQuaternion(this.orient).applyQuaternion(this.base);
        hand.addScaledVector(this.ray.dir, PORT_FORWARD).addScaledVector(this.up, PORT_UP);
      }
      if (source === 'mouse' || source === 'none') source = pad.pad ? 'stick' : 'none';
    }
    this.ray.source = source;
    this.ray.trigger = Math.max(pad.pad?.buttons[PS.r2]?.value ?? 0, this.mouseDown ? 1 : 0);
    return this.ray;
  }
}
