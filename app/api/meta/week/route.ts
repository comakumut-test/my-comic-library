import { isAuthed, unauthorized } from '@/lib/auth';
import { getWeek } from '@/lib/news';
import { PUBLISHERS } from '@/lib/meta';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET /api/meta/week?offset=0  (-1 last week, 1 next week)  &refresh=1 to force
export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const u = new URL(req.url);
  const offset = Math.max(-8, Math.min(4, Number(u.searchParams.get('offset') ?? 0) || 0));
  const week = await getWeek(offset, u.searchParams.get('refresh') === '1');
  return Response.json({ ...week, publishers: [...PUBLISHERS.map((p) => p.label), 'Other'] });
}
