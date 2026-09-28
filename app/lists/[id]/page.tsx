'use client';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { COMIC_ACCEPT } from '@/lib/archive';
import { type Comic, type Progress, fetchProgress, setReadState } from '@/lib/client';
import { type UiItem, type UiList, doneAt, fetchLists, listOp, looksLike, splitList } from '@/lib/lists';
import { OK_EXT, uploadComic } from '@/lib/uploader';
import { Icon, Modal, NameForm, Nav, fmtDate, useCloseOnClick } from '@/components/ui';
import { IssueCover, MetaSearch } from '@/components/meta';

type Dialog =
  | { kind: 'search' } | { kind: 'manual' } | { kind: 'rename' } | { kind: 'delete' }
  | { kind: 'pick'; item?: UiItem } | { kind: 'renameItem'; item: UiItem };

export default function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lists, setLists] = useState<UiList[] | null>(null);
  const [comics, setComics] = useState<Comic[] | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState<Record<string, number>>({}); // itemId -> pct
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<UiItem | null>(null);

  const loadComics = useCallback(() =>
    fetch('/api/comics', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { comics: [] })).then((j) => setComics(j.comics)).catch(() => setComics([])), []);
  useEffect(() => {
    fetchLists().then(setLists).catch((e) => { setErr(e.message); setLists([]); });
    loadComics();
    fetchProgress().then(setProgress);
  }, [loadComics]);
  useCloseOnClick(useCallback(() => setMenu(null), []));

  const list = lists?.find((l) => l.id === id) ?? null;
  const byId = useMemo(() => new Map((comics ?? []).map((c) => [c.id, c])), [comics]);
  const { upNext, done } = list ? splitList(list, progress, comics ? byId : undefined) : { upNext: [], done: [] };

  const op = async (body: Record<string, unknown>) => {
    try {
      const r = await listOp({ listId: id, ...body });
      setLists(r.lists);
      return r;
    } catch (e) { setErr((e as Error).message); }
  };

  const move = (item: UiItem, dir: -1 | 1) => {
    if (!list) return;
    const at = upNext.indexOf(item), other = upNext[at + dir];
    if (!other) return;
    const order = list.items.map((i) => i.id);
    const a = order.indexOf(item.id), b = order.indexOf(other.id);
    [order[a], order[b]] = [order[b], order[a]];
    // optimistic
    setLists((ls) => ls!.map((l) => (l.id === id ? { ...l, items: order.map((oid) => l.items.find((i) => i.id === oid)!) } : l)));
    op({ op: 'reorder', order });
  };

  const setDone = async (item: UiItem, finished: boolean) => {
    const c = item.comicId ? byId.get(item.comicId) : undefined;
    if (c) setProgress(await setReadState([c.id], finished, progress));
    await op({ op: 'setFinished', itemId: item.id, finished });
  };

  const onFile = async (file: File | undefined) => {
    const item = uploadFor.current;
    uploadFor.current = null;
    if (!file || !item) return;
    if (!OK_EXT.test(file.name)) { setErr('That file type is not supported (CBZ, CBR, CB7, CBT, PDF).'); return; }
    const newId = crypto.randomUUID();
    setUploading((u) => ({ ...u, [item.id]: 0 }));
    try {
      await uploadComic(newId, file, (pct) => setUploading((u) => ({ ...u, [item.id]: pct })));
      await op({ op: 'link', itemId: item.id, comicId: newId });
      await loadComics();
    } catch (e) {
      setErr(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading((u) => { const n = { ...u }; delete n[item.id]; return n; });
    }
  };

  if (lists && !list) {
    return (
      <main className="wrap"><p className="muted">This list doesn&apos;t exist anymore.</p><Link className="btn" href="/lists">Back to readlists</Link></main>
    );
  }

  const first = upNext[0];
  const firstComic = first?.comicId ? byId.get(first.comicId) : undefined;

  const row = (item: UiItem, n: number | null) => {
    const c = item.comicId ? byId.get(item.comicId) : undefined;
    const missing = !!item.comicId && !!comics && !c;
    const cover = c?.cover ?? item.coverUrl;
    const p = c ? progress[c.id] : undefined;
    const isDone = n === null;
    const up = uploading[item.id];
    const meta = [item.ref?.publisher && item.ref.publisher !== 'Other' ? item.ref.publisher : '', item.ref?.date ? fmtDate(item.ref.date) : ''].filter(Boolean).join(' · ');
    return (
      <div key={item.id} className={`li-row ${isDone ? 'done' : ''}`}>
        {n !== null && <span className="li-n">{n}</span>}
        <div className="li-cover">{c ? (c.cover ? <img src={c.cover} alt="" /> : <div className="ph" />) : <IssueCover src={cover} />}</div>
        <div className="li-body">
          <div className="li-title">{c ? <Link href={`/read/${c.id}`} prefetch={false}>{item.title}</Link> : item.title}</div>
          <div className="card-meta" style={{ marginTop: 2 }}>
            {isDone ? `Finished ${fmtDate(doneAt(item, progress))}` : meta}
          </div>
          <div className="li-status">
            {up !== undefined ? (
              <span className="muted">Uploading {Math.round(up)}%<span className="prog" style={{ display: 'block', width: 120, marginTop: 4 }}><i style={{ width: `${up}%` }} /></span></span>
            ) : c ? (
              <span className="chip ok-chip">{Icon.check} In library{p && p.page > 0 && !isDone ? ` · page ${p.page + 1}/${p.total}` : ''}</span>
            ) : isDone ? null : (
              <span className="chip warn-chip">{missing ? 'File was deleted' : 'Not uploaded'}</span>
            )}
          </div>
        </div>
        <div className="li-actions">
          {!isDone && c && <Link className="btn small primary" href={`/read/${c.id}`} prefetch={false}>{Icon.play}<span className="hide-sm">{p && p.page > 0 ? 'Continue' : 'Read'}</span></Link>}
          {!isDone && !c && up === undefined && (
            <button className="btn small" onClick={() => { uploadFor.current = item; fileInput.current?.click(); }} title="Upload the file for this issue">
              {Icon.upload}<span className="hide-sm">Upload</span>
            </button>
          )}
          {!isDone && (
            <span className="li-move">
              <button className="btn ghost icon-btn" disabled={n === 1} onClick={() => move(item, -1)} aria-label="Move up">{Icon.up}</button>
              <button className="btn ghost icon-btn" disabled={n === upNext.length} onClick={() => move(item, 1)} aria-label="Move down">{Icon.down}</button>
            </span>
          )}
          {isDone && <button className="btn small ghost" onClick={() => setDone(item, false)}>Move back</button>}
          <span style={{ position: 'relative' }}>
            <button className="btn ghost icon-btn" aria-label="More" onClick={(e) => { e.stopPropagation(); setMenu(menu === item.id ? null : item.id); }}>{Icon.dots}</button>
            {menu === item.id && (
              <div className="dropdown right" onClick={(e) => e.stopPropagation()}>
                {!isDone && <button onClick={() => { setMenu(null); setDone(item, true); }}>Mark finished</button>}
                {!c && <button onClick={() => { setMenu(null); uploadFor.current = item; fileInput.current?.click(); }}>Upload file…</button>}
                <button onClick={() => { setMenu(null); setDialog({ kind: 'pick', item }); }}>{c ? 'Link a different comic…' : 'Link a comic from library…'}</button>
                {item.comicId && <button onClick={() => { setMenu(null); op({ op: 'link', itemId: item.id, comicId: null }); }}>Unlink file</button>}
                <button onClick={() => { setMenu(null); setDialog({ kind: 'renameItem', item }); }}>Rename</button>
                <button className="danger" onClick={() => { setMenu(null); op({ op: 'removeItem', itemId: item.id }); }}>Remove from list</button>
              </div>
            )}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      <header className="top">
        <Link className="btn ghost icon-btn" href="/lists" aria-label="All readlists">{Icon.back}</Link>
        <div className="brand">{Icon.list}<span className="brand-title">{list?.name ?? 'Readlist'}</span></div>
        <Nav />
        {list && (
          <span style={{ position: 'relative' }}>
            <button className="btn ghost icon-btn" aria-label="List options" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'list' ? null : 'list'); }}>{Icon.dots}</button>
            {menu === 'list' && (
              <div className="dropdown right" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setMenu(null); setDialog({ kind: 'rename' }); }}>Rename list</button>
                <button className="danger" onClick={() => { setMenu(null); setDialog({ kind: 'delete' }); }}>Delete list</button>
              </div>
            )}
          </span>
        )}
      </header>
      <input ref={fileInput} type="file" accept={COMIC_ACCEPT} hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />

      <main className="wrap narrow">
        {err && <p className="error" onClick={() => setErr('')}>{err}</p>}
        {!list ? (
          <div className="center-msg" style={{ position: 'static', paddingTop: 80 }}><div><div className="spinner" />Loading…</div></div>
        ) : (
          <>
            <div className="toolbar">
              <button className="btn primary small" onClick={() => setDialog({ kind: 'search' })}>{Icon.search} Find in database</button>
              <button className="btn small" onClick={() => setDialog({ kind: 'pick' })}>{Icon.books} Add from library</button>
              <button className="btn small ghost" onClick={() => setDialog({ kind: 'manual' })}>{Icon.plus} Add manually</button>
            </div>

            {first && (
              firstComic ? (
                <Link href={`/read/${firstComic.id}`} className="resume" prefetch={false}>
                  <div className="resume-cover">{firstComic.cover ? <img src={firstComic.cover} alt="" /> : null}</div>
                  <div className="resume-body">
                    <div className="section-title" style={{ margin: 0 }}>Up next</div>
                    <div className="resume-title">{first.title}</div>
                    <div className="muted">{upNext.length} left in this list</div>
                  </div>
                  <span className="btn primary resume-btn">{Icon.play} Read</span>
                </Link>
              ) : null
            )}

            <div className="section-title">Up next · {upNext.length}</div>
            {upNext.length ? <div className="li">{upNext.map((it, n) => row(it, n + 1))}</div>
              : <p className="muted hint">{list.items.length ? 'All done — nice! Add more issues any time.' : 'This list is empty. Find issues in the comic database, pick comics from your library, or type a title manually.'}</p>}

            {done.length > 0 && <>
              <div className="section-title" style={{ marginTop: 28 }}>Finished · {done.length}</div>
              <div className="li">{done.map((it) => row(it, null))}</div>
            </>}
          </>
        )}
      </main>

      {dialog?.kind === 'search' && lists && <MetaSearch lists={lists} listId={id} onLists={setLists} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'pick' && (
        <LibraryPicker comics={comics ?? []} single={!!dialog.item}
          title={dialog.item ? `Link a comic to “${dialog.item.title}”` : 'Add comics from your library'}
          suggest={dialog.item ? (c) => looksLike(c.title, dialog.item!) : undefined}
          exclude={new Set(list?.items.map((i) => i.comicId).filter(Boolean) as string[])}
          onClose={() => setDialog(null)}
          onPick={async (ids) => {
            if (dialog.item) await op({ op: 'link', itemId: dialog.item.id, comicId: ids[0] });
            else await op({ op: 'addItems', items: ids.map((cid) => ({ comicId: cid, title: byId.get(cid)?.title ?? cid })) });
            setDialog(null);
          }} />
      )}
      {(dialog?.kind === 'manual' || dialog?.kind === 'rename' || dialog?.kind === 'renameItem') && (
        <Modal onClose={() => setDialog(null)}>
          <NameForm
            title={dialog.kind === 'manual' ? 'Add an issue manually' : dialog.kind === 'rename' ? 'Rename list' : 'Rename item'}
            initial={dialog.kind === 'rename' ? list?.name ?? '' : dialog.kind === 'renameItem' ? dialog.item.title : ''}
            placeholder={dialog.kind === 'rename' ? 'List name' : 'e.g. Saga #12'}
            action={dialog.kind === 'manual' ? 'Add' : 'Save'}
            onCancel={() => setDialog(null)}
            onSubmit={async (name) => {
              if (dialog.kind === 'manual') await op({ op: 'addItems', items: [{ title: name }] });
              else if (dialog.kind === 'rename') await op({ op: 'renameList', name });
              else await op({ op: 'rename', itemId: dialog.item.id, title: name });
              setDialog(null);
            }} />
        </Modal>
      )}
      {dialog?.kind === 'delete' && (
        <Modal onClose={() => setDialog(null)}>
          <div className="modal-body">
            <h3>Delete “{list?.name}”?</h3>
            <p className="muted">Only the list is deleted — comics in your library stay where they are.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn danger-btn" onClick={async () => { await op({ op: 'deleteList' }); location.href = '/lists'; }}>Delete list</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function LibraryPicker({ comics, single, title, exclude, suggest, onPick, onClose }: {
  comics: Comic[]; single: boolean; title: string; exclude: Set<string>; suggest?: (c: Comic) => boolean;
  onPick: (ids: string[]) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = comics.filter((c) => !exclude.has(c.id) && (!s || c.title.toLowerCase().includes(s)));
    const good = suggest ? base.filter(suggest) : [];
    return [...good, ...base.filter((c) => !good.includes(c))].slice(0, 200);
  }, [comics, q, exclude, suggest]);
  const toggle = (id: string) => {
    if (single) { onPick([id]); return; }
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  return (
    <Modal onClose={onClose} wide>
      <div className="modal-body">
        <h3>{title}</h3>
        <input className="field" autoFocus placeholder="Search your library…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="results">
          {shown.length === 0 && <p className="muted">No comics found.</p>}
          {shown.map((c) => (
            <button key={c.id} className={`pick ${sel.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>
              <span className="pick-cover">{c.cover ? <img src={c.cover} alt="" loading="lazy" /> : null}</span>
              <span className="ellipsis" style={{ flex: 1, textAlign: 'left' }}>{c.title}{suggest?.(c) ? <span className="chip ok-chip" style={{ marginLeft: 8 }}>match</span> : null}</span>
              {!single && <span className={`sel-dot static ${sel.includes(c.id) ? 'on' : ''}`}>{sel.includes(c.id) ? Icon.check : null}</span>}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {!single && <button className="btn primary" disabled={!sel.length} onClick={() => onPick(sel)}>Add {sel.length || ''}</button>}
        </div>
      </div>
    </Modal>
  );
}
