import type { FrameDraft, StoredFrame } from '../types'

const DB_NAME = 'whatsapp-chat-archive'
const STORE = 'frames'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('byJob', 'jobId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB'))
  })
}

function frameKey(jobId: string, index: number): string {
  return `${jobId}:${String(index).padStart(6, '0')}`
}

export async function saveFrameRecord(frame: FrameDraft): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB write'))
    const record: StoredFrame = { ...frame, key: frameKey(frame.jobId, frame.index) }
    tx.objectStore(STORE).put(record)
  })
  db.close()
}

export async function listFrameRecords(jobId: string): Promise<StoredFrame[]> {
  const db = await openDb()
  const records = await new Promise<StoredFrame[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).index('byJob').getAll(jobId)
    request.onsuccess = () => resolve((request.result as StoredFrame[]).sort((a, b) => a.index - b.index))
    request.onerror = () => reject(request.error ?? new Error('indexedDB read'))
  })
  db.close()
  return records
}

export async function deleteJobFrames(jobId: string): Promise<void> {
  const records = await listFrameRecords(jobId)
  if (records.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB delete'))
    const store = tx.objectStore(STORE)
    for (const record of records) store.delete(record.key)
  })
  db.close()
}

export async function deleteAllFrames(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB clear'))
    tx.objectStore(STORE).clear()
  })
  db.close()
}
