import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Calibration, EyeSample, ViewerTracker } from './types';

// Served locally so tracking works offline (see vite.config.ts). Pass the CDN
// copies as wasmUrl / modelUrl on hosts that can't serve the local files.
const local = (path: string) => new URL(import.meta.env.BASE_URL + path, location.href).href;
export const MEDIAPIPE_WASM = local('mediapipe');
export const FACE_MODEL = local('models/face_landmarker.task');
export const MEDIAPIPE_WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
export const FACE_MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Face-mesh landmark indices.
const IRIS_A = 468;
const IRIS_B = 473;
const EYE_OUTER_A = 33;
const EYE_OUTER_B = 263;

/** What the camera saw on the last frame, before conversion to metres. */
export interface FaceMeasurement {
  /** Eye midpoint, normalized image coords (0..1). */
  mid: { x: number; y: number };
  /** Distance between the iris centres in pixels, yaw-corrected if enabled. */
  ipdPx: number;
  /** Estimated head yaw, radians. */
  yaw: number;
  videoWidth: number;
  videoHeight: number;
  landmarks: NormalizedLandmark[];
}

export interface WebcamTrackerOptions {
  wasmUrl?: string;
  modelUrl?: string;
  /** Read on every frame, so calibration edits apply live. */
  calibration: () => Calibration;
}

/** Single-webcam eye tracker built on MediaPipe Face Landmarker. */
export class WebcamTracker implements ViewerTracker {
  readonly kind = 'webcam';
  readonly video: HTMLVideoElement;
  measurement: FaceMeasurement | null = null;
  fps = 0;

  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private sample: EyeSample | null = null;
  private lastSeen = 0;
  private running = false;
  private lastVideoTime = -1;
  private frames = 0;
  private fpsT0 = 0;

  constructor(private opts: WebcamTrackerOptions) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    if (!this.landmarker) {
      const files = await FilesetResolver.forVisionTasks(this.opts.wasmUrl ?? MEDIAPIPE_WASM);
      const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: this.opts.modelUrl ?? FACE_MODEL, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      try { this.landmarker = await make('GPU'); } catch { this.landmarker = await make('CPU'); }
    }
    this.running = true;
    this.fpsT0 = performance.now();
    this.loop();
  }

  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.sample = null;
    this.measurement = null;
  }

  latest(): EyeSample | null {
    // Drop the viewer if we haven't seen a face for half a second.
    if (this.sample && performance.now() - this.lastSeen > 500) return null;
    return this.sample;
  }

  /** Solve the camera's horizontal FOV from a known eye-to-camera distance. */
  fovFromDistance(distanceCm: number): number | null {
    const m = this.measurement;
    if (!m) return null;
    const cal = this.opts.calibration();
    const f = (distanceCm * 10 * m.ipdPx) / cal.ipdMm;
    return (2 * Math.atan(m.videoWidth / 2 / f) * 180) / Math.PI;
  }

  private loop = (): void => {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(this.loop);
    else requestAnimationFrame(this.loop);
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime || !this.landmarker) return;
    this.lastVideoTime = v.currentTime;

    const now = performance.now();
    const res = this.landmarker.detectForVideo(v, now);
    this.frames++;
    if (now - this.fpsT0 > 1000) { this.fps = (this.frames * 1000) / (now - this.fpsT0); this.frames = 0; this.fpsT0 = now; }

    const lm = res.faceLandmarks[0];
    if (!lm || lm.length <= IRIS_B) { this.measurement = null; return; }
    this.measurement = this.measure(lm, v.videoWidth, v.videoHeight);
    // Stamp with the frame time (for prediction); track liveness separately
    // since detection itself can take a while on slow machines.
    this.sample = { pos: this.toScreenSpace(this.measurement), time: now };
    this.lastSeen = performance.now();
  };

  private measure(lm: NormalizedLandmark[], vw: number, vh: number): FaceMeasurement {
    const a = lm[IRIS_A], b = lm[IRIS_B];
    const oa = lm[EYE_OUTER_A], ob = lm[EYE_OUTER_B];
    // Landmark z is in roughly the same units as x, so the eye-corner line
    // gives a usable yaw estimate without the full transform matrix.
    const yaw = Math.atan2((ob.z - oa.z) * vw, (ob.x - oa.x) * vw);
    let ipdPx = Math.hypot((b.x - a.x) * vw, (b.y - a.y) * vh);
    if (this.opts.calibration().yawCorrect) ipdPx /= Math.max(0.5, Math.cos(yaw));
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ipdPx, yaw, videoWidth: vw, videoHeight: vh, landmarks: lm };
  }

  private toScreenSpace(m: FaceMeasurement) {
    const cal = this.opts.calibration();
    const f = m.videoWidth / 2 / Math.tan((cal.camHfovDeg * Math.PI) / 360);
    const z = (f * (cal.ipdMm / 1000)) / m.ipdPx; // metres from the camera
    const xc = ((m.mid.x - 0.5) * m.videoWidth * z) / f;
    const yc = ((m.mid.y - 0.5) * m.videoHeight * z) / f;
    // The camera faces the viewer, so image-right is the viewer's left.
    return {
      x: cal.camXCm / 100 + (cal.mirrorX ? xc : -xc),
      y: cal.camYCm / 100 - yc,
      z: cal.camZCm / 100 + z,
    };
  }
}
