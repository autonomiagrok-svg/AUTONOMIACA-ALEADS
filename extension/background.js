const DEFAULT_SERVER_URL = 'http://127.0.0.1:3100';

async function resolveConnection(explicitUrl, explicitKey) {
  let stored = {};
  try {
    stored = await chrome.storage.local.get(['serverUrl', 'accessKey']);
  } catch {
    stored = {};
  }
  const baseUrl = String(explicitUrl || stored.serverUrl || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');
  const accessKey = String(explicitKey !== undefined && explicitKey !== null ? explicitKey : (stored.accessKey || '')).trim();
  return { baseUrl, accessKey };
}

async function apiJson(baseUrl, path, { method = 'GET', body = null, accessKey = '' } = {}) {
  const opts = { method, headers: {} };
  if (accessKey) {
    opts.headers['x-access-key'] = accessKey;
  }
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  const handle = async () => {
    const { baseUrl, accessKey } = await resolveConnection(message.serverUrl, message.accessKey);

    if (message.type === 'CHECK_HEALTH') {
      const data = await apiJson(baseUrl, '/api/health', { accessKey });
      return { ok: true, data };
    }

    if (message.type === 'SEND_LEADS') {
      const leads = Array.isArray(message.leads) ? message.leads : [];
      const data = await apiJson(baseUrl, '/api/ingest/maps', {
        method: 'POST',
        accessKey,
        body: { leads, auto_diagnose: message.auto_diagnose !== false },
      });
      return { ok: true, data };
    }

    if (message.type === 'GET_ACTIVE_MISSION') {
      const data = await apiJson(baseUrl, '/api/maps/mission/active', { accessKey });
      return { ok: true, data };
    }

    if (message.type === 'UPDATE_MISSION_PROGRESS') {
      const data = await apiJson(baseUrl, `/api/maps/mission/${encodeURIComponent(message.missionId)}/progress`, {
        method: 'POST',
        accessKey,
        body: message.patch || {},
      });
      return { ok: true, data };
    }

    if (message.type === 'SEND_MAPS_BATCH') {
      const data = await apiJson(baseUrl, '/api/ingest/maps', {
        method: 'POST',
        accessKey,
        body: {
          leads: Array.isArray(message.leads) ? message.leads : [],
          mission_id: message.missionId || null,
          auto_diagnose: message.autoDiagnose !== false,
          progress: message.progress || {},
        },
      });
      return { ok: true, data };
    }

    if (message.type === 'COMPLETE_MISSION') {
      const data = await apiJson(baseUrl, `/api/maps/mission/${encodeURIComponent(message.missionId)}/complete`, {
        method: 'POST',
        accessKey,
        body: message.summary || {},
      });
      return { ok: true, data };
    }

    if (message.type === 'STOP_MISSION') {
      const data = await apiJson(baseUrl, `/api/maps/mission/${encodeURIComponent(message.missionId)}/stop`, {
        method: 'POST',
        accessKey,
        body: { reason: message.reason || 'Parado pelo operador no HUD do Maps' },
      });
      return { ok: true, data };
    }

    return null;
  };

  handle()
    .then((res) => {
      if (res !== null) sendResponse(res);
    })
    .catch((err) => {
      sendResponse({ ok: false, error: err?.message || 'Erro na comunicação com o servidor local' });
    });

  return true;
});
