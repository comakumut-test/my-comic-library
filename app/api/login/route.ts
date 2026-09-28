import { COOKIE, createSession } from '@/lib/auth';
import { readText, writeObject } from '@/lib/blob';

// The password is chosen on first sign-in and stored (salted + hashed) in the private bucket.
// To reset it: delete app/auth.json from the R2 bucket, then sign in with a new password.
const FILE = 'app/auth.json';
const enc = new TextEncoder();

async function hash(pw: string, salt: string) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${pw}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readAuth(): Promise<{ salt: string; hash: string } | null> {
  const t = await readText(FILE);
  return t ? JSON.parse(t) : null;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json({ setup: !(await readAuth()) });
  } catch (e) {
    return Response.json({ setup: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: '' }));
  const pw = String(password ?? '').trim();
  if (pw.length < 4) return Response.json({ error: 'Use at least 4 characters' }, { status: 400 });
  let saved;
  try {
    saved = await readAuth();
  } catch (e) {
    return Response.json({ error: `Storage error: ${(e as Error).message}` }, { status: 500 });
  }
  if (!saved) {
    const salt = crypto.randomUUID();
    await writeObject(FILE, JSON.stringify({ salt, hash: await hash(pw, salt) }), 'application/json', true);
  } else if ((await hash(pw, saved.salt)) !== saved.hash) {
    await new Promise((r) => setTimeout(r, 1200)); // slow down guessing
    return Response.json({ error: 'Wrong password' }, { status: 401 });
  }
  const s = await createSession();
  const res = Response.json({ ok: true });
  res.headers.append('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(s.value)}; Path=/; Max-Age=${s.maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return res;
}
