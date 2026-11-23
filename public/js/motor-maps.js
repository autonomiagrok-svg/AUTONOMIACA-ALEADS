/**
 * Tela "Motor de Busca" — Fonte Única Google Maps (1 Segmento por Vez + Rolagem até o Fim + Monitor Ao Vivo).
 */
(function () {
  let SEGMENTS_CATALOG = null;
  let ACTIVE_MISSION = null;
  let POLL_TIMER = null;
  let SELECTED_SEGMENT = 'RESTAURANTE';

  function stopPolling() {
    if (POLL_TIMER) {
      clearInterval(POLL_TIMER);
      POLL_TIMER = null;
    }
  }

  function isMotorViewActive() {
    return document.querySelector('.nav.active')?.dataset?.view === 'motor';
  }

  async function ingestMapsPayload(rawText) {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error('Conteúdo não é um JSON válido');
    }
    const leads = Array.isArray(parsed) ? parsed : (parsed?.leads || parsed?.items || []);
    if (!Array.isArray(leads) || !leads.length) {
      throw new Error('Nenhum lead encontrado no JSON (esperado { "leads": [...] })');
    }
    return await window.api('/api/ingest/maps', {
      method: 'POST',
      body: JSON.stringify({ leads, auto_diagnose: true }),
    });
  }

  function openManualPasteModal() {
    const m = document.getElementById('modal');
    if (!m) return;
    m.classList.remove('hidden');
    m.innerHTML = `
      <div class="modal-box" tabindex="-1" style="max-width:560px">
        <div class="actions" style="justify-content:space-between;align-items:center">
          <h2 style="margin:0">Colar JSON da Extensão</h2>
          <button class="btn" type="button" id="btnCloseExtModal">Fechar</button>
        </div>
        <p class="muted" style="margin-top:8px">Cole abaixo o JSON copiado pelo botão <strong>Copiar JSON</strong> da micro-extensão do Google Maps.</p>
        <textarea id="extJsonInput" rows="8" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px" placeholder='{"leads": [...]}'></textarea>
        <div class="actions" style="margin-top:12px;justify-content:flex-end">
          <button class="btn" type="button" id="btnCancelExtModal">Cancelar</button>
          <button class="btn primary" type="button" id="btnConfirmExtJson">Importar Lote</button>
        </div>
      </div>`;

    document.getElementById('btnCloseExtModal')?.addEventListener('click', () => document.getElementById('modal')?.classList.add('hidden'));
    document.getElementById('btnCancelExtModal')?.addEventListener('click', () => document.getElementById('modal')?.classList.add('hidden'));

    document.getElementById('btnConfirmExtJson')?.addEventListener('click', async () => {
      const raw = document.getElementById('extJsonInput')?.value?.trim();
      if (!raw) return window.toast?.('Cole o JSON antes de importar.');
      try {
        const result = await ingestMapsPayload(raw);
        document.getElementById('modal')?.classList.add('hidden');
        window.toast?.(`Importação concluída: ${result.imported} novos, ${result.updated || 0} enriquecidos, ${result.diagnosed_count || 0} diagnosticados.`);
        window.refreshMeta?.();
        window.refreshAgendaBadge?.();
      } catch (err) {
        window.toast?.('Erro: ' + err.message);
      }
    });
  }

  window.pasteExtensionJson = async function pasteExtensionJson() {
    if (navigator.clipboard?.readText) {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && (clip.trim().startsWith('{') || clip.trim().startsWith('['))) {
          const result = await ingestMapsPayload(clip);
          window.toast?.(`JSON importado: ${result.imported} novos, ${result.updated || 0} enriquecidos, ${result.diagnosed_count || 0} diagnosticados.`);
          window.refreshMeta?.();
          window.refreshAgendaBadge?.();
          return;
        }
      } catch {
        // Fallback modal
      }
    }
    openManualPasteModal();
  };

  function phaseBannerText(m) {
    if (!m) return '';
    if (m.phase === 'WAITING_MAPS') return '⏳ Aguardando aba do Google Maps abrir e conectar a extensão...';
    if (m.phase === 'SCROLLING_TO_END') {
      return `📜 Fase 1: Rolando Google Maps até o final... (${m.scroll_discovered} encontrados${m.reached_end ? ' · Fim atingido!' : ''})`;
    }
    if (m.phase === 'DEEP_CAPTURING') {
      return `🔍 Fase 2: Captura Profunda (${m.captured_count} / ${m.total_to_capture}) + Raio-X automático`;
    }
    if (m.phase === 'COMPLETED') {
      return `✅ Concluída! Lista inteira capturada (${m.captured_count} estabelecimentos)`;
    }
    if (m.phase === 'STOPPED') {
      return `⏹️ Missão parada (${m.captured_count}/${m.total_to_capture || m.scroll_discovered} processados)`;
    }
    return m.phase;
  }

  function renderMissionMonitorHtml(m) {
    if (!m) {
      return `
        <div class="panel" style="text-align:center;padding:24px">
          <p class="muted" style="margin:0">Nenhuma missão executada nesta sessão. Escolha <strong>1 segmento</strong> (ou digite um termo livre) acima e clique em <strong>Iniciar Caça Completa no Google Maps</strong>.</p>
        </div>`;
    }

    const isRunning = m.status === 'RUNNING';
    const mx = m.matrix_summary || {};
    const readyCount = m.lead_ids_acionaveis?.length || 0;
    const pct = m.total_to_capture > 0
      ? Math.min(100, Math.round((m.captured_count / m.total_to_capture) * 100))
      : (m.phase === 'COMPLETED' ? 100 : 0);

    const recentLogs = (m.logs || []).slice(-6).reverse();

    return `
      <div class="panel mission-monitor ${isRunning ? 'running' : ''}">
        <div class="agenda-header">
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <strong style="font-size:15px">📡 Monitor Ao Vivo — ${window.esc(m.query)}</strong>
              <span class="badge ${isRunning ? 'ALTO' : (m.status === 'COMPLETED' ? 'QUALIFICADO' : 'DESCARTADO')}">${window.esc(m.status)}</span>
              <span class="muted" style="font-size:11px">${window.esc(m.lote_origem)}</span>
            </div>
            <div style="margin-top:6px;font-weight:700;color:${isRunning ? 'var(--cyan)' : '#fff'}">
              ${phaseBannerText(m)}
            </div>
          </div>
          <div class="actions" style="margin:0">
            ${isRunning ? `<button type="button" class="btn" id="btnStopMission" style="border-color:var(--red);color:var(--red)">🛑 Parar Missão</button>` : ''}
            <button type="button" class="btn good" id="btnMissionDialer" ${readyCount ? '' : 'disabled'}>
              🚀 Abrir Lote no Power Dialer (${readyCount})
            </button>
            <button type="button" class="btn primary" id="btnMissionMatrix">
              💎 Ver na Matriz (Inteligência)
            </button>
          </div>
        </div>

        ${m.total_to_capture > 0 ? `
          <div class="mission-progress-track">
            <div class="mission-progress-fill" style="width:${pct}%"></div>
          </div>` : ''}

        <div class="autopilot-kpis">
          <span class="badge QUALIFICADO">✨ Novos: ${m.imported}</span>
          <span class="badge CONTATADO">🔄 Enriquecidos: ${m.updated}</span>
          <span class="badge ALTO">🔬 Diagnosticados: ${m.diagnosed_count}</span>
          <span class="badge">🛡️ Duplicados: ${m.duplicates}</span>
        </div>

        <div class="autopilot-kpis" style="margin-top:6px">
          <span class="mx-pill caixa">💎 OURO: ${mx.OURO || 0}</span>
          <span class="badge CONTATADO">📈 EXPANSÃO: ${mx.EXPANSAO || 0}</span>
          <span class="mx-pill brecha">🎯 ENTRADA: ${mx.ENTRADA || 0}</span>
          <span class="badge">👀 OBSERVAÇÃO: ${mx.OBSERVACAO || 0}</span>
        </div>

        ${recentLogs.length ? `
          <div class="mission-log-box">
            ${recentLogs.map((l) => `<div><span class="muted">${new Date(l.at).toLocaleTimeString('pt-BR')}</span> · ${window.esc(l.message)}</div>`).join('')}
          </div>` : ''}
      </div>`;
  }

  function bindMonitorButtons() {
    document.getElementById('btnStopMission')?.addEventListener('click', async () => {
      if (!ACTIVE_MISSION?.id) return;
      try {
        const res = await window.api(`/api/maps/mission/${ACTIVE_MISSION.id}/stop`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Parado pelo operador no painel' }),
        });
        ACTIVE_MISSION = res.mission;
        stopPolling();
        refreshMonitorDom();
        window.toast?.('Sinal de parada enviado à extensão.');
      } catch (err) {
        window.toast?.('Erro ao parar missão: ' + err.message);
      }
    });

    document.getElementById('btnMissionDialer')?.addEventListener('click', async () => {
      const ids = ACTIVE_MISSION?.lead_ids_acionaveis || [];
      if (!ids.length) return;
      const loteQuery = ACTIVE_MISSION?.lote_origem
        ? `/api/leads?lote=${encodeURIComponent(ACTIVE_MISSION.lote_origem)}`
        : '/api/leads?view=summary';
      let res = await window.api(loteQuery);
      let byId = new Map((res.items || []).map((l) => [l.id, l]));
      let queue = ids.map((id) => byId.get(id)).filter(Boolean);
      if (!queue.length && ACTIVE_MISSION?.lote_origem) {
        res = await window.api('/api/leads');
        byId = new Map((res.items || []).map((l) => [l.id, l]));
        queue = ids.map((id) => byId.get(id)).filter(Boolean);
      }
      const activeLens = window.getActiveLensOrMode?.();
      const offerContext = typeof activeLens === 'object' ? activeLens.oferta_contexto : null;
      stopPolling();
      document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === 'dialer'));
      window.openPowerDialerWithQueue?.(queue, {
        mode: 'prospeccao',
        label: ACTIVE_MISSION.lote_origem || 'Lote Google Maps',
        offerContext,
      });
    });

    document.getElementById('btnMissionMatrix')?.addEventListener('click', () => {
      stopPolling();
      window.openIntelligenceTab?.('matrix');
    });
  }

  function syncStartButtonState() {
    const btn = document.getElementById('btnStartMapsMission');
    if (!btn) return;
    if (ACTIVE_MISSION?.status === 'RUNNING') {
      btn.disabled = true;
      btn.textContent = '⏳ Missão em andamento no Google Maps...';
    } else {
      btn.disabled = false;
      btn.textContent = '⚡ Iniciar Caça Completa no Google Maps';
    }
  }

  function refreshMonitorDom() {
    const box = document.getElementById('mapsMissionMonitorBox');
    if (box) {
      box.innerHTML = renderMissionMonitorHtml(ACTIVE_MISSION);
      bindMonitorButtons();
    }
    syncStartButtonState();
  }

  function startPolling() {
    stopPolling();
    POLL_TIMER = setInterval(async () => {
      if (!isMotorViewActive()) {
        stopPolling();
        return;
      }
      try {
        const res = await window.api('/api/maps/mission/active');
        ACTIVE_MISSION = res.mission || null;
        refreshMonitorDom();
        if (!ACTIVE_MISSION || ACTIVE_MISSION.status !== 'RUNNING') {
          stopPolling();
          window.refreshMeta?.();
          window.refreshAgendaBadge?.();
        }
      } catch {
        // Mantém tentando até recuperar
      }
    }, 2000);
  }

  window.renderMapsMotorView = async function renderMapsMotorView(container) {
    stopPolling();

    const [segRes, activeRes] = await Promise.all([
      SEGMENTS_CATALOG ? Promise.resolve({ items: SEGMENTS_CATALOG }) : window.api('/api/maps/segments'),
      window.api('/api/maps/mission/active'),
    ]);
    SEGMENTS_CATALOG = segRes.items || { RESTAURANTE: 'Restaurante', CLINICA: 'Clínica' };
    ACTIVE_MISSION = activeRes.mission || null;

    const tenant = window.AppPorts?.config?.get?.()?.tenant || {};
    const pendingTarget = window.AppPorts?.inputAdapter?.consumePendingSearchTarget?.() || null;
    if (pendingTarget?.segmento && pendingTarget.segmento in SEGMENTS_CATALOG) {
      SELECTED_SEGMENT = pendingTarget.segmento;
    }
    const defaultCity = pendingTarget?.cidade || tenant.default_city || 'Governador Valadares';
    const defaultUf = pendingTarget?.uf || tenant.default_uf || 'MG';
    const defaultCustom = pendingTarget?.custom_query || '';

    const segEntries = Object.entries(SEGMENTS_CATALOG);

    container.innerHTML = `
      <div class="panel autopilot-card">
        <div class="agenda-header">
          <div>
            <h3 style="margin:0">⚡ Captura Automática Google Maps (Fonte Única)</h3>
            <p class="muted" style="margin:4px 0 0">Varredura completa de <strong>1 segmento por vez</strong>: a extensão rola o Google Maps até o final da lista e captura 100% dos estabelecimentos com telefone e site.</p>
          </div>
          <span class="badge QUALIFICADO">100% Dados Reais · Google Maps</span>
        </div>

        <form id="mapsMissionForm" class="form" style="margin-top:14px">
          <div class="field">
            <label>📍 Cidade</label>
            <input id="mapsCidade" value="${window.esc(defaultCity)}" required />
          </div>
          <div class="field">
            <label>🗺️ Estado (UF)</label>
            <input id="mapsUf" value="${window.esc(defaultUf)}" maxlength="2" required style="max-width:120px" />
          </div>

          <div class="field full">
            <label>🏢 Escolha 1 segmento por vez:</label>
            <div class="ap-seg-chips">
              ${segEntries.map(([key, label]) => `
                <button type="button" class="ap-chip maps-seg-btn ${key === SELECTED_SEGMENT ? 'checked' : ''}" data-seg="${window.esc(key)}">
                  ${window.esc(label)}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="field full">
            <label>🔎 Ou digite um Termo Livre (opcional — sobrescreve o segmento acima)</label>
            <input id="mapsCustomQuery" value="${window.esc(defaultCustom)}" placeholder="Ex.: Clínica Odontológica, Distribuidora de Bebidas, Hamburgueria Artesanal..." />
          </div>

          <div class="field full" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
              <input type="checkbox" id="mapsAutoDiagnose" checked style="width:auto" />
              🔬 Auto-Diagnosticar (Raio-X 2ª Geração + BrasilAPI) durante o streaming
            </label>
            <button type="submit" class="btn primary" id="btnStartMapsMission" style="font-size:14px;padding:11px 20px">
              ⚡ Iniciar Caça Completa no Google Maps
            </button>
          </div>
        </form>
      </div>

      <div id="mapsMissionMonitorBox">
        ${renderMissionMonitorHtml(ACTIVE_MISSION)}
      </div>

      <div class="panel">
        <div class="agenda-header">
          <div>
            <h4 style="margin:0">🧩 Extensão Google Maps & Entradas Auxiliares</h4>
            <p class="muted" style="margin:4px 0 0">Antes da primeira captura, recarregue a pasta <code>extension/</code> em <code>chrome://extensions</code> (ou <code>edge://extensions</code>). A aba aberta do Google Maps exibirá um HUD flutuante com progresso e botão Parar.</p>
          </div>
          <div class="actions" style="margin:0">
            <button type="button" class="btn" id="btnMotorPasteJson">📋 Colar JSON da Extensão</button>
            <button type="button" class="btn" id="btnMotorImportCsv">📥 Importar CSV</button>
            <button type="button" class="btn" id="btnMotorNewLead">➕ Cadastro Manual</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnMotorPasteJson')?.addEventListener('click', () => window.pasteExtensionJson?.());
    document.getElementById('btnMotorImportCsv')?.addEventListener('click', () => document.getElementById('importCsvFile')?.click());
    document.getElementById('btnMotorNewLead')?.addEventListener('click', () => document.querySelector('.nav[data-view=novo]')?.click());

    document.querySelectorAll('.maps-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        SELECTED_SEGMENT = btn.dataset.seg;
        document.querySelectorAll('.maps-seg-btn').forEach((b) => b.classList.toggle('checked', b === btn));
        const customInput = document.getElementById('mapsCustomQuery');
        if (customInput) customInput.value = '';
      });
    });

    document.getElementById('mapsMissionForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnStartMapsMission');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '⏳ Iniciando missão...';

      try {
        const res = await window.api('/api/maps/mission', {
          method: 'POST',
          body: JSON.stringify({
            cidade: document.getElementById('mapsCidade').value.trim(),
            uf: document.getElementById('mapsUf').value.trim(),
            segmento: SELECTED_SEGMENT,
            custom_query: document.getElementById('mapsCustomQuery').value.trim(),
            auto_diagnose: document.getElementById('mapsAutoDiagnose').checked,
            mode: window.getActiveScoringMode?.() || 'equilibrado',
          }),
        });
        ACTIVE_MISSION = res.mission;
        refreshMonitorDom();
        const accessKey = localStorage.getItem('autonomia_access_key') || '';
        let startUrl = res.start_url;
        if (startUrl && startUrl.includes('#')) {
          startUrl += `&autonomia_api=${encodeURIComponent(window.location.origin)}`;
          if (accessKey) {
            startUrl += `&autonomia_key=${encodeURIComponent(accessKey)}`;
          }
        }
        window.RuntimeAdapter?.openExternal(startUrl) || window.open(startUrl, '_blank', 'noopener,noreferrer');
        startPolling();
        window.toast?.(`Missão iniciada: "${res.mission.query}". A extensão vai rolar até o final e capturar tudo!`);
      } catch (err) {
        if (!err?.offlineNotified) window.toast?.('Erro ao iniciar missão: ' + err.message);
        btn.disabled = false;
        btn.textContent = '⚡ Iniciar Caça Completa no Google Maps';
      }
    });

    bindMonitorButtons();
    syncStartButtonState();
    if (ACTIVE_MISSION?.status === 'RUNNING') {
      startPolling();
    }
  };
})();
