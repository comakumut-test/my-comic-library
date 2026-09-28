'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const s = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const Icon = {
  plus: <svg width="16" height="16" viewBox="0 0 24 24" {...s} strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>,
  folder: <svg width="18" height="18" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
  dots: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>,
  check: <svg width="14" height="14" viewBox="0 0 24 24" {...s} strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>,
  back: <svg width="18" height="18" viewBox="0 0 24 24" {...s} strokeWidth="2.2"><path d="M15 18l-6-6 6-6" /></svg>,
  logout: <svg width="18" height="18" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
  play: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z" /></svg>,
  up: <svg width="16" height="16" viewBox="0 0 24 24" {...s} strokeWidth="2.4"><path d="M6 15l6-6 6 6" /></svg>,
  down: <svg width="16" height="16" viewBox="0 0 24 24" {...s} strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>,
  search: <svg width="16" height="16" viewBox="0 0 24 24" {...s} strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  upload: <svg width="16" height="16" viewBox="0 0 24 24" {...s} strokeWidth="2.2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>,
  list: <svg width="18" height="18" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>,
  news: <svg width="18" height="18" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5" /></svg>,
  books: <svg width="18" height="18" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 5l3.5-.8 3 15.4-3.6.8z" transform="scale(.92) translate(1 1)" /></svg>,
  star: <svg width="15" height="15" viewBox="0 0 24 24" {...s} strokeWidth="2"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>,
  starOn: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>,
  refresh: <svg width="16" height="16" viewBox="0 0 24 24" {...s} strokeWidth="2.2"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>,
  link: <svg width="15" height="15" viewBox="0 0 24 24" {...s} strokeWidth="2.2"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>,
  x: <svg width="16" height="16" viewBox="0 0 24 24" {...s} strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>,
};

/** Main sections. Inline in the header on wide screens, a bottom tab bar on phones. */
export function Nav() {
  const path = usePathname();
  const tabs = [
    { href: '/', label: 'Library', icon: Icon.books, on: path === '/' },
    { href: '/lists', label: 'Lists', icon: Icon.list, on: path.startsWith('/lists') },
    { href: '/news', label: 'News', icon: Icon.news, on: path.startsWith('/news') },
  ];
  return (
    <nav className="mainnav" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={t.on ? 'on' : ''} aria-current={t.on ? 'page' : undefined}>
          {t.icon}<span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
}

export function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

export function NameForm({ title, initial, action, placeholder = 'Name', onSubmit, onCancel }: {
  title: string; initial: string; action: string; placeholder?: string; onSubmit: (name: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form className="modal-body" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}>
      <h3>{title}</h3>
      <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={200} />
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!name.trim()}>{action}</button>
      </div>
    </form>
  );
}

/** Closes open ⋯ menus on any outside click. */
export function useCloseOnClick(close: () => void) {
  useEffect(() => {
    addEventListener('click', close);
    return () => removeEventListener('click', close);
  }, [close]);
}

export const fmtDate = (d?: string | number) => {
  if (!d) return '';
  const x = typeof d === 'number' ? new Date(d) : new Date(`${d}T12:00:00Z`);
  return x.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
