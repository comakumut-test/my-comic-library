import { isAuthed, unauthorized } from '@/lib/auth';
import { ROOT, listAll, removeAll, signedGetUrl } from '@/lib/blob';

export const dynamic = 'force-dynamic';

export type Comic = {
  id: string;
  title: string;
  fileName: string;
  pathname?: string; // single-file comics (PDF, or uploaded before page-splitting)
  pages?: number; // page-split comics
  size: number;
  uploadedAt: string;
  cover: string | null;
};

// Layout in the bucket:
//   page-split:   comics/<id>/name/<original name> (empty marker, written last)  +  comics/<id>/p/0001.jpg …
//   single file:  comics/<id>/file/<original name>
//   both:         comics/<id>/cover.jpg
export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const only = new URL(req.url).searchParams.get('id');
  if (only && !/^[\w-]+$/.test(only)) return Response.json({ error: 'Bad id' }, { status: 400 });
  const objects = await listAll(only ? `${ROOT}${only}/` : ROOT);

  const byId = new Map<string, Partial<Comic>>();
  for (const b of objects) {
    const [, id, kind, ...rest] = b.pathname.split('/');
    if (!id) continue;
    const c = byId.get(id) ?? { id, cover: null, size: 0 };
    const named = (fileName: string) => ({
      fileName, uploadedAt: b.uploadedAt.toISOString(),
      title: fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim(),
    });
    if (kind === 'file' && rest.length) {
      Object.assign(c, named(rest.join('/')), { pathname: b.pathname, size: b.size });
    } else if (kind === 'name' && rest.length) {
      Object.assign(c, named(rest.join('/')), { pages: c.pages ?? 0 });
    } else if (kind === 'p') {
      c.pages = (c.pages ?? 0) + 1;
      c.size = (c.size ?? 0) + b.size;
    } else if (kind === 'cover.jpg') {
      c.cover = b.pathname;
    }
    byId.set(id, c);
  }
  const comics = [...byId.values()].filter((c): c is Comic => !!c.fileName && (!!c.pathname || !!c.pages));
  await Promise.all(comics.map(async (c) => { c.cover = c.cover ? await signedGetUrl(c.cover, 12 * 60) : null; }));
  comics.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return Response.json({ comics });
}

export async function DELETE(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !/^[\w-]+$/.test(id)) return Response.json({ error: 'Bad id' }, { status: 400 });
  const objects = await listAll(`${ROOT}${id}/`);
  if (objects.length) await removeAll(objects.map((o) => o.pathname));
  return Response.json({ ok: true, deleted: objects.length });
}
