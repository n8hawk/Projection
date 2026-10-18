// Show document. Everything here is plain JSON so it can be saved, undone and
// sent to the output window as-is.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Corners in normalized output space (0..1, y down), order TL, TR, BR, BL. */
export type Quad = [Vec2, Vec2, Vec2, Vec2];

export type FaceName = 'front' | 'back' | 'left' | 'right' | 'top';

export interface Surface {
  id: string;
  name: string;
  corners: Quad;
  /** Set when the surface was created by auto-map from a stage object. */
  bind?: { boxId: string; face: FaceName };
}

export type EffectType = 'kaleido' | 'color' | 'trails';

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: Record<string, number>;
}

export interface Layer {
  id: string;
  name: string;
  color: string;
  surfaceIds: string[];
  effects: Effect[];
  muted: boolean;
}

export type ClipSource =
  | { kind: 'generator'; gen: string }
  | { kind: 'media'; mediaId: string };

export interface ClipParams {
  speed: number;   // 0..4 ×
  opacity: number; // 0..1
  scale: number;   // 0.25..4 ×
  rotate: number;  // degrees -180..180
}

export interface Clip {
  id: string;
  layerId: string;
  name: string;
  start: number;    // seconds
  duration: number; // seconds
  source: ClipSource;
  params: ClipParams;
}

export interface MediaRef {
  id: string;
  name: string;
  kind: 'video' | 'gif' | 'image';
  /** blob: URL, valid only while the editor tab that imported it is open. */
  url: string;
}

export interface BoxDef {
  id: string;
  name: string;
  pos: Vec3;  // center of the bottom face
  size: Vec3; // width, height, depth (metres)
  rotY: number; // degrees
}

export interface ProjectorDef {
  pos: Vec3;
  target: Vec3;
  throwRatio: number; // distance / image width
  brightness: number; // 0..1 simulated lumens
}

export interface StageDef {
  boxes: BoxDef[];
  projector: ProjectorDef;
  ambient: number;
}

export interface LiveControls {
  brightness: number;
  blackout: boolean;
  speed: number;  // macro multiplier on all clips
  hue: number;    // degrees, added to every layer
  fxMix: number;  // 0..1 wet amount of all effects
  freeze: boolean;
  /** Draws a numbered grid on every surface, for lining up with the real object. */
  testPattern: boolean;
}

export interface Cue {
  id: string;
  name: string;
  time: number;
}

export interface Show {
  version: 1;
  name: string;
  duration: number;
  layers: Layer[]; // index 0 is the bottom layer
  clips: Clip[];
  surfaces: Surface[];
  media: MediaRef[];
  cues: Cue[];
  stage: StageDef;
  live: LiveControls;
}

export interface Transport {
  playing: boolean;
  /** Show time at the moment of anchorWall. */
  anchorTime: number;
  /** Date.now() when the transport was last started or seeked. */
  anchorWall: number;
  loop: boolean;
}
