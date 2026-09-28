import { isAuthed, unauthorized } from '@/lib/auth';
import { ROOT, listAll, signedGetUrl } from '@/lib/blob';

export const dynamic = 'force-dynamic';

// Returns signed URLs for every page of a page-split comic, in reading order.
export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !/^[\w-]+$/.test(id)) return Response.json({ error: 'Bad id' }, { status: 400 });
  const objs = (await listAll(`${ROOT}${id}/p/`)).sort((a, b) => a.pathname.localeCompare(b.pathname));
  const pages = await Promise.all(objs.map(async (o) => ({ key: o.pathname, size: o.size, url: await signedGetUrl(o.pathname, 6 * 60) })));
  return Response.json({ pages });
}
