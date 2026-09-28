// Readlist document shape (app/readlists.json). Shared by server + client (types only + helpers).
export type ItemRef = {
  source: string; sid: string; series: string; seriesId?: string; number?: string;
  title: string; date?: string; publisher?: string; cover?: string; // cover = key in our bucket
};
export type ListItem = { id: string; title: string; comicId?: string; ref?: ItemRef; addedAt: number; finishedAt?: number };
export type Readlist = { id: string; name: string; createdAt: number; items: ListItem[] };
export type ReadlistDoc = { lists: Readlist[] };
export const READLISTS_FILE = 'app/readlists.json';
