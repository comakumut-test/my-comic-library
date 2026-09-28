// Followed series (stored in app/follows.json). Shared by the follows + alerts routes.
export type Follow = { key: string; source: string; seriesId?: string; series: string; publisher?: string; since: number };
export const FOLLOWS_FILE = 'app/follows.json';
export const normName = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const followKey = (source: string, seriesId: string | undefined, series: string) =>
  seriesId ? `${source}:${seriesId}` : `name:${normName(series)}`;
