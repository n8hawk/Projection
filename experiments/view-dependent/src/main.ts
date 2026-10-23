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
import { CarnivalGallery } from './demo/gallery/gallery';
import { SAMPLE_SPLAT, defaultPlacement, defaultSettings, loadSettings, saveSettings, type DemoSettings, type DemoType, type TrackerMode } from './demo/settings';
import { PanelBuilder, h } from './demo/ui';
import './styles.css';

const settings: DemoSettings = loadSettings();
const app = document.getElementById('app')!;

// ---- Rendering ----------------------------------------------------------
// Antialiasing costs a little with splats but the booth's edges need it.
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
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
const gallery = new CarnivalGallery(renderer);
gallery.root.visible = false;
scene.add(gallery.root);

// ---- Interaction: aim ray + flashlight ---------------------------------
const pad = new PadReader();
const gyro = DualSenseGyro.supported ? new DualSenseGyro() : null;
void gyro?.reconnect().catch(() => { /* not granted yet */ });
const aim = new AimController(settings.aim, renderer.domElement);
const flashlight = new Flashlight(settings.flashlight);
scene.add(flashlight.group);
const DARK = new THREE.Color('#010102');
const NORMAL_BG = new THREE.Color('#0b0c0e');
const NIGHT = new THREE.Color('#06050c');
// Ring where the aim ray lands; the centre dot shows in the gallery.
const aimDot = new THREE.Group();
const ringMat = new THREE.MeshBasicMaterial({ color: '#90ECFF', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
const pipMat = ringMat.clone();
const pip = new THREE.Mesh(new THREE.CircleGeometry(0.0007, 12), pipMat);
aimDot.add(new THREE.Mesh(new THREE.RingGeometry(0.0025, 0.0045, 32), ringMat), pip);
aimDot.traverse((o) => { o.renderOrder = 10; });
aimDot.visible = false;
scene.add(aimDot);
const ON_TARGET = new THREE.Color('#FF5A4E');
const CYAN_UI = new THREE.Color('#90ECFF');

// Score card over the scene in the gallery.
const hud = h('div', 'hud');
document.body.append(hud);
const aimHit = new THREE.Vector3();

/** L / △: between the window and flashlight demos. */
function toggleFlashlight(): void {
  if (settings.demo !== 'gallery') setDemo(settings.demo === 'flashlight' ? 'window' : 'flashlight');
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
  if (settings.scene === 'carnival') gallery.build(layout().width, layout().height);
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

// ---- Top: what to do, and where ----
const DEMOS: [DemoType, string, string][] = [
  ['window', 'Window', 'Move your head and the screen behaves like a pane of glass into the scene.'],
  ['flashlight', 'Flashlight', 'The scene goes dark; light it with a torch from your hand (PS5 gyro, right stick or mouse).'],
  ['gallery', 'Shooting gallery', 'A carnival booth. Aim with the gyro, stick or mouse; R2, ✕, click or Space fires. Lean and duck to find hidden targets.'],
];
const top = h('div', 'top');
panelEl.append(top);
const demoRow = h('label', 'row big');
const demoSelect = h('select');
for (const [v, name] of DEMOS) { const op = h('option', undefined, name); op.value = v; demoSelect.append(op); }
demoSelect.addEventListener('change', () => setDemo(demoSelect.value as DemoType));
demoRow.append(h('span', 'name', 'Demo'), demoSelect);
const sceneRow = h('label', 'row big');
const sceneSelect = h('select');
sceneSelect.addEventListener('change', () => void selectScene(sceneSelect.value));
sceneRow.append(h('span', 'name', 'Scene'), sceneSelect);
const demoNote = h('p', 'note');
const statusEl = h('p', 'status');
top.append(demoRow, sceneRow, demoNote, statusEl);
panel.buttons(top, [['Fullscreen (F)', toggleFullscreen]]);
panel.onRefresh(() => {
  demoSelect.value = settings.demo;
  demoNote.textContent = DEMOS.find(([v]) => v === settings.demo)![2];
  // The gallery is built for the booth, so it keeps that scene.
  sceneSelect.disabled = settings.demo === 'gallery';
  sceneSelect.title = sceneSelect.disabled ? 'The shooting gallery has its own booth' : '';
  updateSections();
});

// ---- Per-demo options ----
const flSec = panel.section('Flashlight', true, () => {
  const d = defaultSettings();
  Object.assign(settings.flashlight, d.flashlight, { enabled: settings.flashlight.enabled });
  settings.showAimDot = d.showAimDot;
});
panel.slider(flSec, 'Beam angle', { min: 2, max: 40, step: 0.5, unit: '°', get: () => settings.flashlight.angleDeg, set: (v) => { settings.flashlight.angleDeg = v; } });
panel.slider(flSec, 'Soft edge', { min: 0, max: 10, step: 0.1, unit: ' cm', get: () => settings.flashlight.softness * 100, set: (v) => { settings.flashlight.softness = v / 100; } });
panel.slider(flSec, 'Reach', { min: 10, max: 150, step: 1, digits: 0, unit: ' cm', get: () => settings.flashlight.reach * 100, set: (v) => { settings.flashlight.reach = v / 100; } });
panel.slider(flSec, 'Darkness', { min: 0, max: 1, step: 0.01, digits: 2, get: () => 1 - settings.flashlight.ambient, set: (v) => { settings.flashlight.ambient = 1 - v; } });
panel.toggle(flSec, 'Show aim dot', { get: () => settings.showAimDot, set: (v) => { settings.showAimDot = v; } });
panel.note(flSec, 'L1 / R1 narrow or widen the beam. In the carnival booth the torch is a real spotlight with shadows.');

const galSec = panel.section('Shooting gallery', true, () => { Object.assign(settings.gallery, defaultSettings().gallery); });
const scoreEl = h('pre', 'readout score');
galSec.append(scoreEl);
panel.buttons(galSec, [['Reset score (0)', () => gallery.resetScore()]]);
panel.toggle(galSec, 'Sound', { get: () => settings.gallery.sound, set: (v) => { settings.gallery.sound = v; } });
panel.toggle(galSec, 'Controller rumble', { get: () => settings.gallery.rumble, set: (v) => { settings.gallery.rumble = v; } });
panel.toggle(galSec, 'Show crosshair', { get: () => settings.gallery.crosshair, set: (v) => { settings.gallery.crosshair = v; } });
panel.note(galSec, 'Ducks 10 · bottles 15 · floating targets 25 · hidden targets 50. Two hide behind the barrels (lean sideways) and one behind the awning (duck down). Options or 0 resets the score.');

// ---- Scene options ----
const scn = panel.section('Scene options', true, () => {
  const d = defaultSettings();
  Object.assign(settings.placement, d.placement);
  settings.roomDepthCm = d.roomDepthCm; settings.showRoom = d.showRoom;
});
const roomOpts = h('div');
scn.append(roomOpts);
panel.toggle(roomOpts, 'Show room grid', { get: () => settings.showRoom, set: (v) => { settings.showRoom = v; } });
panel.slider(roomOpts, 'Room depth', { min: 10, max: 120, step: 1, digits: 0, unit: ' cm', get: () => settings.roomDepthCm, set: (v) => { settings.roomDepthCm = v; } });
const splatOpts = h('div');
scn.append(splatOpts);
panel.slider(splatOpts, 'Splat scale', { min: 0.1, max: 4, step: 0.05, digits: 2, unit: '×', get: () => settings.placement.scale, set: (v) => { settings.placement.scale = v; } });
panel.slider(splatOpts, 'Splat depth', { min: -60, max: 20, step: 0.5, unit: ' cm', get: () => settings.placement.zOffset * 100, set: (v) => { settings.placement.zOffset = v / 100; } });
panel.slider(splatOpts, 'Splat turn', { min: -180, max: 180, step: 1, digits: 0, unit: '°', get: () => settings.placement.yawDeg, set: (v) => { settings.placement.yawDeg = v; } });
panel.toggle(splatOpts, 'Flip upright', { get: () => settings.placement.flip, set: (v) => { settings.placement.flip = v; } });
panel.note(splatOpts, 'Placement is remembered per capture.');
panel.subhead(splatOpts, 'Load a capture');
panel.text(splatOpts, { placeholder: 'https://…/scene.spz', get: () => settings.splatUrl, set: (v) => { settings.splatUrl = v; } });
const fileInput = h('input');
fileInput.type = 'file';
fileInput.accept = '.ply,.spz,.splat,.ksplat,.sog,.zip';
fileInput.hidden = true;
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) void selectScene('file', f); fileInput.value = ''; });
splatOpts.append(fileInput);
panel.buttons(splatOpts, [
  ['Load URL', () => void selectScene('url')],
  ['Open file…', () => fileInput.click()],
]);
panel.note(splatOpts, 'Or drop a .ply / .spz / .splat / .ksplat / .sog file on the page, or into public/splats and reload to add it to the list.');
const carnivalNote = panel.note(scn, 'A fully modelled booth sized to your screen: the counter and awning sit at the glass, the ducks, barrels and bottles in the middle, and the painted backdrop half a metre back.');

// ---- Tracking ----
const trk = panel.section('Tracking', true, () => {
  const d = defaultSettings();
  Object.assign(settings.filter, d.filter);
  settings.gain = d.gain;
});
panel.select(trk, 'Source', [['webcam', 'Webcam (face)'], ['mouse', 'Mouse']], {
  get: () => settings.mode,
  set: (v) => { void setMode(v); },
});
const trackLine = h('p', 'note');
trk.append(trackLine);
panel.slider(trk, 'Smoothing', { min: 0, max: 1, step: 0.01, digits: 2, get: () => settings.filter.smoothing, set: (v) => { settings.filter.smoothing = v; } });
panel.slider(trk, 'Responsiveness', { min: 0, max: 10, step: 0.1, get: () => settings.filter.responsiveness, set: (v) => { settings.filter.responsiveness = v; } });
panel.slider(trk, 'Prediction', { min: 0, max: 120, step: 1, digits: 0, unit: ' ms', get: () => settings.filter.predictMs, set: (v) => { settings.filter.predictMs = v; } });
panel.slider(trk, 'Parallax gain', { min: 0.5, max: 3, step: 0.05, digits: 2, unit: '×', get: () => settings.gain, set: (v) => { settings.gain = v; } });
panel.note(trk, 'Gain 1× is physically correct. Higher values exaggerate the effect for a camera or for onlookers.');

// ---- Controller ----
const ctl = panel.section('Controller', true, () => { Object.assign(settings.aim, defaultSettings().aim); });
const padStatus = h('pre', 'readout');
ctl.append(padStatus);
const ctlButtons: [string, () => void][] = [['Recenter aim (R)', () => aim.recenter()]];
if (gyro) ctlButtons.unshift(['Connect PS5 gyro', () => {
  gyro.connect().then((ok) => { status = ok ? 'PS5 motion connected. Hold it still for a second.' : ''; })
    .catch((err) => { status = `Couldn't open the controller: ${describe(err)}`; });
}]);
panel.buttons(ctl, ctlButtons);
panel.note(ctl, gyro
  ? 'Connect PS5 gyro to aim by pointing the controller (Chrome/Edge). Without it, the right stick or the mouse aims.'
  : 'This browser has no WebHID, so aim with the right stick or the mouse (use Chrome or Edge for the gyro).');
panel.slider(ctl, 'Gyro gain', { min: 0.5, max: 4, step: 0.1, unit: '×', get: () => settings.aim.gyroGain, set: (v) => { settings.aim.gyroGain = v; } });
panel.slider(ctl, 'Stick speed', { min: 20, max: 240, step: 5, digits: 0, unit: '°/s', get: () => settings.aim.stickSpeed, set: (v) => { settings.aim.stickSpeed = v; } });
panel.toggle(ctl, 'Invert left/right aim', { get: () => settings.aim.invertYaw, set: (v) => { settings.aim.invertYaw = v; } });
panel.toggle(ctl, 'Invert up/down aim', { get: () => settings.aim.invertPitch, set: (v) => { settings.aim.invertPitch = v; } });
panel.note(ctl, 'R2 or ✕ fire · △ flashlight on/off · D-pad ▲ ▼ change demo, ◀ ▶ change scene · R3 or touchpad recentre · Options resets the score. In mouse head mode, hold Shift to move your head while the mouse aims.');

// ---- Display: set once per machine, so folded away ----
const disp = panel.section('Display', false, () => { Object.assign(settings.calibration, defaultSettings().calibration); });
panel.subhead(disp, 'Screen');
const PRESETS: [string, string, number, number, number][] = [
  ['13.3-1610', '13.3" 16:10', 13.3, 16, 10],
  ['14-1610', '14" 16:10', 14, 16, 10],
  ['15.6-169', '15.6" 16:9', 15.6, 16, 9],
  ['16-1610', '16" 16:10', 16, 16, 10],
  ['17.3-169', '17.3" 16:9', 17.3, 16, 9],
];
panel.select(disp, 'Preset', [['custom', 'Custom'], ...PRESETS.map(([k, t]) => [k, t] as [string, string])], {
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
panel.number(disp, 'Width', { step: 0.1, unit: 'cm', get: () => settings.calibration.screenWidthCm, set: (v) => { settings.calibration.screenWidthCm = v; } });
panel.number(disp, 'Height', { step: 0.1, unit: 'cm', get: () => settings.calibration.screenHeightCm, set: (v) => { settings.calibration.screenHeightCm = v; } });
panel.toggle(disp, 'Follow window position when not fullscreen', { get: () => settings.followWindow, set: (v) => { settings.followWindow = v; } });
panel.note(disp, 'Measure the lit area of the panel, not the bezel. Fullscreen (F) gives the most accurate result.');
panel.subhead(disp, 'Webcam');
panel.number(disp, 'Offset X', { step: 0.1, unit: 'cm', get: () => settings.calibration.camXCm, set: (v) => { settings.calibration.camXCm = v; } });
panel.number(disp, 'Offset Y', { step: 0.1, unit: 'cm', get: () => settings.calibration.camYCm, set: (v) => { settings.calibration.camYCm = v; } });
panel.number(disp, 'Offset Z', { step: 0.1, unit: 'cm', get: () => settings.calibration.camZCm, set: (v) => { settings.calibration.camZCm = v; } });
panel.slider(disp, 'Field of view', { min: 40, max: 110, step: 0.5, unit: '°', get: () => settings.calibration.camHfovDeg, set: (v) => { settings.calibration.camHfovDeg = v; } });
panel.number(disp, 'Your IPD', { step: 0.5, unit: 'mm', get: () => settings.calibration.ipdMm, set: (v) => { settings.calibration.ipdMm = v; } });
panel.toggle(disp, 'Mirror left/right', { get: () => settings.calibration.mirrorX, set: (v) => { settings.calibration.mirrorX = v; } });
panel.toggle(disp, 'Correct depth for head turn', { get: () => settings.calibration.yawCorrect, set: (v) => { settings.calibration.yawCorrect = v; } });
panel.note(disp, 'Offsets are from the centre of the screen to the webcam lens. Then sit square to the screen at a measured distance and press Calibrate FOV (or C).');
panel.number(disp, 'Your distance', { step: 1, unit: 'cm', get: () => settings.calibDistanceCm, set: (v) => { settings.calibDistanceCm = v; } });
panel.buttons(disp, [['Calibrate FOV', calibrateFov]]);

function calibrateFov(): void {
  const fov = webcam.fovFromDistance(settings.calibDistanceCm);
  if (fov === null) { status = 'Calibration needs the webcam to see your face.'; return; }
  settings.calibration.camHfovDeg = +fov.toFixed(1);
  status = `Field of view set to ${fov.toFixed(1)}°.`;
  panel.refresh();
  saveSettings(settings);
}

// ---- Advanced: debug overlays ----
const adv = panel.section('Advanced', false);
const preview = h('canvas', 'preview');
preview.width = 320; preview.height = 180;
adv.append(preview);
const readout = h('pre', 'readout');
adv.append(readout);
panel.buttons(adv, [['Reset everything', () => {
  const d = defaultSettings();
  Object.assign(settings.calibration, d.calibration);
  Object.assign(settings.filter, d.filter);
  Object.assign(settings.placement, d.placement);
  Object.assign(settings.flashlight, d.flashlight, { enabled: settings.flashlight.enabled });
  Object.assign(settings.aim, d.aim);
  Object.assign(settings.gallery, d.gallery);
  settings.placements = {};
  settings.gain = d.gain; settings.followWindow = d.followWindow;
  settings.roomDepthCm = d.roomDepthCm; settings.showRoom = d.showRoom;
  settings.calibDistanceCm = d.calibDistanceCm; settings.splatUrl = d.splatUrl;
  settings.showAimDot = d.showAimDot;
  panel.refresh();
  world.setLayout(layout());
  world.showRoom = settings.showRoom;
  saveSettings(settings);
}]]);
panel.note(panelEl, 'Keys: 1 2 3 demo · [ ] scene · H panel · F fullscreen · Space fire · 0 reset score · L flashlight · R recentre · M webcam/mouse · C calibrate');
panel.refresh();

/** Show only the options that apply to this demo and scene. */
function updateSections(): void {
  const sc = settings.scene;
  const carnival = sc === 'carnival';
  const splat = sc === 'sample' || sc === 'url' || sc === 'file' || sc.startsWith('lib:');
  flSec.hidden = settings.demo !== 'flashlight';
  galSec.hidden = settings.demo !== 'gallery';
  roomOpts.hidden = carnival;
  splatOpts.hidden = !splat;
  carnivalNote.hidden = !carnival;
}

function setDemo(d: DemoType): void {
  settings.demo = d;
  settings.flashlight.enabled = d === 'flashlight';
  if (d === 'gallery' && settings.scene !== 'carnival') void selectScene('carnival');
  saveSettings(settings);
  panel.refresh();
}

function stepDemo(dir: 1 | -1): void {
  const i = DEMOS.findIndex(([v]) => v === settings.demo);
  setDemo(DEMOS[(i + dir + DEMOS.length) % DEMOS.length][0]);
}

/** "garden_v2.splat" -> "Garden v2" */
function sceneName(file: string): string {
  const s = file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

let library: string[] = [];
const SCENE_GROUPS = (): [string, [string, string][]][] => [
  ['3D rooms', [['carnival', 'Carnival booth'], ['builtin', 'Grid room + splat targets']]],
  ['Splat captures', [
    ['sample', 'Butterfly (Spark sample)'],
    ...library.map((f) => [`lib:${f}`, sceneName(f)] as [string, string]),
    ['url', 'Custom URL'],
    ...(settings.scene === 'file' ? [['file', 'Opened file'] as [string, string]] : []),
  ]],
  ['Blank', [['blank', 'Empty grid room']]],
];

function sceneOptions(): [string, string][] {
  return SCENE_GROUPS().flatMap(([, opts]) => opts);
}

function fillSceneSelect(): void {
  sceneSelect.replaceChildren(...SCENE_GROUPS().map(([label, opts]) => {
    const g = h('optgroup');
    g.label = label;
    g.append(...opts.map(([v, text]) => { const op = h('option', undefined, text); op.value = v; return op; }));
    return g;
  }));
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
  // The gallery only works in its booth.
  if (settings.demo === 'gallery') id = 'carnival';
  settings.scene = id;
  Object.assign(settings.placement, defaultPlacement(), settings.placements[id]);
  fillSceneSelect();
  panel.refresh();
  saveSettings(settings);

  const carnival = id === 'carnival';
  if (carnival) gallery.build(layout().width, layout().height);
  gallery.root.visible = carnival;
  world.root.visible = !carnival;
  if (carnival) { world.showBuiltIn(); status = ''; return; }
  if (id === 'blank') { world.showEmpty(); status = ''; return; }

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
  if (settings.demo === 'gallery') return;
  const ids = sceneOptions().map(([v]) => v).filter((v) => v !== 'url' && v !== 'file');
  const i = ids.indexOf(settings.scene);
  void selectScene(ids[(i + dir + ids.length) % ids.length]);
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => { status = 'Fullscreen is blocked here.'; });
}

let fireQueued = false;
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'h') setPanelHidden(!panelEl.classList.contains('hidden'));
  else if (k === 'f') toggleFullscreen();
  else if (k === 'm') { void setMode(settings.mode === 'webcam' ? 'mouse' : 'webcam').then(() => panel.refresh()); }
  else if (k === 'c') calibrateFov();
  else if (k === 'l') toggleFlashlight();
  else if (k === 'r') aim.recenter();
  else if (k === '1' || k === '2' || k === '3') setDemo(DEMOS[+k - 1][0]);
  else if (k === '0') gallery.resetScore();
  else if (k === ' ') { fireQueued = true; e.preventDefault(); }
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
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  updateInteraction(dt, eye);
  if (gallery.root.visible) gallery.update(dt, t / 1000);
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
    readout.textContent = lines.join('\n');
    statusEl.textContent = status;
    statusEl.hidden = !status;
    trackLine.textContent = tracker === webcam
      ? (sample ? `Face tracked · ${webcam.fps.toFixed(0)} fps` : 'Looking for your face…')
      : 'Mouse: move to look around, scroll to lean in or out.';
    padStatus.textContent = [
      `controller  ${pad.name ?? 'none (press a button)'}`,
      `ps5 gyro    ${gyro?.connected ? 'connected' : gyro ? 'not connected' : 'needs Chrome/Edge'}`,
      `aiming with ${aim.ray.source === 'none' ? '—' : aim.ray.source}`,
    ].join('\n');
    const acc = gallery.shots ? Math.round((100 * gallery.hits) / gallery.shots) : 0;
    const card = `SCORE ${gallery.score}\n${gallery.hits} hits · ${gallery.shots} shots · ${acc}%`;
    scoreEl.textContent = card;
    hud.textContent = card;
    hud.hidden = settings.demo !== 'gallery';
  }
});

let lastFrame = performance.now();
let lastTrigger = 0;

function rumble(strong: number, weak: number, ms: number): void {
  if (!settings.gallery.rumble) return;
  if (gyro?.connected) { gyro.rumble(strong, weak, ms); return; }
  if (!pad.pad) return;
  const gp = navigator.getGamepads?.()[pad.pad.index] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
  void gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => { /* unsupported */ });
}

function updateInteraction(dt: number, eye: Vec3): void {
  pad.poll(gyro?.pad ?? null);
  const demo = settings.demo;
  const carnival = settings.scene === 'carnival';
  if (pad.edge(PS.triangle)) toggleFlashlight();
  if (pad.edge(PS.up)) stepDemo(-1);
  if (pad.edge(PS.down)) stepDemo(1);
  if (pad.edge(PS.right)) stepScene(1);
  if (pad.edge(PS.left)) stepScene(-1);
  if (demo === 'flashlight' && (pad.edge(PS.l1) || pad.edge(PS.r1))) {
    const f = settings.flashlight;
    f.angleDeg = THREE.MathUtils.clamp(f.angleDeg * (pad.edge(PS.r1) ? 1.25 : 0.8), 2, 40);
    saveSettings(settings);
    panel.refresh();
  }
  if (demo === 'gallery' && pad.edge(PS.options)) gallery.resetScore();

  const torch = demo === 'flashlight';
  settings.flashlight.enabled = torch && !carnival;
  // The mouse aims in the interactive demos; Shift moves the head instead.
  mouse.requireShift = demo !== 'window';
  aim.fromEye = demo === 'gallery';
  world.litRoom = torch && !carnival;
  scene.background = carnival ? NIGHT : torch ? DARK : NORMAL_BG;
  renderer.toneMapping = carnival ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.1;
  gallery.sfx.muted = !settings.gallery.sound;
  renderer.domElement.style.cursor = demo === 'gallery' && aim.ray.source === 'mouse' ? 'none' : '';

  const rect = canvasWindowRect(settings.calibration, renderer.domElement, settings.followWindow);
  const ray = aim.update(dt, eye, rect, pad, gyro, carnival ? 0.2 : settings.roomDepthCm / 200);
  flashlight.update(ray);
  const f = settings.flashlight;
  gallery.setTorch(torch && carnival && ray.source !== 'none' ? ray : null, f.angleDeg, 0.25 + f.softness * 10, f.ambient);

  // Fire on the trigger's way down, ✕, a click or Space.
  const pulled = ray.trigger > 0.5 && lastTrigger <= 0.5;
  lastTrigger = ray.trigger;
  if (demo === 'gallery' && carnival && (pulled || pad.edge(PS.cross) || fireQueued) && ray.source !== 'none') {
    const shot = gallery.shoot(ray.origin, ray.dir);
    if (shot?.scored) rumble(0.9, 0.7, 140); else rumble(0, 0.35, 45);
  }
  fireQueued = false;

  // Where the ray lands: an analytic or raycast hit every frame keeps the
  // ring glued to the beam.
  const showRing = ray.source !== 'none' && (demo === 'gallery' ? settings.gallery.crosshair : torch && settings.showAimDot);
  let hit: THREE.Vector3 | null = null;
  let live = false;
  if (showRing && carnival) {
    const g = gallery.raycast(ray.origin, ray.dir);
    if (g) { hit = aimHit.copy(g.point); live = !!g.target?.alive; }
  } else if (showRing) {
    hit = world.hitTest(ray.origin, ray.dir, aimHit);
  }
  aimDot.visible = !!hit;
  pip.visible = demo === 'gallery';
  ringMat.color.copy(live ? ON_TARGET : CYAN_UI);
  pipMat.color.copy(ringMat.color);
  if (hit) {
    aimDot.position.copy(hit);
    aimDot.lookAt(ray.origin);
    // Same apparent size near and far.
    aimDot.scale.setScalar(Math.max(0.6, hit.distanceTo(new THREE.Vector3(eye.x, eye.y, eye.z)) / 0.7));
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
if (import.meta.env.DEV) Object.assign(window, { vd: { world, flashlight, scene, aim, settings, gallery, camera, renderer } });
