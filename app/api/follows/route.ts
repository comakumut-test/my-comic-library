import { isAuthed, unauthorized } from '@/lib/auth';
import { readJson, writeJson } from '@/lib/blob';
import { type Follow, FOLLOWS_FILE as FILE, followKey } from '@/lib/follows';

export const dynamic = 'force-dynamic';


export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  return Response.json(await readJson<{ follows: Follow[] }>(FILE, { follows: [] }));
}

// POST { op: 'follow' | 'unfollow', source, seriesId?, series, publisher? }
export async function POST(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const series = String(b.series ?? '').trim().slice(0, 150);
  if (!series) return Response.json({ error: 'Missing series' }, { status: 400 });
  const doc = await readJson<{ follows: Follow[] }>(FILE, { follows: [] });
  const key = followKey(String(b.source ?? 'manual'), b.seriesId ? String(b.seriesId) : undefined, series);
  doc.follows = doc.follows.filter((f) => f.key !== key);
  if (b.op === 'follow') {
    doc.follows.push({ key, source: String(b.source ?? 'manual'), seriesId: b.seriesId ? String(b.seriesId) : undefined, series, publisher: b.publisher, since: Date.now() });
  }
  await writeJson(FILE, doc);
  return Response.json(doc);
}
