import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'data');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'leads.db');

const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode=WAL;');
db.exec('PRAGMA foreign_keys=ON;');
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
  status TEXT NOT NULL DEFAULT 'NOVO',
  potencial TEXT NOT NULL DEFAULT 'MEDIO',
  score INTEGER NOT NULL DEFAULT 50,
  observacoes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS interacoes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
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
`);
console.log('DB bootstrap OK:', file);
db.close();
