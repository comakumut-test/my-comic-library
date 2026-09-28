'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type MetaIssue, type UiList, fetchLists, issueToItem } from '@/lib/lists';
import { Icon, Modal, Nav, fmtDate, logout } from '@/components/ui';
import { AddToListDialog, IssueCover, MetaSearch, useFollows } from '@/components/meta';

type Week = { from: string; to: string; fetchedAt: number; source?: string; issues: MetaIssue[]; error?: string; stale?: boolean; publishers: string[] };
const WEEKS: [number, string][] = [[-1, 'Last week'], [0, 'This week'], [1, 'Next week']];
const numKey = (n: string) => parseFloat(n) || 0;

export default function NewsPage() {
  const [offset, setOffset] = useState(0);
  const [week, setWeek] = useState<Week | null>(null);
  const [loading, setLoading] = useState(true);
  const [followingOnly, setFollowingOnly] = useState(false);
  const [pub, setPub] = useState<string>('all');
  const [lists, setLists] = useState<UiList[]>([]);
  const [dialog, setDialog] = useState<{ kind: 'search' } | { kind: 'follows' } | { kind: 'add'; issue: MetaIssue } | null>(null);
  const { follows, isFollowed, setFollow } = useFollows();

  useEffect(() => {
    if (new URLSearchParams(location.search).get('following') === '1') setFollowingOnly(true);
    fetchLists().then(setLists).catch(() => {});
  }, []);

  const load = useCallback(async (off: number, refresh = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/meta/week?offset=${off}${refresh ? '&refresh=1' : ''}`, { cache: 'no-store' });
      if (r.status === 401) { location.href = '/login'; return; }
      setWeek(await r.json());
    } catch (e) {
      setWeek({ from: '', to: '', fetchedAt: 0, issues: [], error: (e as Error).message, publishers: [] });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(offset); }, [offset, load]);

  const issues = useMemo(() => (week?.issues ?? []).filter((i) => !followingOnly || isFollowed(i)), [week, followingOnly, isFollowed]);
  const groups = useMemo(() => {
    const order = week?.publishers ?? [];
    const m = new Map<string, MetaIssue[]>();
    for (const i of issues) {
      const p = i.publisher || 'Other';
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(i);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.series.localeCompare(b.series) || numKey(a.number) - numKey(b.number));
    return [...m.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }, [issues, week]);
  const shownGroups = pub === 'all' ? groups : groups.filter(([p]) => p === pub);
  const followedCount = (week?.issues ?? []).filter(isFollowed).length;

  return (
    <>
      <header className="top">
        <div className="brand">{Icon.news}<span className="brand-title">New comics</span></div>
        <Nav />
        <button className="btn ghost" onClick={() => setDialog({ kind: 'search' })}>{Icon.search}<span className="hide-sm">Search</span></button>
        <button className="btn ghost icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">{Icon.logout}</button>
      </header>
      <main className="wrap">
        <div className="row-title">
          <div className="seg small-seg">
            {WEEKS.map(([o, l]) => <button key={o} className={offset === o ? 'on' : ''} onClick={() => { setOffset(o); setPub('all'); }}>{l}</button>)}
          </div>
          <div className="row-actions">
            <button className={`btn small ${followingOnly ? 'following' : 'ghost'}`} onClick={() => setFollowingOnly(!followingOnly)}>
              {followingOnly ? Icon.starOn : Icon.star} Following only{week ? ` · ${followedCount}` : ''}
            </button>
            <button className="btn small ghost" onClick={() => setDialog({ kind: 'follows' })}>Manage ({follows.length})</button>
            <button className="btn small ghost icon-btn" disabled={loading} onClick={() => load(offset, true)} title="Refresh from the database" aria-label="Refresh">{Icon.refresh}</button>
          </div>
        </div>
        {week?.from && (
          <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
            {fmtDate(week.from)} – {fmtDate(week.to)} · {week.issues.length} issues
            {week.fetchedAt ? ` · updated ${new Date(week.fetchedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}` : ''}
            {week.source === 'comicvine' ? ' · via Comic Vine (backup)' : ''}
          </p>
        )}

        {week?.error === 'not-configured' ? (
          <div className="empty">
            <h2>Connect a comic database</h2>
            <p>Add <code>METRON_USERNAME</code> and <code>METRON_PASSWORD</code> in Vercel → Settings → Environment Variables, then redeploy. Optionally add <code>COMICVINE_API_KEY</code> as a backup.</p>
          </div>
        ) : week?.error ? (
          <p className="error">{week.stale ? 'Showing the last saved list — refresh failed: ' : 'Couldn’t load this week: '}{week.error}</p>
        ) : null}

        {loading && !week?.issues.length ? (
          <div className="center-msg" style={{ position: 'static', paddingTop: 60 }}><div><div className="spinner" />Loading releases… (first load of a week can take ~20 s)</div></div>
        ) : (
          <>
            {groups.length > 1 && (
              <div className="chips">
                <button className={pub === 'all' ? 'on' : ''} onClick={() => setPub('all')}>All · {issues.length}</button>
                {groups.map(([p, arr]) => <button key={p} className={pub === p ? 'on' : ''} onClick={() => setPub(p)}>{p} · {arr.length}</button>)}
              </div>
            )}
            {week && !week.error && issues.length === 0 && (
              <p className="muted hint">{followingOnly ? 'None of the series you follow have issues this week. Follow series with the ☆ button.' : 'No releases listed for this week yet.'}</p>
            )}
            {shownGroups.map(([p, arr]) => (
              <section key={p}>
                <div className="section-title">{p} · {arr.length}</div>
                <div className="grid news-grid">
                  {arr.map((i) => {
                    const f = isFollowed(i);
                    return (
                      <div key={`${i.source}:${i.sid}`} className="card news-card">
                        <div className={`cover ${f ? 'followed' : ''}`}>
                          <IssueCover src={i.image} alt={i.title} />
                          {f && <span className="read-badge follow-badge">{Icon.starOn} Following</span>}
                        </div>
                        <div className="card-title">{i.title}</div>
                        <div className="card-meta">{fmtDate(i.date)}</div>
                        <div className="news-actions">
                          <button className="btn small" onClick={() => setDialog({ kind: 'add', issue: i })}>{Icon.plus} List</button>
                          <button className={`btn small ${f ? 'following' : 'ghost'} icon-btn`} title={f ? `Unfollow ${i.series}` : `Follow ${i.series}`}
                            aria-label={f ? 'Unfollow series' : 'Follow series'} onClick={() => setFollow(i, !f)}>{f ? Icon.starOn : Icon.star}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </main>

      {dialog?.kind === 'search' && <MetaSearch lists={lists} onLists={setLists} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'add' && (
        <AddToListDialog lists={lists} onLists={setLists} onClose={() => setDialog(null)}
          label={`“${dialog.issue.title}”`} items={[issueToItem(dialog.issue)]} />
      )}
      {dialog?.kind === 'follows' && (
        <Modal onClose={() => setDialog(null)}>
          <div className="modal-body">
            <h3>Series you follow</h3>
            {follows.length === 0 ? <p className="muted">Nothing yet. Tap ☆ on any issue, or search for a series and follow it.</p> : (
              <div className="move-list">
                {[...follows].sort((a, b) => a.series.localeCompare(b.series)).map((f) => (
                  <div key={f.key} className="match-row">
                    <div style={{ minWidth: 0 }}><div className="ellipsis"><b>{f.series}</b></div>{f.publisher && f.publisher !== 'Other' && <div className="muted" style={{ fontSize: 13 }}>{f.publisher}</div>}</div>
                    <button className="btn small ghost" onClick={() => setFollow({ source: f.source, seriesId: f.seriesId, series: f.series }, false)}>Unfollow</button>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setDialog({ kind: 'search' })}>{Icon.search} Find a series</button>
              <button className="btn ghost" onClick={() => setDialog(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
