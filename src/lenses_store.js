import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_LENS_WEIGHTS } from './scoring_modes.js';

let lensesFile = process.env.LENSES_FILE
  ? path.resolve(process.env.LENSES_FILE)
  : path.join(process.cwd(), 'data', 'lenses.json');

let cache = null;
let writeQueue = Promise.resolve();

const text = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const nullableText = (v, max = 300) => text(v, max) || null;

function clampWeight(val, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-50, Math.min(50, Math.round(n)));
}

function normalizeWeights(raw = {}) {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_LENS_WEIGHTS)) {
    out[k] = raw && k in raw ? clampWeight(raw[k], def) : def;
  }
  return out;
}

function normalizeStringList(arr, { upper = false, maxItems = 30, maxLen = 60 } = {}) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    let val = text(item, maxLen);
    if (!val) continue;
    if (upper) val = val.toUpperCase();
    const key = val.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(val);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeFilters(raw = {}) {
  return {
    exigir_whatsapp: Boolean(raw?.exigir_whatsapp),
    segmentos_boost: normalizeStringList(raw?.segmentos_boost, { upper: true }),
    bairros_boost: normalizeStringList(raw?.bairros_boost, { upper: false }),
  };
}

export function setLensesFile(filePath) {
  lensesFile = path.resolve(filePath);
  cache = null;
  writeQueue = Promise.resolve();
}

export function resetLensesCache() {
  cache = null;
}

export function flushLensesWrites() {
  return writeQueue;
}

function load() {
  if (cache !== null) return cache;
  if (!fs.existsSync(lensesFile)) {
    fs.mkdirSync(path.dirname(lensesFile), { recursive: true });
    fs.writeFileSync(lensesFile, '[]', { encoding: 'utf8', mode: 0o600 });
    cache = [];
    return cache;
  }
  const raw = fs.readFileSync(lensesFile, 'utf8').trim();
  cache = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(cache)) cache = [];
  return cache;
}

function enqueueSave(rows) {
  cache = rows;
  const payload = JSON.stringify(rows, null, 2);
  const targetFile = lensesFile;
  writeQueue = writeQueue.then(async () => {
    await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });
    const tmp = `${targetFile}.tmp.${process.pid}.${crypto.randomUUID()}`;
    await fs.promises.writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tmp, targetFile);
  }).catch((err) => {
    console.error('Erro ao persistir lentes:', err);
    throw err;
  });
  return writeQueue;
}

export function listLenses() {
  return [...load()];
}

export function getLens(id) {
  return load().find((l) => l.id === id) || null;
}

export function createLens(data = {}) {
  const nome = text(data.nome, 100);
  if (!nome) throw Object.assign(new Error('Nome da lente é obrigatório'), { status: 400 });

  const rows = load();
  const nowIso = new Date().toISOString();
  const item = {
    id: `lens_${crypto.randomUUID().slice(0, 8)}`,
    nome,
    descricao: text(data.descricao, 300),
    oferta_contexto: nullableText(data.oferta_contexto, 300),
    pesos: normalizeWeights(data.pesos),
    filtros: normalizeFilters(data.filtros),
    origem_calibracao: data.origem_calibracao && typeof data.origem_calibracao === 'object' ? data.origem_calibracao : null,
    criado_em: nowIso,
    atualizado_em: nowIso,
  };
  rows.push(item);
  enqueueSave(rows);
  return item;
}

export function updateLens(id, patch = {}) {
  const rows = load();
  const idx = rows.findIndex((l) => l.id === id);
  if (idx < 0) return null;

  const before = rows[idx];
  const nome = patch.nome !== undefined ? text(patch.nome, 100) : before.nome;
  if (!nome) throw Object.assign(new Error('Nome da lente não pode ficar vazio'), { status: 400 });

  const updated = {
    ...before,
    nome,
    descricao: patch.descricao !== undefined ? text(patch.descricao, 300) : before.descricao,
    oferta_contexto: patch.oferta_contexto !== undefined ? nullableText(patch.oferta_contexto, 300) : before.oferta_contexto,
    pesos: patch.pesos !== undefined ? normalizeWeights({ ...before.pesos, ...patch.pesos }) : before.pesos,
    filtros: patch.filtros !== undefined ? normalizeFilters({ ...before.filtros, ...patch.filtros }) : before.filtros,
    origem_calibracao: patch.origem_calibracao !== undefined ? patch.origem_calibracao : before.origem_calibracao,
    atualizado_em: new Date().toISOString(),
  };

  rows[idx] = updated;
  enqueueSave(rows);
  return updated;
}

export function deleteLens(id) {
  const rows = load();
  const next = rows.filter((l) => l.id !== id);
  if (next.length === rows.length) return false;
  enqueueSave(next);
  return true;
}
