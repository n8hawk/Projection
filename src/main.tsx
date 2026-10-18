import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './ui/App';
import { startLoop } from './engine/loop';
import { useStore } from './state/store';
import { getMedia } from './engine/idb';

const canvas = document.createElement('canvas');
canvas.className = 'gl';
document.body.prepend(canvas);
startLoop(canvas);

// blob: URLs die with the tab; rebuild them from the copies kept in IndexedDB.
void (async () => {
  const media = useStore.getState().show.media;
  for (const m of media) {
    let url = '';
    try {
      const blob = await getMedia(m.id);
      if (blob) url = URL.createObjectURL(blob);
    } catch {
      // Leave it marked missing.
    }
    useStore.getState().update((d) => {
      const x = d.media.find((y) => y.id === m.id);
      if (x) x.url = url;
    }, { record: false });
  }
})();

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
