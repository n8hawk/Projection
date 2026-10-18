import { useStore } from '../state/store';
import { toast } from './hooks';

let win: Window | null = null;

interface ScreenDetailed { availLeft: number; availTop: number; availWidth: number; availHeight: number; isPrimary: boolean }

/**
 * Opens the output page. With the Window Management API (Chrome/Edge) it lands
 * on the second display, i.e. the projector on HDMI; otherwise it opens as a
 * normal window you drag over. Fullscreen needs one click inside it.
 */
export async function goLive(): Promise<void> {
  if (win && !win.closed) {
    win.focus();
    return;
  }
  let features = 'popup,width=1280,height=720';
  try {
    const w = window as unknown as { getScreenDetails?: () => Promise<{ screens: ScreenDetailed[]; currentScreen: ScreenDetailed }> };
    if (w.getScreenDetails) {
      const d = await w.getScreenDetails();
      const other = d.screens.find((s) => s !== d.currentScreen);
      if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    }
  } catch {
    // Permission denied: fall back to a plain window.
  }
  win = window.open('./output.html', 'projection-output', features);
  if (!win) toast('The output window was blocked. Allow pop-ups for this page and press Go Live again.');
}

export function closeOutput(): void {
  if (win && !win.closed) win.close();
  win = null;
  useStore.getState().setUi({ outputOpen: false });
}
