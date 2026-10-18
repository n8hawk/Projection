import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { layerTargetLabel, newClip, resolveOverlaps, snap } from '../model/ops';
import { TimeReadout, useLiveTime } from './hooks';
import { SOURCE_MIME } from './SourcesPanel';
import type { ClipSource } from '../model/types';
import { uid } from '../model/time';
import { makeEffect } from '../engine/effects';

const ROW = 44;
const RULER = 26;
const LAYER_COLORS = ['#9A9EA5', '#90ECFF', '#C182D4', '#62D289'];

function clipStyle(color: string, selected: boolean): React.CSSProperties {
  if (color === '#9A9EA5') return { background: selected ? '#3a3b40' : '#313237', color: 'var(--text)' };
  return { background: color + (selected ? '' : 'CC'), color: '#18191B', fontWeight: 600 };
}

export function Timeline() {
  const show = useStore((s) => s.show);
  const ui = useStore((s) => s.ui);
  const playing = useStore((s) => s.transport.playing);
  const loop = useStore((s) => s.transport.loop);
  const st = useStore.getState();
  const pps = ui.pixelsPerSecond;
  const width = show.duration * pps;
  const rows = [...show.layers].reverse(); // top layer first, like a stack
  const lanesRef = useRef<HTMLDivElement>(null);
  const [dropLayer, setDropLayer] = useState<string | null>(null);

  const playhead = useLiveTime<HTMLDivElement>((el, t) => {
    el.style.transform = `translateX(${t * useStore.getState().ui.pixelsPerSecond}px)`;
  });

  const timeAt = (clientX: number) => {
    const r = lanesRef.current!.getBoundingClientRect();
    return (clientX - r.left + lanesRef.current!.scrollLeft) / pps;
  };

  const seekDrag = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    st.seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => useStore.getState().seek(timeAt(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const clipDrag = (e: React.PointerEvent, clipId: string, mode: 'move' | 'resize') => {
    e.stopPropagation();
    const s = useStore.getState();
    const c = s.show.clips.find((x) => x.id === clipId)!;
    s.setUi({ selectedClipId: clipId, selectedLayerId: c.layerId, selectedBoxId: null });
    s.checkpoint();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const orig = { start: c.start, duration: c.duration, row: rows.findIndex((l) => l.id === c.layerId) };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / pps;
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
      moved = true;
      useStore.getState().update((d) => {
        const clip = d.clips.find((x) => x.id === clipId);
        if (!clip) return;
        if (mode === 'resize') {
          clip.duration = Math.max(0.5, Math.min(d.duration - clip.start, snap(orig.duration + dx, ev.shiftKey)));
        } else {
          clip.start = Math.max(0, Math.min(d.duration - clip.duration, snap(orig.start + dx, ev.shiftKey)));
          const row = Math.max(0, Math.min(rows.length - 1, orig.row + Math.round((ev.clientY - y0) / ROW)));
          clip.layerId = rows[row].id;
        }
      }, { record: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) { useStore.setState((x) => ({ past: x.past.slice(0, -1) })); return; } // a click is not an edit
      useStore.getState().update((d) => resolveOverlaps(d, clipId), { record: false });
      useStore.getState().setUi({ selectedLayerId: useStore.getState().show.clips.find((x) => x.id === clipId)?.layerId ?? null });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDrop = (e: React.DragEvent, layerId: string) => {
    setDropLayer(null);
    const raw = e.dataTransfer.getData(SOURCE_MIME);
    if (!raw) return;
    e.preventDefault();
    const src = JSON.parse(raw) as ClipSource;
    const s = useStore.getState();
    const clip = newClip(s.show, layerId, snap(timeAt(e.clientX)), src);
    s.update((d) => { d.clips.push(clip); resolveOverlaps(d, clip.id); });
    s.setUi({ selectedClipId: clip.id, selectedLayerId: layerId, selectedBoxId: null });
  };

  const ticks: number[] = [];
  const stepS = pps >= 40 ? 1 : pps >= 20 ? 2 : 4;
  for (let t = 0; t <= show.duration; t += stepS) ticks.push(t);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-head">
        <button type="button" className="play" aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)" onClick={() => (playing ? st.pause() : st.play())}>
          {playing ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="#18191B" aria-hidden="true"><rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="#18191B" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
          )}
        </button>
        <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Stop" onClick={st.stop}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="#E9ECF1" aria-hidden="true"><rect x="4" y="4" width="16" height="16" /></svg>
        </button>
        <TimeReadout />
        <button type="button" className={`tag ${loop ? 'on' : ''}`} onClick={() => st.setTransport({ ...useStore.getState().transport, loop: !loop })}>LOOP · {loop ? 'ON' : 'OFF'}</button>
        <span className="tag">SNAP · 0.5 S</span>
        <label className="tag" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          LENGTH
          <input
            type="number" min={4} max={600} step={1} value={show.duration}
            style={{ width: 52, background: 'transparent', border: 'none', fontFamily: 'var(--mono)', fontSize: 11 }}
            onChange={(e) => {
              const v = Math.max(4, Math.min(600, Number(e.target.value) || 4));
              st.update((d) => { d.duration = v; });
            }}
          />
          S
        </label>
        <div className="spacer" />
        <button type="button" className="tag" onClick={() => st.setUi({ pixelsPerSecond: Math.max(8, pps / 1.5) })} aria-label="Zoom out">−</button>
        <button type="button" className="tag" onClick={() => st.setUi({ pixelsPerSecond: Math.min(120, pps * 1.5) })} aria-label="Zoom in">+</button>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            const id = uid('layer');
            st.update((d) => {
              d.layers.push({ id, name: `Layer ${d.layers.length + 1}`, color: LAYER_COLORS[d.layers.length % LAYER_COLORS.length], surfaceIds: [], effects: [makeEffect('kaleido'), makeEffect('color'), makeEffect('trails')], muted: false });
            });
            st.setUi({ selectedLayerId: id });
          }}
        >+ LAYER</button>
      </div>
      <div className="tl-body">
        <div className="tl-layers">
          <div className="ruler-pad label muted">LAYERS</div>
          {rows.map((l, i) => (
            <div key={l.id} className={`tl-layer ${ui.selectedLayerId === l.id ? 'sel' : ''}`} onClick={() => st.setUi({ selectedLayerId: l.id })}>
              <span className="swatch" style={{ background: l.color }} />
              <span className="name">{rows.length - i} · {l.name}</span>
              <span className="target" title="Surfaces this layer projects onto. Change them in Map.">→ {layerTargetLabel(show, l.id)}</span>
              <button type="button" className={`mute ${l.muted ? 'on' : ''}`} title="Mute layer" onClick={(e) => { e.stopPropagation(); st.update((d) => { const x = d.layers.find((y) => y.id === l.id)!; x.muted = !x.muted; }); }}>M</button>
            </div>
          ))}
        </div>
        <div className="tl-lanes" ref={lanesRef}>
          <div className="tl-inner" style={{ width: width + 40 }}>
            <div className="ruler" onPointerDown={seekDrag} style={{ height: RULER }}>
              {ticks.map((t) => (
                <span key={t} className="tick" style={{ left: t * pps }}>{`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`}</span>
              ))}
              {show.cues.map((c) => (
                <span key={c.id} className="cue" style={{ left: c.time * pps }}>{c.name}</span>
              ))}
            </div>
            {rows.map((l) => (
              <div
                key={l.id}
                className={`lane ${dropLayer === l.id ? 'drop' : ''}`}
                style={{ width }}
                onPointerDown={(e) => { if (e.target === e.currentTarget) st.setUi({ selectedLayerId: l.id, selectedClipId: null }); }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(SOURCE_MIME)) { e.preventDefault(); setDropLayer(l.id); } }}
                onDragLeave={() => setDropLayer(null)}
                onDrop={(e) => onDrop(e, l.id)}
              >
                {show.clips.filter((c) => c.layerId === l.id).map((c) => {
                  const missing = c.source.kind === 'media' && !show.media.find((m) => m.id === (c.source as { mediaId: string }).mediaId)?.url;
                  return (
                    <div
                      key={c.id}
                      className={`clip ${ui.selectedClipId === c.id ? 'sel' : ''}`}
                      style={{ left: c.start * pps, width: Math.max(8, c.duration * pps - 2), ...clipStyle(l.color, ui.selectedClipId === c.id) }}
                      onPointerDown={(e) => clipDrag(e, c.id, 'move')}
                      title={`${c.name} · ${c.start.toFixed(1)}s–${(c.start + c.duration).toFixed(1)}s`}
                    >
                      {c.name}
                      {c.params.opacity < 1 && <span style={{ opacity: 0.7, marginLeft: 6 }}>· {Math.round(c.params.opacity * 100)}%</span>}
                      {missing && <span className="warn">RE-IMPORT</span>}
                      <span className="resize" onPointerDown={(e) => clipDrag(e, c.id, 'resize')} />
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="playhead" ref={playhead} />
          </div>
        </div>
      </div>
    </section>
  );
}
