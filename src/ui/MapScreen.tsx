import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Fit16x9, Viewport } from './Viewport';
import { runAutoMap } from './Rehearsal';
import { Knob } from './Knob';
import type { Mask, Quad, Show, Surface, Vec2 } from '../model/types';
import { uid } from '../model/time';
import { OUTPUT_H, OUTPUT_W } from '../engine/projector';
import { meshCorners, meshOutline, quadToMesh } from '../engine/quad';
import type { ParamDef } from '../engine/effects';

const CORNERS = ['TL', 'TR', 'BR', 'BL'];
const MASK_COLOR = '#F08A96';
const GRIDS: [number, number][] = [[2, 2], [3, 3], [4, 4], [6, 4], [8, 6]];

const FEATHER: ParamDef = { key: 'feather', label: 'SOFT EDGE', min: 0, max: 0.3, def: 0, format: (v) => `${Math.round(v * 100)}%` };
const TRIM: ParamDef = { key: 'brightness', label: 'BRIGHTNESS', min: 0, max: 1.5, def: 1, format: (v) => `${Math.round(v * 100)}%` };

type Item = { kind: 'surface'; s: Surface } | { kind: 'mask'; m: Mask };

function findItem(show: Show, id: string | null): Item | null {
  if (!id) return null;
  const s = show.surfaces.find((x) => x.id === id);
  if (s) return { kind: 'surface', s };
  const m = (show.masks ?? []).find((x) => x.id === id);
  return m ? { kind: 'mask', m } : null;
}

/** The draggable points of a surface or mask, whatever its kind. */
function pointsOf(item: Item): Vec2[] {
  if (item.kind === 'mask') return item.m.points;
  return item.s.mesh ? item.s.mesh.points : item.s.corners;
}

/** Writes edited points back into the show draft. */
function setPoints(d: Show, id: string, pts: Vec2[]): void {
  const s = d.surfaces.find((x) => x.id === id);
  if (s) {
    if (s.mesh) {
      s.mesh.points = pts;
      s.corners = meshCorners(s.mesh);
    } else {
      s.corners = pts as Quad;
    }
    return;
  }
  const m = (d.masks ?? []).find((x) => x.id === id);
  if (m) m.points = pts;
}

export function deleteMapItem(d: Show, id: string): void {
  d.surfaces = d.surfaces.filter((x) => x.id !== id);
  d.masks = (d.masks ?? []).filter((x) => x.id !== id);
  d.layers.forEach((l) => (l.surfaceIds = l.surfaceIds.filter((x) => x !== id)));
}

function SurfaceList() {
  const surfaces = useStore((s) => s.show.surfaces);
  const masks = useStore((s) => s.show.masks ?? []);
  const sel = useStore((s) => s.ui.selectedSurfaceId);
  const stale = useStore((s) => s.ui.mapStale);
  const blank = useStore((s) => s.show.kind === 'blank');
  const { setUi, update } = useStore.getState();
  const manual = surfaces.filter((s) => !s.bind);
  const auto = surfaces.filter((s) => s.bind);
  const item = (s: Surface) => (
    <div key={s.id} className={`surface-item ${sel === s.id ? 'sel' : ''}`} onClick={() => setUi({ selectedSurfaceId: s.id })}>
      <span>{s.name}</span>
      <span className={`kind ${s.bind ? 'auto' : ''}`}>{s.mesh ? 'WARP' : 'QUAD'}{s.bind ? ' · AUTO' : ''}</span>
    </div>
  );
  return (
    <aside className="panel" aria-label="Surfaces">
      <div className="panel-head">
        <span className="label">SURFACES</span>
        <div className="row">
          <button type="button" className="btn sm" onClick={() => {
            const id = uid('surf');
            update((d) => {
              d.surfaces.push({ id, name: `Surface ${d.surfaces.length + 1}`, corners: [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65], [0.35, 0.65]] });
            });
            setUi({ selectedSurfaceId: id });
          }}>+ QUAD</button>
          <button type="button" className="btn sm" title="A black shape drawn over everything, to keep light off things" onClick={() => {
            const id = uid('mask');
            update((d) => {
              d.masks = d.masks ?? [];
              d.masks.push({ id, name: `Mask ${d.masks.length + 1}`, points: [[0.42, 0.42], [0.58, 0.42], [0.58, 0.58], [0.42, 0.58]] });
            });
            setUi({ selectedSurfaceId: id });
          }}>+ MASK</button>
        </div>
      </div>
      <div className="surface-list">
        {manual.map(item)}
        {auto.length > 0 && <div className="group-label">DETECTED FROM 3D STAGE</div>}
        {auto.map(item)}
        {masks.length > 0 && <div className="group-label">MASKS · ALWAYS BLACK</div>}
        {masks.map((m) => (
          <div key={m.id} className={`surface-item ${sel === m.id ? 'sel' : ''}`} onClick={() => setUi({ selectedSurfaceId: m.id })}>
            <span>{m.name}</span>
            <span className="kind" style={{ color: MASK_COLOR }}>{m.points.length} PTS</span>
          </div>
        ))}
      </div>
      {blank ? (
        <span className="empty" style={{ marginTop: 'auto' }}>Point the projector at your real objects and turn on Go Live and the test pattern. Add a quad for each surface and drag its corners onto the object. Use a warp grid for curves and masks to keep light off things.</span>
      ) : (
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {stale && <div className="stale">Objects or the projector moved since the last auto-map.</div>}
          <button type="button" className={`btn ${stale ? 'green' : 'fill'}`} onClick={runAutoMap}>AUTO-MAP FROM 3D</button>
          <span className="empty">Auto-map pins a surface to every face the virtual projector can see. Curved objects get a warp grid. Fine-tune by hand afterwards.</span>
        </div>
      )}
    </aside>
  );
}

function MapCanvas() {
  const show = useStore((s) => s.show);
  const sel = useStore((s) => s.ui.selectedSurfaceId);
  const test = show.live.testPattern;
  const [outlines, setOutlines] = useState(true);
  const [point, setPoint] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const { setUi, update, checkpoint } = useStore.getState();
  const selItem = findItem(show, sel);

  useEffect(() => setPoint(0), [sel]);

  // Arrow keys nudge the selected point by one output pixel (Shift: 10).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement).closest('input, select, textarea')) return;
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!k) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      update((d) => {
        const it = findItem(d, sel);
        if (!it) return;
        const pts = pointsOf(it).map((p) => [...p] as Vec2);
        if (!pts[point]) return;
        pts[point] = [pts[point][0] + (k[0] * step) / OUTPUT_W, pts[point][1] + (k[1] * step) / OUTPUT_H];
        setPoints(d, sel, pts);
      });
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [sel, point, update]);

  const startDrag = (e: React.PointerEvent, id: string, which: number | 'all') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setUi({ selectedSurfaceId: id });
    if (which !== 'all') setPoint(which);
    const rect = svg.current!.getBoundingClientRect();
    const it = findItem(useStore.getState().show, id);
    if (!it) return;
    const orig = pointsOf(it).map((p) => [...p] as Vec2);
    const x0 = e.clientX, y0 = e.clientY;
    checkpoint();
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / rect.width;
      const dy = (ev.clientY - y0) / rect.height;
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 2) return;
      moved = true;
      const c = (p: Vec2): Vec2 => [Math.max(-0.2, Math.min(1.2, p[0] + dx)), Math.max(-0.2, Math.min(1.2, p[1] + dy))];
      update((d) => setPoints(d, id, which === 'all' ? orig.map(c) : orig.map((p, i) => (i === which ? c(p) : p))), { record: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) useStore.setState((x) => ({ past: x.past.slice(0, -1) }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Double-click on a mask: add a point on the nearest edge. */
  const insertMaskPoint = (e: React.MouseEvent, m: Mask) => {
    const rect = svg.current!.getBoundingClientRect();
    const p: Vec2 = [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
    let best = 0, bestD = Infinity;
    m.points.forEach((a, i) => {
      const b = m.points[(i + 1) % m.points.length];
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
      const d = Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
      if (d < bestD) { bestD = d; best = i; }
    });
    update((d) => {
      const mm = d.masks.find((x) => x.id === m.id);
      if (mm) mm.points.splice(best + 1, 0, p);
    });
    setPoint(best + 1);
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
        {(w, h) => {
          const pt = ([x, y]: Vec2) => `${x * w},${y * h}`;
          return (
            <Viewport kind="output" style={{ width: w, height: h }}>
              <svg ref={svg} className="map-svg" viewBox={`0 0 ${w} ${h}`} onPointerDown={() => setUi({ selectedSurfaceId: null })}>
                {show.surfaces.map((s) => {
                  const isSel = s.id === sel;
                  if (!outlines && !isSel) return null;
                  const outline = s.mesh ? meshOutline(s.mesh) : s.corners;
                  const cx = (outline.reduce((a, c) => a + c[0], 0) / outline.length) * w;
                  const cy = (outline.reduce((a, c) => a + c[1], 0) / outline.length) * h;
                  const stroke = isSel ? 'var(--active)' : s.bind ? 'var(--green)' : 'var(--muted)';
                  return (
                    <g key={s.id}>
                      <polygon points={outline.map(pt).join(' ')} fill={isSel ? 'rgba(144,236,255,0.08)' : 'rgba(0,0,0,0.001)'} stroke={stroke} strokeWidth={isSel ? 2 : 1.25} strokeDasharray={s.bind && !isSel ? '5 4' : undefined} style={{ cursor: 'move' }} onPointerDown={(e) => startDrag(e, s.id, 'all')} />
                      {isSel && s.mesh && <MeshLines mesh={s.mesh} pt={pt} />}
                      <text x={cx} y={cy} fill={stroke} fontSize="10.5" fontFamily="JetBrains Mono" letterSpacing="1.2" textAnchor="middle" style={{ pointerEvents: 'none' }}>{s.name.toUpperCase()}</text>
                    </g>
                  );
                })}
                {(show.masks ?? []).map((m) => {
                  const isSel = m.id === sel;
                  return (
                    <polygon key={m.id} points={m.points.map(pt).join(' ')} fill="rgba(240,138,150,0.16)" stroke={MASK_COLOR} strokeWidth={isSel ? 2 : 1.25} strokeDasharray={isSel ? undefined : '3 3'} style={{ cursor: 'move' }}
                      onPointerDown={(e) => startDrag(e, m.id, 'all')} onDoubleClick={(e) => insertMaskPoint(e, m)} />
                  );
                })}
                {selItem && pointsOf(selItem).map(([x, y], i) => {
                  const color = selItem.kind === 'mask' ? MASK_COLOR : 'var(--active)';
                  return (
                    <g key={i} style={{ cursor: 'grab' }} onPointerDown={(e) => startDrag(e, sel!, i)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (selItem.kind !== 'mask' || selItem.m.points.length <= 3) return;
                        update((d) => { const mm = d.masks.find((x) => x.id === sel); if (mm) mm.points.splice(i, 1); });
                        setPoint(0);
                      }}>
                      <circle cx={x * w} cy={y * h} r={12} fill="transparent" />
                      <circle cx={x * w} cy={y * h} r={selItem.kind === 'surface' && selItem.s.mesh ? 4.5 : 6} fill={i === point ? color : '#18191B'} stroke={color} strokeWidth={2} />
                    </g>
                  );
                })}
              </svg>
            </Viewport>
          );
        }}
      </Fit16x9>
      <div className="mono muted" style={{ fontSize: 11, letterSpacing: "0.1em", userSelect: "none" }}>
        {selItem?.kind === 'mask'
          ? 'DRAG POINTS OR THE WHOLE MASK · DOUBLE-CLICK AN EDGE TO ADD A POINT · RIGHT-CLICK A POINT TO REMOVE IT'
          : 'DRAG A POINT OR THE WHOLE SURFACE · ARROWS NUDGE 1 PX · SHIFT 10 PX · CLICK EMPTY SPACE TO DESELECT'}
      </div>
    </main>
  );
}

/** Faint grid lines through a warp grid's control points. */
function MeshLines({ mesh, pt }: { mesh: NonNullable<Surface['mesh']>; pt: (p: Vec2) => string }) {
  const at = (i: number, j: number) => mesh.points[j * (mesh.cols + 1) + i];
  const lines: string[] = [];
  for (let j = 0; j <= mesh.rows; j++) lines.push(Array.from({ length: mesh.cols + 1 }, (_, i) => pt(at(i, j))).join(' '));
  for (let i = 0; i <= mesh.cols; i++) lines.push(Array.from({ length: mesh.rows + 1 }, (_, j) => pt(at(i, j))).join(' '));
  return (
    <g style={{ pointerEvents: 'none' }}>
      {lines.map((l, k) => <polyline key={k} points={l} fill="none" stroke="var(--active)" strokeOpacity={0.4} strokeWidth={1} />)}
    </g>
  );
}

function SurfaceProps() {
  const show = useStore((s) => s.show);
  const sel = useStore((s) => s.ui.selectedSurfaceId);
  const { update, setUi, checkpoint } = useStore.getState();
  const it = findItem(show, sel);
  const [grid, setGrid] = useState(1);

  const deleteBtn = (id: string) => (
    <button type="button" className="btn sm danger" onClick={() => {
      update((d) => deleteMapItem(d, id));
      setUi({ selectedSurfaceId: null });
    }}>DELETE</button>
  );

  let body;
  if (!it) {
    body = <div className="card"><div className="label muted">SELECTED SURFACE</div><div className="empty">Click a surface or mask outline to edit it.</div></div>;
  } else if (it.kind === 'mask') {
    const m = it.m;
    body = (
      <div className="card">
        <div>
          <div className="label muted">SELECTED MASK</div>
          <input className="text-input" style={{ marginTop: 6, fontSize: 16, fontWeight: 600 }} value={m.name} aria-label="Mask name" onChange={(e) => update((d) => { const x = d.masks.find((y) => y.id === m.id); if (x) x.name = e.target.value; }, { record: false })} />
          <div className="clip-sub" style={{ marginTop: 6 }}>MASK · {m.points.length} POINTS · ALWAYS BLACK</div>
        </div>
        <span className="empty">A mask keeps light off whatever is under it, on top of every layer. Double-click an edge to add a point, right-click a point to remove it.</span>
        <div className="row">{deleteBtn(m.id)}</div>
      </div>
    );
  } else {
    const s = it.s;
    const setSurf = (fn: (x: Surface) => void, record = true) => update((d) => { const x = d.surfaces.find((y) => y.id === s.id); if (x) fn(x); }, { record });
    body = (
      <div className="card">
        <div>
          <div className="label muted">SELECTED SURFACE</div>
          <input className="text-input" style={{ marginTop: 6, fontSize: 16, fontWeight: 600 }} value={s.name} aria-label="Surface name" onChange={(e) => setSurf((x) => { x.name = e.target.value; }, false)} />
          <div className="clip-sub" style={{ marginTop: 6 }}>{s.mesh ? `WARP ${s.mesh.cols}×${s.mesh.rows}` : 'QUAD'} · {s.bind ? `DETECTED FROM ${show.stage.boxes.find((b) => b.id === s.bind!.boxId)?.name ?? 'OBJECT'}` : 'DRAWN BY HAND'}</div>
        </div>
        {!s.mesh ? (
          <div className="field">
            <span>CORNERS (0–1 OF OUTPUT)</span>
            <div className="corner-table">
              <span className="muted">PT</span><span className="muted">X</span><span className="muted">Y</span>
              {s.corners.map((c, i) => (
                <CornerRow key={i} label={CORNERS[i]} c={c} onChange={(v) => setSurf((x) => { x.corners[i] = v; })} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="field">
          <span>WARP GRID</span>
          {s.mesh ? (
            <>
              <span className="empty">Drag any grid point to bend the image around curves or dents.</span>
              <div className="row">
                <button type="button" className="btn sm" onClick={() => setSurf((x) => { x.mesh = quadToMesh(x.corners, x.mesh!.cols, x.mesh!.rows); })}>FLATTEN</button>
                <button type="button" className="btn sm" onClick={() => setSurf((x) => { x.corners = meshCorners(x.mesh!); delete x.mesh; })}>BACK TO CORNERS</button>
              </div>
            </>
          ) : (
            <div className="row">
              <select className="select" style={{ flex: 1 }} value={grid} aria-label="Warp grid size" onChange={(e) => setGrid(Number(e.target.value))}>
                {GRIDS.map(([c, r], i) => <option key={i} value={i}>{c} × {r} cells</option>)}
              </select>
              <button type="button" className="btn sm" onClick={() => setSurf((x) => { x.mesh = quadToMesh(x.corners, GRIDS[grid][0], GRIDS[grid][1]); })}>ADD WARP GRID</button>
            </div>
          )}
        </div>
        <div className="knobs" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <Knob def={FEATHER} value={s.feather ?? 0} size={40} onStart={checkpoint} onChange={(v) => setSurf((x) => { x.feather = v; }, false)} />
          <Knob def={TRIM} value={s.brightness ?? 1} size={40} color="var(--violet)" onStart={checkpoint} onChange={(v) => setSurf((x) => { x.brightness = v; }, false)} />
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
          <button type="button" className="btn sm" onClick={() => setSurf((x) => { x.corners = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]; if (x.mesh) x.mesh = quadToMesh(x.corners, x.mesh.cols, x.mesh.rows); })}>RESET</button>
          {deleteBtn(s.id)}
        </div>
      </div>
    );
  }

  if (show.kind === 'blank') {
    return (
      <div className="center">
        <aside className="panel" aria-label="Surface properties">{body}</aside>
      </div>
    );
  }
  return (
    <div className="center">
      <aside className="panel" aria-label="Surface properties" style={{ flex: 'none', maxHeight: '72%' }}>{body}</aside>
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
