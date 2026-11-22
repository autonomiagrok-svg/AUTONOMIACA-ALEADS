import fs from 'node:fs';
import path from 'node:path';
import { normalizePhone, validateCNPJ } from './hygiene.js';
import {
  listLeads,
  compactNow,
  getStoreFilePath,
  replaceAllLeads,
} from './store.js';

const LEGACY_SOURCE_RE = /(?:seed|demonstrativo|curado|simulado)/i;
const CORRUPTED_HOURS_ADDR_RE = /^(?:abre\s|fecha\s|aberto\b|fechado\b)/i;

function formatBackupTimestamp(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

/**
 * Grava backup íntegro com timestamp em data/backups/ após compactar o WAL.
 */
export async function createAutomaticBackup(dataDir = null) {
  await compactNow();
  const baseDir = dataDir ? path.resolve(dataDir) : path.dirname(getStoreFilePath());
  const backupsDir = path.join(baseDir, 'backups');
  await fs.promises.mkdir(backupsDir, { recursive: true });

  const fileName = `leads-backup-${formatBackupTimestamp()}.json`;
  const fullPath = path.join(backupsDir, fileName);
  const payload = JSON.stringify(listLeads(), null, 2);

  await fs.promises.writeFile(fullPath, payload, { encoding: 'utf8', mode: 0o600 });
  const st = await fs.promises.stat(fullPath);
  if (!st.isFile() || st.size === 0) {
    throw new Error('Falha ao validar integridade do arquivo de backup automático.');
  }

  return {
    backup_file: `backups/${fileName}`,
    backup_path: fullPath,
    bytes: st.size,
  };
}

/**
 * Classifica um lead em uma das 4 categorias mutuamente exclusivas de auditoria.
 */
export function classifyLeadForCleanup(lead) {
  const hasHistory = Array.isArray(lead?.interacoes) && lead.interacoes.length > 0;
  const hasSignal = Boolean(lead?.ultimo_sinal);
  if (lead?.status !== 'NOVO' || hasHistory || hasSignal) {
    return 'ativos_protegidos';
  }

  const fonteUrl = String(lead?.fonte_url || '').toLowerCase();
  const fonte = String(lead?.fonte || '');
  const endereco = String(lead?.endereco || '').trim();
  const hasAnyPhoneRaw = Boolean(String(lead?.telefone || '').trim() || String(lead?.whatsapp || '').trim());
  const hasWebsite = Boolean(String(lead?.website || '').trim());

  const isLegacyUrl = fonteUrl.includes('cnpj.biz');
  const isLegacySource = LEGACY_SOURCE_RE.test(fonte);
  const isCorruptedMaps = CORRUPTED_HOURS_ADDR_RE.test(endereco) && !hasAnyPhoneRaw && !hasWebsite;

  if (isLegacyUrl || isLegacySource || isCorruptedMaps) {
    return 'legado_sintetico_ou_corrompido';
  }

  const hasValidPhone = normalizePhone(lead?.telefone).valido || normalizePhone(lead?.whatsapp).valido;
  const hasValidCnpj = validateCNPJ(lead?.cnpj).valido;

  if (hasValidPhone || hasWebsite || hasValidCnpj) {
    return 'novos_acionaveis';
  }

  return 'fantasmas_sem_contato';
}

/**
 * Auditoria somente-leitura da saúde da base de leads.
 */
export function analyzeBaseHealth(leads) {
  const list = Array.isArray(leads) ? leads : [];
  const counts = {
    ativos_protegidos: 0,
    novos_acionaveis: 0,
    legado_sintetico_ou_corrompido: 0,
    fantasmas_sem_contato: 0,
  };
  const amostras = {
    legado_sintetico_ou_corrompido: [],
    fantasmas_sem_contato: [],
  };

  for (const lead of list) {
    const cat = classifyLeadForCleanup(lead);
    counts[cat]++;
    if (cat === 'legado_sintetico_ou_corrompido' && amostras.legado_sintetico_ou_corrompido.length < 5) {
      amostras.legado_sintetico_ou_corrompido.push(lead.nome_fantasia || lead.id);
    } else if (cat === 'fantasmas_sem_contato' && amostras.fantasmas_sem_contato.length < 5) {
      amostras.fantasmas_sem_contato.push(lead.nome_fantasia || lead.id);
    }
  }

  return {
    total: list.length,
    counts,
    restante_apos_cirurgica: counts.ativos_protegidos + counts.novos_acionaveis,
    removiveis_cirurgica: counts.legado_sintetico_ou_corrompido + counts.fantasmas_sem_contato,
    amostras,
  };
}

/**
 * Executa Faxina Cirúrgica ou Reset Total com trava obrigatória de backup automático.
 */
export async function executeCleanup({ mode, confirm, dataDir = null } = {}) {
  if (confirm !== true) {
    throw Object.assign(new Error('Confirmação explícita (confirm: true) é obrigatória para executar limpeza.'), { status: 400 });
  }
  if (!['cirurgica', 'reset_total'].includes(mode)) {
    throw Object.assign(new Error('Modo de limpeza inválido. Use "cirurgica" ou "reset_total".'), { status: 400 });
  }

  // Trava obrigatória: backup automático antes de qualquer alteração
  const backup = await createAutomaticBackup(dataDir);

  const current = listLeads();
  const before_count = current.length;

  let nextLeads;
  if (mode === 'reset_total') {
    nextLeads = [];
  } else {
    nextLeads = current.filter((lead) => {
      const cat = classifyLeadForCleanup(lead);
      return cat === 'ativos_protegidos' || cat === 'novos_acionaveis';
    });
  }

  await replaceAllLeads(nextLeads);

  return {
    ok: true,
    mode,
    backup_file: backup.backup_file,
    backup_path: backup.backup_path,
    before_count,
    after_count: nextLeads.length,
    removed_count: before_count - nextLeads.length,
  };
}
