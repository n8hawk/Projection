import type { Clip, ClipSource, Show } from './types';
import { detectFaces } from '../engine/projector';
import { quadToMesh } from '../engine/quad';
import { GENERATORS } from '../engine/shaders';
import { uid } from './time';

/**
 * Re-detects box faces from the projector. Existing detected surfaces keep their
 * id (so layers keep targeting them) and get fresh corners; faces the projector
 * can no longer see are removed. New faces join every layer that already
 * targets a face of the same box.
 */
export function autoMap(show: Show): { added: number; updated: number; removed: number } {
  const found = detectFaces(show.stage.boxes, show.stage.projector);
  const foundIds = new Set(found.map((f) => f.id));
  let added = 0, updated = 0, removed = 0;
  for (const f of found) {
    const existing = show.surfaces.find((s) => s.id === f.id);
    if (existing) {
      existing.corners = f.corners;
      if (f.mesh) existing.mesh = f.mesh;
      else if (existing.mesh) existing.mesh = quadToMesh(f.corners, existing.mesh.cols, existing.mesh.rows);
      updated++;
    } else {
      show.surfaces.push(f);
      added++;
      // Join the layers already playing on this object; for a new object, the
      // layers that play on other detected faces.
      const boundTo = (layerIds: string[], test: (boxId: string) => boolean) =>
        layerIds.some((id) => { const b = show.surfaces.find((s) => s.id === id)?.bind; return !!b && test(b.boxId); });
      let targets = show.layers.filter((l) => boundTo(l.surfaceIds, (b) => b === f.bind!.boxId));
      if (!targets.length) targets = show.layers.filter((l) => boundTo(l.surfaceIds, () => true));
      for (const layer of targets) layer.surfaceIds.push(f.id);
    }
  }
  const gone = show.surfaces.filter((s) => s.bind && !foundIds.has(s.id)).map((s) => s.id);
  if (gone.length) {
    removed = gone.length;
    show.surfaces = show.surfaces.filter((s) => !gone.includes(s.id));
    for (const l of show.layers) l.surfaceIds = l.surfaceIds.filter((id) => !gone.includes(id));
  }
  return { added, updated, removed };
}

export function sourceName(show: Show, src: ClipSource): string {
  if (src.kind === 'generator') return GENERATORS.find((g) => g.id === src.gen)?.name ?? src.gen;
  return show.media.find((m) => m.id === src.mediaId)?.name ?? 'Missing media';
}

export function newClip(show: Show, layerId: string, start: number, source: ClipSource, duration = 8): Clip {
  const dur = Math.min(duration, show.duration);
  const s = Math.max(0, Math.min(start, show.duration - dur));
  return {
    id: uid('clip'),
    layerId,
    name: sourceName(show, source),
    start: s,
    duration: dur,
    source,
    params: { speed: 1, opacity: 1, scale: 1, rotate: 0 },
  };
}

export function layerTargetLabel(show: Show, layerId: string): string {
  const l = show.layers.find((x) => x.id === layerId);
  if (!l || l.surfaceIds.length === 0) return 'NO SURFACE';
  if (l.surfaceIds.length === 1) return show.surfaces.find((s) => s.id === l.surfaceIds[0])?.name ?? '—';
  const boxes = new Set(l.surfaceIds.map((id) => show.surfaces.find((s) => s.id === id)?.bind?.boxId).filter(Boolean));
  if (boxes.size && l.surfaceIds.every((id) => show.surfaces.find((s) => s.id === id)?.bind)) return `${boxes.size} BOXES`;
  return `${l.surfaceIds.length} SURFACES`;
}

export const SNAP = 0.5;
export const snap = (t: number, free = false) => (free ? t : Math.round(t / SNAP) * SNAP);

/**
 * Overwrite edit, like a video editor: the given clip keeps its place and any
 * other clip on the same layer underneath it is trimmed, split or removed.
 */
export function resolveOverlaps(show: Show, clipId: string): void {
  const c = show.clips.find((x) => x.id === clipId);
  if (!c) return;
  const a = c.start;
  const b = c.start + c.duration;
  const out: Clip[] = [];
  for (const o of show.clips) {
    if (o.id === c.id || o.layerId !== c.layerId) { out.push(o); continue; }
    const s = o.start;
    const e = o.start + o.duration;
    if (e <= a + 1e-6 || s >= b - 1e-6) { out.push(o); continue; }
    if (s < a) out.push({ ...o, duration: a - s });
    if (e > b) out.push({ ...o, id: s < a ? uid('clip') : o.id, start: b, duration: e - b });
  }
  show.clips = out;
}
