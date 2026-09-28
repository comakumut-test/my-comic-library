'use client';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { buildCbz, openComic } from '@/lib/archive';
import { cacheGet, cachePut } from '@/lib/pagecache';
import { type Comic, type ProgressEntry, fetchProgress, isFinished, pushProgress, saveLocalProgress } from '@/lib/client';
import { type UiItem, type UiList, fetchLists, itemDone } from '@/lib/lists';

type Mode = 'single' | 'double' | 'scroll';
type Fit = 'height' | 'width' | 'original';
type Settings = { mode: Mode; fit: Fit; rtl: boolean };
const DEFAULTS: Settings = { mode: 'single', fit: 'height', rtl: false };
const SETTINGS_KEY = 'cs-reader';
const CACHE = 'comic-files-v1';
const PAGE_CACHE = 'comic-pages-v1';
const AHEAD = 10; // pages fetched ahead of where you are
const BEHIND = 2;
const KEEP_AHEAD = 30; // pages kept in memory around the current one
const KEEP_BEHIND = 15;

function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return DEFAULTS; }
}

async function download(pathname: string, onPct: (n: number) => void): Promise<Blob> {
  // 1) Local cache (instant re-open)
  const hit = await cacheGet(CACHE, pathname);
  if (hit) return hit;
  // 2) Direct from storage via short-lived signed URL, 3) fallback: stream through our API
  const readWithProgress = async (res: Response) => {
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) onPct((got / total) * 100);
    }
    return new Blob(chunks);
  };
  let blob: Blob;
  try {
    const { url } = await (await fetch(`/api/url?pathname=${encodeURIComponent(pathname)}`)).json();
    blob = await readWithProgress(await fetch(url));
  } catch {
    blob = await readWithProgress(await fetch(`/api/file?pathname=${encodeURIComponent(pathname)}`));
  }
  await cachePut(CACHE, pathname, blob);
  return blob;
}

export default function Reader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [comic, setComic] = useState<Comic | null>(null);
  const [pages, setPages] = useState<(string | null)[]>([]);
  const remote = useRef<{ key: string; url: string }[] | null>(null); // page-split comics
  const loading = useRef(new Set<number>());
  const [dl, setDl] = useState('');
  const [pdf, setPdf] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const pageRef = useRef(0);
  const readRef = useRef(false);
  const [isRead, setIsRead] = useState(false);
  const scrollSync = useRef(false);
  const [nextUp, setNextUp] = useState<{ list: UiList; item: UiItem } | null>(null);

  // What comes after this comic in a readlist (shown on the last page).
  useEffect(() => {
    Promise.all([fetchLists(), fetchProgress()]).then(([lists, prog]) => {
      for (const list of lists) {
        const at = list.items.findIndex((i) => i.comicId === id);
        if (at < 0) continue;
        const item = list.items.slice(at + 1).find((i) => !itemDone(i, prog) && i.comicId !== id);
        if (item) { setNextUp({ list, item }); return; }
      }
    }).catch(() => {});
  }, [id]);

  const { mode, fit, rtl } = settings;
  const total = pages.length;

  useEffect(() => { setSettings(loadSettings()); }, []);
  const update = (patch: Partial<Settings>) => setSettings((s) => {
    const next = { ...s, ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
    return next;
  });

  // ---- load comic
  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    const start = (count: number, prog: Record<string, ProgressEntry | undefined>) => {
      const entry = prog[id];
      readRef.current = !!entry?.read;
      setIsRead(isFinished(entry));
      // Resume where you left off; a finished comic starts again from the cover.
      const saved = entry && !(entry.total && entry.page >= entry.total - 1) ? entry.page : 0;
      pageRef.current = Math.min(saved, count - 1);
      setPage(pageRef.current);
    };
    (async () => {
      try {
        const r = await fetch(`/api/comics?id=${id}`, { cache: 'no-store' });
        if (r.status === 401) { location.href = '/login'; return; }
        const c: Comic | undefined = (await r.json()).comics?.[0];
        if (!c) throw new Error('Comic not found');
        setComic(c);
        document.title = `${c.title} · Comic Shelf`;

        if (c.pages) {
          // Page-split comic: fetch the page list, then load pages on demand (see loader below).
          const [pr, prog] = await Promise.all([fetch(`/api/pages?id=${id}`, { cache: 'no-store' }).then((x) => x.json()), fetchProgress()]);
          if (cancelled) return;
          remote.current = pr.pages;
          if (!pr.pages?.length) throw new Error('This comic has no pages');
          start(pr.pages.length, prog);
          setPages(new Array(pr.pages.length).fill(null));
          setTimeout(() => setChrome(false), 1800);
          return;
        }

        // Single-file comic (PDF, or uploaded before page-splitting): download it whole.
        setStatus('Downloading…');
        const [blob, prog] = await Promise.all([download(c.pathname!, setPct), fetchProgress()]);
        if (cancelled) return;
        setStatus('Opening…');
        const opened = await openComic(blob);
        if (cancelled) return;
        if (opened.kind === 'pdf') { setPdf(URL.createObjectURL(opened.blob)); return; }
        urls = opened.pages.map((p) => URL.createObjectURL(p.blob));
        start(urls.length, prog);
        setPages(urls);
        setTimeout(() => setChrome(false), 1800);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
      setPages((ps) => { ps.forEach((u) => u && URL.revokeObjectURL(u)); return ps; });
    };
  }, [id]);

  // ---- progressive loader: current page first, then the next AHEAD pages, a few at a time
  const fetchPage = useCallback(async (i: number): Promise<Blob> => {
    const pg = remote.current![i];
    const hit = await cacheGet(PAGE_CACHE, pg.key);
    if (hit) return hit;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(pg.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        await cachePut(PAGE_CACHE, pg.key, blob);
        return blob;
      } catch (e) {
        if (attempt >= 2) throw e;
        await new Promise((w) => setTimeout(w, 700 * (attempt + 1)));
      }
    }
  }, []);

  useEffect(() => {
    if (!remote.current || !total) return;
    const want: number[] = [];
    for (let d = 0; d <= AHEAD; d++) want.push(page + d);
    for (let d = 1; d <= BEHIND; d++) want.push(page - d);
    const queue = want.filter((i) => i >= 0 && i < total && !pages[i] && !loading.current.has(i));
    // Free memory for pages far from where you are (they stay in the on-device cache).
    const far = pages.some((u, i) => u && (i < page - KEEP_BEHIND || i > page + KEEP_AHEAD));
    if (far) {
      setPages((ps) => ps.map((u, i) => {
        if (u && (i < page - KEEP_BEHIND || i > page + KEEP_AHEAD)) { URL.revokeObjectURL(u); return null; }
        return u;
      }));
    }
    let alive = true;
    const worker = async () => {
      while (alive && queue.length) {
        const i = queue.shift()!;
        if (loading.current.has(i)) continue;
        loading.current.add(i);
        try {
          const blob = await fetchPage(i);
          const url = URL.createObjectURL(blob);
          setPages((ps) => { if (ps[i]) { URL.revokeObjectURL(url); return ps; } const n = [...ps]; n[i] = url; return n; });
        } catch {
          /* leave it empty; it is retried next time the window moves */
        } finally {
          loading.current.delete(i);
        }
      }
    };
    Promise.all([worker(), worker(), worker(), worker()]);
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, total, fetchPage]);

  // ---- download as .cbz (page-split) or the original file
  async function downloadComic() {
    if (!comic) return;
    const save = (blob: Blob, name: string) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    };
    try {
      if (remote.current) {
        const list = remote.current;
        const out: { name: string; blob: Blob }[] = [];
        for (let i = 0; i < list.length; i++) {
          setDl(`Preparing ${i + 1}/${list.length}…`);
          out.push({ name: list[i].key.split('/').pop()!, blob: await fetchPage(i) });
        }
        setDl('Zipping…');
        save(await buildCbz(out), comic.fileName.replace(/\.[^.]+$/, '') + '.cbz');
      } else {
        setDl('Downloading…');
        save(await download(comic.pathname!, () => {}), comic.fileName);
      }
      setDl('');
    } catch (e) {
      setDl(`Download failed: ${(e as Error).message}`);
    }
  }

  // ---- spreads for double-page mode (cover alone, then pairs)
  const spreads = useMemo(() => {
    if (mode !== 'double') return pages.map((_, i) => [i]);
    const s: number[][] = total ? [[0]] : [];
    for (let i = 1; i < total; i += 2) s.push(i + 1 < total ? [i, i + 1] : [i]);
    return s;
  }, [mode, pages, total]);
  const spreadIdx = Math.max(0, spreads.findIndex((s) => s.includes(page)));

  // ---- progress saving
  useEffect(() => {
    pageRef.current = page;
    if (!total) return;
    if (page >= total - 1 && !readRef.current) { readRef.current = true; setIsRead(true); } // reached the end
    saveLocalProgress(id, page, total, readRef.current);
    dirty.current = true;
  }, [page, total, id]);

  const flush = useCallback((keepalive = false) => {
    if (!dirty.current || !total) return;
    dirty.current = false;
    const entry: ProgressEntry = { page: pageRef.current, total, at: Date.now(), read: readRef.current };
    pushProgress({ [id]: entry }, keepalive);
  }, [id, total]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    const t = setInterval(() => flush(), 90_000);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); clearInterval(t); flush(true); };
  }, [flush]);

  // ---- navigation
  const goSpread = useCallback((i: number) => {
    const s = spreads[Math.max(0, Math.min(spreads.length - 1, i))];
    if (!s) return;
    setPage(s[0]);
    stage.current?.scrollTo({ top: 0, left: 0 });
  }, [spreads]);

  const next = useCallback(() => {
    const el = stage.current;
    // In tall pages, scroll down first before turning the page.
    if (mode !== 'scroll' && el && el.scrollTop + el.clientHeight < el.scrollHeight - 4) {
      el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' }); return;
    }
    if (mode === 'scroll') { el?.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' }); return; }
    goSpread(spreadIdx + 1);
  }, [mode, goSpread, spreadIdx]);
  const prev = useCallback(() => {
    if (mode === 'scroll') { stage.current?.scrollBy({ top: -stage.current.clientHeight * 0.85, behavior: 'smooth' }); return; }
    goSpread(spreadIdx - 1);
  }, [mode, goSpread, spreadIdx]);
  const left = rtl ? next : prev;
  const right = rtl ? prev : next;

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); right(); break;
        case 'ArrowLeft': e.preventDefault(); left(); break;
        case ' ': case 'PageDown': e.preventDefault(); (e.shiftKey ? prev : next)(); break;
        case 'PageUp': e.preventDefault(); prev(); break;
        case 'Home': goSpread(0); break;
        case 'End': goSpread(spreads.length - 1); break;
        case 'f': fullscreen(); break;
        case 'Escape': if (menu) setMenu(false); else if (!document.fullscreenElement) location.href = '/'; break;
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [left, right, next, prev, goSpread, spreads.length, menu]);

  // ---- zoom & pan (paged modes). The browser's own pinch-zoom is replaced so that
  // panning works in every direction, taps don't turn pages while zoomed, and zoom resets per page.
  const root = useRef<HTMLDivElement>(null);
  const zoomRef = useRef({ s: 1, x: 0, y: 0 });
  const [zoomed, setZoomed] = useState(false);
  const nav = useRef({ left, right });
  nav.current = { left, right };

  const applyZoom = useCallback((z: { s: number; x: number; y: number }, forwardScroll = false) => {
    const st = stage.current;
    if (!st) return;
    const W = st.clientWidth, H = st.clientHeight;
    const sc = Math.min(5, Math.max(1, z.s));
    let { x, y } = z;
    const minX = W - W * sc, minY = H - H * sc;
    // Panning past the zoomed edge keeps scrolling the page underneath (e.g. tall pages in Width mode).
    if (x > 0) { if (forwardScroll) st.scrollLeft -= x / sc; x = 0; }
    if (x < minX) { if (forwardScroll) st.scrollLeft += (minX - x) / sc; x = minX; }
    if (y > 0) { if (forwardScroll) st.scrollTop -= y / sc; y = 0; }
    if (y < minY) { if (forwardScroll) st.scrollTop += (minY - y) / sc; y = minY; }
    if (sc <= 1.001) { x = 0; y = 0; }
    zoomRef.current = { s: sc, x, y };
    st.style.transformOrigin = '0 0';
    st.style.transform = sc <= 1.001 ? '' : `translate(${x}px, ${y}px) scale(${sc})`;
    setZoomed(sc > 1.001);
  }, []);
  const resetZoom = useCallback(() => applyZoom({ s: 1, x: 0, y: 0 }), [applyZoom]);
  const zoomAt = useCallback((px: number, py: number, to: number) => {
    const z = zoomRef.current, r = stage.current!.getBoundingClientRect();
    const ox = px - (r.left - z.x), oy = py - (r.top - z.y); // point relative to the untransformed stage
    const cx = (ox - z.x) / z.s, cy = (oy - z.y) / z.s; // content point under the finger/cursor
    applyZoom({ s: to, x: ox - cx * to, y: oy - cy * to });
  }, [applyZoom]);

  useEffect(() => { resetZoom(); }, [page, mode, fit, resetZoom]);

  useEffect(() => {
    const el = root.current;
    if (!el || mode === 'scroll' || !total) return;
    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const origin = () => { const r = stage.current!.getBoundingClientRect(), z = zoomRef.current; return { ox: r.left - z.x, oy: r.top - z.y }; };
    const inCenter = (x: number) => x > innerWidth / 3 && x < (innerWidth * 2) / 3;
    let pinch: { d: number; s: number; cx: number; cy: number } | null = null;
    let pan: { x: number; y: number } | null = null;
    let start: { x: number; y: number; t: number; zoomed: boolean } | null = null;
    let moved = false;
    let lastTap = { t: 0, x: 0, y: 0 };

    const onStart = (e: TouchEvent) => {
      const z = zoomRef.current;
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const { ox, oy } = origin();
        const mx = (a.clientX + b.clientX) / 2 - ox, my = (a.clientY + b.clientY) / 2 - oy;
        pinch = { d: dist(a, b), s: z.s, cx: (mx - z.x) / z.s, cy: (my - z.y) / z.s };
        pan = null; moved = true;
        e.preventDefault();
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        start = { x: t.clientX, y: t.clientY, t: Date.now(), zoomed: z.s > 1.001 };
        moved = false;
        pan = z.s > 1.001 ? { x: t.clientX, y: t.clientY } : null;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (pinch && e.touches.length >= 2) {
        e.preventDefault();
        const [a, b] = [e.touches[0], e.touches[1]];
        const { ox, oy } = origin();
        const mx = (a.clientX + b.clientX) / 2 - ox, my = (a.clientY + b.clientY) / 2 - oy;
        const sc = Math.min(5, Math.max(1, (pinch.s * dist(a, b)) / pinch.d));
        applyZoom({ s: sc, x: mx - pinch.cx * sc, y: my - pinch.cy * sc });
      } else if (pan && e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0], z = zoomRef.current;
        applyZoom({ s: z.s, x: z.x + (t.clientX - pan.x), y: z.y + (t.clientY - pan.y) }, true);
        pan = { x: t.clientX, y: t.clientY };
        if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) moved = true;
      } else if (start && e.touches.length === 1) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) moved = true;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (pinch) {
        if (e.touches.length < 2) {
          pinch = null;
          if (zoomRef.current.s < 1.08) resetZoom();
          const t = e.touches[0];
          pan = t && zoomRef.current.s > 1.001 ? { x: t.clientX, y: t.clientY } : null;
          start = null;
        }
        return;
      }
      if (e.touches.length > 0 || !start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x, dy = t.clientY - start.y, dt = Date.now() - start.t;
      const wasZoomed = start.zoomed;
      start = null; pan = null;
      if (!moved && dt < 300) {
        const now = Date.now();
        const isDouble = now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 40;
        if (isDouble && (wasZoomed || (inCenter(t.clientX) && inCenter(lastTap.x)))) {
          e.preventDefault();
          if (zoomRef.current.s > 1.001) resetZoom(); else zoomAt(t.clientX, t.clientY, 2.5);
          lastTap = { t: 0, x: 0, y: 0 };
          return;
        }
        lastTap = { t: now, x: t.clientX, y: t.clientY };
        if (wasZoomed) { e.preventDefault(); setChrome((c) => !c); } // page taps are off while zoomed
        return;
      }
      // Swipe to turn pages only when not zoomed.
      if (!wasZoomed && Math.abs(dx) > 60 && Math.abs(dy) < 70 && dt < 700) (dx < 0 ? nav.current.right : nav.current.left)();
    };
    const stopGesture = (e: Event) => e.preventDefault(); // iOS Safari's own pinch gesture

    // Mouse: drag to pan when zoomed, Ctrl/⌘ + wheel to zoom.
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || zoomRef.current.s <= 1.001) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
    };
    const onPMove = (e: PointerEvent) => {
      if (!drag) return;
      const z = zoomRef.current;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
      applyZoom({ s: z.s, x: z.x + (e.clientX - drag.x), y: z.y + (e.clientY - drag.y) }, true);
      drag.x = e.clientX; drag.y = e.clientY;
    };
    const onUp = () => { setTimeout(() => { drag = null; }, 0); };
    const onClickCapture = (e: MouseEvent) => {
      if (drag?.moved) { e.stopPropagation(); e.preventDefault(); }
      else if (zoomRef.current.s > 1.001 && e.detail === 1 && !(e.target as HTMLElement).closest('.chrome, .menu')) setChrome((c) => !c);
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, zoomRef.current.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    const onDbl = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.chrome, .menu')) return;
      if (zoomRef.current.s > 1.001) resetZoom();
      else if (inCenter(e.clientX)) zoomAt(e.clientX, e.clientY, 2.5);
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onEnd, { passive: false });
    el.addEventListener('gesturestart', stopGesture);
    el.addEventListener('pointerdown', onDown);
    addEventListener('pointermove', onPMove);
    addEventListener('pointerup', onUp);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('gesturestart', stopGesture);
      el.removeEventListener('pointerdown', onDown);
      removeEventListener('pointermove', onPMove);
      removeEventListener('pointerup', onUp);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
    };
  }, [mode, total, applyZoom, resetZoom, zoomAt]);

  // ---- scroll mode: track visible page
  useEffect(() => {
    if (mode !== 'scroll' || !stage.current || !total) return;
    const imgs = [...stage.current.querySelectorAll<HTMLElement>('[data-i]')];
    scrollSync.current = true;
    imgs[pageRef.current]?.scrollIntoView();
    setTimeout(() => (scrollSync.current = false), 300);
    const io = new IntersectionObserver((entries) => {
      if (scrollSync.current) return;
      const vis = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.i));
      if (vis.length) setPage(Math.min(...vis));
    }, { root: stage.current, rootMargin: '0px 0px -60% 0px' });
    imgs.forEach((i) => io.observe(i));
    return () => io.disconnect();
  }, [mode, total]);


  const shown = spreads[spreadIdx] ?? [];
  const ordered = rtl ? [...shown].reverse() : shown;
  const lastPage = shown[shown.length - 1] ?? 0;

  if (pdf) {
    return (
      <div className="reader">
        <iframe className="pdf-frame" src={pdf} title={comic?.title ?? 'PDF'} />
        <Link href="/" className="btn" style={{ position: 'absolute', top: 12, left: 12, zIndex: 5 }}>← Library</Link>
      </div>
    );
  }

  return (
    <div ref={root} className={`reader ${mode === 'scroll' ? 'scrolling' : 'paged'} ${zoomed ? 'zoomed' : ''}`}>
      {!total ? (
        <div className="center-msg">
          {error ? (
            <div><p className="error">{error}</p><Link className="btn" href="/">Back to library</Link></div>
          ) : (
            <div>
              <div className="spinner" />
              <div>{status}{status === 'Downloading…' && pct > 0 ? ` ${Math.round(pct)}%` : ''}</div>
              {comic && <div style={{ marginTop: 6, fontSize: 13 }}>{comic.title}</div>}
            </div>
          )}
        </div>
      ) : (
        <div ref={stage} className={`stage fit-${fit} ${mode === 'scroll' ? 'scroll-mode' : ''}`}>
          {mode === 'scroll' ? (
            pages.map((u, i) => u
              ? <img key={i} data-i={i} src={u} alt={`Page ${i + 1}`} onClick={() => setChrome((c) => !c)} />
              : <div key={i} data-i={i} className="page-slot scroll-slot"><div className="spinner" /></div>)
          ) : (
            <div className={`spread ${ordered.length > 1 ? 'two' : ''}`}>
              {ordered.map((i) => pages[i]
                ? <img key={i} src={pages[i]!} alt={`Page ${i + 1}`} draggable={false} />
                : <div key={i} className="page-slot"><div className="spinner" /><span>Page {i + 1}</span></div>)}
            </div>
          )}
        </div>
      )}

      {total > 0 && mode !== 'scroll' && (
        <div className={`zones ${zoomed ? 'off' : ''}`} aria-hidden>
          <div onClick={left} />
          <div onClick={() => { setChrome((c) => !c); setMenu(false); }} />
          <div onClick={right} />
        </div>
      )}

      <div className={`chrome top-bar ${chrome || !total ? '' : 'hidden'}`}>
        <Link href="/" className="btn ghost icon-btn" aria-label="Back to library" title="Library"
          onClick={(e) => { if (history.length > 1 && document.referrer.startsWith(location.origin)) { e.preventDefault(); history.back(); } }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <div className="title">{comic?.title ?? ''}</div>
        {total > 0 && <>
          <button className="btn ghost icon-btn" onClick={fullscreen} title="Fullscreen (F)" aria-label="Fullscreen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
          <button className="btn ghost icon-btn" onClick={() => setMenu((m) => !m)} title="Reading options" aria-label="Reading options">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h13" /></svg>
          </button>
        </>}
      </div>

      {menu && chrome && (
        <div className="menu">
          <label>Layout
            <Seg value={mode} onChange={(v) => update({ mode: v as Mode })} options={[['single', 'Single'], ['double', 'Double'], ['scroll', 'Scroll']]} />
          </label>
          {mode !== 'scroll' && (
            <label>Fit
              <Seg value={fit} onChange={(v) => update({ fit: v as Fit })} options={[['height', 'Screen'], ['width', 'Width'], ['original', '100%']]} />
            </label>
          )}
          <div className="menu-row">
            <button className="btn small" onClick={() => { goSpread(0); setMenu(false); }}>⟲ Start over</button>
            <button className="btn small" onClick={() => {
              readRef.current = !readRef.current; setIsRead(readRef.current);
              saveLocalProgress(id, pageRef.current, total, readRef.current); dirty.current = true; flush();
            }}>{isRead ? 'Mark unread' : '✓ Mark read'}</button>
          </div>
          <button className="btn small" onClick={downloadComic} disabled={!!dl && !dl.startsWith('Download failed')}>
            {dl || '⤓ Download (.cbz)'}
          </button>
          <label>Direction
            <Seg value={rtl ? 'rtl' : 'ltr'} onChange={(v) => update({ rtl: v === 'rtl' })} options={[['ltr', 'Left → Right'], ['rtl', 'Manga (R → L)']]} />
          </label>
        </div>
      )}

      {total > 0 && nextUp && (mode === 'scroll' ? page : lastPage) >= total - 1 && (
        <a className="nextup" href={nextUp.item.comicId ? `/read/${nextUp.item.comicId}` : `/lists/${nextUp.list.id}`}>
          {nextUp.item.coverUrl && <span className="nextup-cover"><img src={nextUp.item.coverUrl} alt="" /></span>}
          <span style={{ minWidth: 0 }}>
            <span className="nextup-label">Next in {nextUp.list.name}</span>
            <span className="nextup-title">{nextUp.item.title}</span>
            {!nextUp.item.comicId && <span className="nextup-label">Not uploaded yet — open list</span>}
          </span>
          <span className="nextup-go">›</span>
        </a>
      )}

      {total > 0 && (
        <div className={`chrome bottom-bar ${chrome ? '' : 'hidden'}`}>
          <button className="btn ghost icon-btn" onClick={left} aria-label="Previous">‹</button>
          <input type="range" min={0} max={total - 1} value={page} className={rtl ? 'rtl-range' : ''}
            onChange={(e) => {
              const p = Number(e.target.value);
              if (mode === 'scroll') {
                scrollSync.current = true;
                stage.current?.querySelector<HTMLElement>(`[data-i="${p}"]`)?.scrollIntoView();
                setTimeout(() => (scrollSync.current = false), 200);
                setPage(p);
              } else goSpread(spreads.findIndex((s) => s.includes(p)));
            }} aria-label="Page" />
          <span className="pageno">{shown.length > 1 ? `${shown[0] + 1}–${lastPage + 1}` : page + 1} / {total}</span>
          <button className="btn ghost icon-btn" onClick={right} aria-label="Next">›</button>
        </div>
      )}
    </div>
  );
}

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}
