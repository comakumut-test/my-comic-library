// Runs in the browser: turns a comic file into an ordered list of page images.
import { unzip, type Unzipped } from 'fflate';

export type Page = { name: string; blob: Blob };
export type Opened = { kind: 'pages'; pages: Page[] } | { kind: 'pdf'; blob: Blob };

const IMG = /\.(jpe?g|png|gif|webp|avif|bmp|jxl)$/i;
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', jxl: 'image/jxl',
};

export const COMIC_ACCEPT = '.cbz,.cbr,.cb7,.cbt,.zip,.rar,.7z,.tar,.pdf';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const isPage = (path: string) => {
  const p = path.replace(/\\/g, '/');
  const base = p.split('/').pop() ?? '';
  return IMG.test(base) && !p.includes('__MACOSX/') && !base.startsWith('.');
};
const mimeOf = (name: string) => MIME[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
const sortPages = (pages: Page[]) => pages.sort((a, b) => collator.compare(a.name, b.name));

function sniff(b: Uint8Array): 'zip' | 'rar' | '7z' | 'tar' | 'pdf' | null {
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip';
  if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return 'rar';
  if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return '7z';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (String.fromCharCode(...b.subarray(257, 262)) === 'ustar') return 'tar';
  return null;
}

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((res, rej) =>
    unzip(data, { filter: (f) => isPage(f.name) }, (err, out) => (err ? rej(err) : res(out))),
  );
}

function untar(data: Uint8Array): Page[] {
  const pages: Page[] = [];
  const dec = new TextDecoder();
  let off = 0;
  while (off + 512 <= data.length) {
    const h = data.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const str = (s: number, l: number) => dec.decode(h.subarray(s, s + l)).replace(/\0.*$/s, '');
    const prefix = str(345, 155);
    const name = (prefix ? prefix + '/' : '') + str(0, 100);
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156]);
    off += 512;
    if ((type === '0' || type === '\0') && isPage(name)) {
      pages.push({ name, blob: new Blob([data.slice(off, off + size)], { type: mimeOf(name) }) });
    }
    off += Math.ceil(size / 512) * 512;
  }
  return pages;
}

// libarchive (WASM) handles RAR / RAR5 / 7z. Loaded only when needed, from /public/libarchive.
async function viaLibarchive(file: Blob): Promise<Page[]> {
  const url = '/libarchive/libarchive.js';
  const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
  mod.Archive.init({ workerUrl: '/libarchive/worker-bundle.js' });
  const archive = await mod.Archive.open(new File([file], 'comic'));
  const tree = await archive.extractFiles();
  const pages: Page[] = [];
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix + k;
      if (v instanceof File) {
        if (isPage(path)) pages.push({ name: path, blob: new Blob([v], { type: mimeOf(path) }) });
      } else if (v && typeof v === 'object') walk(v as Record<string, unknown>, path + '/');
    }
  };
  walk(tree, '');
  return pages;
}

export async function openComic(file: Blob): Promise<Opened> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const kind = sniff(head);
  if (kind === 'pdf') return { kind: 'pdf', blob: new Blob([file], { type: 'application/pdf' }) };
  let pages: Page[];
  if (kind === 'zip') {
    const out = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
    pages = Object.entries(out).map(([name, d]) => ({ name, blob: new Blob([d as BlobPart], { type: mimeOf(name) }) }));
  } else if (kind === 'tar') {
    pages = untar(new Uint8Array(await file.arrayBuffer()));
  } else if (kind === 'rar' || kind === '7z') {
    pages = await viaLibarchive(file);
  } else {
    throw new Error('Unsupported file type');
  }
  if (!pages.length) throw new Error('No images found in this file');
  return { kind: 'pages', pages: sortPages(pages) };
}

/** Small JPEG thumbnail of a page image, for the library grid. */
export async function thumbnail(image: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(image);
    const w = 360, h = Math.round((bmp.height / bmp.width) * w);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    return await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  } catch {
    return null;
  }
}

/** File extension to keep for a page (falls back to jpg). */
export function pageExt(name: string) {
  const e = (name.split('.').pop() ?? '').toLowerCase();
  return /^(jpe?g|png|gif|webp|avif|bmp|jxl)$/.test(e) ? (e === 'jpeg' ? 'jpg' : e) : 'jpg';
}

/** Rebuilds a .cbz (uncompressed zip) from page images — used for "Download". */
export async function buildCbz(pages: { name: string; blob: Blob }[]): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const p of pages) files[p.name] = [new Uint8Array(await p.blob.arrayBuffer()), { level: 0 }];
  return new Blob([zipSync(files) as BlobPart], { type: 'application/vnd.comicbook+zip' });
}
