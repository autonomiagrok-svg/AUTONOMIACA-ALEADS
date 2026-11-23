import { evaluateLead } from './scoring_modes.js';
import { hashString, toIsoDateLocal, addDaysIsoDate, extractContactProfile } from './domain_signals.js';

export const OUTBOUND_TYPES = new Set(['WHATSAPP', 'LIGACAO', 'EMAIL', 'VISITA', 'FOLLOWUP', 'PROPOSTA']);
export const CLIENT_SIGNALS = ['SEM_RESPOSTA', 'PEDIU_DEPOIS', 'OBJECAO_PRECO', 'TEM_FORNECEDOR', 'PEDIU_PROPOSTA', 'QUENTE'];

export const STAGE_SLA_DAYS = {
  VISITA: 2,
  CONTATADO: 3,
  PROPOSTA: 4,
  CLIENTE: 25,
};

const TOTAL_VARIATIONS = 3;

function parseTimestamp(val) {
  if (!val) return null;
  const s = String(val).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

function diffDaysInt(fromMs, toMs) {
  if (fromMs === null || toMs === null) return 0;
  return Math.max(0, Math.floor((toMs - fromMs) / 86400000));
}

function firstPartnerName(lead) {
  const socios = Array.isArray(lead?.socios) && lead.socios.length
    ? lead.socios
    : (Array.isArray(lead?.diagnostico_fatos?.cnpj_info?.socios) ? lead.diagnostico_fatos.cnpj_info.socios : []);
  const first = String(socios[0] || '').trim().split(/\s+/)[0] || '';
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function preferredChannel(lead) {
  const contact = extractContactProfile(lead);
  if (contact.hasMobile) return 'WHATSAPP';
  if (contact.hasAnyPhone) return 'LIGACAO';
  if (contact.hasEmail) return 'EMAIL';
  return 'WHATSAPP';
}

/**
 * Analisa temperatura, SLA, bucket operacional e Valor em Risco (priority_score) de um lead.
 */
export function analyzeLeadCadence(lead, { now = new Date(), modeId = 'equilibrado' } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const todayStr = toIsoDateLocal(nowDate);
  const plus3Str = addDaysIsoDate(nowDate, 3);

  const evalRes = evaluateLead(lead, modeId);
  const interacoes = Array.isArray(lead?.interacoes) ? lead.interacoes : [];
  const outbound = interacoes.filter((ix) => OUTBOUND_TYPES.has(ix?.tipo));
  const tentativas_contato = outbound.length;

  let lastTouchMs = null;
  for (const ix of outbound) {
    const ms = parseTimestamp(ix.criado_em);
    if (ms !== null && (lastTouchMs === null || ms > lastTouchMs)) {
      lastTouchMs = ms;
    }
  }
  if (lastTouchMs === null) {
    lastTouchMs = parseTimestamp(lead?.ultimo_contato_em)
      ?? (lead?.status === 'CLIENTE' ? parseTimestamp(lead?.convertido_em) : null)
      ?? parseTimestamp(lead?.atualizado_em)
      ?? parseTimestamp(lead?.criado_em);
  }

  const ultimo_toque_em = lastTouchMs !== null ? new Date(lastTouchMs).toISOString() : null;
  const dias_sem_contato = lastTouchMs !== null ? diffDaysInt(lastTouchMs, nowMs) : 0;

  const ultimo_sinal = CLIENT_SIGNALS.includes(lead?.ultimo_sinal) ? lead.ultimo_sinal : null;
  const sla_estagio_dias = STAGE_SLA_DAYS[lead?.status] || 3;
  const ratio = dias_sem_contato / sla_estagio_dias;

  let temperatura = 'MORNO';
  if ((ultimo_sinal === 'QUENTE' || ultimo_sinal === 'PEDIU_PROPOSTA') && ratio <= 1.2) {
    temperatura = 'QUENTE';
  } else if (ratio <= 0.6 && ultimo_sinal !== 'SEM_RESPOSTA') {
    temperatura = 'QUENTE';
  } else if (ratio <= 1.0) {
    temperatura = 'MORNO';
  } else if (ratio <= 2.0) {
    temperatura = 'ESFRIANDO';
  } else {
    temperatura = 'CONGELADO';
  }

  const status = lead?.status || 'NOVO';
  const isActive = status !== 'DESCARTADO';
  const prox = lead?.proximo_contato ? String(lead.proximo_contato).slice(0, 10) : null;
  const hibernarAte = lead?.hibernar_ate ? String(lead.hibernar_ate).slice(0, 10) : null;
  const isHibernating = Boolean(hibernarAte && hibernarAte > todayStr);

  const isCnpjInativo = evalRes.etiquetas_dor.includes('CNPJ Inativo');
  const isWaInvalid = lead?.whatsapp_status === 'INVALIDO';

  let bucket = 'EM_DIA';
  if (isHibernating) {
    bucket = 'EM_DIA';
  } else if (isActive && prox && prox < todayStr) {
    bucket = 'ATRASADO';
  } else if (isActive && prox && prox === todayStr) {
    bucket = 'HOJE';
  } else if (['PROPOSTA', 'VISITA'].includes(status) && (!prox || prox < todayStr) && dias_sem_contato >= sla_estagio_dias) {
    bucket = 'PROPOSTA_PARADA';
  } else if (status === 'CONTATADO' && (!prox || prox < todayStr) && dias_sem_contato >= 3) {
    bucket = 'SEM_RESPOSTA';
  } else if (status === 'CLIENTE' && !prox && dias_sem_contato >= 25) {
    bucket = 'POS_VENDA';
  } else if (status === 'DESCARTADO' && !isCnpjInativo && !isWaInvalid && dias_sem_contato >= 45 && evalRes.score >= 60) {
    bucket = 'REATIVACAO';
  } else if (isActive && prox && prox > todayStr && prox <= plus3Str) {
    bucket = 'PROXIMOS_DIAS';
  }

  // Cálculo do "Valor em Risco" (priority_score 0..100)
  const stageWeights = {
    PROPOSTA: 36,
    VISITA: 31,
    CLIENTE: bucket === 'POS_VENDA' ? 24 : 10,
    CONTATADO: 18,
    QUALIFICADO: 14,
    NOVO: 10,
    DESCARTADO: 6,
  };
  let priority = stageWeights[status] ?? 10;
  priority += Math.round(evalRes.score * 0.35);

  if (prox && prox < todayStr) {
    const proxMs = parseTimestamp(prox);
    const todayMs = parseTimestamp(todayStr);
    const atraso = diffDaysInt(proxMs, todayMs);
    priority += Math.min(20, atraso * 4);
  } else {
    priority += Math.min(18, Math.floor((dias_sem_contato / sla_estagio_dias) * 6));
  }

  if (ultimo_sinal === 'QUENTE' || ultimo_sinal === 'PEDIU_PROPOSTA') priority += 15;
  else if (ultimo_sinal === 'PEDIU_DEPOIS') priority += 8;

  if (bucket === 'PROPOSTA_PARADA') priority += 8;
  if (isCnpjInativo) priority = Math.min(priority, 10);

  const priority_score = Math.max(0, Math.min(100, Math.round(priority)));

  return {
    tentativas_contato,
    ultimo_toque_em,
    dias_sem_contato,
    ultimo_sinal,
    sla_estagio_dias,
    temperatura,
    bucket,
    priority_score,
    mode_score: evalRes.score,
    mode_potencial: evalRes.potencial,
    etiquetas_dor: evalRes.etiquetas_dor,
    motivo_destaque: evalRes.motivo_destaque,
    acionavel: evalRes.acionavel,
  };
}

/**
 * Máquina de estados que define a melhor próxima ação, canal e salto de dias.
 */
export function recommendNextStep(lead, cadenceInfo) {
  const info = cadenceInfo || analyzeLeadCadence(lead);
  const status = lead?.status || 'NOVO';
  const sinal = info.ultimo_sinal;
  const contact = extractContactProfile(lead);
  const hasPhone = contact.hasAnyPhone;
  const hasEmail = contact.hasEmail;
  const baseChannel = preferredChannel(lead);

  if (sinal === 'OBJECAO_PRECO') {
    return {
      acao_titulo: 'Contornar objeção de preço focando em ROI',
      canal_sugerido: baseChannel,
      estrategia: 'OBJECAO_PRECO',
      alerta_excesso: false,
      proximo_salto_dias: 3,
    };
  }

  if (sinal === 'PEDIU_DEPOIS') {
    return {
      acao_titulo: 'Retomar conversa no prazo combinado',
      canal_sugerido: baseChannel,
      estrategia: 'PEDIU_DEPOIS',
      alerta_excesso: false,
      proximo_salto_dias: 5,
    };
  }

  if (sinal === 'TEM_FORNECEDOR') {
    return {
      acao_titulo: 'Mostrar diferencial complementar sem confronto',
      canal_sugerido: baseChannel,
      estrategia: 'TEM_FORNECEDOR',
      alerta_excesso: false,
      proximo_salto_dias: 7,
    };
  }

  if (status === 'CLIENTE' || info.bucket === 'POS_VENDA') {
    return {
      acao_titulo: 'Check-in de pós-venda e novas demandas',
      canal_sugerido: baseChannel,
      estrategia: 'CHECKIN_POS_VENDA',
      alerta_excesso: false,
      proximo_salto_dias: 30,
    };
  }

  if (status === 'DESCARTADO' || info.bucket === 'REATIVACAO') {
    return {
      acao_titulo: 'Reativação leve com novo gancho',
      canal_sugerido: baseChannel,
      estrategia: 'REATIVACAO',
      alerta_excesso: false,
      proximo_salto_dias: 5,
    };
  }

  if (status === 'PROPOSTA' || status === 'VISITA') {
    return {
      acao_titulo: 'Destravar decisão de proposta/visita',
      canal_sugerido: baseChannel,
      estrategia: 'DESTRAVAR_DECISAO',
      alerta_excesso: false,
      proximo_salto_dias: 3,
    };
  }

  const tentativas = info.tentativas_contato;
  if (tentativas <= 1) {
    return {
      acao_titulo: '1º resgate leve de acompanhamento',
      canal_sugerido: baseChannel,
      estrategia: 'RESGATE_LEVE',
      alerta_excesso: false,
      proximo_salto_dias: 3,
    };
  }

  if (tentativas === 2) {
    return {
      acao_titulo: '2º toque com novo ângulo de dor real',
      canal_sugerido: baseChannel,
      estrategia: 'NOVO_ANGULO_DOR',
      alerta_excesso: false,
      proximo_salto_dias: 4,
    };
  }

  if (tentativas === 3) {
    const canalAlternativo = hasPhone ? 'LIGACAO' : (hasEmail ? 'EMAIL' : 'WHATSAPP');
    return {
      acao_titulo: canalAlternativo === 'WHATSAPP'
        ? '3º toque direto e objetivo'
        : `3º toque: alternar canal para ${canalAlternativo === 'LIGACAO' ? 'Ligação' : 'E-mail'}`,
      canal_sugerido: canalAlternativo,
      estrategia: 'TROCA_CANAL',
      alerta_excesso: false,
      proximo_salto_dias: 5,
    };
  }

  return {
    acao_titulo: '4º+ toque sem resposta — Break-up elegante ou Hibernar (+45d)',
    canal_sugerido: baseChannel,
    estrategia: 'BREAKUP_ELEGANTE',
    alerta_excesso: true,
    proximo_salto_dias: 45,
  };
}

/**
 * Gera follow-up consciente de contexto (estratégia, sinal, nota e dor real) com 3 variações anti-repetição.
 */
export function generateSmartFollowUp(lead, { operador = 'Rafael Oliveira', modeId = 'equilibrado', variationIndex = null, now = new Date() } = {}) {
  const cadence = analyzeLeadCadence(lead, { now, modeId });
  const next = recommendNextStep(lead, cadence);

  const rawIdx = variationIndex !== null && variationIndex !== undefined
    ? Number(variationIndex)
    : hashString(`${lead?.id || lead?.nome_fantasia || ''}:${next.estrategia}`);
  const idx = ((Number.isFinite(rawIdx) ? rawIdx : 0) % TOTAL_VARIATIONS + TOTAL_VARIATIONS) % TOTAL_VARIATIONS;

  const nome = lead?.nome_fantasia || 'sua empresa';
  const partner = firstPartnerName(lead);
  const saudacao = partner ? `Olá ${partner}` : `Olá, equipe da ${nome}`;
  const op = operador || 'Rafael Oliveira';
  const dor = cadence.etiquetas_dor?.[0] || null;
  const av = lead?.avaliacao;
  const notaCtx = lead?.proximo_contato_nota || lead?.ultimo_sinal_nota || '';

  const painSnippet = (() => {
    if (dor === 'Site sem WhatsApp') return `vi que o site da ${nome} ainda não tem botão direto para o WhatsApp`;
    if (dor === 'Sem Site' || dor === 'Site Fora do Ar') return `notei que quem busca a ${nome} no Google ainda não encontra uma página própria com contato imediato`;
    if (dor === 'Sem Tráfego Rastreado') return `percebi que o site da ${nome} ainda está sem rastreamento de conversão (Pixel/Google Tag)`;
    if (av != null) return `acompanhando a ótima nota da ${nome} no Google (${av}★)`;
    return `pensando nos ganhos práticos de atendimento e automação para a ${nome}`;
  })();

  const notaLine = notaCtx ? ` (sobre: ${notaCtx})` : '';

  const scripts = {
    RESGATE_LEVE: [
      `${saudacao}, tudo bem? Aqui é ${op} da AutonomIA Systems. Passando só para saber se conseguiram ver minha mensagem anterior${notaLine} — sem pressa, fico à disposição!`,
      `${saudacao}! ${op} por aqui novamente (AutonomIA Systems). Sei que a rotina na ${nome} é corrida, então trouxe um oi rápido para ver se faz sentido retomarmos aquela conversa${notaLine}.`,
      `Oi, ${partner || `pessoal da ${nome}`}! Aqui é ${op}. Só confirmando se o assunto de automação e ganho de eficiência na ${nome}${notaLine} ficou no radar de vocês para esta semana.`,
    ],
    NOVO_ANGULO_DOR: [
      `${saudacao}! Aqui é ${op} da AutonomIA Systems. Olhando por outro ângulo: ${painSnippet}. Posso te mostrar em 2 minutos como resolvemos isso sem mudar sua rotina?`,
      `${saudacao}, tudo certo? ${op} falando. Em vez de algo genérico, fui direto ao ponto sobre a ${nome}: ${painSnippet}. Quer que eu envie um exemplo rápido de aplicação?`,
      `Oi, ${partner || `time da ${nome}`}! Aqui é ${op} (AutonomIA Systems). Trouxe uma ideia específica: ${painSnippet} — e isso costuma liberar horas da equipe toda semana. Faz sentido dar uma olhada?`,
    ],
    TROCA_CANAL: [
      `${saudacao}, aqui é ${op} da AutonomIA Systems. Como sei que o WhatsApp costuma lotar, tentei mudar o canal para falar rapidamente sobre ${nome}${notaLine}. Qual o melhor horário de 5 min hoje ou amanhã?`,
      `${saudacao}! Sou ${op} da AutonomIA Systems. Estou passando por este canal para não acumular mensagens no seu WhatsApp — sobre a ${nome}, ${painSnippet}. Podemos alinhar rapidamente?`,
      `Olá, ${partner || `responsável pela ${nome}`}! Aqui é ${op} (AutonomIA Systems). Prefiro ser objetivo por aqui: temos uma solução enxuta para ${nome} e queria validar se é prioridade agora ou se pauso por aqui.`,
    ],
    BREAKUP_ELEGANTE: [
      `${saudacao}, tudo bem? Aqui é ${op} da AutonomIA Systems. Como não tivemos retorno nas últimas tentativas, vou encerrar meu acompanhamento por agora para não incomodar. Se fizer sentido no futuro na ${nome}, é só chamar!`,
      `${saudacao}! Passando apenas para dar um fechamento respeitoso: imagino que a agenda da ${nome} esteja focada em outras prioridades no momento. Vou pausar os contatos por aqui e fico à disposição quando precisarem.`,
      `Oi, ${partner || `equipe da ${nome}`}! Aqui é ${op}. Para não ser inconveniente, este é meu último contato desta rodada. Caso automatizar rotinas ou captação volte para a pauta da ${nome}, meu contato continua aberto.`,
    ],
    DESTRAVAR_DECISAO: [
      `${saudacao}! Aqui é ${op} da AutonomIA Systems. Passando para acompanhar o que alinhamos para a ${nome}${notaLine} — ficou alguma dúvida técnica ou ajuste de escopo que eu possa esclarecer hoje?`,
      `${saudacao}, tudo bem? ${op} por aqui. Queria validar como estão os próximos passos da proposta para a ${nome}${notaLine}. Precisa de algum resumo rápido para apresentar internamente?`,
      `Oi, ${partner || `time da ${nome}`}! Sou ${op} (AutonomIA Systems). Para organizar nossa agenda de implantação deste mês, você já conseguiu avaliar o material da ${nome}${notaLine}?`,
    ],
    OBJECAO_PRECO: [
      `${saudacao}! Aqui é ${op} da AutonomIA Systems. Pensando no que você comentou sobre investimento na ${nome}, montei uma opção de entrada enxuta focada em retorno rápido no atendimento. Faz sentido te mostrar os números?`,
      `${saudacao}, tudo certo? ${op} falando. Sobre o ponto de orçamento da ${nome}, o foco do nosso modelo é se pagar já nas primeiras semanas reduzindo perda de leads e horas manuais. Quer simular um escopo menor para começar?`,
      `Oi, ${partner || `equipe da ${nome}`}! Aqui é ${op}. Reavaliando o cenário da ${nome}, conseguimos modular a implantação por etapas para caber fácil no caixa atual. Posso te mandar essa alternativa enxuta?`,
    ],
    PEDIU_DEPOIS: [
      `${saudacao}, tudo bem? Aqui é ${op} da AutonomIA Systems. Conforme combinamos anteriormente${notaLine}, estou retomando hoje para vermos como está o momento da ${nome}. Podemos falar rapidinho?`,
      `${saudacao}! Combinado cumprido: aqui é ${op} retornando no prazo que você pediu${notaLine}. A agenda da ${nome} está mais tranquila agora para olharmos aquela demonstração de 10 minutos?`,
      `Oi, ${partner || `pessoal da ${nome}`}! Sou ${op} (AutonomIA Systems). Passando conforme combinado${notaLine} para saber se este é um bom momento para avançarmos com a ${nome}.`,
    ],
    TEM_FORNECEDOR: [
      `${saudacao}! Aqui é ${op} da AutonomIA Systems. Respeito totalmente o parceiro atual da ${nome} — nossa proposta não é trocar o que já funciona, e sim acoplar automação e IA onde ainda há gargalo manual. Faz sentido comparar?`,
      `${saudacao}, tudo bem? ${op} falando. Sei que a ${nome} já conta com fornecedor hoje, mas muitos clientes nossos usam nossos agentes inteligentes de forma complementar para acelerar o WhatsApp. Posso te mostrar como convive junto?`,
      `Oi, ${partner || `equipe da ${nome}`}! Aqui é ${op}. Mesmo já tendo suporte atual na ${nome}, vale sempre ter uma segunda referência de velocidade e atendimento com IA — posso te enviar um comparativo rápido sem compromisso?`,
    ],
    CHECKIN_POS_VENDA: [
      `${saudacao}! Aqui é ${op} da AutonomIA Systems. Faz um tempo que implantamos por aí — passando para saber como estão os resultados na ${nome} e se há algum novo fluxo que queiram automatizar.`,
      `${saudacao}, tudo ótimo? ${op} passando para o check-in periódico da ${nome}! Como a equipe tem sentido a operação no dia a dia? Tem alguma melhoria nova no radar?`,
      `Oi, ${partner || `time da ${nome}`}! Aqui é ${op} (AutonomIA Systems). Passando para acompanhar o desempenho da ${nome} e verificar se podemos ajudar com novos módulos ou integrações este mês.`,
    ],
    REATIVACAO: [
      `${saudacao}, tudo bem? Aqui é ${op} da AutonomIA Systems. Faz um tempo desde nossa última conversa com a ${nome}, e evoluímos bastante nossos agentes digitais para empresas da região. Vale uma conversa rápida de atualização?`,
      `${saudacao}! Sou ${op} da AutonomIA Systems. Passando depois de um tempo para contar que lançamos fluxos novos voltados ao setor da ${nome} — se quiser ver o que mudou em 3 minutos, me avisa!`,
      `Oi, ${partner || `pessoal da ${nome}`}! Aqui é ${op}. Reabrindo contato leve após algumas semanas: caso automatizar atendimento e processos tenha voltado a ser prioridade na ${nome}, estou por aqui.`,
    ],
  };

  const pool = scripts[next.estrategia] || scripts.RESGATE_LEVE;
  return {
    text: pool[idx % pool.length],
    estrategia: next.estrategia,
    canal_sugerido: next.canal_sugerido,
    acao_titulo: next.acao_titulo,
    alerta_excesso: next.alerta_excesso,
    proximo_salto_dias: next.proximo_salto_dias,
    variation_index: idx,
    total_variations: TOTAL_VARIATIONS,
  };
}
