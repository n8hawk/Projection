import type { Clip, ClipSource, Layer, Show } from './types';
import { detectFaces } from '../engine/projector';
import { makeEffect } from '../engine/effects';

function clip(id: string, layerId: string, name: string, start: number, duration: number, source: ClipSource, opacity = 1): Clip {
  return { id, layerId, name, start, duration, source, params: { speed: 1, opacity, scale: 1, rotate: 0 } };
}

const gen = (g: string): ClipSource => ({ kind: 'generator', gen: g });

/** Starter template: a back wall and three boxes in front of one projector. */
export function warehouseBoxes(): Show {
  const boxes = [
    { id: 'box1', name: 'Box 1', pos: [-1.35, 0, -1.2] as [number, number, number], size: [1.1, 1.1, 1.1] as [number, number, number], rotY: 18 },
    { id: 'box2', name: 'Box 2', pos: [0.15, 0, -0.6] as [number, number, number], size: [0.8, 0.8, 0.8] as [number, number, number], rotY: -12 },
    { id: 'box3', name: 'Box 3', pos: [1.45, 0, -1.6] as [number, number, number], size: [0.7, 1.6, 0.7] as [number, number, number], rotY: 30 },
  ];
  const projector = { pos: [0, 1.7, 4.8] as [number, number, number], target: [0, 1.05, -1.4] as [number, number, number], throwRatio: 1.25, brightness: 1 };
  const faces = detectFaces(boxes, projector);
  const wall = { id: 'wall', name: 'Back wall', corners: [[0, 0], [1, 0], [1, 1], [0, 1]] as Show['surfaces'][number]['corners'] };
  const surfaces = [wall, ...faces];

  const kaleido = makeEffect('kaleido', false);
  const color = makeEffect('color', false);
  const trails = makeEffect('trails', true);
  const layers: Layer[] = [
    { id: 'L1', name: 'Background', color: '#9A9EA5', surfaceIds: ['wall'], effects: [makeEffect('kaleido'), makeEffect('color', true), makeEffect('trails')], muted: false },
    { id: 'L2', name: 'Boxes', color: '#90ECFF', surfaceIds: faces.map((f) => f.id), effects: [kaleido, color, trails], muted: false },
  ];
  layers[0].effects[1].params.bright = 0.45;

  return {
    version: 1,
    name: 'Warehouse boxes',
    duration: 32,
    layers,
    surfaces,
    masks: [],
    media: [],
    cues: [
      { id: 'c1', name: 'Intro', time: 0 },
      { id: 'c2', name: 'Build', time: 8 },
      { id: 'c3', name: 'Drop', time: 16 },
      { id: 'c4', name: 'Outro', time: 24 },
    ],
    clips: [
      clip('k1', 'L1', 'Tide', 0, 16, gen('tide')),
      clip('k2', 'L1', 'Waves', 16, 16, gen('waves')),
      clip('k3', 'L2', 'Neon Drift', 0, 8, gen('neon-drift')),
      clip('k4', 'L2', 'Grid Pulse', 8, 8, gen('grid-pulse')),
      clip('k5', 'L2', 'Glitch Lines', 16, 8, gen('glitch-lines')),
      clip('k6', 'L2', 'Plasma', 24, 8, gen('plasma')),
    ],
    stage: { boxes, projector, ambient: 0.1 },
    live: { brightness: 1, blackout: false, speed: 1, hue: 0, fxMix: 1, freeze: false, testPattern: false },
  };
}
