import crypto from 'node:crypto';
import { getSegmentSearchLabel, SEGMENTS_CATALOG } from './leads_engine.js';
import { getLead } from './store.js';
import { summarizeMatrix } from './value_matrix.js';

const VALID_PHASES = new Set(['WAITING_MAPS', 'SCROLLING_TO_END', 'DEEP_CAPTURING', 'COMPLETED', 'STOPPED']);
const MAX_LOGS = 40;

const missions = new Map();
let activeMissionId = null;

function isSilent(explicitSilent) {
  if (explicitSilent === true) return true;
  if (explicitSilent === false) return false;
  return process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
}

function logTerminal(tag, msg, silent) {
  if (isSilent(silent)) return;
  console.log(`[${tag}] ${msg}`);
}

function formatLoteDate(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

function pushLog(mission, message) {
  mission.logs.push({
    at: new Date().toISOString(),
    message: String(message || ''),
  });
  if (mission.logs.length > MAX_LOGS) {
    mission.logs.splice(0, mission.logs.length - MAX_LOGS);
  }
}

const TELEMETRY_COUNTER_KEYS = [
  'received',
  'detail_ok',
  'card_only_fallback',
  'raw_phone_present',
  'valid_phone_kept',
  'phone_dropped_hygiene',
  'with_whatsapp',
  'with_landline',
  'with_website',
  'with_address',
  'with_bairro',
  'with_rating',
];

function createEmptyTelemetry() {
  return {
    received: 0,
    detail_ok: 0,
    card_only_fallback: 0,
    raw_phone_present: 0,
    valid_phone_kept: 0,
    phone_dropped_hygiene: 0,
    with_whatsapp: 0,
    with_landline: 0,
    with_website: 0,
    with_address: 0,
    with_bairro: 0,
    with_rating: 0,
    rates: {
      detail_pct: 0,
      phone_pct: 0,
      whatsapp_pct: 0,
      website_pct: 0,
      address_pct: 0,
    },
    anomaly_warning: null,
  };
}

function finalizeTelemetry(t) {
  const rec = Number(t.received || 0);
  const pct = (n) => (rec > 0 ? Math.round((Number(n || 0) / rec) * 100) : 0);
  t.rates = {
    detail_pct: pct(t.detail_ok),
    phone_pct: pct(t.valid_phone_kept),
    whatsapp_pct: pct(t.with_whatsapp),
    website_pct: pct(t.with_website),
    address_pct: pct(t.with_address),
  };

  if (rec >= 5 && t.raw_phone_present > 0 && t.valid_phone_kept === 0) {
    t.anomaly_warning = 'ALERTA: telefones brutos vieram do Maps mas foram descartados na higienização.';
  } else if (rec >= 5 && t.valid_phone_kept === 0) {
    t.anomaly_warning = 'ALERTA: 0 telefones válidos capturados após 5+ cards — possível falha ao abrir painel de detalhes ou mudança de seletor do Google Maps.';
  } else if (rec >= 5 && t.detail_ok === 0) {
    t.anomaly_warning = 'ALERTA: nenhum painel de detalhes foi lido (100% fallback raso de card).';
  } else {
    t.anomaly_warning = null;
  }
  return t;
}

export function clearMissionsForTest() {
  missions.clear();
  activeMissionId = null;
}

/**
 * Cria uma missão focada de 1 segmento (ou termo livre) com rolagem obrigatória até o fim no Google Maps.
 */
export function createMission({
  cidade = 'Governador Valadares',
  uf = 'MG',
  segmento = 'RESTAURANTE',
  customQuery = '',
  autoDiagnose = true,
  modeOrLens = 'equilibrado',
  silent,
} = {}) {
  const cleanCity = String(cidade || 'Governador Valadares').trim();
  const cleanUf = String(uf || 'MG').trim().toUpperCase().slice(0, 2);
  const cleanCustom = String(customQuery || '').trim();
  const cleanSeg = String(segmento || 'RESTAURANTE').trim().toUpperCase();
  const validSeg = cleanSeg in SEGMENTS_CATALOG ? cleanSeg : 'OUTRO';
  const termo = cleanCustom || getSegmentSearchLabel(validSeg);
  const query = `${termo} em ${cleanCity} ${cleanUf}`;

  // Trava anti-duplo clique: se já existe missão RUNNING criada há < 3000ms com a mesma query, retorna a mesma
  if (activeMissionId && missions.has(activeMissionId)) {
    const prev = missions.get(activeMissionId);
    if (prev.status === 'RUNNING') {
      const elapsedMs = Date.now() - Date.parse(prev.started_at);
      if (prev.query === query && elapsedMs >= 0 && elapsedMs < 3000) {
        logTerminal('MAPS-MISSION', `⚡ Ignorado duplo clique (${elapsedMs}ms) — reutilizando id=${prev.id}`, silent);
        return prev;
      }
      prev.status = 'STOPPED';
      prev.phase = 'STOPPED';
      prev.finished_at = new Date().toISOString();
      pushLog(prev, 'Substituída por nova missão');
    }
  }

  const id = `m_${crypto.randomUUID().slice(0, 8)}`;
  const maps_url = `https://www.google.com/maps/search/${encodeURIComponent(query)}#autonomia_mission=${id}`;
  const lote_origem = `Maps • ${termo} • ${formatLoteDate()}`;
  const nowIso = new Date().toISOString();

  const mission = {
    id,
    cidade: cleanCity,
    uf: cleanUf,
    segmento: validSeg,
    custom_query: cleanCustom,
    termo,
    query,
    maps_url,
    lote_origem,
    auto_diagnose: autoDiagnose !== false,
    mode_or_lens: modeOrLens || 'equilibrado',
    status: 'RUNNING',
    phase: 'WAITING_MAPS',
    scroll_discovered: 0,
    reached_end: false,
    captured_count: 0,
    total_to_capture: 0,
    imported: 0,
    updated: 0,
    duplicates: 0,
    invalid: 0,
    diagnosed_count: 0,
    telemetry: createEmptyTelemetry(),
    matrix_summary: { OURO: 0, EXPANSAO: 0, ENTRADA: 0, OBSERVACAO: 0 },
    lead_ids_lote: [],
    lead_ids_acionaveis: [],
    logs: [],
    started_at: nowIso,
    updated_at: nowIso,
    finished_at: null,
  };

  pushLog(mission, `Missão iniciada: "${query}" (aguardando aba do Google Maps)`);
  missions.set(id, mission);
  activeMissionId = id;

  logTerminal('MAPS-MISSION', `▶ Criada id=${id} query="${query}" lote="${lote_origem}"`, silent);
  return mission;
}

export function getMission(id) {
  return missions.get(id) || null;
}

export function getActiveMission() {
  if (!activeMissionId) return null;
  return missions.get(activeMissionId) || null;
}

/**
 * Atualiza fase e progresso da missão (Fase 1: SCROLLING_TO_END, Fase 2: DEEP_CAPTURING).
 */
export function updateMissionProgress(missionId, patch = {}, { silent } = {}) {
  const mission = missions.get(missionId);
  if (!mission) return null;
  if (mission.status !== 'RUNNING') return mission;

  if (patch.phase && VALID_PHASES.has(patch.phase)) {
    mission.phase = patch.phase;
  }
  if (patch.scroll_discovered !== undefined && Number.isFinite(Number(patch.scroll_discovered))) {
    mission.scroll_discovered = Math.max(mission.scroll_discovered, Number(patch.scroll_discovered));
  }
  if (patch.reached_end === true) {
    mission.reached_end = true;
  }
  if (patch.captured_count !== undefined && Number.isFinite(Number(patch.captured_count))) {
    mission.captured_count = Math.max(mission.captured_count, Number(patch.captured_count));
  }
  if (patch.total_to_capture !== undefined && Number.isFinite(Number(patch.total_to_capture))) {
    mission.total_to_capture = Math.max(mission.total_to_capture, Number(patch.total_to_capture));
  }

  mission.updated_at = new Date().toISOString();
  if (patch.message) {
    pushLog(mission, patch.message);
  }

  logTerminal(
    'MAPS-MISSION',
    `• id=${mission.id} phase=${mission.phase} scroll=${mission.scroll_discovered} reached_end=${mission.reached_end} captured=${mission.captured_count}/${mission.total_to_capture}`,
    silent
  );
  return mission;
}

/**
 * Registra o resultado de um lote enviado em streaming pela extensão (ex: a cada 5 leads).
 */
export function recordMissionBatch(missionId, batchResult = {}, progressInfo = {}, { silent } = {}) {
  const mission = missions.get(missionId);
  if (!mission) return null;

  mission.imported += Number(batchResult.imported || 0);
  mission.updated += Number(batchResult.updated || 0);
  mission.duplicates += Number(batchResult.duplicates || 0);
  mission.invalid += Number(batchResult.invalid || 0);
  mission.diagnosed_count += Number(batchResult.diagnosed_count || 0);

  const loteSet = new Set(mission.lead_ids_lote);
  for (const id of batchResult.lead_ids_lote || []) loteSet.add(id);
  mission.lead_ids_lote = [...loteSet];

  const acSet = new Set(mission.lead_ids_acionaveis);
  for (const id of batchResult.lead_ids_acionaveis || []) acSet.add(id);
  mission.lead_ids_acionaveis = [...acSet];

  if (progressInfo.captured_count !== undefined && Number.isFinite(Number(progressInfo.captured_count))) {
    mission.captured_count = Math.max(mission.captured_count, Number(progressInfo.captured_count));
  }
  if (progressInfo.total_to_capture !== undefined && Number.isFinite(Number(progressInfo.total_to_capture))) {
    mission.total_to_capture = Math.max(mission.total_to_capture, Number(progressInfo.total_to_capture));
  }

  // Recalcula matrix_summary consolidado dos leads reais da missão ou acumula se unit test sem store
  const loadedLeads = mission.lead_ids_lote.map((id) => getLead(id)).filter(Boolean);
  if (loadedLeads.length > 0) {
    const mx = summarizeMatrix(loadedLeads);
    mission.matrix_summary = {
      OURO: mx.quadrantes.OURO.total,
      EXPANSAO: mx.quadrantes.EXPANSAO.total,
      ENTRADA: mx.quadrantes.ENTRADA.total,
      OBSERVACAO: mx.quadrantes.OBSERVACAO.total,
    };
  } else if (batchResult.matrix_summary) {
    for (const q of ['OURO', 'EXPANSAO', 'ENTRADA', 'OBSERVACAO']) {
      mission.matrix_summary[q] = (mission.matrix_summary[q] || 0) + Number(batchResult.matrix_summary[q] || 0);
    }
  }

  if (!mission.telemetry) mission.telemetry = createEmptyTelemetry();
  if (batchResult.telemetry && typeof batchResult.telemetry === 'object') {
    for (const key of TELEMETRY_COUNTER_KEYS) {
      mission.telemetry[key] = (mission.telemetry[key] || 0) + Number(batchResult.telemetry[key] || 0);
    }
  }
  finalizeTelemetry(mission.telemetry);

  mission.updated_at = new Date().toISOString();
  const telSummary = `tel=${mission.telemetry.valid_phone_kept} wa=${mission.telemetry.with_whatsapp} site=${mission.telemetry.with_website} detail=${mission.telemetry.detail_ok}/${mission.telemetry.received}`;
  pushLog(
    mission,
    `Lote ingerido: +${batchResult.imported || 0} novos, +${batchResult.updated || 0} enriquecidos, +${batchResult.diagnosed_count || 0} diagnosticados (${telSummary})`
  );

  logTerminal(
    'MAPS-INGEST',
    `◀ id=${mission.id} batch(+${batchResult.imported || 0} novos, +${batchResult.updated || 0} upd, +${batchResult.duplicates || 0} dup, +${batchResult.diagnosed_count || 0} diag) total_lote=${mission.lead_ids_lote.length} OURO=${mission.matrix_summary.OURO} ${telSummary}`,
    silent
  );
  return mission;
}

export function completeMission(missionId, summary = {}, { silent } = {}) {
  const mission = missions.get(missionId);
  if (!mission) return null;
  if (mission.status === 'STOPPED') return mission;

  if (summary.captured_count !== undefined && Number.isFinite(Number(summary.captured_count))) {
    mission.captured_count = Math.max(mission.captured_count, Number(summary.captured_count));
  }
  if (summary.total_to_capture !== undefined && Number.isFinite(Number(summary.total_to_capture))) {
    mission.total_to_capture = Math.max(mission.total_to_capture, Number(summary.total_to_capture));
  }
  if (summary.reached_end === true) mission.reached_end = true;

  mission.status = 'COMPLETED';
  mission.phase = 'COMPLETED';
  mission.finished_at = new Date().toISOString();
  mission.updated_at = mission.finished_at;
  pushLog(mission, `Missão concluída! ${mission.imported} novos, ${mission.updated} enriquecidos, ${mission.diagnosed_count} diagnosticados.`);

  logTerminal(
    'MAPS-MISSION',
    `✔ Concluída id=${mission.id} capturados=${mission.captured_count}/${mission.total_to_capture} novos=${mission.imported} atualizados=${mission.updated}`,
    silent
  );
  return mission;
}

export function stopMission(missionId, reason = 'Parado pelo operador', { silent } = {}) {
  const mission = missions.get(missionId);
  if (!mission) return null;
  if (mission.status === 'COMPLETED') return mission;

  mission.status = 'STOPPED';
  mission.phase = 'STOPPED';
  mission.stop_reason = String(reason || 'Parado pelo operador');
  mission.finished_at = new Date().toISOString();
  mission.updated_at = mission.finished_at;
  pushLog(mission, `Missão interrompida: ${mission.stop_reason}`);

  logTerminal('MAPS-MISSION', `⏹ Interrompida id=${mission.id} motivo="${mission.stop_reason}"`, silent);
  return mission;
}
