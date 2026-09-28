// Storage layer: Cloudflare R2 (S3-compatible). Server-only.
// Env vars (set in Vercel): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
import {
  DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const ROOT = 'comics/';
export const PROGRESS = 'app/progress.json';

let client: S3Client | null = null;
function s3() {
  if (!client) {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) throw new Error('R2 storage is not configured');
    client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: !!process.env.R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return client;
}
const Bucket = () => {
  if (!process.env.R2_BUCKET) throw new Error('R2_BUCKET is not set');
  return process.env.R2_BUCKET;
};

export type StoredObject = { pathname: string; size: number; uploadedAt: Date };

export async function listAll(prefix: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let token: string | undefined;
  do {
    const r = await s3().send(new ListObjectsV2Command({ Bucket: Bucket(), Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) out.push({ pathname: o.Key!, size: o.Size ?? 0, uploadedAt: o.LastModified ?? new Date() });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function removeAll(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    await s3().send(new DeleteObjectsCommand({
      Bucket: Bucket(), Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
    }));
  }
}

/** Returns the object's body stream + metadata, or null if missing. */
export async function readObject(key: string, ifNoneMatch?: string) {
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: Bucket(), Key: key, IfNoneMatch: ifNoneMatch }));
    return { status: 200 as const, body: r.Body!.transformToWebStream(), contentType: r.ContentType, etag: r.ETag, size: r.ContentLength };
  } catch (e) {
    const code = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (code === 304) return { status: 304 as const, etag: ifNoneMatch };
    if (code === 404 || (e as Error).name === 'NoSuchKey') return null;
    throw e;
  }
}

export async function readText(key: string): Promise<string | null> {
  const r = await readObject(key);
  return r && r.status === 200 ? new Response(r.body).text() : null;
}

export async function writeObject(key: string, body: string | Uint8Array, contentType = 'application/json', onlyIfNew = false) {
  await s3().send(new PutObjectCommand({
    Bucket: Bucket(), Key: key, Body: body, ContentType: contentType, ...(onlyIfNew ? { IfNoneMatch: '*' } : {}),
  }));
}

/** Short-lived URL the browser can load directly (no bytes through our function). */
export async function signedGetUrl(key: string, minutes = 60) {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: Bucket(), Key: key }), { expiresIn: minutes * 60 });
}

/** Short-lived URL the browser can PUT a file to. */
export async function signedPutUrl(key: string, contentType: string) {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: Bucket(), Key: key, ContentType: contentType }), { expiresIn: 60 * 60 });
}

export function isSafePath(p: string | null): p is string {
  return !!p && p.startsWith(ROOT) && !p.includes('..');
}

/** Small JSON documents (library, readlists, follows, news cache). */
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const t = await readText(key);
    return t ? (JSON.parse(t) as T) : fallback;
  } catch {
    return fallback;
  }
}
export const writeJson = (key: string, value: unknown) => writeObject(key, JSON.stringify(value));
