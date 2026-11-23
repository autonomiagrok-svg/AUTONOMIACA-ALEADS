/**
 * Fronteira Ciclo A — Cockpit "Inteligência & Território" (Lentes de Oferta, Auto-Calibragem Empírica, Bolsões & Lookalike).
 */
(function () {
  const WEIGHT_FIELDS = [
    { key: 'tem_whatsapp', label: 'WhatsApp / Celular válido', min: -30, max: 40 },
    { key: 'sem_site', label: 'Sem Site / Fora do Ar', min: -30, max: 40 },
    { key: 'so_link_bio', label: 'Só Link na Bio', min: -30, max: 40 },
    { key: 'site_sem_whatsapp', label: 'Site sem WhatsApp', min: -30, max: 40 },
    { key: 'sem_trafego', label: 'Sem Tráfego Rastreado', min: -30, max: 40 },
    { key: 'ecommerce_sem_pixel', label: 'E-commerce sem Pixel', min: -30, max: 40 },
    { key: 'sem_mobile', label: 'Sem Mobile', min: -30, max: 40 },
    { key: 'site_lento', label: 'Site Lento', min: -30, max: 40 },
    { key: 'sem_https', label: 'Sem HTTPS', min: -30, max: 40 },
    { key: 'empresa_recente', label: 'Empresa Recente (<= 18m)', min: -30, max: 40 },
    { key: 'nota_alta', label: 'Nota >= 4.2 no Maps', min: -30, max: 40 },
    { key: 'volume_avaliacoes', label: 'Volume >= 30 avaliações', min: -30, max: 40 },
    { key: 'cnpj_ativo', label: 'CNPJ Ativo', min: -30, max: 40 },
    { key: 'so_fixo_penalidade', label: 'Penalidade Só Fixo', min: -40, max: 20 },
  ];

  const LANDLINE_STORAGE_KEY = 'autonomia_include_landline';

  const intelState = {
    subtab: 'lenses', // 'lenses' | 'calibration' | 'territory' | 'matrix'
    editingLens: null,
    calibrationData: null,
    territoryData: null,
    matrixData: null,
    selectedQuadrant: 'OURO',
    includeLandline: localStorage.getItem(LANDLINE_STORAGE_KEY) !== '0',
    systemHealth: null,
    cleanupPreview: null,
    lastCleanupResult: null,
    allLeads: [],
    selectedRefId: '',
    lookalikeData: null,
  };

  function emptyLensDraft(basePreset = 'equilibrado') {
    const pesos = window.ScoringModes?.getPresetWeights?.(basePreset) || {
      tem_whatsapp: 15, sem_site: 20, so_link_bio: 18, site_sem_whatsapp: 25, sem_trafego: 15,
      ecommerce_sem_pixel: 20, sem_mobile: 14, site_lento: 10, sem_https: 10,
      empresa_recente: 10, nota_alta: 15, volume_avaliacoes: 10, cnpj_ativo: 10, so_fixo_penalidade: -15,
    };
    return {
      id: null,
      nome: '',
      descricao: '',
      oferta_contexto: '',
      pesos,
      filtros: { exigir_whatsapp: false, segmentos_boost: [], bairros_boost: [] },
    };
  }

  function renderTabsHeader() {
    const tabs = [
      { id: 'lenses', label: '🎯 Lentes de Oferta' },
      { id: 'calibration', label: '📈 Auto-Calibragem Empírica' },
      { id: 'territory', label: '🗺️ Bolsões & Lookalike' },
      { id: 'matrix', label: '💎 Matriz Dinheiro × Brecha' },
    ];
    return `
      <div class="panel intel-tabs-bar">
        <div class="mode-pills" style="margin:0">
          ${tabs.map((t) => `
            <button type="button" class="mode-pill intel-subtab ${intelState.subtab === t.id ? 'active' : ''}" data-subtab="${t.id}">
              ${t.label}
            </button>
          `).join('')}
        </div>
        <span class="badge ALTO">Lente ativa: ${window.esc(window.getActiveModeLabel?.() || 'Equilibrado')}</span>
      </div>`;
  }

  function renderLensesTab() {
    const nativeModes = window.ScoringModes?.SCORING_MODES || [];
    const customLenses = window.CUSTOM_LENSES || [];
    const activeId = window.getActiveScoringMode?.() || 'equilibrado';
    const draft = intelState.editingLens || emptyLensDraft();
    const isEdit = Boolean(draft.id);

    return `
      <div class="intel-grid-2">
        <section class="panel">
          <div class="actions" style="justify-content:space-between;align-items:center;margin:0 0 10px">
            <h3 style="margin:0">Lentes Ativas & Presets</h3>
            <button type="button" class="btn primary" id="btnNewLens">+ Nova Lente</button>
          </div>

          <p class="muted" style="margin:0 0 8px"><strong>4 Modos Nativos</strong></p>
          <div class="lens-list">
            ${nativeModes.map((m) => `
              <div class="lens-card ${activeId === m.id ? 'active' : ''}">
                <div>
                  <strong>${window.esc(m.label)}</strong>
                  <div class="muted" style="font-size:12px">${window.esc(m.description)}</div>
                </div>
                <div class="actions" style="margin:6px 0 0">
                  <button type="button" class="btn ${activeId === m.id ? 'primary' : ''} btn-activate-lens" data-id="${m.id}">
                    ${activeId === m.id ? '✓ Ativa' : 'Ativar'}
                  </button>
                  <button type="button" class="btn btn-dup-preset" data-preset="${m.id}">Duplicar p/ Editar</button>
                </div>
              </div>
            `).join('')}
          </div>

          <p class="muted" style="margin:14px 0 8px"><strong>Lentes Customizadas (${customLenses.length})</strong></p>
          <div class="lens-list">
            ${customLenses.map((l) => `
              <div class="lens-card ${activeId === l.id ? 'active' : ''}">
                <div>
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <strong>✨ ${window.esc(l.nome)}</strong>
                    ${l.origem_calibracao ? '<span class="badge QUALIFICADO">Empírica</span>' : ''}
                  </div>
                  <div class="muted" style="font-size:12px">${window.esc(l.descricao || 'Sem descrição')}</div>
                  ${l.oferta_contexto ? `<div class="muted" style="font-size:11px;color:var(--cyan)">Oferta Copy: ${window.esc(l.oferta_contexto)}</div>` : ''}
                </div>
                <div class="actions" style="margin:6px 0 0">
                  <button type="button" class="btn ${activeId === l.id ? 'primary' : ''} btn-activate-lens" data-id="${window.esc(l.id)}">
                    ${activeId === l.id ? '✓ Ativa' : 'Ativar'}
                  </button>
                  <button type="button" class="btn btn-edit-lens" data-id="${window.esc(l.id)}">Editar</button>
                  <button type="button" class="btn btn-dup-lens" data-id="${window.esc(l.id)}">Duplicar</button>
                  <button type="button" class="btn btn-del-lens" data-id="${window.esc(l.id)}" style="color:var(--red)">Excluir</button>
                </div>
              </div>
            `).join('') || '<p class="muted">Nenhuma lente customizada ainda. Crie uma ao lado ou gere via Auto-Calibragem.</p>'}
          </div>
        </section>

        <section class="panel">
          <h3 style="margin-top:0">${isEdit ? `Editando: ${window.esc(draft.nome)}` : 'Criar Nova Lente de Oferta'}</h3>
          <form id="lensEditorForm" class="form">
            <div class="field full">
              <label>Nome da Lente *</label>
              <input id="lensNome" required value="${window.esc(draft.nome)}" placeholder="Ex: Sites p/ Clínicas Centro" />
            </div>
            <div class="field full">
              <label>Descrição</label>
              <input id="lensDesc" value="${window.esc(draft.descricao || '')}" placeholder="Ex: Foco em clínicas bem avaliadas sem WhatsApp no site" />
            </div>
            <div class="field full">
              <label>Contexto da Oferta (alimenta o Copy Engine)</label>
              <input id="lensOffer" value="${window.esc(draft.oferta_contexto || '')}" placeholder="Ex: criação de página de alta conversão com WhatsApp integrado" />
            </div>

            <div class="field full">
              <label style="margin-bottom:8px">Pesos de Pontuação (-50 a +50)</label>
              <div class="weights-grid">
                ${WEIGHT_FIELDS.map((wf) => {
      const val = draft.pesos?.[wf.key] ?? 0;
      return `
                    <div class="weight-row">
                      <div style="display:flex;justify-content:space-between;font-size:12px">
                        <span>${wf.label}</span>
                        <strong id="wval_${wf.key}">${val > 0 ? '+' : ''}${val}</strong>
                      </div>
                      <input type="range" min="${wf.min}" max="${wf.max}" value="${val}"
                        class="lens-weight-input" data-key="${wf.key}" />
                    </div>`;
    }).join('')}
              </div>
            </div>

            <div class="field">
              <label>Segmentos Boost (+15 pts, separados por vírgula)</label>
              <input id="lensSegBoost" value="${window.esc((draft.filtros?.segmentos_boost || []).join(', '))}" placeholder="CLINICA, RESTAURANTE" />
            </div>
            <div class="field">
              <label>Bairros Boost (+10 pts, separados por vírgula)</label>
              <input id="lensBairroBoost" value="${window.esc((draft.filtros?.bairros_boost || []).join(', '))}" placeholder="Centro, Esplanada" />
            </div>
            <div class="field full">
              <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="lensReqWa" style="width:auto" ${draft.filtros?.exigir_whatsapp ? 'checked' : ''} />
                Exigir WhatsApp válido para considerar lead acionável
              </label>
            </div>
            <div class="actions full">
              <button type="submit" class="btn primary">${isEdit ? '💾 Salvar Alterações' : '✨ Criar Lente'}</button>
              ${isEdit ? '<button type="button" class="btn" id="btnCancelEditLens">Cancelar Edição</button>' : ''}
            </div>
          </form>
        </section>
      </div>`;
  }

  function renderCalibrationTab() {
    const data = intelState.calibrationData;
    if (!data) return '<div class="panel loading">Calculando estatísticas empíricas...</div>';
    const { analise, comparativo, maturidade_diagnostico } = data;

    return `
      <div class="panel">
        <div class="agenda-header">
          <div>
            <h3 style="margin:0">Loop Fechado — Auto-Calibragem Bayesiana (alpha = ${analise.alpha})</h3>
            <p class="muted" style="margin:4px 0 0">${window.esc(maturidade_diagnostico)}</p>
          </div>
          <button type="button" class="btn primary" id="btnSaveCalibratedLens">✨ Salvar/Atualizar Lente Auto-Calibrada</button>
        </div>
        <div class="grid" style="margin-top:12px">
          <div class="card"><h3>Total na Base</h3><div class="n">${analise.total_base}</div></div>
          <div class="card"><h3>Leads Abordados</h3><div class="n">${analise.amostra_total}</div></div>
          <div class="card"><h3>Avanços Reais</h3><div class="n" style="color:var(--green)">${analise.sucessos_totais}</div></div>
          <div class="card"><h3>Taxa Base Global</h3><div class="n">${(analise.base_rate * 100).toFixed(1)}%</div></div>
        </div>
      </div>

      <div class="panel tablewrap">
        <h3 style="margin-top:0">Antes vs. Depois — Proposta de Pesos Calibrados</h3>
        <table>
          <thead><tr><th>Fator</th><th>Antes</th><th>Delta</th><th>Depois</th><th>Amostra</th><th>Lift</th><th>Confiança</th></tr></thead>
          <tbody>
            ${comparativo.map((c) => `
              <tr>
                <td><strong>${window.esc(c.label)}</strong></td>
                <td>${c.antes > 0 ? '+' : ''}${c.antes}</td>
                <td style="color:${c.delta > 0 ? 'var(--green)' : (c.delta < 0 ? 'var(--red)' : 'var(--muted)')};font-weight:700">${c.delta > 0 ? '+' : ''}${c.delta}</td>
                <td><strong>${c.depois > 0 ? '+' : ''}${c.depois}</strong></td>
                <td>${c.amostra}</td>
                <td>${c.lift.toFixed(2)}x</td>
                <td><span class="conf-badge conf-${c.confianca}">${c.confianca}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="panel tablewrap">
        <h3 style="margin-top:0">Performance Empírica por Sinal</h3>
        <table>
          <thead><tr><th>Sinal</th><th>Amostra</th><th>Avanços</th><th>Taxa Suavizada</th><th>Lift</th><th>Confiança</th><th>Delta</th><th>Diagnóstico</th></tr></thead>
          <tbody>
            ${(analise.sinais || []).slice(0, 25).map((s) => `
              <tr>
                <td><strong>${window.esc(s.label)}</strong></td>
                <td>${s.amostra}</td>
                <td>${s.sucessos}</td>
                <td>${(s.smoothed_rate * 100).toFixed(1)}%</td>
                <td><strong>${s.lift.toFixed(2)}x</strong></td>
                <td><span class="conf-badge conf-${s.confianca}">${s.confianca}</span></td>
                <td>${s.delta_peso_sugerido > 0 ? '+' : ''}${s.delta_peso_sugerido}</td>
                <td class="muted">${window.esc(s.explicacao)}</td>
              </tr>
            `).join('') || '<tr><td colspan="8" class="muted">Nenhum lead abordado ainda para calcular sinais.</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  function renderTerritoryTab() {
    const tData = intelState.territoryData;
    const bolsoes = tData?.bolsoes || [];

    const sortedRefs = [...intelState.allLeads].sort((a, b) => {
      const rank = { CLIENTE: 0, PROPOSTA: 1, VISITA: 2, CONTATADO: 3, QUALIFICADO: 4, NOVO: 5, DESCARTADO: 6 };
      const ra = rank[a.status] ?? 9;
      const rb = rank[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      return (b.score || 0) - (a.score || 0);
    });

    const lookItems = intelState.lookalikeData?.items || [];
    const lookRef = intelState.lookalikeData?.reference || null;

    return `
      <div class="panel">
        <div class="agenda-header">
          <div>
            <h3 style="margin:0">🗺️ Bolsões de Oceano Azul (Bairro × Segmento × Dor)</h3>
            <p class="muted" style="margin:4px 0 0">Territórios quentes com alto potencial e baixa saturação, ordenados sob a lente <strong>${window.esc(window.getActiveModeLabel?.() || '')}</strong>.</p>
          </div>
          <span class="badge ALTO">${bolsoes.length} bolsões mapeados</span>
        </div>

        <div class="tablewrap" style="margin-top:12px">
          <table>
            <thead><tr><th>Bairro / Cidade</th><th>Segmento</th><th>Oceano Azul</th><th>Prontos / Total</th><th>Penetração</th><th>Dor Dominante</th><th>Nota / Score</th><th></th></tr></thead>
            <tbody>
              ${bolsoes.slice(0, 20).map((b, idx) => `
                <tr>
                  <td>
                    <strong>${window.esc(b.bairro)}</strong>
                    ${b.tem_cliente_local ? '<span class="badge CLIENTE" style="margin-left:4px">Cliente local</span>' : ''}
                    <div class="muted" style="font-size:11px">${window.esc(b.cidade)}</div>
                  </td>
                  <td>${window.esc(b.segmento)}</td>
                  <td><strong style="color:var(--cyan);font-size:16px">${b.indice_oceano_azul}</strong>/100</td>
                  <td><strong>${b.prontos_para_abordar}</strong> / ${b.total_leads}</td>
                  <td>${b.taxa_penetracao}%</td>
                  <td>${b.dor_dominante ? `<span class="pain-badge opportunity">${window.esc(b.dor_dominante)} (${b.dor_dominante_pct}%)</span>` : '—'}</td>
                  <td>${b.nota_media != null ? `⭐ ${b.nota_media}` : '—'} · Score ${b.score_medio}</td>
                  <td>
                    <button type="button" class="btn primary btn-hunt-cluster" data-idx="${idx}" ${b.prontos_para_abordar ? '' : 'disabled'}>
                      🚀 Caçar (${b.prontos_para_abordar})
                    </button>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="8" class="muted">Nenhum bolsão com 2+ leads encontrado.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="agenda-header">
          <div>
            <h3 style="margin:0">🎯 Buscador Lookalike — Clones do Melhor Cliente</h3>
            <p class="muted" style="margin:4px 0 0">Selecione um cliente fechado ou proposta de referência para encontrar vizinhos e perfis idênticos prontos para abordagem com Prova Social Hiper-Local.</p>
          </div>
          ${lookItems.length ? `
            <button type="button" class="btn good" id="btnDispatchLookalike">
              🚀 Disparar ${lookItems.length} Clones no Power Dialer (com Prova Social Local)
            </button>` : ''}
        </div>

        <div class="actions" style="margin-top:12px;align-items:center">
          <select id="lookalikeRefSelect" style="max-width:480px">
            <option value="">Selecione um lead referência (Clientes & Propostas no topo)...</option>
            ${sortedRefs.slice(0, 200).map((l) => `
              <option value="${window.esc(l.id)}" ${intelState.selectedRefId === l.id ? 'selected' : ''}>
                [${window.esc(l.status)}] ${window.esc(l.nome_fantasia)} — ${window.esc(l.segmento)} · ${window.esc(l.bairro || l.cidade || '')}
              </option>
            `).join('')}
          </select>
          <button type="button" class="btn primary" id="btnRunLookalike">Encontrar Clones</button>
        </div>

        ${lookRef ? `
          <div class="dialer-highlight" style="margin-top:12px">
            <strong>Referência:</strong> ${window.esc(lookRef.nome_fantasia)} (${window.esc(lookRef.segmento)} · ${window.esc(lookRef.bairro || 'Sem bairro')}, ${window.esc(lookRef.cidade || '')}) — <strong>${lookItems.length} clones encontrados</strong>.
          </div>
          <div class="tablewrap" style="margin-top:10px">
            <table>
              <thead><tr><th>Clone Candidato</th><th>Similaridade</th><th>Localização</th><th>Contato</th><th>Razões do Match</th><th></th></tr></thead>
              <tbody>
                ${lookItems.map((it) => `
                  <tr>
                    <td>
                      <strong>${window.esc(it.lead.nome_fantasia)}</strong>
                      ${window.renderOriginBadge?.(it.lead) || ''}
                    </td>
                    <td><strong style="color:var(--green);font-size:15px">${it.similarity_score}%</strong></td>
                    <td>${window.esc(it.lead.bairro || '—')}, ${window.esc(it.lead.cidade || '')}</td>
                    <td>${window.esc(it.lead.whatsapp || it.lead.telefone || '—')}</td>
                    <td>${(it.razoes_match || []).map((r) => `<span class="breakdown-chip pos">${window.esc(r)}</span>`).join(' ')}</td>
                    <td><button type="button" class="btn intel-open-lead-btn" data-id="${window.esc(it.lead.id)}">Ficha</button></td>
                  </tr>
                `).join('') || '<tr><td colspan="6" class="muted">Nenhum clone novo acionável encontrado para este lead.</td></tr>'}
              </tbody>
            </table>
          </div>` : ''}
      </div>`;
  }

  function renderMatrixTab() {
    const mData = intelState.matrixData;
    if (!mData) return '<div class="panel loading">Calculando Matriz Dinheiro × Brecha...</div>';
    intelState.includeLandline = localStorage.getItem(LANDLINE_STORAGE_KEY) !== '0';
    const qs = mData.quadrantes || {};
    const order = ['OURO', 'EXPANSAO', 'ENTRADA', 'OBSERVACAO'];
    const selected = qs[intelState.selectedQuadrant] || qs.OURO;

    return `
      <div class="panel">
        <div class="agenda-header" style="margin-bottom:10px">
          <div>
            <h3 style="margin:0">💎 Matriz Bidimensional — Dinheiro (Caixa) × Brecha (Dor)</h3>
            <p class="muted" style="margin:4px 0 0">Separa empresas com maior capacidade de pagamento (Caixa) daquelas com brechas técnicas/digitais mais urgentes (Brecha).</p>
          </div>
          <label class="matrix-fixo-toggle">
            <input type="checkbox" id="matrixIncludeFixo" ${intelState.includeLandline ? 'checked' : ''} />
            ☎️ Incluir Telefones Fixos (WhatsApp Business / Ligação)
          </label>
        </div>
        <div class="matrix-grid-2x2">
          ${order.map((key) => {
      const q = qs[key];
      if (!q) return '';
      const isSel = key === intelState.selectedQuadrant;
      const readyIds = intelState.includeLandline
        ? (q.lead_ids_prontos_com_fixo || q.lead_ids || [])
        : (q.lead_ids_prontos_celular || []);
      const readyCount = readyIds.length;
      const celCount = q.acionaveis_celular ?? readyCount;
      const fixoCount = q.acionaveis_fixo ?? 0;
      return `
              <div class="matrix-quad quad-${key} ${isSel ? 'selected' : ''}" data-quad="${key}">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                  <strong style="font-size:15px">${window.esc(q.label)}</strong>
                  <span class="badge ${key === 'OURO' ? 'ALTO' : ''}">${q.total} leads (${readyCount} prontos: ${celCount} cel + ${fixoCount} fixos)</span>
                </div>
                <p class="muted" style="margin:6px 0;font-size:12px">${window.esc(q.titulo)}</p>
                <div class="muted" style="font-size:12px">Caixa médio: <strong>${q.media_caixa}</strong> · Brecha média: <strong>${q.media_brecha}</strong></div>
                <div class="actions" style="margin-top:10px">
                  <button type="button" class="btn ${key === 'OURO' ? 'primary' : ''} btn-hunt-quad" data-quad="${key}" ${readyCount ? '' : 'disabled'}>
                    🚀 Caçar ${readyCount} no Power Dialer
                  </button>
                </div>
              </div>`;
    }).join('')}
        </div>
      </div>

      ${selected ? `
        <div class="panel tablewrap">
          <div class="agenda-header" style="margin-bottom:10px">
            <div>
              <h3 style="margin:0">Top Leads — ${window.esc(selected.label)}</h3>
              <p class="muted" style="margin:4px 0 0">${window.esc(selected.recomendacao)}</p>
            </div>
          </div>
          <table>
            <thead><tr><th>Lead</th><th>Caixa × Brecha</th><th>Stack / TTFB</th><th>Sinais Principais</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${(selected.top_leads || []).map((item) => `
                <tr>
                  <td>
                    <strong>${window.esc(item.nome_fantasia)}</strong>
                    <div class="muted" style="font-size:11px">${window.esc(item.segmento)} · ${window.esc(item.bairro || item.cidade || '')}</div>
                  </td>
                  <td>
                    <div class="mx-meters">
                      <span class="mx-pill caixa">Caixa ${item.matrix.caixa_score}</span>
                      <span class="mx-pill brecha">Brecha ${item.matrix.brecha_score}</span>
                    </div>
                  </td>
                  <td>
                    ${(item.stack_detectada || []).map((s) => `<span class="badge" style="margin-right:3px">${window.esc(s)}</span>`).join('') || '<span class="muted">—</span>'}
                    ${item.ttfb_ms != null ? `<div class="muted" style="font-size:11px">TTFB ${item.ttfb_ms}ms</div>` : ''}
                  </td>
                  <td>
                    <div class="muted" style="font-size:11px">${window.esc((item.matrix.sinais_brecha || []).slice(0, 3).join(' · ') || 'Sem brechas')}</div>
                  </td>
                  <td><span class="badge ${window.esc(item.status)}">${window.esc(item.status)}</span></td>
                  <td><button type="button" class="btn intel-open-lead-btn" data-id="${window.esc(item.id)}">Ficha</button></td>
                </tr>
              `).join('') || '<tr><td colspan="6" class="muted">Nenhum lead neste quadrante.</td></tr>'}
            </tbody>
          </table>
        </div>` : ''}`;
  }

  function renderSystemHealthFooter() {
    const h = intelState.systemHealth;
    if (!h) return '';
    const st = h.storage_stats || {};
    const snapKb = Math.round((st.snapshot_bytes || 0) / 1024);
    const walKb = Math.round(((st.wal_bytes || 0) / 1024) * 10) / 10;
    return `
      <div class="panel system-health-bar">
        <div class="telemetry-stats">
          <span>⚙️ <strong>Saúde do Motor & Escala:</strong></span>
          <span>Leads indexados: <strong>${h.leads_count}</strong> (O(1))</span>
          <span>RAM: <strong>${h.memory_rss_mb} MB</strong> / ${h.ram_budget_mb} MB (Heap ${h.memory_heap_mb} MB)</span>
          <span>WAL: <strong>${st.wal_ops || 0}/${st.compact_threshold || 50} ops</strong> (${walKb} KB)</span>
          <span>Snapshot: <strong>${snapKb} KB</strong></span>
        </div>
        <div class="actions" style="margin:0">
          <button type="button" class="btn" id="btnAuditCleanup">🧹 Auditar & Limpar Base</button>
          <button type="button" class="btn" id="btnCompactWal">🗜️ Compactar WAL</button>
          <button type="button" class="btn primary" id="btnDownloadBackup">💾 Baixar Backup JSON</button>
        </div>
      </div>
      ${renderCleanupPanelHtml()}`;
  }

  function renderCleanupPanelHtml() {
    const pv = intelState.cleanupPreview;
    const res = intelState.lastCleanupResult;
    if (!pv && !res) return '';

    const c = pv?.counts || {};
    return `
      <div class="panel cleanup-panel">
        <div class="agenda-header">
          <div>
            <h3 style="margin:0">🧹 Auditoria & Faxina Segura da Base</h3>
            <p class="muted" style="margin:4px 0 0">Um backup íntegro com timestamp em <code>data/backups/</code> é gravado automaticamente antes de qualquer remoção.</p>
          </div>
          <button type="button" class="btn" id="btnCloseCleanupPanel">Fechar</button>
        </div>

        ${res ? `
          <div class="dialer-cadence" style="margin-top:10px">
            <strong>✅ Limpeza (${window.esc(res.mode)}) concluída!</strong>
            Removidos: <strong>${res.removed_count}</strong> · Restantes: <strong>${res.after_count}</strong> · Backup: <code>${window.esc(res.backup_file)}</code>
          </div>` : ''}

        ${pv ? `
          <div class="grid" style="margin-top:12px">
            <div class="card"><h3>🛡️ Ativos / Histórico</h3><div class="n" style="color:var(--green)">${c.ativos_protegidos || 0}</div><div class="muted">Protegidos na cirúrgica</div></div>
            <div class="card"><h3>📞 Novos Acionáveis</h3><div class="n">${c.novos_acionaveis || 0}</div><div class="muted">Com tel/site/CNPJ</div></div>
            <div class="card"><h3>🧪 Legado / Corrompido</h3><div class="n" style="color:#fbbf24">${c.legado_sintetico_ou_corrompido || 0}</div><div class="muted">Removível na cirúrgica</div></div>
            <div class="card"><h3>👻 Fantasmas Sem Contato</h3><div class="n" style="color:var(--red)">${c.fantasmas_sem_contato || 0}</div><div class="muted">Sem tel, site ou CNPJ</div></div>
          </div>
          <p class="muted" style="margin-top:10px">
            Total atual: <strong>${pv.total}</strong> · Após Faxina Cirúrgica restarão <strong>${pv.restante_apos_cirurgica}</strong> leads (${pv.removiveis_cirurgica} removíveis).
          </p>
          <div class="actions" style="margin-top:10px">
            <button type="button" class="btn primary" id="btnExecCirurgica" ${pv.removiveis_cirurgica ? '' : 'disabled'}>
              ✨ Executar Faxina Cirúrgica (${pv.removiveis_cirurgica} removíveis · Com Backup Automático)
            </button>
            <button type="button" class="btn" id="btnExecResetTotal" style="border-color:var(--red);color:var(--red)">
              🗑️ Reset Total — Zerar Base (Com Backup Automático)
            </button>
          </div>` : ''}
      </div>`;
  }

  async function ensureSummaryLeadsLoaded() {
    if (Array.isArray(intelState.allLeads) && intelState.allLeads.length > 0) {
      return intelState.allLeads;
    }
    const res = await window.api('/api/leads?view=summary');
    intelState.allLeads = res.items || [];
    return intelState.allLeads;
  }

  function renderIntelligence(container) {
    let bodyHtml = '';
    if (intelState.subtab === 'lenses') bodyHtml = renderLensesTab();
    else if (intelState.subtab === 'calibration') bodyHtml = renderCalibrationTab();
    else if (intelState.subtab === 'matrix') bodyHtml = renderMatrixTab();
    else bodyHtml = renderTerritoryTab();

    container.innerHTML = renderTabsHeader() + bodyHtml + renderSystemHealthFooter();
    bindIntelligenceEvents(container);
  }

  function bindIntelligenceEvents(container) {
    document.querySelectorAll('.intel-subtab').forEach((btn) => {
      btn.addEventListener('click', async () => {
        intelState.subtab = btn.dataset.subtab;
        if (intelState.subtab === 'calibration' && !intelState.calibrationData) {
          intelState.calibrationData = await window.api('/api/intelligence/calibration');
        }
        if (intelState.subtab === 'territory') {
          const modeId = window.getActiveScoringMode?.() || 'equilibrado';
          const [, terRes] = await Promise.all([
            ensureSummaryLeadsLoaded(),
            window.api(`/api/intelligence/territory?mode=${encodeURIComponent(modeId)}`),
          ]);
          intelState.territoryData = terRes;
        }
        if (intelState.subtab === 'matrix' && !intelState.matrixData) {
          intelState.matrixData = await window.api('/api/intelligence/matrix');
        }
        renderIntelligence(container);
      });
    });

    // Sub-aba Lentes
    document.getElementById('btnNewLens')?.addEventListener('click', () => {
      intelState.editingLens = emptyLensDraft();
      renderIntelligence(container);
    });

    document.getElementById('btnCancelEditLens')?.addEventListener('click', () => {
      intelState.editingLens = null;
      renderIntelligence(container);
    });

    document.querySelectorAll('.btn-activate-lens').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.setActiveScoringMode(btn.dataset.id);
        intelState.calibrationData = null;
        window.toast?.(`Lente ativa: ${window.getActiveModeLabel()}`);
        renderIntelligence(container);
      });
    });

    document.querySelectorAll('.btn-dup-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const presetId = btn.dataset.preset;
        const draft = emptyLensDraft(presetId);
        draft.nome = `Cópia de ${presetId}`;
        intelState.editingLens = draft;
        renderIntelligence(container);
      });
    });

    document.querySelectorAll('.btn-edit-lens').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lens = window.CUSTOM_LENSES.find((l) => l.id === btn.dataset.id);
        if (!lens) return;
        intelState.editingLens = JSON.parse(JSON.stringify(lens));
        renderIntelligence(container);
      });
    });

    document.querySelectorAll('.btn-dup-lens').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lens = window.CUSTOM_LENSES.find((l) => l.id === btn.dataset.id);
        if (!lens) return;
        const copy = JSON.parse(JSON.stringify(lens));
        copy.id = null;
        copy.nome = `${lens.nome} (Cópia)`;
        intelState.editingLens = copy;
        renderIntelligence(container);
      });
    });

    document.querySelectorAll('.lens-weight-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const valEl = document.getElementById(`wval_${inp.dataset.key}`);
        if (valEl) {
          const n = Number(inp.value);
          valEl.textContent = `${n > 0 ? '+' : ''}${n}`;
        }
      });
    });

    document.querySelectorAll('.intel-open-lead-btn').forEach((btn) => {
      btn.addEventListener('click', () => window.openLead?.(btn.dataset.id));
    });

    document.querySelectorAll('.btn-del-lens').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await window.RuntimeAdapter?.confirmDialog({
          title: 'Excluir Lente',
          message: 'Deseja excluir esta lente customizada?',
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
        try {
          await window.api(`/api/lenses/${btn.dataset.id}`, { method: 'DELETE' });
          await window.loadCustomLenses();
          intelState.calibrationData = null;
          if (window.getActiveScoringMode() === btn.dataset.id) {
            window.setActiveScoringMode('equilibrado');
          }
          window.toast?.('Lente excluída');
          renderIntelligence(container);
        } catch (err) {
          window.toast?.('Erro: ' + err.message);
        }
      });
    });

    document.getElementById('lensEditorForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pesos = {};
      document.querySelectorAll('.lens-weight-input').forEach((inp) => {
        pesos[inp.dataset.key] = Number(inp.value);
      });
      const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
      const payload = {
        nome: document.getElementById('lensNome').value.trim(),
        descricao: document.getElementById('lensDesc').value.trim(),
        oferta_contexto: document.getElementById('lensOffer').value.trim() || null,
        pesos,
        filtros: {
          exigir_whatsapp: document.getElementById('lensReqWa').checked,
          segmentos_boost: splitList(document.getElementById('lensSegBoost').value),
          bairros_boost: splitList(document.getElementById('lensBairroBoost').value),
        },
      };

      try {
        const editId = intelState.editingLens?.id;
        const res = editId
          ? await window.api(`/api/lenses/${editId}`, { method: 'PUT', body: JSON.stringify(payload) })
          : await window.api('/api/lenses', { method: 'POST', body: JSON.stringify(payload) });
        await window.loadCustomLenses();
        window.setActiveScoringMode(res.item.id);
        intelState.editingLens = null;
        intelState.calibrationData = null;
        window.toast?.(`Lente "${res.item.nome}" salva e ativada!`);
        renderIntelligence(container);
      } catch (err) {
        window.toast?.('Erro ao salvar lente: ' + err.message);
      }
    });

    // Sub-aba Auto-Calibragem
    document.getElementById('btnSaveCalibratedLens')?.addEventListener('click', async () => {
      const prop = intelState.calibrationData?.proposta_lente;
      if (!prop) return;
      try {
        const existing = window.CUSTOM_LENSES.find((l) => l.nome === prop.nome || l.origem_calibracao);
        const res = existing
          ? await window.api(`/api/lenses/${existing.id}`, { method: 'PUT', body: JSON.stringify(prop) })
          : await window.api('/api/lenses', { method: 'POST', body: JSON.stringify(prop) });
        await window.loadCustomLenses();
        window.setActiveScoringMode(res.item.id);
        intelState.calibrationData = null;
        window.toast?.('Lente Auto-Calibrada salva e ativada!');
        renderIntelligence(container);
      } catch (err) {
        window.toast?.('Erro ao salvar lente calibrada: ' + err.message);
      }
    });

    // Sub-aba Território & Lookalike
    document.querySelectorAll('.btn-hunt-cluster').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.idx);
        const bol = intelState.territoryData?.bolsoes?.[idx];
        if (!bol || !bol.lead_ids_prontos?.length) return;
        await ensureSummaryLeadsLoaded();
        const byId = new Map(intelState.allLeads.map((l) => [l.id, l]));
        const queueLeads = bol.lead_ids_prontos.map((id) => byId.get(id)).filter(Boolean);
        const activeLens = window.getActiveLensOrMode?.();
        const offerContext = typeof activeLens === 'object' ? activeLens.oferta_contexto : null;
        const socialProof = bol.tem_cliente_local
          ? { ativo: true, bairro: bol.bairro, cidade: bol.cidade, segmento: bol.segmento }
          : null;

        document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === 'dialer'));
        window.openPowerDialerWithQueue?.(queueLeads, {
          mode: 'prospeccao',
          label: `Bolsão: ${bol.bairro} · ${bol.segmento}`,
          socialProof,
          offerContext,
        });
      });
    });

    document.getElementById('btnRunLookalike')?.addEventListener('click', async () => {
      const refId = document.getElementById('lookalikeRefSelect')?.value;
      if (!refId) return window.toast?.('Selecione um lead referência primeiro');
      intelState.selectedRefId = refId;
      const modeId = window.getActiveScoringMode?.() || 'equilibrado';
      try {
        intelState.lookalikeData = await window.api(`/api/leads/${refId}/lookalike?limit=25&mode=${encodeURIComponent(modeId)}`);
        renderIntelligence(container);
      } catch (err) {
        window.toast?.('Erro no Lookalike: ' + err.message);
      }
    });

    document.getElementById('btnDispatchLookalike')?.addEventListener('click', () => {
      const ref = intelState.lookalikeData?.reference;
      const items = intelState.lookalikeData?.items || [];
      if (!items.length) return;
      const activeLens = window.getActiveLensOrMode?.();
      const offerContext = typeof activeLens === 'object' ? activeLens.oferta_contexto : null;
      const socialProof = {
        ativo: true,
        bairro: ref?.bairro || '',
        cidade: ref?.cidade || 'Governador Valadares',
        segmento: ref?.segmento || 'OUTRO',
      };
      document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === 'dialer'));
      window.openPowerDialerWithQueue?.(items.map((x) => x.lead), {
        mode: 'prospeccao',
        label: `Lookalike: ${ref?.segmento || ''} · ${ref?.bairro || ref?.cidade || ''}`,
        socialProof,
        offerContext,
      });
    });

    // Sub-aba Matriz Dinheiro x Brecha
    document.getElementById('matrixIncludeFixo')?.addEventListener('change', (e) => {
      intelState.includeLandline = e.target.checked;
      localStorage.setItem(LANDLINE_STORAGE_KEY, e.target.checked ? '1' : '0');
      renderIntelligence(container);
    });

    document.querySelectorAll('.matrix-quad').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        intelState.selectedQuadrant = card.dataset.quad;
        renderIntelligence(container);
      });
    });

    document.querySelectorAll('.btn-hunt-quad').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.quad;
        const q = intelState.matrixData?.quadrantes?.[key];
        const targetIds = intelState.includeLandline
          ? (q?.lead_ids_prontos_com_fixo || q?.lead_ids || [])
          : (q?.lead_ids_prontos_celular || []);
        if (!q || !targetIds.length) return;
        await ensureSummaryLeadsLoaded();
        const byId = new Map(intelState.allLeads.map((l) => [l.id, l]));
        const queueLeads = targetIds.map((id) => byId.get(id)).filter(Boolean);
        const activeLens = window.getActiveLensOrMode?.();
        const offerContext = typeof activeLens === 'object' ? activeLens.oferta_contexto : null;
        document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === 'dialer'));
        window.openPowerDialerWithQueue?.(queueLeads, {
          mode: 'prospeccao',
          label: `Matriz: ${q.label}`,
          offerContext,
          includeLandline: intelState.includeLandline,
        });
      });
    });

    // Saúde do Motor & WAL + Faxina Segura
    document.getElementById('btnAuditCleanup')?.addEventListener('click', async () => {
      try {
        intelState.cleanupPreview = await window.api('/api/system/cleanup/preview');
        intelState.lastCleanupResult = null;
        renderIntelligence(container);
      } catch (err) {
        window.toast?.('Erro ao auditar base: ' + err.message);
      }
    });

    document.getElementById('btnCloseCleanupPanel')?.addEventListener('click', () => {
      intelState.cleanupPreview = null;
      intelState.lastCleanupResult = null;
      renderIntelligence(container);
    });

    document.getElementById('btnExecCirurgica')?.addEventListener('click', async () => {
      const rem = intelState.cleanupPreview?.removiveis_cirurgica || 0;
      const ok = await window.RuntimeAdapter?.confirmDialog({
        title: 'Confirmar Faxina Cirúrgica',
        message: `Serão removidos ${rem} registros legados/fantasmas após backup automático em data/backups/.`,
        confirmLabel: 'Executar Faxina',
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await window.api('/api/system/cleanup/execute', {
          method: 'POST',
          body: JSON.stringify({ mode: 'cirurgica', confirm: true }),
        });
        intelState.lastCleanupResult = res;
        intelState.cleanupPreview = await window.api('/api/system/cleanup/preview');
        await window.refreshMeta?.();
        window.toast?.(`Faxina concluída! Backup salvo em ${res.backup_file}`);
        window.refreshAgendaBadge?.();
        await window.renderIntelligenceCockpit(container);
      } catch (err) {
        window.toast?.('Erro na faxina: ' + err.message);
      }
    });

    document.getElementById('btnExecResetTotal')?.addEventListener('click', async () => {
      const typed = await window.RuntimeAdapter?.promptDialog({
        title: 'ATENÇÃO — Reset Total da Base',
        message: 'Isso vai zerar todos os leads após gravar backup automático em data/backups/.\nDigite ZERAR para confirmar:',
        placeholder: 'ZERAR',
        confirmLabel: 'Zerar Base',
      });
      if (typed !== 'ZERAR') return window.toast?.('Reset cancelado.');
      try {
        const res = await window.api('/api/system/cleanup/execute', {
          method: 'POST',
          body: JSON.stringify({ mode: 'reset_total', confirm: true }),
        });
        intelState.lastCleanupResult = res;
        intelState.cleanupPreview = await window.api('/api/system/cleanup/preview');
        await window.refreshMeta?.();
        window.toast?.(`Base zerada com backup em ${res.backup_file}`);
        window.refreshAgendaBadge?.();
        await window.renderIntelligenceCockpit(container);
      } catch (err) {
        window.toast?.('Erro no reset: ' + err.message);
      }
    });

    document.getElementById('btnCompactWal')?.addEventListener('click', async () => {
      try {
        await window.api('/api/system/compact', { method: 'POST', body: JSON.stringify({}) });
        intelState.systemHealth = await window.api('/api/system/health-deep');
        window.toast?.('WAL compactado com sucesso para leads.json!');
        renderIntelligence(container);
      } catch (err) {
        window.toast?.('Erro ao compactar WAL: ' + err.message);
      }
    });

    document.getElementById('btnDownloadBackup')?.addEventListener('click', () => {
      (window.AppPorts?.outputActions?.exportBackup?.() || Promise.resolve())
        .catch((err) => window.toast?.('Erro ao baixar backup: ' + err.message));
    });
  }

  window.openIntelligenceTab = async function openIntelligenceTab(subtab = 'matrix') {
    intelState.subtab = subtab;
    document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === 'intelligence'));
    if (typeof window.show === 'function') await window.show('intelligence');
  };

  window.openLookalikeForLead = async function openLookalikeForLead(leadId) {
    document.getElementById('modal')?.classList.add('hidden');
    intelState.subtab = 'territory';
    intelState.selectedRefId = leadId;
    const modeId = window.getActiveScoringMode?.() || 'equilibrado';
    document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.view === 'intelligence'));
    try {
      intelState.lookalikeData = await window.api(`/api/leads/${leadId}/lookalike?limit=25&mode=${encodeURIComponent(modeId)}`);
    } catch {
      intelState.lookalikeData = null;
    }
    if (typeof window.show === 'function') await window.show('intelligence');
  };

  window.renderIntelligenceCockpit = async function renderIntelligenceCockpit(container) {
    await window.loadCustomLenses();
    const modeId = window.getActiveScoringMode?.() || 'equilibrado';
    intelState.allLeads = [];
    const [leadsRes, calRes, terRes, matRes, healthRes] = await Promise.all([
      intelState.subtab === 'territory' ? window.api('/api/leads?view=summary') : Promise.resolve({ items: [] }),
      window.api('/api/intelligence/calibration'),
      window.api(`/api/intelligence/territory?mode=${encodeURIComponent(modeId)}`),
      window.api('/api/intelligence/matrix'),
      window.api('/api/system/health-deep'),
    ]);
    intelState.allLeads = leadsRes.items || [];
    intelState.calibrationData = calRes;
    intelState.territoryData = terRes;
    intelState.matrixData = matRes;
    intelState.systemHealth = healthRes;
    renderIntelligence(container);
  };
})();
