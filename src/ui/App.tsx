import { useEffect } from 'react';
import { useStore, now } from '../state/store';
import { TopBar } from './TopBar';
import { Rehearsal } from './Rehearsal';
import { MapScreen } from './MapScreen';
import { LiveScreen } from './LiveScreen';
import { Toast } from './hooks';

function useShortcuts() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea')) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (s.transport.playing) s.pause();
        else s.play();
      } else if (e.key === 'Enter' && s.ui.tab === 'live') {
        const t = now();
        const cues = [...s.show.cues].sort((a, b) => a.time - b.time);
        const next = cues.find((c) => c.time > t + 0.05) ?? cues[0];
        if (next) { s.seek(next.time); s.play(); }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.ui.tab === 'map' && s.ui.selectedSurfaceId) {
          const id = s.ui.selectedSurfaceId;
          s.update((d) => {
            d.surfaces = d.surfaces.filter((x) => x.id !== id);
            d.layers.forEach((l) => (l.surfaceIds = l.surfaceIds.filter((x) => x !== id)));
          });
          s.setUi({ selectedSurfaceId: null });
        } else if (s.ui.tab === 'rehearsal' && s.ui.selectedBoxId) {
          const id = s.ui.selectedBoxId;
          s.update((d) => { d.stage.boxes = d.stage.boxes.filter((b) => b.id !== id); });
          s.setUi({ selectedBoxId: null, mapStale: true });
        } else if (s.ui.tab === 'rehearsal' && s.ui.selectedClipId) {
          const id = s.ui.selectedClipId;
          s.update((d) => { d.clips = d.clips.filter((c) => c.id !== id); });
          s.setUi({ selectedClipId: null });
        }
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        s.setUi({ tab: (['rehearsal', 'map', 'live'] as const)[Number(e.key) - 1] });
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}

export function App() {
  const tab = useStore((s) => s.ui.tab);
  useShortcuts();
  return (
    <div className="app">
      <TopBar />
      {tab === 'rehearsal' && <Rehearsal />}
      {tab === 'map' && <MapScreen />}
      {tab === 'live' && <LiveScreen />}
      <Toast />
    </div>
  );
}
