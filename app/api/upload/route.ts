import { isAuthed, unauthorized } from '@/lib/auth';
import { isSafePath, signedPutUrl } from '@/lib/blob';

export const dynamic = 'force-dynamic';

type Item = { pathname: string; contentType?: string };

// Hands the browser short-lived signed URLs so files upload straight to storage.
// Body: { pathname, contentType }  or  { items: [{ pathname, contentType }, ...] } (max 2000)
export async function POST(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body.items) ? body.items : [{ pathname: body.pathname, contentType: body.contentType }];
  if (!items.length || items.length > 2000) return Response.json({ error: 'Bad request' }, { status: 400 });
  if (!items.every((i) => isSafePath(i?.pathname))) return Response.json({ error: 'Bad path' }, { status: 400 });
  const type = (t?: string) => (typeof t === 'string' && t ? t : 'application/octet-stream');
  const urls = await Promise.all(items.map((i) => signedPutUrl(i.pathname, type(i.contentType))));
  return Array.isArray(body.items)
    ? Response.json({ urls })
    : Response.json({ url: urls[0], contentType: type(items[0].contentType) });
}
