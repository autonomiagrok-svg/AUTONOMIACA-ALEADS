import path from 'node:path';
import crypto from 'node:crypto';
import { normalizePhone, normalizeDomain } from './hygiene.js';
import { sanitizePainTags } from './scoring_modes.js';
import { WalJsonAdapter } from './storage/wal_adapter.js';
import {
  LeadIndex,
  normalizedText,
  normalizeSourceUrl,
  validCnpjKey,
  extractPhoneKeys,
} from './storage/lead_index.js';

let storeFile = process.env.LEADS_FILE
  ? path.resolve(process.env.LEADS_FILE)
  : path.join(process.cwd(), 'data', 'leads.json');

let adapter = new WalJsonAdapter(storeFile);
let leadIndex = new LeadIndex();
let cache = null;

export const LEAD_STATUSES = ['NOVO', 'QUALIFICADO', 'CONTATADO', 'VISITA', 'PROPOSTA', 'CLIENTE', 'DESCARTADO'];
export const SEGMENTS = [
  'BAR', 'RESTAURANTE', 'LANCHONETE', 'PADARIA', 'MERCADO', 'ADEGA', 'HOTEL', 'EVENTOS', 'SUPERMERCADO',
  'CLINICA', 'ACADEMIA', 'OFICINA', 'FARMACIA', 'SALAO', 'PETSHOP', 'IMOBILIARIA', 'ESCRITORIO', 'LOJA', 'OUTRO',
];
export const POTENTIALS = ['ALTO', 'MEDIO', 'BAIXO'];
export const INTERACTION_TYPES = ['NOTA', 'LIGACAO', 'WHATSAPP', 'VISITA', 'PROPOSTA', 'EMAIL', 'FOLLOWUP', 'CONVERSAO'];
export const WHATSAPP_STATUSES = ['PUBLICADO', 'NAO_VERIFICADO', 'VALIDADO', 'INVALIDO'];
export const SOURCE_TYPES = ['OFICIAL', 'DIRETORIO', 'CADASTRO_PUBLICO', 'MANUAL', 'MAPS'];
export const CLIENT_SIGNALS = ['SEM_RESPOSTA', 'PEDIU_DEPOIS', 'OBJECAO_PRECO', 'TEM_FORNECEDOR', 'PEDIU_PROPOSTA', 'QUENTE'];

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const nullableText = (value, max) => text(value, max) || null;
const normalized = normalizedText;

function formatBatchTimestamp(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

export function inferOriginKey(row) {
  const fonte = String(row?.fonte || '');
  const url = String(row?.fonte_url || '');
  const lote = String(row?.lote_origem || '');
  if (row?.fonte_tipo === 'MAPS' || /google\s*maps/i.test(fonte) || url.includes('google.com/maps')) return 'MAPS';
  if (/openstreetmap|overpass/i.test(fonte) || url.includes('openstreetmap.org')) return 'OSM';
  if (/csv|importa[cç][aã]o/i.test(fonte) || /^CSV\s*•/i.test(lote)) return 'CSV';
  return 'MANUAL';
}

function buildLoteOrigem(b, fallbackPrefix = null) {
  if (b?.lote_origem && String(b.lote_origem).trim()) return text(b.lote_origem, 80);
  const origin = fallbackPrefix || inferOriginKey(b);
  const labelMap = { MAPS: 'Maps', OSM: 'OSM', CSV: 'CSV', MANUAL: 'Manual' };
  const label = labelMap[origin] || 'Manual';
  return `${label} • ${formatBatchTimestamp()}`;
}

function nullableNumber(value, { integer = false, min = null, max = null } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const val = integer ? Math.round(n) : Math.round(n * 100) / 100;
  if (min !== null && val < min) return null;
  if (max !== null && val > max) return null;
  return val;
}

function inferPhoneType(b) {
  if (['CELULAR', 'FIXO', 'DESCONHECIDO'].includes(b?.telefone_tipo)) return b.telefone_tipo;
  const waNorm = normalizePhone(b?.whatsapp);
  if (waNorm.valido) return waNorm.tipo;
  const telNorm = normalizePhone(b?.telefone || b?.phone);
  if (telNorm.valido) return telNorm.tipo;
  return 'DESCONHECIDO';
}

export function setStoreFile(filePath, opts = {}) {
  storeFile = path.resolve(filePath);
  adapter = new WalJsonAdapter(storeFile, opts);
  leadIndex = new LeadIndex();
  cache = null;
}

export function setDataDir(dirPath, opts = {}) {
  setStoreFile(path.join(path.resolve(dirPath), 'leads.json'), opts);
}

export function getStoreFilePath() {
  return storeFile;
}

export async function replaceAllLeads(newRows) {
  cache = Array.isArray(newRows) ? [...newRows] : [];
  leadIndex.rebuild(cache);
  await adapter.replaceAll(cache);
  return cache.length;
}

export function resetStoreCache() {
  cache = null;
  leadIndex.clear();
}

export function flushWal() {
  return adapter.flush();
}

export async function compactNow() {
  const rows = load();
  await adapter.compact(rows);
  return adapter.getStats();
}

export async function flushWrites({ compact = true } = {}) {
  await adapter.flush();
  if (compact && cache !== null && adapter.walOps > 0) {
    await adapter.compact(cache);
  }
}

export function getStorageHealth() {
  load();
  return {
    storage_stats: adapter.getStats(),
    index_stats: leadIndex.getStats(),
  };
}

function load() {
  if (cache !== null) return cache;
  cache = adapter.load();
  leadIndex.rebuild(cache);
  return cache;
}

export function matchDuplicates(candidate, rows, excludeId = null) {
  if (rows === cache) {
    return leadIndex.findDuplicateCandidates(candidate, excludeId);
  }

  const name = normalized(candidate.nome_fantasia || candidate.nome);
  const city = normalized(candidate.cidade || 'Governador Valadares');
  const cnpj = validCnpjKey(candidate.cnpj);
  const phones = new Set(extractPhoneKeys(candidate));
  const domain = normalizeDomain(candidate.website);
  const sourceUrl = normalizeSourceUrl(candidate.fonte_url);
  const addr = normalized(candidate.endereco || candidate.address);
  const neighborhood = normalized(candidate.bairro);

  return rows.filter((row) => {
    if (row.id === excludeId) return false;

    if (sourceUrl && normalizeSourceUrl(row.fonte_url) === sourceUrl) return true;
    if (cnpj && validCnpjKey(row.cnpj) === cnpj) return true;

    if (phones.size > 0) {
      const rowPhones = extractPhoneKeys(row);
      if (rowPhones.some((p) => phones.has(p))) return true;
    }

    if (domain && normalizeDomain(row.website) === domain) return true;

    const sameCity = normalized(row.cidade || 'Governador Valadares') === city;
    const rowName = normalized(row.nome_fantasia);
    if (sameCity && name && rowName === name) return true;

    if (sameCity && name.length >= 7 && rowName.length >= 7) {
      const partialNameMatch = rowName.includes(name) || name.includes(rowName);
      if (partialNameMatch) {
        const rowAddr = normalized(row.endereco);
        const addrMatch = Boolean(addr && rowAddr && (rowAddr.includes(addr) || addr.includes(rowAddr)));
        const neighMatch = Boolean(neighborhood && normalized(row.bairro) === neighborhood);
        if (addrMatch || neighMatch) return true;
      }
    }

    return false;
  }).map((row) => ({
    id: row.id,
    nome_fantasia: row.nome_fantasia,
    cidade: row.cidade,
    whatsapp: row.whatsapp,
    telefone: row.telefone,
    cnpj: row.cnpj,
    fonte_url: row.fonte_url,
  }));
}

export function findLeadDuplicates(candidate, excludeId = null) {
  load();
  return leadIndex.findDuplicateCandidates(candidate, excludeId);
}

function waStatus(b) {
  if (!b.whatsapp) return null;
  if (WHATSAPP_STATUSES.includes(b.whatsapp_status)) return b.whatsapp_status;
  return (b.tags || []).includes('whatsapp-publico') ? 'PUBLICADO' : 'NAO_VERIFICADO';
}

function sourceKind(b) {
  if (SOURCE_TYPES.includes(b.fonte_tipo)) return b.fonte_tipo;
  if ((b.fonte_url || '').includes('google.com/maps') || /google maps/i.test(b.fonte || '')) return 'MAPS';
  if ((b.fonte_url || '').includes('gov.br') || /receita|cnpj|casadosdados|econodata/i.test(b.fonte || '')) return 'CADASTRO_PUBLICO';
  if (b.fonte_url) return 'DIRETORIO';
  return 'MANUAL';
}

export function id() {
  return crypto.randomUUID();
}

export function listLeads({ q, status, segmento, cidade, whatsapp, verificacao, fonte, origem, dor, lote, sort, followup } = {}) {
  let rows = [...load()];
  if (status) rows = rows.filter((x) => x.status === status);
  if (segmento) rows = rows.filter((x) => x.segmento === segmento);
  if (cidade) rows = rows.filter((x) => (x.cidade || 'Governador Valadares') === cidade);
  if (whatsapp === '1') rows = rows.filter((x) => x.whatsapp && x.whatsapp_status !== 'INVALIDO');
  if (whatsapp === '0') rows = rows.filter((x) => !x.whatsapp || x.whatsapp_status === 'INVALIDO');
  if (verificacao) rows = rows.filter((x) => (x.whatsapp_status || (x.whatsapp ? 'NAO_VERIFICADO' : '')) === verificacao);
  if (fonte) rows = rows.filter((x) => String(x.fonte || '').toLowerCase().includes(fonte.toLowerCase()));
  if (origem) rows = rows.filter((x) => inferOriginKey(x) === origem);
  if (dor) rows = rows.filter((x) => Array.isArray(x.etiquetas_dor) && x.etiquetas_dor.includes(dor));
  if (lote) rows = rows.filter((x) => x.lote_origem === lote);
  if (followup === '1') rows = rows.filter((x) => x.proximo_contato);
  if (followup === 'atrasado') rows = rows.filter((x) => x.proximo_contato && x.proximo_contato < todayLocal());
  if (q) {
    const n = normalized(q);
    rows = rows.filter((x) =>
      [x.nome_fantasia, x.razao_social, x.bairro, x.cidade, x.telefone, x.whatsapp, x.cnpj, x.observacoes, x.endereco, x.email, x.fonte, x.categoria_raw, ...(x.tags || [])]
        .filter(Boolean)
        .some((v) => normalized(v).includes(n))
    );
  }
  const comparators = {
    score: (a, b) => (b.score || 0) - (a.score || 0),
    nome: (a, b) => String(a.nome_fantasia || '').localeCompare(b.nome_fantasia || '', 'pt-BR'),
    recente: (a, b) => String(b.criado_em || '').localeCompare(a.criado_em || ''),
    followup: (a, b) => String(a.proximo_contato || '9999').localeCompare(b.proximo_contato || '9999'),
    verificado: (a, b) => String(b.verificado_em || '').localeCompare(a.verificado_em || ''),
  };
  return rows.sort(comparators[sort] || comparators.score);
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function followUpQueue(period = 'all') {
  const today = todayLocal();
  const end = new Date();
  end.setDate(end.getDate() + 7);
  const week = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  let rows = load().filter((x) => x.proximo_contato);
  if (period === 'atrasado') rows = rows.filter((x) => x.proximo_contato < today);
  else if (period === 'hoje') rows = rows.filter((x) => x.proximo_contato === today);
  else if (period === 'semana') rows = rows.filter((x) => x.proximo_contato >= today && x.proximo_contato <= week);
  return rows.sort((a, b) => String(a.proximo_contato).localeCompare(String(b.proximo_contato)));
}

export function metaLists() {
  const rows = load();
  return {
    cidades: [...new Set(rows.map((x) => x.cidade || 'Governador Valadares'))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    fontes: [...new Set(rows.map((x) => x.fonte).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    lotes: [...new Set(rows.map((x) => x.lote_origem).filter(Boolean))].sort((a, b) => b.localeCompare(a, 'pt-BR')),
    dores: [...new Set(rows.flatMap((x) => Array.isArray(x.etiquetas_dor) ? x.etiquetas_dor : []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

export function getLead(lid) {
  load();
  return leadIndex.getById(lid);
}

export function stats() {
  const rows = load();
  const group = (key) => {
    const m = {};
    for (const r of rows) m[r[key]] = (m[r[key]] || 0) + 1;
    return Object.entries(m).map(([k, n]) => ({ [key]: k, n }));
  };
  const byCidade = {};
  for (const r of rows) {
    const c = (r.cidade || 'Governador Valadares').trim();
    byCidade[c] = (byCidade[c] || 0) + 1;
  }
  return {
    total: rows.length,
    byStatus: group('status'),
    bySeg: group('segmento').sort((a, b) => b.n - a.n),
    byPot: group('potencial'),
    byCidade: Object.entries(byCidade)
      .map(([cidade, n]) => ({ cidade, n }))
      .sort((a, b) => b.n - a.n),
  };
}

function scoreLead(row) {
  let s = 40;
  if (row.potencial === 'ALTO') s += 25;
  else if (row.potencial === 'MEDIO') s += 10;
  if (row.telefone || row.whatsapp) s += 10;
  if (row.cnpj) s += 10;
  if (row.endereco) s += 5;
  if (['BAR', 'RESTAURANTE', 'MERCADO', 'ADEGA', 'CLINICA', 'ACADEMIA'].includes(row.segmento)) s += 10;
  if (row.bairro === 'Centro') s += 5;
  return Math.min(100, s);
}

export function createLead(b) {
  const rows = load();
  const segmento = SEGMENTS.includes(b.segmento) ? b.segmento : 'OUTRO';
  const status = LEAD_STATUSES.includes(b.status) ? b.status : 'NOVO';
  const potencial = POTENTIALS.includes(b.potencial) ? b.potencial : 'MEDIO';
  const item = {
    id: id(),
    nome_fantasia: text(b.nome_fantasia, 160),
    razao_social: nullableText(b.razao_social, 180),
    cnpj: nullableText(b.cnpj, 24),
    segmento,
    subsegmento: nullableText(b.subsegmento, 80),
    categoria_raw: nullableText(b.categoria_raw, 120),
    telefone: nullableText(b.telefone, 40),
    whatsapp: nullableText(b.whatsapp, 40),
    telefone_tipo: inferPhoneType(b),
    email: nullableText(b.email, 180),
    website: nullableText(b.website, 500),
    endereco: nullableText(b.endereco, 240),
    bairro: nullableText(b.bairro, 100),
    cidade: text(b.cidade || 'Governador Valadares', 120),
    uf: text(b.uf || 'MG', 2).toUpperCase(),
    cep: nullableText(b.cep, 12),
    avaliacao: nullableNumber(b.avaliacao, { min: 0, max: 5 }),
    total_avaliacoes: nullableNumber(b.total_avaliacoes, { integer: true, min: 0 }),
    fonte: text(b.fonte || 'Cadastro manual', 180),
    fonte_url: nullableText(b.fonte_url, 500),
    fonte_tipo: sourceKind(b),
    lote_origem: buildLoteOrigem(b, 'MANUAL'),
    whatsapp_status: waStatus(b),
    verificado_em: nullableText(b.verificado_em, 40),
    status,
    potencial,
    score: 0,
    observacoes: nullableText(b.observacoes, 2000),
    tags: Array.isArray(b.tags) ? b.tags : [],
    redes_sociais: Array.isArray(b.redes_sociais) ? b.redes_sociais.slice(0, 10).map((x) => text(x, 300)).filter(Boolean) : [],
    socios: Array.isArray(b.socios) ? b.socios.slice(0, 5).map((x) => text(x, 120)).filter(Boolean) : [],
    diagnostico_fatos: b.diagnostico_fatos && typeof b.diagnostico_fatos === 'object' ? b.diagnostico_fatos : null,
    diagnostico_em: nullableText(b.diagnostico_em, 40),
    etiquetas_dor: Array.isArray(b.etiquetas_dor) ? b.etiquetas_dor.slice(0, 15).map((x) => text(x, 60)).filter(Boolean) : [],
    ultimo_sinal: CLIENT_SIGNALS.includes(b.ultimo_sinal) ? b.ultimo_sinal : null,
    ultimo_sinal_em: nullableText(b.ultimo_sinal_em, 40),
    ultimo_sinal_nota: nullableText(b.ultimo_sinal_nota, 300),
    hibernar_ate: nullableText(b.hibernar_ate, 20),
    interacoes: [],
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  };
  if (Array.isArray(item.etiquetas_dor) && item.etiquetas_dor.length > 0) {
    item.etiquetas_dor = sanitizePainTags(item);
  }
  item.score = scoreLead(item);
  rows.push(item);
  leadIndex.upsert(item);
  adapter.appendUpsert(item, () => cache);
  return item;
}

export function updateLead(lid, b) {
  const rows = load();
  const i = rows.findIndex((x) => x.id === lid);
  if (i < 0) return null;
  const before = rows[i];
  const allowed = {
    nome_fantasia: [160, false], razao_social: [180, true], cnpj: [24, true],
    segmento: [32, false], subsegmento: [80, true], categoria_raw: [120, true],
    telefone: [40, true], whatsapp: [40, true], telefone_tipo: [20, false],
    email: [180, true], website: [500, true], endereco: [240, true], bairro: [100, true],
    cidade: [120, false], uf: [2, false], cep: [12, true], fonte: [180, false], fonte_url: [500, true],
    fonte_tipo: [30, false], lote_origem: [80, true], whatsapp_status: [30, true], verificado_em: [40, true],
    status: [32, false], potencial: [16, false], observacoes: [2000, true], tags: [0, false], redes_sociais: [0, false],
    socios: [0, false], etiquetas_dor: [0, false], diagnostico_fatos: [0, true], diagnostico_em: [40, true],
    ultimo_sinal: [40, true], ultimo_sinal_em: [40, true], ultimo_sinal_nota: [300, true], hibernar_ate: [20, true],
    avaliacao: [0, true], total_avaliacoes: [0, true],
  };
  const changes = {};
  for (const [key, value] of Object.entries(b)) {
    if (!(key in allowed)) continue;
    if (key === 'tags') { changes.tags = Array.isArray(value) ? value.slice(0, 30).map((x) => text(x, 40)).filter(Boolean) : before.tags || []; continue; }
    if (key === 'redes_sociais') { changes.redes_sociais = Array.isArray(value) ? value.slice(0, 10).map((x) => text(x, 300)).filter(Boolean) : before.redes_sociais || []; continue; }
    if (key === 'socios') { changes.socios = Array.isArray(value) ? value.slice(0, 5).map((x) => text(x, 120)).filter(Boolean) : before.socios || []; continue; }
    if (key === 'etiquetas_dor') { changes.etiquetas_dor = Array.isArray(value) ? value.slice(0, 15).map((x) => text(x, 60)).filter(Boolean) : before.etiquetas_dor || []; continue; }
    if (key === 'diagnostico_fatos') { changes.diagnostico_fatos = value && typeof value === 'object' ? value : null; continue; }
    if (key === 'avaliacao') { changes.avaliacao = nullableNumber(value, { min: 0, max: 5 }); continue; }
    if (key === 'total_avaliacoes') { changes.total_avaliacoes = nullableNumber(value, { integer: true, min: 0 }); continue; }
    if (key === 'status' && LEAD_STATUSES.includes(value)) { changes.status = value; continue; }
    if (key === 'segmento' && SEGMENTS.includes(value)) { changes.segmento = value; continue; }
    if (key === 'potencial' && POTENTIALS.includes(value)) { changes.potencial = value; continue; }
    if (key === 'telefone_tipo' && ['CELULAR', 'FIXO', 'DESCONHECIDO'].includes(value)) { changes.telefone_tipo = value; continue; }
    if (['status', 'segmento', 'potencial', 'telefone_tipo'].includes(key)) continue;
    const [max, nullable] = allowed[key];
    const norm = text(value, max);
    changes[key] = nullable ? (norm || null) : norm;
  }
  if ('whatsapp' in changes && !changes.whatsapp) changes.whatsapp_status = null;
  else if (changes.whatsapp && (!('whatsapp_status' in changes) || !changes.whatsapp_status)) {
    const oldPhones = new Set(extractPhoneKeys({ whatsapp: before.whatsapp }));
    const newPhones = extractPhoneKeys({ whatsapp: changes.whatsapp });
    const sameNumber = newPhones.some((p) => oldPhones.has(p));
    changes.whatsapp_status = sameNumber ? (before.whatsapp_status || 'NAO_VERIFICADO') : 'NAO_VERIFICADO';
  }
  if (changes.whatsapp_status === 'VALIDADO' && !changes.verificado_em && !before.verificado_em) changes.verificado_em = todayLocal();
  if (('fonte' in changes || 'fonte_url' in changes) && !('fonte_tipo' in changes)) changes.fonte_tipo = sourceKind({ ...before, ...changes });
  if (('telefone' in changes || 'whatsapp' in changes) && !('telefone_tipo' in changes)) {
    changes.telefone_tipo = inferPhoneType({ ...before, ...changes });
  }
  const item = { ...before, ...changes, id: before.id, interacoes: before.interacoes || [], atualizado_em: new Date().toISOString() };
  if (Array.isArray(item.etiquetas_dor) && item.etiquetas_dor.length > 0) {
    item.etiquetas_dor = sanitizePainTags(item);
  }
  item.score = scoreLead(item);
  rows[i] = item;
  leadIndex.upsert(item);
  adapter.appendUpsert(item, () => cache);
  return item;
}

export function deleteLead(lid) {
  const current = load();
  const rows = current.filter((x) => x.id !== lid);
  if (rows.length === current.length) return false;
  cache = rows;
  leadIndex.remove(lid);
  adapter.appendDelete(lid, () => cache);
  return true;
}

export function addInteracao(lid, tipo, resumo) {
  const rows = load();
  const i = rows.findIndex((x) => x.id === lid);
  if (i < 0) return null;
  const safeType = INTERACTION_TYPES.includes(tipo) ? tipo : 'NOTA';
  const ix = { id: id(), tipo: safeType, resumo: text(resumo, 1000), criado_em: new Date().toISOString() };
  rows[i].interacoes = rows[i].interacoes || [];
  rows[i].interacoes.unshift(ix);
  rows[i].atualizado_em = new Date().toISOString();
  leadIndex.upsert(rows[i]);
  adapter.appendUpsert(rows[i], () => cache);
  return ix;
}

export function toCsv() {
  const rows = listLeads();
  const cols = ['nome_fantasia', 'razao_social', 'cnpj', 'segmento', 'telefone', 'whatsapp', 'whatsapp_status', 'verificado_em', 'email', 'website', 'endereco', 'bairro', 'cidade', 'uf', 'status', 'potencial', 'score', 'fonte', 'fonte_tipo', 'fonte_url', 'redes_sociais', 'proximo_contato', 'proximo_contato_nota', 'observacoes'];
  const esc = (v) => `"${String(Array.isArray(v) ? v.join(' | ') : (v ?? '')).replace(/"/g, '""')}"`;
  return '\uFEFF' + [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n');
}

export function previewImportRows(rows) {
  load();
  const seen = [];
  return rows.map((b, index) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { index, state: 'invalid', reason: 'Registro inválido' };
    const nome = String(b.nome_fantasia || b.nome || '').trim();
    if (!nome || nome.length > 160) return { index, state: 'invalid', reason: 'Nome ausente ou acima de 160 caracteres' };
    const matches = [...leadIndex.findDuplicateCandidates(b), ...matchDuplicates(b, seen)];
    const uniqueMatches = [...new Map(matches.map((x) => [x.id || `${x.nome_fantasia}|${x.cidade}`, x])).values()];
    const item = { ...b, nome_fantasia: nome, id: `preview-${index}` };
    seen.push(item);
    return {
      index,
      state: uniqueMatches.length ? 'duplicate' : 'new',
      reason: uniqueMatches.length ? 'CNPJ, telefone, domínio, URL ou nome/cidade correspondente' : '',
      matches: uniqueMatches,
      item: {
        nome_fantasia: nome,
        cidade: b.cidade || 'Governador Valadares',
        segmento: b.segmento || 'OUTRO',
        bairro: b.bairro || 'Centro',
        whatsapp: b.whatsapp || '',
        telefone: b.telefone || '',
        website: b.website || '',
        fonte: b.fonte || '',
      },
    };
  });
}

function enrichExistingLead(target, incoming) {
  let changed = false;
  const assignIfEmpty = (field, rawVal, maxLen = 500) => {
    if (target[field]) return;
    const v = nullableText(rawVal, maxLen);
    if (v) {
      target[field] = v;
      changed = true;
    }
  };

  assignIfEmpty('telefone', incoming.telefone || incoming.phone, 40);
  if (!target.whatsapp && incoming.whatsapp) {
    const wa = nullableText(incoming.whatsapp, 40);
    if (wa) {
      target.whatsapp = wa;
      if (!target.whatsapp_status) target.whatsapp_status = waStatus(incoming);
      changed = true;
    }
  }
  const incomingType = inferPhoneType(incoming);
  if ((!target.telefone_tipo || target.telefone_tipo === 'DESCONHECIDO') && incomingType !== 'DESCONHECIDO') {
    target.telefone_tipo = incomingType;
    changed = true;
  }
  assignIfEmpty('website', incoming.website, 500);
  assignIfEmpty('endereco', incoming.endereco || incoming.address, 240);
  assignIfEmpty('bairro', incoming.bairro, 100);
  assignIfEmpty('categoria_raw', incoming.categoria_raw, 120);
  assignIfEmpty('fonte_url', incoming.fonte_url, 500);
  assignIfEmpty('email', incoming.email, 180);
  assignIfEmpty('cnpj', incoming.cnpj, 24);

  if (target.segmento === 'OUTRO' && SEGMENTS.includes(incoming.segmento) && incoming.segmento !== 'OUTRO') {
    target.segmento = incoming.segmento;
    changed = true;
  }

  const incomingAv = nullableNumber(incoming.avaliacao, { min: 0, max: 5 });
  if (target.avaliacao == null && incomingAv != null) {
    target.avaliacao = incomingAv;
    changed = true;
  }
  const incomingTotAv = nullableNumber(incoming.total_avaliacoes, { integer: true, min: 0 });
  if (target.total_avaliacoes == null && incomingTotAv != null) {
    target.total_avaliacoes = incomingTotAv;
    changed = true;
  }

  if (changed) {
    target.atualizado_em = new Date().toISOString();
    target.score = scoreLead(target);
  }
  return changed;
}

export function importRows(rows, { includeIndices, allowDuplicates = false, batchPrefix = null } = {}) {
  const existing = load();
  const included = includeIndices ? new Set(includeIndices) : null;
  const batchTs = formatBatchTimestamp();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let duplicates = 0;
  let invalid = 0;
  const details = [];

  for (const [index, b] of rows.entries()) {
    if (included && !included.has(index)) { skipped++; continue; }
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      skipped++;
      invalid++;
      details.push({ index, state: 'invalid', reason: 'Registro inválido' });
      continue;
    }
    const nome = String(b.nome_fantasia || b.nome || '').trim();
    if (!nome || nome.length > 160) {
      skipped++;
      invalid++;
      details.push({ index, state: 'invalid', reason: 'Nome ausente ou acima de 160 caracteres' });
      continue;
    }
    const matches = leadIndex.findDuplicateCandidates(b);
    if (matches.length && !allowDuplicates) {
      const target = leadIndex.getById(matches[0].id);
      if (target && enrichExistingLead(target, b)) {
        leadIndex.upsert(target);
        updated++;
        details.push({ index, state: 'updated', id: target.id, nome_fantasia: target.nome_fantasia });
      } else {
        skipped++;
        duplicates++;
        details.push({ index, state: 'duplicate', nome_fantasia: nome, match: matches[0]?.nome_fantasia || null });
      }
      continue;
    }
    const tags = Array.isArray(b.tags) ? b.tags : [];
    const origin = batchPrefix || inferOriginKey(b);
    const labelMap = { MAPS: 'Maps', OSM: 'OSM', CSV: 'CSV', MANUAL: 'Manual' };
    const defaultLote = `${labelMap[origin] || 'Manual'} • ${batchTs}`;

    const item = {
      id: id(),
      nome_fantasia: nome,
      razao_social: nullableText(b.razao_social, 180),
      cnpj: nullableText(b.cnpj, 24),
      segmento: SEGMENTS.includes(b.segmento) ? b.segmento : 'OUTRO',
      subsegmento: nullableText(b.subsegmento, 80),
      categoria_raw: nullableText(b.categoria_raw, 120),
      telefone: nullableText(b.telefone || b.phone, 40),
      whatsapp: nullableText(b.whatsapp, 40),
      telefone_tipo: inferPhoneType(b),
      email: nullableText(b.email, 180),
      website: nullableText(b.website, 500),
      endereco: nullableText(b.endereco || b.address, 240),
      bairro: nullableText(b.bairro, 100),
      cidade: text(b.cidade || 'Governador Valadares', 120),
      uf: text(b.uf || 'MG', 2).toUpperCase(),
      cep: nullableText(b.cep, 12),
      avaliacao: nullableNumber(b.avaliacao, { min: 0, max: 5 }),
      total_avaliacoes: nullableNumber(b.total_avaliacoes, { integer: true, min: 0 }),
      fonte: text(b.fonte || 'Importação em massa', 180),
      fonte_url: nullableText(b.fonte_url, 500),
      fonte_tipo: sourceKind(b),
      lote_origem: nullableText(b.lote_origem, 80) || defaultLote,
      whatsapp_status: waStatus({ ...b, tags }),
      verificado_em: nullableText(b.verificado_em, 40),
      redes_sociais: Array.isArray(b.redes_sociais) ? b.redes_sociais.slice(0, 10).map((x) => text(x, 300)).filter(Boolean) : [],
      socios: Array.isArray(b.socios) ? b.socios.slice(0, 5).map((x) => text(x, 120)).filter(Boolean) : [],
      diagnostico_fatos: b.diagnostico_fatos && typeof b.diagnostico_fatos === 'object' ? b.diagnostico_fatos : null,
      diagnostico_em: nullableText(b.diagnostico_em, 40),
      etiquetas_dor: Array.isArray(b.etiquetas_dor) ? b.etiquetas_dor.slice(0, 15).map((x) => text(x, 60)).filter(Boolean) : [],
      ultimo_sinal: CLIENT_SIGNALS.includes(b.ultimo_sinal) ? b.ultimo_sinal : null,
      ultimo_sinal_em: nullableText(b.ultimo_sinal_em, 40),
      ultimo_sinal_nota: nullableText(b.ultimo_sinal_nota, 300),
      hibernar_ate: nullableText(b.hibernar_ate, 20),
      status: LEAD_STATUSES.includes(b.status) ? b.status : 'NOVO',
      potencial: POTENTIALS.includes(b.potencial) ? b.potencial : 'MEDIO',
      score: 50,
      observacoes: nullableText(b.observacoes, 2000),
      tags: tags.slice(0, 30).map((x) => text(x, 40)).filter(Boolean),
      interacoes: [],
      criado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    };
    if (Array.isArray(item.etiquetas_dor) && item.etiquetas_dor.length > 0) {
    item.etiquetas_dor = sanitizePainTags(item);
  }
  item.score = scoreLead(item);
    existing.push(item);
    leadIndex.upsert(item);
    added++;
    details.push({ index, state: 'imported', id: item.id, nome_fantasia: item.nome_fantasia });
  }
  adapter.replaceAll(existing);
  return { added, updated, skipped, duplicates, invalid, total: existing.length, details };
}

/** Converte lead em CLIENTE e registra interação automática */
export function convertLead(lid, { resumo, pedido_inicial } = {}) {
  const rows = load();
  const i = rows.findIndex((x) => x.id === lid);
  if (i < 0) return null;
  const before = rows[i];
  const ix = {
    id: id(),
    tipo: 'CONVERSAO',
    resumo: resumo || `Convertido em cliente${pedido_inicial ? ' · 1º pedido: ' + pedido_inicial : ''}`,
    criado_em: new Date().toISOString(),
  };
  rows[i] = {
    ...before,
    status: 'CLIENTE',
    potencial: before.potencial === 'BAIXO' ? 'MEDIO' : before.potencial,
    convertido_em: new Date().toISOString(),
    pedido_inicial: pedido_inicial || null,
    interacoes: [ix, ...(before.interacoes || [])],
    atualizado_em: new Date().toISOString(),
  };
  rows[i].score = scoreLead(rows[i]);
  leadIndex.upsert(rows[i]);
  adapter.appendUpsert(rows[i], () => cache);
  return rows[i];
}

/** Registra contato (liga/WhatsApp) e avança status se ainda NOVO/QUALIFICADO */
export function contactLead(lid, { canal, resumo, avancar = true } = {}) {
  const rows = load();
  const i = rows.findIndex((x) => x.id === lid);
  if (i < 0) return null;
  const before = rows[i];
  const tipo = canal === 'whatsapp' ? 'WHATSAPP' : canal === 'email' ? 'EMAIL' : 'LIGACAO';
  const ix = {
    id: id(),
    tipo,
    resumo: resumo || `Contato via ${canal || 'telefone'}`,
    criado_em: new Date().toISOString(),
  };
  let status = before.status;
  if (avancar && ['NOVO', 'QUALIFICADO'].includes(status)) status = 'CONTATADO';
  rows[i] = {
    ...before,
    status,
    ultimo_contato_em: new Date().toISOString(),
    interacoes: [ix, ...(before.interacoes || [])],
    atualizado_em: new Date().toISOString(),
  };
  leadIndex.upsert(rows[i]);
  adapter.appendUpsert(rows[i], () => cache);
  return rows[i];
}

/** Registra desfecho completo de follow-up (interação, sinal do cliente, estágio, agendamento ou hibernação) */
export function registerFollowUpOutcome(lid, payload = {}) {
  const rows = load();
  const i = rows.findIndex((x) => x.id === lid);
  if (i < 0) return null;

  const before = rows[i];
  const nowIso = new Date().toISOString();
  const updated = { ...before, interacoes: [...(before.interacoes || [])] };

  if ('sinal' in payload) {
    if (payload.sinal === null || payload.sinal === '') {
      updated.ultimo_sinal = null;
      updated.ultimo_sinal_em = null;
      updated.ultimo_sinal_nota = null;
    } else if (CLIENT_SIGNALS.includes(payload.sinal)) {
      updated.ultimo_sinal = payload.sinal;
      updated.ultimo_sinal_em = nowIso;
      if ('sinal_nota' in payload) updated.ultimo_sinal_nota = nullableText(payload.sinal_nota, 300);
    }
  }

  if ('status' in payload && LEAD_STATUSES.includes(payload.status)) {
    updated.status = payload.status;
    if (payload.status === 'CLIENTE' && !updated.convertido_em) {
      updated.convertido_em = nowIso;
    }
  }

  if ('proximo_contato' in payload || 'data' in payload) {
    const nextDate = payload.proximo_contato !== undefined ? payload.proximo_contato : payload.data;
    updated.proximo_contato = nextDate || null;
  }

  if ('proximo_contato_nota' in payload || 'nota' in payload) {
    const nextNote = payload.proximo_contato_nota !== undefined ? payload.proximo_contato_nota : payload.nota;
    updated.proximo_contato_nota = nullableText(nextNote, 300);
  }

  if ('hibernar_ate' in payload) {
    updated.hibernar_ate = payload.hibernar_ate || null;
    if (updated.hibernar_ate && !('proximo_contato' in payload) && !('data' in payload)) {
      updated.proximo_contato = null;
    }
  } else if (payload.registrar_toque === true && updated.hibernar_ate) {
    updated.hibernar_ate = null;
  }

  const outboundAction = payload.registrar_toque === true || ['WHATSAPP', 'LIGACAO', 'EMAIL', 'VISITA', 'PROPOSTA'].includes(payload.tipo);
  if (outboundAction) {
    updated.ultimo_contato_em = nowIso;
  }

  const ixTipo = INTERACTION_TYPES.includes(payload.tipo)
    ? payload.tipo
    : (outboundAction ? 'FOLLOWUP' : 'NOTA');
  const ixResumo = text(
    payload.resumo
    || (payload.sinal ? `Sinal registrado: ${payload.sinal}${payload.sinal_nota ? ` — ${payload.sinal_nota}` : ''}` : '')
    || (updated.proximo_contato ? `Agendado: ${updated.proximo_contato}${updated.proximo_contato_nota ? ` — ${updated.proximo_contato_nota}` : ''}` : '')
    || (updated.hibernar_ate ? `Lead hibernado até ${updated.hibernar_ate}` : ''),
    1000
  );

  if (ixResumo) {
    updated.interacoes.unshift({
      id: id(),
      tipo: ixTipo,
      resumo: ixResumo,
      criado_em: nowIso,
    });
  }

  updated.atualizado_em = nowIso;
  updated.score = scoreLead(updated);
  rows[i] = updated;
  leadIndex.upsert(updated);
  adapter.appendUpsert(updated, () => cache);
  return updated;
}

/** Agenda próximo follow-up */
export function setFollowUp(lid, { data, nota } = {}) {
  return registerFollowUpOutcome(lid, {
    proximo_contato: data || null,
    proximo_contato_nota: nota || null,
    tipo: 'FOLLOWUP',
    registrar_toque: false,
    resumo: nota ? `Agendado: ${data || '?'} — ${nota}` : null,
  });
}

export function pipelineStats() {
  const rows = load();
  const stages = ['NOVO', 'QUALIFICADO', 'CONTATADO', 'VISITA', 'PROPOSTA', 'CLIENTE', 'DESCARTADO'];
  const by = {};
  for (const s of stages) by[s] = 0;
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  const clientes = rows.filter((r) => r.status === 'CLIENTE');
  const comTel = rows.filter((r) => r.telefone || r.whatsapp).length;
  const followUps = rows.filter((r) => r.proximo_contato).length;
  return {
    stages: stages.map((s) => ({ status: s, n: by[s] || 0 })),
    clientes: clientes.length,
    taxa_conversao: rows.length ? Math.round((clientes.length / rows.length) * 1000) / 10 : 0,
    com_telefone: comTel,
    follow_ups_agendados: followUps,
  };
}
