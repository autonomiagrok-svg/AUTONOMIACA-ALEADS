/**
 * Invariante 3 — IRuntimeAdapter: abstrai rede, storage, diálogos acessíveis, clipboard, links e downloads.
 * Elimina 100% de window.prompt() e window.confirm() nativos.
 */
(function (root) {
  const memoryStorage = new Map();
  let dialogResolve = null;

  function ensureDialogHost() {
    if (typeof document === 'undefined') return null;
    let host = document.getElementById('dialogModal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'dialogModal';
      host.className = 'modal hidden';
      document.body.appendChild(host);
    }
    return host;
  }

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getStorage(key) {
    try {
      return root.localStorage?.getItem(key) ?? null;
    } catch {
      return memoryStorage.has(key) ? memoryStorage.get(key) : null;
    }
  }

  function setStorage(key, value) {
    const str = String(value ?? '');
    memoryStorage.set(key, str);
    try {
      root.localStorage?.setItem(key, str);
    } catch {
      // Fallback apenas em memória
    }
  }

  function removeStorage(key) {
    memoryStorage.delete(key);
    try {
      root.localStorage?.removeItem(key);
    } catch {
      // Ignora erro de storage
    }
  }

  function closeActiveDialog(result) {
    const host = typeof document !== 'undefined' ? document.getElementById('dialogModal') : null;
    if (host) {
      host.classList.add('hidden');
      host.innerHTML = '';
    }
    const resolve = dialogResolve;
    dialogResolve = null;
    if (typeof resolve === 'function') resolve(result);
  }

  function confirmDialog({
    title = 'Confirmar ação',
    message = '',
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    danger = false,
  } = {}) {
    const host = ensureDialogHost();
    if (!host) return Promise.resolve(false);
    if (dialogResolve) closeActiveDialog(false);

    return new Promise((resolve) => {
      dialogResolve = resolve;
      host.classList.remove('hidden');
      host.setAttribute('role', 'alertdialog');
      host.setAttribute('aria-modal', 'true');
      host.innerHTML = `
        <div class="modal-box dialog-box" tabindex="-1" aria-labelledby="rtDialogTitle">
          <h3 id="rtDialogTitle" style="margin:0 0 8px">${escHtml(title)}</h3>
          <p class="muted" style="margin:0;white-space:pre-line;line-height:1.5">${escHtml(message)}</p>
          <div class="actions" style="justify-content:flex-end;margin-top:18px">
            <button type="button" class="btn" id="rtDialogCancel">${escHtml(cancelLabel)}</button>
            <button type="button" class="btn ${danger ? 'danger' : 'primary'}" id="rtDialogConfirm">${escHtml(confirmLabel)}</button>
          </div>
        </div>`;

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          closeActiveDialog(false);
        }
      };
      const cleanup = () => {
        document.removeEventListener('keydown', onKey);
      };

      document.addEventListener('keydown', onKey);
      host.addEventListener('click', (e) => {
        if (e.target === host) {
          cleanup();
          closeActiveDialog(false);
        }
      }, { once: true });

      document.getElementById('rtDialogCancel')?.addEventListener('click', () => {
        cleanup();
        closeActiveDialog(false);
      });
      document.getElementById('rtDialogConfirm')?.addEventListener('click', () => {
        cleanup();
        closeActiveDialog(true);
      });
      (danger ? document.getElementById('rtDialogCancel') : document.getElementById('rtDialogConfirm'))?.focus();
    });
  }

  function promptDialog({
    title = 'Informar valor',
    message = '',
    placeholder = '',
    defaultValue = '',
    inputType = 'text',
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
  } = {}) {
    const host = ensureDialogHost();
    if (!host) return Promise.resolve(null);
    if (dialogResolve) closeActiveDialog(null);

    return new Promise((resolve) => {
      dialogResolve = resolve;
      host.classList.remove('hidden');
      host.setAttribute('role', 'alertdialog');
      host.setAttribute('aria-modal', 'true');
      host.innerHTML = `
        <div class="modal-box dialog-box" tabindex="-1" aria-labelledby="rtDialogTitle">
          <h3 id="rtDialogTitle" style="margin:0 0 8px">${escHtml(title)}</h3>
          ${message ? `<p class="muted" style="margin:0 0 12px;white-space:pre-line;line-height:1.5">${escHtml(message)}</p>` : ''}
          <form id="rtDialogForm">
            <input id="rtDialogInput" type="${escHtml(inputType)}" placeholder="${escHtml(placeholder)}" value="${escHtml(defaultValue)}" />
            <div class="actions" style="justify-content:flex-end;margin-top:16px">
              <button type="button" class="btn" id="rtDialogCancel">${escHtml(cancelLabel)}</button>
              <button type="submit" class="btn primary" id="rtDialogConfirm">${escHtml(confirmLabel)}</button>
            </div>
          </form>
        </div>`;

      const input = document.getElementById('rtDialogInput');
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          closeActiveDialog(null);
        }
      };
      const cleanup = () => {
        document.removeEventListener('keydown', onKey);
      };

      document.addEventListener('keydown', onKey);
      host.addEventListener('click', (e) => {
        if (e.target === host) {
          cleanup();
          closeActiveDialog(null);
        }
      }, { once: true });

      document.getElementById('rtDialogCancel')?.addEventListener('click', () => {
        cleanup();
        closeActiveDialog(null);
      });
      document.getElementById('rtDialogForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = input ? input.value : '';
        cleanup();
        closeActiveDialog(val);
      });
      input?.focus();
      input?.select?.();
    });
  }

  async function requestAccessKeyPrompt() {
    const entered = await promptDialog({
      title: 'Servidor Protegido',
      message: 'Digite a chave de acesso para autenticar sua sessão:',
      placeholder: 'Chave de acesso',
      inputType: 'password',
      confirmLabel: 'Desbloquear',
    });
    if (entered !== null && entered.trim()) {
      setStorage('autonomia_access_key', entered.trim());
      return entered.trim();
    }
    return null;
  }

  const OFFLINE_INTERNET_ONLY_MESSAGE =
    'Sem internet: Raio-X e novas buscas no Maps estão pausados. Você pode continuar operando Leads, Power Dialer e Agenda normalmente no modo local.';

  function notifyUser(msg) {
    if (typeof root.toast === 'function') {
      root.toast(msg);
      return;
    }
    if (typeof document === 'undefined' || !document.body) return;
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;bottom:20px;right:20px;background:linear-gradient(135deg,#0284c7,#00d2ff);color:#051020;padding:12px 18px;border-radius:10px;font-weight:800;box-shadow:0 6px 20px rgba(0,210,255,0.3);z-index:99';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function isNetworkFailure(err) {
    if (!err) return false;
    if (err.name === 'TypeError' || err instanceof TypeError) return true;
    const msg = String(err.message || '');
    return /failed to fetch|networkerror|network request failed|load failed|fetch|econnrefused|offline/i.test(msg);
  }

  function isNavigatorOffline() {
    return typeof root.navigator !== 'undefined' && root.navigator.onLine === false;
  }

  function isInternetOnlyPath(method, pathname) {
    if (method === 'GET' && pathname === '/api/system/backup') return true;
    if (method === 'POST') {
      if (pathname === '/api/leads/diagnose-batch') return true;
      if (pathname === '/api/maps/mission') return true;
      if (/^\/api\/leads\/[^/]+\/diagnose$/.test(pathname)) return true;
    }
    return false;
  }

  function createOfflineBlockedError() {
    notifyUser(OFFLINE_INTERNET_ONLY_MESSAGE);
    return Object.assign(new Error(OFFLINE_INTERNET_ONLY_MESSAGE), {
      offlineBlocked: true,
      offlineNotified: true,
    });
  }

  function localIsoDate(daysOffset = 0) {
    if (root.DomainSignals?.addDaysIsoDate) {
      return root.DomainSignals.addDaysIsoDate(new Date(), daysOffset);
    }
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function normText(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function inferOriginLocal(lead) {
    if (root.DomainSignals?.inferOriginKey) return root.DomainSignals.inferOriginKey(lead);
    const lote = String(lead?.lote_origem || '').toUpperCase();
    const fonteTipo = String(lead?.fonte_tipo || '').toUpperCase();
    if (lote.startsWith('MAPS-') || fonteTipo === 'MAPS') return 'MAPS';
    if (lote.startsWith('OSM-') || String(lead?.fonte || '').toLowerCase().includes('openstreetmap')) return 'OSM';
    if (lote.startsWith('CSV-')) return 'CSV';
    return 'MANUAL';
  }

  function toLeadSummaryLocal(lead) {
    const { diagnostico_fatos, interacoes, ...rest } = lead;
    const ixList = Array.isArray(interacoes) ? interacoes : [];
    const ultimoToque = ixList.length
      ? (ixList[0]?.criado_em || lead.ultimo_contato_em || null)
      : (lead.ultimo_contato_em || null);
    return {
      ...rest,
      interacoes_count: ixList.length,
      ultimo_toque_em: ultimoToque,
      stack_detectada: diagnostico_fatos?.website_audit?.stack_detectada || [],
      ttfb_ms: diagnostico_fatos?.website_audit?.ttfb_ms ?? null,
    };
  }

  function filterAndSortLocalLeads(allLeads, searchParams) {
    let rows = Array.isArray(allLeads) ? [...allLeads] : [];
    const q = searchParams.get('q') || '';
    const status = searchParams.get('status') || '';
    const segmento = searchParams.get('segmento') || '';
    const cidade = searchParams.get('cidade') || '';
    const whatsapp = searchParams.get('whatsapp') || '';
    const verificacao = searchParams.get('verificacao') || '';
    const fonte = searchParams.get('fonte') || '';
    const origem = searchParams.get('origem') || '';
    const dor = searchParams.get('dor') || '';
    const lote = searchParams.get('lote') || '';
    const followup = searchParams.get('followup') || '';
    const sort = searchParams.get('sort') || 'score';

    if (status) rows = rows.filter((r) => r.status === status);
    if (segmento) rows = rows.filter((r) => r.segmento === segmento);
    if (cidade) {
      const cNorm = normText(cidade);
      rows = rows.filter((r) => normText(r.cidade || '').includes(cNorm));
    }
    if (whatsapp === '1') rows = rows.filter((r) => Boolean(r.whatsapp) && r.whatsapp_status !== 'INVALIDO');
    if (whatsapp === '0') rows = rows.filter((r) => !r.whatsapp || r.whatsapp_status === 'INVALIDO');
    if (verificacao) {
      rows = rows.filter((r) => (r.whatsapp_status || (r.whatsapp ? 'NAO_VERIFICADO' : '')) === verificacao);
    }
    if (fonte) rows = rows.filter((r) => r.fonte === fonte);
    if (origem) rows = rows.filter((r) => inferOriginLocal(r) === origem);
    if (dor) rows = rows.filter((r) => Array.isArray(r.etiquetas_dor) && r.etiquetas_dor.includes(dor));
    if (lote) rows = rows.filter((r) => r.lote_origem === lote);
    if (followup) {
      const today = localIsoDate(0);
      if (followup === 'atrasado') rows = rows.filter((r) => r.proximo_contato && r.proximo_contato < today);
      else if (followup === 'hoje') rows = rows.filter((r) => r.proximo_contato === today);
    }
    if (q) {
      const n = normText(q);
      rows = rows.filter((r) =>
        [
          r.nome_fantasia, r.razao_social, r.cnpj, r.segmento, r.cidade,
          r.bairro, r.telefone, r.whatsapp, r.email, r.website, r.fonte, r.lote_origem,
        ].some((val) => normText(val).includes(n))
      );
    }

    const comparators = {
      score: (a, b) => (b.score || 0) - (a.score || 0),
      nome: (a, b) => String(a.nome_fantasia || '').localeCompare(String(b.nome_fantasia || ''), 'pt-BR'),
      recente: (a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')),
      followup: (a, b) => String(a.proximo_contato || '9999').localeCompare(String(b.proximo_contato || '9999')),
      verificado: (a, b) => String(b.verificado_em || '').localeCompare(String(a.verificado_em || '')),
    };
    rows.sort(comparators[sort] || comparators.score);
    return rows;
  }

  async function mirrorOnlineResponse(method, parsedUrl, data) {
    const storage = root.OfflineStorage;
    if (!storage || !data || typeof data !== 'object') return;
    const pathname = parsedUrl.pathname;

    try {
      if (method === 'GET') {
        if (pathname === '/api/leads' && Array.isArray(data.items)) {
          const params = parsedUrl.searchParams;
          const hasFilter = ['q', 'status', 'segmento', 'cidade', 'whatsapp', 'verificacao', 'fonte', 'origem', 'dor', 'lote', 'followup']
            .some((k) => Boolean(params.get(k)));
          const isSummary = params.get('view') === 'summary';
          if (!hasFilter && !isSummary) {
            await storage.saveLeadsSnapshot(data.items);
          } else {
            const existingList = await storage.getAllLeads();
            const byId = new Map(existingList.map((l) => [l.id, l]));
            for (const item of data.items) {
              const prev = byId.get(item.id) || {};
              await storage.upsertLeadLocal({ ...prev, ...item });
            }
          }
          return;
        }
        if (/^\/api\/leads\/[^/]+$/.test(pathname) && !pathname.endsWith('/lookalike') && data.item?.id) {
          const merged = {
            ...data.item,
            interacoes: Array.isArray(data.interacoes) ? data.interacoes : (data.item.interacoes || []),
          };
          await storage.upsertLeadLocal(merged);
          return;
        }
        if (pathname === '/api/lenses' && Array.isArray(data.items)) {
          await storage.saveLensesSnapshot(data.items);
          return;
        }
        if (pathname === '/api/meta') {
          await storage.putMeta('meta', data);
          return;
        }
        if (pathname === '/api/config') {
          await storage.putMeta('config', data);
          return;
        }
        if (pathname === '/api/maps/segments' && data.items) {
          await storage.putMeta('maps_segments', data);
        }
      } else if (data.item?.id && pathname.startsWith('/api/leads/')) {
        await storage.upsertLeadLocal(data.item);
      }
    } catch {
      // Espelhamento nunca deve bloquear fluxo principal
    }
  }

  function applyOptimisticLeadMutation(lead, method, pathname, body = {}) {
    const nowIso = new Date().toISOString();
    const updated = {
      ...(lead || {}),
      interacoes: Array.isArray(lead?.interacoes) ? [...lead.interacoes] : [],
    };
    const ixId = () => `local-${root.crypto?.randomUUID ? root.crypto.randomUUID() : Date.now()}`;

    if (method === 'PUT') {
      Object.assign(updated, body, { id: updated.id, interacoes: updated.interacoes, atualizado_em: nowIso });
      return updated;
    }

    if (pathname.endsWith('/contato')) {
      const canal = body.canal || 'telefone';
      const tipo = canal === 'whatsapp' ? 'WHATSAPP' : (canal === 'email' ? 'EMAIL' : 'LIGACAO');
      updated.interacoes.unshift({
        id: ixId(),
        tipo,
        resumo: body.resumo || `Contato via ${canal}`,
        criado_em: nowIso,
      });
      if (body.avancar !== false && ['NOVO', 'QUALIFICADO'].includes(updated.status)) {
        updated.status = 'CONTATADO';
      }
      updated.ultimo_contato_em = nowIso;
      updated.atualizado_em = nowIso;
      return updated;
    }

    if (pathname.endsWith('/followup')) {
      if ('sinal' in body) {
        if (!body.sinal) {
          updated.ultimo_sinal = null;
          updated.ultimo_sinal_em = null;
          updated.ultimo_sinal_nota = null;
        } else {
          updated.ultimo_sinal = body.sinal;
          updated.ultimo_sinal_em = nowIso;
          if ('sinal_nota' in body) updated.ultimo_sinal_nota = body.sinal_nota || null;
        }
      }
      if ('status' in body && body.status) {
        updated.status = body.status;
        if (body.status === 'CLIENTE' && !updated.convertido_em) {
          updated.convertido_em = nowIso;
        }
      }
      if ('proximo_contato' in body || 'data' in body) {
        const nextDate = body.proximo_contato !== undefined ? body.proximo_contato : body.data;
        updated.proximo_contato = nextDate || null;
      }
      if ('proximo_contato_nota' in body || 'nota' in body) {
        const nextNote = body.proximo_contato_nota !== undefined ? body.proximo_contato_nota : body.nota;
        updated.proximo_contato_nota = nextNote || null;
      }
      if ('hibernar_ate' in body) {
        updated.hibernar_ate = body.hibernar_ate || null;
        if (updated.hibernar_ate && !('proximo_contato' in body) && !('data' in body)) {
          updated.proximo_contato = null;
        }
      } else if (body.registrar_toque === true && updated.hibernar_ate) {
        updated.hibernar_ate = null;
      }
      const outbound = body.registrar_toque === true
        || ['WHATSAPP', 'LIGACAO', 'EMAIL', 'VISITA', 'PROPOSTA'].includes(body.tipo);
      if (outbound) updated.ultimo_contato_em = nowIso;

      const ixResumo = body.resumo
        || (body.sinal ? `Sinal registrado: ${body.sinal}` : '')
        || (updated.proximo_contato ? `Agendado: ${updated.proximo_contato}` : '')
        || (updated.hibernar_ate ? `Lead hibernado até ${updated.hibernar_ate}` : '');
      if (ixResumo) {
        updated.interacoes.unshift({
          id: ixId(),
          tipo: body.tipo || (outbound ? 'FOLLOWUP' : 'NOTA'),
          resumo: ixResumo,
          criado_em: nowIso,
        });
      }
      updated.atualizado_em = nowIso;
      return updated;
    }

    if (pathname.endsWith('/interacoes')) {
      updated.interacoes.unshift({
        id: ixId(),
        tipo: body.tipo || 'NOTA',
        resumo: body.resumo || '',
        criado_em: nowIso,
      });
      updated.atualizado_em = nowIso;
      return updated;
    }

    if (pathname.endsWith('/converter')) {
      updated.status = 'CLIENTE';
      updated.potencial = updated.potencial === 'BAIXO' ? 'MEDIO' : (updated.potencial || 'MEDIO');
      updated.convertido_em = nowIso;
      updated.pedido_inicial = body.pedido_inicial || null;
      updated.interacoes.unshift({
        id: ixId(),
        tipo: 'CONVERSAO',
        resumo: body.resumo || `Convertido em cliente${body.pedido_inicial ? ' · 1º pedido: ' + body.pedido_inicial : ''}`,
        criado_em: nowIso,
      });
      updated.atualizado_em = nowIso;
      return updated;
    }

    return updated;
  }

  async function handleOfflineFallback(path, method, parsedUrl, fetchOpts) {
    const pathname = parsedUrl.pathname;
    if (isInternetOnlyPath(method, pathname)) {
      throw createOfflineBlockedError();
    }

    const storage = root.OfflineStorage;
    if (!storage) {
      throw new Error('Armazenamento offline indisponível');
    }

    if (method === 'GET') {
      if (pathname === '/api/leads') {
        const all = await storage.getAllLeads();
        const filtered = filterAndSortLocalLeads(all, parsedUrl.searchParams);
        const isSummary = parsedUrl.searchParams.get('view') === 'summary';
        return {
          items: isSummary ? filtered.map(toLeadSummaryLocal) : filtered,
          offline_cache: true,
        };
      }

      const leadMatch = pathname.match(/^\/api\/leads\/([^/]+)$/);
      if (leadMatch && leadMatch[1] !== 'diagnose-batch') {
        const lead = await storage.getLeadById(decodeURIComponent(leadMatch[1]));
        if (!lead) throw new Error('Lead não encontrado no cache offline');
        return { item: lead, interacoes: lead.interacoes || [], offline_cache: true };
      }

      if (pathname === '/api/lenses') {
        return { items: await storage.getAllLenses(), offline_cache: true };
      }

      if (pathname === '/api/meta') {
        const cached = await storage.getMeta('meta');
        return {
          ...(cached || {
            segmentos: Object.keys(root.DomainSignals?.SEGMENTS || {}),
            status: ['NOVO', 'QUALIFICADO', 'CONTATADO', 'VISITA', 'PROPOSTA', 'CLIENTE', 'DESCARTADO'],
            potencial: ['ALTO', 'MEDIO', 'BAIXO'],
            whatsapp_status: ['PUBLICADO', 'NAO_VERIFICADO', 'VALIDADO', 'INVALIDO'],
            cidades: [],
            fontes: [],
            lotes: [],
            dores: [],
          }),
          offline_cache: true,
        };
      }

      if (pathname === '/api/config') {
        const cached = await storage.getMeta('config');
        if (cached) return { ...cached, offline_cache: true };
        throw new Error('Configuração ainda não sincronizada no cache local');
      }

      if (pathname === '/api/agenda/summary') {
        const modeParam = parsedUrl.searchParams.get('mode') || 'equilibrado';
        const [allLeads, lenses] = await Promise.all([storage.getAllLeads(), storage.getAllLenses()]);
        const modeOrLens = lenses.find((l) => l.id === modeParam) || modeParam;
        if (root.RelationshipAnalytics?.computeRelationshipInsights) {
          const insights = root.RelationshipAnalytics.computeRelationshipInsights(allLeads, { modeId: modeOrLens });
          return {
            urgentes_hoje: insights.urgentes_hoje,
            buckets: insights.buckets,
            temperaturas: insights.temperaturas,
            gargalo_principal: insights.gargalo_principal,
            total_leads: insights.total_leads,
            offline_cache: true,
          };
        }
        return { urgentes_hoje: 0, buckets: {}, temperaturas: {}, gargalo_principal: '', total_leads: allLeads.length, offline_cache: true };
      }

      if (pathname === '/api/followups') {
        const period = parsedUrl.searchParams.get('period') || 'all';
        const today = localIsoDate(0);
        const week = localIsoDate(7);
        let rows = (await storage.getAllLeads()).filter((x) => x.proximo_contato);
        if (period === 'atrasado') rows = rows.filter((x) => x.proximo_contato < today);
        else if (period === 'hoje') rows = rows.filter((x) => x.proximo_contato === today);
        else if (period === 'semana') rows = rows.filter((x) => x.proximo_contato >= today && x.proximo_contato <= week);
        rows.sort((a, b) => String(a.proximo_contato).localeCompare(String(b.proximo_contato)));
        return { items: rows, offline_cache: true };
      }

      if (pathname === '/api/stats') {
        const rows = await storage.getAllLeads();
        const stages = ['NOVO', 'QUALIFICADO', 'CONTATADO', 'VISITA', 'PROPOSTA', 'CLIENTE', 'DESCARTADO'];
        const countBy = (key) => {
          const map = {};
          for (const r of rows) {
            const val = r[key] || 'OUTRO';
            map[val] = (map[val] || 0) + 1;
          }
          return Object.entries(map).map(([k, n]) => ({ [key]: k, n }));
        };
        const stageCounts = {};
        for (const st of stages) stageCounts[st] = 0;
        for (const r of rows) stageCounts[r.status] = (stageCounts[r.status] || 0) + 1;
        const clientes = rows.filter((r) => r.status === 'CLIENTE').length;
        return {
          total: rows.length,
          byStatus: countBy('status'),
          bySeg: countBy('segmento').sort((a, b) => b.n - a.n),
          byPot: countBy('potencial'),
          byCidade: countBy('cidade').sort((a, b) => b.n - a.n),
          pipeline: {
            stages: stages.map((s) => ({ status: s, n: stageCounts[s] || 0 })),
            clientes,
            taxa_conversao: rows.length ? Math.round((clientes / rows.length) * 1000) / 10 : 0,
            com_telefone: rows.filter((r) => r.telefone || r.whatsapp).length,
            follow_ups_agendados: rows.filter((r) => r.proximo_contato).length,
          },
          offline_cache: true,
        };
      }

      if (pathname === '/api/maps/segments') {
        const cached = await storage.getMeta('maps_segments');
        return cached || { items: root.DomainSignals?.SEGMENTS_CATALOG || { RESTAURANTE: 'Restaurante', CLINICA: 'Clínica' }, offline_cache: true };
      }

      if (pathname === '/api/maps/mission/active') {
        return { ok: true, mission: null, offline_cache: true };
      }
    }

    const mutMatch =
      pathname.match(/^\/api\/leads\/([^/]+)\/(contato|followup|interacoes|converter)$/)
      || (method === 'PUT' ? pathname.match(/^\/api\/leads\/([^/]+)$/) : null);

    if (mutMatch && root.SyncQueue?.enqueue) {
      const leadId = decodeURIComponent(mutMatch[1]);
      let bodyObj = {};
      if (typeof fetchOpts.body === 'string' && fetchOpts.body.trim()) {
        try { bodyObj = JSON.parse(fetchOpts.body); } catch { bodyObj = {}; }
      } else if (fetchOpts.body && typeof fetchOpts.body === 'object') {
        bodyObj = fetchOpts.body;
      }

      const existingLead = await storage.getLeadById(leadId);
      const updatedLocalLead = existingLead
        ? applyOptimisticLeadMutation(existingLead, method, pathname, bodyObj)
        : null;
      if (updatedLocalLead) {
        await storage.upsertLeadLocal(updatedLocalLead);
      }

      await root.SyncQueue.enqueue({
        method,
        path,
        body: bodyObj,
      });

      return {
        item: updatedLocalLead || { id: leadId, ...bodyObj },
        queued_offline: true,
      };
    }

    throw new Error('Operação indisponível no modo offline');
  }

  async function http(path, opts = {}) {
    const { _retriedAuth, ...fetchOpts } = opts;
    const method = String(fetchOpts.method || 'GET').toUpperCase();
    const parsedUrl = new URL(path, root.location?.origin || 'http://127.0.0.1');

    if (isNavigatorOffline()) {
      return handleOfflineFallback(path, method, parsedUrl, fetchOpts);
    }

    const headers = {
      'content-type': 'application/json',
      'x-access-key': getStorage('autonomia_access_key') || '',
      ...(fetchOpts.headers || {}),
    };

    try {
      const r = await fetch(path, { ...fetchOpts, headers });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401 && data.auth_required && !_retriedAuth) {
        const key = await requestAccessKeyPrompt();
        if (key) return http(path, { ...fetchOpts, _retriedAuth: true });
      }
      if (!r.ok) throw new Error(data.error || r.statusText);
      mirrorOnlineResponse(method, parsedUrl, data).catch(() => {});
      return data;
    } catch (err) {
      if (isNetworkFailure(err) || isNavigatorOffline()) {
        return handleOfflineFallback(path, method, parsedUrl, fetchOpts);
      }
      throw err;
    }
  }

  function openExternal(rawUrl) {
    const str = String(rawUrl || '').trim();
    if (!str) return false;
    try {
      const candidate = /^[a-z][a-z\d+.-]*:/i.test(str) ? str : `https://${str.replace(/^\/\//, '')}`;
      const u = new URL(candidate);
      if (!['http:', 'https:', 'tel:', 'mailto:'].includes(u.protocol)) return false;
      if (u.protocol === 'tel:' || u.protocol === 'mailto:') {
        root.open(u.href, '_self');
      } else {
        root.open(u.href, '_blank', 'noopener,noreferrer');
      }
      return true;
    } catch {
      return false;
    }
  }

  async function copyToClipboard(text) {
    const value = String(text ?? '');
    if (!value) return false;
    try {
      if (root.navigator?.clipboard?.writeText) {
        await root.navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Fallback para execCommand
    }
    if (typeof document === 'undefined') return false;
    const field = document.createElement('textarea');
    field.value = value;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    field.remove();
    return copied;
  }

  function downloadBlob(blobOrContent, filename = 'download.bin', mimeType = 'application/octet-stream') {
    if (typeof document === 'undefined') return;
    const blob = blobOrContent instanceof Blob
      ? blobOrContent
      : new Blob([blobOrContent], { type: mimeType });
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  }

  async function downloadAuthenticated(url, fallbackFilename = 'download.bin', _retriedAuth = false) {
    const parsedUrl = new URL(url, root.location?.origin || 'http://127.0.0.1');
    if (isNavigatorOffline() && isInternetOnlyPath('GET', parsedUrl.pathname)) {
      throw createOfflineBlockedError();
    }
    let r;
    try {
      r = await fetch(url, {
        headers: {
          'x-access-key': getStorage('autonomia_access_key') || '',
        },
      });
    } catch (err) {
      if (isInternetOnlyPath('GET', parsedUrl.pathname) && (isNetworkFailure(err) || isNavigatorOffline())) {
        throw createOfflineBlockedError();
      }
      throw err;
    }
    if (r.status === 401 && !_retriedAuth) {
      const data = await r.json().catch(() => ({}));
      if (data.auth_required) {
        const key = await requestAccessKeyPrompt();
        if (key) return downloadAuthenticated(url, fallbackFilename, true);
      }
      throw new Error(data.error || 'Não autorizado');
    }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || r.statusText || `HTTP ${r.status}`);
    }
    const cd = r.headers.get('content-disposition') || '';
    const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    const filename = match?.[1] ? decodeURIComponent(match[1].trim()) : fallbackFilename;
    const blob = await r.blob();
    downloadBlob(blob, filename);
    return filename;
  }

  root.RuntimeAdapter = {
    http,
    getStorage,
    setStorage,
    removeStorage,
    openExternal,
    copyToClipboard,
    downloadBlob,
    downloadAuthenticated,
    confirmDialog,
    promptDialog,
  };
})(typeof window !== 'undefined' ? window : globalThis);
