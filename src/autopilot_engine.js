import { importRows, getLead, updateLead, flushWal, SEGMENTS, POTENTIALS } from './store.js';
import { collectLeadFacts } from './classifier.js';
import { summarizeMatrix } from './value_matrix.js';
import { evaluateLead } from './scoring_modes.js';
import { normalizePhone, validateCNPJ } from './hygiene.js';

const DEFAULT_DIAGNOSE_LIMIT = 25;
const DEFAULT_CONCURRENCY = 3;

export function mapCategoryToSegment(rawCategory, explicitSegment) {
  const exp = String(explicitSegment || '').trim().toUpperCase();
  if (exp && exp !== 'OUTRO' && SEGMENTS.includes(exp)) return exp;

  const cat = String(rawCategory || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!cat) return SEGMENTS.includes(exp) ? exp : 'OUTRO';
  if (/restaurante|churrascaria|pizzaria|bistro|cantina|sushi|comida|osteria/.test(cat)) return 'RESTAURANTE';
  if (/bar|pub|choperia|chopperia|boteco|lounge/.test(cat)) return 'BAR';
  if (/lanchonete|hamburgueria|hamburger|acai|pastelaria|cafe|cafeteria|padoca|snack/.test(cat)) return 'LANCHONETE';
  if (/padaria|panificadora|confeitaria/.test(cat)) return 'PADARIA';
  if (/supermercado|hipermercado|atacarejo/.test(cat)) return 'SUPERMERCADO';
  if (/mercado|minimercado|mercearia|emporio|hortifruti/.test(cat)) return 'MERCADO';
  if (/adega|bebida|vinho|cervejaria/.test(cat)) return 'ADEGA';
  if (/hotel|pousada|resort|hostel/.test(cat)) return 'HOTEL';
  if (/evento|buffet|cerimonial|festas/.test(cat)) return 'EVENTOS';
  if (/clinica|consultorio|odonto|dentista|medico|saude|fisioterapia|psicolog/.test(cat)) return 'CLINICA';
  if (/academia|fitness|crossfit|pilates|musculacao/.test(cat)) return 'ACADEMIA';
  if (/oficina|mecanica|auto center|funilaria|borracharia/.test(cat)) return 'OFICINA';
  if (/farmacia|drogaria/.test(cat)) return 'FARMACIA';
  if (/salao|barbearia|estetica|beleza|manicure/.test(cat)) return 'SALAO';
  if (/pet\s*shop|veterinari|banho\s*e\s*tosa|racao|animais/.test(cat)) return 'PETSHOP';
  if (/imobiliaria|corretor de imoveis/.test(cat)) return 'IMOBILIARIA';
  if (/escritorio|contabilidade|advocacia|consultoria/.test(cat)) return 'ESCRITORIO';
  if (/loja|boutique|comercio|magazine/.test(cat)) return 'LOJA';
  return SEGMENTS.includes(exp) ? exp : 'OUTRO';
}

export function hygienizeMapsLead(raw, { defaultSegment = null, loteOrigem = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const rawTel = raw.telefone || raw.phone || '';
  const rawWa = raw.whatsapp || '';
  const telNorm = normalizePhone(rawTel);
  const waNorm = normalizePhone(rawWa);

  let whatsapp = rawWa || null;
  if (!whatsapp && telNorm.valido && telNorm.whatsapp_provavel) {
    whatsapp = rawTel;
  }
  const telefone = rawTel || rawWa || null;
  const telefoneTipo = waNorm.valido ? waNorm.tipo : (telNorm.valido ? telNorm.tipo : 'DESCONHECIDO');

  const cnpjCheck = raw.cnpj ? validateCNPJ(raw.cnpj) : null;
  const cnpj = cnpjCheck?.valido ? cnpjCheck.formatted : (raw.cnpj || null);

  const mappedSeg = mapCategoryToSegment(raw.categoria_raw, raw.segmento);
  const segmento = mappedSeg !== 'OUTRO'
    ? mappedSeg
    : (defaultSegment && SEGMENTS.includes(defaultSegment) ? defaultSegment : 'OUTRO');

  const hasPhone = Boolean(telNorm.valido || waNorm.valido);
  const hasWa = Boolean(waNorm.valido ? waNorm.whatsapp_provavel : telNorm.whatsapp_provavel);
  const potencial = POTENTIALS.includes(raw.potencial)
    ? raw.potencial
    : (hasWa && raw.website && raw.endereco ? 'ALTO' : (hasPhone || raw.website ? 'MEDIO' : 'BAIXO'));

  return {
    ...raw,
    segmento,
    telefone,
    whatsapp,
    telefone_tipo: telefoneTipo,
    cnpj,
    potencial,
    lote_origem: raw.lote_origem || loteOrigem || null,
    fonte: raw.fonte || 'Google Maps (Captura Assistida)',
    fonte_tipo: raw.fonte_tipo || 'MAPS',
  };
}

/**
 * Executa diagnóstico em cadeia com concorrência controlada (padrão 3) e teto de leads.
 */
export async function diagnoseLeadIds(ids, {
  limit = DEFAULT_DIAGNOSE_LIMIT,
  concurrency = DEFAULT_CONCURRENCY,
  diagnoseFn = collectLeadFacts,
} = {}) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  const loaded = uniqueIds.map((id) => getLead(id)).filter(Boolean);

  loaded.sort((a, b) => {
    const scoreA = (a.website ? 2 : 0) + (a.cnpj ? 1 : 0);
    const scoreB = (b.website ? 2 : 0) + (b.cnpj ? 1 : 0);
    return scoreB - scoreA;
  });

  const targets = loaded.slice(0, Math.max(0, limit));
  if (!targets.length) return { diagnosed_count: 0, items: [] };

  const updatedItems = [];
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const idx = cursor++;
      const lead = targets[idx];
      try {
        const patch = await diagnoseFn(lead);
        if (patch && typeof patch === 'object') {
          const updated = updateLead(lead.id, patch);
          if (updated) updatedItems.push(updated);
        }
      } catch {
        // Falha individual não interrompe o lote
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, worker)
  );

  return {
    diagnosed_count: updatedItems.length,
    items: updatedItems,
  };
}

/**
 * Processador de Ingestão Inteligente do Google Maps:
 * Higieniza -> Importa/Merge O(1) -> Raio-X 2ª Geração + BrasilAPI (concorrência 3) -> Matriz + Priorização.
 */
export async function ingestAndEnrichMapsBatch(rawLeads, options = {}) {
  const {
    autoDiagnose = true,
    modeOrLens = 'equilibrado',
    loteOrigem = null,
    defaultSegment = null,
    diagnoseLimit = DEFAULT_DIAGNOSE_LIMIT,
    concurrency = DEFAULT_CONCURRENCY,
    diagnoseFn = collectLeadFacts,
  } = options;

  const list = Array.isArray(rawLeads) ? rawLeads : [];
  const sanitized = list.map((item) => hygienizeMapsLead(item, { defaultSegment, loteOrigem }));
  const result = importRows(sanitized, { allowDuplicates: false, batchPrefix: 'MAPS' });

  const lead_ids_lote = [...new Set(
    (result.details || [])
      .filter((d) => (d.state === 'imported' || d.state === 'updated') && d.id)
      .map((d) => d.id)
  )];

  let diagnosed_count = 0;
  if (autoDiagnose && lead_ids_lote.length > 0) {
    const diag = await diagnoseLeadIds(lead_ids_lote, {
      limit: diagnoseLimit,
      concurrency,
      diagnoseFn,
    });
    diagnosed_count = diag.diagnosed_count;
  }

  await flushWal();

  const batchLeads = lead_ids_lote.map((id) => getLead(id)).filter(Boolean);
  const matrix = summarizeMatrix(batchLeads);
  const matrix_summary = {
    OURO: matrix.quadrantes.OURO.total,
    EXPANSAO: matrix.quadrantes.EXPANSAO.total,
    ENTRADA: matrix.quadrantes.ENTRADA.total,
    OBSERVACAO: matrix.quadrantes.OBSERVACAO.total,
  };

  const actionableScored = batchLeads
    .map((lead) => {
      const ev = evaluateLead(lead, modeOrLens);
      const waNorm = normalizePhone(lead.whatsapp);
      const telNorm = normalizePhone(lead.telefone);
      const hasValidPhone = waNorm.valido || telNorm.valido;
      const isActionable = ev.acionavel && hasValidPhone && lead.whatsapp_status !== 'INVALIDO';
      return { id: lead.id, score: ev.score, isActionable };
    })
    .filter((x) => x.isActionable)
    .sort((a, b) => b.score - a.score);

  return {
    imported: result.added,
    updated: result.updated,
    duplicates: result.duplicates,
    invalid: result.invalid,
    total: result.total,
    diagnosed_count,
    matrix_summary,
    lead_ids_lote,
    lead_ids_acionaveis: actionableScored.map((x) => x.id),
    details: result.details,
  };
}
