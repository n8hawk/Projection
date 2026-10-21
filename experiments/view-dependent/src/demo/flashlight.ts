import * as THREE from 'three';
import { SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType } from '@sparkjsdev/spark';
import type { AimRay } from '../core/aim';

export interface FlashlightSettings {
  enabled: boolean;
  /** Beam half-angle, degrees. */
  angleDeg: number;
  /** Width of the beam's soft edge, metres. */
  softness: number;
  /** How much of the scene stays visible outside the beam, 0..1. */
  ambient: number;
  /** Distance at which the beam has faded to half, metres. */
  reach: number;
}

// Mild ambient light keeps the room readable; a narrow beam shows where it points.
export const DEFAULT_FLASHLIGHT: FlashlightSettings = { enabled: false, angleDeg: 5, softness: 0.02, ambient: 0.3, reach: 0.6 };

const WARM = new THREE.Color(1.55, 1.42, 1.2);

/**
 * A torch for splat scenes. Splats aren't lit by three.js lights, so this
 * uses Spark's SDF colour edits instead, applied in order:
 *  1. darken everything outside a cone from the hand (soft edge),
 *  2. darken with distance from the hand (depth falloff),
 *  3. warm, brighter hotspot in the middle of the beam.
 * The edits sit at the top of the scene, so they affect every splat mesh.
 */
export class Flashlight {
  readonly group = new THREE.Group();
  private darkSdf = new SplatEditSdf({ type: SplatEditSdfType.INFINITE_CONE });
  private falloffSdf = new SplatEditSdf({ type: SplatEditSdfType.SPHERE });
  private hotSdf = new SplatEditSdf({ type: SplatEditSdfType.INFINITE_CONE });
  private dark = new SplatEdit({ name: 'flashlight-dark', rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, invert: true });
  private falloff = new SplatEdit({ name: 'flashlight-falloff', rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, invert: true });
  private hot = new SplatEdit({ name: 'flashlight-hotspot', rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY });
  private target = new THREE.Vector3();

  constructor(public settings: FlashlightSettings) {
    this.dark.add(this.darkSdf);
    this.falloff.add(this.falloffSdf);
    this.hot.add(this.hotSdf);
    this.group.add(this.dark, this.falloff, this.hot);
  }

  update(ray: AimRay): void {
    const s = this.settings;
    // The edits stay in the scene and turn neutral (multiply by 1) when off:
    // adding or removing them would make Spark rebuild every splat mesh.
    if (!s.enabled) {
      for (const sdf of [this.darkSdf, this.falloffSdf, this.hotSdf]) sdf.color.setScalar(1);
      return;
    }

    // Spark's cone opens along the SDF's local -z with half-angle radius × 45°.
    // Object3D.lookAt turns +z toward the target, so look away from the beam.
    this.target.copy(ray.origin).sub(ray.dir);
    for (const sdf of [this.darkSdf, this.hotSdf, this.falloffSdf]) {
      sdf.position.copy(ray.origin);
      sdf.lookAt(this.target);
    }
    this.darkSdf.radius = s.angleDeg / 45;
    this.darkSdf.color.setScalar(s.ambient);
    this.dark.softEdge = s.softness;

    this.falloffSdf.radius = s.reach;
    // Gentle depth falloff: never darker than the ambient light, or than half.
    this.falloffSdf.color.setScalar(Math.max(s.ambient, 0.5));
    this.falloff.softEdge = s.reach;

    this.hotSdf.radius = (s.angleDeg * 0.35) / 45;
    this.hotSdf.color.copy(WARM);
    this.hot.softEdge = s.softness * 2;
  }
}
