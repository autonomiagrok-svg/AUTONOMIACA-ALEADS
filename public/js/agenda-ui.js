/**
 * Etapa 5 — Cockpit "Agenda do Dia" (Temperatura, Buckets, Sinais, Radar de Conversão e Ações 1-Clique).
 */
(function () {
  const BUCKETS = [
    { id: 'ATRASADO', label: 'Atrasados', cls: 'critical' },
    { id: 'HOJE', label: 'Para Hoje', cls: 'highlight' },
    { id: 'PROPOSTA_PARADA', label: 'Propostas/Visitas Paradas', cls: 'warn' },
    { id: 'SEM_RESPOSTA', label: 'Sem Resposta (+3d)', cls: '' },
    { id: 'POS_VENDA', label: 'Pós-Venda Clientes', cls: '' },
    { id: 'REATIVACAO', label: 'Reativação (+45d)', cls: '' },
    { id: 'PROXIMOS_DIAS', label: 'Próximos 3 Dias', cls: '' },
  ];

  const SIGNALS_UI = [
    { id: 'QUENTE', label: '🔥 Quente' },
    { id: 'PEDIU_DEPOIS', label: '⏳ Pediu depois' },
    { id: 'OBJECAO_PRECO', label: '💰 Preço' },
    { id: 'TEM_FORNECEDOR', label: '🤝 Já tem forn.' },
    { id: 'PEDIU_PROPOSTA', label: '📄 Pediu proposta' },
    { id: 'SEM_RESPOSTA', label: '😶 Sem retorno' },
  ];

  const agendaState = {
    activeBucket: null,
    radarOpen: false,
    variationMap: new Map(),
    allLeads: [],
  };

  function addDaysStr(days) {
    if (window.DomainSignals?.addDaysIsoDate) {
      return window.DomainSignals.addDaysIsoDate(new Date(), days);
    }
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function phoneDigits(t) {
    return String(t || '').replace(/\D/g, '');
  }

  window.refreshAgendaBadge = async function refreshAgendaBadge(prefetchedLeads = null) {
    const badge = document.getElementById('agendaBadge');
    if (!badge || !window.CadenceEngine) return;
    try {
      const rows = prefetchedLeads || (await window.api('/api/leads')).items || [];
      const lensOrMode = window.getActiveLensOrMode?.() || window.getActiveScoringMode?.() || 'equilibrado';
      let urgent = 0;
      for (const lead of rows) {
        const c = window.CadenceEngine.analyzeLeadCadence(lead, { modeId: lensOrMode });
        if (['ATRASADO', 'HOJE', 'PROPOSTA_PARADA', 'SEM_RESPOSTA', 'POS_VENDA'].includes(c.bucket)) {
          urgent++;
        }
      }
      badge.textContent = String(urgent);
      badge.classList.toggle('hidden', urgent === 0);
    } catch {
      // Silencioso se offline
    }
  };

  function buildEvaluatedList(leads) {
    const lensOrMode = window.getActiveLensOrMode?.() || window.getActiveScoringMode?.() || 'equilibrado';
    const byBucket = {};
    for (const b of BUCKETS) byBucket[b.id] = [];

    for (const lead of leads) {
      const cadence = window.CadenceEngine.analyzeLeadCadence(lead, { modeId: lensOrMode });
      if (!byBucket[cadence.bucket]) continue;
      const nextStep = window.CadenceEngine.recommendNextStep(lead, cadence);
      byBucket[cadence.bucket].push({ lead, cadence, nextStep });
    }

    for (const key of Object.keys(byBucket)) {
      byBucket[key].sort((a, b) => b.cadence.priority_score - a.cadence.priority_score);
    }
    return byBucket;
  }

  function pickDefaultBucket(byBucket) {
    if (agendaState.activeBucket && byBucket[agendaState.activeBucket]) {
      return agendaState.activeBucket;
    }
    for (const b of ['ATRASADO', 'HOJE', 'PROPOSTA_PARADA', 'SEM_RESPOSTA', 'POS_VENDA', 'PROXIMOS_DIAS', 'REATIVACAO']) {
      if (byBucket[b]?.length) return b;
    }
    return 'HOJE';
  }

  function renderRadarHtml(insights) {
    if (!agendaState.radarOpen) return '';
    const temps = insights.temperaturas || {};
    const toq = insights.efetividade_por_toque || {};

    return `
      <div class="panel radar-panel">
        <div class="radar-gargalo">
          <strong>🚨 Gargalo Principal Detectado:</strong> ${window.esc(insights.gargalo_principal)}
        </div>
        <div class="grid" style="margin-top:12px">
          <div class="card"><h3>🔥 Quentes</h3><div class="n" style="color:var(--green)">${temps.QUENTE || 0}</div></div>
          <div class="card"><h3>🌤️ Mornos</h3><div class="n">${temps.MORNO || 0}</div></div>
          <div class="card"><h3>❄️ Esfriando</h3><div class="n" style="color:#fbbf24">${temps.ESFRIANDO || 0}</div></div>
          <div class="card"><h3>🧊 Congelados</h3><div class="n" style="color:var(--red)">${temps.CONGELADO || 0}</div></div>
        </div>
        <div class="radar-columns">
          <div>
            <h4>Efetividade por Nº de Toque</h4>
            <p class="muted">${window.esc(toq.resumo || '')}</p>
            <ul class="radar-list">
              <li>1º toque: ${toq['1']?.avancos || 0}/${toq['1']?.contatados || 0} avanços (${toq['1']?.taxa_avanco || 0}%)</li>
              <li>2º toque: ${toq['2']?.avancos || 0}/${toq['2']?.contatados || 0} avanços (${toq['2']?.taxa_avanco || 0}%)</li>
              <li>3+ toques: ${toq['3+']?.avancos || 0}/${toq['3+']?.contatados || 0} avanços (${toq['3+']?.taxa_avanco || 0}%)</li>
            </ul>
          </div>
          <div>
            <h4>Conversão por Origem</h4>
            <ul class="radar-list">
              ${(insights.conversao_por_origem || []).map((o) => `<li><strong>${window.esc(o.origem)}:</strong> ${o.avancos}/${o.contatados} avanços (${o.taxa_avanco}%) · ${o.total} total</li>`).join('')}
            </ul>
          </div>
          <div>
            <h4>Top Etiquetas de Dor</h4>
            <ul class="radar-list">
              ${(insights.conversao_por_dor || []).slice(0, 5).map((d) => `<li><strong>${window.esc(d.dor)}:</strong> ${d.avancos}/${d.contatados} avanços (${d.taxa_avanco}%) · ${d.total} leads</li>`).join('') || '<li class="muted">Sem dores mapeadas</li>'}
            </ul>
          </div>
        </div>
      </div>`;
  }

  function renderAgendaCard(entry, modeId, operador) {
    const { lead, cadence, nextStep } = entry;
    const varIdx = agendaState.variationMap.get(lead.id) ?? 0;
    const copy = window.CadenceEngine.generateSmartFollowUp(lead, {
      operador,
      modeId,
      variationIndex: varIdx,
    });

    const channelLabel = nextStep.canal_sugerido === 'LIGACAO'
      ? '📞 Ligar (Registrar Toque)'
      : (nextStep.canal_sugerido === 'EMAIL' ? '✉️ Enviar E-mail' : '💬 Enviar Follow-up WhatsApp');

    const signalLabel = SIGNALS_UI.find((s) => s.id === cadence.ultimo_sinal)?.label || cadence.ultimo_sinal;

    return `
      <article class="panel agenda-card" data-lead-id="${window.esc(lead.id)}">
        <div class="agenda-card-head">
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <strong style="font-size:16px">${window.esc(lead.nome_fantasia)}</strong>
              ${window.renderOriginBadge?.(lead) || ''}
              <span class="temp-badge temp-${window.esc(cadence.temperatura)}">${window.esc(cadence.temperatura)}</span>
              <span class="badge ${window.esc(lead.status)}">${window.esc(lead.status)}</span>
              ${cadence.ultimo_sinal ? `<span class="badge" style="border:1px solid var(--cyan);color:var(--cyan)">${window.esc(signalLabel)}</span>` : ''}
            </div>
            <p class="muted" style="margin:4px 0 0">
              <strong>${cadence.tentativas_contato}º toque</strong> ·
              há <strong>${cadence.dias_sem_contato}d</strong> sem contato ·
              ${lead.proximo_contato ? `Agendado: <strong>${window.esc(lead.proximo_contato)}</strong> · ` : ''}
              ${window.esc(lead.cidade || '')} · ${window.esc(lead.whatsapp || lead.telefone || 'Sem telefone')}
            </p>
          </div>
          <div class="agenda-priority-pill" title="Valor em Risco no modo ativo">
            <span>Valor em Risco</span>
            <strong>${cadence.priority_score}</strong>
          </div>
        </div>

        <div class="agenda-rec ${nextStep.alerta_excesso ? 'alert' : ''}">
          <div>
            <strong>${nextStep.alerta_excesso ? '⚠️ ' : '🎯 '}${window.esc(nextStep.acao_titulo)}</strong>
            <span class="muted" style="margin-left:8px">Canal sugerido: <strong>${window.esc(nextStep.canal_sugerido)}</strong> · Salto +${nextStep.proximo_salto_dias}d</span>
          </div>
          ${lead.proximo_contato_nota ? `<div class="muted" style="font-size:12px;margin-top:3px">Nota: ${window.esc(lead.proximo_contato_nota)}</div>` : ''}
        </div>

        <div class="agenda-msg-wrap">
          <div class="actions" style="justify-content:space-between;align-items:center;margin:0 0 6px">
            <span class="muted" style="font-size:12px">Estratégia: <strong>${window.esc(copy.estrategia)}</strong> · Variação ${copy.variation_index + 1}/${copy.total_variations}</span>
            <button type="button" class="btn agenda-rotate-btn" data-id="${window.esc(lead.id)}" style="padding:5px 10px;font-size:12px">🔄 Girar Texto</button>
          </div>
          <textarea class="contact-script agenda-msg-text" data-id="${window.esc(lead.id)}" rows="3">${window.esc(copy.text)}</textarea>
        </div>

        <div class="signal-bar">
          <span class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase">Sinal do cliente:</span>
          ${SIGNALS_UI.map((s) => `
            <button type="button" class="signal-chip ${cadence.ultimo_sinal === s.id ? 'active' : ''}"
              data-id="${window.esc(lead.id)}" data-signal="${window.esc(s.id)}">
              ${s.label}
            </button>
          `).join('')}
        </div>

        <div class="agenda-actions-row">
          <button type="button" class="btn good agenda-exec-btn" data-id="${window.esc(lead.id)}" data-channel="${window.esc(nextStep.canal_sugerido)}" data-jump="${nextStep.proximo_salto_dias}">
            ${channelLabel}
          </button>
          <div class="actions" style="margin:0">
            <button type="button" class="btn agenda-resched-btn" data-id="${window.esc(lead.id)}" data-days="2">+2d</button>
            <button type="button" class="btn agenda-resched-btn" data-id="${window.esc(lead.id)}" data-days="5">+5d</button>
            <button type="button" class="btn agenda-resched-btn" data-id="${window.esc(lead.id)}" data-days="15">+15d</button>
            <button type="button" class="btn agenda-hibernate-btn" data-id="${window.esc(lead.id)}">Hibernar (+45d)</button>
          </div>
          <div class="actions" style="margin:0">
            <button type="button" class="btn agenda-stage-btn" data-id="${window.esc(lead.id)}" data-status="VISITA">Visita</button>
            <button type="button" class="btn agenda-stage-btn" data-id="${window.esc(lead.id)}" data-status="PROPOSTA">Proposta</button>
            <button type="button" class="btn primary agenda-stage-btn" data-id="${window.esc(lead.id)}" data-status="CLIENTE">Fechar Cliente</button>
            <button type="button" class="btn agenda-stage-btn" data-id="${window.esc(lead.id)}" data-status="DESCARTADO" style="color:var(--red)">Descartar</button>
            <button type="button" class="btn" onclick="openLead('${window.esc(lead.id)}')">Ficha</button>
          </div>
        </div>
      </article>`;
  }

  function renderAgenda(container) {
    const lensOrMode = window.getActiveLensOrMode?.() || window.getActiveScoringMode?.() || 'equilibrado';
    const modeLabel = window.getActiveModeLabel?.() || 'Equilibrado';
    const operador = window.getActiveOperatorName?.() || 'Rafael Oliveira';
    const byBucket = buildEvaluatedList(agendaState.allLeads);
    agendaState.activeBucket = pickDefaultBucket(byBucket);

    const insights = window.RelationshipAnalytics.computeRelationshipInsights(agendaState.allLeads, { modeId: lensOrMode });
    const currentList = byBucket[agendaState.activeBucket] || [];
    const activeBucketMeta = BUCKETS.find((b) => b.id === agendaState.activeBucket) || BUCKETS[0];

    container.innerHTML = `
      <div class="panel agenda-header">
        <div>
          <h3 style="margin:0">Cockpit de Relacionamento & Cadência Adaptativa</h3>
          <p class="muted" style="margin:4px 0 0">
            Ordenando por <strong>Valor em Risco</strong> sob a lente <span class="badge ALTO">${window.esc(modeLabel)}</span> ·
            <strong>${insights.urgentes_hoje}</strong> ações urgentes hoje
          </p>
        </div>
        <div class="actions" style="margin:0">
          <button type="button" class="btn" id="btnToggleRadar">📊 ${agendaState.radarOpen ? 'Ocultar' : 'Abrir'} Radar de Conversão</button>
          <button type="button" class="btn primary" id="btnRunUrgentDialer" ${currentList.length ? '' : 'disabled'}>
            🚀 Rodar Fila (${currentList.length}) no Power Dialer
          </button>
        </div>
      </div>

      ${renderRadarHtml(insights)}

      <div class="bucket-strip" role="tablist" aria-label="Filas da agenda">
        ${BUCKETS.map((b) => {
          const count = byBucket[b.id]?.length || 0;
          const isActive = b.id === agendaState.activeBucket;
          return `
            <button type="button" class="bucket-pill ${b.cls} ${isActive ? 'active' : ''}" data-bucket="${b.id}">
              <span>${b.label}</span>
              <strong>${count}</strong>
            </button>`;
        }).join('')}
      </div>

      <div id="agendaCardsList">
        ${currentList.slice(0, 40).map((entry) => renderAgendaCard(entry, lensOrMode, operador)).join('') || `
          <div class="panel" style="text-align:center;padding:30px">
            <p class="muted">Nenhum lead no bucket <strong>${window.esc(activeBucketMeta.label)}</strong> no momento.</p>
          </div>`}
      </div>`;

    bindAgendaEvents(container, currentList, activeBucketMeta.label);
    window.refreshAgendaBadge(agendaState.allLeads);
  }

  function bindAgendaEvents(container, currentList, bucketLabel) {
    document.getElementById('btnToggleRadar')?.addEventListener('click', () => {
      agendaState.radarOpen = !agendaState.radarOpen;
      renderAgenda(container);
    });

    document.getElementById('btnRunUrgentDialer')?.addEventListener('click', () => {
      const leadsToRun = currentList.map((e) => e.lead);
      if (!leadsToRun.length) return;
      document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === 'dialer'));
      window.openPowerDialerWithQueue?.(leadsToRun, { mode: 'followup', label: `Agenda: ${bucketLabel}` });
    });

    document.querySelectorAll('.bucket-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        agendaState.activeBucket = btn.dataset.bucket;
        renderAgenda(container);
      });
    });

    document.querySelectorAll('.agenda-rotate-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lid = btn.dataset.id;
        const next = ((agendaState.variationMap.get(lid) ?? 0) + 1) % 3;
        agendaState.variationMap.set(lid, next);
        renderAgenda(container);
      });
    });

    document.querySelectorAll('.signal-chip').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const lid = btn.dataset.id;
        const sinal = btn.dataset.signal;
        try {
          const res = await window.api(`/api/leads/${lid}/followup`, {
            method: 'POST',
            body: JSON.stringify({ sinal, registrar_toque: false }),
          });
          agendaState.allLeads = agendaState.allLeads.map((l) => (l.id === lid ? res.item : l));
          window.toast?.(`Sinal registrado: ${sinal}`);
          renderAgenda(container);
        } catch (err) {
          window.toast?.('Erro ao registrar sinal: ' + err.message);
        }
      });
    });

    document.querySelectorAll('.agenda-exec-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const lid = btn.dataset.id;
        const channel = btn.dataset.channel;
        const jump = Number(btn.dataset.jump || 3);
        const lead = agendaState.allLeads.find((l) => l.id === lid);
        if (!lead) return;

        const msgEl = document.querySelector(`.agenda-msg-text[data-id="${lid}"]`);
        const msgText = msgEl?.value || '';
        const phone = lead.whatsapp || lead.telefone;

        if (channel === 'WHATSAPP') {
          const url = window.Hygiene?.buildWhatsAppLink(phone, msgText);
          if (!url) return window.toast?.('WhatsApp inválido ou ausente');
          window.open(url, '_blank', 'noopener,noreferrer');
        } else if (channel === 'LIGACAO') {
          const d = phoneDigits(phone);
          if (!d) return window.toast?.('Telefone ausente');
          window.open(`tel:${d}`, '_self');
        } else if (channel === 'EMAIL') {
          if (!lead.email) return window.toast?.('E-mail ausente');
          window.open(`mailto:${lead.email}?subject=${encodeURIComponent('AutonomIA Systems — Acompanhamento')}&body=${encodeURIComponent(msgText)}`, '_blank');
        }

        const nextDate = addDaysStr(jump);
        try {
          const res = await window.api(`/api/leads/${lid}/followup`, {
            method: 'POST',
            body: JSON.stringify({
              tipo: channel,
              registrar_toque: true,
              proximo_contato: nextDate,
              proximo_contato_nota: `Follow-up ${channel} executado (próximo salto +${jump}d)`,
              resumo: `Follow-up via ${channel} na Agenda do Dia`,
            }),
          });
          agendaState.allLeads = agendaState.allLeads.map((l) => (l.id === lid ? res.item : l));
          window.toast?.(`Toque registrado e próximo contato agendado para ${nextDate}`);
          renderAgenda(container);
        } catch (err) {
          window.toast?.('Erro ao registrar follow-up: ' + err.message);
        }
      });
    });

    document.querySelectorAll('.agenda-resched-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const lid = btn.dataset.id;
        const days = Number(btn.dataset.days || 2);
        const nextDate = addDaysStr(days);
        try {
          const res = await window.api(`/api/leads/${lid}/followup`, {
            method: 'POST',
            body: JSON.stringify({
              proximo_contato: nextDate,
              proximo_contato_nota: `Reagendado +${days}d na Agenda`,
              registrar_toque: false,
            }),
          });
          agendaState.allLeads = agendaState.allLeads.map((l) => (l.id === lid ? res.item : l));
          window.toast?.(`Reagendado para ${nextDate}`);
          renderAgenda(container);
        } catch (err) {
          window.toast?.('Erro: ' + err.message);
        }
      });
    });

    document.querySelectorAll('.agenda-hibernate-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const lid = btn.dataset.id;
        const until = addDaysStr(45);
        try {
          const res = await window.api(`/api/leads/${lid}/followup`, {
            method: 'POST',
            body: JSON.stringify({
              hibernar_ate: until,
              proximo_contato: null,
              registrar_toque: false,
              resumo: `Lead colocado em hibernação (cooling-off) até ${until}`,
            }),
          });
          agendaState.allLeads = agendaState.allLeads.map((l) => (l.id === lid ? res.item : l));
          window.toast?.(`Lead hibernado até ${until}`);
          renderAgenda(container);
        } catch (err) {
          window.toast?.('Erro: ' + err.message);
        }
      });
    });

    document.querySelectorAll('.agenda-stage-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const lid = btn.dataset.id;
        const newStatus = btn.dataset.status;
        try {
          const res = await window.api(`/api/leads/${lid}/followup`, {
            method: 'POST',
            body: JSON.stringify({
              status: newStatus,
              tipo: newStatus === 'CLIENTE' ? 'CONVERSAO' : (newStatus === 'PROPOSTA' ? 'PROPOSTA' : (newStatus === 'VISITA' ? 'VISITA' : 'NOTA')),
              registrar_toque: false,
              proximo_contato: (newStatus === 'CLIENTE' || newStatus === 'DESCARTADO') ? null : undefined,
              resumo: `Status atualizado para ${newStatus} na Agenda do Dia`,
            }),
          });
          agendaState.allLeads = agendaState.allLeads.map((l) => (l.id === lid ? res.item : l));
          window.toast?.(`Lead movido para ${newStatus}`);
          renderAgenda(container);
        } catch (err) {
          window.toast?.('Erro: ' + err.message);
        }
      });
    });
  }

  window.renderAgendaCockpit = async function renderAgendaCockpit(container) {
    const res = await window.api('/api/leads');
    agendaState.allLeads = res.items || [];
    renderAgenda(container);
  };
})();
