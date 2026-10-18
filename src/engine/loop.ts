import * as THREE from 'three';
import { Engine } from './Engine';
import { Stage } from './Stage';
import { useStore, now } from '../state/store';
import { openChannel } from '../state/sync';
import { pollGamepad } from './gamepad';

// One WebGL canvas sits behind the whole editor UI. Each preview area in the
// UI registers its element; every frame we render into that element's
// rectangle with a scissor, so all views share one GPU context and one engine.

export type ViewKind = 'stage' | 'projector' | 'output';

interface ViewEntry { el: HTMLElement; kind: ViewKind }

let renderer: THREE.WebGLRenderer | null = null;
let engine: Engine | null = null;
let stage: Stage | null = null;
const views = new Set<ViewEntry>();
const stats = { fps: 0, ms: 0, listeners: new Set<(fps: number, ms: number) => void>() };
export let outputStatus: { fps: number; width: number; height: number; at: number } | null = null;

export function getStage(): Stage {
  if (!stage) throw new Error('render loop not started');
  return stage;
}

export function getEngine(): Engine {
  if (!engine) throw new Error('render loop not started');
  return engine;
}

export function registerView(el: HTMLElement, kind: ViewKind): () => void {
  const entry = { el, kind };
  views.add(entry);
  return () => views.delete(entry);
}

export function onStats(fn: (fps: number, ms: number) => void): () => void {
  stats.listeners.add(fn);
  return () => stats.listeners.delete(fn);
}

export function startLoop(canvas: HTMLCanvasElement): void {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  engine = new Engine(renderer);
  stage = new Stage(engine.output.texture);

  const channel = openChannel((m) => {
    if (m.type === 'hello') {
      const s = useStore.getState();
      channel.post({ type: 'state', show: s.show, transport: s.transport });
      s.setUi({ outputOpen: true });
    } else if (m.type === 'bye') {
      useStore.getState().setUi({ outputOpen: false });
    } else if (m.type === 'output-status') {
      outputStatus = { ...m, at: Date.now() };
    }
  });
  // Push every show or transport change to the output window.
  useStore.subscribe((s, p) => {
    if (s.show !== p.show || s.transport !== p.transport) channel.post({ type: 'state', show: s.show, transport: s.transport });
  });

  let frames = 0;
  let acc = 0;
  let last = performance.now();
  const size = new THREE.Vector2();

  const frame = () => {
    requestAnimationFrame(frame);
    const r = renderer!;
    const t0 = performance.now();
    const dt = (t0 - last) / 1000;
    last = t0;
    pollGamepad(dt);

    const w = window.innerWidth;
    const h = window.innerHeight;
    r.getSize(size);
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);

    const s = useStore.getState();
    engine!.render(s.show, now(), s.transport.playing);
    stage!.sync(s.show.stage, s.ui.tab === 'rehearsal' ? s.ui.selectedBoxId : null);
    const wantsStage = [...views].some((v) => v.kind !== 'output');
    if (wantsStage) stage!.updateShadow(r);

    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.setScissorTest(true);
    for (const v of views) {
      const rect = v.el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.top > h) continue;
      const y = h - rect.bottom;
      r.setViewport(rect.left, y, rect.width, rect.height);
      r.setScissor(rect.left, y, rect.width, rect.height);
      if (v.kind === 'output') {
        engine!.blit(engine!.output.texture);
      } else {
        const view = v.kind === 'projector' ? 'projector' : s.ui.stageView;
        stage!.render(r, view, rect.width / rect.height);
      }
    }
    r.setScissorTest(false);

    frames += 1;
    acc += dt;
    if (acc >= 0.5) {
      stats.fps = Math.round(frames / acc);
      stats.ms = performance.now() - t0;
      stats.listeners.forEach((fn) => fn(stats.fps, stats.ms));
      frames = 0;
      acc = 0;
    }
  };
  requestAnimationFrame(frame);
}
