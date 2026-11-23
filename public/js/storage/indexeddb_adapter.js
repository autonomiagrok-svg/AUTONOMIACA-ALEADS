/**
 * Onda 4 — IStorageAdapter Offline-First no Browser (IndexedDB + fallback em memória).
 * Object stores: leads (id), lenses (id), meta (key), sync_queue (idempotency_key).
 */
(function (root) {
  const STORES = {
    leads: 'id',
    lenses: 'id',
    meta: 'key',
    sync_queue: 'idempotency_key',
  };

  function cloneValue(val) {
    if (val === undefined) return undefined;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(val);
      } catch {
        // Fallback JSON clone
      }
    }
    return JSON.parse(JSON.stringify(val));
  }

  function createMemoryStores() {
    return {
      leads: new Map(),
      lenses: new Map(),
      meta: new Map(),
      sync_queue: new Map(),
    };
  }

  function createIndexedDbAdapter({ dbName = 'autonomia_caca_leads_v1', memoryFallback = false } = {}) {
    const mem = createMemoryStores();
    let dbPromise = null;
    let usingMemory = Boolean(memoryFallback) || typeof root.indexedDB === 'undefined';

    function openDb() {
      if (usingMemory) return Promise.resolve(null);
      if (dbPromise) return dbPromise;

      dbPromise = new Promise((resolve) => {
        try {
          const req = root.indexedDB.open(dbName, 1);
          req.onupgradeneeded = (event) => {
            const db = event.target.result;
            for (const [storeName, keyPath] of Object.entries(STORES)) {
              if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath });
              }
            }
          };
          req.onsuccess = (event) => {
            const db = event.target.result;
            db.onversionchange = () => {
              try { db.close(); } catch {}
              dbPromise = null;
            };
            resolve(db);
          };
          req.onerror = () => {
            usingMemory = true;
            dbPromise = null;
            resolve(null);
          };
          req.onblocked = () => {
            usingMemory = true;
            dbPromise = null;
            resolve(null);
          };
        } catch {
          usingMemory = true;
          dbPromise = null;
          resolve(null);
        }
      });
      return dbPromise;
    }

    async function withStore(storeName, mode, idbFn, memFn) {
      const db = await openDb();
      if (!db) {
        return memFn(mem[storeName]);
      }
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          const reqResult = idbFn(store);
          let value;
          if (reqResult && typeof reqResult === 'object' && 'onsuccess' in reqResult) {
            reqResult.onsuccess = () => { value = reqResult.result; };
          }
          tx.oncomplete = () => resolve(value);
          tx.onerror = () => reject(tx.error || new Error(`IndexedDB error in ${storeName}`));
          tx.onabort = () => reject(tx.error || new Error(`IndexedDB aborted in ${storeName}`));
        } catch {
          usingMemory = true;
          resolve(memFn(mem[storeName]));
        }
      });
    }

    async function saveSnapshot(storeName, keyPath, items) {
      const list = Array.isArray(items) ? items.filter((x) => x && x[keyPath] != null).map(cloneValue) : [];
      const db = await openDb();
      if (!db) {
        mem[storeName].clear();
        for (const item of list) mem[storeName].set(String(item[keyPath]), item);
        return list.length;
      }
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          store.clear();
          for (const item of list) store.put(item);
          tx.oncomplete = () => resolve(list.length);
          tx.onerror = () => reject(tx.error || new Error(`IndexedDB snapshot failed in ${storeName}`));
          tx.onabort = () => reject(tx.error || new Error(`IndexedDB snapshot aborted in ${storeName}`));
        } catch {
          usingMemory = true;
          mem[storeName].clear();
          for (const item of list) mem[storeName].set(String(item[keyPath]), item);
          resolve(list.length);
        }
      });
    }

    async function saveLeadsSnapshot(leadsArray) {
      return saveSnapshot('leads', 'id', leadsArray);
    }

    async function getAllLeads() {
      const rows = await withStore(
        'leads',
        'readonly',
        (s) => s.getAll(),
        (m) => Array.from(m.values()).map(cloneValue)
      );
      return Array.isArray(rows) ? rows.map(cloneValue) : [];
    }

    async function getLeadById(id) {
      if (!id) return null;
      const key = String(id);
      const found = await withStore(
        'leads',
        'readonly',
        (s) => s.get(key),
        (m) => (m.has(key) ? cloneValue(m.get(key)) : null)
      );
      return found ? cloneValue(found) : null;
    }

    async function upsertLeadLocal(lead) {
      if (!lead || !lead.id) return null;
      const copy = cloneValue(lead);
      await withStore(
        'leads',
        'readwrite',
        (s) => s.put(copy),
        (m) => { m.set(String(copy.id), copy); }
      );
      return cloneValue(copy);
    }

    async function deleteLeadLocal(id) {
      if (!id) return false;
      const key = String(id);
      await withStore(
        'leads',
        'readwrite',
        (s) => s.delete(key),
        (m) => m.delete(key)
      );
      return true;
    }

    async function saveLensesSnapshot(lensesArray) {
      return saveSnapshot('lenses', 'id', lensesArray);
    }

    async function getAllLenses() {
      const rows = await withStore(
        'lenses',
        'readonly',
        (s) => s.getAll(),
        (m) => Array.from(m.values()).map(cloneValue)
      );
      return Array.isArray(rows) ? rows.map(cloneValue) : [];
    }

    async function putMeta(key, value) {
      const entry = {
        key: String(key),
        value: cloneValue(value),
        updated_at: new Date().toISOString(),
      };
      await withStore(
        'meta',
        'readwrite',
        (s) => s.put(entry),
        (m) => { m.set(entry.key, entry); }
      );
      return cloneValue(entry.value);
    }

    async function getMeta(key) {
      const k = String(key);
      const entry = await withStore(
        'meta',
        'readonly',
        (s) => s.get(k),
        (m) => (m.has(k) ? cloneValue(m.get(k)) : null)
      );
      return entry && 'value' in entry ? cloneValue(entry.value) : null;
    }

    async function enqueueSyncItem(item) {
      if (!item || !item.idempotency_key) {
        throw new Error('Sync item requires idempotency_key');
      }
      const copy = cloneValue(item);
      await withStore(
        'sync_queue',
        'readwrite',
        (s) => s.put(copy),
        (m) => { m.set(String(copy.idempotency_key), copy); }
      );
      return cloneValue(copy);
    }

    async function listSyncItems() {
      const rows = await withStore(
        'sync_queue',
        'readonly',
        (s) => s.getAll(),
        (m) => Array.from(m.values()).map(cloneValue)
      );
      const list = Array.isArray(rows) ? rows.map(cloneValue) : [];
      list.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
      return list;
    }

    async function updateSyncItem(item) {
      return enqueueSyncItem(item);
    }

    async function removeSyncItem(idempotencyKey) {
      const key = String(idempotencyKey || '');
      if (!key) return false;
      await withStore(
        'sync_queue',
        'readwrite',
        (s) => s.delete(key),
        (m) => m.delete(key)
      );
      return true;
    }

    async function countSyncItems() {
      const count = await withStore(
        'sync_queue',
        'readonly',
        (s) => s.count(),
        (m) => m.size
      );
      return Number(count || 0);
    }

    return {
      dbName,
      isUsingMemoryFallback: () => usingMemory,
      saveLeadsSnapshot,
      getAllLeads,
      getLeadById,
      upsertLeadLocal,
      deleteLeadLocal,
      saveLensesSnapshot,
      getAllLenses,
      putMeta,
      getMeta,
      enqueueSyncItem,
      listSyncItems,
      updateSyncItem,
      removeSyncItem,
      countSyncItems,
    };
  }

  root.createIndexedDbAdapter = createIndexedDbAdapter;
  root.OfflineStorage = createIndexedDbAdapter();
})(typeof window !== 'undefined' ? window : globalThis);
