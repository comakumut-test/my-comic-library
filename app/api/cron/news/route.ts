import { getWeek } from '@/lib/news';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// Called once a day by Vercel Cron (vercel.json). Safe to call publicly: it only refreshes
// the cached weekly lists, and getWeek() skips work when the cache is still fresh.
export async function GET() {
  const now = await getWeek(0);
  // Metron allows 20 requests per minute; wait before refreshing next week too.
  await new Promise((r) => setTimeout(r, 65_000));
  const next = await getWeek(1);
  return Response.json({ ok: true, thisWeek: now.issues.length, nextWeek: next.issues.length, error: now.error ?? next.error });
}
