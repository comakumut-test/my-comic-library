import { isAuthed, unauthorized } from '@/lib/auth';
import { readJson } from '@/lib/blob';
import { cachedWeek } from '@/lib/news';
import { type Follow, FOLLOWS_FILE, normName } from '@/lib/follows';

export const dynamic = 'force-dynamic';

// New issues this week / next week from series you follow (uses cached weekly lists only).
export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const { follows } = await readJson<{ follows: Follow[] }>(FOLLOWS_FILE, { follows: [] });
  if (!follows.length) return Response.json({ issues: [] });
  const keys = new Set(follows.map((f) => f.key));
  const names = new Set(follows.map((f) => normName(f.series)));
  const out = [];
  for (const offset of [0, 1]) {
    const w = await cachedWeek(offset);
    for (const i of w?.issues ?? []) {
      if ((i.seriesId && keys.has(`${i.source}:${i.seriesId}`)) || names.has(normName(i.series))) out.push({ ...i, week: offset });
    }
  }
  return Response.json({ issues: out });
}
