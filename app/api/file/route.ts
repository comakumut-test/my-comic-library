import { isAuthed, unauthorized } from '@/lib/auth';
import { isSafePath, readObject } from '@/lib/blob';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Fallback: streams a file through this function (used if the direct signed URL can't be fetched).
export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const pathname = new URL(req.url).searchParams.get('pathname');
  if (!isSafePath(pathname)) return Response.json({ error: 'Bad path' }, { status: 400 });

  const r = await readObject(pathname, req.headers.get('if-none-match') ?? undefined);
  if (!r) return new Response('Not found', { status: 404 });
  if (r.status === 304) {
    return new Response(null, { status: 304, headers: { ETag: r.etag ?? '', 'Cache-Control': 'private, no-cache' } });
  }
  return new Response(r.body, {
    headers: {
      'Content-Type': r.contentType || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      ...(r.etag ? { ETag: r.etag } : {}),
      ...(r.size ? { 'Content-Length': String(r.size) } : {}),
      'Cache-Control': 'private, no-cache',
    },
  });
}
