// Copies the libarchive.js worker + wasm into /public so the browser can load them (for CBR / CB7).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const src = 'node_modules/libarchive.js/dist';
if (existsSync(src)) {
  mkdirSync('public/libarchive', { recursive: true });
  cpSync(src, 'public/libarchive', { recursive: true });
}
