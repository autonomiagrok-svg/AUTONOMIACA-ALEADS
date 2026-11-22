import { evaluateLead } from './scoring_modes.js';
import { normalizePhone } from './hygiene.js';

function normText(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function cleanLabel(v, fallback) {
  const s = String(v ?? '').trim();
  return s || fallback;
}

const DIGITAL_GAP_TAGS = new Set(['Sem Site', 'Site Fora do Ar', 'Site sem WhatsApp', 'Sem Tráfego Rastreado', 'Sem HTTPS']);

/**
 * Mapeia Bolsões Territoriais (Cidade + Bairro + Segmento) ranqueados pelo Índice de Oceano Azul.
 */
export function computeTerritoryClusters(leads, { modeOrLens = 'equilibrado', minLeads = 2 } = {}) {
  const list = Array.isArray(leads) ? leads : [];
  const clusterMap = new Map();
  const bairroMap = new Map();

  for (const lead of list) {
    const cidade = cleanLabel(lead?.cidade, 'Governador Valadares');
    const bairro = cleanLabel(lead?.bairro, 'Sem bairro');
    const segmento = cleanLabel(lead?.segmento, 'OUTRO').toUpperCase();
    const evalRes = evaluateLead(lead, modeOrLens);

    const clusterKey = `${normText(cidade)}|${normText(bairro)}|${segmento}`;
    if (!clusterMap.has(clusterKey)) {
      clusterMap.set(clusterKey, {
        key: clusterKey,
        cidade,
        bairro,
        segmento,
        entries: [],
      });
    }
    clusterMap.get(clusterKey).entries.push({ lead, evalRes });

    const bKey = `${normText(cidade)}|${normText(bairro)}`;
    if (!bairroMap.has(bKey)) {
      bairroMap.set(bKey, {
        key: bKey,
        cidade,
        bairro,
        entries: [],
      });
    }
    bairroMap.get(bKey).entries.push({ lead, evalRes });
  }

  function summarizeGroup(group, includeSegment = true) {
    const entries = group.entries;
    const total_leads = entries.length;
    const prontos = entries
      .filter(({ lead, evalRes }) => ['NOVO', 'QUALIFICADO'].includes(lead.status) && evalRes.acionavel)
      .sort((a, b) => b.evalRes.score - a.evalRes.score);
    const ja_abordados = entries.filter(({ lead }) => ['CONTATADO', 'VISITA', 'PROPOSTA', 'CLIENTE'].includes(lead.status)).length;
    const clientes_ativos = entries.filter(({ lead }) => lead.status === 'CLIENTE').length;
    const taxa_penetracao = total_leads ? Math.round((ja_abordados / total_leads) * 1000) / 10 : 0;

    const ratings = entries.map(({ lead }) => Number(lead.avaliacao)).filter((n) => Number.isFinite(n) && n > 0);
    const nota_media = ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100
      : null;

    const score_medio = total_leads
      ? Math.round((entries.reduce((acc, e) => acc + e.evalRes.score, 0) / total_leads) * 10) / 10
      : 0;

    const painCounts = new Map();
    let digitalGapLeads = 0;
    for (const { evalRes } of entries) {
      const tags = evalRes.etiquetas_dor || [];
      if (tags.some((t) => DIGITAL_GAP_TAGS.has(t))) digitalGapLeads++;
      for (const t of tags) {
        if (t === 'CNPJ Inativo') continue;
        painCounts.set(t, (painCounts.get(t) || 0) + 1);
      }
    }

    let dor_dominante = null;
    let dor_dominante_count = 0;
    for (const [tag, count] of painCounts.entries()) {
      if (count > dor_dominante_count) {
        dor_dominante = tag;
        dor_dominante_count = count;
      }
    }
    const dor_dominante_pct = total_leads && dor_dominante
      ? Math.round((dor_dominante_count / total_leads) * 100)
      : 0;
    const digitalGapPct = total_leads ? (digitalGapLeads / total_leads) * 100 : 0;

    let ocean = 0;
    ocean += Math.min(28, prontos.length * 3.5);
    ocean += (score_medio / 100) * 32;
    ocean += (digitalGapPct / 100) * 18;
    ocean += ((100 - taxa_penetracao) / 100) * 22;
    if (prontos.length === 0) ocean = Math.min(ocean, 15);
    const indice_oceano_azul = Math.max(0, Math.min(100, Math.round(ocean)));

    const out = {
      key: group.key,
      cidade: group.cidade,
      bairro: group.bairro,
      total_leads,
      prontos_para_abordar: prontos.length,
      ja_abordados,
      clientes_ativos,
      tem_cliente_local: clientes_ativos > 0,
      taxa_penetracao,
      nota_media,
      dor_dominante,
      dor_dominante_pct,
      score_medio,
      indice_oceano_azul,
      lead_ids_prontos: prontos.map((e) => e.lead.id),
    };
    if (includeSegment) out.segmento = group.segmento;
    return out;
  }

  const bolsoes = [...clusterMap.values()]
    .filter((g) => g.entries.length >= minLeads)
    .map((g) => summarizeGroup(g, true))
    .sort((a, b) => b.indice_oceano_azul - a.indice_oceano_azul || b.prontos_para_abordar - a.prontos_para_abordar);

  const resumo_bairros = [...bairroMap.values()]
    .filter((g) => g.entries.length >= minLeads)
    .map((g) => summarizeGroup(g, false))
    .sort((a, b) => b.indice_oceano_azul - a.indice_oceano_azul || b.prontos_para_abordar - a.prontos_para_abordar);

  return {
    bolsoes,
    resumo_bairros,
    total_bolsoes: bolsoes.length,
  };
}

function tokenizeCategory(cat) {
  return new Set(
    normText(cat)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  );
}

/**
 * Encontra os leads mais parecidos com um lead de referência (Motor Lookalike determinístico 0–100%).
 */
export function findLookalikeLeads(referenceLead, allLeads, options = {}) {
  if (!referenceLead || !Array.isArray(allLeads)) return [];
  const {
    limit = 25,
    excludeContacted = true,
    modeOrLens = 'equilibrado',
  } = options;

  const refEval = evaluateLead(referenceLead, modeOrLens);
  const refTags = new Set(refEval.etiquetas_dor || []);
  const refSeg = String(referenceLead.segmento || 'OUTRO').toUpperCase();
  const refCatTokens = tokenizeCategory(referenceLead.categoria_raw || referenceLead.subsegmento || '');
  const refBairro = normText(referenceLead.bairro);
  const refCidade = normText(referenceLead.cidade || 'Governador Valadares');
  const refUf = normText(referenceLead.uf || 'MG');
  const refAv = Number(referenceLead.avaliacao);
  const refTotAv = Number(referenceLead.total_avaliacoes);

  const results = [];

  for (const cand of allLeads) {
    if (!cand || cand.id === referenceLead.id) continue;
    if (cand.status === 'DESCARTADO') continue;
    if (cand.whatsapp_status === 'INVALIDO') continue;
    if (excludeContacted && !['NOVO', 'QUALIFICADO'].includes(cand.status)) continue;

    const candEval = evaluateLead(cand, modeOrLens);
    const candTags = new Set(candEval.etiquetas_dor || []);
    if (candTags.has('CNPJ Inativo')) continue;

    let similarity = 0;
    const razoes_match = [];

    // 1. Segmento / Categoria (30 pts)
    const candSeg = String(cand.segmento || 'OUTRO').toUpperCase();
    if (candSeg === refSeg) {
      similarity += 22;
      razoes_match.push(`Mesmo segmento (${candSeg})`);
    }
    const candCatTokens = tokenizeCategory(cand.categoria_raw || cand.subsegmento || '');
    if (refCatTokens.size > 0 && candCatTokens.size > 0) {
      let overlap = 0;
      for (const tok of refCatTokens) {
        if (candCatTokens.has(tok)) overlap++;
      }
      if (overlap > 0) similarity += 8;
    }

    // 2. Proximidade Territorial (25 pts)
    const candBairro = normText(cand.bairro);
    const candCidade = normText(cand.cidade || 'Governador Valadares');
    const candUf = normText(cand.uf || 'MG');
    let mesmo_bairro = false;

    if (refBairro && candBairro && candBairro === refBairro && candCidade === refCidade) {
      similarity += 25;
      mesmo_bairro = true;
      razoes_match.unshift(`Mesmo bairro (${cand.bairro})`);
    } else if (candCidade && candCidade === refCidade) {
      similarity += 14;
      razoes_match.push(`Mesma cidade (${cand.cidade || 'Governador Valadares'})`);
    } else if (candUf && candUf === refUf) {
      similarity += 4;
    }

    // 3. Sobreposição de Dores — Jaccard (20 pts)
    const commonPains = [];
    for (const t of refTags) {
      if (candTags.has(t)) commonPains.push(t);
    }
    const unionSize = new Set([...refTags, ...candTags]).size;
    if (unionSize > 0 && commonPains.length > 0) {
      const jaccard = commonPains.length / unionSize;
      similarity += Math.round(jaccard * 20);
      razoes_match.push(`Dores em comum: ${commonPains.slice(0, 2).join(', ')}`);
    }

    // 4. Faixa de Porte / Reputação (15 pts)
    const candAv = Number(cand.avaliacao);
    const candTotAv = Number(cand.total_avaliacoes);
    let repPts = 0;
    if (Number.isFinite(refAv) && refAv > 0 && Number.isFinite(candAv) && candAv > 0) {
      const diffAv = Math.abs(refAv - candAv);
      if (diffAv <= 0.4) repPts += 8;
      else if (diffAv <= 0.8) repPts += 5;
      else if (diffAv <= 1.2) repPts += 2;
    }
    if (Number.isFinite(refTotAv) && refTotAv > 0 && Number.isFinite(candTotAv) && candTotAv > 0) {
      const logDiff = Math.abs(Math.log10(refTotAv + 1) - Math.log10(candTotAv + 1));
      if (logDiff <= 0.35) repPts += 7;
      else if (logDiff <= 0.7) repPts += 4;
      else if (logDiff <= 1.1) repPts += 2;
    } else if (cand.potencial && referenceLead.potencial && cand.potencial === referenceLead.potencial) {
      repPts += 6;
    }
    similarity += Math.min(15, repPts);
    if (repPts >= 8 && Number.isFinite(candAv) && candAv > 0) {
      razoes_match.push(`Reputação similar (${candAv}★)`);
    }

    // 5. Acionabilidade de Canal (10 pts)
    const waNorm = normalizePhone(cand.whatsapp);
    const telNorm = normalizePhone(cand.telefone);
    const hasMobile = (waNorm.valido && waNorm.whatsapp_provavel) || (telNorm.valido && telNorm.whatsapp_provavel);
    const hasFixo = waNorm.valido || telNorm.valido;
    if (hasMobile) {
      similarity += 10;
      razoes_match.push('WhatsApp direto disponível');
    } else if (hasFixo) {
      similarity += 4;
    }

    results.push({
      lead: cand,
      similarity_score: Math.max(0, Math.min(100, Math.round(similarity))),
      mesmo_bairro,
      razoes_match: razoes_match.slice(0, 4),
    });
  }

  results.sort((a, b) => {
    if (b.similarity_score !== a.similarity_score) return b.similarity_score - a.similarity_score;
    if (a.mesmo_bairro !== b.mesmo_bairro) return a.mesmo_bairro ? -1 : 1;
    return Number(b.lead.avaliacao || 0) - Number(a.lead.avaliacao || 0);
  });

  return results.slice(0, limit);
}
