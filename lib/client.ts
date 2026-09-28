// Browser-side helpers shared by the library and reader.
export type Comic = {
  id: string; title: string; fileName: string; pathname?: string; pages?: number;
  size: number; uploadedAt: string; cover: string | null;
};
export type ProgressEntry = { page: number; total: number; at: number; read?: boolean };
export type Progress = Record<string, ProgressEntry>;
export type Folder = { id: string; name: string; createdAt: number };
export type Library = { folders: Folder[]; assign: Record<string, string> };

const LOCAL = 'cs-progress';

export function localProgress(): Progress {
  try { return JSON.parse(localStorage.getItem(LOCAL) ?? '{}'); } catch { return {}; }
}
export function saveLocalProgress(id: string, page: number, total: number, read?: boolean) {
  const entry: ProgressEntry = { page, total, at: Date.now() };
  try {
    const p = localProgress();
    entry.read = read ?? p[id]?.read ?? false;
    p[id] = entry;
    localStorage.setItem(LOCAL, JSON.stringify(p));
  } catch {}
  return entry;
}

/** Marks comics as read / unread (unread also rewinds to the first page). */
export async function setReadState(ids: string[], read: boolean, current: Progress) {
  const patch: Progress = {};
  for (const id of ids) {
    const old = current[id];
    patch[id] = { page: read ? old?.page ?? 0 : 0, total: old?.total ?? 0, at: Date.now(), read };
    try {
      const p = localProgress(); p[id] = patch[id]; localStorage.setItem(LOCAL, JSON.stringify(p));
    } catch {}
  }
  await pushProgress(patch);
  return { ...current, ...patch };
}

export async function libraryOp(body: Record<string, unknown>): Promise<Library & { error?: string }> {
  const r = await fetch('/api/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export const isFinished = (p?: ProgressEntry) => !!p && (p.read === true || (p.read === undefined && p.total > 0 && p.page >= p.total - 1));
export const isStarted = (p?: ProgressEntry) => !!p && !isFinished(p) && p.page > 0;
export function mergeProgress(a: Progress, b: Progress): Progress {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || v.at > out[k].at) out[k] = v;
  return out;
}
export async function fetchProgress(): Promise<Progress> {
  const local = localProgress();
  try {
    const r = await fetch('/api/progress', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login'; return local; }
    return mergeProgress(local, r.ok ? await r.json() : {});
  } catch { return local; }
}
export function pushProgress(entries: Progress | Record<string, null>, keepalive = false) {
  return fetch('/api/progress', {
    method: 'POST', keepalive, headers: { 'content-type': 'application/json' }, body: JSON.stringify(entries),
  }).catch(() => {});
}

export function formatSize(n: number) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(0) + ' MB';
  return Math.max(1, Math.round(n / 1e3)) + ' KB';
}
export function extOf(name: string) {
  return (name.split('.').pop() ?? '').toUpperCase();
}
