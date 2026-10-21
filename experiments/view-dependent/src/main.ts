import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import { applyOffAxis } from './core/offAxis';
import { canvasWindowRect, panelSizeCm } from './core/screenWindow';
import { EyeFilter } from './core/eyeFilter';
import { WebcamTracker } from './core/webcamTracker';
import { MouseTracker } from './core/mouseTracker';
import type { Vec3, ViewerTracker } from './core/types';
import { PadReader, PS } from './core/gamepad';
import { DualSenseGyro } from './core/dualsenseHid';
import { AimController } from './core/aim';
import { Flashlight } from './demo/flashlight';
import { DemoScene, type SceneLayout } from './demo/scene';
import { SAMPLE_SPLAT, defaultPlacement, defaultSettings, loadSettings, saveSettings, type DemoSettings, type TrackerMode } from './demo/settings';
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

// ---- Interaction: aim ray + flashlight ---------------------------------
const pad = new PadReader();
const gyro = DualSenseGyro.supported ? new DualSenseGyro() : null;
void gyro?.reconnect().catch(() => { /* not granted yet */ });
const aim = new AimController(settings.aim, renderer.domElement);
const flashlight = new Flashlight(settings.flashlight);
scene.add(flashlight.group);
const DARK = new THREE.Color('#010102');
const NORMAL_BG = new THREE.Color('#0b0c0e');
const aimDot = new THREE.Mesh(
  new THREE.RingGeometry(0.0025, 0.0045, 24),
  new THREE.MeshBasicMaterial({ color: '#90ECFF', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }),
);
aimDot.renderOrder = 10;
aimDot.visible = false;
scene.add(aimDot);
const raycaster = new THREE.Raycaster();
let rayT = 0;

function setFlashlight(on: boolean): void {
  settings.flashlight.enabled = on;
  saveSettings(settings);
  panel.refresh();
}

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
  settings.placements[settings.scene] = { ...settings.placement };
  saveSettings(settings);
});

const header = h('div', 'panel-head');
header.append(h('h1', undefined, 'View-dependent demo'));
const hideBtn = h('button', 'icon', 'Hide');
hideBtn.type = 'button';
hideBtn.title = 'Hide the panel (H)';
header.append(hideBtn);
panelEl.append(header);
const showBtn = h('button', 'show-panel', 'Settings');
showBtn.type = 'button';
showBtn.title = 'Show the panel (H)';
document.body.append(showBtn);
function setPanelHidden(hidden: boolean): void {
  panelEl.classList.toggle('hidden', hidden);
  showBtn.classList.toggle('visible', hidden);
}
hideBtn.addEventListener('click', () => setPanelHidden(true));
showBtn.addEventListener('click', () => setPanelHidden(false));

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

// Calibration is set once per machine, so it starts folded away.
const scr = panel.section('Calibration: screen', false);
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

const cam = panel.section('Calibration: webcam', false);
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
// Scenes: the built-in targets, Spark's sample, every capture in
// public/splats (listed by the dev server), then a custom URL or file.
const BASE_SCENES: [string, string][] = [['builtin', 'Built-in targets'], ['sample', 'Butterfly (Spark sample)']];
let library: string[] = [];
const sceneSelect = panel.select(scn, 'Scene', BASE_SCENES, {
  get: () => settings.scene,
  set: (v) => { void selectScene(v); },
});
panel.note(scn, '[ and ] step through scenes. Add your own by dropping files into public/splats and reloading.');
panel.text(scn, { placeholder: 'https://…/scene.spz', get: () => settings.splatUrl, set: (v) => { settings.splatUrl = v; } });
const fileInput = h('input');
fileInput.type = 'file';
fileInput.accept = '.ply,.spz,.splat,.ksplat,.sog,.zip';
fileInput.hidden = true;
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) void selectScene('file', f); fileInput.value = ''; });
scn.append(fileInput);
panel.buttons(scn, [
  ['Load URL', () => void selectScene('url')],
  ['Open file…', () => fileInput.click()],
]);
panel.note(scn, 'Or drop a .ply / .spz / .splat / .ksplat / .sog file anywhere on the page.');
panel.slider(scn, 'Splat scale', { min: 0.1, max: 4, step: 0.05, digits: 2, unit: '×', get: () => settings.placement.scale, set: (v) => { settings.placement.scale = v; } });
panel.slider(scn, 'Splat depth', { min: -60, max: 20, step: 0.5, unit: ' cm', get: () => settings.placement.zOffset * 100, set: (v) => { settings.placement.zOffset = v / 100; } });
panel.slider(scn, 'Splat turn', { min: -180, max: 180, step: 1, digits: 0, unit: '°', get: () => settings.placement.yawDeg, set: (v) => { settings.placement.yawDeg = v; } });
panel.toggle(scn, 'Flip upright', { get: () => settings.placement.flip, set: (v) => { settings.placement.flip = v; } });

const fl = panel.section('Flashlight');
panel.toggle(fl, 'Flashlight mode (L)', { get: () => settings.flashlight.enabled, set: (v) => { settings.flashlight.enabled = v; } });
const padStatus = h('pre', 'readout');
fl.append(padStatus);
const flButtons: [string, () => void][] = [['Recenter aim (R)', () => aim.recenter()]];
if (gyro) flButtons.unshift(['Connect PS5 gyro', () => {
  gyro.connect().then((ok) => { status = ok ? 'PS5 motion connected. Hold it still for a second.' : ''; })
    .catch((err) => { status = `Couldn't open the controller: ${describe(err)}`; });
}]);
panel.buttons(fl, flButtons);
panel.note(fl, gyro
  ? 'Connect PS5 gyro to aim by pointing the controller (Chrome/Edge). Without it, the right stick or the mouse aims.'
  : 'This browser has no WebHID, so aim with the right stick or the mouse (use Chrome or Edge for the gyro).');
panel.slider(fl, 'Beam angle', { min: 4, max: 40, step: 0.5, unit: '°', get: () => settings.flashlight.angleDeg, set: (v) => { settings.flashlight.angleDeg = v; } });
panel.slider(fl, 'Soft edge', { min: 0, max: 10, step: 0.1, unit: ' cm', get: () => settings.flashlight.softness * 100, set: (v) => { settings.flashlight.softness = v / 100; } });
panel.slider(fl, 'Reach', { min: 10, max: 150, step: 1, digits: 0, unit: ' cm', get: () => settings.flashlight.reach * 100, set: (v) => { settings.flashlight.reach = v / 100; } });
panel.slider(fl, 'Darkness', { min: 0, max: 1, step: 0.01, digits: 2, get: () => 1 - settings.flashlight.ambient, set: (v) => { settings.flashlight.ambient = 1 - v; } });
panel.toggle(fl, 'Show aim dot', { get: () => settings.showAimDot, set: (v) => { settings.showAimDot = v; } });
panel.slider(fl, 'Gyro gain', { min: 0.5, max: 4, step: 0.1, unit: '×', get: () => settings.aim.gyroGain, set: (v) => { settings.aim.gyroGain = v; } });
panel.slider(fl, 'Stick speed', { min: 20, max: 240, step: 5, digits: 0, unit: '°/s', get: () => settings.aim.stickSpeed, set: (v) => { settings.aim.stickSpeed = v; } });
panel.toggle(fl, 'Invert left/right aim', { get: () => settings.aim.invertYaw, set: (v) => { settings.aim.invertYaw = v; } });
panel.toggle(fl, 'Invert up/down aim', { get: () => settings.aim.invertPitch, set: (v) => { settings.aim.invertPitch = v; } });
panel.note(fl, 'Controller: △ flashlight on/off · L1/R1 narrower/wider · R3 or touchpad recentre · D-pad ◁ ▷ change scene. In mouse head mode, hold Shift to move your head while the mouse aims.');

panel.buttons(panelEl, [
  ['Fullscreen (F)', toggleFullscreen],
  ['Reset all', () => {
    const d = defaultSettings();
    Object.assign(settings.calibration, d.calibration);
    Object.assign(settings.filter, d.filter);
    Object.assign(settings.placement, d.placement);
    settings.placements = {};
    settings.gain = d.gain; settings.followWindow = d.followWindow;
    settings.roomDepthCm = d.roomDepthCm; settings.showRoom = d.showRoom;
    settings.calibDistanceCm = d.calibDistanceCm; settings.splatUrl = d.splatUrl;
    panel.refresh();
    world.setLayout(layout());
    world.showRoom = settings.showRoom;
    saveSettings(settings);
  }],
]);
panel.note(panelEl, 'H hides this panel · [ ] change scene · L flashlight · R recentre aim · M switches webcam/mouse · C calibrates FOV');

/** "garden_v2.splat" -> "Garden v2" */
function sceneName(file: string): string {
  const s = file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sceneOptions(): [string, string][] {
  const opts: [string, string][] = [...BASE_SCENES, ...library.map((f) => [`lib:${f}`, sceneName(f)] as [string, string])];
  opts.push(['url', 'Custom URL']);
  if (settings.scene === 'file') opts.push(['file', 'Opened file']);
  return opts;
}

function fillSceneSelect(): void {
  sceneSelect.replaceChildren(...sceneOptions().map(([v, text]) => { const op = h('option', undefined, text); op.value = v; return op; }));
  sceneSelect.value = settings.scene;
}

async function loadLibrary(): Promise<void> {
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'splats/index.json');
    if (res.ok) library = (await res.json()) as string[];
  } catch { /* no library on this host */ }
  fillSceneSelect();
}

let sceneLoad = 0;

/** Switch scenes, restoring that scene's own placement. */
async function selectScene(id: string, file?: File): Promise<void> {
  if (id === 'file' && !file) id = 'builtin';
  settings.scene = id;
  Object.assign(settings.placement, defaultPlacement(), settings.placements[id]);
  fillSceneSelect();
  panel.refresh();
  saveSettings(settings);

  const src = file ?? (id === 'sample' ? SAMPLE_SPLAT
    : id === 'url' ? settings.splatUrl
    : id.startsWith('lib:') ? `${import.meta.env.BASE_URL}splats/${encodeURIComponent(id.slice(4))}`
    : null);
  const ticket = ++sceneLoad;
  if (!src) { world.showBuiltIn(); status = ''; return; }
  status = `Loading ${typeof src === 'string' ? src : src.name}…`;
  try {
    await world.loadSplat(src);
    // A newer pick may have landed first; it wins.
    if (ticket !== sceneLoad) return;
    status = '';
  } catch (err) {
    if (ticket === sceneLoad) status = `Couldn't load splat: ${describe(err)}`;
  }
}

function stepScene(dir: 1 | -1): void {
  const ids = sceneOptions().map(([v]) => v).filter((v) => v !== 'url' && v !== 'file');
  const i = ids.indexOf(settings.scene);
  void selectScene(ids[(i + dir + ids.length) % ids.length]);
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => { status = 'Fullscreen is blocked here.'; });
}

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'h') setPanelHidden(!panelEl.classList.contains('hidden'));
  else if (k === 'f') toggleFullscreen();
  else if (k === 'm') { void setMode(settings.mode === 'webcam' ? 'mouse' : 'webcam').then(() => panel.refresh()); }
  else if (k === 'c') calibrateFov();
  else if (k === 'l') setFlashlight(!settings.flashlight.enabled);
  else if (k === 'r') aim.recenter();
  else if (e.key === ']') stepScene(1);
  else if (e.key === '[') stepScene(-1);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f) void selectScene('file', f);
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
  updateInteraction(now, eye);
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
    padStatus.textContent = [
      `controller  ${pad.name ?? 'none (press a button)'}`,
      `ps5 gyro    ${gyro?.connected ? 'connected' : gyro ? 'not connected' : 'needs Chrome/Edge'}`,
      `aiming with ${aim.ray.source === 'none' ? '—' : aim.ray.source}`,
    ].join('\n');
  }
});

let lastFrame = performance.now();

function updateInteraction(now: number, eye: Vec3): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  pad.poll();
  if (pad.edge(PS.triangle)) setFlashlight(!settings.flashlight.enabled);
  if (pad.edge(PS.l1) || pad.edge(PS.r1)) {
    const f = settings.flashlight;
    f.angleDeg = THREE.MathUtils.clamp(f.angleDeg * (pad.edge(PS.r1) ? 1.25 : 0.8), 4, 40);
    saveSettings(settings);
    panel.refresh();
  }
  if (pad.edge(PS.right)) stepScene(1);
  if (pad.edge(PS.left)) stepScene(-1);

  const on = settings.flashlight.enabled;
  mouse.requireShift = on;
  world.litRoom = on;
  scene.background = on ? DARK : NORMAL_BG;
  const rect = canvasWindowRect(settings.calibration, renderer.domElement, settings.followWindow);
  const ray = aim.update(dt, eye, rect, pad, gyro, settings.roomDepthCm / 200);
  flashlight.update(ray);

  // Where the ray lands: the aim dot now, spray/shots later. Splat hit
  // tests run on the CPU, so a few times a second is plenty.
  const wantDot = on && settings.showAimDot && ray.source !== 'none';
  if (!wantDot) { aimDot.visible = false; return; }
  if (now - rayT > 80) {
    rayT = now;
    raycaster.set(ray.origin, ray.dir);
    raycaster.near = 0.05;
    const hit = raycaster.intersectObjects(world.raycastTargets, true).find((i) => !(i.object instanceof THREE.LineSegments));
    aimDot.visible = !!hit;
    if (hit) {
      aimDot.position.copy(hit.point);
      aimDot.lookAt(ray.origin);
    }
  }
}

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
// Reopen the last scene, unless its file has since been removed.
void loadLibrary().then(() => {
  const gone = settings.scene.startsWith('lib:') && !library.includes(settings.scene.slice(4));
  return selectScene(gone ? 'builtin' : settings.scene);
});

// Handles for poking at the scene from the browser console while developing.
if (import.meta.env.DEV) Object.assign(window, { vd: { world, flashlight, scene, aim, settings } });
