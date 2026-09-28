import { isAuthed, unauthorized } from '@/lib/auth';
import { searchIssues } from '@/lib/meta';

export const dynamic = 'force-dynamic';

// GET /api/meta/search?q=Saga 3   (series name, optionally followed by an issue number)
export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 100);
  if (q.length < 2) return Response.json({ results: [] });
  try {
    const { data, source } = await searchIssues(q);
    const results = data.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 60);
    return Response.json({ results, source });
  } catch (e) {
    return Response.json({ results: [], error: (e as Error).message }, { status: 502 });
  }
}
