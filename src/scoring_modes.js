import { SITE_DEPENDENT_PAIN_TAGS, sanitizePainTags, extractContactProfile } from './domain_signals.js';

export { SITE_DEPENDENT_PAIN_TAGS, sanitizePainTags };

export const DEFAULT_LENS_WEIGHTS = {
  tem_whatsapp: 15,
  sem_site: 20,
  so_link_bio: 18,
  site_sem_whatsapp: 25,
  sem_trafego: 15,
  ecommerce_sem_pixel: 20,
  sem_mobile: 14,
  site_lento: 10,
  sem_https: 10,
  empresa_recente: 10,
  nota_alta: 15,
  volume_avaliacoes: 10,
  cnpj_ativo: 10,
  so_fixo_penalidade: -15,
};

export const PRESET_WEIGHTS = {
  equilibrado: {
    tem_whatsapp: 18,
    sem_site: 12,
    so_link_bio: 10,
    site_sem_whatsapp: 12,
    sem_trafego: 12,
    ecommerce_sem_pixel: 12,
    sem_mobile: 8,
    site_lento: 6,
    sem_https: 6,
    empresa_recente: 8,
    nota_alta: 10,
    volume_avaliacoes: 8,
    cnpj_ativo: 8,
    so_fixo_penalidade: -8,
  },
  cacador_digital: {
    tem_whatsapp: 15,
    sem_site: 22,
    so_link_bio: 20,
    site_sem_whatsapp: 18,
    sem_trafego: 12,
    ecommerce_sem_pixel: 22,
    sem_mobile: 14,
    site_lento: 10,
    sem_https: 8,
    empresa_recente: 6,
    nota_alta: 12,
    volume_avaliacoes: 12,
    cnpj_ativo: 4,
    so_fixo_penalidade: -6,
  },
  venda_direta: {
    tem_whatsapp: 25,
    sem_site: 0,
    so_link_bio: 0,
    site_sem_whatsapp: 0,
    sem_trafego: 0,
    ecommerce_sem_pixel: 0,
    sem_mobile: 0,
    site_lento: 0,
    sem_https: 0,
    empresa_recente: 0,
    nota_alta: 5,
    volume_avaliacoes: 25,
    cnpj_ativo: 15,
    so_fixo_penalidade: -15,
  },
  novos_entrantes: {
    tem_whatsapp: 18,
    sem_site: 8,
    so_link_bio: 8,
    site_sem_whatsapp: 8,
    sem_trafego: 5,
    ecommerce_sem_pixel: 5,
    sem_mobile: 6,
    site_lento: 4,
    sem_https: 4,
    empresa_recente: 35,
    nota_alta: 12,
    volume_avaliacoes: 0,
    cnpj_ativo: 6,
    so_fixo_penalidade: -8,
  },
};

export const SCORING_MODES = [
  {
    id: 'equilibrado',
    label: 'Equilibrado / Geral',
    short: 'Equilibrado',
    description: 'Balanceia acessibilidade, saúde da empresa, reputação no Maps e oportunidades.',
  },
  {
    id: 'cacador_digital',
    label: 'Caçador Digital — Sites, Tráfego & IA',
    short: 'Caçador Digital',
    description: 'Premia empresas bem avaliadas com brechas digitais claras (sem site, sem WhatsApp, sem Pixel).',
  },
  {
    id: 'venda_direta',
    label: 'Venda Direta & Atacado B2B',
    short: 'Venda Direta B2B',
    description: 'Premia porte, alto volume de avaliações, CNPJ ativo e WhatsApp direto.',
  },
  {
    id: 'novos_entrantes',
    label: 'Novos Entrantes — Janela de Montagem',
    short: 'Novos Entrantes',
    description: 'Premia empresas recentes (<= 18 meses) ou novatas no Maps em fase de estruturação.',
  },
];

export function getPresetWeights(modeId = 'equilibrado') {
  return { ...(PRESET_WEIGHTS[modeId] || DEFAULT_LENS_WEIGHTS) };
}

function normStr(val) {
  return String(val ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function inferBaselinePainTags(lead) {
  const tags = new Set(sanitizePainTags(lead));
  if (extractContactProfile(lead).isLandlineOnly) tags.add('Só Telefone Fixo');
  return [...tags];
}

function formatRatingPrefix(lead) {
  const av = lead?.avaliacao;
  const tot = lead?.total_avaliacoes;
  if (av != null && tot != null) return `Nota ${av} (${tot} avaliações)`;
  if (av != null) return `Nota ${av} no Maps`;
  if (tot != null) return `${tot} avaliações no Maps`;
  return null;
}

function finalizeBreakdown(entries) {
  return entries
    .filter((e) => e && typeof e.pontos === 'number' && e.pontos !== 0)
    .sort((a, b) => Math.abs(b.pontos) - Math.abs(a.pontos));
}

function evaluateCustomLens(lead, lens) {
  const tags = inferBaselinePainTags(lead);
  const { hasMobile, hasAnyPhone, hasEmail, waInvalid } = extractContactProfile(lead);
  const cnpjInfo = lead?.diagnostico_fatos?.cnpj_info || null;
  const cnpjInativo = tags.includes('CNPJ Inativo');
  const cnpjActive = Boolean((cnpjInfo && !cnpjInativo) || (!cnpjInfo && lead?.cnpj && !cnpjInativo));

  const av = Number(lead?.avaliacao || 0);
  const totAv = Number(lead?.total_avaliacoes || 0);
  const pesos = { ...DEFAULT_LENS_WEIGHTS, ...(lens.pesos || {}) };
  const filtros = lens.filtros || {};

  let score = 25;
  const breakdown = [{ fator: 'Base da lente', pontos: 25 }];
  const highlights = [];

  const add = (fator, pts, highlightText = null) => {
    const val = Number(pts || 0);
    if (!val) return;
    score += val;
    breakdown.push({ fator, pontos: val });
    if (highlightText && val > 0) highlights.push(highlightText);
  };

  if (hasMobile) add('WhatsApp / celular válido', pesos.tem_whatsapp, 'WhatsApp direto');
  if (tags.includes('Sem Site')) add('Sem Site', pesos.sem_site, 'sem site próprio');
  else if (tags.includes('Site Fora do Ar')) add('Site Fora do Ar', pesos.sem_site, 'site fora do ar');
  if (tags.includes('Só Link na Bio')) add('Só Link na Bio', pesos.so_link_bio, 'só Link na Bio');
  if (tags.includes('Site sem WhatsApp')) add('Site sem WhatsApp', pesos.site_sem_whatsapp, 'site sem WhatsApp');
  if (tags.includes('Sem Tráfego Rastreado')) add('Sem Tráfego Rastreado', pesos.sem_trafego, 'sem Pixel/GTM');
  if (tags.includes('E-commerce sem Pixel')) add('E-commerce sem Pixel', pesos.ecommerce_sem_pixel, 'e-commerce sem Pixel');
  if (tags.includes('Sem Mobile')) add('Sem Mobile', pesos.sem_mobile, 'sem versão mobile');
  if (tags.includes('Site Lento')) add('Site Lento', pesos.site_lento, 'site lento');
  if (tags.includes('Sem HTTPS')) add('Sem HTTPS', pesos.sem_https, 'sem HTTPS');
  if (tags.includes('Empresa Recente')) add('Empresa Recente (<= 18m)', pesos.empresa_recente, 'empresa recente');
  if (av >= 4.2) add(`Nota ${av} no Maps`, pesos.nota_alta, `nota ${av}★`);
  if (totAv >= 30) add(`Volume no Maps (${totAv} aval.)`, pesos.volume_avaliacoes, `${totAv} avaliações`);
  if (cnpjActive) add('CNPJ ativo', pesos.cnpj_ativo, 'CNPJ ativo');
  if (tags.includes('Só Telefone Fixo')) add('Só Telefone Fixo', pesos.so_fixo_penalidade);

  const segBoosts = Array.isArray(filtros.segmentos_boost) ? filtros.segmentos_boost.map((s) => String(s).toUpperCase()) : [];
  if (lead?.segmento && segBoosts.includes(String(lead.segmento).toUpperCase())) {
    add(`Segmento prioritário (${lead.segmento})`, 15, `segmento ${lead.segmento}`);
  }

  const bairroBoosts = Array.isArray(filtros.bairros_boost) ? filtros.bairros_boost.map(normStr).filter(Boolean) : [];
  if (lead?.bairro && bairroBoosts.includes(normStr(lead.bairro))) {
    add(`Bairro prioritário (${lead.bairro})`, 10, `bairro ${lead.bairro}`);
  }

  let meetsWhatsAppReq = true;
  if (filtros.exigir_whatsapp && !hasMobile) {
    meetsWhatsAppReq = false;
    add('Sem WhatsApp (exigido pela lente)', -25);
  }

  if (cnpjInativo) {
    const delta = Math.min(score, 10) - score;
    score = Math.min(score, 10);
    if (delta !== 0) breakdown.push({ fator: 'Alerta: CNPJ Inativo', pontos: delta });
    highlights.unshift('Alerta: CNPJ inativo');
  }

  if (waInvalid) {
    score = Math.max(0, score - 20);
    breakdown.push({ fator: 'WhatsApp marcado como inválido', pontos: -20 });
    highlights.push('WhatsApp inválido');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const potencial = score >= 70 ? 'ALTO' : (score >= 45 ? 'MEDIO' : 'BAIXO');
  const acionavel = !cnpjInativo && !waInvalid && meetsWhatsAppReq && (hasAnyPhone || hasEmail);

  const motivo_destaque = highlights.length
    ? `${lens.nome}: ${highlights.slice(0, 3).join(' · ')}`
    : `${lens.nome} · ${lead?.segmento || 'Lead'}`;

  return {
    mode: lens.id,
    mode_label: lens.nome,
    score,
    potencial,
    motivo_destaque,
    etiquetas_dor: tags,
    acionavel,
    breakdown: finalizeBreakdown(breakdown),
    oferta_contexto: lens.oferta_contexto || null,
  };
}

/**
 * Avalia instantaneamente um lead sob um dos 4 modos nativos ou uma Lente Customizada.
 * Função pura: não faz chamadas de rede e não altera o objeto lead.
 */
export function evaluateLead(lead, modeOrLens = 'equilibrado') {
  if (modeOrLens && typeof modeOrLens === 'object' && modeOrLens.pesos) {
    return evaluateCustomLens(lead, modeOrLens);
  }

  const mode = SCORING_MODES.some((m) => m.id === modeOrLens) ? modeOrLens : 'equilibrado';
  const tags = inferBaselinePainTags(lead);
  const { hasMobile, hasAnyPhone, hasEmail, waInvalid } = extractContactProfile(lead);
  const audit = lead?.diagnostico_fatos?.website_audit || null;
  const cnpjInfo = lead?.diagnostico_fatos?.cnpj_info || null;

  const cnpjInativo = tags.includes('CNPJ Inativo');
  const av = Number(lead?.avaliacao || 0);
  const totAv = Number(lead?.total_avaliacoes || 0);
  const capital = Number(cnpjInfo?.capital_social || 0);
  const socios = Array.isArray(lead?.socios) && lead.socios.length
    ? lead.socios
    : (Array.isArray(cnpjInfo?.socios) ? cnpjInfo.socios : []);

  let score = 35;
  const breakdown = [];
  const highlights = [];

  const add = (fator, pts) => {
    if (!pts) return;
    score += pts;
    breakdown.push({ fator, pontos: pts });
  };

  if (mode === 'cacador_digital') {
    score = 30;
    breakdown.push({ fator: 'Base Caçador Digital', pontos: 30 });
    if (av >= 4.0) add(`Nota ${av} no Maps`, 12);
    if (totAv >= 20) add(`Prova social (${totAv} avaliações)`, 12);
    if (totAv >= 80) add('Alto volume de avaliações (80+)', 6);

    const digitalGaps = [];
    if (tags.includes('Sem Site')) { add('Sem Site', 22); digitalGaps.push('sem site próprio'); }
    if (tags.includes('Site Fora do Ar')) { add('Site Fora do Ar', 18); digitalGaps.push('site fora do ar'); }
    if (tags.includes('Só Link na Bio')) { add('Só Link na Bio', 20); digitalGaps.push('só Link na Bio'); }
    if (tags.includes('E-commerce sem Pixel')) { add('E-commerce sem Pixel', 22); digitalGaps.push('e-commerce sem Pixel'); }
    if (tags.includes('Site sem WhatsApp')) { add('Site sem WhatsApp', 18); digitalGaps.push('site sem WhatsApp'); }
    if (tags.includes('Sem Tráfego Rastreado')) { add('Sem Tráfego Rastreado', 12); digitalGaps.push('sem Pixel/GTM'); }
    if (tags.includes('Sem Mobile')) { add('Sem Mobile', 14); digitalGaps.push('sem mobile'); }
    if (tags.includes('Site Lento')) { add('Site Lento', 10); digitalGaps.push('site lento'); }
    if (tags.includes('Sem HTTPS')) { add('Sem HTTPS', 8); digitalGaps.push('sem HTTPS'); }

    if (hasMobile) add('WhatsApp / celular direto', 15);
    else if (hasEmail) add('E-mail comercial', 5);

    const isDigitallyMature = Boolean(
      lead?.website && audit?.online && audit?.has_whatsapp && (audit?.has_meta_pixel || audit?.has_gtm_or_ads)
    );
    if (isDigitallyMature) {
      add('Site já completo (WhatsApp + Pixel/GTM)', -25);
      highlights.push('Site já completo com WhatsApp e rastreamento');
    }

    const ratingStr = formatRatingPrefix(lead);
    if (ratingStr && digitalGaps.length) {
      highlights.push(`${ratingStr}, mas ${digitalGaps.slice(0, 2).join(' e ')}`);
    } else if (digitalGaps.length) {
      highlights.push(`Brecha digital clara: ${digitalGaps.slice(0, 2).join(' e ')}`);
    } else if (ratingStr) {
      highlights.push(ratingStr);
    }
  } else if (mode === 'venda_direta') {
    score = 30;
    breakdown.push({ fator: 'Base Venda Direta', pontos: 30 });
    if (hasMobile) {
      add('WhatsApp / celular direto', 25);
      highlights.push('WhatsApp/celular direto');
    } else if (hasAnyPhone) {
      add('Telefone cadastrado', 8);
    }

    if (tags.includes('Só Telefone Fixo')) {
      add('Só Telefone Fixo', -15);
    }

    if (totAv >= 150) {
      add(`Alto giro (${totAv} avaliações)`, 30);
      highlights.push(`alto giro (${totAv} avaliações)`);
    } else if (totAv >= 50) {
      add(`Movimento sólido (${totAv} avaliações)`, 15);
      highlights.push(`movimento sólido (${totAv} avaliações)`);
    }

    const cnpjActive = Boolean(
      (cnpjInfo && !cnpjInativo) || (!cnpjInfo && lead?.cnpj && !cnpjInativo)
    );
    if (cnpjActive) {
      add('CNPJ ativo', 15);
      highlights.push('CNPJ ativo');
    }
    if (capital >= 100000) {
      add(`Capital social R$ ${Math.round(capital / 1000)}k`, 12);
      highlights.push(`capital R$ ${Math.round(capital / 1000)}k`);
    } else if (capital >= 50000) {
      add(`Capital social R$ ${Math.round(capital / 1000)}k`, 6);
    }
  } else if (mode === 'novos_entrantes') {
    score = 30;
    breakdown.push({ fator: 'Base Novos Entrantes', pontos: 30 });
    if (tags.includes('Empresa Recente')) {
      add('Empresa Recente (<= 18 meses)', 35);
      highlights.push('empresa aberta há <= 18 meses');
    }
    if (lead?.total_avaliacoes != null && totAv <= 15 && av >= 4.0) {
      add(`Operação nova bem avaliada (${av}★)`, 20);
      highlights.push(`operação nova bem avaliada (${av}★, ${totAv} aval.)`);
    }
    if (hasMobile) {
      add('WhatsApp direto', 18);
      highlights.push('WhatsApp direto');
    }
    if (socios.length) {
      add(`Sócio identificado (${socios[0].split(' ')[0]})`, 10);
      highlights.push(`sócio identificado (${socios[0].split(' ')[0]})`);
    }
    if (tags.includes('Sem Site') || tags.includes('Site sem WhatsApp')) {
      add('Necessidade de estrutura digital', 8);
    }
    if (!tags.includes('Empresa Recente') && totAv > 100) {
      add('Operação já consolidada (> 100 aval.)', -15);
    }
  } else {
    // equilibrado
    score = 35;
    breakdown.push({ fator: 'Base Equilibrado', pontos: 35 });
    if (hasMobile) {
      add('WhatsApp direto', 18);
      highlights.push('WhatsApp direto');
    } else if (hasAnyPhone) {
      add('Telefone cadastrado', 8);
      highlights.push('telefone cadastrado');
    }
    if (hasEmail) add('E-mail comercial', 5);
    if (av >= 4.2) add(`Nota ${av} no Maps`, 10);
    if (totAv >= 20) add(`Reputação (${totAv} avaliações)`, 8);

    const ratingStr = formatRatingPrefix(lead);
    if (ratingStr) highlights.unshift(ratingStr);

    if (tags.some((t) => [
      'Sem Site', 'Site sem WhatsApp', 'Sem Tráfego Rastreado', 'Site Fora do Ar',
      'Só Link na Bio', 'E-commerce sem Pixel', 'Sem Mobile', 'Site Lento',
    ].includes(t))) {
      add('Oportunidade digital aberta', 12);
      highlights.push('oportunidade digital aberta');
    }
    if (tags.includes('Empresa Recente')) add('Empresa Recente', 8);
    if (cnpjInfo && !cnpjInativo) add('CNPJ ativo (BrasilAPI)', 8);
    else if (lead?.cnpj && !cnpjInativo) add('CNPJ informado', 5);
  }

  if (cnpjInativo) {
    const delta = Math.min(score, 10) - score;
    score = Math.min(score, 10);
    if (delta !== 0) breakdown.push({ fator: 'Alerta: CNPJ Inativo', pontos: delta });
    highlights.unshift('Alerta: CNPJ inativo');
  }
  if (waInvalid) {
    score = Math.max(0, score - 20);
    breakdown.push({ fator: 'WhatsApp marcado como inválido', pontos: -20 });
    highlights.push('WhatsApp marcado como inválido');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const potencial = score >= 70 ? 'ALTO' : (score >= 45 ? 'MEDIO' : 'BAIXO');
  const acionavel = !cnpjInativo && !waInvalid && (hasAnyPhone || hasEmail);
  const modeMeta = SCORING_MODES.find((m) => m.id === mode);

  const motivo_destaque = highlights.length
    ? highlights.slice(0, 3).join(' · ')
    : (lead?.segmento ? `Lead ${lead.segmento} em ${lead?.cidade || 'Governador Valadares'}` : 'Lead cadastrado na base');

  return {
    mode,
    mode_label: modeMeta?.short || mode,
    score,
    potencial,
    motivo_destaque,
    etiquetas_dor: tags,
    acionavel,
    breakdown: finalizeBreakdown(breakdown),
    oferta_contexto: null,
  };
}
