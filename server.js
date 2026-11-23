import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import {
  listLeads, getLead, stats, createLead, updateLead, deleteLead, addInteracao, toCsv, importRows,
  convertLead, contactLead, registerFollowUpOutcome, pipelineStats, followUpQueue, metaLists, previewImportRows, findLeadDuplicates,
  compactNow, getStorageHealth,
  LEAD_STATUSES, SEGMENTS, POTENTIALS, INTERACTION_TYPES, WHATSAPP_STATUSES, SOURCE_TYPES, CLIENT_SIGNALS,
} from './src/store.js';
import { collectLeadFacts } from './src/classifier.js';
import { SEGMENTS_CATALOG } from './src/leads_engine.js';
import { listLenses, getLens, createLens, updateLens, deleteLens } from './src/lenses_store.js';
import { buildCalibratedLensProposal } from './src/empirical_calibrator.js';
import { computeTerritoryClusters, findLookalikeLeads } from './src/territory_engine.js';
import { summarizeMatrix } from './src/value_matrix.js';
import { ingestAndEnrichMapsBatch } from './src/autopilot_engine.js';
import { analyzeBaseHealth, executeCleanup } from './src/cleanup_engine.js';
import {
  createMission,
  getMission,
  getActiveMission,
  updateMissionProgress,
  recordMissionBatch,
  completeMission,
  stopMission,
} from './src/maps_mission.js';

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const APP_ACCESS_KEY = String(process.env.APP_ACCESS_KEY || '').trim();
const publicDir = path.resolve(process.cwd(), 'public');
const sharedFiles = {
  '/shared/hygiene.js': path.resolve(process.cwd(), 'src', 'hygiene.js'),
  '/shared/scoring_modes.js': path.resolve(process.cwd(), 'src', 'scoring_modes.js'),
  '/shared/copy_engine.js': path.resolve(process.cwd(), 'src', 'copy_engine.js'),
  '/shared/cadence_engine.js': path.resolve(process.cwd(), 'src', 'cadence_engine.js'),
  '/shared/relationship_analytics.js': path.resolve(process.cwd(), 'src', 'relationship_analytics.js'),
  '/shared/empirical_calibrator.js': path.resolve(process.cwd(), 'src', 'empirical_calibrator.js'),
  '/shared/territory_engine.js': path.resolve(process.cwd(), 'src', 'territory_engine.js'),
  '/shared/value_matrix.js': path.resolve(process.cwd(), 'src', 'value_matrix.js'),
};

const SEGMENTOS = SEGMENTS;
const STATUS = LEAD_STATUSES;
const POTENCIAL = POTENTIALS;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin) || /^chrome-extension:\/\/[a-z0-9_-]+$/i.test(origin);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, x-access-key');
  }
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(data));
}

function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (c) => {
      if (bytes > 1024 * 1024) return;
      bytes += c.length;
      if (bytes > 1024 * 1024) {
        reject(Object.assign(new Error('Corpo da requisição excede 1 MB'), { status: 413 }));
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (bytes > 1024 * 1024) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname in sharedFiles) {
    const sharedPath = sharedFiles[pathname];
    if (!fs.existsSync(sharedPath)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(sharedPath).pipe(res);
  }

  let file;
  try { file = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const full = path.resolve(publicDir, `.${file}`);
  if (!(full === publicDir || full.startsWith(publicDir + path.sep)) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const ext = path.extname(full);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png' };
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(full).pipe(res);
}

async function route(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const u = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const p = u.pathname;
  const method = req.method;

  if (method === 'GET' && p === '/api/auth/status') {
    return send(res, 200, { protected: Boolean(APP_ACCESS_KEY) });
  }

  if (APP_ACCESS_KEY && p.startsWith('/api/') && !(method === 'GET' && (p === '/api/health' || p === '/api/auth/status'))) {
    const providedKey = String(req.headers['x-access-key'] || u.searchParams.get('key') || '').trim();
    if (providedKey !== APP_ACCESS_KEY) {
      return send(res, 401, { error: 'Chave de acesso inválida ou ausente', auth_required: true });
    }
  }

  if (method === 'GET' && p === '/api/auth/verify') {
    return send(res, 200, { ok: true, auth_valid: true, protected: Boolean(APP_ACCESS_KEY) });
  }

  if (method === 'GET' && p === '/api/health') {
    return send(res, 200, {
      ok: true,
      service: 'autonomia-caca-leads',
      leads_count: stats().total,
      app: 'autonomia-systems-caca-leads',
      version: '2.0.0',
      storage: 'json',
      empresa: 'AutonomIA Systems',
      ramo: 'Sistemas Inteligentes & Automação B2B',
      territorio: 'Brasil / Minas Gerais',
    });
  }

  if (method === 'GET' && p === '/api/meta') {
    return send(res, 200, {
      segmentos: SEGMENTOS,
      status: STATUS,
      potencial: POTENCIAL,
      whatsapp_status: WHATSAPP_STATUSES,
      ...metaLists(),
      empresa: {
        nome: 'AutonomIA Systems',
        ramo: 'Sistemas Inteligentes, Agentes Digitais e Automação de Processos',
        slogan: 'Seu 1º Funcionário Digital',
        operadores: ['Rafael Oliveira', 'Sara Rosseto'],
      },
      territorio: {
        cidade_base: 'Governador Valadares',
        uf: 'MG',
        raio_km: 30,
        empresa_referencia: 'AutonomIA Systems',
        referencia_publica: 'Rua Afonso Pena, Centro — CNPJ 05.652.750/0001-61',
        cidades_raio: [
          { cidade: 'Governador Valadares', km: 0 },
          { cidade: 'Alpercata', km: 18 },
          { cidade: 'Capitão Andrade', km: 26 },
          { cidade: 'Mathias Lobato', km: 31 },
          { cidade: 'Frei Inocêncio', km: 32 },
          { cidade: 'Tumiritinga', km: 35 },
          { cidade: 'São Geraldo da Piedade', km: 36 },
          { cidade: 'Fernandes Tourinho', km: 36 },
          { cidade: 'Itanhomi', km: 37 },
          { cidade: 'Engenheiro Caldas', km: 40 },
          { cidade: 'Marilac', km: 41 },
          { cidade: 'Sobrália', km: 45 },
          { cidade: 'Periquito', km: 46 },
          { cidade: 'Jampruca', km: 46 },
        ],
      },
    });
  }

  if (method === 'GET' && p === '/api/stats') return send(res, 200, { ...stats(), pipeline: pipelineStats() });

  if (method === 'GET' && p === '/api/pipeline') return send(res, 200, pipelineStats());

  if (method === 'GET' && p === '/api/followups') return send(res, 200, { items: followUpQueue(u.searchParams.get('period') || 'all') });

  // CRUD de Lentes Customizadas
  if (method === 'GET' && p === '/api/lenses') {
    return send(res, 200, { items: listLenses() });
  }

  if (method === 'POST' && p === '/api/lenses') {
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Envie os dados da lente em um objeto JSON' });
    const item = createLens(b);
    return send(res, 201, { item });
  }

  const lensDetail = p.match(/^\/api\/lenses\/([^/]+)$/);
  if (method === 'PUT' && lensDetail) {
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Envie os dados da lente em um objeto JSON' });
    const item = updateLens(lensDetail[1], b);
    if (!item) return send(res, 404, { error: 'Lente não encontrada' });
    return send(res, 200, { item });
  }

  if (method === 'DELETE' && lensDetail) {
    const ok = deleteLens(lensDetail[1]);
    return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Lente não encontrada' });
  }

  // Inteligência Empírica & Territorial
  if (method === 'GET' && p === '/api/intelligence/calibration') {
    const baseParam = u.searchParams.get('base') || 'equilibrado';
    const baseLens = getLens(baseParam) || baseParam;
    const result = buildCalibratedLensProposal(listLeads(), baseLens);
    return send(res, 200, result);
  }

  if (method === 'GET' && p === '/api/intelligence/territory') {
    const modeParam = u.searchParams.get('mode') || 'equilibrado';
    const minLeads = Math.max(1, Number(u.searchParams.get('min_leads') || 2) || 2);
    const modeOrLens = getLens(modeParam) || modeParam;
    const result = computeTerritoryClusters(listLeads(), { modeOrLens, minLeads });
    return send(res, 200, result);
  }

  if (method === 'GET' && p === '/api/intelligence/matrix') {
    return send(res, 200, summarizeMatrix(listLeads()));
  }

  if (method === 'GET' && p === '/api/system/health-deep') {
    const mem = process.memoryUsage();
    const { storage_stats, index_stats } = getStorageHealth();
    return send(res, 200, {
      ok: true,
      leads_count: stats().total,
      memory_rss_mb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
      memory_heap_mb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
      ram_budget_mb: 512,
      storage_stats,
      index_stats,
      uptime_sec: Math.round(process.uptime()),
    });
  }

  if (method === 'POST' && p === '/api/system/compact') {
    const storage_stats = await compactNow();
    return send(res, 200, { ok: true, storage_stats });
  }

  if (method === 'GET' && p === '/api/system/backup') {
    await compactNow();
    const d = new Date();
    const dateTag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const payload = JSON.stringify(listLeads(), null, 2);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="autonomia-leads-backup-${dateTag}.json"`,
      'cache-control': 'no-store',
    });
    return res.end(payload);
  }

  if (method === 'GET' && p === '/api/system/cleanup/preview') {
    return send(res, 200, analyzeBaseHealth(listLeads()));
  }

  if (method === 'POST' && p === '/api/system/cleanup/execute') {
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return send(res, 400, { error: 'Envie { mode, confirm: true } em um objeto JSON' });
    }
    const result = await executeCleanup({ mode: b.mode, confirm: b.confirm === true });
    return send(res, 200, result);
  }

  if (method === 'GET' && p.match(/^\/api\/leads\/[^/]+\/lookalike$/)) {
    const lid = p.split('/')[3];
    const refLead = getLead(lid);
    if (!refLead) return send(res, 404, { error: 'Lead de referência não encontrado' });
    const limit = Math.max(1, Math.min(100, Number(u.searchParams.get('limit') || 25) || 25));
    const modeParam = u.searchParams.get('mode') || 'equilibrado';
    const modeOrLens = getLens(modeParam) || modeParam;
    const items = findLookalikeLeads(refLead, listLeads(), { limit, modeOrLens, excludeContacted: true });
    return send(res, 200, { reference: refLead, items });
  }

  if (method === 'GET' && p === '/api/leads') {
    return send(res, 200, {
      items: listLeads({
        q: u.searchParams.get('q') || '',
        status: u.searchParams.get('status') || '',
        segmento: u.searchParams.get('segmento') || '',
        cidade: u.searchParams.get('cidade') || '',
        whatsapp: u.searchParams.get('whatsapp') || '',
        verificacao: u.searchParams.get('verificacao') || '',
        fonte: u.searchParams.get('fonte') || '',
        origem: u.searchParams.get('origem') || '',
        dor: u.searchParams.get('dor') || '',
        lote: u.searchParams.get('lote') || '',
        sort: u.searchParams.get('sort') || '',
        followup: u.searchParams.get('followup') || '',
      }),
    });
  }

  const leadDetail = p.match(/^\/api\/leads\/([^/]+)$/);
  if (method === 'GET' && leadDetail) {
    const lid = leadDetail[1];
    const item = getLead(lid);
    if (!item) return send(res, 404, { error: 'Lead não encontrado' });
    return send(res, 200, { item, interacoes: item.interacoes || [] });
  }

  if (method === 'POST' && p === '/api/leads') {
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Envie os dados do lead em um objeto JSON' });
    if (typeof b.nome_fantasia !== 'string' || !b.nome_fantasia.trim()) return send(res, 400, { error: 'Nome fantasia é obrigatório' });
    if (b.nome_fantasia.trim().length > 160) return send(res, 400, { error: 'Nome fantasia deve ter até 160 caracteres' });
    if (b.segmento && !SEGMENTOS.includes(b.segmento)) return send(res, 400, { error: 'Segmento inválido' });
    if (b.status && !STATUS.includes(b.status)) return send(res, 400, { error: 'Status inválido' });
    if (b.potencial && !POTENCIAL.includes(b.potencial)) return send(res, 400, { error: 'Potencial inválido' });
    if (b.whatsapp_status && !WHATSAPP_STATUSES.includes(b.whatsapp_status)) return send(res, 400, { error: 'Estado de WhatsApp inválido' });
    if (b.fonte_tipo && !SOURCE_TYPES.includes(b.fonte_tipo)) return send(res, 400, { error: 'Tipo de fonte inválido' });
    const duplicates = findLeadDuplicates(b);
    if (duplicates.length) return send(res, 409, { error: 'Possível duplicata encontrada', duplicates });
    return send(res, 201, { item: createLead(b) });
  }

  if (method === 'PUT' && leadDetail) {
    const lid = leadDetail[1];
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Envie os campos do lead em um objeto JSON' });
    if (b.status !== undefined && !STATUS.includes(b.status)) return send(res, 400, { error: 'Status inválido' });
    if (b.segmento !== undefined && !SEGMENTOS.includes(b.segmento)) return send(res, 400, { error: 'Segmento inválido' });
    if (b.potencial !== undefined && !POTENCIAL.includes(b.potencial)) return send(res, 400, { error: 'Potencial inválido' });
    if (b.whatsapp_status !== undefined && b.whatsapp_status !== '' && !WHATSAPP_STATUSES.includes(b.whatsapp_status)) return send(res, 400, { error: 'Estado de WhatsApp inválido' });
    if (b.fonte_tipo !== undefined && !SOURCE_TYPES.includes(b.fonte_tipo)) return send(res, 400, { error: 'Tipo de fonte inválido' });
    if (b.nome_fantasia !== undefined && (typeof b.nome_fantasia !== 'string' || !b.nome_fantasia.trim())) return send(res, 400, { error: 'Nome fantasia não pode ficar vazio' });
    const existing = getLead(lid);
    if (!existing) return send(res, 404, { error: 'Lead não encontrado' });
    const duplicates = findLeadDuplicates({ ...existing, ...b }, lid);
    if (duplicates.length) return send(res, 409, { error: 'Possível duplicata encontrada', duplicates });
    const item = updateLead(lid, b);
    if (!item) return send(res, 404, { error: 'Lead não encontrado' });
    return send(res, 200, { item });
  }

  if (method === 'POST' && p === '/api/leads/diagnose-batch') {
    const b = await body(req);
    const ids = Array.isArray(b?.ids) ? b.ids.filter((x) => typeof x === 'string' && x.trim()) : [];
    if (!ids.length) return send(res, 400, { error: 'Envie { ids: [...] } com até 20 leads para diagnosticar' });
    if (ids.length > 20) return send(res, 400, { error: 'Diagnóstico em lote limitado a 20 leads por vez' });

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
    return send(res, 200, { diagnosed: updatedItems.length, items: updatedItems });
  }

  if (method === 'POST' && p.match(/^\/api\/leads\/[^/]+\/diagnose$/)) {
    const lid = p.split('/')[3];
    const lead = getLead(lid);
    if (!lead) return send(res, 404, { error: 'Lead não encontrado' });
    const patch = await collectLeadFacts(lead);
    const item = updateLead(lid, patch);
    return send(res, 200, { item });
  }

  if (method === 'POST' && p.match(/^\/api\/leads\/[^/]+\/interacoes$/)) {
    const lid = p.split('/')[3];
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Envie a interação em um objeto JSON' });
    if (!b.resumo?.trim()) return send(res, 400, { error: 'Resumo obrigatório' });
    if (b.tipo && !INTERACTION_TYPES.includes(b.tipo)) return send(res, 400, { error: 'Tipo de interação inválido' });
    const ix = addInteracao(lid, b.tipo || 'NOTA', String(b.resumo).trim());
    if (!ix) return send(res, 404, { error: 'Lead não encontrado' });
    return send(res, 201, { item: ix });
  }

  if (method === 'POST' && p.match(/^\/api\/leads\/[^/]+\/converter$/)) {
    const lid = p.split('/')[3];
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Envie os dados de conversão em um objeto JSON' });
    const item = convertLead(lid, { resumo: b.resumo, pedido_inicial: b.pedido_inicial });
    if (!item) return send(res, 404, { error: 'Lead não encontrado' });
    return send(res, 200, { item, mensagem: 'Lead convertido em CLIENTE' });
  }

  if (method === 'POST' && p.match(/^\/api\/leads\/[^/]+\/contato$/)) {
    const lid = p.split('/')[3];
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Envie os dados de contato em um objeto JSON' });
    if (b.canal && !['telefone', 'ligacao', 'whatsapp', 'email'].includes(b.canal)) return send(res, 400, { error: 'Canal de contato inválido' });
    const item = contactLead(lid, { canal: b.canal || 'telefone', resumo: b.resumo, avancar: b.avancar !== false });
    if (!item) return send(res, 404, { error: 'Lead não encontrado' });
    return send(res, 200, { item });
  }

  if (method === 'POST' && p.match(/^\/api\/leads\/[^/]+\/followup$/)) {
    const lid = p.split('/')[3];
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(res, 400, { error: 'Envie os dados de follow-up em um objeto JSON' });

    for (const dateField of ['data', 'proximo_contato', 'hibernar_ate']) {
      const val = b[dateField];
      if (!val) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return send(res, 400, { error: `${dateField} deve estar no formato AAAA-MM-DD` });
      const d = new Date(`${val}T12:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== val) return send(res, 400, { error: `${dateField} inválida` });
    }
    if (b.sinal !== undefined && b.sinal !== null && b.sinal !== '' && !CLIENT_SIGNALS.includes(b.sinal)) {
      return send(res, 400, { error: 'Sinal de cliente inválido' });
    }
    if (b.tipo && !INTERACTION_TYPES.includes(b.tipo)) {
      return send(res, 400, { error: 'Tipo de interação inválido' });
    }
    if (b.status && !STATUS.includes(b.status)) {
      return send(res, 400, { error: 'Status inválido' });
    }

    const item = registerFollowUpOutcome(lid, b);
    if (!item) return send(res, 404, { error: 'Lead não encontrado' });
    return send(res, 200, { item });
  }

  if (method === 'DELETE' && leadDetail) {
    const deleted = deleteLead(leadDetail[1]);
    return deleted ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Lead não encontrado' });
  }

  if (method === 'GET' && p === '/api/maps/segments') {
    return send(res, 200, { items: SEGMENTS_CATALOG });
  }

  if (method === 'POST' && p === '/api/maps/mission') {
    const b = await body(req);
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return send(res, 400, { error: 'Envie os parâmetros da missão em um objeto JSON' });
    }
    const modeParam = b.mode || 'equilibrado';
    const modeOrLens = getLens(modeParam) || modeParam;
    const mission = createMission({
      cidade: b.cidade || 'Governador Valadares',
      uf: b.uf || 'MG',
      segmento: b.segmento || 'RESTAURANTE',
      customQuery: b.custom_query || b.customQuery || '',
      autoDiagnose: b.auto_diagnose !== false,
      modeOrLens,
    });
    return send(res, 201, { ok: true, mission, start_url: mission.maps_url });
  }

  if (method === 'GET' && p === '/api/maps/mission/active') {
    return send(res, 200, { ok: true, mission: getActiveMission() });
  }

  const missionProgressMatch = p.match(/^\/api\/maps\/mission\/([^/]+)\/progress$/);
  if (method === 'POST' && missionProgressMatch) {
    const b = await body(req);
    const mission = updateMissionProgress(missionProgressMatch[1], b || {});
    if (!mission) return send(res, 404, { error: 'Missão não encontrada' });
    return send(res, 200, { ok: true, mission });
  }

  const missionCompleteMatch = p.match(/^\/api\/maps\/mission\/([^/]+)\/complete$/);
  if (method === 'POST' && missionCompleteMatch) {
    const b = await body(req);
    const mission = completeMission(missionCompleteMatch[1], b || {});
    if (!mission) return send(res, 404, { error: 'Missão não encontrada' });
    return send(res, 200, { ok: true, mission });
  }

  const missionStopMatch = p.match(/^\/api\/maps\/mission\/([^/]+)\/stop$/);
  if (method === 'POST' && missionStopMatch) {
    const b = await body(req);
    const mission = stopMission(missionStopMatch[1], b?.reason || 'Parado pelo operador');
    if (!mission) return send(res, 404, { error: 'Missão não encontrada' });
    return send(res, 200, { ok: true, mission });
  }

  if (method === 'POST' && p === '/api/ingest/maps') {
    const b = await body(req);
    const rawLeads = Array.isArray(b) ? b : (b.leads || b.items || []);
    if (!Array.isArray(rawLeads) || !rawLeads.length) {
      return send(res, 400, { error: 'Envie { leads: [...] } com os estabelecimentos capturados' });
    }
    if (rawLeads.length > 5000) {
      return send(res, 413, { error: 'Ingestão limitada a 5.000 registros por lote' });
    }

    const mission = !Array.isArray(b) && b.mission_id ? getMission(b.mission_id) : null;
    const autoDiagnose = Array.isArray(b)
      ? true
      : (b.auto_diagnose !== undefined ? b.auto_diagnose !== false : (mission ? mission.auto_diagnose : true));
    const modeOrLens = mission ? mission.mode_or_lens : (getLens(b.mode) || b.mode || 'equilibrado');

    const result = await ingestAndEnrichMapsBatch(rawLeads, {
      autoDiagnose,
      modeOrLens,
      loteOrigem: mission?.lote_origem || b.lote_origem || null,
      defaultSegment: mission?.segmento || b.segmento || null,
      diagnoseLimit: 25,
      concurrency: 3,
    });

    if (mission) {
      recordMissionBatch(mission.id, result, b.progress || {});
    }

    return send(res, 201, {
      ...result,
      mission: mission ? getMission(mission.id) : null,
    });
  }

  if (method === 'POST' && p === '/api/import/preview') {
    const b = await body(req);
    const rows = Array.isArray(b) ? b : (b.items || b.rows || []);
    if (!Array.isArray(rows) || !rows.length) return send(res, 400, { error: 'Envie { items: [...] } com registros para prévia' });
    if (rows.length > 5000) return send(res, 413, { error: 'Importação limitada a 5.000 registros por vez' });
    const preview = previewImportRows(rows);
    return send(res, 200, { items: preview, total: preview.length, novos: preview.filter((x) => x.state === 'new').length, duplicados: preview.filter((x) => x.state === 'duplicate').length, invalidos: preview.filter((x) => x.state === 'invalid').length });
  }

  if (method === 'POST' && p === '/api/import') {
    const b = await body(req);
    if (!b || typeof b !== 'object') return send(res, 400, { error: 'Envie um objeto JSON ou array de registros' });
    const rows = Array.isArray(b) ? b : (b.items || b.rows || []);
    if (!Array.isArray(rows) || !rows.length) return send(res, 400, { error: 'Envie { items: [...] } com nome_fantasia e segmento' });
    if (rows.length > 5000) return send(res, 413, { error: 'Importação limitada a 5.000 registros por vez' });
    const includeIndices = Array.isArray(b.include_indices) ? b.include_indices.filter((x) => Number.isInteger(x) && x >= 0 && x < rows.length) : undefined;
    const result = importRows(rows, { includeIndices, allowDuplicates: b.allow_duplicates === true, batchPrefix: b.batch_prefix || null });
    return send(res, 201, result);
  }

  if (method === 'GET' && p === '/api/export.csv') {
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="autonomia-systems-caca-leads.csv"',
    });
    return res.end(toCsv());
  }

  if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, p);
  return send(res, 404, { error: 'Rota não encontrada' });
}

const server = http.createServer((req, res) => {
  applyCors(req, res);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  Promise.resolve(route(req, res)).catch((e) => {
    if (!e.status || e.status >= 500) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Erro interno' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`AutonomIA Systems — Caça Leads ativo em http://${HOST}:${PORT}`);
  console.log('Operação: Sistemas Inteligentes, Agentes Digitais & Prospecção B2B');
});
