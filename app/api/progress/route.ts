import { isAuthed, unauthorized } from '@/lib/auth';
import { PROGRESS, readText, writeObject } from '@/lib/blob';

export const dynamic = 'force-dynamic';

export type Progress = Record<string, { page: number; total: number; at: number; read?: boolean }>;

async function read(): Promise<Progress> {
  try {
    const t = await readText(PROGRESS);
    return t ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

// Reading positions, synced across devices (one small JSON file).
export async function GET(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  return Response.json(await read());
}

export async function POST(req: Request) {
  if (!(await isAuthed(req))) return unauthorized();
  const incoming = (await req.json()) as Progress;
  const current = await read();
  for (const [id, p] of Object.entries(incoming)) {
    if (p === null) delete current[id];
    else if (!current[id] || p.at >= current[id].at) current[id] = p; // newest wins
  }
  await writeObject(PROGRESS, JSON.stringify(current));
  return Response.json(current);
}
