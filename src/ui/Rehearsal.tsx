import { useCallback, useRef } from 'react';
import { useStore, type StageView } from '../state/store';
import { getStage } from '../engine/loop';
import { Fit16x9, Viewport } from './Viewport';
import { SourcesPanel } from './SourcesPanel';
import { Timeline } from './Timeline';
import { BoxCard, ClipCard, EffectRack, ProjectorCard } from './Properties';
import { autoMap } from '../model/ops';
import { uid } from '../model/time';
import { toast } from './hooks';

export function runAutoMap(): void {
  let result = { added: 0, updated: 0, removed: 0 };
  useStore.getState().update((d) => { result = autoMap(d); });
  useStore.getState().setUi({ mapStale: false });
  toast(`Auto-map: ${result.updated} faces re-pinned, ${result.added} new, ${result.removed} removed`);
}

const VIEWS: { id: StageView; label: string }[] = [
  { id: 'audience', label: 'AUDIENCE' },
  { id: 'top', label: 'TOP' },
  { id: 'projector', label: 'PROJECTOR POV' },
];

/** 3D rehearsal view: orbit with the mouse, click a box to select it, drag it to move it across the floor. */
export function StageView3D() {
  const view = useStore((s) => s.ui.stageView);
  const stale = useStore((s) => s.ui.mapStale);
  const proj = useStore((s) => s.show.stage.projector);
  const boxes = useStore((s) => s.show.stage.boxes.length);
  const { setUi, update } = useStore.getState();
  const cleanup = useRef<(() => void) | null>(null);

  const onEl = useCallback((el: HTMLDivElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const stage = getStage();
    stage.attachControls(el);
    const ndc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1] as const;
    };
    let drag: { id: string; dx: number; dz: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      // Overlay buttons: keep OrbitControls from capturing the pointer, or their click never lands.
      if ((e.target as HTMLElement).closest('button')) { e.stopPropagation(); return; }
      const v = useStore.getState().ui.stageView;
      stage.setControlsEnabled(v === 'audience');
      const [x, y] = ndc(e);
      const id = stage.pick(x, y, v);
      if (!id) return;
      const s = useStore.getState();
      s.setUi({ selectedBoxId: id });
      const box = s.show.stage.boxes.find((b) => b.id === id)!;
      const p = stage.floorPoint(x, y, v);
      if (!p) return;
      stage.setControlsEnabled(false);
      s.checkpoint();
      drag = { id, dx: box.pos[0] - p.x, dz: box.pos[2] - p.z, moved: false };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const [x, y] = ndc(e);
      const p = stage.floorPoint(x, y, useStore.getState().ui.stageView);
      if (!p) return;
      const d0 = drag;
      d0.moved = true;
      useStore.getState().update((d) => {
        const b = d.stage.boxes.find((bb) => bb.id === d0.id);
        if (b) { b.pos[0] = Math.max(-5, Math.min(5, p.x + d0.dx)); b.pos[2] = Math.max(-2.8, Math.min(4, p.z + d0.dz)); }
      }, { record: false });
      useStore.getState().setUi({ mapStale: true });
    };
    const up = () => {
      if (drag && !drag.moved) useStore.setState((x) => ({ past: x.past.slice(0, -1) }));
      drag = null;
      stage.setControlsEnabled(useStore.getState().ui.stageView === 'audience');
    };
    el.addEventListener('pointerdown', down, { capture: true });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    cleanup.current = () => {
      el.removeEventListener('pointerdown', down, { capture: true });
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      stage.detachControls();
    };
  }, []);

  return (
    <Viewport kind="stage" className="flex" onEl={onEl}>
      <div className="vp-bar">
        <span className="chip">3D STAGE</span>
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={`chip btn-chip ${view === v.id ? 'on' : ''}`} onClick={() => setUi({ stageView: v.id })}>{v.label}</button>
        ))}
        <div className="spacer" />
        {stale && <span className="chip" style={{ color: 'var(--green)' }}>OBJECTS MOVED · MAPPING IS STALE</span>}
        <button type="button" className={`btn sm ${stale ? 'green' : ''}`} style={{ background: 'rgba(24,25,27,0.9)' }} onClick={runAutoMap}>AUTO-MAP FACES</button>
      </div>
      <div className="vp-info">
        PROJECTOR 1 · VIRTUAL · THROW {proj.throwRatio.toFixed(2)}<br />
        {boxes} OBJECTS · DRAG AN OBJECT TO MOVE IT{view === 'audience' ? ' · DRAG EMPTY SPACE TO ORBIT' : ''}
      </div>
      <div className="vp-actions">
        <button type="button" className="btn sm" onClick={() => {
          const id = uid('box');
          update((d) => {
            d.stage.boxes.push({ id, name: `Box ${d.stage.boxes.length + 1}`, pos: [0, 0, 0.6], size: [0.8, 0.8, 0.8], rotY: 0 });
          });
          setUi({ selectedBoxId: id, mapStale: true });
        }}>+ BOX</button>
        <button type="button" className="btn sm" onClick={() => {
          const id = uid('cyl');
          update((d) => {
            d.stage.boxes.push({ id, name: `Cylinder ${d.stage.boxes.filter((b) => b.shape === 'cylinder').length + 1}`, shape: 'cylinder', pos: [-0.6, 0, 0.4], size: [0.7, 1.1, 0.7], rotY: 0 });
          });
          setUi({ selectedBoxId: id, mapStale: true });
        }}>+ CYLINDER</button>
      </div>
    </Viewport>
  );
}

export function Rehearsal() {
  const boxId = useStore((s) => s.ui.selectedBoxId);
  // A blank map has no simulated room: show the flat output instead of the 3D stage.
  const blank = useStore((s) => s.show.kind === 'blank');
  return (
    <div className="work rehearsal">
      <SourcesPanel />
      <main className="center">
        {blank ? (
          <Fit16x9>
            {(w, h) => (
              <Viewport kind="output" style={{ width: w, height: h }}>
                <div className="vp-bar"><span className="chip">OUTPUT · 1280×720</span></div>
              </Viewport>
            )}
          </Fit16x9>
        ) : (
          <>
            <StageView3D />
            <div className="mini-row">
              <Viewport kind="projector"><div className="vp-bar"><span className="chip">PROJECTOR VIEW</span></div></Viewport>
              <Viewport kind="output"><div className="vp-bar"><span className="chip">OUTPUT · 1280×720</span></div></Viewport>
            </div>
          </>
        )}
      </main>
      <aside className="panel" aria-label="Properties">
        {!blank && boxId && <BoxCard boxId={boxId} />}
        <ClipCard />
        <EffectRack />
        {!blank && <ProjectorCard />}
      </aside>
      <Timeline />
    </div>
  );
}
