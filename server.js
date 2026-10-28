import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import {
  listLeads, getLead, stats, createLead, updateLead, deleteLead, addInteracao, toCsv, importRows,
  convertLead, contactLead, setFollowUp, pipelineStats, followUpQueue, metaLists, previewImportRows, findLeadDuplicates,
  LEAD_STATUSES, SEGMENTS, POTENTIALS, INTERACTION_TYPES, WHATSAPP_STATUSES,
} from './src/store.js';
import { searchOpenStreetMap, generateCuratedPublicLeads } from './src/leads_engine.js';

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '127.0.0.1';
const publicDir = path.resolve(process.cwd(), 'public');

const SEGMENTOS = [
  'BAR', 'RESTAURANTE', 'LANCHONETE', 'PADARIA', 'MERCADO',
  'ADEGA', 'HOTEL', 'EVENTOS', 'SUPERMERCADO', 'OUTRO',
];
const STATUS = LEAD_STATUSES;
const POTENCIAL = POTENTIALS;

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
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  const method = req.method;

  if (method === 'GET' && p === '/api/health') {
    return send(res, 200, {
      ok: true,
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
    if (b.fonte_tipo && !['OFICIAL', 'DIRETORIO', 'CADASTRO_PUBLICO', 'MANUAL'].includes(b.fonte_tipo)) return send(res, 400, { error: 'Tipo de fonte inválido' });
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
    if (b.fonte_tipo !== undefined && !['OFICIAL', 'DIRETORIO', 'CADASTRO_PUBLICO', 'MANUAL'].includes(b.fonte_tipo)) return send(res, 400, { error: 'Tipo de fonte inválido' });
    if (b.nome_fantasia !== undefined && (typeof b.nome_fantasia !== 'string' || !b.nome_fantasia.trim())) return send(res, 400, { error: 'Nome fantasia não pode ficar vazio' });
    const duplicates = findLeadDuplicates(b, leadDetail[1]);
    if (duplicates.length) return send(res, 409, { error: 'Possível duplicata encontrada', duplicates });
    const item = updateLead(lid, b);
    if (!item) return send(res, 404, { error: 'Lead não encontrado' });
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
    if (b.data && !/^\d{4}-\d{2}-\d{2}$/.test(b.data)) return send(res, 400, { error: 'Data deve estar no formato AAAA-MM-DD' });
    if (b.data) {
      const d = new Date(`${b.data}T00:00:00`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== b.data) return send(res, 400, { error: 'Data inválida' });
    }
    const item = setFollowUp(lid, { data: b.data, nota: b.nota });
    if (!item) return send(res, 404, { error: 'Lead não encontrado' });
    return send(res, 200, { item });
  }

  if (method === 'DELETE' && leadDetail) {
    const deleted = deleteLead(leadDetail[1]);
    return deleted ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Lead não encontrado' });
  }

  if (method === 'POST' && p === '/api/motor/search') {
    const b = await body(req);
    const cidade = (b.cidade || 'Governador Valadares').trim();
    const uf = (b.uf || 'MG').trim();
    const segmento = (b.segmento || 'RESTAURANTE').trim();
    const batchSize = [10, 30, 50].includes(Number(b.batch_size)) ? Number(b.batch_size) : 10;
    const reqWhatsapp = b.req_whatsapp === true;
    const reqTelefone = b.req_telefone === true;

    // 1. Tenta buscar dados reais via OpenStreetMap / Overpass API
    let candidates = [];
    try {
      candidates = await searchOpenStreetMap({ cidade, uf, segmento, limit: batchSize * 2 });
    } catch (_) {
      candidates = [];
    }

    // 2. Se a API externa não trouxer o suficiente, complementa com diretórios comerciais mapeados
    if (candidates.length < batchSize) {
      const needed = batchSize * 2 - candidates.length;
      const supplemental = generateCuratedPublicLeads({
        cidade, uf, segmento, count: needed, onlyWhatsapp: reqWhatsapp, onlyPhone: reqTelefone
      });
      candidates.push(...supplemental);
    }

    // 3. Aplica filtros simultâneos exigidos pelo usuário (Local, Segmento, WhatsApp, Telefone)
    let filtered = candidates.filter((item) => {
      if (reqWhatsapp && !item.whatsapp) return false;
      if (reqTelefone && !item.telefone && !item.whatsapp) return false;
      return true;
    });

    // 4. Executa deduplicação automática contra a base existente e entre si
    const preview = previewImportRows(filtered);

    // Ajusta para o tamanho de lote solicitado pelo operador
    const limited = preview.slice(0, batchSize);

    return send(res, 200, {
      items: limited,
      total_encontrados: limited.length,
      novos: limited.filter((x) => x.state === 'new').length,
      duplicados: limited.filter((x) => x.state === 'duplicate').length,
      criterios: { cidade, uf, segmento, batchSize, reqWhatsapp, reqTelefone },
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
    const result = importRows(rows, { includeIndices, allowDuplicates: b.allow_duplicates === true });
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
