const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let META = { segmentos: [], status: [], potencial: [] };
let LEAD_PAGE = 1;
const LEAD_PAGE_SIZE = 50;
let pendingImportRows = [];
let pendingImportPreview = [];
let OPEN_LEAD = null;
let ACTIVE_OPERATOR = window.RuntimeAdapter?.getStorage('autonomia_operator') || 'Rafael Oliveira';
let MOBILE_PIPELINE_STAGE = '';

function getOperatorsMap() {
  const list = window.AppPorts?.config?.get?.()?.tenant?.operators || [
    { name: 'Rafael Oliveira', role: 'Especialista em Sistemas & Automação Inteligente', badge: 'Especialista em Sistemas' },
    { name: 'Sara Rosseto', role: 'Consultora de Inteligência Operacional & IA', badge: 'Consultora de IA & Processos' },
  ];
  const map = {};
  for (const op of list) {
    map[op.name] = { nome: op.name, cargo: op.role || '', badge: op.badge || 'Operador' };
  }
  return map;
}

function setOperator(nome) {
  const operators = getOperatorsMap();
  const names = Object.keys(operators);
  if (!operators[nome]) nome = names[0] || 'Rafael Oliveira';
  ACTIVE_OPERATOR = nome;
  window.RuntimeAdapter?.setStorage('autonomia_operator', nome);
  const badgeEl = $('#profileBadge');
  if (badgeEl) badgeEl.textContent = operators[nome]?.badge || '';
  const dispEl = $('#activeOperatorDisplay');
  if (dispEl) dispEl.innerHTML = `Operando: <strong>${esc(nome)}</strong>`;
  const selEl = $('#operatorProfile');
  if (selEl && selEl.value !== nome) selEl.value = nome;
  if (OPEN_LEAD) updateMessageTemplate();
}

function updateSyncQueueBadge(state = null) {
  const badge = $('#syncQueueBadge');
  if (!badge) return;
  const apply = (st) => {
    const pending = Number(st?.pending || 0);
    const syncing = Boolean(st?.syncing);
    if (!pending && !syncing) {
      badge.classList.add('hidden');
      badge.classList.remove('syncing');
      badge.textContent = '';
      return;
    }
    badge.classList.remove('hidden');
    badge.classList.toggle('syncing', syncing);
    badge.textContent = syncing
      ? `🔄 Sincronizando ${pending}...`
      : `⏳ ${pending} pendente(s)`;
  };
  if (state) {
    apply(state);
  } else {
    window.SyncQueue?.getStatus?.().then(apply).catch(() => {});
  }
}

function updateOperationalStatusBar() {
  const pill = $('#networkStatusPill');
  if (pill) {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    pill.textContent = isOnline ? '🟢 Online' : '🟠 Offline · Modo Local';
    pill.classList.toggle('online', isOnline);
    pill.classList.toggle('offline', !isOnline);
  }
  const ephemBadge = $('#ephemeralStorageBadge');
  if (ephemBadge) {
    const storageMode = window.AppPorts?.config?.get?.()?.storage_mode || 'persistent';
    ephemBadge.classList.toggle('hidden', storageMode !== 'ephemeral');
  }
  updateSyncQueueBadge();
}

async function api(path, opts = {}) {
  if (window.RuntimeAdapter?.http) {
    return window.RuntimeAdapter.http(path, opts);
  }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

window.downloadAuthenticatedFile = async function downloadAuthenticatedFile(url, fallbackFilename = 'download.bin') {
  return window.RuntimeAdapter?.downloadAuthenticated(url, fallbackFilename);
};

window.refreshMeta = async function refreshMeta() {
  META = await api('/api/meta');
  window.META = META;
  return META;
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText =
    'position:fixed;bottom:20px;right:20px;background:linear-gradient(135deg, #0284c7, #00d2ff);color:#051020;padding:12px 18px;border-radius:10px;font-weight:800;box-shadow:0 6px 20px rgba(0,210,255,0.3);z-index:99';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}
window.toast = toast;

let APP_INITIALIZED = false;

async function init(configOverrides = null) {
  await window.AppPorts?.config?.init(configOverrides);
  META = await api('/api/meta');
  window.META = META;
  if (!Array.isArray(META.segmentos) || !Array.isArray(META.status)) throw new Error('Configuração inválida recebida do servidor');
  await window.loadCustomLenses?.();

  const opSelect = $('#operatorProfile');
  if (opSelect) {
    const operators = getOperatorsMap();
    if (operators[ACTIVE_OPERATOR]) opSelect.value = ACTIVE_OPERATOR;
    if (!APP_INITIALIZED) {
      opSelect.addEventListener('change', (e) => {
        setOperator(e.target.value);
        toast(`Perfil ativo alterado para ${e.target.value}`);
      });
    }
  }
  setOperator(ACTIVE_OPERATOR);
  updateOperationalStatusBar();

  if (!APP_INITIALIZED) {
    APP_INITIALIZED = true;
    window.addEventListener('online', updateOperationalStatusBar);
    window.addEventListener('offline', updateOperationalStatusBar);

    window.SyncQueue?.setOnStatusChange?.((st) => {
      updateSyncQueueBadge(st);
      if (st?.synced > 0 && !st?.syncing) {
        window.refreshMeta?.().catch(() => {});
        window.refreshAgendaBadge?.();
        toast(`${st.synced} alteração(ões) sincronizada(s) com o servidor!`);
      }
    });

    $('#syncQueueBadge')?.addEventListener('click', async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return toast('Sem internet: aguardando conexão para sincronizar a fila local.');
      }
      const res = await window.SyncQueue?.flush?.({ force: true });
      if (res && !res.synced && res.pending > 0 && res.halted) {
        toast('Falha temporária ao sincronizar. Nova tentativa automática agendada.');
      }
    });

    $('#uiModeToggle')?.addEventListener('click', () => {
      const current = window.AppPorts?.config?.get?.()?.ui_mode || 'avancado';
      const next = current === 'simplificado' ? 'avancado' : 'simplificado';
      window.CacaLeadsVertical.setUiMode(next);
      toast(next === 'simplificado' ? 'Modo Operacional ativado (4 abas)' : 'Modo Estratégico ativado');
    });

    $$('.nav').forEach((b) =>
      b.addEventListener('click', () => {
        window.CacaLeadsVertical.navigate(b.dataset.view);
      })
    );
    let searchTimer;
    $('#search').addEventListener('input', () => {
      LEAD_PAGE = 1;
      clearTimeout(searchTimer);
      if ($('.nav.active')?.dataset.view === 'leads') searchTimer = setTimeout(() => show('leads'), 220);
    });
    $('#importCsvButton').addEventListener('click', () => $('#importCsvFile').click());
    $('#importCsvFile').addEventListener('change', importCsvFile);
    $('#exportCsvButton')?.addEventListener('click', () => {
      (window.AppPorts?.outputActions?.exportCsv?.() || Promise.resolve()).catch((err) => toast(err.message));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('#modal').classList.contains('hidden')) $('#modal').classList.add('hidden');
    });
  }

  const initialView = configOverrides?.initialView || 'dashboard';
  const visible = window.AppPorts?.config?.getVisibleViews?.() || ['dashboard'];
  const startView = visible.includes(initialView) ? initialView : visible[0] || 'leads';
  await window.CacaLeadsVertical.navigate(startView);
  window.refreshAgendaBadge?.();
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    window.SyncQueue?.flush?.().catch(() => {});
  }
}

window.CacaLeadsVertical = {
  contract_version: '1.0',
  ports: window.AppPorts,
  async mount(_container, configOverrides = {}, adapters = {}) {
    if (adapters?.outputActions) {
      window.AppPorts?.outputActions?.configure?.(adapters.outputActions);
    }
    if (adapters?.runtimeAdapter && window.RuntimeAdapter) {
      Object.assign(window.RuntimeAdapter, adapters.runtimeAdapter);
    }
    await init(configOverrides);
    return this;
  },
  setUiMode(mode) {
    const next = window.AppPorts?.config?.setUiMode?.(mode) || mode;
    const visible = window.AppPorts?.config?.getVisibleViews?.(next) || [];
    const activeView = $('.nav.active')?.dataset?.view;
    if (activeView && !visible.includes(activeView)) {
      this.navigate(visible[0] || 'leads');
    }
    return next;
  },
  async navigate(view) {
    $$('.nav').forEach((x) => x.classList.toggle('active', x.dataset.view === view));
    return show(view);
  },
};

function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const delimiter = (source.split(/\r?\n/, 1)[0].match(/;/g) || []).length > (source.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' && quoted && source[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV inválido: aspas sem fechamento');
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const key = (v) => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const headers = rows.shift().map(key);
  const aliases = { nome_fantasia: ['nomefantasia', 'nome', 'estabelecimento'], razao_social: ['razaosocial'], cnpj: ['cnpj'], segmento: ['segmento'], telefone: ['telefone', 'phone'], whatsapp: ['whatsapp'], whatsapp_status: ['whatsappstatus', 'estadodowhatsapp', 'verificacaowhatsapp'], verificado_em: ['verificadoem', 'ultimaverificacao'], email: ['email'], website: ['website', 'site'], endereco: ['endereco', 'address'], bairro: ['bairro'], cidade: ['cidade', 'city'], uf: ['uf', 'estado'], cep: ['cep'], fonte: ['fonte', 'source'], fonte_url: ['fonteurl', 'sourceurl'], fonte_tipo: ['fontetipo', 'tipodafonte'], potencial: ['potencial'], status: ['status'], observacoes: ['observacoes', 'notes'] };
  const columns = Object.entries(aliases).map(([field, names]) => [field, headers.findIndex((h) => names.includes(h))]).filter(([, i]) => i >= 0);
  const nameIndex = columns.find(([field]) => field === 'nome_fantasia');
  if (!nameIndex) throw new Error('CSV precisa ter uma coluna Nome fantasia ou Nome');
  return rows.map((cells) => Object.fromEntries(columns.map(([field, i]) => [field, cells[i] || '']))).filter((x) => x.nome_fantasia.trim());
}

async function importCsvFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) return toast('Arquivo CSV limitado a 4 MB');
  try {
    const rows = parseCsv(await file.text());
    if (!rows.length) return toast('Nenhum registro válido encontrado no CSV');
    if (rows.length > 5000) return toast('Importação limitada a 5.000 leads por arquivo');
    pendingImportRows = rows;
    pendingImportPreview = [];
    const batches = splitBatches(rows);
    let offset = 0;
    for (const items of batches) {
      const result = await api('/api/import/preview', { method: 'POST', body: JSON.stringify({ items }) });
      pendingImportPreview.push(...result.items.map((x) => ({ ...x, index: x.index + offset })));
      offset += items.length;
    }
    renderImportPreview();
  } catch (error) { toast(error.message); }
}

function splitBatches(rows) {
  const batches = []; let batch = [];
  for (const row of rows) {
    const candidate = [...batch, row];
    if (batch.length && (candidate.length > 500 || new TextEncoder().encode(JSON.stringify({ items: candidate })).length > 700 * 1024)) { batches.push(batch); batch = [row]; }
    else batch = candidate;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function renderImportPreview() {
  const modal = $('#modal');
  const fresh = pendingImportPreview.filter((x) => x.state === 'new').length;
  const duplicates = pendingImportPreview.filter((x) => x.state === 'duplicate').length;
  const invalid = pendingImportPreview.filter((x) => x.state === 'invalid').length;
  modal.classList.remove('hidden'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `<div class="modal-box" style="max-width:1100px" aria-labelledby="importTitle">
    <div class="actions" style="justify-content:space-between"><h2 id="importTitle">Revisar importação</h2><button type="button" class="btn" id="btnCloseImportPreview">Cancelar</button></div>
    <p class="muted">${pendingImportRows.length} linhas · ${fresh} novas · ${duplicates} possíveis duplicatas · ${invalid} inválidas. Duplicatas começam desmarcadas; marque uma delas apenas se realmente for outra unidade/empresa.</p>
    <div class="actions"><button type="button" class="btn" id="btnSelectNewImport">Selecionar novas</button><button type="button" class="btn" id="btnUnselectAllImport">Desmarcar tudo</button></div>
    <div class="tablewrap" style="max-height:60vh;overflow:auto;margin-top:10px"><table style="min-width:760px"><thead><tr><th>Importar</th><th>Nome</th><th>Cidade / segmento</th><th>WhatsApp</th><th>Resultado da conferência</th></tr></thead><tbody>
      ${pendingImportPreview.map((x) => `<tr><td><input class="import-check" type="checkbox" data-index="${x.index}" ${x.state === 'new' ? 'checked' : ''} ${x.state === 'invalid' ? 'disabled' : ''}></td><td>${esc(x.item?.nome_fantasia || '—')}</td><td>${esc(x.item?.cidade || '')} · ${esc(x.item?.segmento || '')}</td><td>${esc(x.item?.whatsapp || '—')}</td><td><span class="badge ${x.state === 'new' ? 'QUALIFICADO' : x.state === 'duplicate' ? 'VISITA' : 'DESCARTADO'}">${x.state === 'new' ? 'Novo' : x.state === 'duplicate' ? 'Possível duplicata' : 'Inválido'}</span>${x.matches?.length ? `<br><span class="muted">${x.matches.map((m) => `${esc(m.nome_fantasia)} · ${esc(m.cidade || '')}`).join('<br>')}</span>` : `<span class="muted">${esc(x.reason || '')}</span>`}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="actions"><button type="button" class="btn primary" id="btnCommitImport">Importar selecionados</button><span class="muted">Nada será importado até você confirmar.</span></div>
  </div>`;
  $('#btnCloseImportPreview')?.addEventListener('click', closeImportPreview);
  $('#btnSelectNewImport')?.addEventListener('click', () => toggleImportRows(true));
  $('#btnUnselectAllImport')?.addEventListener('click', () => toggleImportRows(false));
  $('#btnCommitImport')?.addEventListener('click', commitImportPreview);
}

function toggleImportRows(checked) { $$('.import-check').forEach((x) => { if (!x.disabled) x.checked = checked && pendingImportPreview.find((p) => p.index === Number(x.dataset.index))?.state === 'new'; }); }
function closeImportPreview() { $('#modal').classList.add('hidden'); pendingImportRows = []; pendingImportPreview = []; }

async function commitImportPreview() {
  const selected = new Set($$('.import-check:checked').map((x) => Number(x.dataset.index)));
  if (!selected.size) return toast('Selecione pelo menos um lead');
  const allowDuplicates = pendingImportPreview.some((x) => selected.has(x.index) && x.state === 'duplicate');
  let added = 0, total = 0, offset = 0;
  try {
    for (const items of splitBatches(pendingImportRows)) {
      const include = [...selected].filter((i) => i >= offset && i < offset + items.length).map((i) => i - offset);
      const result = await api('/api/import', { method: 'POST', body: JSON.stringify({ items, include_indices: include, allow_duplicates: allowDuplicates, batch_prefix: 'CSV' }) });
      added += result.added; total = result.total; offset += items.length;
    }
    closeImportPreview();
    await window.refreshMeta?.();
    toast(`${added} leads importados · ${total} na base`);
    $$('.nav').forEach((x) => x.classList.toggle('active', x.dataset.view === 'leads'));
    show('leads');
  } catch (error) { toast(error.message); }
}

async function show(view) {
  const titles = {
    dashboard: ['Painel', 'Funil de conversão & diagnóstico — AutonomIA Systems'],
    leads: ['Leads', 'Qualificar, diagnosticar e apresentar sistemas inteligentes'],
    dialer: ['📞 Power Dialer (Fila Focada)', 'Prospecção 1-a-1 em alta cadência com copy dinâmica e micro-cadência'],
    intelligence: ['🧠 Inteligência & Território', 'Lentes editáveis, auto-calibragem empírica, bolsões Oceano Azul e Lookalike'],
    motor: ['⚡ Motor Google Maps (Fonte Única)', 'Captura completa de 1 segmento por vez com rolagem até o final da lista'],
    pipeline: ['Pipeline', 'Kanban do ciclo de consultoria e implantação'],
    agenda: ['📅 Agenda do Dia', 'Cadência adaptativa, temperatura dos leads e Radar de Conversão'],
    templates: ['💬 Modelos de Mensagens & Scripts', 'Personalize e salve os scripts de abordagem dos operadores'],
    novo: ['Novo lead', 'Cadastro de empresas e mapeamento operacional'],
    pesquisa: ['Pesquisa & fontes', 'Fontes de inteligência de mercado — AutonomIA Systems'],
  };
  $('#title').textContent = titles[view]?.[0] || view;
  $('#subtitle').textContent = titles[view]?.[1] || '';
  const v = $('#view');
  v.setAttribute('aria-live', 'polite');
  v.innerHTML = '<div class="panel loading" role="status">Carregando…</div>';
  try {
    if (view === 'dashboard') return await dashboard(v);
    if (view === 'leads') return await leads(v);
    if (view === 'dialer') return await window.renderPowerDialerView(v);
    if (view === 'intelligence') return await window.renderIntelligenceCockpit(v);
    if (view === 'motor') return await motorView(v);
    if (view === 'pipeline') return await pipeline(v);
    if (view === 'agenda') return await agenda(v);
    if (view === 'templates') return templatesView(v);
    if (view === 'novo') return novo(v);
    if (view === 'pesquisa') return pesquisa(v);
  } catch (error) {
    v.innerHTML = `<div class="panel error-state" role="alert"><h2>Não foi possível carregar esta tela</h2><p>${esc(error.message)}</p><button type="button" class="btn primary" id="btnRetryView">Tentar novamente</button></div>`;
    $('#btnRetryView')?.addEventListener('click', () => show(view));
  }
}

async function dashboard(v) {
  const s = await api('/api/stats');
  v.innerHTML = `
    <div class="grid">
      <div class="card"><h3>Total de leads</h3><div class="n">${s.total}</div></div>
      ${(s.byStatus || []).map((x) => `<div class="card"><h3>${esc(x.status)}</h3><div class="n">${x.n}</div></div>`).join('')}
    </div>
    <div class="panel" style="margin-top:14px">
      <h3 style="margin-top:0">Leads por cidade — região mapeada</h3>
      <div class="grid">
        ${(s.byCidade || []).map((x) => `<div class="card"><h3>${esc(x.cidade)}</h3><div class="n">${x.n}</div></div>`).join('') || '<p class="muted">Só GV por enquanto.</p>'}
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3 style="margin-top:0">Por segmento</h3>
      <div class="grid">
        ${(s.bySeg || []).map((x) => `<div class="card"><h3>${esc(x.segmento)}</h3><div class="n">${x.n}</div></div>`).join('') || '<p class="muted">Nenhum lead ainda.</p>'}
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3 style="margin-top:0">Funil de conversão</h3>
      <div class="grid">
        ${(s.pipeline?.stages || []).map((x) => `<div class="card"><h3>${esc(x.status)}</h3><div class="n">${x.n}</div></div>`).join('')}
      </div>
      <p style="margin-top:12px;color:var(--muted)">Clientes: <strong>${s.pipeline?.clientes || 0}</strong> · Taxa conversão: <strong>${s.pipeline?.taxa_conversao || 0}%</strong> · Com telefone: <strong>${s.pipeline?.com_telefone || 0}</strong> · Follow-ups: <strong>${s.pipeline?.follow_ups_agendados || 0}</strong></p>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">Playbook de Conversão — AutonomIA Systems (B2B)</h3>
      <ol style="color:var(--muted);line-height:1.7">
        <li><strong>Captura Maps</strong> — execute uma missão no Motor Google Maps para minerar 100% do segmento na cidade-alvo.</li>
        <li><strong>Raio-X & Matriz OURO</strong> — identifique brechas técnicas (sem site, sem WhatsApp, sem Pixel/GTM) e priorize o quadrante 💎 OURO.</li>
        <li><strong>Power Dialer</strong> — dispare abordagens consultivas personalizadas 1-a-1 e registre o sinal do cliente no ato.</li>
        <li><strong>Agenda & Cadência</strong> — execute os retornos no prazo ideal guiado pela temperatura e pelo Valor em Risco.</li>
        <li><strong>Conversão</strong> — apresente o diagnóstico e clique em "✅ Tornar cliente" após o fechamento do projeto.</li>
      </ol>
    </div>`;
}

let LAST_LOADED_LEADS = [];
let LEAD_FILTERS = { status: '', segmento: '', cidade: '', whatsapp: '', verificacao: '', fonte: '', origem: '', dor: '', lote: '', sort: 'score' };

function syncLeadFiltersFromDom() {
  if ($('#fStatus')) LEAD_FILTERS.status = $('#fStatus').value;
  if ($('#fSeg')) LEAD_FILTERS.segmento = $('#fSeg').value;
  if ($('#fCidade')) LEAD_FILTERS.cidade = $('#fCidade').value;
  if ($('#fWhatsapp')) LEAD_FILTERS.whatsapp = $('#fWhatsapp').value;
  if ($('#fVerificacao')) LEAD_FILTERS.verificacao = $('#fVerificacao').value;
  if ($('#fFonte')) LEAD_FILTERS.fonte = $('#fFonte').value;
  if ($('#fOrigem')) LEAD_FILTERS.origem = $('#fOrigem').value;
  if ($('#fDor')) LEAD_FILTERS.dor = $('#fDor').value;
  if ($('#fLote')) LEAD_FILTERS.lote = $('#fLote').value;
  if ($('#fSort')) LEAD_FILTERS.sort = $('#fSort').value;
}

async function leads(v) {
  const q = $('#search')?.value || '';
  const { status, segmento, cidade, whatsapp, verificacao, fonte, origem, dor, lote, sort } = LEAD_FILTERS;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (segmento) params.set('segmento', segmento);
  if (cidade) params.set('cidade', cidade);
  if (whatsapp) params.set('whatsapp', whatsapp);
  if (verificacao) params.set('verificacao', verificacao);
  if (fonte) params.set('fonte', fonte);
  if (origem) params.set('origem', origem);
  if (lote) params.set('lote', lote);
  if (sort) params.set('sort', sort);
  params.set('view', 'summary');
  const data = await api('/api/leads?' + params.toString());
  LAST_LOADED_LEADS = data.items || [];
  renderLeadsView(v, { ...LEAD_FILTERS });
}

function renderLeadsView(v, filterState) {
  const { status, segmento, cidade, whatsapp, verificacao, fonte, origem, dor, lote, sort } = filterState;
  const activeLensOrMode = window.getActiveLensOrMode?.() || window.getActiveScoringMode?.() || 'equilibrado';
  const evalMap = new Map();

  let evaluated = LAST_LOADED_LEADS.map((lead) => {
    const ev = window.ScoringModes?.evaluateLead(lead, activeLensOrMode) || {
      score: lead.score || 50,
      potencial: lead.potencial || 'MEDIO',
      motivo_destaque: '',
      etiquetas_dor: lead.etiquetas_dor || [],
      breakdown: [],
    };
    evalMap.set(lead.id, ev);
    return { lead, ev };
  });

  if (dor) {
    evaluated = evaluated.filter(({ ev }) => Array.isArray(ev.etiquetas_dor) && ev.etiquetas_dor.includes(dor));
  }

  if (sort === 'score') {
    evaluated.sort((a, b) => b.ev.score - a.ev.score);
  }

  const total = evaluated.length;
  const pageCount = Math.max(1, Math.ceil(total / LEAD_PAGE_SIZE));
  LEAD_PAGE = Math.min(LEAD_PAGE, pageCount);
  const pageEntries = evaluated.slice((LEAD_PAGE - 1) * LEAD_PAGE_SIZE, LEAD_PAGE * LEAD_PAGE_SIZE);
  const visibleIds = pageEntries.map((e) => e.lead.id);

  const standardDores = [
    'Sem Site',
    'Site Fora do Ar',
    'Só Link na Bio',
    'E-commerce sem Pixel',
    'Sem Mobile',
    'Site Lento',
    'Sem HTTPS',
    'Site sem WhatsApp',
    'Sem Tráfego Rastreado',
    'Só Telefone Fixo',
    'Empresa Recente',
    'CNPJ Inativo',
  ];
  const allDores = [...new Set([...(META.dores || []), ...standardDores])];

  v.innerHTML = `
    ${window.renderClassifierModeBar?.(visibleIds) || ''}
    <div class="filters">
      <select id="fStatus" class="lead-filter-select"><option value="">Todos status</option>${META.status.map((s) => `<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="fSeg" class="lead-filter-select"><option value="">Todos segmentos</option>${META.segmentos.map((s) => `<option value="${s}" ${segmento === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="fOrigem" class="lead-filter-select">
        <option value="">Todas origens</option>
        <option value="MAPS" ${origem === 'MAPS' ? 'selected' : ''}>Google Maps</option>
        <option value="OSM" ${origem === 'OSM' ? 'selected' : ''}>OpenStreetMap</option>
        <option value="CSV" ${origem === 'CSV' ? 'selected' : ''}>CSV</option>
        <option value="MANUAL" ${origem === 'MANUAL' ? 'selected' : ''}>Manual</option>
      </select>
      <select id="fDor" class="lead-filter-select">
        <option value="">Todas dores</option>
        ${allDores.map((d) => `<option value="${esc(d)}" ${dor === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
      </select>
      <select id="fCidade" class="lead-filter-select"><option value="">Todas cidades</option>${(META.cidades || [window.AppPorts?.config?.get?.()?.tenant?.default_city || 'Governador Valadares']).map((c) => `<option value="${esc(c)}" ${cidade === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="fWhatsapp" class="lead-filter-select"><option value="">WhatsApp: todos</option><option value="1" ${whatsapp === '1' ? 'selected' : ''}>Com número de WhatsApp</option><option value="0" ${whatsapp === '0' ? 'selected' : ''}>Sem WhatsApp ou inválido</option></select>
      <select id="fVerificacao" class="lead-filter-select"><option value="">Verificação: todas</option>${(META.whatsapp_status || []).map((s) => `<option value="${s}" ${verificacao === s ? 'selected' : ''}>${s.replaceAll('_',' ')}</option>`).join('')}</select>
      <select id="fFonte" class="lead-filter-select"><option value="">Todas as fontes</option>${(META.fontes || []).map((s) => `<option value="${esc(s)}" ${fonte === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="fLote" class="lead-filter-select"><option value="">Todos os lotes</option>${(META.lotes || []).map((l) => `<option value="${esc(l)}" ${lote === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select id="fSort" class="lead-filter-select"><option value="score" ${sort === 'score' ? 'selected' : ''}>Ordenar: score</option><option value="nome" ${sort === 'nome' ? 'selected' : ''}>Nome</option><option value="recente" ${sort === 'recente' ? 'selected' : ''}>Mais recentes</option><option value="verificado" ${sort === 'verificado' ? 'selected' : ''}>Verificação recente</option><option value="followup" ${sort === 'followup' ? 'selected' : ''}>Próximo follow-up</option></select>
      <button type="button" class="btn" id="btnRefreshLeads">Atualizar</button>
    </div>
    <div class="panel tablewrap leads-table-wrap">
      <table class="leads-mobile-cards">
        <thead><tr><th>Lead / Origem / Dores</th><th>Segmento</th><th>Cidade / Bairro</th><th>Contato</th><th>WhatsApp</th><th>Potencial</th><th>Status</th><th>Score</th><th></th></tr></thead>
        <tbody>
          ${pageEntries.map(({ lead: x, ev }) => `
            <tr title="${esc(ev.motivo_destaque || '')}">
              <td data-label="Lead">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                  <strong>${esc(x.nome_fantasia)}</strong>
                  ${window.renderOriginBadge?.(x) || ''}
                </div>
                <div class="muted" style="font-size:12px">${esc(ev.motivo_destaque || x.razao_social || x.cnpj || x.fonte || '')}</div>
                <div>${window.renderPainBadges?.(ev.etiquetas_dor) || ''}</div>
              </td>
              <td data-label="Segmento">${esc(x.segmento)}</td>
              <td data-label="Cidade / Bairro">${esc(x.cidade || window.AppPorts?.config?.get?.()?.tenant?.default_city || 'Governador Valadares')}<br><span class="muted">${esc(x.bairro || '—')}</span></td>
              <td data-label="Contato">${esc(x.telefone || x.whatsapp || '—')}</td>
              <td data-label="WhatsApp">${esc(x.whatsapp || '—')}<br><span class="badge">${esc((x.whatsapp_status || (x.whatsapp ? 'NAO_VERIFICADO' : 'SEM WHATSAPP')).replaceAll('_',' '))}</span></td>
              <td data-label="Potencial"><span class="badge ${esc(ev.potencial)}">${esc(ev.potencial)}</span></td>
              <td data-label="Status"><span class="badge ${esc(x.status)}">${esc(x.status)}</span></td>
              <td data-label="Score" title="${esc(window.formatBreakdownTooltip?.(ev.breakdown) || '')}" style="cursor:help">
                <strong style="border-bottom:1px dotted var(--cyan)">${ev.score}</strong>
              </td>
              <td data-label="Ações"><button type="button" class="btn open-lead-btn" data-lead-id="${esc(x.id)}">Abrir</button></td>
            </tr>`).join('') || '<tr><td colspan="9">Nenhum lead corresponde a esses filtros.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="pagination" aria-label="Paginação da lista de leads">
      <span class="muted">${total ? (LEAD_PAGE - 1) * LEAD_PAGE_SIZE + 1 : 0}–${Math.min(LEAD_PAGE * LEAD_PAGE_SIZE, total)} de ${total} leads</span>
      <div class="actions" style="margin:0">
        <button type="button" class="btn" id="btnPrevLeadPage" ${LEAD_PAGE <= 1 ? 'disabled' : ''}>Anterior</button>
        <span class="page-indicator">Página ${LEAD_PAGE} de ${pageCount}</span>
        <button type="button" class="btn" id="btnNextLeadPage" ${LEAD_PAGE >= pageCount ? 'disabled' : ''}>Próxima</button>
      </div>
    </div>`;

  $$('.lead-filter-select', v).forEach((sel) => sel.addEventListener('change', resetLeadPage));
  $('#btnRefreshLeads', v)?.addEventListener('click', () => show('leads'));
  $('#btnPrevLeadPage', v)?.addEventListener('click', () => changeLeadPage(-1));
  $('#btnNextLeadPage', v)?.addEventListener('click', () => changeLeadPage(1));
  $$('.open-lead-btn', v).forEach((btn) => {
    btn.addEventListener('click', () => openLead(btn.dataset.leadId));
  });

  window.bindClassifierBarEvents?.(
    () => {
      LEAD_PAGE = 1;
      renderLeadsView(v, filterState);
    },
    visibleIds,
    (updatedItems) => {
      const byId = new Map(updatedItems.map((it) => [it.id, it]));
      LAST_LOADED_LEADS = LAST_LOADED_LEADS.map((it) => byId.get(it.id) || it);
      renderLeadsView(v, filterState);
    }
  );
}

function changeLeadPage(offset) {
  LEAD_PAGE = Math.max(1, LEAD_PAGE + offset);
  show('leads');
}

function resetLeadPage() {
  syncLeadFiltersFromDom();
  LEAD_PAGE = 1;
  show('leads');
}


async function pipeline(v) {
  const data = await api('/api/leads?view=summary');
  const stages = META.status || ['NOVO','QUALIFICADO','CONTATADO','VISITA','PROPOSTA','CLIENTE','DESCARTADO'];
  if (!MOBILE_PIPELINE_STAGE || !stages.includes(MOBILE_PIPELINE_STAGE)) {
    MOBILE_PIPELINE_STAGE = stages[0] || 'NOVO';
  }
  const counts = {};
  for (const st of stages) counts[st] = data.items.filter((x) => x.status === st);

  const mobileTabs = `
    <div class="kanban-mobile-tabs" role="tablist" aria-label="Estágios do Pipeline">
      ${stages.map((st) => `
        <button type="button" class="mode-pill kanban-mobile-tab ${st === MOBILE_PIPELINE_STAGE ? 'active' : ''}" data-stage="${esc(st)}">
          ${esc(st)} (${counts[st].length})
        </button>
      `).join('')}
    </div>`;

  const cols = stages.map((st) => {
    const items = counts[st];
    return `<div class="kanban-col ${st === MOBILE_PIPELINE_STAGE ? 'mobile-active' : ''}" data-stage="${esc(st)}">
      <h4>${esc(st)} <span class="badge">${items.length}</span></h4>
      ${items.slice(0, 40).map((x) => `
        <div class="kanban-card" data-lead-id="${esc(x.id)}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:4px">
            <strong>${esc(x.nome_fantasia)}</strong>
            ${window.renderOriginBadge?.(x) || ''}
          </div>
          <div class="muted">${esc(x.segmento)} · ${esc(x.cidade || '')}</div>
          <div class="muted">${esc(x.telefone || x.whatsapp || 'sem tel')}</div>
          <span class="badge ${esc(x.potencial)}">${esc(x.potencial)}</span>
        </div>`).join('') || '<p class="muted">—</p>'}
    </div>`;
  }).join('');
  v.innerHTML = `${mobileTabs}<div class="kanban">${cols}</div>
    <p class="muted" style="margin-top:10px">Clique no card para contatar / converter. Máx. 40 por coluna na visualização.</p>`;

  $$('.kanban-mobile-tab', v).forEach((tab) => {
    tab.addEventListener('click', () => {
      MOBILE_PIPELINE_STAGE = tab.dataset.stage;
      $$('.kanban-mobile-tab', v).forEach((t) => t.classList.toggle('active', t === tab));
      $$('.kanban-col', v).forEach((c) => c.classList.toggle('mobile-active', c.dataset.stage === MOBILE_PIPELINE_STAGE));
    });
  });
  $$('.kanban-card', v).forEach((card) => {
    card.addEventListener('click', () => openLead(card.dataset.leadId));
  });
}

async function agenda(v) {
  if (typeof window.renderAgendaCockpit === 'function') {
    return await window.renderAgendaCockpit(v);
  }
  const [late, today, week] = await Promise.all([
    api('/api/followups?period=atrasado'), api('/api/followups?period=hoje'), api('/api/followups?period=semana'),
  ]);
  const defaultCity = window.AppPorts?.config?.get?.()?.tenant?.default_city || 'Governador Valadares';
  const column = (title, items, empty) => `<section class="panel"><h3>${title} <span class="badge">${items.length}</span></h3>${items.map((x) => `<button type="button" class="queue-item agenda-fallback-lead" data-lead-id="${esc(x.id)}"><strong>${esc(x.nome_fantasia)}</strong><span>${esc(x.proximo_contato)} · ${esc(x.cidade || defaultCity)} · ${esc(x.status)}</span><small>${esc(x.proximo_contato_nota || 'Sem observação')}</small></button>`).join('') || `<p class="muted">${empty}</p>`}</section>`;
  v.innerHTML = `<div class="grid followup-grid">${column('Atrasados', late.items, 'Nenhum retorno atrasado.')}${column('Hoje', today.items, 'Nenhum retorno para hoje.')}${column('Próximos 7 dias', week.items, 'Nenhum retorno agendado para esta semana.')}</div>`;
  $$('.agenda-fallback-lead', v).forEach((btn) => btn.addEventListener('click', () => openLead(btn.dataset.leadId)));
}

function novo(v) {
  const defaultCity = window.AppPorts?.config?.get?.()?.tenant?.default_city || 'Governador Valadares';
  v.innerHTML = `
    <div class="panel">
      <form id="leadForm" class="form">
        <div class="field"><label>Nome fantasia *</label><input name="nome_fantasia" required placeholder="Ex.: Bar do Centro" /></div>
        <div class="field"><label>Razão social</label><input name="razao_social" /></div>
        <div class="field"><label>CNPJ</label><input name="cnpj" placeholder="00.000.000/0000-00" /></div>
        <div class="field"><label>Segmento *</label>
          <select name="segmento" required>${META.segmentos.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Telefone</label><input name="telefone" placeholder="(33) 3xxx-xxxx" /></div>
        <div class="field"><label>WhatsApp</label><input name="whatsapp" /></div>
        <div class="field"><label>Estado do WhatsApp</label><select name="whatsapp_status"><option value="">Automático</option>${(META.whatsapp_status || []).map((s) => `<option value="${s}">${s.replaceAll('_',' ')}</option>`).join('')}</select></div>
        <div class="field"><label>E-mail</label><input name="email" type="email" /></div>
        <div class="field"><label>Website</label><input name="website" /></div>
        <div class="field full"><label>Endereço</label><input name="endereco" /></div>
        <div class="field"><label>Bairro</label><input name="bairro" /></div>
        <div class="field"><label>Cidade</label><input name="cidade" value="${esc(defaultCity)}" /></div>
        <div class="field"><label>Potencial</label>
          <select name="potencial">${META.potencial.map((s) => `<option value="${s}" ${s === 'MEDIO' ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Status</label>
          <select name="status">${META.status.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Fonte *</label><input name="fonte" required placeholder="Ex.: Guia telefônico, Google Maps, CNPJ..." /></div>
        <div class="field"><label>Tipo da fonte</label><select name="fonte_tipo"><option value="MANUAL">Manual</option><option value="OFICIAL">Site/perfil oficial</option><option value="DIRETORIO">Diretório</option><option value="CADASTRO_PUBLICO">Cadastro público</option></select></div>
        <div class="field"><label>URL da fonte</label><input name="fonte_url" placeholder="https://..." /></div>
        <div class="field full"><label>Observações</label><textarea name="observacoes" rows="3"></textarea></div>
        <div class="actions full">
          <button class="btn primary" type="submit">Salvar lead</button>
        </div>
      </form>
    </div>`;
  $('#leadForm').onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api('/api/leads', { method: 'POST', body: JSON.stringify(b) });
      await window.refreshMeta?.();
      toast('Lead salvo');
      show('leads');
      $$('.nav').forEach((x) => x.classList.toggle('active', x.dataset.view === 'leads'));
    } catch (err) {
      toast(err.message);
    }
  };
}

async function motorView(v) {
  if (typeof window.renderMapsMotorView === 'function') {
    return await window.renderMapsMotorView(v);
  }
  v.innerHTML = '<div class="panel"><p class="muted">Carregando módulo Google Maps...</p></div>';
}

function templatesView(v) {
  const currentTemplates = getCustomTemplates();
  let currentKey = 'primeiro';

  v.innerHTML = `
    <div class="panel">
      <div class="actions" style="justify-content:space-between;align-items:center">
        <div>
          <h3 style="margin:0">Personalização de Mensagens Automáticas & Scripts</h3>
          <p class="muted" style="margin:4px 0 0">Edite e salve os textos que são sugeridos no WhatsApp e E-mail. As variáveis são preenchidas dinamicamente com o perfil e lead ativo.</p>
        </div>
        <button type="button" class="btn" id="btnResetTemplates">Restaurar Padrões de Fábrica</button>
      </div>

      <div class="form" style="margin-top:16px">
        <div class="field full">
          <label>Selecione a Etapa / Situação da Mensagem:</label>
          <select id="templateSelector">
            ${Object.entries(TEMPLATE_LABELS).map(([k, label]) => `
              <option value="${k}" ${k === currentKey ? 'selected' : ''}>${label}</option>
            `).join('')}
          </select>
        </div>

        <div class="field full">
          <label>Texto da Mensagem (Suporta variáveis dinâmicas):</label>
          <textarea id="templateEditorText" rows="6" style="font-family:monospace;font-size:13px;line-height:1.5">${esc(currentTemplates[currentKey])}</textarea>
        </div>

        <div class="field full" style="background:var(--card);padding:10px 14px;border-radius:10px;border:1px solid var(--border);font-size:12px;color:var(--muted)">
          <strong>Tags disponíveis para personalização:</strong>
          <span style="color:var(--cyan);margin-left:8px">{nome_fantasia}</span> (Nome do lead) · 
          <span style="color:var(--cyan)">{operador}</span> (Rafael Oliveira ou Sara Rosseto) · 
          <span style="color:var(--cyan)">{cidade}</span> (Cidade do lead) · 
          <span style="color:var(--cyan)">{segmento}</span> (Segmento de atuação)
        </div>

        <div class="field full">
          <label>Pré-visualização ao vivo com operador ativo (${esc(getActiveOperatorName())}):</label>
          <div id="templatePreviewBox" style="background:#090e17;border:1px solid var(--border);padding:12px;border-radius:10px;white-space:pre-wrap;font-size:13px;color:var(--text)"></div>
        </div>
      </div>

      <div class="actions" style="margin-top:14px">
        <button class="btn primary" id="btnSalvarTemplate">💾 Salvar Alterações na Mensagem</button>
      </div>
    </div>
  `;

  function updatePreview() {
    const raw = $('#templateEditorText').value;
    const preview = raw
      .replace(/\{nome_fantasia\}/g, 'Nu Japa Sushi Bar')
      .replace(/\{operador\}/g, getActiveOperatorName())
      .replace(/\{cidade\}/g, 'Governador Valadares')
      .replace(/\{segmento\}/g, 'Restaurante / Sushi');
    $('#templatePreviewBox').textContent = preview;
  }

  $('#templateSelector')?.addEventListener('change', (e) => {
    currentKey = e.target.value;
    const tmpls = getCustomTemplates();
    $('#templateEditorText').value = tmpls[currentKey] || DEFAULT_TEMPLATES[currentKey] || '';
    updatePreview();
  });

  $('#templateEditorText')?.addEventListener('input', updatePreview);
  updatePreview();

  $('#btnResetTemplates')?.addEventListener('click', resetTemplatesToDefault);
  $('#btnSalvarTemplate')?.addEventListener('click', () => {
    const tmpls = getCustomTemplates();
    tmpls[currentKey] = $('#templateEditorText').value;
    saveCustomTemplates(tmpls);
    toast('Modelo de mensagem salvo com sucesso!');
  });
}

async function resetTemplatesToDefault() {
  const brand = window.AppPorts?.config?.get?.()?.tenant?.brand_name || 'AutonomIA Systems';
  const ok = await window.RuntimeAdapter?.confirmDialog({
    title: 'Restaurar Modelos Padrão',
    message: `Deseja restaurar todas as mensagens automáticas para o padrão original da ${brand}?`,
    confirmLabel: 'Restaurar',
    danger: true,
  });
  if (!ok) return;
  window.RuntimeAdapter?.removeStorage('autonomia_custom_templates');
  toast('Modelos restaurados!');
  show('templates');
}


function pesquisa(v) {
  v.innerHTML = `
    <div class="panel">
      <h3 style="margin-top:0">Identidade Corporativa & Soluções</h3>
      <p><strong style="color:var(--cyan);font-size:16px">AutonomIA Systems — Seu 1º Funcionário Digital</strong></p>
      <p class="muted">Especialistas no desenvolvimento de <strong>Sistemas Inteligentes, Automação de Processos e Agentes de IA</strong> para empresas B2B.</p>
      <ul style="color:var(--muted);line-height:1.8">
        <li><strong>Foco Tecnológico:</strong> Sistemas inteligentes com IA, agentes digitais integrados e automação de fluxos operacionais.</li>
        <li><strong>Diferencial:</strong> Substituir gargalos manuais e sistemas engessados por soluções que realmente geram retorno financeiro e eficiência.</li>
        <li><strong>Operadores Ativos:</strong> Rafael Oliveira e Sara Rosseto.</li>
      </ul>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">Fontes para Prospecção B2B (Empresas & Decisores)</h3>
      <ol style="color:var(--muted);line-height:1.8">
        <li><strong>Google Maps & Google Business</strong> — Empresas em expansão, comércios consolidados e prestadores de serviços.</li>
        <li><strong>Bases Públicas & CNPJ (CNAEs comerciais e de serviços)</strong> — Empresas ativas com faturamento e equipe em crescimento.</li>
        <li><strong>Canais Digitais & Redes Oficiais</strong> — WhatsApp comercial, Instagram institucional e canais de atendimento direto.</li>
      </ol>
      <p class="muted">Abordagem recomendada: <em>Consultiva, sutil e focada em valor percebido</em>.</p>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">Segmentos de Alto Impacto para Sistemas Inteligentes</h3>
      <div class="grid">
        ${['VAREJO & ATACADO', 'DISTRIBUIDORAS', 'SERVIÇOS B2B', 'LOGÍSTICA', 'GASTRONOMIA', 'CLÍNICAS & SAÚDE', 'HOTELARIA', 'EVENTOS'].map((s) => `<div class="card"><h3>${s}</h3><div class="muted">Automação de atendimento, CRM e processos</div></div>`).join('')}
      </div>
    </div>`;
}


function phoneDigits(t) {
  return String(t || '').replace(/\D/g, '');
}

function waLink(num, text) {
  if (window.Hygiene?.buildWhatsAppLink) {
    return window.Hygiene.buildWhatsAppLink(num, text);
  }
  const d = phoneDigits(num);
  if (!d) return null;
  const n = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d : '55' + d;
  return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
}

function getActiveOperatorName() {
  return ACTIVE_OPERATOR || 'Rafael Oliveira';
}

const DEFAULT_TEMPLATES = {
  primeiro: `Olá, {nome_fantasia}! Tudo bem? Meu nome é {operador}, da AutonomIA Systems. Nós desenvolvemos sistemas inteligentes sob medida para ajudar seu negócio a crescer e transformar a rotina da sua empresa para melhor. Vejo que muitas empresas hoje investem em sistemas, mas ainda sentem que eles não entregam todo o valor e controle que gostariam de ter no dia a dia...
Se tiver 10 minutinhos para conversar, posso te apresentar todas as vantagens dos nossos sistemas.`,

  sem_resposta: `Olá! Aqui é o(a) {operador}, da AutonomIA Systems. Tentei contato anteriormente sobre a operação da {nome_fantasia}. Sei como a rotina é corrida, mas caso sinta que os sistemas e rotinas atuais da sua equipe poderiam entregar mais agilidade com IA, fico à disposição para um bate-papo rápido e sem compromisso.`,

  followup: `Olá! Retomando nosso contato, aqui é o(a) {operador}, da AutonomIA Systems. Você conseguiu avaliar nosso contato sobre como sistemas inteligentes e automação podem destravar gargalos na {nome_fantasia}? Posso te mostrar um caso rápido de aplicação prática no seu setor?`,

  catalogo: `Olá! Aqui é o(a) {operador}, da AutonomIA Systems. Conforme conversamos, envio o material com as soluções e sistemas inteligentes que desenvolvemos para a {nome_fantasia}. Você consegue ver como nossos agentes digitais se integram à sua rotina atual gerando mais valor com menos esforço manual.`,

  visita: `Olá! Aqui é o(a) {operador}, da AutonomIA Systems. Muito obrigado pela reunião e pela recepção na {nome_fantasia}. Conforme alinhado, estamos estruturando o diagnóstico dos seus fluxos para demonstrar onde um sistema inteligente trará ganhos imediatos. Sigo à disposição!`,

  proposta: `Olá! Aqui é o(a) {operador}, da AutonomIA Systems. Estou acompanhando a proposta de desenvolvimento e implantação dos sistemas inteligentes para a {nome_fantasia}. Quer esclarecer algum ponto técnico, cronograma ou adequação de escopo?`,

  cliente: `Olá! Aqui é o(a) {operador}, da AutonomIA Systems. Como estão os resultados e o impacto dos sistemas na rotina da {nome_fantasia}? Conte comigo para novos módulos de inteligência ou melhorias operacionais.`,

  reativacao: `Olá! Aqui é o(a) {operador}, da AutonomIA Systems. Faz algum tempo desde nossa última troca. Lançamos recentemente novos recursos de inteligência e agentes integrados para empresas como a {nome_fantasia}. Teria interesse em conhecer rapidamente as novidades?`,
};

function getCustomTemplates() {
  try {
    const raw = localStorage.getItem('autonomia_custom_templates');
    if (raw) return { ...DEFAULT_TEMPLATES, ...JSON.parse(raw) };
  } catch (_) {}
  return { ...DEFAULT_TEMPLATES };
}

function saveCustomTemplates(templates) {
  window.RuntimeAdapter?.setStorage('autonomia_custom_templates', JSON.stringify(templates));
  window.OfflineStorage?.putMeta?.('templates', templates).catch(() => {});
}

const TEMPLATE_LABELS = {
  primeiro: 'Primeiro contato (Abordagem Consultiva)',
  sem_resposta: 'Sem resposta (Reabertura Leve)',
  followup: 'Follow-up (Geração de Valor)',
  catalogo: 'Apresentação de Sistemas & Soluções',
  visita: 'Pós-reunião / Diagnóstico',
  proposta: 'Acompanhamento de Proposta',
  cliente: 'Pós-venda & Expansão',
  reativacao: 'Reativação com Novidades'
};

function defaultTemplate(status) { return ({ CLIENTE:'cliente', PROPOSTA:'proposta', VISITA:'visita', CONTATADO:'followup', QUALIFICADO:'primeiro' })[status] || 'primeiro'; }

function msgTemplate(lead, stage = defaultTemplate(lead.status)) {
  const op = getActiveOperatorName();
  const tmpls = getCustomTemplates();
  const rawText = tmpls[stage] || tmpls.primeiro || DEFAULT_TEMPLATES.primeiro;

  return rawText
    .replace(/\{nome_fantasia\}/g, lead?.nome_fantasia || 'amigo(a)')
    .replace(/\{operador\}/g, op)
    .replace(/\{cidade\}/g, lead?.cidade || 'Governador Valadares')
    .replace(/\{segmento\}/g, lead?.segmento || 'sua empresa');
}

async function openLead(id) {
  const { item: x, interacoes } = await api('/api/leads/' + id);
  OPEN_LEAD = x;
  const m = $('#modal');
  m.classList.remove('hidden');
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  const tel = x.telefone || x.whatsapp || '';
  const stage = defaultTemplate(x.status);
  const wa = x.whatsapp && x.whatsapp_status !== 'INVALIDO' ? waLink(x.whatsapp, msgTemplate(x, stage)) : null;
  const isCliente = x.status === 'CLIENTE';
  const activeLensOrMode = window.getActiveLensOrMode?.() || window.getActiveScoringMode?.() || 'equilibrado';
  const evalRes = window.ScoringModes?.evaluateLead(x, activeLensOrMode) || { score: x.score, mode_label: 'Equilibrado', etiquetas_dor: x.etiquetas_dor || [], motivo_destaque: '', breakdown: [] };
  const matrixRes = window.ValueMatrix?.evaluateValueMatrix?.(x) || null;
  const auditInfo = x.diagnostico_fatos?.website_audit || null;
  const stackTags = Array.isArray(auditInfo?.stack_detectada) ? auditInfo.stack_detectada : [];
  const socios = Array.isArray(x.socios) && x.socios.length ? x.socios : (x.diagnostico_fatos?.cnpj_info?.socios || []);
  m.innerHTML = `
    <div class="modal-box" tabindex="-1" aria-labelledby="leadModalTitle" style="max-width:720px">
      <div class="actions" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <h2 id="leadModalTitle" style="margin:0">${esc(x.nome_fantasia)}</h2>
            ${window.renderOriginBadge?.(x) || ''}
            ${matrixRes ? `<span class="badge ${matrixRes.quadrante === 'OURO' ? 'ALTO' : ''}" title="${esc(matrixRes.quadrante_titulo)}">${esc(matrixRes.quadrante_label)} (Caixa ${matrixRes.caixa_score} · Brecha ${matrixRes.brecha_score})</span>` : ''}
          </div>
          <p class="muted" style="margin:4px 0 0">${esc(x.segmento)} · Score ${evalRes.score} (${esc(evalRes.mode_label || activeLensOrMode)}) · <span class="badge ${esc(x.status)}">${esc(x.status)}</span></p>
          ${evalRes.motivo_destaque ? `<p class="muted" style="margin:4px 0 0;color:var(--cyan)">${esc(evalRes.motivo_destaque)}</p>` : ''}
          ${evalRes.breakdown?.length ? `<div style="margin-top:6px">${window.renderBreakdownChips?.(evalRes.breakdown) || ''}</div>` : ''}
          ${(stackTags.length || auditInfo?.ttfb_ms != null) ? `<p class="muted" style="margin:4px 0 0">🔧 Stack: ${stackTags.map((s) => `<span class="badge">${esc(s)}</span>`).join(' ') || '—'}${auditInfo?.ttfb_ms != null ? ` · ⚡ TTFB ${auditInfo.ttfb_ms}ms` : ''}</p>` : ''}
          <div style="margin-top:4px">${window.renderPainBadges?.(evalRes.etiquetas_dor) || ''}</div>
          ${socios.length ? `<p class="muted" style="margin:4px 0 0">👥 Sócios: <strong>${esc(socios.join(', '))}</strong></p>` : ''}
        </div>
        <button type="button" class="btn" id="btnCloseLeadModal">Fechar</button>
      </div>

      <div class="contact-bar" style="display:flex;flex-wrap:wrap;gap:8px;margin:14px 0">
        ${tel ? `<button type="button" class="btn primary" id="btnModalCall">📞 Ligar</button>` : '<span class="btn" style="opacity:.5">Sem telefone</span>'}
        ${wa ? `<button type="button" class="btn good" id="btnModalWaDraft">💬 Abrir rascunho no WhatsApp</button>` : '<span class="muted">Sem WhatsApp disponível/verificado.</span>'}
        ${x.email ? `<button type="button" class="btn" id="btnModalEmail">✉️ E-mail</button>` : ''}
        <button type="button" class="btn" id="btnDiagnoseSingle">🔬 Diagnosticar Lead</button>
        <button type="button" class="btn" id="btnOpenLookalike" style="border-color:var(--cyan);color:var(--cyan)">🎯 Encontrar Parecidos (Lookalike)</button>
        <button type="button" class="btn" id="btnRegistrarContato" style="background:#1e3152;color:#fff;border:1px solid var(--border)">${isCliente ? 'Registrar contato' : 'Marcar contato como enviado'}</button>
        ${!isCliente ? `<button type="button" class="btn good" id="btnConverterLead">✅ Tornar cliente</button>` : '<span class="badge CLIENTE">Já é cliente</span>'}
      </div>

      <div class="panel" style="margin:0 0 12px;padding:12px">
        <strong>Mensagem sugerida — confira antes de enviar</strong>
        <div class="field" style="margin-top:8px"><label for="messageStage">Situação</label><select id="messageStage">${Object.entries(TEMPLATE_LABELS).map(([key,label]) => `<option value="${key}" ${stage === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <textarea id="contactMessage" class="contact-script" rows="4">${esc(msgTemplate(x, stage))}</textarea>
        <div class="actions">
          <button type="button" class="btn" id="btnCopyMsg">Copiar mensagem</button>
          ${wa ? `<button type="button" class="btn good" id="btnOpenWaMsg">Abrir WhatsApp</button>` : ''}
          <button type="button" class="btn" id="btnSaveMsgTemplate" style="border-color:var(--cyan);color:var(--cyan)">💾 Salvar como novo modelo padrão desta etapa</button>
        </div>
        <p class="muted">O app apenas prepara o texto. Você pode editar o texto acima para este envio ou salvá-lo como o novo padrão da equipe.</p>
      </div>

      <div class="form" style="margin-top:8px">
        <div class="field"><label>Status</label>
          <select id="edStatus">${META.status.map((s) => `<option value="${s}" ${x.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Potencial</label>
          <select id="edPot">${META.potencial.map((s) => `<option value="${s}" ${x.potencial === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Telefone</label><input id="edTel" value="${esc(x.telefone || '')}" /></div>
        <div class="field"><label>WhatsApp</label><input id="edWa" value="${esc(x.whatsapp || '')}" /></div>
        <div class="field"><label>Estado do WhatsApp</label><select id="edWaStatus"><option value="">Sem WhatsApp</option>${(META.whatsapp_status || []).map((s) => `<option value="${s}" ${(x.whatsapp_status || (x.whatsapp ? 'NAO_VERIFICADO' : '')) === s ? 'selected' : ''}>${s.replaceAll('_',' ')}</option>`).join('')}</select></div>
        <div class="field"><label>Nome fantasia</label><input id="edName" value="${esc(x.nome_fantasia || '')}" /></div>
        <div class="field"><label>Segmento</label><select id="edSegment">${META.segmentos.map((s) => `<option value="${s}" ${x.segmento === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Razão social</label><input id="edRazao" value="${esc(x.razao_social || '')}" /></div>
        <div class="field"><label>CNPJ</label><input id="edCnpj" value="${esc(x.cnpj || '')}" /></div>
        <div class="field"><label>E-mail</label><input id="edEmail" type="email" value="${esc(x.email || '')}" /></div>
        <div class="field"><label>Website</label><input id="edWebsite" value="${esc(x.website || '')}" /></div>
        <div class="field full"><label>Endereço</label><input id="edEndereco" value="${esc(x.endereco || '')}" /></div>
        <div class="field"><label>Bairro</label><input id="edBairro" value="${esc(x.bairro || '')}" /></div>
        <div class="field"><label>Cidade</label><input id="edCidade" value="${esc(x.cidade || '')}" /></div>
        <div class="field"><label>Fonte</label><input id="edFonte" value="${esc(x.fonte || '')}" /></div>
        <div class="field"><label>URL da fonte</label><input id="edFonteUrl" value="${esc(x.fonte_url || '')}" /></div>
        <div class="field"><label>Tipo da fonte</label><select id="edFonteTipo"><option value="MAPS" ${x.fonte_tipo === 'MAPS' ? 'selected' : ''}>Google Maps</option><option value="OFICIAL" ${x.fonte_tipo === 'OFICIAL' ? 'selected' : ''}>Site/perfil oficial</option><option value="DIRETORIO" ${x.fonte_tipo === 'DIRETORIO' ? 'selected' : ''}>Diretório</option><option value="CADASTRO_PUBLICO" ${x.fonte_tipo === 'CADASTRO_PUBLICO' ? 'selected' : ''}>Cadastro público</option><option value="MANUAL" ${x.fonte_tipo === 'MANUAL' ? 'selected' : ''}>Manual</option></select></div>
        <div class="field"><label>Última verificação</label><input id="edVerified" type="date" value="${esc((x.verificado_em || '').slice(0,10))}" /></div>
        <div class="field full"><label>Observações</label><textarea id="edObs" rows="2">${esc(x.observacoes || '')}</textarea></div>
        <div class="field"><label>Próximo contato</label><input id="edFollow" type="date" value="${esc((x.proximo_contato || '').slice(0,10))}" /></div>
        <div class="field"><label>Nota do follow-up</label><input id="edFollowNota" value="${esc(x.proximo_contato_nota || '')}" placeholder="Ex.: retornar com tabela" /></div>
      </div>
      <div class="actions">
        <button type="button" class="btn primary" id="btnSaveLead">Salvar</button>
        <button type="button" class="btn" id="btnSaveFollowup">Agendar follow-up</button>
        <button type="button" class="btn" id="btnDeleteLead">Excluir</button>
      </div>

      <hr style="border-color:var(--border);margin:16px 0" />
      <h3>Registrar interação</h3>
      <div class="form">
        <div class="field"><label>Tipo</label>
          <select id="ixTipo">
            <option>LIGACAO</option><option>WHATSAPP</option><option>VISITA</option>
            <option>PROPOSTA</option><option>EMAIL</option><option>NOTA</option><option>FOLLOWUP</option>
          </select>
        </div>
        <div class="field full"><label>Resumo</label><input id="ixResumo" placeholder="Ex.: Atendeu, pediu demonstração do sistema / agente no WhatsApp" /></div>
      </div>
      <div class="actions"><button type="button" class="btn good" id="btnAddIx">Registrar</button></div>
      <ul style="color:var(--muted);line-height:1.6;max-height:180px;overflow:auto">
        ${(interacoes || []).map((i) => `<li><strong>${esc(i.tipo)}</strong> · ${esc(i.resumo)} <span style="opacity:.7">(${new Date(i.criado_em).toLocaleString('pt-BR')})</span></li>`).join('') || '<li>Nenhuma interação ainda.</li>'}
      </ul>
      <p class="muted" style="margin-top:10px">Fonte: ${esc(x.fonte || '—')} ${safeLink(x.fonte_url, 'link')}</p>
      <p class="muted">${esc(x.endereco || '')} ${esc(x.bairro || '')} — ${esc(x.cidade)}/${esc(x.uf)}</p>
      ${x.website ? `<p class="muted">🌐 ${safeLink(x.website, x.website)}</p>` : ''}
      ${(x.redes_sociais||[]).length ? `<p class="muted">Redes: ${(x.redes_sociais||[]).map((s) => { const raw = String(s); const splitAt = raw.indexOf(':'); const label = splitAt > 0 ? raw.slice(0, splitAt) : 'link'; const url = splitAt > 0 ? raw.slice(splitAt + 1) : raw; return safeLink(url, label); }).filter(Boolean).join(' · ')}</p>` : ''}
      ${x.email ? `<p class="muted">✉️ ${esc(x.email)}</p>` : ''}
      ${x.convertido_em ? `<p class="muted">Convertido em: ${new Date(x.convertido_em).toLocaleString('pt-BR')}${x.pedido_inicial ? ' · 1º pedido: ' + esc(x.pedido_inicial) : ''}</p>` : ''}
    </div>`;

  $('#btnCloseLeadModal', m)?.addEventListener('click', () => m.classList.add('hidden'));
  $('#btnModalCall', m)?.addEventListener('click', () => {
    window.AppPorts?.outputActions?.callPhone?.(tel, x);
    logRascunho(x.id, 'ligacao');
  });
  $('#btnModalWaDraft', m)?.addEventListener('click', () => openWhatsAppDraft(x.id));
  $('#btnModalEmail', m)?.addEventListener('click', () => {
    const brand = window.AppPorts?.config?.get?.()?.tenant?.brand_name || 'AutonomIA Systems';
    window.AppPorts?.outputActions?.openEmail?.(x.email, `${brand} — Contato Consultivo`, msgTemplate(x, stage), x);
    logRascunho(x.id, 'email');
  });
  $('#btnDiagnoseSingle', m)?.addEventListener('click', () => window.diagnoseSingleLead?.(x.id));
  $('#btnOpenLookalike', m)?.addEventListener('click', () => window.openLookalikeForLead?.(x.id));
  $('#btnRegistrarContato', m)?.addEventListener('click', () => registrarContato(x.id, 'whatsapp'));
  $('#btnConverterLead', m)?.addEventListener('click', () => converterLead(x.id));
  $('#messageStage', m)?.addEventListener('change', () => updateMessageTemplate(x.id));
  $('#btnCopyMsg', m)?.addEventListener('click', copyMessage);
  $('#btnOpenWaMsg', m)?.addEventListener('click', () => openWhatsAppDraft(x.id));
  $('#btnSaveMsgTemplate', m)?.addEventListener('click', () => saveCurrentMessageAsTemplate(x.id));
  $('#btnSaveLead', m)?.addEventListener('click', () => saveLead(x.id));
  $('#btnSaveFollowup', m)?.addEventListener('click', () => salvarFollowUp(x.id));
  $('#btnDeleteLead', m)?.addEventListener('click', async () => {
    const ok = await window.RuntimeAdapter?.confirmDialog({
      title: 'Excluir Lead',
      message: `Deseja realmente excluir "${x.nome_fantasia}"?`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (ok) await delLead(x.id);
  });
  $('#btnAddIx', m)?.addEventListener('click', () => addIx(x.id));
  $('.modal-box', m).focus();
}

function safeLink(raw, label) {
  if (!raw) return '';
  try {
    const value = String(raw).trim();
    if (!/^[a-z][a-z\d+.-]*:/i.test(value) && !value.includes('.') && !value.startsWith('//')) return '';
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value.replace(/^\/\//, '')}`;
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return ` · <a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" style="color:var(--orange)">${esc(label || 'link')}</a>`;
  } catch { return ''; }
}

async function copyMessage() {
  const text = $('.contact-script')?.value || '';
  if (!text) return toast('Mensagem indisponível');
  const copied = await window.AppPorts?.outputActions?.copyText?.(text);
  toast(copied ? 'Mensagem copiada' : 'Não foi possível copiar');
}

function updateMessageTemplate() {
  if (OPEN_LEAD) $('#contactMessage').value = msgTemplate(OPEN_LEAD, $('#messageStage').value);
}

function saveCurrentMessageAsTemplate(id) {
  const stage = $('#messageStage')?.value || 'primeiro';
  let text = $('#contactMessage')?.value || '';
  if (!text.trim()) return toast('A mensagem não pode ficar vazia.');

  const op = getActiveOperatorName();
  const lead = OPEN_LEAD;

  // Substitui de volta o nome do lead e operador por tags dinâmicas para reuso
  if (lead?.nome_fantasia) {
    text = text.replaceAll(lead.nome_fantasia, '{nome_fantasia}');
  }
  if (op) {
    text = text.replaceAll(op, '{operador}');
  }

  const tmpls = getCustomTemplates();
  tmpls[stage] = text;
  saveCustomTemplates(tmpls);
  toast(`Modelo da etapa "${TEMPLATE_LABELS[stage] || stage}" salvo com sucesso!`);
}

async function logRascunho(id, canal) {
  try {
    await api('/api/leads/' + id + '/interacoes', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'NOTA', resumo: `Rascunho aberto no canal ${canal}; envio não confirmado.` }),
    });
  } catch (_) {}
}

async function openWhatsAppDraft(id) {
  const lead = OPEN_LEAD?.id === id ? OPEN_LEAD : (await api('/api/leads/' + id)).item;
  if (!lead.whatsapp || lead.whatsapp_status === 'INVALIDO') return toast('WhatsApp indisponível ou marcado como inválido');
  const msgText = $('#contactMessage')?.value || msgTemplate(lead);
  const res = window.AppPorts?.outputActions?.openWhatsApp?.(lead.whatsapp, msgText, lead);
  if (!res?.ok) return toast('Número de WhatsApp inválido');
  await logRascunho(id, 'whatsapp');
}

async function registrarContato(id, channel = 'whatsapp') {
  const ok = await window.RuntimeAdapter?.confirmDialog({
    title: 'Confirmar Contato',
    message: 'Confirma que a mensagem ou contato foi efetivamente enviado/realizado?',
    confirmLabel: 'Confirmar Envio',
  });
  if (!ok) return;
  try {
    await api('/api/leads/' + id + '/contato', { method: 'POST', body: JSON.stringify({ canal: channel, resumo: `Contato ${channel} enviado/realizado e confirmado pelo operador` }) });
    toast('Contato registrado');
    await openLead(id);
  } catch (error) { toast(error.message); }
}

async function converterLead(id) {
  const pedido = await window.RuntimeAdapter?.promptDialog({
    title: 'Converter em Cliente',
    message: '1º pedido / acordo (opcional):',
    placeholder: 'Ex.: Automação WhatsApp + Site',
    confirmLabel: 'Tornar Cliente',
  });
  if (pedido === null) return;
  try {
    await api('/api/leads/' + id + '/converter', {
      method: 'POST',
      body: JSON.stringify({ resumo: 'Convertido pelo time comercial', pedido_inicial: pedido || null }),
    });
    toast('Lead virou CLIENTE 🎉');
    openLead(id);
    show('dashboard');
  } catch (e) {
    toast(e.message);
  }
}

async function salvarFollowUp(id) {
  const data = $('#edFollow')?.value;
  const nota = $('#edFollowNota')?.value || '';
  if (!data) return toast('Informe a data');
  try {
    await api('/api/leads/' + id + '/followup', {
      method: 'POST',
      body: JSON.stringify({ data, nota }),
    });
    toast('Follow-up agendado');
    openLead(id);
  } catch (e) {
    toast(e.message);
  }
}

async function saveLead(id) {
  try {
    await api('/api/leads/' + id, {
      method: 'PUT',
      body: JSON.stringify({
        status: $('#edStatus').value,
        potencial: $('#edPot').value,
        nome_fantasia: $('#edName').value,
        segmento: $('#edSegment').value,
        razao_social: $('#edRazao').value,
        cnpj: $('#edCnpj').value,
        telefone: $('#edTel').value,
        whatsapp: $('#edWa').value,
        whatsapp_status: $('#edWaStatus').value,
        fonte_tipo: $('#edFonteTipo').value,
        verificado_em: $('#edVerified').value,
        email: $('#edEmail').value,
        website: $('#edWebsite').value,
        endereco: $('#edEndereco').value,
        bairro: $('#edBairro').value,
        cidade: $('#edCidade').value,
        fonte: $('#edFonte').value,
        fonte_url: $('#edFonteUrl').value,
        observacoes: $('#edObs').value,
      }),
    });
    toast('Atualizado');
    $('#modal').classList.add('hidden');
    const activeView = $('.nav.active')?.dataset?.view || 'leads';
    show(activeView);
  } catch (e) {
    toast(e.message);
  }
}

async function addIx(id) {
  const resumo = $('#ixResumo').value.trim();
  if (!resumo) return toast('Preencha o resumo');
  try {
    await api('/api/leads/' + id + '/interacoes', {
      method: 'POST',
      body: JSON.stringify({ tipo: $('#ixTipo').value, resumo }),
    });
    toast('Interação registrada');
    openLead(id);
  } catch (e) {
    toast(e.message);
  }
}

async function delLead(id) {
  await api('/api/leads/' + id, { method: 'DELETE' });
  $('#modal').classList.add('hidden');
  toast('Removido');
  show('leads');
}

window.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => {
    console.error(e);
    $('#view').innerHTML = `<div class="panel"><p>Erro ao iniciar: ${esc(e.message)}</p></div>`;
  });
});
