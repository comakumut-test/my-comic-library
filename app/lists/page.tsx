'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { type Comic, type Progress, fetchProgress } from '@/lib/client';
import { type UiList, fetchLists, listOp, splitList } from '@/lib/lists';
import { Icon, Modal, NameForm, Nav, logout } from '@/components/ui';
import { MetaSearch } from '@/components/meta';

export default function ListsPage() {
  const [lists, setLists] = useState<UiList[] | null>(null);
  const [comics, setComics] = useState<Comic[]>([]);
  const [progress, setProgress] = useState<Progress>({});
  const [dialog, setDialog] = useState<'new' | 'search' | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchLists().then(setLists).catch((e) => { setErr(e.message); setLists([]); });
    fetch('/api/comics', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { comics: [] })).then((j) => setComics(j.comics)).catch(() => {});
    fetchProgress().then(setProgress);
  }, []);
  const byId = useMemo(() => new Map(comics.map((c) => [c.id, c])), [comics]);

  return (
    <>
      <header className="top">
        <div className="brand">{Icon.list}<span className="brand-title">Readlists</span></div>
        <Nav />
        <button className="btn ghost hide-xs" onClick={() => setDialog('search')}>{Icon.search}<span className="hide-sm">Find a comic</span></button>
        <button className="btn primary" onClick={() => setDialog('new')}>{Icon.plus}<span className="hide-sm">New list</span></button>
        <button className="btn ghost icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">{Icon.logout}</button>
      </header>
      <main className="wrap">
        {err && <p className="error">{err}</p>}
        {lists === null ? (
          <div className="center-msg" style={{ position: 'static', paddingTop: 80 }}><div><div className="spinner" />Loading…</div></div>
        ) : lists.length === 0 ? (
          <div className="empty">
            <h2>No readlists yet</h2>
            <p>Make a list for a run or an event, add issues from the comic database or your library, and tick them off as you read.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => setDialog('new')}>{Icon.plus} New list</button>
              <button className="btn" onClick={() => setDialog('search')}>{Icon.search} Find a comic</button>
            </div>
          </div>
        ) : (
          <div className="folders">
            {lists.map((l) => {
              const { upNext, done } = splitList(l, progress, comics.length ? byId : undefined);
              const covers = [...upNext, ...done].map((i) => (i.comicId && byId.get(i.comicId)?.cover) || i.coverUrl).filter(Boolean).slice(0, 3) as string[];
              const total = l.items.length;
              return (
                <Link key={l.id} href={`/lists/${l.id}`} className="folder" style={{ textDecoration: 'none' }}>
                  <div className="folder-art">
                    {covers.length ? covers.map((c, i) => <img key={i} src={c} alt="" style={{ zIndex: 3 - i }} />) : <span className="folder-glyph">{Icon.list}</span>}
                  </div>
                  <div className="folder-name">{l.name}</div>
                  <div className="card-meta" style={{ marginTop: 0 }}>{total ? `${upNext.length} to read · ${done.length} finished` : 'Empty'}</div>
                  {total > 0 && <div className="prog" style={{ marginTop: 8 }}><i style={{ width: `${(done.length / total) * 100}%` }} /></div>}
                </Link>
              );
            })}
          </div>
        )}
      </main>
      {dialog === 'new' && (
        <Modal onClose={() => setDialog(null)}>
          <NameForm title="New readlist" initial="" action="Create" placeholder="e.g. Batman: Year One, Saga, Summer reading"
            onCancel={() => setDialog(null)}
            onSubmit={async (name) => {
              try {
                const r = await listOp({ op: 'createList', name });
                location.href = `/lists/${r.created}`;
              } catch (e) { setErr((e as Error).message); setDialog(null); }
            }} />
        </Modal>
      )}
      {dialog === 'search' && lists && <MetaSearch lists={lists} onLists={setLists} onClose={() => setDialog(null)} />}
    </>
  );
}
