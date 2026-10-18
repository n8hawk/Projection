import * as THREE from 'three';
import type { MediaRef } from '../model/types';
import { getMedia } from './idb';

interface GifFrame { bitmap: ImageBitmap; end: number }

interface Entry {
  kind: MediaRef['kind'];
  texture: THREE.Texture | null;
  aspect: number;
  video?: HTMLVideoElement;
  gif?: { frames: GifFrame[]; total: number; canvas: HTMLCanvasElement; shown: number };
  usedFrame: number;
  error?: string;
}

/** Loads imported loops (video, GIF, still image) and hands out textures in sync with show time. */
export class MediaPool {
  private entries = new Map<string, Entry>();
  private frame = 0;

  status(id: string): 'loading' | 'ready' | 'error' | 'none' {
    const e = this.entries.get(id);
    if (!e) return 'none';
    if (e.error) return 'error';
    return e.texture ? 'ready' : 'loading';
  }

  beginFrame(): void {
    this.frame += 1;
  }

  /** Pauses videos that no clip used this frame. */
  endFrame(): void {
    for (const e of this.entries.values()) {
      if (e.video && e.usedFrame !== this.frame && !e.video.paused) e.video.pause();
    }
  }

  get(ref: MediaRef, mediaTime: number, rate: number, playing: boolean): { texture: THREE.Texture; aspect: number } | null {
    let e = this.entries.get(ref.id);
    if (!e) {
      e = { kind: ref.kind, texture: null, aspect: 16 / 9, usedFrame: 0 };
      this.entries.set(ref.id, e);
      void this.load(ref, e);
    }
    e.usedFrame = this.frame;
    if (!e.texture) return null;
    if (e.video) this.syncVideo(e.video, mediaTime, rate, playing);
    if (e.gif) this.syncGif(e, mediaTime);
    return { texture: e.texture, aspect: e.aspect };
  }

  private async resolveUrl(ref: MediaRef): Promise<string> {
    try {
      const blob = await getMedia(ref.id);
      if (blob) return URL.createObjectURL(blob);
    } catch {
      // Fall back to the URL in the show.
    }
    if (!ref.url) throw new Error('missing');
    return ref.url;
  }

  private async load(ref: MediaRef, e: Entry): Promise<void> {
    try {
      const url = await this.resolveUrl(ref);
      if (ref.kind === 'video') {
        const v = document.createElement('video');
        v.src = url;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = 'auto';
        await new Promise<void>((res, rej) => {
          v.onloadeddata = () => res();
          v.onerror = () => rej(new Error('decode'));
        });
        e.video = v;
        e.aspect = v.videoWidth / Math.max(1, v.videoHeight);
        const t = new THREE.VideoTexture(v);
        e.texture = t;
      } else if (ref.kind === 'gif' && 'ImageDecoder' in window) {
        const data = await (await fetch(url)).arrayBuffer();
        // ImageDecoder is not in every TS DOM lib yet.
        const Decoder = (window as unknown as { ImageDecoder: new (o: object) => any }).ImageDecoder;
        const dec = new Decoder({ data, type: 'image/gif' });
        await dec.tracks.ready;
        const count: number = dec.tracks.selectedTrack.frameCount;
        const frames: GifFrame[] = [];
        let t = 0;
        for (let i = 0; i < count; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          t += Math.max(0.02, (image.duration ?? 100000) / 1e6);
          frames.push({ bitmap: await createImageBitmap(image), end: t });
          image.close();
        }
        const canvas = document.createElement('canvas');
        canvas.width = frames[0].bitmap.width;
        canvas.height = frames[0].bitmap.height;
        e.gif = { frames, total: t, canvas, shown: -1 };
        e.aspect = canvas.width / Math.max(1, canvas.height);
        const tex = new THREE.CanvasTexture(canvas);
        e.texture = tex;
      } else {
        const img = new Image();
        img.src = url;
        await img.decode();
        e.aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        e.texture = tex;
      }
    } catch (err) {
      e.error = String(err);
    }
  }

  private syncVideo(v: HTMLVideoElement, mediaTime: number, rate: number, playing: boolean): void {
    const dur = v.duration || 1;
    const want = ((mediaTime % dur) + dur) % dur;
    const run = playing && rate > 0.01;
    if (run) {
      v.playbackRate = Math.min(4, Math.max(0.1, rate));
      if (Math.abs(v.currentTime - want) > 0.4 && Math.abs(v.currentTime - want) < dur - 0.4) v.currentTime = want;
      if (v.paused) void v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want;
    }
  }

  private syncGif(e: Entry, mediaTime: number): void {
    const g = e.gif!;
    const t = ((mediaTime % g.total) + g.total) % g.total;
    let i = g.frames.findIndex((f) => t < f.end);
    if (i < 0) i = g.frames.length - 1;
    if (i === g.shown) return;
    g.shown = i;
    const ctx = g.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, g.canvas.width, g.canvas.height);
    ctx.drawImage(g.frames[i].bitmap, 0, 0);
    e.texture!.needsUpdate = true;
  }
}
