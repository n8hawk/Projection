import { useRef, useState } from 'react';
import { useStore, now } from '../state/store';
import { GENERATORS } from '../engine/shaders';
import { putMedia } from '../engine/idb';
import type { ClipSource, MediaRef } from '../model/types';
import { uid } from '../model/time';
import { newClip, resolveOverlaps } from '../model/ops';
import { toast } from './hooks';

export const SOURCE_MIME = 'application/x-projection-source';

function kindOf(file: File): MediaRef['kind'] | null {
  if (file.type === 'image/gif') return 'gif';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}

export async function importFiles(files: FileList | File[]): Promise<void> {
  const refs: MediaRef[] = [];
  for (const f of Array.from(files)) {
    const kind = kindOf(f);
    if (!kind) continue;
    const id = uid('media');
    try {
      await putMedia(id, f);
    } catch {
      // Private mode: the loop works until reload.
    }
    refs.push({ id, name: f.name.replace(/\.[^.]+$/, ''), kind, url: URL.createObjectURL(f) });
  }
  if (!refs.length) {
    toast('Nothing imported. Use MP4, WebM, GIF, PNG or JPG files.');
    return;
  }
  useStore.getState().update((d) => d.media.push(...refs));
  toast(`Imported ${refs.length} loop${refs.length > 1 ? 's' : ''}`);
}

export function addSourceToSelectedLayer(source: ClipSource): void {
  const s = useStore.getState();
  const layerId = s.ui.selectedLayerId ?? s.show.layers[s.show.layers.length - 1]?.id;
  if (!layerId) return;
  const clip = newClip(s.show, layerId, Math.floor(now()), source);
  s.update((d) => { d.clips.push(clip); resolveOverlaps(d, clip.id); });
  s.setUi({ selectedClipId: clip.id, selectedLayerId: layerId, selectedBoxId: null });
}

export function MediaThumb({ m }: { m: MediaRef }) {
  if (!m.url) return <div className="tile-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="mono muted" style={{ fontSize: 10 }}>MISSING</span></div>;
  return (
    <div className="tile-thumb">
      {m.kind === 'video' ? <video src={m.url} muted loop autoPlay playsInline /> : <img src={m.url} alt="" />}
    </div>
  );
}

export function SourcesPanel() {
  const media = useStore((s) => s.show.media);
  const [tab, setTab] = useState<'generators' | 'loops'>('generators');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const match = (n: string) => n.toLowerCase().includes(q.toLowerCase());

  const drag = (e: React.DragEvent, src: ClipSource) => {
    e.dataTransfer.setData(SOURCE_MIME, JSON.stringify(src));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside
      className="panel"
      aria-label="Sources"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setTab('loops');
        void importFiles(e.dataTransfer.files);
      }}
    >
      <div className="panel-head">
        <span className="label">SOURCES</span>
        <button type="button" className="btn sm" onClick={() => input.current?.click()}>+ IMPORT</button>
        <input ref={input} type="file" hidden multiple accept="video/*,image/gif,image/png,image/jpeg,image/webp" onChange={(e) => { if (e.target.files) { setTab('loops'); void importFiles(e.target.files); } e.target.value = ''; }} />
      </div>
      <input className="search" type="search" placeholder="Search generators, loops…" aria-label="Search sources" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="seg">
        <button type="button" className={tab === 'generators' ? 'on' : ''} onClick={() => setTab('generators')}>GENERATORS</button>
        <button type="button" className={tab === 'loops' ? 'on' : ''} onClick={() => setTab('loops')}>LOOPS · {media.length}</button>
      </div>
      <div className="tiles">
        {tab === 'generators' && GENERATORS.filter((g) => match(g.name)).map((g, i) => {
          const src: ClipSource = { kind: 'generator', gen: g.id };
          return (
            <button key={g.id} type="button" draggable className={`tile ${sel === g.id ? 'sel' : ''}`} onClick={() => setSel(g.id)} onDoubleClick={() => addSourceToSelectedLayer(src)} onDragStart={(e) => drag(e, src)} title="Drag onto a layer, or double-click to add at the playhead">
              <div className="tile-thumb" style={{ background: g.thumb }}><span className="num">{String(i + 1).padStart(2, '0')}</span></div>
              <div className="tile-meta"><span>{g.name}</span><span>GEN</span></div>
            </button>
          );
        })}
        {tab === 'loops' && media.filter((m) => match(m.name)).map((m) => {
          const src: ClipSource = { kind: 'media', mediaId: m.id };
          return (
            <button key={m.id} type="button" draggable className={`tile ${sel === m.id ? 'sel' : ''}`} onClick={() => setSel(m.id)} onDoubleClick={() => addSourceToSelectedLayer(src)} onDragStart={(e) => drag(e, src)}>
              <MediaThumb m={m} />
              <div className="tile-meta"><span>{m.name}</span><span>{m.kind.toUpperCase()}</span></div>
            </button>
          );
        })}
      </div>
      {tab === 'loops' && media.length === 0 && (
        <div className="hint">Drop MP4, WebM or GIF loops here, or press + Import. They are stored in this browser, so they survive a reload.</div>
      )}
      <div className="hint" style={{ marginTop: 'auto' }}>Drag a source onto a layer in the timeline, or double-click it to add it to the selected layer at the playhead.</div>
    </aside>
  );
}
