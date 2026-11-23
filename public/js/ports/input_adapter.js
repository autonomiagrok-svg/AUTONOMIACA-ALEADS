/**
 * Porta 1 USB-C (Frontend) — InputAdapter: unifica ingestão idempotente e recebimento de alvo de busca.
 */
(function (root) {
  let pendingSearchTarget = null;

  function generateUuid() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function ingestLeads(rawItems, opts = {}) {
    const items = Array.isArray(rawItems) ? rawItems : [];
    const adapter = root.RuntimeAdapter;
    const idempotencyKey = opts.idempotency_key || generateUuid();
    const isImport = opts.source === 'import';
    const endpoint = isImport ? '/api/import' : '/api/ingest/maps';
    const body = isImport
      ? {
          items,
          include_indices: opts.include_indices,
          allow_duplicates: opts.allow_duplicates === true,
          batch_prefix: opts.batch_prefix || null,
        }
      : {
          leads: items,
          auto_diagnose: opts.auto_diagnose !== false,
          mode: opts.mode || undefined,
          lote_origem: opts.lote_origem || undefined,
          segmento: opts.segmento || undefined,
        };

    return adapter.http(endpoint, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
  }

  async function receiveSearchTarget({ cidade, uf, segmento, custom_query, mode } = {}) {
    pendingSearchTarget = {
      cidade: cidade || null,
      uf: uf || null,
      segmento: segmento || null,
      custom_query: custom_query || null,
      mode: mode || null,
    };

    if (typeof root.CacaLeadsVertical?.navigate === 'function') {
      await root.CacaLeadsVertical.navigate('motor');
    } else if (typeof root.show === 'function') {
      await root.show('motor');
    }

    if (typeof document !== 'undefined') {
      const cEl = document.getElementById('mapsCidade');
      const uEl = document.getElementById('mapsUf');
      const qEl = document.getElementById('mapsCustomQuery');
      if (cEl && pendingSearchTarget.cidade) cEl.value = pendingSearchTarget.cidade;
      if (uEl && pendingSearchTarget.uf) uEl.value = pendingSearchTarget.uf;
      if (qEl && pendingSearchTarget.custom_query) qEl.value = pendingSearchTarget.custom_query;
      if (pendingSearchTarget.segmento) {
        document.querySelector(`.maps-seg-btn[data-seg="${pendingSearchTarget.segmento}"]`)?.click();
      }
      if (pendingSearchTarget.mode && typeof root.setActiveScoringMode === 'function') {
        root.setActiveScoringMode(pendingSearchTarget.mode);
      }
    }

    return pendingSearchTarget;
  }

  function consumePendingSearchTarget() {
    const current = pendingSearchTarget;
    pendingSearchTarget = null;
    return current;
  }

  root.AppPorts = root.AppPorts || {};
  root.AppPorts.inputAdapter = {
    ingestLeads,
    receiveSearchTarget,
    consumePendingSearchTarget,
  };
})(typeof window !== 'undefined' ? window : globalThis);
