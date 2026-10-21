// Shared types for view-dependent rendering. Everything here is engine-agnostic
// so the hub app can later import `core/` as a "Viewer" input source.

/** A 3D point in "screen space": metres, origin at the physical centre of the
 *  display, +x to the viewer's right, +y up, +z out of the glass toward the viewer. */
export interface Vec3 { x: number; y: number; z: number }

/** One eye-point sample (the midpoint between the eyes). */
export interface EyeSample {
  pos: Vec3;
  /** performance.now() time of the camera frame the sample came from. */
  time: number;
}

/** Anything that can tell us where the viewer's eyes are. Webcam, mouse,
 *  and later a depth-camera bridge all implement this. */
export interface ViewerTracker {
  readonly kind: string;
  start(): Promise<void>;
  stop(): void;
  /** Newest raw (unfiltered) sample, or null if the viewer is not visible. */
  latest(): EyeSample | null;
}

export interface Calibration {
  /** Visible display area, cm. */
  screenWidthCm: number;
  screenHeightCm: number;
  /** Webcam lens position relative to the screen centre, cm (screen space). */
  camXCm: number;
  camYCm: number;
  camZCm: number;
  /** Webcam horizontal field of view, degrees. */
  camHfovDeg: number;
  /** Viewer's interpupillary distance, mm. */
  ipdMm: number;
  /** Flip left/right if the camera driver already mirrors the image. */
  mirrorX: boolean;
  /** Undo the shrinking of the measured IPD when the head turns. */
  yawCorrect: boolean;
}

export const DEFAULT_CALIBRATION: Calibration = {
  // 16" 16:10 laptop panel (e.g. Alienware m16 R2), webcam centred above it
  screenWidthCm: 34.5,
  screenHeightCm: 21.5,
  camXCm: 0,
  camYCm: 11.5,
  camZCm: 0,
  camHfovDeg: 72.5, // m16 R2 1080p webcam: 80.2° diagonal
  ipdMm: 63,
  mirrorX: false,
  yawCorrect: true,
};
