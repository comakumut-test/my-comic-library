'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { COMIC_ACCEPT } from '@/lib/archive';
import { cacheDropComic } from '@/lib/pagecache';
import {
  type Comic, type Folder, type Library, type Progress, extOf, fetchProgress, formatSize, isFinished, isStarted,
  libraryOp, pushProgress, setReadState,
} from '@/lib/client';
import { OK_EXT, uploadComic } from '@/lib/uploader';
import { type MetaIssue, type UiItem, type UiList, fetchLists, listOp, looksLike, splitList } from '@/lib/lists';
import { Icon, Modal, NameForm, Nav, fmtDate, logout } from '@/components/ui';
import { AddToListDialog } from '@/components/meta';

type Job = { key: string; name: string; pct: number; state: 'cover' | 'uploading' | 'done' | 'error'; error?: string };
type Filter = 'all' | 'unread' | 'reading' | 'read';
type Dialog =
  | { kind: 'newFolder'; moveIds?: string[] }
  | { kind: 'rename'; folder: Folder }
  | { kind: 'deleteFolder'; folder: Folder; count: number }
  | { kind: 'move'; ids: string[] }
  | { kind: 'deleteComics'; ids: string[] }
  | { kind: 'addToList'; ids: string[] }
  | { kind: 'match'; pairs: Match[] };
type Match = { comic: { id: string; title: string }; list: UiList; item: UiItem };
const SEEN_KEY = 'cs-alerts-seen';

export default function Page() {
  return <Suspense><LibraryView /></Suspense>;
}

function LibraryView() {
  const router = useRouter();
  const folderId = useSearchParams().get('folder');
  const [comics, setComics] = useState<Comic[] | null>(null);
  const [lib, setLib] = useState<Library>({ folders: [], assign: {} });
  const [progress, setProgress] = useState<Progress>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [lists, setLists] = useState<UiList[]>([]);
  const [alerts, setAlerts] = useState<MetaIssue[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const folderRef = useRef(folderId);
  folderRef.current = folderId;

  const folder = lib.folders.find((f) => f.id === folderId) ?? null;

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([fetch('/api/comics', { cache: 'no-store' }), fetch('/api/library', { cache: 'no-store' })]);
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      setComics((await r.json()).comics);
      if (l.ok) setLib(await l.json());
      setErr('');
    } catch (e) {
      setErr(`Couldn't load your library: ${(e as Error).message}`);
      setComics((c) => c ?? []);
    }
  }, []);

  useEffect(() => {
    load(); fetchProgress().then(setProgress);
    fetchLists().then(setLists).catch(() => {});
    fetch('/api/meta/alerts', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { issues: [] })).then((j) => {
      let seen: string[] = [];
      try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); } catch {}
      setAlerts((j.issues as MetaIssue[]).filter((i) => !seen.includes(`${i.source}:${i.sid}`)));
    }).catch(() => {});
  }, [load]);

  const dismissAlerts = () => {
    try {
      const seen: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
      const next = [...new Set([...seen, ...alerts.map((i) => `${i.source}:${i.sid}`)])].slice(-500);
      localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {}
    setAlerts([]);
  };
  useEffect(() => { setSelected(new Set()); setSelecting(false); setMenu(null); }, [folderId]);
  useEffect(() => {
    const close = () => setMenu(null);
    addEventListener('click', close);
    return () => removeEventListener('click', close);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { setErr((e as Error).message); }
  };

  const setJob = (key: string, patch: Partial<Job>) =>
    setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  async function uploadFiles(files: File[]) {
    const list = files.filter((f) => OK_EXT.test(f.name));
    if (!list.length) return;
    const target = folderRef.current;
    const newJobs = list.map((f) => ({ key: crypto.randomUUID(), name: f.name, pct: 0, state: 'cover' as const }));
    setJobs((js) => [...js.filter((j) => j.state !== 'done'), ...newJobs]);
    const done: { id: string; title: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i], { key } = newJobs[i], id = key;
      try {
        await uploadComic(id, file, (pct) => setJob(key, { pct }), () => setJob(key, { state: 'uploading' }));
        done.push({ id, title: file.name.replace(/\.[^.]+$/, '') });
        setJob(key, { state: 'done', pct: 100 });
      } catch (e) {
        setJob(key, { state: 'error', error: (e as Error).message });
      }
    }
    if (target && done.length) await run(async () => setLib(await libraryOp({ op: 'move', ids: done.map((d) => d.id), folderId: target })));
    load();
    // Offer to link new files to readlist items that look like the same issue.
    if (done.length) {
      const fresh = await fetchLists().catch(() => lists);
      setLists(fresh);
      const pairs: Match[] = [];
      for (const comic of done) {
        for (const l of fresh) {
          const item = l.items.find((it) => !it.comicId && looksLike(comic.title, it) && !pairs.some((p) => p.item.id === it.id));
          if (item) { pairs.push({ comic, list: l, item }); break; }
        }
      }
      if (pairs.length) setDialog({ kind: 'match', pairs });
    }
  }

  async function deleteComics(ids: string[]) {
    setComics((cs) => cs?.filter((x) => !ids.includes(x.id)) ?? null);
    await Promise.all(ids.map((id) => fetch(`/api/comics?id=${id}`, { method: 'DELETE' })));
    ids.forEach((id) => cacheDropComic(id));
    pushProgress(Object.fromEntries(ids.map((id) => [id, null])));
    await run(async () => setLib(await libraryOp({ op: 'move', ids, folderId: null })));
  }

  async function markRead(ids: string[], read: boolean) {
    setProgress(await setReadState(ids, read, progress));
  }

  const openFolder = (id: string | null) => router.push(id ? `/?folder=${id}` : '/');

  // Drag & drop anywhere on the page
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => { if (has(e)) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      e.preventDefault(); depth = 0; setDragging(false);
      if (e.dataTransfer?.files.length) uploadFiles([...e.dataTransfer.files]);
    };
    addEventListener('dragenter', enter); addEventListener('dragleave', leave);
    addEventListener('dragover', over); addEventListener('drop', drop);
    return () => {
      removeEventListener('dragenter', enter); removeEventListener('dragleave', leave);
      removeEventListener('dragover', over); removeEventListener('drop', drop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = comics ?? [];
  const folderOf = (c: Comic) => (lib.folders.some((f) => f.id === lib.assign[c.id]) ? lib.assign[c.id] : null);
  const passesFilter = (c: Comic) => {
    const p = progress[c.id];
    if (filter === 'read') return isFinished(p);
    if (filter === 'reading') return isStarted(p);
    if (filter === 'unread') return !isFinished(p);
    return true;
  };
  const search = q.trim().toLowerCase();

  const visible = useMemo(() => all
    .filter((c) => (search ? c.title.toLowerCase().includes(search) : folderOf(c) === (folderId ?? null)))
    .filter(passesFilter),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [all, lib, folderId, search, filter, progress]);

  const lastRead = useMemo(() => all
    .filter((c) => isStarted(progress[c.id]))
    .sort((a, b) => progress[b.id].at - progress[a.id].at)[0],
  [all, progress]);

  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);
  // First unread item of each readlist (lists touched most recently first), max 3.
  const upNext = useMemo(() => lists
    .map((l) => ({ list: l, item: splitList(l, progress, comics ? byId : undefined).upNext[0] }))
    .filter((x) => x.item && x.item.comicId !== lastRead?.id)
    .slice(0, 3),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [lists, progress, byId, lastRead]);

  const folderStats = (f: Folder) => {
    const inside = all.filter((c) => folderOf(c) === f.id);
    return { count: inside.length, read: inside.filter((c) => isFinished(progress[c.id])).length, covers: inside.filter((c) => c.cover).slice(0, 3) };
  };

  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selIds = [...selected];
  const active = jobs.filter((j) => j.state !== 'done').length;
  const showFolders = !folderId && !search;

  return (
    <>
      <header className="top">
        {folderId ? (
          <button className="btn ghost icon-btn" onClick={() => openFolder(null)} aria-label="Back to library">{Icon.back}</button>
        ) : null}
        <div className="brand">
          {folderId ? <>{Icon.folder}<span className="brand-title">{folder?.name ?? 'Folder'}</span></> : <><img src="/icon.svg" width={28} height={28} alt="" /> Comic Shelf</>}
        </div>
        <Nav />
        <input className="field search" placeholder="Search all comics…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <button className="btn primary" onClick={() => input.current?.click()}>{Icon.plus}<span className="hide-sm">Upload</span></button>
        <button className="btn ghost icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">{Icon.logout}</button>
        <input ref={input} type="file" multiple accept={COMIC_ACCEPT} hidden
          onChange={(e) => { uploadFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </header>

      <main className="wrap">
        {err && <p className="error" onClick={() => setErr('')}>{err}</p>}

        {comics === null ? (
          <div className="center-msg" style={{ position: 'static', paddingTop: 80 }}><div><div className="spinner" />Loading library…</div></div>
        ) : (
          <>
            {showFolders && alerts.length > 0 && (
              <div className="alert">
                <div className="alert-head">
                  <span>{Icon.starOn}</span>
                  <b>{alerts.length} new issue{alerts.length === 1 ? '' : 's'} from series you follow</b>
                  <button className="btn ghost icon-btn" style={{ marginLeft: 'auto' }} onClick={dismissAlerts} aria-label="Dismiss" title="Dismiss">{Icon.x}</button>
                </div>
                <div className="alert-list">
                  {alerts.slice(0, 6).map((i) => (
                    <span key={`${i.source}:${i.sid}`} className="chip">{i.title}<span className="muted"> · {i.week === 1 ? 'next week' : fmtDate(i.date)}</span></span>
                  ))}
                  {alerts.length > 6 && <span className="muted">+{alerts.length - 6} more</span>}
                </div>
                <Link href="/news?following=1" className="btn small" onClick={dismissAlerts}>See them in News</Link>
              </div>
            )}

            {showFolders && upNext.length > 0 && (
              <div className="upnext-strip">
                {upNext.map(({ list, item }) => {
                  const c = item.comicId ? byId.get(item.comicId) : undefined;
                  const cover = c?.cover ?? item.coverUrl;
                  return (
                    <Link key={list.id} href={c ? `/read/${c.id}` : `/lists/${list.id}`} prefetch={false} className="upnext">
                      <div className="upnext-cover">{cover ? <img src={cover} alt="" /> : null}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="section-title" style={{ margin: 0, fontSize: 11 }}>Up next · {list.name}</div>
                        <div className="upnext-title">{item.title}</div>
                        <div className="card-meta" style={{ marginTop: 0 }}>{c ? 'Tap to read' : 'Not uploaded yet'}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {showFolders && lastRead && (
              <Link href={`/read/${lastRead.id}`} className="resume" prefetch={false}>
                <div className="resume-cover">{lastRead.cover ? <img src={lastRead.cover} alt="" /> : null}</div>
                <div className="resume-body">
                  <div className="section-title" style={{ margin: 0 }}>Continue where you left off</div>
                  <div className="resume-title">{lastRead.title}</div>
                  <div className="muted">Page {progress[lastRead.id].page + 1} of {progress[lastRead.id].total}</div>
                  <div className="prog" style={{ marginTop: 10 }}><i style={{ width: `${((progress[lastRead.id].page + 1) / Math.max(1, progress[lastRead.id].total)) * 100}%` }} /></div>
                </div>
                <span className="btn primary resume-btn">{Icon.play} Continue</span>
              </Link>
            )}

            {showFolders && (
              <>
                <div className="row-title">
                  <div className="section-title">Folders · {lib.folders.length}</div>
                  <button className="btn ghost small" onClick={() => setDialog({ kind: 'newFolder' })}>{Icon.plus} New folder</button>
                </div>
                {lib.folders.length > 0 ? (
                  <div className="folders">
                    {lib.folders.map((f) => {
                      const s = folderStats(f);
                      return (
                        <div key={f.id} className="folder" role="button" tabIndex={0}
                          onClick={() => openFolder(f.id)} onKeyDown={(e) => e.key === 'Enter' && openFolder(f.id)}>
                          <div className="folder-art">
                            {s.covers.length ? s.covers.map((c, i) => <img key={c.id} src={c.cover!} alt="" style={{ zIndex: 3 - i }} />) : <span className="folder-glyph">{Icon.folder}</span>}
                          </div>
                          <div className="folder-name">{f.name}</div>
                          <div className="card-meta">{s.count} comic{s.count === 1 ? '' : 's'}{s.count ? ` · ${s.read} read` : ''}</div>
                          <button className="card-menu" aria-label={`Options for ${f.name}`}
                            onClick={(e) => { e.stopPropagation(); setMenu(menu === `f:${f.id}` ? null : `f:${f.id}`); }}>{Icon.dots}</button>
                          {menu === `f:${f.id}` && (
                            <div className="dropdown" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => { setMenu(null); openFolder(f.id); }}>Open</button>
                              <button onClick={() => { setMenu(null); setDialog({ kind: 'rename', folder: f }); }}>Rename</button>
                              <button className="danger" onClick={() => { setMenu(null); setDialog({ kind: 'deleteFolder', folder: f, count: s.count }); }}>Delete folder</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="muted hint">No folders yet. Create one to organise series, then move comics into it.</p>
                )}
              </>
            )}

            <div className="row-title">
              <div className="section-title">
                {search ? `Search results · ${visible.length}` : folderId ? `Comics · ${visible.length}` : `Not in a folder · ${visible.length}`}
              </div>
              <div className="row-actions">
                <div className="seg small-seg">
                  {(['all', 'unread', 'reading', 'read'] as Filter[]).map((f) => (
                    <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                      {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : f === 'reading' ? 'Reading' : 'Read'}
                    </button>
                  ))}
                </div>
                {folderId && folder && (
                  <button className="btn ghost small" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'folderbar' ? null : 'folderbar'); }}>{Icon.dots}</button>
                )}
                {menu === 'folderbar' && folder && (
                  <div className="dropdown right" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setMenu(null); setDialog({ kind: 'rename', folder }); }}>Rename folder</button>
                    <button className="danger" onClick={() => { setMenu(null); setDialog({ kind: 'deleteFolder', folder, count: visible.length }); }}>Delete folder</button>
                  </div>
                )}
                <button className={`btn small ${selecting ? 'primary' : 'ghost'}`} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>
                  {selecting ? 'Done' : 'Select'}
                </button>
              </div>
            </div>

            {all.length === 0 && !folderId ? (
              <div className="empty">
                <h2>Your shelf is empty</h2>
                <p>Drop CBZ, CBR, CB7, CBT or PDF files anywhere on this page, or use Upload.</p>
                <button className="btn primary" onClick={() => input.current?.click()}>Choose files</button>
              </div>
            ) : visible.length === 0 ? (
              <p className="muted hint">{folderId ? 'This folder is empty. Upload here, or use Select → Move on other comics.' : filter !== 'all' ? 'Nothing matches this filter.' : 'Every comic is in a folder.'}</p>
            ) : (
              <div className="grid">
                {visible.map((c) => (
                  <Card key={c.id} c={c} p={progress[c.id]} menuOpen={menu === c.id} selecting={selecting} selected={selected.has(c.id)}
                    folderName={search ? lib.folders.find((f) => f.id === folderOf(c))?.name : undefined}
                    onToggle={() => toggleSel(c.id)}
                    onMenu={() => setMenu(menu === c.id ? null : c.id)}
                    onRead={(r) => { setMenu(null); markRead([c.id], r); }}
                    onMove={() => { setMenu(null); setDialog({ kind: 'move', ids: [c.id] }); }}
                    onList={() => { setMenu(null); setDialog({ kind: 'addToList', ids: [c.id] }); }}
                    onDelete={() => { setMenu(null); setDialog({ kind: 'deleteComics', ids: [c.id] }); }} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {selecting && (
        <div className="selbar">
          <span><b>{selIds.length}</b> selected</span>
          <button className="btn small ghost" onClick={() => setSelected(new Set(visible.map((c) => c.id)))}>All</button>
          <button className="btn small" disabled={!selIds.length} onClick={() => setDialog({ kind: 'move', ids: selIds })}>{Icon.folder} Move</button>
          <button className="btn small" disabled={!selIds.length} onClick={() => setDialog({ kind: 'addToList', ids: selIds })}>{Icon.list} List</button>
          <button className="btn small" disabled={!selIds.length} onClick={() => { markRead(selIds, true); setSelected(new Set()); }}>{Icon.check} Read</button>
          <button className="btn small" disabled={!selIds.length} onClick={() => { markRead(selIds, false); setSelected(new Set()); }}>Unread</button>
          <button className="btn small danger-btn" disabled={!selIds.length} onClick={() => setDialog({ kind: 'deleteComics', ids: selIds })}>Delete</button>
        </div>
      )}

      {dialog?.kind === 'addToList' && (
        <AddToListDialog lists={lists} onLists={setLists} onClose={() => { setDialog(null); setSelected(new Set()); setSelecting(false); }}
          label={dialog.ids.length === 1 ? `“${all.find((c) => c.id === dialog.ids[0])?.title}”` : `${dialog.ids.length} comics`}
          items={dialog.ids.map((id) => ({ comicId: id, title: all.find((c) => c.id === id)?.title ?? id }))} />
      )}
      {dialog?.kind === 'match' && (
        <MatchDialog pairs={dialog.pairs} onLists={setLists} onClose={() => setDialog(null)} />
      )}

      {dialog && dialog.kind !== 'addToList' && dialog.kind !== 'match' && (
        <Modal onClose={() => setDialog(null)}>
          {dialog.kind === 'newFolder' || dialog.kind === 'rename' ? (
            <NameForm placeholder="Folder name, e.g. Saga"
              title={dialog.kind === 'rename' ? 'Rename folder' : 'New folder'}
              initial={dialog.kind === 'rename' ? dialog.folder.name : ''}
              action={dialog.kind === 'rename' ? 'Save' : 'Create'}
              onCancel={() => setDialog(null)}
              onSubmit={(name) => run(async () => {
                if (dialog.kind === 'rename') setLib(await libraryOp({ op: 'renameFolder', id: dialog.folder.id, name }));
                else {
                  const res = await libraryOp({ op: 'createFolder', name });
                  const created = (res as unknown as { created: Folder }).created;
                  if (dialog.moveIds?.length) setLib(await libraryOp({ op: 'move', ids: dialog.moveIds, folderId: created.id }));
                  else setLib(res);
                  setSelected(new Set()); setSelecting(false);
                }
                setDialog(null);
              })} />
          ) : dialog.kind === 'move' ? (
            <div className="modal-body">
              <h3>Move {dialog.ids.length === 1 ? 'comic' : `${dialog.ids.length} comics`} to…</h3>
              <div className="move-list">
                <button onClick={() => run(async () => { setLib(await libraryOp({ op: 'move', ids: dialog.ids, folderId: null })); setDialog(null); setSelected(new Set()); setSelecting(false); })}>
                  <span className="muted">—</span> No folder (main library)
                </button>
                {lib.folders.map((f) => (
                  <button key={f.id} disabled={f.id === folderId}
                    onClick={() => run(async () => { setLib(await libraryOp({ op: 'move', ids: dialog.ids, folderId: f.id })); setDialog(null); setSelected(new Set()); setSelecting(false); })}>
                    {Icon.folder} {f.name}
                  </button>
                ))}
                <button onClick={() => setDialog({ kind: 'newFolder', moveIds: dialog.ids })}>{Icon.plus} New folder…</button>
              </div>
              <div className="modal-actions"><button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button></div>
            </div>
          ) : dialog.kind === 'deleteFolder' ? (
            <DeleteFolderForm folder={dialog.folder} count={dialog.count} onCancel={() => setDialog(null)}
              onConfirm={(withComics) => run(async () => {
                const res = await libraryOp({ op: 'deleteFolder', id: dialog.folder.id, withComics });
                setLib(res);
                if (withComics) {
                  const removed = (res as unknown as { removedComics: string[] }).removedComics ?? [];
                  setComics((cs) => cs?.filter((c) => !removed.includes(c.id)) ?? null);
                  if (removed.length) pushProgress(Object.fromEntries(removed.map((id) => [id, null])));
                  removed.forEach((id) => cacheDropComic(id));
                }
                setDialog(null);
                if (folderId === dialog.folder.id) openFolder(null);
              })} />
          ) : (
            <div className="modal-body">
              <h3>Delete {dialog.ids.length === 1 ? `"${all.find((c) => c.id === dialog.ids[0])?.title}"` : `${dialog.ids.length} comics`}?</h3>
              <p className="muted">The file{dialog.ids.length === 1 ? ' is' : 's are'} removed from your storage. This can&apos;t be undone.</p>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setDialog(null)}>Cancel</button>
                <button className="btn danger-btn" onClick={() => run(async () => { await deleteComics(dialog.ids); setDialog(null); setSelected(new Set()); setSelecting(false); })}>Delete</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {dragging && <div className="drop-overlay">Drop comics to upload{folder ? ` into “${folder.name}”` : ''}</div>}

      {jobs.length > 0 && (
        <div className="uploads" role="status">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{active ? `Uploading ${active}…` : 'Uploads finished'}</strong>
            {!active && <button className="btn ghost" style={{ padding: '4px 8px' }} onClick={() => setJobs([])}>Close</button>}
          </div>
          {jobs.slice(-6).map((j) => (
            <div className="up-row" key={j.key}>
              <div className="name">
                <span>{j.name}</span>
                <span className={j.state === 'error' ? 'error' : 'muted'}>
                  {j.state === 'cover' ? 'Preparing' : j.state === 'uploading' ? `${Math.round(j.pct)}%` : j.state === 'done' ? 'Done' : 'Failed'}
                </span>
              </div>
              {j.state === 'error' ? <div className="error">{j.error}</div> : <div className="prog"><i style={{ width: `${j.pct}%` }} /></div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Card({ c, p, menuOpen, selecting, selected, folderName, onToggle, onMenu, onRead, onMove, onList, onDelete }: {
  c: Comic; p?: Progress[string]; menuOpen: boolean; selecting: boolean; selected: boolean; folderName?: string;
  onToggle: () => void; onMenu: () => void; onRead: (read: boolean) => void; onMove: () => void; onList: () => void; onDelete: () => void;
}) {
  const finished = isFinished(p);
  const pct = p && p.total ? Math.min(100, ((p.page + 1) / p.total) * 100) : 0;
  const body = (
    <>
      <div className={`cover ${finished ? 'is-read' : ''}`}>
        {c.cover ? <img src={c.cover} alt="" loading="lazy" /> : <div className="ph">{c.title}</div>}
        <span className="badge">{extOf(c.fileName)}</span>
        {finished && <span className="read-badge">{Icon.check} Read</span>}
        {!finished && pct > 0 && <div className="bar"><i style={{ width: `${pct}%` }} /></div>}
        {selecting && <span className={`sel-dot ${selected ? 'on' : ''}`}>{selected ? Icon.check : null}</span>}
      </div>
      <div className="card-title">{c.title}</div>
      <div className="card-meta">
        {folderName ? `${folderName} · ` : ''}
        {finished ? 'Finished' : p && p.page > 0 ? `Page ${p.page + 1} of ${p.total}` : formatSize(c.size)}
      </div>
    </>
  );
  return (
    <div className={`card ${selected ? 'selected' : ''}`}>
      {selecting ? (
        <div role="checkbox" aria-checked={selected} tabIndex={0} onClick={onToggle} onKeyDown={(e) => e.key === ' ' && onToggle()} className="card-inner">{body}</div>
      ) : (
        <Link href={`/read/${c.id}`} prefetch={false} className="card-inner">{body}</Link>
      )}
      {!selecting && (
        <button className="card-menu" aria-label={`Options for ${c.title}`} onClick={(e) => { e.stopPropagation(); onMenu(); }}>{Icon.dots}</button>
      )}
      {menuOpen && (
        <div className="dropdown" onClick={(e) => e.stopPropagation()}>
          <Link href={`/read/${c.id}`} prefetch={false}>{p && p.page > 0 && !finished ? 'Continue reading' : 'Read'}</Link>
          <button onClick={() => onRead(!finished)}>{finished ? 'Mark as unread' : 'Mark as read'}</button>
          <button onClick={onMove}>Move to folder…</button>
          <button onClick={onList}>Add to readlist…</button>
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}

function DeleteFolderForm({ folder, count, onConfirm, onCancel }: {
  folder: Folder; count: number; onConfirm: (withComics: boolean) => void; onCancel: () => void;
}) {
  const [withComics, setWithComics] = useState(false);
  return (
    <div className="modal-body">
      <h3>Delete folder “{folder.name}”?</h3>
      {count > 0 ? (
        <>
          <label className="radio"><input type="radio" checked={!withComics} onChange={() => setWithComics(false)} /> Keep its {count} comic{count === 1 ? '' : 's'} (move them back to the main library)</label>
          <label className="radio"><input type="radio" checked={withComics} onChange={() => setWithComics(true)} /> <span className="error">Delete the folder <b>and</b> its {count} comic{count === 1 ? '' : 's'} permanently</span></label>
        </>
      ) : <p className="muted">The folder is empty.</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn danger-btn" onClick={() => onConfirm(withComics)}>Delete folder</button>
      </div>
    </div>
  );
}

function MatchDialog({ pairs, onLists, onClose }: { pairs: Match[]; onLists: (l: UiList[]) => void; onClose: () => void }) {
  const [state, setState] = useState<Record<string, 'linked' | 'skip' | 'busy'>>({});
  const [err, setErr] = useState('');
  const link = async (m: Match) => {
    setState((s) => ({ ...s, [m.item.id]: 'busy' }));
    try {
      const r = await listOp({ op: 'link', listId: m.list.id, itemId: m.item.id, comicId: m.comic.id });
      onLists(r.lists);
      setState((s) => ({ ...s, [m.item.id]: 'linked' }));
    } catch (e) { setErr((e as Error).message); setState((s) => { const n = { ...s }; delete n[m.item.id]; return n; }); }
  };
  const pending = pairs.filter((m) => !state[m.item.id]);
  return (
    <Modal onClose={onClose}>
      <div className="modal-body">
        <h3>Link to your readlists?</h3>
        <p className="muted">These uploads look like issues waiting in a readlist.</p>
        <div className="move-list">
          {pairs.map((m) => (
            <div key={m.item.id} className="match-row">
              <div style={{ minWidth: 0 }}>
                <div className="ellipsis"><b>{m.comic.title}</b></div>
                <div className="muted ellipsis" style={{ fontSize: 13 }}>→ {m.item.title} · in “{m.list.name}”</div>
              </div>
              {state[m.item.id] === 'linked' ? <span className="ok">{Icon.check} Linked</span>
                : state[m.item.id] === 'skip' ? <span className="muted">Skipped</span>
                  : <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn small ghost" disabled={state[m.item.id] === 'busy'} onClick={() => setState((s) => ({ ...s, [m.item.id]: 'skip' }))}>Skip</button>
                    <button className="btn small primary" disabled={state[m.item.id] === 'busy'} onClick={() => link(m)}>{Icon.link} Link</button>
                  </div>}
            </div>
          ))}
        </div>
        {err && <p className="error">{err}</p>}
        <div className="modal-actions">
          {pending.length > 1 && <button className="btn" onClick={() => pending.forEach(link)}>Link all</button>}
          <button className="btn ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
