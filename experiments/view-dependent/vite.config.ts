import { defineConfig, type Plugin } from 'vite';
import { createReadStream, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Serve MediaPipe's WASM runtime from node_modules (dev) and copy it into the
// build, so face tracking works offline. The face model itself lives in
// public/models.
const WASM_DIR = resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

function mediapipeWasm(): Plugin {
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe/', (req, res, next) => {
        const file = (req.url ?? '').split('?')[0].replace(/^\//, '');
        if (!WASM_FILES.includes(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(resolve(WASM_DIR, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const file of WASM_FILES) {
        this.emitFile({ type: 'asset', fileName: `mediapipe/${file}`, source: readFileSync(resolve(WASM_DIR, file)) });
      }
    },
  };
}

// Standalone experiment, kept apart from the hub app. `base: './'` lets the
// build run from any folder.
export default defineConfig({
  base: './',
  plugins: [mediapipeWasm()],
  server: { port: 5180 },
  build: { chunkSizeWarningLimit: 4000 },
});
