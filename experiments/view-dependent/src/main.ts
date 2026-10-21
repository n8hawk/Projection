import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import { applyOffAxis } from './core/offAxis';
import { canvasWindowRect, panelSizeCm } from './core/screenWindow';
import { EyeFilter } from './core/eyeFilter';
import { WebcamTracker } from './core/webcamTracker';
import { MouseTracker } from './core/mouseTracker';
import type { Vec3, ViewerTracker } from './core/types';
import { DemoScene, type SceneLayout } from './demo/scene';
import { defaultSettings, loadSettings, saveSettings, type DemoSettings, type TrackerMode } from './demo/settings';
import { PanelBuilder, h } from './demo/ui';
import './styles.css';

const settings: DemoSettings = loadSettings();
const app = document.getElementById('app')!;

// ---- Rendering ----------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b0c0e');
scene.add(new SparkRenderer({ renderer }));
const camera = new THREE.PerspectiveCamera();

const layout = (): SceneLayout => ({
  width: settings.calibration.screenWidthCm / 100,
  height: settings.calibration.screenHeightCm / 100,
  depth: settings.roomDepthCm / 100,
});
const world = new DemoScene(layout());
world.showRoom = settings.showRoom;
world.placement = settings.placement;
scene.add(world.root);

// ---- Tracking ----------------------------------------------------------
const calibration = () => settings.calibration;
const webcam = new WebcamTracker({ calibration });
const mouse = new MouseTracker(calibration);
let tracker: ViewerTracker = mouse;
const filter = new EyeFilter(settings.filter);
const REST: Vec3 = { x: 0, y: 0, z: 0.6 };
let status = '';

async function setMode(mode: TrackerMode): Promise<void> {
  tracker.stop();
  filter.reset();
  settings.mode = mode;
  saveSettings(settings);
  if (mode === 'mouse') {
    tracker = mouse;
    await mouse.start();
    status = 'Mouse: move to look around, scroll to lean in or out.';
    return;
  }
  status = 'Starting camera and face model…';
  try {
    await webcam.start();
    tracker = webcam;
    status = '';
  } catch (err) {
    status = `Webcam tracking unavailable (${describe(err)}). Using the mouse instead.`;
    settings.mode = 'mouse';
    tracker = mouse;
    await mouse.start();
    panel.refresh();
  }
}

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'camera permission denied';
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'no camera found';
  if (err instanceof Error) return err.message;
  // A failed <script>/fetch for the MediaPipe runtime rejects with a bare Event.
  if (err instanceof Event) return 'could not download the face-tracking model';
  return String(err);
}

// ---- Panel --------------------------------------------------------------
const panelEl = h('aside', 'panel');
document.body.append(panelEl);
const panel = new PanelBuilder(panelEl, () => {
  world.setLayout(layout());
  world.showRoom = settings.showRoom;
  saveSettings(settings);
});

panelEl.append(h('h1', undefined, 'View-dependent demo'));

const trk = panel.section('Tracking');
panel.select(trk, 'Source', [['webcam', 'Webcam (face)'], ['mouse', 'Mouse']], {
  get: () => settings.mode,
  set: (v) => { void setMode(v); },
});
const preview = h('canvas', 'preview');
preview.width = 320; preview.height = 180;
trk.append(preview);
const readout = h('pre', 'readout');
trk.append(readout);

const scr = panel.section('Screen');
const PRESETS: [string, string, number, number, number][] = [
  ['13.3-1610', '13.3" 16:10', 13.3, 16, 10],
  ['14-1610', '14" 16:10', 14, 16, 10],
  ['15.6-169', '15.6" 16:9', 15.6, 16, 9],
  ['16-1610', '16" 16:10', 16, 16, 10],
  ['17.3-169', '17.3" 16:9', 17.3, 16, 9],
];
panel.select(scr, 'Preset', [['custom', 'Custom'], ...PRESETS.map(([k, t]) => [k, t] as [string, string])], {
  get: () => {
    const c = settings.calibration;
    const hit = PRESETS.find(([, , d, a, b]) => { const s = panelSizeCm(d, a, b); return s.w === c.screenWidthCm && s.h === c.screenHeightCm; });
    return hit ? hit[0] : 'custom';
  },
  set: (k) => {
    const p = PRESETS.find(([key]) => key === k);
    if (!p) return;
    const s = panelSizeCm(p[2], p[3], p[4]);
    settings.calibration.screenWidthCm = s.w;
    settings.calibration.screenHeightCm = s.h;
    settings.calibration.camYCm = +(s.h / 2 + 0.7).toFixed(1);
    panel.refresh();
  },
});
panel.number(scr, 'Width', { step: 0.1, unit: 'cm', get: () => settings.calibration.screenWidthCm, set: (v) => { settings.calibration.screenWidthCm = v; } });
panel.number(scr, 'Height', { step: 0.1, unit: 'cm', get: () => settings.calibration.screenHeightCm, set: (v) => { settings.calibration.screenHeightCm = v; } });
panel.toggle(scr, 'Follow window position when not fullscreen', { get: () => settings.followWindow, set: (v) => { settings.followWindow = v; } });
panel.note(scr, 'Measure the lit area of the panel, not the bezel. Fullscreen (F) gives the most accurate result.');

const cam = panel.section('Webcam');
panel.number(cam, 'Offset X', { step: 0.1, unit: 'cm', get: () => settings.calibration.camXCm, set: (v) => { settings.calibration.camXCm = v; } });
panel.number(cam, 'Offset Y', { step: 0.1, unit: 'cm', get: () => settings.calibration.camYCm, set: (v) => { settings.calibration.camYCm = v; } });
panel.number(cam, 'Offset Z', { step: 0.1, unit: 'cm', get: () => settings.calibration.camZCm, set: (v) => { settings.calibration.camZCm = v; } });
panel.slider(cam, 'Field of view', { min: 40, max: 110, step: 0.5, unit: '°', get: () => settings.calibration.camHfovDeg, set: (v) => { settings.calibration.camHfovDeg = v; } });
panel.number(cam, 'Your IPD', { step: 0.5, unit: 'mm', get: () => settings.calibration.ipdMm, set: (v) => { settings.calibration.ipdMm = v; } });
panel.toggle(cam, 'Mirror left/right', { get: () => settings.calibration.mirrorX, set: (v) => { settings.calibration.mirrorX = v; } });
panel.toggle(cam, 'Correct depth for head turn', { get: () => settings.calibration.yawCorrect, set: (v) => { settings.calibration.yawCorrect = v; } });
panel.note(cam, 'Offsets are from the centre of the screen to the webcam lens. Then sit square to the screen at a measured distance and press Calibrate FOV (or C).');
panel.number(cam, 'Your distance', { step: 1, unit: 'cm', get: () => settings.calibDistanceCm, set: (v) => { settings.calibDistanceCm = v; } });
panel.buttons(cam, [['Calibrate FOV', calibrateFov]]);

function calibrateFov(): void {
  const fov = webcam.fovFromDistance(settings.calibDistanceCm);
  if (fov === null) { status = 'Calibration needs the webcam to see your face.'; return; }
  settings.calibration.camHfovDeg = +fov.toFixed(1);
  status = `Field of view set to ${fov.toFixed(1)}°.`;
  panel.refresh();
  saveSettings(settings);
}

const mot = panel.section('Motion');
panel.slider(mot, 'Smoothing', { min: 0, max: 1, step: 0.01, digits: 2, get: () => settings.filter.smoothing, set: (v) => { settings.filter.smoothing = v; } });
panel.slider(mot, 'Responsiveness', { min: 0, max: 10, step: 0.1, get: () => settings.filter.responsiveness, set: (v) => { settings.filter.responsiveness = v; } });
panel.slider(mot, 'Prediction', { min: 0, max: 120, step: 1, digits: 0, unit: ' ms', get: () => settings.filter.predictMs, set: (v) => { settings.filter.predictMs = v; } });
panel.slider(mot, 'Parallax gain', { min: 0.5, max: 3, step: 0.05, digits: 2, unit: '×', get: () => settings.gain, set: (v) => { settings.gain = v; } });
panel.note(mot, 'Gain 1× is physically correct. Higher values exaggerate the effect for a camera or for onlookers.');

const scn = panel.section('Scene');
panel.toggle(scn, 'Show room grid', { get: () => settings.showRoom, set: (v) => { settings.showRoom = v; } });
panel.slider(scn, 'Room depth', { min: 10, max: 120, step: 1, digits: 0, unit: ' cm', get: () => settings.roomDepthCm, set: (v) => { settings.roomDepthCm = v; } });
panel.text(scn, { placeholder: 'https://…/scene.spz', get: () => settings.splatUrl, set: (v) => { settings.splatUrl = v; } });
const fileInput = h('input');
fileInput.type = 'file';
fileInput.accept = '.ply,.spz,.splat,.ksplat,.sog,.zip';
fileInput.hidden = true;
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) void loadSplat(f); fileInput.value = ''; });
scn.append(fileInput);
panel.buttons(scn, [
  ['Load URL', () => void loadSplat(settings.splatUrl)],
  ['Open file…', () => fileInput.click()],
  ['Built-in', () => { world.showLoaded = false; }],
]);
panel.note(scn, 'Or drop a .ply / .spz / .splat / .ksplat / .sog file anywhere on the page.');
panel.slider(scn, 'Splat scale', { min: 0.1, max: 4, step: 0.05, digits: 2, unit: '×', get: () => settings.placement.scale, set: (v) => { settings.placement.scale = v; } });
panel.slider(scn, 'Splat depth', { min: -60, max: 20, step: 0.5, unit: ' cm', get: () => settings.placement.zOffset * 100, set: (v) => { settings.placement.zOffset = v / 100; } });
panel.slider(scn, 'Splat turn', { min: -180, max: 180, step: 1, digits: 0, unit: '°', get: () => settings.placement.yawDeg, set: (v) => { settings.placement.yawDeg = v; } });
panel.toggle(scn, 'Flip upright', { get: () => settings.placement.flip, set: (v) => { settings.placement.flip = v; } });

panel.buttons(panelEl, [
  ['Fullscreen (F)', toggleFullscreen],
  ['Reset all', () => {
    const d = defaultSettings();
    Object.assign(settings.calibration, d.calibration);
    Object.assign(settings.filter, d.filter);
    Object.assign(settings.placement, d.placement);
    settings.gain = d.gain; settings.followWindow = d.followWindow;
    settings.roomDepthCm = d.roomDepthCm; settings.showRoom = d.showRoom;
    settings.calibDistanceCm = d.calibDistanceCm; settings.splatUrl = d.splatUrl;
    panel.refresh();
    world.setLayout(layout());
    world.showRoom = settings.showRoom;
    saveSettings(settings);
  }],
]);
panel.note(panelEl, 'H hides this panel · M switches webcam/mouse · C calibrates FOV');

async function loadSplat(src: string | File): Promise<void> {
  status = `Loading ${typeof src === 'string' ? src : src.name}…`;
  try {
    await world.loadSplat(src);
    status = '';
  } catch (err) {
    status = `Couldn't load splat: ${describe(err)}`;
  }
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => { status = 'Fullscreen is blocked here.'; });
}

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'h') panelEl.classList.toggle('hidden');
  else if (k === 'f') toggleFullscreen();
  else if (k === 'm') { void setMode(settings.mode === 'webcam' ? 'mouse' : 'webcam').then(() => panel.refresh()); }
  else if (k === 'c') calibrateFov();
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f) void loadSplat(f);
});

// ---- Frame loop --------------------------------------------------------
const pctx = preview.getContext('2d')!;
let hudT = 0;

function resize(): void {
  const w = app.clientWidth, hgt = app.clientHeight;
  const c = renderer.domElement;
  if (c.width !== Math.round(w * renderer.getPixelRatio()) || c.height !== Math.round(hgt * renderer.getPixelRatio())) {
    renderer.setSize(w, hgt, true);
  }
}

renderer.setAnimationLoop((t) => {
  resize();
  const now = performance.now();
  const sample = tracker.latest();
  const est = filter.update(sample, now) ?? REST;
  const eye = { x: est.x * settings.gain, y: est.y * settings.gain, z: est.z };
  applyOffAxis(camera, canvasWindowRect(settings.calibration, renderer.domElement, settings.followWindow), eye, 0.005, 50);
  world.tick(t / 1000);
  renderer.render(scene, camera);

  if (now - hudT > 100) {
    hudT = now;
    drawPreview();
    const lines = [
      `eye  x ${(eye.x * 100).toFixed(1).padStart(6)} cm`,
      `     y ${(eye.y * 100).toFixed(1).padStart(6)} cm`,
      `     z ${(eye.z * 100).toFixed(1).padStart(6)} cm`,
    ];
    if (tracker === webcam) {
      lines.push(`face ${sample ? 'tracked' : 'not found'} · ${webcam.fps.toFixed(0)} fps`);
      if (webcam.measurement) lines.push(`yaw  ${(webcam.measurement.yaw * 180 / Math.PI).toFixed(0)}°`);
    }
    if (status) lines.push('', status);
    readout.textContent = lines.join('\n');
  }
});

function drawPreview(): void {
  const v = webcam.video;
  const W = preview.width, H = preview.height;
  pctx.fillStyle = '#18191B';
  pctx.fillRect(0, 0, W, H);
  preview.style.display = tracker === webcam ? '' : 'none';
  if (tracker !== webcam || v.readyState < 2) return;
  // Draw as a mirror so moving right moves right.
  pctx.save();
  pctx.translate(W, 0);
  pctx.scale(-1, 1);
  pctx.globalAlpha = 0.7;
  pctx.drawImage(v, 0, 0, W, H);
  pctx.globalAlpha = 1;
  const m = webcam.measurement;
  if (m) {
    pctx.fillStyle = '#90ECFF';
    for (let i = 0; i < m.landmarks.length; i += 6) {
      const p = m.landmarks[i];
      pctx.fillRect(p.x * W - 0.5, p.y * H - 0.5, 1.5, 1.5);
    }
    pctx.fillStyle = '#62D289';
    for (const [i, j] of [[33, 133], [263, 362]]) {
      const p = m.landmarks[i], q = m.landmarks[j];
      pctx.beginPath(); pctx.arc(((p.x + q.x) / 2) * W, ((p.y + q.y) / 2) * H, 3, 0, Math.PI * 2); pctx.fill();
    }
  }
  pctx.restore();
}

void setMode(settings.mode).then(() => panel.refresh());
