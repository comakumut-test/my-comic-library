import { isAuthed, unauthorized } from '@/lib/auth';
import { ROOT, listAll, readText, removeAll, writeObject } from '@/lib/blob';

export const dynamic = 'force-dynamic';

// Folder structure lives in one small JSON file: app/library.json
export type Folder = { id: string; name: string; createdAt: number };
export type Library = { folders: Folder[]; assign: Record<string, string> }; // comicId -> folderId

const FILE = 'app/library.json';

async function read(): Promise<Library> {
  try {
    const t = await readText(FILE);
    const lib = t ? JSON.parse(t) : {};
    return { folders: lib.folders ?? [], assign: lib.assign ?? {} };
  } catch {
    return { folders: [], assign: {} };
  }
}
const save = (lib: Library) => writeObject(FILE, JSON.stringify(lib));
const cleanName = (n: unknown) => String(n ?? '').trim().slice(0, 80);

export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  return Response.json(await read());
}

export async function POST(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const lib = await read();

  switch (body.op) {
    case 'createFolder': {
      const name = cleanName(body.name);
      if (!name) return Response.json({ error: 'Folder name is empty' }, { status: 400 });
      const folder = { id: crypto.randomUUID().slice(0, 8), name, createdAt: Date.now() };
      lib.folders.push(folder);
      await save(lib);
      return Response.json({ ...lib, created: folder });
    }
    case 'renameFolder': {
      const f = lib.folders.find((x) => x.id === body.id);
      const name = cleanName(body.name);
      if (!f || !name) return Response.json({ error: 'Bad request' }, { status: 400 });
      f.name = name;
      break;
    }
    case 'deleteFolder': {
      const ids = Object.entries(lib.assign).filter(([, f]) => f === body.id).map(([c]) => c);
      if (body.withComics) {
        for (const id of ids) {
          if (!/^[\w-]+$/.test(id)) continue;
          const objs = await listAll(`${ROOT}${id}/`);
          if (objs.length) await removeAll(objs.map((o) => o.pathname));
        }
      }
      for (const id of ids) delete lib.assign[id];
      lib.folders = lib.folders.filter((x) => x.id !== body.id);
      await save(lib);
      return Response.json({ ...lib, removedComics: body.withComics ? ids : [] });
    }
    case 'move': {
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      const target = body.folderId && lib.folders.some((f) => f.id === body.folderId) ? body.folderId : null;
      for (const id of ids) {
        if (target) lib.assign[id] = target;
        else delete lib.assign[id];
      }
      break;
    }
    default:
      return Response.json({ error: 'Unknown operation' }, { status: 400 });
  }
  await save(lib);
  return Response.json(lib);
}
