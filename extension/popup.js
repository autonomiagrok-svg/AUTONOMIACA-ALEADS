const DEFAULT_SERVER_URL = 'http://127.0.0.1:3100';

const $ = (id) => document.getElementById(id);

let queue = [];
let serverUrl = DEFAULT_SERVER_URL;
let deepPort = null;

function showFeedback(msg, isError = false) {
  const el = $('feedback');
  el.textContent = msg;
  el.classList.remove('hidden', 'error');
  if (isError) el.classList.add('error');
}

function updateQueueUI() {
  $('queueCount').textContent = String(queue.length);
  $('btnEnviar').disabled = queue.length === 0;
  $('btnCopiar').disabled = queue.length === 0;
  $('btnLimpar').disabled = queue.length === 0;
}

function dedupeKey(item) {
  if (item.fonte_url) return `url:${item.fonte_url}`;
  return `ne:${String(item.nome_fantasia || '').toLowerCase().trim()}|${String(item.endereco || '').toLowerCase().trim()}`;
}

function mergeLeads(incoming) {
  const map = new Map(queue.map((item) => [dedupeKey(item), item]));
  for (const item of incoming) {
    const k = dedupeKey(item);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, item);
    } else {
      map.set(k, {
        ...prev,
        ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null && v !== undefined && v !== '')),
      });
    }
  }
  queue = Array.from(map.values());
  chrome.storage.local.set({ capturedLeads: queue });
  updateQueueUI();
}

function setDeepRunning(running, text = '') {
  $('btnCapturaProfunda').disabled = running;
  $('btnCapturar').disabled = running;
  $('btnPararProfunda').classList.toggle('hidden', !running);
  const prog = $('deepProgress');
  prog.textContent = text;
  prog.classList.toggle('hidden', !text);
}

async function checkHealth() {
  const badge = $('statusBadge');
  serverUrl = $('serverUrl').value.trim() || DEFAULT_SERVER_URL;
  await chrome.storage.local.set({ serverUrl });

  chrome.runtime.sendMessage({ type: 'CHECK_HEALTH', serverUrl }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      badge.textContent = 'Offline';
      badge.className = 'badge offline';
      return;
    }
    const host = serverUrl.replace(/^https?:\/\//, '');
    badge.textContent = `Online em ${host}`;
    badge.className = 'badge online';
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['capturedLeads', 'serverUrl']);
  queue = Array.isArray(stored.capturedLeads) ? stored.capturedLeads : [];
  serverUrl = stored.serverUrl || DEFAULT_SERVER_URL;
  $('serverUrl').value = serverUrl;
  updateQueueUI();
  checkHealth();

  $('btnTestar').addEventListener('click', checkHealth);

  $('btnCapturar').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/google\.com\/maps/.test(tab.url || '')) {
      showFeedback('Abra uma busca ou empresa no Google Maps para capturar.', true);
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_VISIBLE' }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        showFeedback('Não foi possível ler a aba atual. Recarregue a página do Google Maps e tente novamente.', true);
        return;
      }
      const before = queue.length;
      mergeLeads(res.leads || []);
      const added = queue.length - before;
      showFeedback(`Captura concluída: ${added} novos adicionados à fila (${queue.length} no total).`);
    });
  });

  $('btnCapturaProfunda').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/google\.com\/maps/.test(tab.url || '')) {
      showFeedback('Abra uma busca no Google Maps antes de iniciar a Captura Profunda.', true);
      return;
    }

    try {
      deepPort = chrome.tabs.connect(tab.id, { name: 'deep-capture' });
    } catch {
      showFeedback('Recarregue a aba do Google Maps para conectar a extensão.', true);
      return;
    }

    setDeepRunning(true, '📜 Fase 1: Rolando lista até o final...');

    deepPort.onMessage.addListener((msg) => {
      if (msg.type === 'SCROLL_PROGRESS') {
        setDeepRunning(true, `📜 Rolando até o final... ${msg.discovered} encontrados${msg.reachedEnd ? ' (Fim atingido!)' : ''}`);
      } else if (msg.type === 'PROGRESS') {
        if (msg.lead) mergeLeads([msg.lead]);
        const telInfo = msg.lead?.telefone ? ' 📞' : '';
        setDeepRunning(true, `🔍 Capturando ${msg.current}/${msg.total}: ${msg.lead?.nome_fantasia || ''}${telInfo}`);
      } else if (msg.type === 'DONE') {
        setDeepRunning(false, '');
        deepPort = null;
        if (msg.total === 0) {
          showFeedback('Nenhum card novo sem telefone encontrado na lista atual.');
        } else if (msg.aborted) {
          showFeedback(`Captura profunda interrompida após ${msg.processed} cards. Fila preservada com ${queue.length} leads.`);
        } else {
          showFeedback(`Captura profunda concluída (${msg.processed}/${msg.total} analisados). Total na fila: ${queue.length}.`);
        }
      }
    });

    deepPort.onDisconnect.addListener(() => {
      setDeepRunning(false, '');
      deepPort = null;
    });

    deepPort.postMessage({ type: 'START_DEEP_CAPTURE', existingQueue: queue });
  });

  $('btnPararProfunda').addEventListener('click', () => {
    if (deepPort) {
      deepPort.postMessage({ type: 'STOP_DEEP_CAPTURE' });
    }
  });

  $('btnEnviar').addEventListener('click', () => {
    if (!queue.length) return;
    $('btnEnviar').disabled = true;
    serverUrl = $('serverUrl').value.trim() || DEFAULT_SERVER_URL;

    chrome.runtime.sendMessage({ type: 'SEND_LEADS', serverUrl, leads: queue }, async (res) => {
      $('btnEnviar').disabled = false;
      if (chrome.runtime.lastError || !res?.ok) {
        showFeedback(`Falha no envio: ${res?.error || chrome.runtime.lastError?.message || 'servidor offline'}`, true);
        return;
      }
      const { imported = 0, updated = 0, duplicates = 0, invalid = 0 } = res.data || {};
      queue = [];
      await chrome.storage.local.set({ capturedLeads: [] });
      updateQueueUI();
      showFeedback(`Envio concluído: ${imported} novos, ${updated} atualizados, ${duplicates} duplicados ignorados${invalid ? `, ${invalid} inválidos` : ''}.`);
      checkHealth();
    });
  });

  $('btnCopiar').addEventListener('click', async () => {
    if (!queue.length) return;
    await navigator.clipboard.writeText(JSON.stringify({ leads: queue }, null, 2));
    showFeedback(`${queue.length} leads copiados como JSON para a área de transferência.`);
  });

  $('btnLimpar').addEventListener('click', async () => {
    queue = [];
    await chrome.storage.local.set({ capturedLeads: [] });
    updateQueueUI();
    showFeedback('Fila limpa.');
  });
});
