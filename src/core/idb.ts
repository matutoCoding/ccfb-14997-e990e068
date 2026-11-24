import type { ID } from './types'

// 极简 IndexedDB 封装，单库多 store，全部结构化克隆（Float32Array 可直接存）

const DB_NAME = 'lantern-workbench'
const DB_VERSION = 1
const STORES = ['projects', 'groups', 'segments', 'settings'] as const
type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

export async function idbPut<T>(store: StoreName, id: ID, value: T): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(value, id))
}

export async function idbGet<T>(store: StoreName, id: ID): Promise<T | undefined> {
  return tx(store, 'readonly', (s) => s.get(id) as IDBRequest<T>)
}

export async function idbAll<T>(store: StoreName): Promise<T[]> {
  return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

export async function idbDelete(store: StoreName, id: ID): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(id))
}

export function uid(prefix = 'id'): ID {
  const a = Math.random().toString(36).slice(2, 9)
  const b = Date.now().toString(36).slice(-5)
  return `${prefix}_${a}${b}`
}
