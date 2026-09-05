import type { ComposerMessage } from "./composerTransport";

export interface ComposerDraft {
  text: string;
  fileIds: string[];
  mode: "direct" | "local";
  pending?: ComposerMessage;
}
const memory = new Map<string, ComposerDraft>();
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("offdesk-composer", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("drafts");
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { database = undefined; reject(req.error); };
  });
}
async function read<T>(store: string, key: string): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function write(store: string, key: string, value: unknown) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, "readwrite");
    if (value === undefined) tx.objectStore(store).delete(key);
    else tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Could not save draft"));
  });
}
export async function loadComposerDraft(key: string): Promise<ComposerDraft> {
  return memory.get(key) ?? await read<ComposerDraft>("drafts", key) ?? { text: "", fileIds: [], mode: "direct" };
}
export async function saveComposerDraft(key: string, draft: ComposerDraft) {
  memory.set(key, draft);
  await write("drafts", key, draft);
}
export const saveComposerFile = (id: string, file: File) => write("files", id, file);
export const loadComposerFile = (id: string) => read<File>("files", id);
export const removeComposerFile = (id: string) => write("files", id, undefined);
