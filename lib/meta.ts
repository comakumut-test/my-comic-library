// Comic metadata providers (server-only). Metron is primary; Comic Vine is an automatic backup.
// Env: METRON_USERNAME + METRON_PASSWORD (or METRON_TOKEN), optional COMICVINE_API_KEY.
// Everything the site keeps (readlists, follows, news) is stored in our own bucket, so a
// provider going away only affects new searches / new weekly lists.

export type MetaIssue = {
  source: 'metron' | 'comicvine';
  sid: string; // provider issue id
  series: string;
  seriesId?: string;
  seriesYear?: number;
  number: string;
  title: string; // e.g. "Saga (2012) #3"
  date?: string; // store date (YYYY-MM-DD)
  image?: string; // provider cover URL
  publisher?: string;
};

const UA = 'ComicShelf/1.0 (personal comic library)';
const METRON = process.env.METRON_URL || 'https://metron.cloud/api';
const CV = process.env.COMICVINE_URL || 'https://comicvine.gamespot.com/api';

export const metronConfigured = () => !!(process.env.METRON_TOKEN || (process.env.METRON_USERNAME && process.env.METRON_PASSWORD));
export const comicVineConfigured = () => !!process.env.COMICVINE_API_KEY;
export const anyProvider = () => metronConfigured() || comicVineConfigured();

async function getJson(url: string, headers: Record<string, string>, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctrl.signal, cache: 'no-store' });
    if (r.status === 429) throw new Error('Metadata service is busy (rate limit). Try again in a minute.');
    if (r.status === 401 || r.status === 403) throw new Error('Metadata login failed — check the credentials in Vercel settings.');
    if (!r.ok) throw new Error(`Metadata service error (${r.status})`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------------- Metron ----------------
function metronHeaders(): Record<string, string> {
  if (process.env.METRON_TOKEN) return { Authorization: `Bearer ${process.env.METRON_TOKEN}` };
  const b = Buffer.from(`${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${b}` };
}

type MetronIssue = {
  id: number; number: string; issue: string; store_date?: string | null; cover_date?: string;
  image?: string | null; series: { id: number; name: string; volume?: number; year_began?: number };
};

const fromMetron = (i: MetronIssue, publisher?: string): MetaIssue => ({
  source: 'metron', sid: String(i.id), series: i.series?.name ?? '', seriesId: String(i.series?.id ?? ''),
  seriesYear: i.series?.year_began, number: i.number, title: i.issue || `${i.series?.name} #${i.number}`,
  date: i.store_date ?? i.cover_date ?? undefined, image: i.image ?? undefined, publisher,
});

async function metronList(params: Record<string, string>, maxPages = 5): Promise<MetronIssue[]> {
  let url: string | null = `${METRON}/issue/?${new URLSearchParams(params)}`;
  const out: MetronIssue[] = [];
  for (let p = 0; url && p < maxPages; p++) {
    const j = await getJson(url, metronHeaders());
    out.push(...(j.results ?? []));
    url = j.next;
  }
  return out;
}

// Publishers shown as their own groups on the News page (matched with Metron's "name contains").
export const PUBLISHERS: { label: string; metron: string; imprint?: string }[] = [
  { label: 'Marvel', metron: 'Marvel' },
  { label: 'DC', metron: 'DC Comics' },
  { label: 'DC Vertigo', metron: 'DC Comics', imprint: 'Vertigo' },
  { label: 'Image', metron: 'Image' },
  { label: 'Dark Horse', metron: 'Dark Horse' },
  { label: 'IDW', metron: 'IDW' },
  { label: 'BOOM! Studios', metron: 'BOOM' },
  { label: 'Dynamite', metron: 'Dynamite' },
];
// Metron allows 20 requests/minute: one weekly refresh = ~3 pages for the whole week + 1 per publisher above.

async function metronWeek(from: string, to: string): Promise<MetaIssue[]> {
  const range = { store_date_range_after: from, store_date_range_before: to };
  const all = await metronList(range, 6);
  const label = new Map<number, string>();
  // Imprints first so e.g. DC Vertigo wins over plain DC.
  const ordered = [...PUBLISHERS].sort((a, b) => Number(!!b.imprint) - Number(!!a.imprint));
  for (const p of ordered) {
    const q: Record<string, string> = { ...range, publisher_name: p.metron };
    if (p.imprint) q.imprint_name = p.imprint;
    try {
      for (const i of await metronList(q, 3)) if (!label.has(i.id)) label.set(i.id, p.label);
    } catch (e) {
      if ((e as Error).message.includes('rate limit')) break; // keep what we have; rest goes to "Other"
      throw e;
    }
  }
  return all.map((i) => fromMetron(i, label.get(i.id) ?? 'Other'));
}

async function metronSearch(q: string): Promise<MetaIssue[]> {
  const m = q.trim().match(/^(.*?)[\s#]+(\d+[A-Za-z.]*)$/);
  const params: Record<string, string> = m ? { series_name: m[1].trim(), number: m[2] } : { series_name: q.trim() };
  const res = await metronList(params, 1);
  return res.map((i) => fromMetron(i));
}

// ---------------- Comic Vine (backup) ----------------
type CvIssue = {
  id: number; name?: string | null; issue_number: string; store_date?: string | null; cover_date?: string | null;
  image?: { medium_url?: string; small_url?: string } | null; volume?: { id: number; name: string } | null;
};
const fromCv = (i: CvIssue): MetaIssue => ({
  source: 'comicvine', sid: String(i.id), series: i.volume?.name ?? '', seriesId: i.volume ? String(i.volume.id) : undefined,
  number: i.issue_number, title: `${i.volume?.name ?? ''} #${i.issue_number}${i.name ? ` — ${i.name}` : ''}`,
  date: i.store_date ?? i.cover_date ?? undefined, image: i.image?.medium_url ?? i.image?.small_url, publisher: 'Other',
});
const cvFields = 'id,name,issue_number,store_date,cover_date,image,volume';
async function cvGet(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ api_key: process.env.COMICVINE_API_KEY!, format: 'json', ...params });
  const j = await getJson(`${CV}/${path}/?${qs}`, {});
  if (j.status_code && j.status_code !== 1) throw new Error(`Comic Vine: ${j.error}`);
  return j.results as CvIssue[];
}
const cvWeek = async (from: string, to: string) =>
  (await cvGet('issues', { filter: `store_date:${from}|${to}`, field_list: cvFields, limit: '100', sort: 'name:asc' })).map(fromCv);
const cvSearch = async (q: string) =>
  (await cvGet('search', { resources: 'issue', query: q, field_list: cvFields, limit: '40' })).map(fromCv);

// ---------------- public API with fallback ----------------
async function withFallback<T>(metron: () => Promise<T>, cv: () => Promise<T>): Promise<{ data: T; source: string }> {
  let firstErr: Error | null = null;
  if (metronConfigured()) {
    try { return { data: await metron(), source: 'metron' }; } catch (e) { firstErr = e as Error; }
  }
  if (comicVineConfigured()) {
    try { return { data: await cv(), source: 'comicvine' }; } catch (e) { firstErr = firstErr ?? (e as Error); }
  }
  throw firstErr ?? new Error('No metadata service is set up yet (add Metron login in Vercel settings).');
}

export const searchIssues = (q: string) => withFallback(() => metronSearch(q), () => cvSearch(q));
export const weekIssues = (from: string, to: string) => withFallback(() => metronWeek(from, to), () => cvWeek(from, to));

/** Monday–Sunday window for a week offset from the current week (UTC dates). */
export function weekRange(offset = 0) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + offset * 7);
  const end = new Date(d);
  end.setUTCDate(d.getUTCDate() + 6);
  const f = (x: Date) => x.toISOString().slice(0, 10);
  return { from: f(d), to: f(end) };
}

/** Only these hosts may be fetched when copying a cover into our bucket. */
export function allowedCoverUrl(u: string) {
  try {
    const h = new URL(u).hostname;
    return /(^|\.)metron\.cloud$/.test(h) || /(^|\.)comicvine\.gamespot\.com$/.test(h) || /(^|\.)gamespot\.com$/.test(h)
      || (!!process.env.METRON_URL && h === new URL(process.env.METRON_URL).hostname);
  } catch {
    return false;
  }
}
