// On-device cache for comic pages/files, capped at 1 GB.
// Least-recently-read items are removed first. The index (sizes + last use) lives in localStorage.
const LIMIT = 1024 ** 3; // 1 GB
const TARGET = LIMIT * 0.9; // when over the limit, trim down to 90% so we don't trim on every page
const INDEX_KEY = 'cs-cache-index-v2';
const KNOWN_CACHES = ['comic-pages-v1', 'comic-files-v1'];

type Entry = { s: number; t: number; c: string }; // size, last used, cache name
type Index = Record<string, Entry>;

let index: Index | null = null;

// Cache keys must be absolute so every page of the site resolves them to the same entry.
const req = (key: string) => new Request(`${location.origin}/__cache/${key}`);
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function load(): Index {
  if (index) return index;
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) index = JSON.parse(raw);
    else {
      // First run with the size limit: start from an empty cache so the index is accurate.
      index = {};
      KNOWN_CACHES.forEach((c) => caches.delete(c).catch(() => {}));
      localStorage.setItem(INDEX_KEY, '{}');
    }
  } catch {
    index = {};
  }
  return index!;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(index ?? {})); } catch {}
  }, 400);
}

async function trim(keep?: string) {
  const idx = load();
  let total = Object.values(idx).reduce((a, e) => a + e.s, 0);
  if (total <= LIMIT) return;
  const oldestFirst = Object.entries(idx).filter(([k]) => k !== keep).sort((a, b) => a[1].t - b[1].t);
  for (const [k, e] of oldestFirst) {
    if (total <= TARGET) break;
    try { await (await caches.open(e.c)).delete(req(k)); } catch {}
    delete idx[k];
    total -= e.s;
  }
}

export async function cacheGet(cacheName: string, key: string): Promise<Blob | null> {
  try {
    const idx = load();
    const hit = await (await caches.open(cacheName)).match(req(key));
    if (!hit) {
      if (idx[key]) { delete idx[key]; save(); }
      return null;
    }
    const blob = await hit.blob();
    idx[key] = { s: blob.size, t: Date.now(), c: cacheName };
    save();
    return blob;
  } catch {
    return null;
  }
}

export async function cachePut(cacheName: string, key: string, blob: Blob) {
  if (blob.size > LIMIT / 2) return; // never let one huge file push everything else out
  try {
    const idx = load();
    await (await caches.open(cacheName)).put(req(key), new Response(blob));
    idx[key] = { s: blob.size, t: Date.now(), c: cacheName };
    await trim(key);
    save();
  } catch {}
}

/** Removes everything cached for one comic (called when it is deleted). */
export async function cacheDropComic(id: string) {
  try {
    const idx = load();
    const prefix = `comics/${id}/`;
    for (const [k, e] of Object.entries(idx)) {
      if (!k.startsWith(prefix)) continue;
      try { await (await caches.open(e.c)).delete(req(k)); } catch {}
      delete idx[k];
    }
    save();
  } catch {}
}

export function cacheUsage() {
  return Object.values(load()).reduce((a, e) => a + e.s, 0);
}
