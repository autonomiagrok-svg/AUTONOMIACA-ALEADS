/**
 * Onda 4 — SyncQueue persistente com Idempotency-Key (UUID v4) e backoff exponencial.
 */
(function (root) {
  function generateUuid() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = Math.floor(Math.random() * 16);
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function defaultHttpClient(path, opts = {}) {
    if (typeof root.fetch !== 'function') {
      return Promise.reject(new TypeError('fetch unavailable'));
    }
    const headers = {
      'content-type': 'application/json',
      'x-access-key': root.RuntimeAdapter?.getStorage?.('autonomia_access_key') || '',
      ...(opts.headers || {}),
    };
    return root.fetch(path, { ...opts, headers });
  }

  function isPermanent4xx(status) {
    return typeof status === 'number'
      && status >= 400
      && status < 500
      && status !== 401
      && status !== 408
      && status !== 429;
  }

  function normalizeBodyForQueue(body) {
    if (body === undefined || body === null) return {};
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    return body;
  }

  function createSyncQueue({
    storage = root.OfflineStorage,
    httpClient = defaultHttpClient,
    onStatusChange = null,
    baseDelayMs = 1500,
    maxDelayMs = 60000,
    autoListen = true,
  } = {}) {
    let isFlushing = false;
    let statusCallback = typeof onStatusChange === 'function' ? onStatusChange : null;
    let currentHttpClient = typeof httpClient === 'function' ? httpClient : defaultHttpClient;
    let lastError = null;
    let rejectedCount = 0;

    async function notify(extra = {}) {
      const pending = storage ? await storage.countSyncItems() : 0;
      const state = {
        pending,
        syncing: isFlushing,
        rejected: rejectedCount,
        lastError,
        ...extra,
      };
      if (typeof statusCallback === 'function') {
        try { statusCallback(state); } catch {}
      }
      return state;
    }

    async function enqueue({ method = 'POST', path, body = {}, idempotency_key } = {}) {
      if (!storage) throw new Error('OfflineStorage unavailable');
      if (!path) throw new Error('SyncQueue.enqueue requires path');
      const key = idempotency_key || generateUuid();
      const item = {
        idempotency_key: key,
        method: String(method || 'POST').toUpperCase(),
        path: String(path),
        body: normalizeBodyForQueue(body),
        attempts: 0,
        next_retry_at: 0,
        created_at: new Date().toISOString(),
        last_error: null,
      };
      await storage.enqueueSyncItem(item);
      await notify({ enqueued: key });
      return item;
    }

    async function sendItem(item) {
      const bodyStr = typeof item.body === 'string' ? item.body : JSON.stringify(item.body ?? {});
      const res = await currentHttpClient(item.path, {
        method: item.method,
        body: bodyStr,
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': item.idempotency_key,
        },
      });

      if (res && typeof res.status === 'number') {
        if (res.status >= 200 && res.status < 300) {
          return { ok: true, res };
        }
        let errMsg = res.statusText || `HTTP ${res.status}`;
        if (typeof res.json === 'function') {
          try {
            const payload = await res.json();
            if (payload?.error) errMsg = payload.error;
          } catch {}
        }
        const err = new Error(errMsg);
        err.status = res.status;
        throw err;
      }

      if (res && res.ok === false) {
        const err = new Error(res.error || 'Sync failed');
        err.status = res.status || 500;
        throw err;
      }

      return { ok: true, res };
    }

    async function flush({ force = false } = {}) {
      if (!storage) return { skipped: true, synced: 0, rejected: 0, pending: 0, halted: false };
      if (isFlushing) return { skipped: true, synced: 0, rejected: 0, pending: await storage.countSyncItems(), halted: false };

      isFlushing = true;
      let synced = 0;
      let rejected = 0;
      let halted = false;
      await notify();

      try {
        const items = await storage.listSyncItems();
        const now = Date.now();

        for (const item of items) {
          if (!force && Number(item.next_retry_at || 0) > now) {
            continue;
          }
          try {
            await sendItem(item);
            await storage.removeSyncItem(item.idempotency_key);
            synced++;
            lastError = null;
          } catch (err) {
            if (isPermanent4xx(err?.status)) {
              await storage.removeSyncItem(item.idempotency_key);
              rejected++;
              rejectedCount++;
              lastError = err.message || `HTTP ${err.status}`;
              continue;
            }
            const attempts = Number(item.attempts || 0) + 1;
            const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempts - 1)));
            lastError = err?.message || `HTTP ${err?.status || 'network_error'}`;
            await storage.updateSyncItem({
              ...item,
              attempts,
              next_retry_at: Date.now() + delay,
              last_error: lastError,
            });
            halted = true;
            break;
          }
        }
      } finally {
        isFlushing = false;
        await notify({ synced, rejected, halted });
      }

      return {
        skipped: false,
        synced,
        rejected,
        halted,
        pending: await storage.countSyncItems(),
      };
    }

    function setOnStatusChange(fn) {
      statusCallback = typeof fn === 'function' ? fn : null;
      return notify();
    }

    function setHttpClient(fn) {
      currentHttpClient = typeof fn === 'function' ? fn : defaultHttpClient;
    }

    async function getStatus() {
      const pending = storage ? await storage.countSyncItems() : 0;
      return {
        pending,
        syncing: isFlushing,
        rejected: rejectedCount,
        lastError,
      };
    }

    if (autoListen && typeof root.addEventListener === 'function') {
      root.addEventListener('online', () => {
        flush({ force: true }).catch(() => {});
      });
    }

    return {
      enqueue,
      flush,
      setOnStatusChange,
      setHttpClient,
      getStatus,
    };
  }

  root.createSyncQueue = createSyncQueue;
  root.SyncQueue = createSyncQueue();
})(typeof window !== 'undefined' ? window : globalThis);
