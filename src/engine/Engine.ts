import * as THREE from 'three';
import type { Clip, Effect, Layer, Show } from '../model/types';
import { activeClip } from '../model/time';
import {
  COLOR_FRAG, COPY_FRAG, FULLSCREEN_VERT, GENERATORS, KALEIDO_FRAG, MASTER_FRAG, MEDIA_FRAG,
  PIN_FRAG, PIN_VERT, TRAILS_FRAG, generatorFrag,
} from './shaders';
import { makeQuadGeometry, updateQuadGeometry } from './quad';
import { MediaPool } from './media';
import { OUTPUT_ASPECT, OUTPUT_H, OUTPUT_W } from './projector';

THREE.ColorManagement.enabled = false;

function makeRT(w = OUTPUT_W, h = OUTPUT_H): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
}

function fsMaterial(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 1 }, uRotate: { value: 0 }, uHue: { value: 0 },
      uAspect: { value: OUTPUT_ASPECT }, ...uniforms,
    },
    depthTest: false,
    depthWrite: false,
  });
}

interface LayerState {
  a: THREE.WebGLRenderTarget;
  b: THREE.WebGLRenderTarget;
  trails: Map<string, [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]>;
  phase: number;
  lastTime: number;
  lastClip: string | null;
  pinMat: THREE.ShaderMaterial;
}

const TEST_FRAG = /* glsl */ `
varying vec3 vUvq;
uniform vec3 uColor;
void main() {
  vec2 uv = vUvq.xy / vUvq.z;
  vec2 g = abs(fract(uv * 8.0) - 0.5);
  float grid = smoothstep(0.47, 0.5, max(g.x, g.y));
  float edge = step(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)), 0.02);
  float diag = step(abs(uv.x - uv.y), 0.006) + step(abs(uv.x + uv.y - 1.0), 0.006);
  vec3 c = uColor * 0.25 + vec3(grid * 0.6) + vec3(edge) + uColor * diag;
  gl_FragColor = vec4(c, 1.0);
}`;

const TEST_COLORS = ['#90ECFF', '#C182D4', '#62D289', '#E9ECF1'];

/**
 * Composes the show at a given time into `output` (1280×720): every layer's
 * active clip is rendered, run through its effects, then corner-pinned onto
 * each surface the layer targets.
 */
export class Engine {
  readonly output = makeRT();
  readonly media = new MediaPool();
  private comp = makeRT();
  private fsScene = new THREE.Scene();
  private fsQuad: THREE.Mesh;
  private cam = new THREE.Camera();
  private genMats = new Map<string, THREE.ShaderMaterial>();
  private mediaMat = fsMaterial(MEDIA_FRAG, { tMedia: { value: null }, uMediaAspect: { value: 1 } });
  private kaleidoMat = fsMaterial(KALEIDO_FRAG, { tSrc: { value: null }, uSegments: { value: 6 }, uZoom: { value: 1 }, uMix: { value: 1 } });
  private colorMat = fsMaterial(COLOR_FRAG, { tSrc: { value: null }, uSat: { value: 1 }, uBright: { value: 1 }, uMix: { value: 1 } });
  private trailsMat = fsMaterial(TRAILS_FRAG, {
    tSrc: { value: null }, tPrev: { value: null }, uLength: { value: 0.6 }, uFade: { value: 0.3 },
    uDrift: { value: 0 }, uMix: { value: 1 }, uTexel: { value: new THREE.Vector2(1 / OUTPUT_W, 1 / OUTPUT_H) },
  });
  private copyMat = fsMaterial(COPY_FRAG, { tSrc: { value: null } });
  private masterMat = fsMaterial(MASTER_FRAG, { tSrc: { value: null }, uBrightness: { value: 1 } });
  private layers = new Map<string, LayerState>();
  private pinScene = new THREE.Scene();
  private pins = new Map<string, THREE.Mesh>();
  private testMats = TEST_COLORS.map((c) => new THREE.ShaderMaterial({
    vertexShader: PIN_VERT, fragmentShader: TEST_FRAG, uniforms: { uColor: { value: new THREE.Color(c) } },
    depthTest: false, depthWrite: false,
  }));

  constructor(private renderer: THREE.WebGLRenderer) {
    this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat);
    this.fsQuad.frustumCulled = false;
    this.fsScene.add(this.fsQuad);
  }

  private pass(mat: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.fsQuad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.cam);
  }

  /** Draws a texture over the renderer's current viewport (used for previews and the output window). */
  blit(tex: THREE.Texture): void {
    this.copyMat.uniforms.tSrc.value = tex;
    this.fsQuad.material = this.copyMat;
    this.renderer.render(this.fsScene, this.cam);
  }

  private genMat(id: string): THREE.ShaderMaterial {
    let m = this.genMats.get(id);
    if (!m) {
      const def = GENERATORS.find((g) => g.id === id) ?? GENERATORS[0];
      m = fsMaterial(generatorFrag(def.body), {});
      this.genMats.set(id, m);
    }
    return m;
  }

  private layerState(id: string): LayerState {
    let s = this.layers.get(id);
    if (!s) {
      s = {
        a: makeRT(), b: makeRT(), trails: new Map(), phase: 0, lastTime: -1, lastClip: null,
        pinMat: new THREE.ShaderMaterial({
          vertexShader: PIN_VERT, fragmentShader: PIN_FRAG,
          uniforms: { tLayer: { value: null }, uOpacity: { value: 1 } },
          transparent: true, depthTest: false, depthWrite: false,
        }),
      };
      this.layers.set(id, s);
    }
    return s;
  }

  /** Advances the clip's own clock smoothly, so the Speed knob never makes the visual jump. */
  private clipPhase(st: LayerState, clip: Clip, time: number, show: Show): number {
    const rate = clip.params.speed * show.live.speed;
    const dt = time - st.lastTime;
    if (st.lastClip !== clip.id || st.lastTime < 0 || dt < 0 || dt > 0.5) {
      st.phase = (time - clip.start) * rate;
    } else if (!show.live.freeze) {
      st.phase += dt * rate;
    }
    st.lastClip = clip.id;
    st.lastTime = time;
    return st.phase;
  }

  private renderLayer(layer: Layer, clip: Clip, show: Show, time: number, playing: boolean): THREE.Texture | null {
    const st = this.layerState(layer.id);
    const phase = this.clipPhase(st, clip, time, show);
    const p = clip.params;
    const hue = show.live.hue;
    if (clip.source.kind === 'generator') {
      const m = this.genMat(clip.source.gen);
      m.uniforms.uTime.value = phase;
      m.uniforms.uScale.value = p.scale;
      m.uniforms.uRotate.value = p.rotate;
      m.uniforms.uHue.value = hue;
      this.pass(m, st.a);
    } else {
      const mediaId = clip.source.mediaId;
      const ref = show.media.find((x) => x.id === mediaId);
      const got = ref ? this.media.get(ref, phase, p.speed * show.live.speed, playing && !show.live.freeze) : null;
      if (!got) return null;
      const m = this.mediaMat;
      m.uniforms.tMedia.value = got.texture;
      m.uniforms.uMediaAspect.value = got.aspect;
      m.uniforms.uScale.value = p.scale;
      m.uniforms.uRotate.value = p.rotate;
      m.uniforms.uHue.value = hue;
      this.pass(m, st.a);
    }
    let src = st.a;
    let dst = st.b;
    for (const fx of layer.effects) {
      if (!fx.enabled) continue;
      this.applyEffect(fx, st, src, dst, show.live.fxMix);
      [src, dst] = [dst, src];
    }
    return src.texture;
  }

  private applyEffect(fx: Effect, st: LayerState, src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, mix: number): void {
    const p = fx.params;
    if (fx.type === 'kaleido') {
      const u = this.kaleidoMat.uniforms;
      u.tSrc.value = src.texture; u.uSegments.value = p.segments; u.uRotate.value = p.rotate; u.uZoom.value = p.zoom; u.uMix.value = mix;
      this.pass(this.kaleidoMat, dst);
    } else if (fx.type === 'color') {
      const u = this.colorMat.uniforms;
      u.tSrc.value = src.texture; u.uHue.value = p.hue; u.uSat.value = p.saturate; u.uBright.value = p.bright; u.uMix.value = mix;
      this.pass(this.colorMat, dst);
    } else {
      let pair = st.trails.get(fx.id);
      if (!pair) { pair = [makeRT(), makeRT()]; st.trails.set(fx.id, pair); }
      const u = this.trailsMat.uniforms;
      u.tSrc.value = src.texture; u.tPrev.value = pair[0].texture;
      u.uLength.value = p.length; u.uFade.value = p.fade; u.uDrift.value = p.drift; u.uMix.value = mix;
      this.pass(this.trailsMat, pair[1]);
      st.trails.set(fx.id, [pair[1], pair[0]]);
      this.copyMat.uniforms.tSrc.value = pair[1].texture;
      this.pass(this.copyMat, dst);
    }
  }

  private pin(key: string, corners: Show['surfaces'][number]['corners'], mat: THREE.Material, order: number): void {
    let mesh = this.pins.get(key);
    if (!mesh) {
      mesh = new THREE.Mesh(makeQuadGeometry(), mat);
      mesh.frustumCulled = false;
      this.pins.set(key, mesh);
    }
    updateQuadGeometry(mesh.geometry, corners);
    mesh.material = mat;
    mesh.renderOrder = order;
    this.pinScene.add(mesh);
  }

  render(show: Show, time: number, playing: boolean): void {
    const prevTarget = this.renderer.getRenderTarget();
    const prevScissor = this.renderer.getScissorTest();
    this.renderer.setScissorTest(false);
    this.media.beginFrame();
    this.pinScene.clear();
    let order = 0;
    if (show.live.testPattern) {
      show.surfaces.forEach((s, i) => this.pin(`test:${s.id}`, s.corners, this.testMats[i % this.testMats.length], order++));
    } else {
      for (const layer of show.layers) {
        if (layer.muted || layer.surfaceIds.length === 0) continue;
        const clip = activeClip(show, layer.id, time);
        if (!clip) { this.layerState(layer.id).lastClip = null; continue; }
        const tex = this.renderLayer(layer, clip, show, time, playing);
        if (!tex) continue;
        const st = this.layerState(layer.id);
        st.pinMat.uniforms.tLayer.value = tex;
        st.pinMat.uniforms.uOpacity.value = clip.params.opacity;
        for (const sid of layer.surfaceIds) {
          const s = show.surfaces.find((x) => x.id === sid);
          if (s) this.pin(`${layer.id}:${s.id}`, s.corners, st.pinMat, order++);
        }
      }
    }
    this.media.endFrame();
    this.renderer.setRenderTarget(this.comp);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.pinScene, this.cam);
    this.masterMat.uniforms.tSrc.value = this.comp.texture;
    this.masterMat.uniforms.uBrightness.value = show.live.blackout ? 0 : show.live.brightness;
    this.pass(this.masterMat, this.output);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setScissorTest(prevScissor);
  }
}
