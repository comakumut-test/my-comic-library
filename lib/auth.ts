// Single-user auth: signed session cookies. The password itself is set on first sign-in (see app/api/login/route.ts).
// Uses Web Crypto so it runs in both the proxy and route handlers.
export const COOKIE = 'cs_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

async function key() {
  // Signing secret for session cookies (the login password itself lives hashed in Blob storage).
  const pw = process.env.APP_PASSWORD || process.env.R2_SECRET_ACCESS_KEY || process.env.BLOB_READ_WRITE_TOKEN;
  if (!pw) throw new Error('No signing secret: set the R2 keys');
  // Secret is derived from the password (+ optional AUTH_SECRET): changing the password logs everyone out.
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`comic-shelf:${pw}:${process.env.AUTH_SECRET ?? ''}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const b64 = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function createSession() {
  const exp = String(Date.now() + MAX_AGE * 1000);
  const sig = b64(await crypto.subtle.sign('HMAC', await key(), enc.encode(exp)));
  return { value: `${exp}.${sig}`, maxAge: MAX_AGE };
}

export async function verifySession(value: string | undefined | null) {
  if (process.env.AUTH_DISABLED) return true;
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = b64(await crypto.subtle.sign('HMAC', await key(), enc.encode(exp)));
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** For route handlers: true if the request carries a valid session cookie. */
export async function isAuthed(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return verifySession(m ? decodeURIComponent(m[1]) : null);
}

export const unauthorized = () => Response.json({ error: 'Not signed in' }, { status: 401 });
