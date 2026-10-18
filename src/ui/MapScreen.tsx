import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Fit16x9, Viewport } from './Viewport';
import { runAutoMap } from './Rehearsal';
import type { Quad, Surface } from '../model/types';
import { uid } from '../model/time';
import { OUTPUT_H, OUTPUT_W } from '../engine/projector';

const CORNERS = ['TL', 'TR', 'BR', 'BL'];

function SurfaceList() {
  const surfaces = useStore((s) => s.show.surfaces);
  const sel = useStore((s) => s.ui.selectedSurfaceId);
  const stale = useStore((s) => s.ui.mapStale);
  const { setUi, update } = useStore.getState();
  const manual = surfaces.filter((s) => !s.bind);
  const auto = surfaces.filter((s) => s.bind);
  const item = (s: Surface) => (
    <div key={s.id} className={`surface-item ${sel === s.id ? 'sel' : ''}`} onClick={() => setUi({ selectedSurfaceId: s.id })}>
      <span>{s.name}</span>
      <span className={`kind ${s.bind ? 'auto' : ''}`}>{s.bind ? 'AUTO' : 'QUAD'}</span>
    </div>
  );
  return (
    <aside className="panel" aria-label="Surfaces">
      <div className="panel-head">
        <span className="label">SURFACES</span>
        <button type="button" className="btn sm" onClick={() => {
          const id = uid('surf');
          update((d) => {
            d.surfaces.push({ id, name: `Surface ${d.surfaces.length + 1}`, corners: [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65], [0.35, 0.65]] });
          });
          setUi({ selectedSurfaceId: id });
        }}>+ QUAD</button>
      </div>
      <div className="surface-list">
        {manual.map(item)}
        {auto.length > 0 && <div className="group-label">DETECTED FROM 3D STAGE</div>}
        {auto.map(item)}
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stale && <div className="stale">Boxes or the projector moved since the last auto-map.</div>}
        <button type="button" className={`btn ${stale ? 'green' : 'fill'}`} onClick={runAutoMap}>AUTO-MAP FROM 3D</button>
        <span className="empty">Auto-map finds every box face the virtual projector can see and pins a surface to it. Fine-tune the corners by hand afterwards.</span>
      </div>
    </aside>
  );
}

function MapCanvas() {
  const surfaces = useStore((s) => s.show.surfaces);
  const sel = useStore((s) => s.ui.selectedSurfaceId);
  const test = useStore((s) => s.show.live.testPattern);
  const [outlines, setOutlines] = useState(true);
  const [corner, setCorner] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const { setUi, update, checkpoint } = useStore.getState();

  // Arrow keys nudge the selected corner by one output pixel (Shift: 10).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement).closest('input, select, textarea')) return;
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!k) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      update((d) => {
        const s = d.surfaces.find((x) => x.id === sel);
        if (!s) return;
        s.corners[corner] = [s.corners[corner][0] + (k[0] * step) / OUTPUT_W, s.corners[corner][1] + (k[1] * step) / OUTPUT_H];
      });
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [sel, corner, update]);

  const startDrag = (e: React.PointerEvent, id: string, which: number | 'all') => {
    e.stopPropagation();
    setUi({ selectedSurfaceId: id });
    if (which !== 'all') setCorner(which);
    const rect = svg.current!.getBoundingClientRect();
    const s0 = useStore.getState().show.surfaces.find((s) => s.id === id)!;
    const orig = structuredClone(s0.corners);
    const x0 = e.clientX, y0 = e.clientY;
    checkpoint();
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / rect.width;
      const dy = (ev.clientY - y0) / rect.height;
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 2) return;
      moved = true;
      update((d) => {
        const s = d.surfaces.find((x) => x.id === id);
        if (!s) return;
        const c = (p: [number, number]): [number, number] => [Math.max(-0.2, Math.min(1.2, p[0] + dx)), Math.max(-0.2, Math.min(1.2, p[1] + dy))];
        if (which === 'all') s.corners = orig.map(c) as Quad;
        else s.corners[which] = c(orig[which]);
      }, { record: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) useStore.setState((x) => ({ past: x.past.slice(0, -1) }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <main className="center">
      <div className="row">
        <span className="chip">PROJECTOR 1 VIEW · 1280×720</span>
        <div className="spacer" />
        <button type="button" className={`btn sm ${test ? 'cyan on' : ''}`} onClick={() => update((d) => { d.live.testPattern = !d.live.testPattern; })}>TEST PATTERN</button>
        <button type="button" className={`btn sm ${outlines ? 'cyan' : ''}`} onClick={() => setOutlines(!outlines)}>OUTLINES</button>
      </div>
      <Fit16x9>
        {(w, h) => (
          <Viewport kind="output" style={{ width: w, height: h }}>
            <svg ref={svg} className="map-svg" viewBox={`0 0 ${w} ${h}`} onPointerDown={() => setUi({ selectedSurfaceId: null })}>
              {surfaces.map((s) => {
                const isSel = s.id === sel;
                if (!outlines && !isSel) return null;
                const pts = s.corners.map(([x, y]) => `${x * w},${y * h}`).join(' ');
                const cx = (s.corners.reduce((a, c) => a + c[0], 0) / 4) * w;
                const cy = (s.corners.reduce((a, c) => a + c[1], 0) / 4) * h;
                const stroke = isSel ? 'var(--active)' : s.bind ? 'var(--green)' : 'var(--muted)';
                return (
                  <g key={s.id}>
                    <polygon points={pts} fill={isSel ? 'rgba(144,236,255,0.08)' : 'rgba(0,0,0,0.001)'} stroke={stroke} strokeWidth={isSel ? 2 : 1.25} strokeDasharray={s.bind && !isSel ? '5 4' : undefined} style={{ cursor: 'move' }} onPointerDown={(e) => startDrag(e, s.id, 'all')} />
                    <text x={cx} y={cy} fill={stroke} fontSize="10.5" fontFamily="JetBrains Mono" letterSpacing="1.2" textAnchor="middle" style={{ pointerEvents: 'none', textTransform: 'uppercase' }}>{s.name.toUpperCase()}</text>
                    {isSel && s.corners.map(([x, y], i) => (
                      <g key={i} style={{ cursor: 'grab' }} onPointerDown={(e) => startDrag(e, s.id, i)}>
                        <circle cx={x * w} cy={y * h} r={14} fill="transparent" />
                        <circle cx={x * w} cy={y * h} r={6} fill={i === corner ? 'var(--active)' : '#18191B'} stroke="var(--active)" strokeWidth={2} />
                      </g>
                    ))}
                  </g>
                );
              })}
            </svg>
          </Viewport>
        )}
      </Fit16x9>
      <div className="mono muted" style={{ fontSize: 11, letterSpacing: '0.1em' }}>DRAG A CORNER OR THE WHOLE SURFACE · ARROWS NUDGE 1 PX · SHIFT 10 PX · CLICK EMPTY SPACE TO DESELECT</div>
    </main>
  );
}

function SurfaceProps() {
  const show = useStore((s) => s.show);
  const sel = useStore((s) => s.ui.selectedSurfaceId);
  const { update, setUi } = useStore.getState();
  const s = show.surfaces.find((x) => x.id === sel);
  return (
    <div className="center">
    <aside className="panel" aria-label="Surface properties" style={{ flex: 'none', maxHeight: '70%' }}>
      {!s ? (
        <div className="card"><div className="label muted">SELECTED SURFACE</div><div className="empty">Click a surface outline to edit its corners and choose which layers play on it.</div></div>
      ) : (
        <div className="card">
          <div>
            <div className="label muted">SELECTED SURFACE</div>
            <input className="text-input" style={{ marginTop: 6, fontSize: 16, fontWeight: 600 }} value={s.name} aria-label="Surface name" onChange={(e) => update((d) => { const x = d.surfaces.find((y) => y.id === s.id); if (x) x.name = e.target.value; }, { record: false })} />
            <div className="clip-sub" style={{ marginTop: 6 }}>QUAD · {s.bind ? `DETECTED FROM ${show.stage.boxes.find((b) => b.id === s.bind!.boxId)?.name ?? 'BOX'}` : 'DRAWN BY HAND'}</div>
          </div>
          <div className="field">
            <span>CORNERS (0–1 OF OUTPUT)</span>
            <div className="corner-table">
              <span className="muted">PT</span><span className="muted">X</span><span className="muted">Y</span>
              {s.corners.map((c, i) => (
                <CornerRow key={i} label={CORNERS[i]} c={c} onChange={(v) => update((d) => { const x = d.surfaces.find((y) => y.id === s.id); if (x) x.corners[i] = v; })} />
              ))}
            </div>
          </div>
          <div className="field">
            <span>LAYERS PLAYING HERE</span>
            <div className="layer-chips">
              {show.layers.map((l, i) => {
                const on = l.surfaceIds.includes(s.id);
                return (
                  <button key={l.id} type="button" className={`layer-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => update((d) => {
                    const ll = d.layers.find((x) => x.id === l.id)!;
                    ll.surfaceIds = on ? ll.surfaceIds.filter((id) => id !== s.id) : [...ll.surfaceIds, s.id];
                  })}>L{i + 1} · {l.name}</button>
                );
              })}
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn sm" onClick={() => update((d) => { const x = d.surfaces.find((y) => y.id === s.id); if (x) x.corners = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]; })}>RESET</button>
            <button type="button" className="btn sm danger" onClick={() => {
              update((d) => {
                d.surfaces = d.surfaces.filter((x) => x.id !== s.id);
                d.layers.forEach((l) => (l.surfaceIds = l.surfaceIds.filter((id) => id !== s.id)));
              });
              setUi({ selectedSurfaceId: null });
            }}>DELETE</button>
          </div>
        </div>
      )}
    </aside>
    <Viewport kind="stage" className="flex" style={{ minHeight: 160 }}>
      <div className="vp-bar"><span className="chip">3D CHECK</span></div>
    </Viewport>
    </div>
  );
}

function CornerRow({ label, c, onChange }: { label: string; c: [number, number]; onChange: (v: [number, number]) => void }) {
  return (
    <>
      <span>{label}</span>
      <input type="number" step={0.001} value={c[0].toFixed(3)} aria-label={`${label} x`} onChange={(e) => onChange([Number(e.target.value), c[1]])} />
      <input type="number" step={0.001} value={c[1].toFixed(3)} aria-label={`${label} y`} onChange={(e) => onChange([c[0], Number(e.target.value)])} />
    </>
  );
}

export function MapScreen() {
  return (
    <div className="work map">
      <SurfaceList />
      <MapCanvas />
      <SurfaceProps />
    </div>
  );
}
