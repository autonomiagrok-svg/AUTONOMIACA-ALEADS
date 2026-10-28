import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(process.cwd());
export const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

export const db = new DatabaseSync(path.join(DATA, 'leads.db'));
db.exec(`PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;`);

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  nome_fantasia TEXT NOT NULL,
  razao_social TEXT,
  cnpj TEXT,
  segmento TEXT NOT NULL,
  subsegmento TEXT,
  telefone TEXT,
  whatsapp TEXT,
  email TEXT,
  website TEXT,
  endereco TEXT,
  bairro TEXT,
  cidade TEXT NOT NULL DEFAULT 'Governador Valadares',
  uf TEXT NOT NULL DEFAULT 'MG',
  cep TEXT,
  latitude REAL,
  longitude REAL,
  fonte TEXT,
  fonte_url TEXT,
  status TEXT NOT NULL DEFAULT 'NOVO'
    CHECK(status IN ('NOVO','QUALIFICADO','CONTATADO','VISITA','PROPOSTA','CLIENTE','DESCARTADO')),
  potencial TEXT NOT NULL DEFAULT 'MEDIO'
    CHECK(potencial IN ('ALTO','MEDIO','BAIXO')),
  score INTEGER NOT NULL DEFAULT 50,
  observacoes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS interacoes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('NOTA','LIGACAO','WHATSAPP','VISITA','EMAIL','PESQUISA')),
  resumo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pesquisas (
  id TEXT PRIMARY KEY,
  termo TEXT NOT NULL,
  cidade TEXT NOT NULL DEFAULT 'Governador Valadares',
  segmento TEXT,
  resultado_resumo TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_segmento ON leads(segmento);
CREATE INDEX IF NOT EXISTS idx_leads_bairro ON leads(bairro);
CREATE INDEX IF NOT EXISTS idx_leads_cnpj ON leads(cnpj);
`);

export function id() {
  return crypto.randomUUID();
}

export function one(sql, params = []) {
  return db.prepare(sql).get(...params);
}

export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}
