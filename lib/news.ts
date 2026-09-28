// Weekly release lists, cached in our bucket (app/news/<monday>.json). Server-only.
import { readJson, writeJson } from '@/lib/blob';
import { type MetaIssue, anyProvider, weekIssues, weekRange } from '@/lib/meta';

export type NewsWeek = { from: string; to: string; fetchedAt: number; source?: string; issues: MetaIssue[]; error?: string };

const key = (from: string) => `app/news/${from}.json`;
const HOUR = 3600_000;

export async function cachedWeek(offset: number): Promise<NewsWeek | null> {
  const { from } = weekRange(offset);
  return readJson<NewsWeek | null>(key(from), null);
}

/** Returns the week's list, refreshing it from the provider when old (or when forced). */
export async function getWeek(offset: number, force = false): Promise<NewsWeek & { stale?: boolean }> {
  const { from, to } = weekRange(offset);
  const cached = await readJson<NewsWeek | null>(key(from), null);
  const maxAge = offset < 0 ? 7 * 24 * HOUR : 6 * HOUR; // past weeks rarely change
  const fresh = cached && Date.now() - cached.fetchedAt < maxAge;
  if (fresh && !force) return cached!;
  if (!anyProvider()) return cached ?? { from, to, fetchedAt: 0, issues: [], error: 'not-configured' };
  // Don't hammer the provider: at most one refresh attempt per 10 minutes per week.
  if (force && cached && Date.now() - cached.fetchedAt < 10 * 60_000) return cached;
  try {
    const { data, source } = await weekIssues(from, to);
    const week: NewsWeek = { from, to, fetchedAt: Date.now(), source, issues: data };
    await writeJson(key(from), week);
    return week;
  } catch (e) {
    if (cached) return { ...cached, stale: true, error: (e as Error).message };
    return { from, to, fetchedAt: 0, issues: [], error: (e as Error).message };
  }
}
