// Browser-side readlist helpers.
import type { ItemRef, ListItem, Readlist } from '@/lib/readlists';
import { type Comic, type Progress, isFinished } from '@/lib/client';

export type { ItemRef };
export type UiItem = ListItem & { coverUrl: string | null };
export type UiList = Omit<Readlist, 'items'> & { items: UiItem[] };
export type MetaIssue = {
  source: string; sid: string; series: string; seriesId?: string; seriesYear?: number; number: string;
  title: string; date?: string; image?: string; publisher?: string; week?: number;
};

export async function fetchLists(): Promise<UiList[]> {
  const r = await fetch('/api/readlists', { cache: 'no-store' });
  if (r.status === 401) { location.href = '/login'; return []; }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
  return (await r.json()).lists;
}
export async function listOp(body: Record<string, unknown>): Promise<{ lists: UiList[]; created?: string; added?: number }> {
  const r = await fetch('/api/readlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}
/** Turns a search/news result into the shape the readlist API stores. */
export const issueToItem = (i: MetaIssue) => ({
  title: i.title,
  ref: { source: i.source, sid: i.sid, series: i.series, seriesId: i.seriesId, number: i.number, title: i.title, date: i.date, publisher: i.publisher, image: i.image },
});

export const itemDone = (i: ListItem, progress: Progress, comics?: Map<string, Comic>) =>
  !!i.finishedAt || (!!i.comicId && (!comics || comics.has(i.comicId)) && isFinished(progress[i.comicId]));

/** Items still to read, in list order, and finished ones (most recent first). */
export function splitList(l: UiList, progress: Progress, comics?: Map<string, Comic>) {
  const upNext = l.items.filter((i) => !itemDone(i, progress, comics));
  const done = l.items.filter((i) => itemDone(i, progress, comics))
    .sort((a, b) => doneAt(b, progress) - doneAt(a, progress));
  return { upNext, done };
}
export const doneAt = (i: ListItem, progress: Progress) => i.finishedAt ?? (i.comicId ? progress[i.comicId]?.at ?? 0 : 0);

// ---------- matching uploaded files to list items ----------
const norm = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/^the\s+/, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9.]+/g, ' ').trim();

/** "Saga 003 (2012) (Digital).cbz" -> { name: 'saga', num: 3 } */
export function parseName(s: string): { name: string; num: number | null } {
  const n = norm(s).replace(/\b(vol|v|volume)\s*\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  const m = n.match(/^(.*?)\s*(?:#|no\.?|issue)?\s*(\d+(?:\.\d+)?)(?:\s+of\s+\d+)?(?:\s.*)?$/);
  if (m && m[1]) return { name: m[1].replace(/\s+/g, ' ').trim(), num: parseFloat(m[2]) };
  return { name: n, num: null };
}
function itemKey(i: ListItem) {
  if (i.ref?.series) return { name: norm(i.ref.series), num: i.ref.number ? parseFloat(i.ref.number) : null };
  return parseName(i.title.replace(/#/g, ' '));
}
/** Does this comic title look like this list item (same series name + same issue number)? */
export function looksLike(title: string, i: ListItem) {
  const a = parseName(title), b = itemKey(i);
  if (!a.name || !b.name) return false;
  const sameName = a.name === b.name || a.name.startsWith(b.name + ' ') || b.name.startsWith(a.name + ' ');
  if (!sameName) return false;
  if (b.num === null || Number.isNaN(b.num)) return a.num === null && a.name === b.name;
  return a.num === b.num;
}
