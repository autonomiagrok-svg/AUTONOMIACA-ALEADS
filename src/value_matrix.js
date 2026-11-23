import { sanitizePainTags, extractContactProfile } from './domain_signals.js';

export { sanitizePainTags };

const HIGH_TICKET_SEGMENTS = new Set(['CLINICA', 'IMOBILIARIA', 'ESCRITORIO', 'ACADEMIA', 'OFICINA']);
const PRO_STACKS = new Set(['RD_STATION', 'SHOPIFY', 'NUVEMSHOP']);

export const MATRIX_QUADRANTS = {
  OURO: {
    id: 'OURO',
    label: '💎 OURO',
    titulo: 'Tem caixa e dor evidente — Prioridade Máxima',
    recomendacao: 'Ataque imediato com proposta de alto valor mostrando a brecha técnica encontrada e o impacto direto em faturamento.',
  },
  EXPANSAO: {
    id: 'EXPANSAO',
    label: '📈 EXPANSÃO',
    titulo: 'Empresa estruturada — Abordagem consultiva / B2B / Escala',
    recomendacao: 'Abordagem consultiva focada em agentes de IA, automação interna, CRM e escala comercial sem aumentar equipe.',
  },
  ENTRADA: {
    id: 'ENTRADA',
    label: '⚡ ENTRADA',
    titulo: 'Alta dor, porte menor — Oferta enxuta / Ticket de entrada',
    recomendacao: 'Ofereça pacote enxuto de entrada (landing page + botão WhatsApp / automação inicial) com retorno rápido.',
  },
  OBSERVACAO: {
    id: 'OBSERVACAO',
    label: '👀 OBSERVAÇÃO',
    titulo: 'Baixa prioridade imediata',
    recomendacao: 'Mantenha em nutrição ou enriqueça com Raio-X / BrasilAPI antes de priorizar no Power Dialer.',
  },
};

function getEffectivePainTags(lead) {
  const tags = new Set(sanitizePainTags(lead));
  if (extractContactProfile(lead).isLandlineOnly) tags.add('Só Telefone Fixo');

  const cnpjSit = String(lead?.diagnostico_fatos?.cnpj_info?.situacao_cadastral || '').trim().toUpperCase();
  if (cnpjSit && cnpjSit !== 'ATIVA' && cnpjSit !== '2') tags.add('CNPJ Inativo');
  return [...tags];
}

/**
 * Avalia bidimensionalmente um lead na Matriz Dinheiro (Caixa) × Brecha (Dor).
 * Calibrada para negócios locais reais capturados no Google Maps e enriquecidos com Raio-X/BrasilAPI.
 */
export function evaluateValueMatrix(lead) {
  const tags = getEffectivePainTags(lead);
  const audit = lead?.diagnostico_fatos?.website_audit || null;
  const cnpjInfo = lead?.diagnostico_fatos?.cnpj_info || null;
  const cnpjInativo = tags.includes('CNPJ Inativo');

  const sinais_caixa = [];
  let caixa = 0;

  if (cnpjInativo) {
    caixa = 0;
    sinais_caixa.push('CNPJ Inativo (zerado)');
  } else {
    const totAv = Number(lead?.total_avaliacoes || 0);
    const av = Number(lead?.avaliacao || 0);
    const capital = Number(cnpjInfo?.capital_social || 0);
    const stack = Array.isArray(audit?.stack_detectada) ? audit.stack_detectada : [];

    if (totAv >= 400) { caixa += 45; sinais_caixa.push(`Altíssimo giro (${totAv} aval.)`); }
    else if (totAv >= 150) { caixa += 35; sinais_caixa.push(`Alto giro (${totAv} aval.)`); }
    else if (totAv >= 50) { caixa += 25; sinais_caixa.push(`Bom volume (${totAv} aval.)`); }
    else if (totAv >= 15) { caixa += 15; sinais_caixa.push(`Movimento ativo (${totAv} aval.)`); }

    const hasEnoughReviews = totAv >= 5 || lead?.total_avaliacoes == null;
    if (hasEnoughReviews && av >= 4.2) {
      caixa += 15;
      sinais_caixa.push(`Reputação ${av}★`);
    } else if (hasEnoughReviews && av >= 4.0) {
      caixa += 10;
      sinais_caixa.push(`Nota ${av}★`);
    }

    const hasDirectPhone = extractContactProfile(lead).hasAnyPhone;
    const hasLocation = Boolean(String(lead?.endereco || lead?.bairro || '').trim());
    if (hasDirectPhone && hasLocation) {
      caixa += 10;
      sinais_caixa.push('Canal e endereço confirmados');
    }

    if (capital >= 200000) { caixa += 25; sinais_caixa.push(`Capital R$ ${Math.round(capital / 1000)}k`); }
    else if (capital >= 50000) { caixa += 15; sinais_caixa.push(`Capital R$ ${Math.round(capital / 1000)}k`); }

    if ((cnpjInfo && !cnpjInativo) || (!cnpjInfo && lead?.cnpj)) {
      caixa += 10;
      sinais_caixa.push('CNPJ ativo');
    }

    if (audit?.has_ecommerce === true) {
      caixa += 20;
      sinais_caixa.push('E-commerce ativo');
    }

    const proStackFound = stack.find((s) => PRO_STACKS.has(s));
    if (proStackFound) {
      caixa += 10;
      sinais_caixa.push(`Stack ${proStackFound}`);
    }

    const seg = String(lead?.segmento || '').toUpperCase();
    if (HIGH_TICKET_SEGMENTS.has(seg)) {
      caixa += 10;
      sinais_caixa.push(`Ticket médio alto (${seg})`);
    }
  }

  const caixa_score = Math.max(0, Math.min(100, Math.round(caixa)));

  const sinais_brecha = [];
  let brecha = 0;
  const painWeights = [
    ['Sem Site', 50],
    ['Site Fora do Ar', 50],
    ['Só Link na Bio', 45],
    ['E-commerce sem Pixel', 45],
    ['Site sem WhatsApp', 30],
    ['Sem Tráfego Rastreado', 25],
    ['Sem Mobile', 25],
    ['Site Lento', 20],
    ['Sem HTTPS', 20],
    ['Empresa Recente', 15],
    ['Só Telefone Fixo', 10],
  ];

  for (const [tag, pts] of painWeights) {
    if (tags.includes(tag)) {
      brecha += pts;
      sinais_brecha.push(tag);
    }
  }

  const brecha_score = Math.max(0, Math.min(100, Math.round(brecha)));

  let quadrante = 'OBSERVACAO';
  if (caixa_score >= 45 && brecha_score >= 45) quadrante = 'OURO';
  else if (caixa_score >= 45 && brecha_score < 45) quadrante = 'EXPANSAO';
  else if (caixa_score < 45 && brecha_score >= 45) quadrante = 'ENTRADA';

  const meta = MATRIX_QUADRANTS[quadrante];

  return {
    caixa_score,
    brecha_score,
    quadrante,
    quadrante_label: meta.label,
    quadrante_titulo: meta.titulo,
    sinais_caixa,
    sinais_brecha,
    recomendacao_abordagem: meta.recomendacao,
  };
}

function classifyDialerReadiness(lead, tags) {
  if (!['NOVO', 'QUALIFICADO'].includes(lead?.status)) {
    return { readyMobile: false, readyLandline: false, acionavel: false };
  }
  if (lead?.whatsapp_status === 'INVALIDO') {
    return { readyMobile: false, readyLandline: false, acionavel: false };
  }
  if (tags.includes('CNPJ Inativo')) {
    return { readyMobile: false, readyLandline: false, acionavel: false };
  }
  const contact = extractContactProfile(lead);
  const readyMobile = contact.hasMobile;
  const readyLandline = !readyMobile && contact.hasLandline;
  return {
    readyMobile,
    readyLandline,
    acionavel: readyMobile || readyLandline,
  };
}

/**
 * Resume toda a base nos 4 quadrantes da Matriz Dinheiro × Brecha.
 */
export function summarizeMatrix(leads) {
  const list = Array.isArray(leads) ? leads : [];
  const buckets = {
    OURO: [],
    EXPANSAO: [],
    ENTRADA: [],
    OBSERVACAO: [],
  };

  for (const lead of list) {
    const matrix = evaluateValueMatrix(lead);
    const tags = getEffectivePainTags(lead);
    const readiness = classifyDialerReadiness(lead, tags);
    buckets[matrix.quadrante].push({ lead, matrix, ...readiness });
  }

  const quadrantes = {};
  for (const key of ['OURO', 'EXPANSAO', 'ENTRADA', 'OBSERVACAO']) {
    const items = buckets[key];
    items.sort((a, b) => (b.matrix.caixa_score + b.matrix.brecha_score) - (a.matrix.caixa_score + a.matrix.brecha_score));
    const actionableMobile = items.filter((x) => x.readyMobile);
    const actionableLandline = items.filter((x) => x.readyLandline);
    const actionableAll = items.filter((x) => x.acionavel);
    const avgCaixa = items.length ? Math.round(items.reduce((s, x) => s + x.matrix.caixa_score, 0) / items.length) : 0;
    const avgBrecha = items.length ? Math.round(items.reduce((s, x) => s + x.matrix.brecha_score, 0) / items.length) : 0;

    const idsCelular = actionableMobile.map((x) => x.lead.id);
    const idsComFixo = actionableAll.map((x) => x.lead.id);

    quadrantes[key] = {
      ...MATRIX_QUADRANTS[key],
      total: items.length,
      acionaveis: idsComFixo.length,
      acionaveis_celular: idsCelular.length,
      acionaveis_fixo: actionableLandline.length,
      acionaveis_total: idsComFixo.length,
      media_caixa: avgCaixa,
      media_brecha: avgBrecha,
      lead_ids: idsComFixo,
      lead_ids_prontos: idsComFixo,
      lead_ids_prontos_celular: idsCelular,
      lead_ids_prontos_com_fixo: idsComFixo,
      top_leads: items.slice(0, 20).map((x) => ({
        id: x.lead.id,
        nome_fantasia: x.lead.nome_fantasia,
        segmento: x.lead.segmento,
        bairro: x.lead.bairro,
        cidade: x.lead.cidade,
        status: x.lead.status,
        whatsapp: x.lead.whatsapp,
        telefone: x.lead.telefone,
        telefone_tipo: x.readyMobile ? 'CELULAR' : (x.readyLandline ? 'FIXO' : (x.lead.telefone_tipo || 'DESCONHECIDO')),
        stack_detectada: x.lead.diagnostico_fatos?.website_audit?.stack_detectada || [],
        ttfb_ms: x.lead.diagnostico_fatos?.website_audit?.ttfb_ms ?? null,
        acionavel: x.acionavel,
        ready_mobile: x.readyMobile,
        ready_landline: x.readyLandline,
        matrix: x.matrix,
      })),
    };
  }

  return {
    total_leads: list.length,
    quadrantes,
  };
}
