import {
  listLeads, getLead, stats, createLead, updateLead, deleteLead, addInteracao, toCsv, importRows,
  convertLead, contactLead, registerFollowUpOutcome, pipelineStats, followUpQueue, previewImportRows, findLeadDuplicates,
  LEAD_STATUSES, SEGMENTS, POTENTIALS, INTERACTION_TYPES, WHATSAPP_STATUSES, SOURCE_TYPES, CLIENT_SIGNALS,
} from '../store.js';
import { collectLeadFacts } from '../classifier.js';
import { getLens } from '../lenses_store.js';
import { findLookalikeLeads } from '../territory_engine.js';
import { isValidIsoDate } from '../domain_signals.js';
import { eventHooks, EVENT_NAMES } from '../ports/event_hooks.js';

function toLeadSummary(lead) {
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

export function registerLeadsRoutes(router) {
  router.add('GET', '/api/stats', ({ send }) => send(200, { ...stats(), pipeline: pipelineStats() }));

  router.add('GET', '/api/pipeline', ({ send }) => send(200, pipelineStats()));

  router.add('GET', '/api/followups', ({ url, send }) => {
    return send(200, { items: followUpQueue(url.searchParams.get('period') || 'all') });
  });

  router.add('GET', '/api/leads', ({ url, send }) => {
    const rows = listLeads({
      q: url.searchParams.get('q') || '',
      status: url.searchParams.get('status') || '',
      segmento: url.searchParams.get('segmento') || '',
      cidade: url.searchParams.get('cidade') || '',
      whatsapp: url.searchParams.get('whatsapp') || '',
      verificacao: url.searchParams.get('verificacao') || '',
      fonte: url.searchParams.get('fonte') || '',
      origem: url.searchParams.get('origem') || '',
      dor: url.searchParams.get('dor') || '',
      lote: url.searchParams.get('lote') || '',
      sort: url.searchParams.get('sort') || '',
      followup: url.searchParams.get('followup') || '',
    });
    const isSummary = url.searchParams.get('view') === 'summary';
    return send(200, { items: isSummary ? rows.map(toLeadSummary) : rows });
  });

  router.add('GET', '/api/leads/:id/lookalike', ({ params, url, send }) => {
    const refLead = getLead(params.id);
    if (!refLead) return send(404, { error: 'Lead de referência não encontrado' });
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 25) || 25));
    const modeParam = url.searchParams.get('mode') || 'equilibrado';
    const modeOrLens = getLens(modeParam) || modeParam;
    const items = findLookalikeLeads(refLead, listLeads(), { limit, modeOrLens, excludeContacted: true });
    return send(200, { reference: refLead, items });
  });

  router.add('GET', '/api/leads/:id', ({ params, send }) => {
    const item = getLead(params.id);
    if (!item) return send(404, { error: 'Lead não encontrado' });
    return send(200, { item, interacoes: item.interacoes || [] });
  });

  router.add('POST', '/api/leads', async ({ readBody, send, req }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(400, { error: 'Envie os dados do lead em um objeto JSON' });
    if (typeof b.nome_fantasia !== 'string' || !b.nome_fantasia.trim()) return send(400, { error: 'Nome fantasia é obrigatório' });
    if (b.nome_fantasia.trim().length > 160) return send(400, { error: 'Nome fantasia deve ter até 160 caracteres' });
    if (b.segmento && !SEGMENTS.includes(b.segmento)) return send(400, { error: 'Segmento inválido' });
    if (b.status && !LEAD_STATUSES.includes(b.status)) return send(400, { error: 'Status inválido' });
    if (b.potencial && !POTENTIALS.includes(b.potencial)) return send(400, { error: 'Potencial inválido' });
    if (b.whatsapp_status && !WHATSAPP_STATUSES.includes(b.whatsapp_status)) return send(400, { error: 'Estado de WhatsApp inválido' });
    if (b.fonte_tipo && !SOURCE_TYPES.includes(b.fonte_tipo)) return send(400, { error: 'Tipo de fonte inválido' });
    const duplicates = findLeadDuplicates(b);
    if (duplicates.length) return send(409, { error: 'Possível duplicata encontrada', duplicates });
    const item = createLead(b);
    eventHooks.emit(
      EVENT_NAMES.LEAD_CAPTURED,
      { source: 'manual', lead_id: item.id, lead: item },
      { idempotency_key: req.headers['idempotency-key'] }
    );
    return send(201, { item });
  });

  router.add('PUT', '/api/leads/:id', async ({ params, readBody, send }) => {
    const lid = params.id;
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(400, { error: 'Envie os campos do lead em um objeto JSON' });
    if (b.status !== undefined && !LEAD_STATUSES.includes(b.status)) return send(400, { error: 'Status inválido' });
    if (b.segmento !== undefined && !SEGMENTS.includes(b.segmento)) return send(400, { error: 'Segmento inválido' });
    if (b.potencial !== undefined && !POTENTIALS.includes(b.potencial)) return send(400, { error: 'Potencial inválido' });
    if (b.whatsapp_status !== undefined && b.whatsapp_status !== '' && !WHATSAPP_STATUSES.includes(b.whatsapp_status)) {
      return send(400, { error: 'Estado de WhatsApp inválido' });
    }
    if (b.fonte_tipo !== undefined && !SOURCE_TYPES.includes(b.fonte_tipo)) return send(400, { error: 'Tipo de fonte inválido' });
    if (b.nome_fantasia !== undefined && (typeof b.nome_fantasia !== 'string' || !b.nome_fantasia.trim())) {
      return send(400, { error: 'Nome fantasia não pode ficar vazio' });
    }
    const existing = getLead(lid);
    if (!existing) return send(404, { error: 'Lead não encontrado' });
    const duplicates = findLeadDuplicates({ ...existing, ...b }, lid);
    if (duplicates.length) return send(409, { error: 'Possível duplicata encontrada', duplicates });
    const item = updateLead(lid, b);
    if (!item) return send(404, { error: 'Lead não encontrado' });
    return send(200, { item });
  });

  router.add('DELETE', '/api/leads/:id', ({ params, send }) => {
    const deleted = deleteLead(params.id);
    return deleted ? send(200, { ok: true }) : send(404, { error: 'Lead não encontrado' });
  });

  router.add('POST', '/api/leads/diagnose-batch', async ({ readBody, send }) => {
    const b = await readBody();
    const ids = Array.isArray(b?.ids) ? b.ids.filter((x) => typeof x === 'string' && x.trim()) : [];
    if (!ids.length) return send(400, { error: 'Envie { ids: [...] } com até 20 leads para diagnosticar' });
    if (ids.length > 20) return send(400, { error: 'Diagnóstico em lote limitado a 20 leads por vez' });

    const targets = ids.map((lid) => getLead(lid)).filter(Boolean);
    const updatedItems = [];
    const concurrency = 3;
    let cursor = 0;

    async function worker() {
      while (cursor < targets.length) {
        const idx = cursor++;
        const lead = targets[idx];
        const patch = await collectLeadFacts(lead);
        const updated = updateLead(lead.id, patch);
        if (updated) updatedItems.push(updated);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
    eventHooks.emit(EVENT_NAMES.LEAD_DIAGNOSED, {
      batch: true,
      diagnosed: updatedItems.length,
      ids: updatedItems.map((x) => x.id),
    });
    return send(200, { diagnosed: updatedItems.length, items: updatedItems });
  });

  router.add('POST', '/api/leads/:id/diagnose', async ({ params, send }) => {
    const lead = getLead(params.id);
    if (!lead) return send(404, { error: 'Lead não encontrado' });
    const patch = await collectLeadFacts(lead);
    const item = updateLead(params.id, patch);
    eventHooks.emit(EVENT_NAMES.LEAD_DIAGNOSED, { batch: false, lead_id: params.id, lead: item });
    return send(200, { item });
  });

  router.add('POST', '/api/leads/:id/interacoes', async ({ params, readBody, send }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(400, { error: 'Envie a interação em um objeto JSON' });
    if (!b.resumo?.trim()) return send(400, { error: 'Resumo obrigatório' });
    if (b.tipo && !INTERACTION_TYPES.includes(b.tipo)) return send(400, { error: 'Tipo de interação inválido' });
    const ix = addInteracao(params.id, b.tipo || 'NOTA', String(b.resumo).trim());
    if (!ix) return send(404, { error: 'Lead não encontrado' });
    return send(201, { item: ix });
  }, { idempotent: true });

  router.add('POST', '/api/leads/:id/converter', async ({ params, readBody, send }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(400, { error: 'Envie os dados de conversão em um objeto JSON' });
    const item = convertLead(params.id, { resumo: b.resumo, pedido_inicial: b.pedido_inicial });
    if (!item) return send(404, { error: 'Lead não encontrado' });
    eventHooks.emit(EVENT_NAMES.LEAD_CONVERTED, { lead_id: params.id, pedido_inicial: b.pedido_inicial || null, lead: item });
    return send(200, { item, mensagem: 'Lead convertido em CLIENTE' });
  });

  router.add('POST', '/api/leads/:id/contato', async ({ params, readBody, send, req }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(400, { error: 'Envie os dados de contato em um objeto JSON' });
    if (b.canal && !['telefone', 'ligacao', 'whatsapp', 'email'].includes(b.canal)) return send(400, { error: 'Canal de contato inválido' });
    const canal = b.canal || 'telefone';
    const item = contactLead(params.id, { canal, resumo: b.resumo, avancar: b.avancar !== false });
    if (!item) return send(404, { error: 'Lead não encontrado' });
    eventHooks.emit(
      EVENT_NAMES.LEAD_CONTACTED,
      { lead_id: params.id, canal, lead: item },
      { idempotency_key: req.headers['idempotency-key'] }
    );
    return send(200, { item });
  }, { idempotent: true });

  router.add('POST', '/api/leads/:id/followup', async ({ params, readBody, send, req }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(400, { error: 'Envie os dados de follow-up em um objeto JSON' });

    for (const dateField of ['data', 'proximo_contato', 'hibernar_ate']) {
      const val = b[dateField];
      if (!val) continue;
      if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        return send(400, { error: `${dateField} deve estar no formato AAAA-MM-DD` });
      }
      if (!isValidIsoDate(val)) return send(400, { error: `${dateField} inválida` });
    }
    if (b.sinal !== undefined && b.sinal !== null && b.sinal !== '' && !CLIENT_SIGNALS.includes(b.sinal)) {
      return send(400, { error: 'Sinal de cliente inválido' });
    }
    if (b.tipo && !INTERACTION_TYPES.includes(b.tipo)) return send(400, { error: 'Tipo de interação inválido' });
    if (b.status && !LEAD_STATUSES.includes(b.status)) return send(400, { error: 'Status inválido' });

    const item = registerFollowUpOutcome(params.id, b);
    if (!item) return send(404, { error: 'Lead não encontrado' });

    const idempKey = req.headers['idempotency-key'];
    if (b.sinal) {
      eventHooks.emit(
        EVENT_NAMES.LEAD_SIGNAL_RECORDED,
        { lead_id: params.id, sinal: b.sinal, lead: item },
        { idempotency_key: idempKey }
      );
    }
    if (b.proximo_contato || b.data) {
      eventHooks.emit(
        EVENT_NAMES.LEAD_FOLLOWUP_SCHEDULED,
        { lead_id: params.id, proximo_contato: item.proximo_contato, lead: item },
        { idempotency_key: idempKey }
      );
    }
    return send(200, { item });
  }, { idempotent: true });

  router.add('POST', '/api/import/preview', async ({ readBody, send }) => {
    const b = await readBody();
    const rows = Array.isArray(b) ? b : (b.items || b.rows || []);
    if (!Array.isArray(rows) || !rows.length) return send(400, { error: 'Envie { items: [...] } com registros para prévia' });
    if (rows.length > 5000) return send(413, { error: 'Importação limitada a 5.000 registros por vez' });
    const preview = previewImportRows(rows);
    return send(200, {
      items: preview,
      total: preview.length,
      novos: preview.filter((x) => x.state === 'new').length,
      duplicados: preview.filter((x) => x.state === 'duplicate').length,
      invalidos: preview.filter((x) => x.state === 'invalid').length,
    });
  });

  router.add('POST', '/api/import', async ({ readBody, send, req }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object') return send(400, { error: 'Envie um objeto JSON ou array de registros' });
    const rows = Array.isArray(b) ? b : (b.items || b.rows || []);
    if (!Array.isArray(rows) || !rows.length) return send(400, { error: 'Envie { items: [...] } com nome_fantasia e segmento' });
    if (rows.length > 5000) return send(413, { error: 'Importação limitada a 5.000 registros por vez' });
    const includeIndices = Array.isArray(b.include_indices)
      ? b.include_indices.filter((x) => Number.isInteger(x) && x >= 0 && x < rows.length)
      : undefined;
    const result = importRows(rows, { includeIndices, allowDuplicates: b.allow_duplicates === true, batchPrefix: b.batch_prefix || null });
    eventHooks.emit(
      EVENT_NAMES.LEAD_CAPTURED,
      { source: 'import', added: result.added, updated: result.updated, total: result.total },
      { idempotency_key: req.headers['idempotency-key'] }
    );
    return send(201, result);
  });

  router.add('GET', '/api/export.csv', ({ res }) => {
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="autonomia-systems-caca-leads.csv"',
    });
    return res.end(toCsv());
  });
}
