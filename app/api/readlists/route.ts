import { isAuthed, unauthorized } from '@/lib/auth';
import { readJson, signedGetUrl, writeJson, writeObject } from '@/lib/blob';
import { allowedCoverUrl } from '@/lib/meta';
import { type ItemRef, type ReadlistDoc, READLISTS_FILE as FILE } from '@/lib/readlists';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const load = async (): Promise<ReadlistDoc> => {
  const d = await readJson<ReadlistDoc>(FILE, { lists: [] });
  return { lists: Array.isArray(d.lists) ? d.lists : [] };
};
const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** Copies a provider cover into our bucket so the list keeps working if the provider disappears. */
async function copyCover(source: string, sid: string, url: string): Promise<string | undefined> {
  if (!url || !allowedCoverUrl(url)) return undefined;
  const safe = `${source}-${sid}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const key = `meta/covers/${safe}.jpg`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'ComicShelf/1.0' } }).finally(() => clearTimeout(t));
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !type.startsWith('image/')) return undefined;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return undefined;
    await writeObject(key, buf, type);
    return key;
  } catch {
    return undefined;
  }
}

async function withUrls(doc: ReadlistDoc) {
  return {
    lists: await Promise.all(doc.lists.map(async (l) => ({
      ...l,
      items: await Promise.all(l.items.map(async (i) => ({
        ...i, coverUrl: i.ref?.cover ? await signedGetUrl(i.ref.cover, 240) : null,
      }))),
    }))),
  };
}

export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  return Response.json(await withUrls(await load()));
}

type InItem = { comicId?: string; title?: string; ref?: Partial<ItemRef> & { image?: string } };

export async function POST(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const doc = await load();
  const list = b.listId ? doc.lists.find((l) => l.id === b.listId) : undefined;
  const item = list && b.itemId ? list.items.find((i) => i.id === b.itemId) : undefined;
  const extra: Record<string, unknown> = {};

  switch (b.op) {
    case 'createList': {
      const name = str(b.name, 80);
      if (!name) return bad('List name is empty');
      const l = { id: newId(), name, createdAt: Date.now(), items: [] };
      doc.lists.push(l);
      extra.created = l.id;
      break;
    }
    case 'renameList': {
      const name = str(b.name, 80);
      if (!list || !name) return bad('List not found or empty name');
      list.name = name;
      break;
    }
    case 'deleteList':
      if (!list) return bad('List not found', 404);
      doc.lists = doc.lists.filter((l) => l !== list);
      break;
    case 'addItems': {
      if (!list) return bad('List not found', 404);
      const incoming: InItem[] = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
      let added = 0;
      for (const it of incoming) {
        const comicId = it.comicId ? str(it.comicId, 100) : undefined;
        let ref: ItemRef | undefined;
        if (it.ref?.source && it.ref.sid) {
          ref = {
            source: str(it.ref.source, 20), sid: str(it.ref.sid, 40), series: str(it.ref.series, 150),
            seriesId: it.ref.seriesId ? str(it.ref.seriesId, 40) : undefined, number: it.ref.number ? str(it.ref.number, 20) : undefined,
            title: str(it.ref.title, 200), date: it.ref.date ? str(it.ref.date, 10) : undefined,
            publisher: it.ref.publisher ? str(it.ref.publisher, 60) : undefined,
          };
        }
        const title = str(it.title, 200) || ref?.title || '';
        if (!title && !comicId) continue;
        const dup = list.items.some((x) => (comicId && x.comicId === comicId) || (ref && x.ref && x.ref.source === ref.source && x.ref.sid === ref.sid));
        if (dup) continue;
        if (ref && it.ref?.image) ref.cover = await copyCover(ref.source, ref.sid, String(it.ref.image));
        list.items.push({ id: newId(), title, comicId, ref, addedAt: Date.now() });
        added++;
      }
      extra.added = added;
      break;
    }
    case 'removeItem':
      if (!list || !item) return bad('Item not found', 404);
      list.items = list.items.filter((i) => i !== item);
      break;
    case 'reorder': {
      // order: item ids in the new order (items not mentioned keep their relative order at the end)
      if (!list || !Array.isArray(b.order)) return bad('List not found', 404);
      const pos = new Map<string, number>((b.order as string[]).map((id, n) => [id, n]));
      list.items = [...list.items].sort((x, y) => (pos.get(x.id) ?? 1e9) - (pos.get(y.id) ?? 1e9));
      break;
    }
    case 'setFinished':
      if (!list || !item) return bad('Item not found', 404);
      if (b.finished) item.finishedAt = Date.now();
      else delete item.finishedAt;
      break;
    case 'link':
      if (!list || !item) return bad('Item not found', 404);
      if (b.comicId) item.comicId = str(b.comicId, 100);
      else delete item.comicId;
      break;
    case 'rename':
      if (!list || !item || !str(b.title)) return bad('Item not found', 404);
      item.title = str(b.title);
      break;
    default:
      return bad('Unknown operation');
  }
  await writeJson(FILE, doc);
  return Response.json({ ...(await withUrls(doc)), ...extra });
}
