/**
 * Etapa 4 + 5 — Power Dialer (Prospecção 1-a-1 & Follow-up Sequencial injetado pela Agenda).
 */
(function () {
  const SIGNALS_UI = [
    { id: 'QUENTE', label: '🔥 Quente' },
    { id: 'PEDIU_DEPOIS', label: '⏳ Pediu depois' },
    { id: 'OBJECAO_PRECO', label: '💰 Preço' },
    { id: 'TEM_FORNECEDOR', label: '🤝 Já tem forn.' },
    { id: 'PEDIU_PROPOSTA', label: '📄 Pediu proposta' },
    { id: 'SEM_RESPOSTA', label: '😶 Sem retorno' },
  ];

  const LANDLINE_STORAGE_KEY = 'autonomia_include_landline';

  const sessionState = {
    startedAt: Date.now(),
    processed: 0,
    contacted: 0,
    invalid: 0,
    skippedIds: [],
    filters: { origem: '', lote: '', segmento: '' },
    includeLandline: localStorage.getItem(LANDLINE_STORAGE_KEY) !== '0',
    mode: 'prospeccao', // 'prospeccao' | 'followup'
    externalLabel: '',
    externalLeads: [],
    socialProof: null,
    offerContext: null,
    queue: [],
    currentIndex: 0,
    variationIndex: 0,
    awaitingCadence: false,
    lastMessageText: '',
    keyListenerBound: false,
  };

  function isDialerActive() {
    const activeNav = document.querySelector('.nav.active');
    const modal = document.getElementById('modal');
    return activeNav?.dataset?.view === 'dialer' && modal?.classList?.contains('hidden');
  }

  function addDaysIso(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function buildQueueFromLeads(allLeads) {
    const lensOrMode = window.getActiveLensOrMode?.() || window.getActiveScoringMode?.() || 'equilibrado';
    const skipOrder = new Map(sessionState.skippedIds.map((id, i) => [id, i + 1]));

    if (sessionState.mode === 'followup') {
      const actionable = allLeads
        .map((lead) => {
          const cadence = window.CadenceEngine?.analyzeLeadCadence(lead, { modeId: lensOrMode });
          const nextStep = window.CadenceEngine?.recommendNextStep(lead, cadence);
          const ev = window.ScoringModes?.evaluateLead(lead, lensOrMode);
          const rawPhone = lead.whatsapp || lead.telefone;
          const phoneNorm = window.Hygiene?.normalizePhone(rawPhone);
          return {
            lead,
            evalRes: {
              score: cadence?.priority_score ?? lead.score ?? 50,
              potencial: cadence?.mode_potencial || lead.potencial || 'MEDIO',
              motivo_destaque: nextStep?.acao_titulo || cadence?.motivo_destaque || '',
              etiquetas_dor: cadence?.etiquetas_dor || lead.etiquetas_dor || [],
              breakdown: ev?.breakdown || [],
              acionavel: Boolean(phoneNorm?.valido || lead.email),
            },
            cadence,
            nextStep,
            phoneNorm: phoneNorm || { tipo: 'DESCONHECIDO', valido: false },
          };
        })
        .filter((x) => x.evalRes.acionavel);

      sessionState.queue = actionable;
      sessionState.currentIndex = 0;
      return;
    }

    sessionState.includeLandline = localStorage.getItem(LANDLINE_STORAGE_KEY) !== '0';
    const isExternalProspect = sessionState.externalLeads.length > 0;
    const actionable = allLeads
      .filter((lead) => isExternalProspect || ['NOVO', 'QUALIFICADO'].includes(lead.status))
      .filter((lead) => lead.whatsapp_status !== 'INVALIDO')
      .filter((lead) => {
        if (isExternalProspect) return true;
        if (sessionState.filters.origem && window.inferLeadOrigin?.(lead).key !== sessionState.filters.origem) return false;
        if (sessionState.filters.lote && lead.lote_origem !== sessionState.filters.lote) return false;
        if (sessionState.filters.segmento && lead.segmento !== sessionState.filters.segmento) return false;
        return true;
      })
      .map((lead) => {
        const evalRes = window.ScoringModes?.evaluateLead(lead, lensOrMode) || {
          score: lead.score || 50,
          potencial: lead.potencial || 'MEDIO',
          motivo_destaque: '',
          etiquetas_dor: lead.etiquetas_dor || [],
          breakdown: [],
          acionavel: true,
        };
        const rawPhone = lead.whatsapp || lead.telefone;
        const phoneNorm = window.Hygiene?.normalizePhone(rawPhone);
        return { lead, evalRes, phoneNorm };
      })
      .filter(({ lead, evalRes, phoneNorm }) => {
        if (!phoneNorm?.valido) return false;
        if (lead.whatsapp_status === 'INVALIDO') return false;
        const sit = String(lead?.diagnostico_fatos?.cnpj_info?.situacao_cadastral || '').trim().toUpperCase();
        const cnpjInativo = (Array.isArray(evalRes.etiquetas_dor) && evalRes.etiquetas_dor.includes('CNPJ Inativo'))
          || (sit && sit !== 'ATIVA' && sit !== '2');
        if (cnpjInativo) return false;
        if (phoneNorm.whatsapp_provavel) return evalRes.acionavel;
        return sessionState.includeLandline && phoneNorm.tipo === 'FIXO';
      });

    if (!isExternalProspect) {
      actionable.sort((a, b) => {
        const skipA = skipOrder.get(a.lead.id) || 0;
        const skipB = skipOrder.get(b.lead.id) || 0;
        if (skipA !== skipB) return skipA - skipB;
        return b.evalRes.score - a.evalRes.score;
      });
    }

    sessionState.queue = actionable;
    sessionState.currentIndex = 0;
  }

  function renderTelemetryBar() {
    const elapsedHours = Math.max((Date.now() - sessionState.startedAt) / 3600000, 1 / 60);
    const pace = Math.round(sessionState.processed / elapsedHours);
    const modeLabel = window.getActiveModeLabel?.() || 'Equilibrado';
    const hasCustomQueue = sessionState.externalLeads.length > 0;

    return `
      <div class="panel dialer-telemetry">
        <div class="telemetry-stats">
          <span><strong>Modo Fila:</strong> <span class="badge ${hasCustomQueue ? 'VISITA' : 'ALTO'}">${hasCustomQueue ? window.esc(sessionState.externalLabel || 'Fila Focada') : 'Prospecção Ativa'}</span></span>
          ${sessionState.socialProof?.ativo ? '<span class="badge QUALIFICADO">🏘️ Prova Social Local ativa</span>' : ''}
          <span><strong>Processados:</strong> ${sessionState.processed}</span>
          <span><strong>Contatados:</strong> <span style="color:var(--green)">${sessionState.contacted}</span></span>
          <span><strong>Inválidos:</strong> <span style="color:var(--red)">${sessionState.invalid}</span></span>
          <span><strong>Ritmo:</strong> <span style="color:var(--cyan)">${pace} leads/h</span></span>
          <span><strong>Na fila:</strong> ${sessionState.queue.length}</span>
        </div>
        <div class="telemetry-mode actions" style="margin:0">
          ${hasCustomQueue ? '<button type="button" class="btn" id="btnBackToProspect">Voltar à Prospecção</button>' : ''}
          <span class="badge ALTO">Lente: ${window.esc(modeLabel)}</span>
        </div>
      </div>`;
  }

  function renderQuickFilters() {
    if (sessionState.mode === 'followup') return '';
    if (sessionState.externalLeads.length > 0) {
      return `
        <div class="filters" style="margin-bottom:12px">
          <label class="dialer-fixo-toggle">
            <input type="checkbox" id="dialerIncludeFixo" ${sessionState.includeLandline ? 'checked' : ''} />
            ☎️ Incluir Fixos
          </label>
        </div>`;
    }
    const lotes = window.META?.lotes || [];
    const segs = window.META?.segmentos || [];
    const { origem, lote, segmento } = sessionState.filters;
    return `
      <div class="filters" style="margin-bottom:12px">
        <select id="dialerOrigem">
          <option value="">Todas origens</option>
          <option value="MAPS" ${origem === 'MAPS' ? 'selected' : ''}>Google Maps</option>
          <option value="OSM" ${origem === 'OSM' ? 'selected' : ''}>OpenStreetMap</option>
          <option value="CSV" ${origem === 'CSV' ? 'selected' : ''}>CSV</option>
          <option value="MANUAL" ${origem === 'MANUAL' ? 'selected' : ''}>Manual</option>
        </select>
        <select id="dialerLote">
          <option value="">Todos os lotes</option>
          ${lotes.map((l) => `<option value="${window.esc(l)}" ${lote === l ? 'selected' : ''}>${window.esc(l)}</option>`).join('')}
        </select>
        <select id="dialerSegmento">
          <option value="">Todos segmentos</option>
          ${segs.map((s) => `<option value="${window.esc(s)}" ${segmento === s ? 'selected' : ''}>${window.esc(s)}</option>`).join('')}
        </select>
        <label class="dialer-fixo-toggle">
          <input type="checkbox" id="dialerIncludeFixo" ${sessionState.includeLandline ? 'checked' : ''} />
          ☎️ Incluir Fixos
        </label>
        <button type="button" class="btn" id="dialerRefreshBtn">↻ Recarregar Fila</button>
      </div>`;
  }

  function safeExternalUrl(raw) {
    if (!raw) return null;
    try {
      const value = String(raw).trim();
      if (!value) return null;
      if (!/^[a-z][a-z\d+.-]*:/i.test(value) && !value.includes('.') && !value.startsWith('//')) return null;
      const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value.replace(/^\/\//, '')}`;
      const u = new URL(candidate);
      if (!['http:', 'https:'].includes(u.protocol)) return null;
      return u.href;
    } catch {
      return null;
    }
  }

  function getInstagramLink(lead) {
    const redes = Array.isArray(lead?.redes_sociais) ? lead.redes_sociais : [];
    const ig = redes.find((r) => r.toLowerCase().includes('instagram.com'));
    if (!ig) return null;
    const idx = ig.indexOf('http');
    return idx >= 0 ? ig.slice(idx) : ig;
  }

  function renderDialerCard(container) {
    const entry = sessionState.queue[sessionState.currentIndex];
    const htmlHeader = renderTelemetryBar() + renderQuickFilters();

    if (!entry) {
      container.innerHTML = `${htmlHeader}
        <div class="panel" style="text-align:center;padding:36px">
          <h3 style="margin-top:0">🎉 Fila focada zerada!</h3>
          <p class="muted">Todos os leads desta fila foram processados.</p>
          <button type="button" class="btn primary" id="dialerClearFilters">Recarregar Prospecção</button>
        </div>`;
      bindDialerToolbar(container);
      document.getElementById('dialerClearFilters')?.addEventListener('click', () => {
        sessionState.mode = 'prospeccao';
        sessionState.filters = { origem: '', lote: '', segmento: '' };
        sessionState.skippedIds = [];
        sessionState.externalLeads = [];
        sessionState.externalLabel = '';
        sessionState.socialProof = null;
        sessionState.offerContext = null;
        window.renderPowerDialerView(container);
      });
      return;
    }

    const { lead, evalRes, phoneNorm, cadence, nextStep } = entry;
    const lensOrMode = window.getActiveLensOrMode?.() || window.getActiveScoringMode?.() || 'equilibrado';
    const op = window.getActiveOperatorName?.() || 'Rafael Oliveira';
    const activeOffer = sessionState.offerContext || (typeof lensOrMode === 'object' ? lensOrMode.oferta_contexto : null);

    const copy = sessionState.mode === 'followup' && window.CadenceEngine
      ? window.CadenceEngine.generateSmartFollowUp(lead, {
          operador: op,
          modeId: lensOrMode,
          variationIndex: sessionState.variationIndex,
        })
      : (window.CopyEngine?.generateSmartCopy(lead, {
          modeOrLens: lensOrMode,
          operador: op,
          variationIndex: sessionState.variationIndex,
          offerContext: activeOffer,
          socialProof: sessionState.socialProof,
        }) || { text: '', hook_label: 'Padrão', variation_index: 0, total_variations: 1 });

    if (!sessionState.awaitingCadence) {
      sessionState.lastMessageText = copy.text;
    }

    const rawPhone = lead.whatsapp || lead.telefone;
    const isLandline = phoneNorm?.tipo === 'FIXO';
    const telDigits = String(rawPhone || '').replace(/\D/g, '');
    const websiteHref = safeExternalUrl(lead.website);
    const igUrl = safeExternalUrl(getInstagramLink(lead));
    const fonteHref = safeExternalUrl(lead.fonte_url);
    const socios = Array.isArray(lead.socios) && lead.socios.length
      ? lead.socios
      : (lead.diagnostico_fatos?.cnpj_info?.socios || []);
    const tmplLabels = window.TEMPLATE_LABELS || {};
    const copyLabel = copy.hook_label || copy.estrategia || 'Padrão';

    container.innerHTML = `${htmlHeader}
      <div class="panel dialer-cockpit">
        <div class="dialer-lead-head">
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <h2 style="margin:0">${window.esc(lead.nome_fantasia)}</h2>
              ${window.renderOriginBadge?.(lead) || ''}
              ${cadence ? `<span class="temp-badge temp-${window.esc(cadence.temperatura)}">${window.esc(cadence.temperatura)}</span>` : ''}
              <span class="badge ${window.esc(lead.status)}">${window.esc(lead.status)}</span>
              ${cadence ? `<span class="muted" style="font-size:12px">${cadence.tentativas_contato}º toque · há ${cadence.dias_sem_contato}d</span>` : ''}
            </div>
            <p class="muted" style="margin:6px 0 0">
              ${window.esc(lead.segmento)} ·
              ${lead.avaliacao != null ? `⭐ ${lead.avaliacao} (${lead.total_avaliacoes || 0} aval.) · ` : ''}
              📍 ${window.esc(lead.bairro ? `${lead.bairro}, ` : '')}${window.esc(lead.cidade || '')}/${window.esc(lead.uf || 'MG')} ·
              📞 <strong>${window.esc(rawPhone || 'Sem telefone')}</strong> <span class="badge">${phoneNorm.tipo}</span>
              ${isLandline ? '<span class="badge landline-alert">☎️ Telefone Fixo (testar WhatsApp Business ou ligar)</span>' : ''}
            </p>
          </div>
          <div class="dialer-score-box" title="${window.esc(window.formatBreakdownTooltip?.(evalRes.breakdown) || '')}">
            <span class="muted" style="font-size:11px;text-transform:uppercase">${sessionState.mode === 'followup' ? 'Valor em Risco' : 'Score no Modo'}</span>
            <strong class="dialer-score">${evalRes.score}</strong>
            <span class="badge ${evalRes.potencial}">${evalRes.potencial}</span>
          </div>
        </div>

        <div class="dialer-highlight">
          <strong>${sessionState.mode === 'followup' ? 'Estratégia recomendada:' : 'Por que agora:'}</strong> ${window.esc(evalRes.motivo_destaque)}
          ${nextStep ? ` · Canal: <strong>${window.esc(nextStep.canal_sugerido)}</strong>` : ''}
          ${evalRes.breakdown?.length ? `<div style="margin-top:6px">${window.renderBreakdownChips?.(evalRes.breakdown) || ''}</div>` : ''}
        </div>

        <div class="dialer-facts">
          <div>${window.renderPainBadges?.(evalRes.etiquetas_dor) || '<span class="muted">Sem alertas mapeados</span>'}</div>
          <div class="dialer-links">
            ${websiteHref ? `<a class="btn" href="${window.esc(websiteHref)}" target="_blank" rel="noopener noreferrer">🌐 Site</a>` : ''}
            ${igUrl ? `<a class="btn" href="${window.esc(igUrl)}" target="_blank" rel="noopener noreferrer">📸 Instagram</a>` : ''}
            ${fonteHref ? `<a class="btn" href="${window.esc(fonteHref)}" target="_blank" rel="noopener noreferrer">🗺️ Maps / Fonte</a>` : ''}
            <button type="button" class="btn" id="dialerDiagnoseBtn">🔬 Raio-X</button>
          </div>
          ${socios.length ? `<div class="muted" style="font-size:12px">👥 Sócios (BrasilAPI): <strong>${window.esc(socios.join(', '))}</strong></div>` : ''}
        </div>

        <div class="dialer-copy-box">
          <div class="actions" style="justify-content:space-between;align-items:center;margin:0 0 8px">
            <div>
              <strong>Mensagem Inteligente</strong>
              <span class="badge" style="margin-left:6px">${window.esc(copyLabel)}</span>
              <span class="muted" style="margin-left:6px">Variação ${copy.variation_index + 1}/${copy.total_variations}</span>
            </div>
            <div class="actions" style="margin:0">
              <select id="dialerClassicTmpl" style="width:auto;padding:6px 10px;font-size:12px">
                <option value="">✨ Copy Dinâmica (Padrão)</option>
                ${Object.entries(tmplLabels).map(([k, lbl]) => `<option value="${window.esc(k)}">Clássico: ${window.esc(lbl)}</option>`).join('')}
              </select>
              <button type="button" class="btn" id="btnGirarVariacao">🔄 Girar Variação (V)</button>
            </div>
          </div>
          <textarea id="dialerMessageBox" rows="5" class="contact-script">${window.esc(sessionState.lastMessageText)}</textarea>
        </div>

        ${sessionState.awaitingCadence ? `
          <div class="dialer-cadence">
            <strong>✅ WhatsApp aberto e contato registrado! Marque o sinal ou próximo passo em 1 clique:</strong>
            <div class="signal-bar" style="margin-top:8px">
              <span class="muted" style="font-size:11px;font-weight:700">SINAL:</span>
              ${SIGNALS_UI.map((s) => `
                <button type="button" class="signal-chip ${lead.ultimo_sinal === s.id ? 'active' : ''}" data-dialer-signal="${s.id}">${s.label}</button>
              `).join('')}
            </div>
            <div class="actions" style="margin-top:8px">
              <button type="button" class="btn primary" id="cadence2d">Retornar em 2 dias</button>
              <button type="button" class="btn primary" id="cadence7d">Retornar em 7 dias</button>
              <button type="button" class="btn good" id="cadenceVisita">Agendar Visita</button>
              <button type="button" class="btn" id="cadenceNext">Avançar para Próximo →</button>
            </div>
          </div>
        ` : `
          <div class="dialer-actions">
            <button type="button" class="btn good dialer-primary-btn" id="btnDialerWhatsApp">💬 Abrir WhatsApp (Enter)</button>
            ${isLandline && telDigits ? `<a class="btn primary" id="btnDialerCallLandline" href="tel:${telDigits}" style="text-decoration:none">📞 Ligar (tel:)</a>` : ''}
            <button type="button" class="btn" id="btnDialerInvalid" style="border-color:var(--red);color:var(--red)">🚫 Sem WhatsApp / Inválido (I)</button>
            <button type="button" class="btn" id="btnDialerSkip">⏭️ Pular (S)</button>
          </div>
          <p class="muted" style="margin-top:8px;font-size:12px">Atalhos (fora da caixa de texto): <code>Enter</code> Abrir WhatsApp · <code>V</code> Girar variação · <code>S</code> Pular · <code>I</code> Inválido</p>
        `}
      </div>`;

    bindDialerToolbar(container);
    bindDialerCardEvents(container, entry);
  }

  function bindDialerToolbar(container) {
    document.getElementById('btnBackToProspect')?.addEventListener('click', () => {
      sessionState.mode = 'prospeccao';
      sessionState.externalLeads = [];
      sessionState.externalLabel = '';
      sessionState.socialProof = null;
      sessionState.offerContext = null;
      window.renderPowerDialerView(container);
    });
    document.getElementById('dialerOrigem')?.addEventListener('change', (e) => {
      sessionState.filters.origem = e.target.value;
      window.renderPowerDialerView(container);
    });
    document.getElementById('dialerLote')?.addEventListener('change', (e) => {
      sessionState.filters.lote = e.target.value;
      window.renderPowerDialerView(container);
    });
    document.getElementById('dialerSegmento')?.addEventListener('change', (e) => {
      sessionState.filters.segmento = e.target.value;
      window.renderPowerDialerView(container);
    });
    document.getElementById('dialerIncludeFixo')?.addEventListener('change', (e) => {
      sessionState.includeLandline = e.target.checked;
      localStorage.setItem(LANDLINE_STORAGE_KEY, e.target.checked ? '1' : '0');
      window.renderPowerDialerView(container);
    });
    document.getElementById('dialerRefreshBtn')?.addEventListener('click', () => {
      window.renderPowerDialerView(container);
    });
  }

  async function advanceToNext(container, removeCurrent = true) {
    if (removeCurrent) {
      sessionState.queue.splice(sessionState.currentIndex, 1);
    }
    sessionState.awaitingCadence = false;
    sessionState.variationIndex = (sessionState.variationIndex + 1) % 4;
    renderDialerCard(container);
    window.refreshAgendaBadge?.();
  }

  function bindDialerCardEvents(container, entry) {
    const { lead } = entry;
    const msgBox = document.getElementById('dialerMessageBox');

    msgBox?.addEventListener('input', () => {
      sessionState.lastMessageText = msgBox.value;
    });

    document.getElementById('dialerClassicTmpl')?.addEventListener('change', (e) => {
      const key = e.target.value;
      if (!key) {
        sessionState.awaitingCadence = false;
        renderDialerCard(container);
        return;
      }
      if (typeof window.msgTemplate === 'function') {
        const txt = window.msgTemplate(lead, key);
        sessionState.lastMessageText = txt;
        if (msgBox) msgBox.value = txt;
      }
    });

    document.getElementById('btnGirarVariacao')?.addEventListener('click', () => {
      const totalVars = sessionState.mode === 'followup' ? 3 : 4;
      sessionState.variationIndex = (sessionState.variationIndex + 1) % totalVars;
      sessionState.awaitingCadence = false;
      renderDialerCard(container);
    });

    document.getElementById('dialerDiagnoseBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('dialerDiagnoseBtn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
      try {
        const res = await window.api(`/api/leads/${lead.id}/diagnose`, { method: 'POST', body: JSON.stringify({}) });
        if (res.item) {
          const modeId = window.getActiveLensOrMode?.() || window.getActiveScoringMode?.() || 'equilibrado';
          entry.lead = res.item;
          entry.evalRes = window.ScoringModes.evaluateLead(res.item, modeId);
        }
        window.toast?.('Raio-X concluído!');
        renderDialerCard(container);
      } catch (err) {
        window.toast?.('Erro: ' + err.message);
        if (btn) { btn.disabled = false; btn.textContent = '🔬 Raio-X'; }
      }
    });

    document.getElementById('btnDialerWhatsApp')?.addEventListener('click', async () => {
      const text = msgBox?.value || sessionState.lastMessageText;
      const phone = lead.whatsapp || lead.telefone;
      const waUrl = window.Hygiene?.buildWhatsAppLink(phone, text);
      if (!waUrl) return window.toast?.('Número inválido para WhatsApp');

      window.open(waUrl, '_blank', 'noopener,noreferrer');
      try {
        if (sessionState.mode === 'followup') {
          const res = await window.api(`/api/leads/${lead.id}/followup`, {
            method: 'POST',
            body: JSON.stringify({
              tipo: 'WHATSAPP',
              registrar_toque: true,
              resumo: 'Follow-up via Power Dialer',
            }),
          });
          if (res.item) entry.lead = res.item;
        } else {
          const res = await window.api(`/api/leads/${lead.id}/contato`, {
            method: 'POST',
            body: JSON.stringify({ canal: 'whatsapp', resumo: 'Disparo iniciado via Power Dialer' }),
          });
          if (res.item) entry.lead = res.item;
        }
      } catch (err) {
        window.toast?.('Aviso ao registrar contato: ' + err.message);
      }

      sessionState.processed++;
      sessionState.contacted++;
      sessionState.awaitingCadence = true;
      renderDialerCard(container);
    });

    document.getElementById('btnDialerCallLandline')?.addEventListener('click', async () => {
      try {
        if (sessionState.mode === 'followup') {
          const res = await window.api(`/api/leads/${lead.id}/followup`, {
            method: 'POST',
            body: JSON.stringify({
              tipo: 'LIGACAO',
              registrar_toque: true,
              resumo: 'Ligação para telefone fixo via Power Dialer',
            }),
          });
          if (res.item) entry.lead = res.item;
        } else {
          const res = await window.api(`/api/leads/${lead.id}/contato`, {
            method: 'POST',
            body: JSON.stringify({ canal: 'telefone', resumo: 'Ligação para telefone fixo via Power Dialer' }),
          });
          if (res.item) entry.lead = res.item;
        }
      } catch (err) {
        window.toast?.('Aviso ao registrar ligação: ' + err.message);
      }
      sessionState.processed++;
      sessionState.contacted++;
      sessionState.awaitingCadence = true;
      renderDialerCard(container);
    });

    document.querySelectorAll('[data-dialer-signal]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sinal = btn.dataset.dialerSignal;
        try {
          const res = await window.api(`/api/leads/${lead.id}/followup`, {
            method: 'POST',
            body: JSON.stringify({ sinal, registrar_toque: false }),
          });
          if (res.item) {
            entry.lead = res.item;
            if (sessionState.mode === 'followup' && window.CadenceEngine) {
              const lensOrMode = window.getActiveLensOrMode?.() || window.getActiveScoringMode?.() || 'equilibrado';
              entry.cadence = window.CadenceEngine.analyzeLeadCadence(res.item, { modeId: lensOrMode });
              entry.nextStep = window.CadenceEngine.recommendNextStep(res.item, entry.cadence);
            }
          }
          window.toast?.(`Sinal registrado: ${sinal}`);
          renderDialerCard(container);
        } catch (err) {
          window.toast?.('Erro ao registrar sinal: ' + err.message);
        }
      });
    });

    document.getElementById('btnDialerInvalid')?.addEventListener('click', async () => {
      try {
        await window.api(`/api/leads/${lead.id}`, {
          method: 'PUT',
          body: JSON.stringify({ whatsapp_status: 'INVALIDO' }),
        });
        await window.api(`/api/leads/${lead.id}/interacoes`, {
          method: 'POST',
          body: JSON.stringify({ tipo: 'NOTA', resumo: 'Marcado como sem WhatsApp / inválido no Power Dialer' }),
        });
        sessionState.processed++;
        sessionState.invalid++;
        window.toast?.('Marcado como inválido');
        await advanceToNext(container, true);
      } catch (err) {
        window.toast?.('Erro: ' + err.message);
      }
    });

    document.getElementById('btnDialerSkip')?.addEventListener('click', () => {
      sessionState.skippedIds.push(lead.id);
      const skipped = sessionState.queue.splice(sessionState.currentIndex, 1)[0];
      if (skipped) sessionState.queue.push(skipped);
      sessionState.awaitingCadence = false;
      sessionState.variationIndex = (sessionState.variationIndex + 1) % 4;
      renderDialerCard(container);
    });

    const bindFollowup = async (days, note, newStatus = null) => {
      try {
        const data = addDaysIso(days);
        await window.api(`/api/leads/${lead.id}/followup`, {
          method: 'POST',
          body: JSON.stringify({
            proximo_contato: data,
            proximo_contato_nota: note,
            status: newStatus || undefined,
            registrar_toque: false,
          }),
        });
        window.toast?.(`Agendado para ${data}`);
        await advanceToNext(container, true);
      } catch (err) {
        window.toast?.('Erro ao agendar: ' + err.message);
      }
    };

    document.getElementById('cadence2d')?.addEventListener('click', () => bindFollowup(2, 'Retorno D+2 (Power Dialer)'));
    document.getElementById('cadence7d')?.addEventListener('click', () => bindFollowup(7, 'Retorno D+7 (Power Dialer)'));
    document.getElementById('cadenceVisita')?.addEventListener('click', () => bindFollowup(1, 'Visita agendada via Power Dialer', 'VISITA'));
    document.getElementById('cadenceNext')?.addEventListener('click', () => advanceToNext(container, true));
  }

  function bindGlobalKeyboard() {
    if (sessionState.keyListenerBound) return;
    sessionState.keyListenerBound = true;

    document.addEventListener('keydown', (e) => {
      if (!isDialerActive()) return;
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'A'].includes(tag)) return;

      if (e.key === 'Enter' && !sessionState.awaitingCadence) {
        e.preventDefault();
        document.getElementById('btnDialerWhatsApp')?.click();
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        document.getElementById('btnGirarVariacao')?.click();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        document.getElementById('btnDialerSkip')?.click();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        document.getElementById('btnDialerInvalid')?.click();
      }
    });
  }

  window.openPowerDialerWithQueue = async function openPowerDialerWithQueue(leads, {
    mode = 'followup',
    label = 'Follow-up Agenda',
    socialProof = null,
    offerContext = null,
    includeLandline = undefined,
  } = {}) {
    sessionState.mode = mode;
    sessionState.externalLeads = Array.isArray(leads) ? leads : [];
    sessionState.externalLabel = label;
    sessionState.socialProof = socialProof;
    sessionState.offerContext = offerContext;
    if (includeLandline !== undefined) {
      sessionState.includeLandline = Boolean(includeLandline);
      localStorage.setItem(LANDLINE_STORAGE_KEY, sessionState.includeLandline ? '1' : '0');
    }
    if (typeof window.show === 'function') {
      await window.show('dialer');
    }
  };

  window.renderPowerDialerView = async function renderPowerDialerView(container) {
    bindGlobalKeyboard();
    if (sessionState.externalLeads.length) {
      buildQueueFromLeads(sessionState.externalLeads);
    } else {
      sessionState.mode = 'prospeccao';
      sessionState.socialProof = null;
      sessionState.offerContext = null;
      const res = await window.api('/api/leads');
      buildQueueFromLeads(res.items || []);
    }
    sessionState.awaitingCadence = false;
    renderDialerCard(container);
  };
})();
