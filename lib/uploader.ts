// Browser-side upload of a comic: split into pages (or keep a PDF whole), then PUT straight to storage.
import { openComic, pageExt, thumbnail } from '@/lib/archive';

export const OK_EXT = /\.(cbz|cbr|cb7|cbt|zip|rar|7z|tar|pdf)$/i;
export const safeName = (n: string) => n.replace(/[\\/#?%*:|"<>]+/g, '_').slice(-180);

// Asks our API for a signed URL, then PUTs the file straight to storage (with progress).
export async function upload(pathname: string, file: Blob, contentType: string, onPct?: (n: number) => void) {
  const r = await fetch('/api/upload', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pathname, contentType }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
  const { url } = await r.json();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct?.((e.loaded / e.total) * 100); };
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed: network or CORS error'));
    xhr.send(file);
  });
}

// Uploads many small files (the pages) with a few in flight at once.
export async function uploadMany(items: { pathname: string; blob: Blob; contentType: string }[], onBytes: (n: number) => void) {
  const r = await fetch('/api/upload', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: items.map(({ pathname, contentType }) => ({ pathname, contentType })) }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
  const { urls } = (await r.json()) as { urls: string[] };
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(urls[i], { method: 'PUT', headers: { 'content-type': items[i].contentType }, body: items[i].blob }).catch(() => null);
        if (res?.ok) break;
        if (attempt >= 2) throw new Error(`Upload failed on page ${i + 1}`);
        await new Promise((w) => setTimeout(w, 800 * (attempt + 1)));
      }
      onBytes(items[i].blob.size);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, items.length) }, worker));
}

/** Uploads one comic file under the given id. onState('uploading') fires once pages are extracted. */
export async function uploadComic(id: string, file: File, onPct: (pct: number) => void, onState?: (s: 'uploading') => void) {
  const name = safeName(file.name);
  const opened = await openComic(file);
  onState?.('uploading');
  if (opened.kind === 'pdf') {
    // PDFs stay one file: the browser's PDF viewer already loads them progressively.
    await upload(`comics/${id}/file/${name}`, file, 'application/pdf', onPct);
    return;
  }
  // Split into pages so the reader can start instantly and fetch ahead while you read.
  const cover = await thumbnail(opened.pages[0].blob);
  const items = opened.pages.map((pg, n) => ({
    pathname: `comics/${id}/p/${String(n + 1).padStart(4, '0')}.${pageExt(pg.name)}`,
    blob: pg.blob,
    contentType: pg.blob.type || 'image/jpeg',
  }));
  if (cover) items.unshift({ pathname: `comics/${id}/cover.jpg`, blob: cover, contentType: 'image/jpeg' });
  const totalBytes = items.reduce((a, b) => a + b.blob.size, 0);
  let sent = 0;
  await uploadMany(items, (n) => { sent += n; onPct((sent / totalBytes) * 100); });
  // Written last: the comic only appears in the library once every page is stored.
  await upload(`comics/${id}/name/${name}`, new Blob([]), 'text/plain');
}
