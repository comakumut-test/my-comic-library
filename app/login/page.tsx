'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const next = useSearchParams().get('next');
  useEffect(() => { fetch('/api/login').then((r) => r.json()).then((d) => setSetup(!!d.setup)).catch(() => {}); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (r.ok) location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    else { setErr((await r.json().catch(() => ({}))).error ?? 'Sign-in failed'); setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <h1><img src="/icon.svg" width={30} height={30} alt="" /> Comic Shelf</h1>
      <p>{setup ? 'First time here: choose the password for your library.' : 'Private library. Enter your password.'}</p>
      <input className="field" type="password" autoFocus autoComplete="current-password"
        value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" aria-label="Password" />
      {err && <div className="error">{err}</div>}
      <button className="btn primary" disabled={busy || !pw} style={{ justifyContent: 'center' }}>
        {busy ? 'Checking…' : setup ? 'Set password' : 'Unlock'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return <main className="login"><Suspense><LoginForm /></Suspense></main>;
}
