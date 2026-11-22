import { analyzeLeadCadence, CLIENT_SIGNALS } from './cadence_engine.js';

function inferOriginLabel(lead) {
  const fonte = String(lead?.fonte || '');
  const url = String(lead?.fonte_url || '');
  const lote = String(lead?.lote_origem || '');
  if (lead?.fonte_tipo === 'MAPS' || /google\s*maps/i.test(fonte) || url.includes('google.com/maps')) return 'Maps';
  if (/openstreetmap|overpass/i.test(fonte) || url.includes('openstreetmap.org')) return 'OSM';
  if (/csv|importa[cç][aã]o/i.test(fonte) || /^CSV\s*•/i.test(lote)) return 'CSV';
  return 'Manual';
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Transforma o histórico dos leads em inteligência acionável de cadência e conversão.
 */
export function computeRelationshipInsights(leads, { now = new Date(), modeId = 'equilibrado' } = {}) {
  const list = Array.isArray(leads) ? leads : [];
  const temperaturas = { QUENTE: 0, MORNO: 0, ESFRIANDO: 0, CONGELADO: 0 };
  const buckets = {
    ATRASADO: 0,
    HOJE: 0,
    PROPOSTA_PARADA: 0,
    SEM_RESPOSTA: 0,
    POS_VENDA: 0,
    REATIVACAO: 0,
    PROXIMOS_DIAS: 0,
    EM_DIA: 0,
  };

  const toques = {
    '1': { contatados: 0, avancos: 0 },
    '2': { contatados: 0, avancos: 0 },
    '3+': { contatados: 0, avancos: 0 },
  };

  const originMap = new Map([
    ['Maps', { origem: 'Maps', total: 0, contatados: 0, avancos: 0 }],
    ['OSM', { origem: 'OSM', total: 0, contatados: 0, avancos: 0 }],
    ['CSV', { origem: 'CSV', total: 0, contatados: 0, avancos: 0 }],
    ['Manual', { origem: 'Manual', total: 0, contatados: 0, avancos: 0 }],
  ]);

  const dorMap = new Map();
  const sinais = {};
  for (const s of CLIENT_SIGNALS) sinais[s] = 0;

  let totalAvancos = 0;
  let avancosApos2OuMais = 0;

  for (const lead of list) {
    const cad = analyzeLeadCadence(lead, { now, modeId });
    buckets[cad.bucket] = (buckets[cad.bucket] || 0) + 1;

    if (lead.status !== 'DESCARTADO') {
      temperaturas[cad.temperatura] = (temperaturas[cad.temperatura] || 0) + 1;
    }

    if (cad.ultimo_sinal) {
      sinais[cad.ultimo_sinal] = (sinais[cad.ultimo_sinal] || 0) + 1;
    }

    const isAdvanced = ['VISITA', 'PROPOSTA', 'CLIENTE'].includes(lead.status);
    const isContacted = cad.tentativas_contato >= 1 || ['CONTATADO', 'VISITA', 'PROPOSTA', 'CLIENTE'].includes(lead.status);

    if (isContacted) {
      const touchCount = Math.max(1, cad.tentativas_contato);
      const bucketKey = touchCount === 1 ? '1' : (touchCount === 2 ? '2' : '3+');
      toques[bucketKey].contatados++;
      if (isAdvanced) {
        toques[bucketKey].avancos++;
        totalAvancos++;
        if (touchCount >= 2) avancosApos2OuMais++;
      }
    }

    const origLabel = inferOriginLabel(lead);
    const origStats = originMap.get(origLabel);
    origStats.total++;
    if (isContacted) origStats.contatados++;
    if (isAdvanced) origStats.avancos++;

    const dores = Array.isArray(cad.etiquetas_dor) ? cad.etiquetas_dor : [];
    for (const dor of dores) {
      if (!dorMap.has(dor)) dorMap.set(dor, { dor, total: 0, contatados: 0, avancos: 0 });
      const dStats = dorMap.get(dor);
      dStats.total++;
      if (isContacted) dStats.contatados++;
      if (isAdvanced) dStats.avancos++;
    }
  }

  const efetividade_por_toque = {
    '1': { ...toques['1'], taxa_avanco: pct(toques['1'].avancos, toques['1'].contatados) },
    '2': { ...toques['2'], taxa_avanco: pct(toques['2'].avancos, toques['2'].contatados) },
    '3+': { ...toques['3+'], taxa_avanco: pct(toques['3+'].avancos, toques['3+'].contatados) },
    percentual_avancos_2plus: pct(avancosApos2OuMais, totalAvancos),
    resumo: totalAvancos
      ? `${pct(avancosApos2OuMais, totalAvancos)}% dos avanços acontecem a partir do 2º toque`
      : 'Registre contatos e avanços para medir a curva de toques.',
  };

  const conversao_por_origem = [...originMap.values()].map((o) => ({
    ...o,
    taxa_avanco: pct(o.avancos, o.contatados),
  }));

  const conversao_por_dor = [...dorMap.values()]
    .map((d) => ({ ...d, taxa_avanco: pct(d.avancos, d.contatados) }))
    .sort((a, b) => b.avancos - a.avancos || b.total - a.total);

  const urgentes_hoje =
    buckets.ATRASADO +
    buckets.HOJE +
    buckets.PROPOSTA_PARADA +
    buckets.SEM_RESPOSTA +
    buckets.POS_VENDA;

  let gargalo_principal = 'Funil equilibrado — mantenha cadência ativa no Power Dialer.';
  if (buckets.PROPOSTA_PARADA > 0) {
    gargalo_principal = `${buckets.PROPOSTA_PARADA} lead(s) em PROPOSTA/VISITA parado(s) além do SLA — maior risco imediato de receita.`;
  } else if (buckets.ATRASADO > 0) {
    gargalo_principal = `${buckets.ATRASADO} follow-up(s) atrasado(s) na agenda — priorize retomada imediata.`;
  } else if (buckets.SEM_RESPOSTA > 0) {
    gargalo_principal = `${buckets.SEM_RESPOSTA} leads em CONTATADO sem retorno há mais de 3 dias — maior alavanca imediata do dia.`;
  } else if (buckets.POS_VENDA > 0) {
    gargalo_principal = `${buckets.POS_VENDA} cliente(s) há mais de 25 dias sem check-in de pós-venda.`;
  } else if (buckets.HOJE > 0) {
    gargalo_principal = `${buckets.HOJE} compromisso(s) agendado(s) para hoje na Agenda.`;
  }

  return {
    total_leads: list.length,
    urgentes_hoje,
    temperaturas,
    buckets,
    efetividade_por_toque,
    conversao_por_origem,
    conversao_por_dor,
    sinais,
    gargalo_principal,
  };
}
