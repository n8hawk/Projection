// GLSL for built-in generators, media sources, effects and compositing.

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COMMON = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uScale;
uniform float uRotate;
uniform float uHue;
uniform float uAspect;
#define PI 3.14159265
vec3 hueShift(vec3 c, float deg) {
  float a = radians(deg);
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 rot(vec2 p, float deg) { float a = radians(deg); return mat2(cos(a), -sin(a), sin(a), cos(a)) * p; }
const vec3 CYAN = vec3(0.565, 0.925, 1.0);
const vec3 VIOLET = vec3(0.757, 0.51, 0.831);
const vec3 GREEN = vec3(0.384, 0.824, 0.537);
`;

export interface GeneratorDef {
  id: string;
  name: string;
  /** CSS background used for the source tile. */
  thumb: string;
  body: string;
}

export const GENERATORS: GeneratorDef[] = [
  {
    id: 'neon-drift',
    name: 'Neon Drift',
    thumb: 'radial-gradient(circle at 30% 40%, #90ECFF 0 10%, transparent 34%), repeating-radial-gradient(circle at 60% 60%, #123E4A 0 5px, #0A1214 5px 12px)',
    body: /* glsl */ `
vec3 gen(vec2 p, float t) {
  vec2 c = vec2(sin(t * 0.4) * 0.3, cos(t * 0.31) * 0.2);
  float d = length(p - c);
  float rings = 0.5 + 0.5 * sin(d * 28.0 - t * 3.0);
  rings = pow(rings, 6.0);
  float glow = 0.06 / (d + 0.05);
  return CYAN * (rings * 0.8 + glow * 0.5) + VIOLET * pow(0.5 + 0.5 * sin(d * 9.0 + t), 8.0) * 0.4;
}`,
  },
  {
    id: 'glitch-lines',
    name: 'Glitch Lines',
    thumb: 'repeating-linear-gradient(180deg, #C182D4 0 2px, #111214 2px 7px, #62D289 7px 8px, #111214 8px 14px)',
    body: /* glsl */ `
vec3 gen(vec2 p, float t) {
  float row = floor(p.y * 36.0);
  float step_ = floor(t * 8.0);
  float off = (hash(row + step_ * 13.1) - 0.5) * 0.6 * step(0.7, hash(row * 3.7 + step_));
  float x = p.x + off;
  float band = step(0.55, fract(p.y * 36.0));
  float seg = step(0.35, hash(floor(x * 6.0 + t * 0.5) + row * 7.0));
  vec3 col = mix(VIOLET, GREEN, step(0.85, hash(row + 0.5)));
  return col * band * seg;
}`,
  },
  {
    id: 'waves',
    name: 'Waves',
    thumb: 'repeating-linear-gradient(160deg, #D3D8DD 0 2px, #1A1B1D 2px 9px)',
    body: /* glsl */ `
vec3 gen(vec2 p, float t) {
  float v = p.x * 0.35 + p.y + 0.08 * sin(p.x * 6.0 + t * 1.5);
  float l = abs(fract(v * 9.0 - t * 0.4) - 0.5);
  float line = smoothstep(0.12, 0.0, l);
  return vec3(0.83, 0.85, 0.87) * line;
}`,
  },
  {
    id: 'plasma',
    name: 'Plasma',
    thumb: 'radial-gradient(circle at 40% 60%, #62D289, #1E7E4A 45%, #0A2A14 80%)',
    body: /* glsl */ `
vec3 gen(vec2 p, float t) {
  float v = sin(p.x * 5.0 + t) + sin(p.y * 6.0 - t * 0.8) + sin((p.x + p.y) * 4.0 + t * 0.6) + sin(length(p) * 8.0 - t * 1.2);
  v *= 0.25;
  vec3 a = mix(GREEN, CYAN, 0.5 + 0.5 * sin(v * PI));
  return mix(vec3(0.02), a, smoothstep(-0.6, 0.8, v));
}`,
  },
  {
    id: 'grid-pulse',
    name: 'Grid Pulse',
    thumb: 'repeating-linear-gradient(0deg, #90ECFF 0 1px, transparent 1px 12px), repeating-linear-gradient(90deg, #90ECFF 0 1px, #0B1416 1px 12px)',
    body: /* glsl */ `
vec3 gen(vec2 p, float t) {
  vec2 g = abs(fract(p * 8.0) - 0.5);
  float line = smoothstep(0.05, 0.0, min(g.x, g.y));
  float pulse = pow(0.5 + 0.5 * sin(length(p) * 10.0 - t * 4.0), 4.0);
  vec2 cell = floor(p * 8.0);
  float flash = step(0.92, hash2(cell + floor(t * 2.0)));
  return CYAN * line * (0.25 + pulse) + VIOLET * flash * 0.6;
}`,
  },
  {
    id: 'tide',
    name: 'Tide',
    thumb: 'repeating-radial-gradient(circle at 30% 70%, #C182D4 0 4px, #2A1430 4px 10px)',
    body: /* glsl */ `
vec3 gen(vec2 p, float t) {
  float d1 = length(p - vec2(-0.6, 0.4));
  float d2 = length(p - vec2(0.7, -0.3));
  float w = sin(d1 * 22.0 - t * 2.0) + sin(d2 * 18.0 - t * 1.6);
  float v = smoothstep(0.6, 1.6, w);
  return mix(vec3(0.06, 0.03, 0.08), VIOLET, v) + CYAN * smoothstep(1.7, 2.0, w) * 0.6;
}`,
  },
];

export function generatorFrag(body: string): string {
  return COMMON + body + /* glsl */ `
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  p = rot(p, uRotate) / max(uScale, 0.01);
  vec3 col = gen(p, uTime);
  gl_FragColor = vec4(hueShift(col, uHue), 1.0);
}`;
}

export const MEDIA_FRAG = COMMON + /* glsl */ `
uniform sampler2D tMedia;
uniform float uMediaAspect;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  p = rot(p, uRotate) / max(uScale, 0.01);
  // Cover-fit the media into the frame.
  vec2 uv = p;
  if (uMediaAspect > uAspect) uv.x /= uMediaAspect; else { uv.x /= uAspect; uv.y *= uAspect / uMediaAspect; }
  uv += 0.5;
  vec3 col = texture2D(tMedia, uv).rgb;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  gl_FragColor = vec4(hueShift(col, uHue) * inside, 1.0);
}`;

export const KALEIDO_FRAG = COMMON + /* glsl */ `
uniform sampler2D tSrc;
uniform float uSegments;
uniform float uZoom;
uniform float uMix;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p) / max(uZoom, 0.05);
  float a = atan(p.y, p.x) + radians(uRotate);
  float seg = 2.0 * PI / max(floor(uSegments), 2.0);
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r;
  vec2 uv = q / vec2(uAspect, 1.0) + 0.5;
  vec3 wet = texture2D(tSrc, fract(uv)).rgb;
  vec3 dry = texture2D(tSrc, vUv).rgb;
  gl_FragColor = vec4(mix(dry, wet, uMix), 1.0);
}`;

export const COLOR_FRAG = COMMON + /* glsl */ `
uniform sampler2D tSrc;
uniform float uSat;
uniform float uBright;
uniform float uMix;
void main() {
  vec3 dry = texture2D(tSrc, vUv).rgb;
  vec3 c = hueShift(dry, uHue);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat) * uBright;
  gl_FragColor = vec4(mix(dry, c, uMix), 1.0);
}`;

export const TRAILS_FRAG = COMMON + /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tPrev;
uniform float uLength;
uniform float uFade;
uniform float uDrift;
uniform float uMix;
uniform vec2 uTexel;
void main() {
  vec3 src = texture2D(tSrc, vUv).rgb;
  vec2 uv = (vUv - 0.5) * (1.0 - uDrift * 0.05) + 0.5;
  vec2 o = uTexel * (1.0 + uFade * 4.0);
  vec3 prev = (texture2D(tPrev, uv + vec2(o.x, 0.0)) + texture2D(tPrev, uv - vec2(o.x, 0.0)) +
               texture2D(tPrev, uv + vec2(0.0, o.y)) + texture2D(tPrev, uv - vec2(0.0, o.y))).rgb * 0.25;
  vec3 wet = max(src, prev * uLength * 0.97);
  gl_FragColor = vec4(mix(src, wet, uMix), 1.0);
}`;

export const COPY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
void main() { gl_FragColor = texture2D(tSrc, vUv); }
`;

export const PIN_VERT = /* glsl */ `
attribute vec3 uvq;
varying vec3 vUvq;
void main() { vUvq = uvq; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const PIN_FRAG = /* glsl */ `
varying vec3 vUvq;
uniform sampler2D tLayer;
uniform float uOpacity;
uniform float uFeather;
uniform float uGain;
void main() {
  vec2 uv = vUvq.xy / vUvq.z;
  // Soft edge: fade out over uFeather of the surface's width/height at every border.
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float a = uFeather > 0.0 ? smoothstep(0.0, uFeather, edge) : 1.0;
  gl_FragColor = vec4(texture2D(tLayer, uv).rgb * uGain, uOpacity * a);
}`;

export const MASK_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const MASK_FRAG = /* glsl */ `
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }
`;

export const MASTER_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uBrightness;
void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uBrightness, 1.0); }
`;
