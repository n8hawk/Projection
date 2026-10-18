// Imported media files are kept in IndexedDB so loops survive a reload.
const DB = 'projection-studio';
const STORE = 'media';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putMedia(id: string, blob: Blob): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMedia(id: string): Promise<Blob | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}
