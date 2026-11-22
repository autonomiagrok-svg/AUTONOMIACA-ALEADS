const DEFAULT_SERVER_URL = 'http://127.0.0.1:3100';

async function resolveBaseUrl(explicitUrl) {
  if (explicitUrl) return String(explicitUrl).trim().replace(/\/+$/, '');
  try {
    const stored = await chrome.storage.local.get(['serverUrl']);
    return String(stored.serverUrl || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');
  } catch {
    return DEFAULT_SERVER_URL;
  }
}

async function apiJson(baseUrl, path, { method = 'GET', body = null } = {}) {
  const opts = { method, headers: {} };
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
    const baseUrl = await resolveBaseUrl(message.serverUrl);

    if (message.type === 'CHECK_HEALTH') {
      const data = await apiJson(baseUrl, '/api/health');
      return { ok: true, data };
    }

    if (message.type === 'SEND_LEADS') {
      const leads = Array.isArray(message.leads) ? message.leads : [];
      const data = await apiJson(baseUrl, '/api/ingest/maps', {
        method: 'POST',
        body: { leads, auto_diagnose: message.auto_diagnose !== false },
      });
      return { ok: true, data };
    }

    if (message.type === 'GET_ACTIVE_MISSION') {
      const data = await apiJson(baseUrl, '/api/maps/mission/active');
      return { ok: true, data };
    }

    if (message.type === 'UPDATE_MISSION_PROGRESS') {
      const data = await apiJson(baseUrl, `/api/maps/mission/${encodeURIComponent(message.missionId)}/progress`, {
        method: 'POST',
        body: message.patch || {},
      });
      return { ok: true, data };
    }

    if (message.type === 'SEND_MAPS_BATCH') {
      const data = await apiJson(baseUrl, '/api/ingest/maps', {
        method: 'POST',
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
        body: message.summary || {},
      });
      return { ok: true, data };
    }

    if (message.type === 'STOP_MISSION') {
      const data = await apiJson(baseUrl, `/api/maps/mission/${encodeURIComponent(message.missionId)}/stop`, {
        method: 'POST',
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
