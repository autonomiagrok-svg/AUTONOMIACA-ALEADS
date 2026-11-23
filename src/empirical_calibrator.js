import { sanitizePainTags, extractContactProfile, inferOriginKey } from './domain_signals.js';
import { DEFAULT_LENS_WEIGHTS, getPresetWeights } from './scoring_modes.js';

const ALPHA = 5;

const APPROACHED_STATUSES = new Set(['CONTATADO', 'VISITA', 'PROPOSTA', 'CLIENTE', 'DESCARTADO']);
const SUCCESS_STATUSES = new Set(['VISITA', 'PROPOSTA', 'CLIENTE']);
const SUCCESS_SIGNALS = new Set(['QUENTE', 'PEDIU_PROPOSTA']);

const CONFIDENCE_WEIGHT = {
  INSUFICIENTE: 0,
  BAIXA: 0.45,
  MEDIA: 0.75,
  ALTA: 1.0,
};

const PAIN_TO_WEIGHT_KEY = {
  'Sem Site': 'sem_site',
  'Site Fora do Ar': 'sem_site',
  'Só Link na Bio': 'so_link_bio',
  'Site sem WhatsApp': 'site_sem_whatsapp',
  'Sem Tráfego Rastreado': 'sem_trafego',
  'E-commerce sem Pixel': 'ecommerce_sem_pixel',
  'Sem Mobile': 'sem_mobile',
  'Site Lento': 'site_lento',
  'Sem HTTPS': 'sem_https',
  'Empresa Recente': 'empresa_recente',
  'Só Telefone Fixo': 'so_fixo_penalidade',
};

const WEIGHT_LABELS = {
  tem_whatsapp: 'WhatsApp / Celular válido',
  sem_site: 'Sem Site / Fora do Ar',
  so_link_bio: 'Só Link na Bio',
  site_sem_whatsapp: 'Site sem WhatsApp',
  sem_trafego: 'Sem Tráfego Rastreado',
  ecommerce_sem_pixel: 'E-commerce sem Pixel',
  sem_mobile: 'Sem Mobile',
  site_lento: 'Site Lento',
  sem_https: 'Sem HTTPS',
  empresa_recente: 'Empresa Recente (<= 18m)',
  nota_alta: 'Nota >= 4.2 no Maps',
  volume_avaliacoes: 'Volume >= 30 avaliações',
  cnpj_ativo: 'CNPJ Ativo',
  so_fixo_penalidade: 'Só Telefone Fixo',
};

function getPainTags(lead) {
  const tags = new Set(sanitizePainTags(lead));
  if (extractContactProfile(lead).isLandlineOnly) {
    tags.add('Só Telefone Fixo');
  }
  return [...tags];
}

function isApproached(lead) {
  if (APPROACHED_STATUSES.has(lead?.status)) return true;
  return Array.isArray(lead?.interacoes) && lead.interacoes.length > 0;
}

function isSuccess(lead) {
  if (SUCCESS_STATUSES.has(lead?.status)) return true;
  if (SUCCESS_SIGNALS.has(lead?.ultimo_sinal)) return true;
  return false;
}

function getConfidence(sampleSize) {
  if (sampleSize < 3) return 'INSUFICIENTE';
  if (sampleSize < 8) return 'BAIXA';
  if (sampleSize < 20) return 'MEDIA';
  return 'ALTA';
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function formatPtNumber(n, digits = 1) {
  return Number(n).toFixed(digits).replace('.', ',');
}

function buildSignalRow({ chave, label, tipo, weightKey = null, amostra, sucessos, baseRate }) {
  const confianca = getConfidence(amostra);
  const smoothed_rate = baseRate > 0 || amostra > 0
    ? (sucessos + ALPHA * baseRate) / (amostra + ALPHA)
    : 0;
  const lift = baseRate > 0 ? smoothed_rate / baseRate : 1;

  let delta_peso_sugerido = 0;
  if (confianca !== 'INSUFICIENTE' && baseRate > 0) {
    const rawDelta = (lift - 1) * 14 * CONFIDENCE_WEIGHT[confianca];
    delta_peso_sugerido = Math.max(-15, Math.min(20, Math.round(rawDelta)));
  }

  const confLabel = {
    INSUFICIENTE: 'insuficiente',
    BAIXA: 'baixa',
    MEDIA: 'média',
    ALTA: 'alta',
  }[confianca];

  let explicacao;
  if (confianca === 'INSUFICIENTE') {
    explicacao = `Amostra insuficiente para '${label}' (${sucessos} de ${amostra} abordados) — peso mantido neutro.`;
  } else if (lift >= 1.05) {
    explicacao = `Leads com '${label}' avançam ${formatPtNumber(lift)}x acima da média (${sucessos} de ${amostra} abordados • confiança ${confLabel}).`;
  } else if (lift <= 0.95) {
    explicacao = `Leads com '${label}' avançam abaixo da média (${formatPtNumber(lift)}x; ${sucessos} de ${amostra} abordados • confiança ${confLabel}).`;
  } else {
    explicacao = `Leads com '${label}' performam na média global (${sucessos} de ${amostra} abordados • confiança ${confLabel}).`;
  }

  return {
    chave,
    label,
    tipo,
    weight_key: weightKey,
    amostra,
    sucessos,
    raw_rate: amostra > 0 ? round3(sucessos / amostra) : 0,
    smoothed_rate: round3(smoothed_rate),
    lift: round3(lift),
    confianca,
    delta_peso_sugerido,
    explicacao,
  };
}

/**
 * Calcula performance empírica de cada sinal com suavização Bayesiana (alpha = 5).
 */
export function analyzeEmpiricalPerformance(leads) {
  const list = Array.isArray(leads) ? leads : [];
  const approached = list.filter(isApproached);
  const amostra_total = approached.length;
  const sucessos_totais = approached.filter(isSuccess).length;
  const base_rate = amostra_total > 0 ? sucessos_totais / amostra_total : 0;

  const counters = new Map();
  const track = (chave, label, tipo, weightKey, ok) => {
    if (!counters.has(chave)) {
      counters.set(chave, { chave, label, tipo, weightKey, amostra: 0, sucessos: 0 });
    }
    const c = counters.get(chave);
    c.amostra++;
    if (ok) c.sucessos++;
  };

  for (const lead of approached) {
    const ok = isSuccess(lead);
    const tags = getPainTags(lead);
    for (const dor of tags) {
      track(`dor:${dor}`, dor, 'dor', PAIN_TO_WEIGHT_KEY[dor] || null, ok);
    }

    if (lead.segmento) {
      track(`seg:${lead.segmento}`, `Segmento ${lead.segmento}`, 'segmento', null, ok);
    }

    const origin = inferOriginKey(lead);
    track(`origem:${origin}`, `Origem ${origin}`, 'origem', null, ok);

    if (Number(lead.avaliacao || 0) >= 4.2) {
      track('sinal:nota_alta', 'Nota >= 4.2 no Maps', 'reputacao', 'nota_alta', ok);
    }

    if (Number(lead.total_avaliacoes || 0) >= 30) {
      track('sinal:volume_avaliacoes', 'Volume >= 30 avaliações', 'reputacao', 'volume_avaliacoes', ok);
    }

    if (extractContactProfile(lead).hasMobile) {
      track('sinal:tem_whatsapp', 'WhatsApp / Celular válido', 'canal', 'tem_whatsapp', ok);
    }

    const cnpjInativo = tags.includes('CNPJ Inativo');
    const hasActiveCnpj = !cnpjInativo && Boolean(lead.cnpj || lead.diagnostico_fatos?.cnpj_info);
    if (hasActiveCnpj) {
      track('sinal:cnpj_ativo', 'CNPJ Ativo', 'cadastro', 'cnpj_ativo', ok);
    }
  }

  const sinais = [...counters.values()]
    .map((c) => buildSignalRow({ ...c, baseRate: base_rate }))
    .sort((a, b) => {
      const confOrder = { ALTA: 3, MEDIA: 2, BAIXA: 1, INSUFICIENTE: 0 };
      if (confOrder[b.confianca] !== confOrder[a.confianca]) {
        return confOrder[b.confianca] - confOrder[a.confianca];
      }
      return b.lift - a.lift;
    });

  return {
    alpha: ALPHA,
    total_base: list.length,
    amostra_total,
    sucessos_totais,
    base_rate: round3(base_rate),
    sinais,
  };
}

/**
 * Gera uma proposta pronta de Lente Auto-Calibrada comparando Antes vs. Depois.
 */
export function buildCalibratedLensProposal(leads, baseLensOrMode = 'equilibrado') {
  const analise = analyzeEmpiricalPerformance(leads);
  const baseWeights = baseLensOrMode && typeof baseLensOrMode === 'object' && baseLensOrMode.pesos
    ? { ...DEFAULT_LENS_WEIGHTS, ...baseLensOrMode.pesos }
    : getPresetWeights(typeof baseLensOrMode === 'string' ? baseLensOrMode : 'equilibrado');

  const novosPesos = { ...baseWeights };
  const weightSignals = new Map();

  for (const s of analise.sinais) {
    if (!s.weight_key) continue;
    const prev = weightSignals.get(s.weight_key);
    if (!prev || s.amostra > prev.amostra) {
      weightSignals.set(s.weight_key, s);
    }
  }

  const comparativo = [];
  for (const [campo, antes] of Object.entries(baseWeights)) {
    const sig = weightSignals.get(campo);
    const delta = sig ? sig.delta_peso_sugerido : 0;
    const depois = Math.max(-50, Math.min(50, antes + delta));
    novosPesos[campo] = depois;
    comparativo.push({
      campo,
      label: WEIGHT_LABELS[campo] || campo,
      antes,
      depois,
      delta: depois - antes,
      amostra: sig?.amostra || 0,
      lift: sig?.lift || 1,
      confianca: sig?.confianca || 'INSUFICIENTE',
    });
  }

  const segmentos_boost = analise.sinais
    .filter((s) => s.tipo === 'segmento' && s.confianca !== 'INSUFICIENTE' && s.lift >= 1.2)
    .slice(0, 4)
    .map((s) => s.chave.replace(/^seg:/, ''));

  let maturidade_diagnostico;
  if (analise.amostra_total < 10) {
    maturidade_diagnostico = `Base com ${analise.amostra_total} lead(s) abordado(s) — aborde pelo menos 10 leads para calibragem de alta confiança.`;
  } else if (analise.amostra_total < 30) {
    maturidade_diagnostico = `Base com ${analise.amostra_total} leads abordados (taxa base ${formatPtNumber(analise.base_rate * 100)}%) — calibragem ativa em maturação.`;
  } else {
    maturidade_diagnostico = `Base madura com ${analise.amostra_total} leads abordados (taxa base ${formatPtNumber(analise.base_rate * 100)}%) — calibragem empírica pronta.`;
  }

  const proposta_lente = {
    nome: 'Auto-Calibrada (Empírica)',
    descricao: `Pesos calibrados com suavização Bayesiana sobre ${analise.amostra_total} leads abordados.`,
    oferta_contexto: null,
    pesos: novosPesos,
    filtros: {
      exigir_whatsapp: false,
      segmentos_boost,
      bairros_boost: [],
    },
    origem_calibracao: {
      gerado_em: new Date().toISOString(),
      amostra_total: analise.amostra_total,
      sucessos_totais: analise.sucessos_totais,
      base_rate: analise.base_rate,
    },
  };

  return {
    analise,
    proposta_lente,
    comparativo,
    maturidade_diagnostico,
  };
}
