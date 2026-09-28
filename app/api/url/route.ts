import { isAuthed, unauthorized } from '@/lib/auth';
import { isSafePath, signedGetUrl } from '@/lib/blob';

export const dynamic = 'force-dynamic';

// Returns a short-lived signed URL so the browser downloads the comic directly from storage.
export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const pathname = new URL(req.url).searchParams.get('pathname');
  if (!isSafePath(pathname)) return Response.json({ error: 'Bad path' }, { status: 400 });
  return Response.json({ url: await signedGetUrl(pathname, 60) });
}
