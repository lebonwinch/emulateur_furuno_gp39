// Persistance locale (IndexedDB, avec repli sur la mémoire si indisponible : navigation privée, etc.).

const DB_NAME = 'gp39-emulator'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase | null> | null = null
const memory = new Map<string, unknown>()

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return memory.get(key) as T | undefined
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  if (!db) {
    memory.set(key, value)
    return
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

export async function kvClear(): Promise<void> {
  memory.clear()
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

export interface Debounced<A extends unknown[]> {
  (...a: A): void
  /** exécute tout de suite l'appel en attente (fermeture de l'onglet) */
  flush(): void
}

/**
 * Fonction « différée » : n'exécute `fn` qu'après `ms` sans nouvel appel, mais au plus tard `maxWait` ms après le premier
 * appel d'une rafale (sinon une valeur modifiée chaque seconde ne serait jamais enregistrée).
 */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number, maxWait = 0): Debounced<A> {
  let t: ReturnType<typeof setTimeout> | undefined
  let started = 0
  let pending: A | undefined
  const fire = (): void => {
    if (t) clearTimeout(t)
    t = undefined
    started = 0
    const a = pending
    pending = undefined
    if (a) fn(...a)
  }
  const d = ((...a: A) => {
    pending = a
    const now = Date.now()
    if (!started) started = now
    if (t) clearTimeout(t)
    const wait = maxWait > 0 ? Math.min(ms, Math.max(0, started + maxWait - now)) : ms
    t = setTimeout(fire, wait)
  }) as Debounced<A>
  d.flush = fire
  return d
}
