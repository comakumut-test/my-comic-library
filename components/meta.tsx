'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon, Modal, fmtDate } from '@/components/ui';
import { type Follow, normName } from '@/lib/follows';
import { type MetaIssue, type UiList, issueToItem, listOp } from '@/lib/lists';

// ---------------- follows ----------------
export function useFollows() {
  const [follows, setFollows] = useState<Follow[]>([]);
  useEffect(() => {
    fetch('/api/follows', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { follows: [] })).then((j) => setFollows(j.follows ?? [])).catch(() => {});
  }, []);
  const isFollowed = useCallback((i: { source: string; seriesId?: string; series: string }) =>
    follows.some((f) => (i.seriesId && f.key === `${i.source}:${i.seriesId}`) || normName(f.series) === normName(i.series)), [follows]);
  const setFollow = useCallback(async (i: { source: string; seriesId?: string; series: string; publisher?: string }, on: boolean) => {
    // A series followed under another id/name is removed too, so the star always toggles cleanly.
    const matches = follows.filter((f) => (i.seriesId && f.key === `${i.source}:${i.seriesId}`) || normName(f.series) === normName(i.series));
    const send = (b: object) => fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    let j: { follows?: Follow[] } = {};
    if (on) j = await send({ op: 'follow', source: i.source, seriesId: i.seriesId, series: i.series, publisher: i.publisher });
    else for (const f of matches.length ? matches : [i]) j = await send({ op: 'unfollow', source: f.source, seriesId: f.seriesId, series: f.series });
    if (j.follows) setFollows(j.follows);
  }, [follows]);
  return { follows, isFollowed, setFollow };
}

export function FollowButton({ issue, followed, onToggle }: { issue: MetaIssue; followed: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button className={`btn small ${followed ? 'following' : 'ghost'}`} title={followed ? `Stop following ${issue.series}` : `Follow ${issue.series}`}
      onClick={(e) => { e.stopPropagation(); onToggle(!followed); }}>
      {followed ? Icon.starOn : Icon.star}<span className="hide-sm">{followed ? 'Following' : 'Follow'}</span>
    </button>
  );
}

// ---------------- pick a readlist ----------------
type AddPayload = { comicId?: string; title?: string; ref?: object };

export function AddToListDialog({ lists, items, label, onClose, onLists }: {
  lists: UiList[]; items: AddPayload[]; label: string; onClose: () => void; onLists: (l: UiList[]) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const add = async (listId: string | null) => {
    setBusy(true); setMsg('');
    try {
      let id = listId;
      if (!id) {
        const c = await listOp({ op: 'createList', name: name.trim() });
        id = c.created!;
      }
      const r = await listOp({ op: 'addItems', listId: id, items });
      onLists(r.lists);
      const ln = r.lists.find((l) => l.id === id)?.name;
      setMsg(r.added ? `Added to “${ln}”.` : `Already in “${ln}”.`);
      setTimeout(onClose, 900);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <div className="modal-body">
        <h3>Add {label} to a readlist</h3>
        <div className="move-list">
          {lists.map((l) => (
            <button key={l.id} disabled={busy} onClick={() => add(l.id)}>{Icon.list} {l.name} <span className="muted" style={{ marginLeft: 'auto' }}>{l.items.length}</span></button>
          ))}
        </div>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add(null); }}>
          <input className="field" placeholder="New list name, e.g. Batman: Year One" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <button className="btn" disabled={busy || !name.trim()}>{Icon.plus} Create</button>
        </form>
        {msg && <p className="muted">{msg}</p>}
        <div className="modal-actions"><button className="btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

// ---------------- database search ----------------
export function IssueCover({ src, alt = '' }: { src?: string | null; alt?: string }) {
  const [bad, setBad] = useState(false);
  return src && !bad
    ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <div className="ph">{alt}</div>;
}

export function MetaSearch({ lists, listId, onClose, onLists, initial = '' }: {
  lists: UiList[]; listId?: string; onClose: () => void; onLists: (l: UiList[]) => void; initial?: string;
}) {
  const [q, setQ] = useState(initial);
  const [target, setTarget] = useState(listId ?? lists[0]?.id ?? 'new');
  const [newName, setNewName] = useState('');
  const [results, setResults] = useState<MetaIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const { isFollowed, setFollow } = useFollows();

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/meta/search?q=${encodeURIComponent(q.trim())}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResults(j.results);
    } catch (e) { setErr((e as Error).message); setResults(null); } finally { setBusy(false); }
  };

  const ensureList = async () => {
    if (target !== 'new') return target;
    if (!newName.trim()) throw new Error('Type a name for the new list first.');
    const c = await listOp({ op: 'createList', name: newName.trim() });
    setTarget(c.created!); setNewName('');
    onLists(c.lists);
    return c.created!;
  };
  const add = async (payload: object, key: string) => {
    setErr('');
    try {
      const id = await ensureList();
      const r = await listOp({ op: 'addItems', listId: id, items: [payload] });
      onLists(r.lists);
      setAdded((s) => new Set(s).add(key));
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <Modal onClose={onClose} wide>
      <div className="modal-body">
        <h3>Find a comic</h3>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="field" autoFocus placeholder="Series and issue, e.g. Saga 12 or Absolute Batman" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn primary" disabled={busy || q.trim().length < 2}>{Icon.search}<span className="hide-sm">Search</span></button>
        </form>
        <div className="inline-form">
          <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Add to</span>
          <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="new">+ New list…</option>
          </select>
          {target === 'new' && <input className="field" placeholder="New list name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} />}
        </div>
        {err && <p className="error">{err}</p>}
        <div className="results">
          {busy && <div className="muted" style={{ padding: 20, textAlign: 'center' }}><div className="spinner" />Searching…</div>}
          {!busy && results?.length === 0 && <p className="muted">No results. Try just the series name, or add it manually below.</p>}
          {!busy && results?.map((i) => {
            const k = `${i.source}:${i.sid}`;
            return (
              <div className="result" key={k}>
                <div className="result-cover"><IssueCover src={i.image} /></div>
                <div className="result-body">
                  <div className="result-title">{i.title}</div>
                  <div className="card-meta" style={{ marginTop: 2 }}>{[fmtDate(i.date), i.publisher !== 'Other' ? i.publisher : ''].filter(Boolean).join(' · ')}</div>
                  <div className="result-actions">
                    <button className={`btn small ${added.has(k) ? '' : 'primary'}`} disabled={added.has(k)} onClick={() => add(issueToItem(i), k)}>
                      {added.has(k) ? <>{Icon.check} Added</> : <>{Icon.plus} Add</>}
                    </button>
                    <FollowButton issue={i} followed={isFollowed(i)} onToggle={(on) => setFollow(i, on)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {q.trim() && (
          <button className="btn ghost small" style={{ justifySelf: 'start' }} disabled={added.has(`manual:${q.trim()}`)}
            onClick={() => add({ title: q.trim() }, `manual:${q.trim()}`)}>
            {added.has(`manual:${q.trim()}`) ? <>{Icon.check} Added manually</> : <>{Icon.plus} Add “{q.trim()}” manually (no database)</>}
          </button>
        )}
        <div className="modal-actions"><button className="btn" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}
