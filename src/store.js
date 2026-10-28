import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = path.join(process.cwd(), 'data', 'leads.json');
export const LEAD_STATUSES = ['NOVO', 'QUALIFICADO', 'CONTATADO', 'VISITA', 'PROPOSTA', 'CLIENTE', 'DESCARTADO'];
export const SEGMENTS = ['BAR', 'RESTAURANTE', 'LANCHONETE', 'PADARIA', 'MERCADO', 'ADEGA', 'HOTEL', 'EVENTOS', 'SUPERMERCADO', 'OUTRO'];
export const POTENTIALS = ['ALTO', 'MEDIO', 'BAIXO'];
export const INTERACTION_TYPES = ['NOTA', 'LIGACAO', 'WHATSAPP', 'VISITA', 'PROPOSTA', 'EMAIL', 'FOLLOWUP', 'CONVERSAO'];
export const WHATSAPP_STATUSES = ['PUBLICADO', 'NAO_VERIFICADO', 'VALIDADO', 'INVALIDO'];

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const nullableText = (value, max) => text(value, max) || null;
const normalized = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (value) => String(value ?? '').replace(/\D/g, '');
const cnpjDigits = (value) => digits(value);
const phoneKey = (value) => {
  let n = digits(value);
  if (n.startsWith('55') && n.length >= 12) n = n.slice(2);
  return n.length >= 10 ? n : '';
};

function matchDuplicates(candidate, rows, excludeId = null) {
  const name = normalized(candidate.nome_fantasia || candidate.nome);
  const city = normalized(candidate.cidade || 'Governador Valadares');
  const cnpj = cnpjDigits(candidate.cnpj);
  const phone = phoneKey(candidate.whatsapp);
  const addr = normalized(candidate.endereco || candidate.address);
  const neighborhood = normalized(candidate.bairro);
  return rows.filter((row) => {
    if (row.id === excludeId) return false;
    if (cnpj && cnpjDigits(row.cnpj) === cnpj) return true;
    if (phone && phoneKey(row.whatsapp) === phone) return true;
    const sameCity = normalized(row.cidade || 'Governador Valadares') === city;
    const sameName = name && normalized(row.nome_fantasia) === name;
    if (sameCity && sameName) return true;
    return Boolean(sameCity && name && name.length >= 7 && normalized(row.nome_fantasia).includes(name) && (addr && normalized(row.endereco).includes(addr) || neighborhood && normalized(row.bairro) === neighborhood));
  }).map((row) => ({
    id: row.id, nome_fantasia: row.nome_fantasia, cidade: row.cidade,
    whatsapp: row.whatsapp, cnpj: row.cnpj,
  }));
}

export function findLeadDuplicates(candidate, excludeId = null) {
  return matchDuplicates(candidate, load(), excludeId);
}

function waStatus(b) {
  if (!b.whatsapp) return null;
  if (WHATSAPP_STATUSES.includes(b.whatsapp_status)) return b.whatsapp_status;
  return (b.tags || []).includes('whatsapp-publico') ? 'PUBLICADO' : 'NAO_VERIFICADO';
}

function sourceKind(b) {
  if (['OFICIAL', 'DIRETORIO', 'CADASTRO_PUBLICO', 'MANUAL'].includes(b.fonte_tipo)) return b.fonte_tipo;
  if ((b.fonte_url || '').includes('gov.br') || /receita|cnpj|casadosdados|econodata/i.test(b.fonte || '')) return 'CADASTRO_PUBLICO';
  if (b.fonte_url) return 'DIRETORIO';
  return 'MANUAL';
}

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(rows) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export function id() {
  return crypto.randomUUID();
}

export function listLeads({ q, status, segmento, cidade, whatsapp, verificacao, fonte, sort, followup } = {}) {
  let rows = load();
  if (status) rows = rows.filter((x) => x.status === status);
  if (segmento) rows = rows.filter((x) => x.segmento === segmento);
  if (cidade) rows = rows.filter((x) => (x.cidade || 'Governador Valadares') === cidade);
  if (whatsapp === '1') rows = rows.filter((x) => x.whatsapp && x.whatsapp_status !== 'INVALIDO');
  if (whatsapp === '0') rows = rows.filter((x) => !x.whatsapp || x.whatsapp_status === 'INVALIDO');
  if (verificacao) rows = rows.filter((x) => (x.whatsapp_status || (x.whatsapp ? 'NAO_VERIFICADO' : '')) === verificacao);
  if (fonte) rows = rows.filter((x) => String(x.fonte || '').toLowerCase().includes(fonte.toLowerCase()));
  if (followup === '1') rows = rows.filter((x) => x.proximo_contato);
  if (followup === 'atrasado') rows = rows.filter((x) => x.proximo_contato && x.proximo_contato < todayLocal());
  if (q) {
    const n = normalized(q);
    rows = rows.filter((x) =>
      [x.nome_fantasia, x.razao_social, x.bairro, x.cidade, x.telefone, x.whatsapp, x.cnpj, x.observacoes, x.endereco, x.email, x.fonte, ...(x.tags || [])]
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
  };
}

export function getLead(lid) {
  return load().find((x) => x.id === lid) || null;
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
  if (row.telefone) s += 10;
  if (row.cnpj) s += 10;
  if (row.endereco) s += 5;
  if (['BAR', 'RESTAURANTE', 'MERCADO', 'ADEGA'].includes(row.segmento)) s += 10;
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
    telefone: nullableText(b.telefone, 40),
    whatsapp: nullableText(b.whatsapp, 40),
    email: nullableText(b.email, 180),
    website: nullableText(b.website, 500),
    endereco: nullableText(b.endereco, 240),
    bairro: nullableText(b.bairro, 100),
    cidade: text(b.cidade || 'Governador Valadares', 120),
    uf: text(b.uf || 'MG', 2).toUpperCase(),
    cep: nullableText(b.cep, 12),
    fonte: text(b.fonte || 'Cadastro manual', 180),
    fonte_url: nullableText(b.fonte_url, 500),
    fonte_tipo: sourceKind(b),
    whatsapp_status: waStatus(b),
    verificado_em: nullableText(b.verificado_em, 40),
    status,
    potencial,
    score: 0,
    observacoes: nullableText(b.observacoes, 2000),
    tags: Array.isArray(b.tags) ? b.tags : [],
    redes_sociais: Array.isArray(b.redes_sociais) ? b.redes_sociais.slice(0, 10).map((x) => text(x, 300)).filter(Boolean) : [],
    interacoes: [],
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  };
  item.score = scoreLead(item);
  rows.push(item);
  save(rows);
  return item;
}

export function updateLead(lid, b) {
  const rows = load();
  const i = rows.findIndex((x) => x.id === lid);
  if (i < 0) return null;
  const before = rows[i];
  const allowed = {
    nome_fantasia: [160, false], razao_social: [180, true], cnpj: [24, true],
    segmento: [32, false], subsegmento: [80, true], telefone: [40, true], whatsapp: [40, true],
    email: [180, true], website: [500, true], endereco: [240, true], bairro: [100, true],
    cidade: [120, false], uf: [2, false], cep: [12, true], fonte: [180, false], fonte_url: [500, true],
    fonte_tipo: [30, false], whatsapp_status: [30, true], verificado_em: [40, true],
    status: [32, false], potencial: [16, false], observacoes: [2000, true], tags: [0, false], redes_sociais: [0, false],
  };
  const changes = {};
  for (const [key, value] of Object.entries(b)) {
    if (!(key in allowed)) continue;
    if (key === 'tags') { changes.tags = Array.isArray(value) ? value.slice(0, 30).map((x) => text(x, 40)).filter(Boolean) : before.tags || []; continue; }
    if (key === 'redes_sociais') { changes.redes_sociais = Array.isArray(value) ? value.slice(0, 10).map((x) => text(x, 300)).filter(Boolean) : before.redes_sociais || []; continue; }
    if (key === 'status' && LEAD_STATUSES.includes(value)) { changes.status = value; continue; }
    if (key === 'segmento' && SEGMENTS.includes(value)) { changes.segmento = value; continue; }
    if (key === 'potencial' && POTENTIALS.includes(value)) { changes.potencial = value; continue; }
    if (['status', 'segmento', 'potencial'].includes(key)) continue;
    const [max, nullable] = allowed[key];
    const normalized = text(value, max);
    changes[key] = nullable ? (normalized || null) : normalized;
  }
  if ('whatsapp' in changes && !changes.whatsapp) changes.whatsapp_status = null;
  else if (changes.whatsapp && (!('whatsapp_status' in changes) || !changes.whatsapp_status)) {
    const sameNumber = phoneKey(changes.whatsapp) === phoneKey(before.whatsapp);
    changes.whatsapp_status = sameNumber ? (before.whatsapp_status || 'NAO_VERIFICADO') : 'NAO_VERIFICADO';
  }
  if (changes.whatsapp_status === 'VALIDADO' && !changes.verificado_em && !before.verificado_em) changes.verificado_em = todayLocal();
  if (('fonte' in changes || 'fonte_url' in changes) && !('fonte_tipo' in changes)) changes.fonte_tipo = sourceKind({ ...before, ...changes });
  const item = { ...before, ...changes, id: before.id, interacoes: before.interacoes || [], atualizado_em: new Date().toISOString() };
  item.score = scoreLead(item);
  rows[i] = item;
  save(rows);
  return item;
}

export function deleteLead(lid) {
  const current = load();
  const rows = current.filter((x) => x.id !== lid);
  if (rows.length === current.length) return false;
  save(rows);
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
  save(rows);
  return ix;
}

export function toCsv() {
  const rows = listLeads();
  const cols = ['nome_fantasia', 'razao_social', 'cnpj', 'segmento', 'telefone', 'whatsapp', 'whatsapp_status', 'verificado_em', 'email', 'website', 'endereco', 'bairro', 'cidade', 'uf', 'status', 'potencial', 'score', 'fonte', 'fonte_tipo', 'fonte_url', 'redes_sociais', 'proximo_contato', 'proximo_contato_nota', 'observacoes'];
  const esc = (v) => `"${String(Array.isArray(v) ? v.join(' | ') : (v ?? '')).replace(/"/g, '""')}"`;
  return '\uFEFF' + [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n');
}


export function previewImportRows(rows) {
  const existing = load();
  const seen = [];
  return rows.map((b, index) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { index, state: 'invalid', reason: 'Registro inválido' };
    const nome = String(b.nome_fantasia || b.nome || '').trim();
    if (!nome || nome.length > 160) return { index, state: 'invalid', reason: 'Nome ausente ou acima de 160 caracteres' };
    const matches = [...matchDuplicates(b, existing), ...matchDuplicates(b, seen)];
    const uniqueMatches = [...new Map(matches.map((x) => [x.id || `${x.nome_fantasia}|${x.cidade}`, x])).values()];
    const item = { ...b, nome_fantasia: nome, id: `preview-${index}` };
    seen.push(item);
    return {
      index,
      state: uniqueMatches.length ? 'duplicate' : 'new',
      reason: uniqueMatches.length ? 'CNPJ, WhatsApp ou nome/cidade correspondente' : '',
      matches: uniqueMatches,
      item: { nome_fantasia: nome, cidade: b.cidade || 'Governador Valadares', segmento: b.segmento || 'OUTRO', whatsapp: b.whatsapp || '', fonte: b.fonte || '' },
    };
  });
}

export function importRows(rows, { includeIndices, allowDuplicates = false } = {}) {
  const existing = load();
  const included = includeIndices ? new Set(includeIndices) : null;
  const seen = [];
  let added = 0;
  let skipped = 0;
  for (const [index, b] of rows.entries()) {
    if (included && !included.has(index)) { skipped++; continue; }
    if (!b || typeof b !== 'object' || Array.isArray(b)) { skipped++; continue; }
    const nome = String(b.nome_fantasia || b.nome || '').trim();
    if (!nome || nome.length > 160) { skipped++; continue; }
    const matches = [...matchDuplicates(b, existing), ...matchDuplicates(b, seen)];
    if (matches.length && !allowDuplicates) { skipped++; continue; }
    const tags = Array.isArray(b.tags) ? b.tags : [];
    const item = {
      id: id(),
      nome_fantasia: nome,
      razao_social: nullableText(b.razao_social, 180),
      cnpj: nullableText(b.cnpj, 24),
      segmento: SEGMENTS.includes(b.segmento) ? b.segmento : 'OUTRO',
      subsegmento: nullableText(b.subsegmento, 80),
      telefone: nullableText(b.telefone || b.phone, 40),
      whatsapp: nullableText(b.whatsapp, 40),
      email: nullableText(b.email, 180),
      website: nullableText(b.website, 500),
      endereco: nullableText(b.endereco || b.address, 240),
      bairro: nullableText(b.bairro, 100),
      cidade: text(b.cidade || 'Governador Valadares', 120),
      uf: text(b.uf || 'MG', 2).toUpperCase(),
      cep: nullableText(b.cep, 12),
      fonte: text(b.fonte || 'Importação em massa', 180),
      fonte_url: nullableText(b.fonte_url, 500),
      fonte_tipo: sourceKind(b),
      whatsapp_status: waStatus({ ...b, tags }),
      verificado_em: nullableText(b.verificado_em, 40),
      redes_sociais: Array.isArray(b.redes_sociais) ? b.redes_sociais.slice(0, 10).map((x) => text(x, 300)).filter(Boolean) : [],
      status: LEAD_STATUSES.includes(b.status) ? b.status : 'NOVO',
      potencial: POTENTIALS.includes(b.potencial) ? b.potencial : 'MEDIO',
      score: 50,
      observacoes: nullableText(b.observacoes, 2000),
      tags: tags.slice(0, 30).map((x) => text(x, 40)).filter(Boolean),
      interacoes: [],
      criado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    };
    item.score = (function scoreLead(row) {
      let s = 40;
      if (row.potencial === 'ALTO') s += 25;
      else if (row.potencial === 'MEDIO') s += 10;
      if (row.telefone) s += 10;
      if (row.cnpj) s += 10;
      if (row.endereco) s += 5;
      if (['BAR', 'RESTAURANTE', 'MERCADO', 'ADEGA'].includes(row.segmento)) s += 10;
      if (row.bairro === 'Centro') s += 5;
      return Math.min(100, s);
    })(item);
    existing.push(item);
    seen.push(item);
    added++;
  }
  save(existing);
  return { added, skipped, total: existing.length };
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
  save(rows);
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
  save(rows);
  return rows[i];
}

/** Agenda próximo follow-up */
export function setFollowUp(lid, { data, nota } = {}) {
  const rows = load();
  const i = rows.findIndex((x) => x.id === lid);
  if (i < 0) return null;
  rows[i].proximo_contato = data || null;
  rows[i].proximo_contato_nota = nota || null;
  rows[i].atualizado_em = new Date().toISOString();
  if (nota) {
    rows[i].interacoes = [
      { id: id(), tipo: 'FOLLOWUP', resumo: `Agendado: ${data || '?'} — ${nota}`, criado_em: new Date().toISOString() },
      ...(rows[i].interacoes || []),
    ];
  }
  save(rows);
  return rows[i];
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
