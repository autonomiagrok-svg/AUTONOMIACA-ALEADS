import { evaluateLead } from './scoring_modes.js';
import { hashString } from './domain_signals.js';

const TOTAL_VARIATIONS = 4;

function titleFirstName(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function formatSegment(seg) {
  const map = {
    RESTAURANTE: 'restaurante',
    BAR: 'bar',
    LANCHONETE: 'lanchonete',
    PADARIA: 'padaria',
    MERCADO: 'mercado',
    SUPERMERCADO: 'supermercado',
    ADEGA: 'adega',
    HOTEL: 'hotel',
    EVENTOS: 'espaço de eventos',
    CLINICA: 'clínica',
    ACADEMIA: 'academia',
    OFICINA: 'oficina',
    FARMACIA: 'farmácia',
    SALAO: 'salão',
    IMOBILIARIA: 'imobiliária',
    ESCRITORIO: 'escritório',
    LOJA: 'loja',
    OUTRO: 'empresa',
  };
  return map[String(seg || '').toUpperCase()] || 'empresa';
}

function buildOpening(lead, op, idx, socialProof) {
  const nome = lead?.nome_fantasia || 'sua empresa';
  const cidade = lead?.cidade || 'sua cidade';
  const seg = formatSegment(lead?.segmento);
  const socios = Array.isArray(lead?.socios) && lead.socios.length
    ? lead.socios
    : (Array.isArray(lead?.diagnostico_fatos?.cnpj_info?.socios) ? lead.diagnostico_fatos.cnpj_info.socios : []);
  const socioNome = titleFirstName(socios[0]);
  const av = lead?.avaliacao;
  const totAv = lead?.total_avaliacoes;

  if (socialProof?.ativo) {
    const spSeg = formatSegment(socialProof.segmento || lead?.segmento);
    const localRef = socialProof.bairro
      ? `aqui no bairro ${socialProof.bairro}`
      : `aqui em ${socialProof.cidade || cidade}`;
    const saudacao = socioNome ? `Olá ${socioNome}, tudo bem?` : `Olá, equipe da ${nome}! Tudo bem?`;
    const vars = [
      `${saudacao} Aqui é ${op} da AutonomIA Systems. Estamos apoiando negócios do ramo de ${spSeg} ${localRef} e notei o trabalho da ${nome}.`,
      `${saudacao} Sou ${op} (AutonomIA Systems). Como já atendemos operações de ${spSeg} ${localRef}, a ${nome} chamou minha atenção por aqui.`,
      `${saudacao} Me chamo ${op}, da AutonomIA Systems. Acompanhamos empresas de ${spSeg} ${localRef} e vi o destaque da ${nome} na região.`,
      `${saudacao} Aqui é ${op} da AutonomIA Systems — estamos ajudando estabelecimentos de ${spSeg} ${localRef} e resolvi chamar vocês na ${nome}.`,
    ];
    return vars[idx % vars.length];
  }

  if (socioNome) {
    const vars = [
      `Olá ${socioNome}, tudo bem? Aqui é ${op} da AutonomIA Systems. Vi a operação da ${nome} em ${cidade} e resolvi te chamar direto.`,
      `Oi ${socioNome}! Tudo certo? Me chamo ${op}, falo da AutonomIA Systems. Estava analisando empresas de destaque como a ${nome} em ${cidade}.`,
      `Olá ${socioNome}, prazer! Sou ${op} da AutonomIA Systems. Acompanhei o posicionamento da ${nome} por aqui em ${cidade}.`,
      `Tudo bem, ${socioNome}? Aqui é ${op} (AutonomIA Systems). Dei uma olhada na presença da ${nome} em ${cidade} e notei um ponto interessante.`,
    ];
    return vars[idx % vars.length];
  }

  if (av != null && totAv != null && totAv > 0) {
    const vars = [
      `Olá, pessoal da ${nome}! Tudo bem? Aqui é ${op} da AutonomIA Systems. Vi as ${totAv} avaliações da ${nome} no Google (nota ${av})!`,
      `Oi, equipe da ${nome}! Me chamo ${op} (AutonomIA Systems). Parabéns pelas ${totAv} avaliações com nota ${av} no Google Maps.`,
      `Olá! Aqui é ${op} da AutonomIA Systems. Estava pesquisando referências de ${seg} em ${cidade} e vi o ótimo destaque da ${nome} (${av}★ / ${totAv} aval.).`,
      `Tudo bem, time da ${nome}? Sou ${op}, da AutonomIA Systems. Chamou atenção a reputação de vocês no Google (${av} de nota em ${totAv} avaliações).`,
    ];
    return vars[idx % vars.length];
  }

  if (av != null) {
    const vars = [
      `Olá, time da ${nome}! Tudo bem? Aqui é ${op} da AutonomIA Systems. Vi a avaliação de ${av} da ${nome} no Google em ${cidade}.`,
      `Oi! Sou ${op} da AutonomIA Systems. Vi a ${nome} bem avaliada (${av}★) no Google Maps em ${cidade}.`,
      `Olá, pessoal da ${nome}! Me chamo ${op} (AutonomIA Systems). Notei a ótima nota (${av}) de vocês aqui em ${cidade}.`,
      `Tudo bem? Aqui é ${op}, da AutonomIA Systems. Acompanhei o perfil da ${nome} em ${cidade} (nota ${av} no Google).`,
    ];
    return vars[idx % vars.length];
  }

  const vars = [
    `Olá, equipe da ${nome}! Tudo bem? Aqui é ${op}, da AutonomIA Systems. Vi o trabalho de vocês no setor de ${seg} em ${cidade}.`,
    `Oi! Me chamo ${op} (AutonomIA Systems). Estava mapeando empresas de ${seg} em ${cidade} e cheguei até a ${nome}.`,
    `Olá, pessoal da ${nome}! Sou ${op} da AutonomIA Systems — trabalhamos com soluções inteligentes para ${seg} em ${cidade}.`,
    `Tudo bem, time da ${nome}? Aqui é ${op} da AutonomIA Systems. Acompanho negócios locais de ${seg} em ${cidade} e vi vocês por aqui.`,
  ];
  return vars[idx % vars.length];
}

function buildHook(lead, modeId, tags, idx, offerContext) {
  const nome = lead?.nome_fantasia || 'a empresa';
  const hasGap = (t) => tags.includes(t);
  const offerTail = offerContext ? ` Trabalhamos exatamente com ${offerContext}.` : '';

  if (modeId === 'venda_direta') {
    const vars = [
      `Como vocês já têm um giro expressivo na região, ajudamos operações desse porte a ganhar velocidade no atendimento e padronizar rotinas comerciais sem sobrecarregar a equipe.${offerTail}`,
      `Empresas com o volume da ${nome} costumam perder vendas por gargalos rápidos de resposta e controle interno — é exatamente onde implantamos fluxos ágeis e automação sob medida.${offerTail}`,
      `Nosso foco é apoiar operações consolidadas como a ${nome} com sistemas inteligentes que aceleram pedidos, follow-ups e rotina comercial no dia a dia.${offerTail}`,
      `Para negócios de alta demanda como a ${nome}, desenhamos integrações diretas no WhatsApp e painel comercial para transformar volume em margem sem esforço manual.${offerTail}`,
    ];
    return { hook_label: 'Escala & Parceria B2B', text: vars[idx % vars.length] };
  }

  if (modeId === 'novos_entrantes') {
    const vars = [
      `Como a ${nome} está em fase de consolidação e ganho de tração, esse é o melhor momento para estruturar atendimento digital e processo comercial antes que o volume vire gargalo.${offerTail}`,
      `Empresas em fase de crescimento costumam ganhar muito tempo quando já nascem com captação organizada e atendimento ágil no WhatsApp desde cedo.${offerTail}`,
      `Ajudamos negócios em expansão como a ${nome} a montar sua base digital e automação de contato para converter mais clientes logo nos primeiros ciclos.${offerTail}`,
      `Nessa janela de montagem e crescimento da ${nome}, um fluxo enxuto de atendimento e site orientado à conversão costuma pagar o investimento muito rápido.${offerTail}`,
    ];
    return { hook_label: 'Janela de Estruturação', text: vars[idx % vars.length] };
  }

  if (hasGap('E-commerce sem Pixel')) {
    const vars = [
      `Vi a loja virtual da ${nome} no ar e notei um ponto valioso: ela está rodando sem Pixel ou Google Tag ativos para recuperar carrinhos abandonados e visitantes.`,
      `Dei uma olhada no e-commerce da ${nome} — vocês já têm estrutura de venda online, mas sem rastreamento ativo acabam deixando dinheiro na mesa com quem visita e não finaliza.`,
      `Um detalhe técnico rápido sobre a loja online da ${nome}: não detectamos Pixel nem tags de conversão rodando, o que impede campanhas inteligentes de remarketing no automático.`,
      `A loja da ${nome} já tem potencial de escala, mas sem Pixel/GTM instalados vocês perdem a inteligência de quem quase comprou — é um ajuste rápido de altíssimo retorno.`,
    ];
    return { hook_label: 'E-commerce sem Pixel', text: vars[idx % vars.length] };
  }

  if (hasGap('Só Link na Bio')) {
    const vars = [
      `Vi que o link principal da ${nome} hoje direciona para um agregador tipo Link na Bio, o que faz vocês perderem autoridade no Google e conversões diretas.`,
      `Notei que a ${nome} usa apenas um Link na Bio como vitrine — ter uma página própria rápida integrada ao WhatsApp costuma multiplicar o contato de novos clientes.`,
      `Percebi que quem busca a ${nome} cai em uma página genérica de links; transformar isso em um site próprio focado em conversão eleva muito a percepção de valor.`,
      `Com a visibilidade que a ${nome} já tem, sair só do Link na Bio para uma página profissional com atendimento inteligente no WhatsApp traz resultados bem rápidos.`,
    ];
    return { hook_label: 'Só Link na Bio', text: vars[idx % vars.length] };
  }

  if (hasGap('Sem Mobile')) {
    const vars = [
      `Abri o site da ${nome} pensando na experiência de quem busca no celular e notei que ele ainda não está adaptado para tela mobile (sem viewport responsivo).`,
      `Hoje mais de 80% das buscas locais acontecem pelo celular, e percebi que o site da ${nome} ainda não se ajusta bem em smartphones — o que costuma derrubar contatos.`,
      `Dei uma olhada no site da ${nome} e vi que falta adaptação mobile; modernizar isso junto com um atalho rápido de WhatsApp costuma recuperar muitos clientes no ato.`,
      `Notei que a versão mobile do site da ${nome} está travando a leitura no celular — podemos deixar tudo leve, responsivo e pronto para converter no WhatsApp.`,
    ];
    return { hook_label: 'Sem Mobile', text: vars[idx % vars.length] };
  }

  if (hasGap('Site Lento')) {
    const vars = [
      `Testei o carregamento do site da ${nome} e ele demorou bastante para responder no primeiro acesso — no celular, cada segundo extra faz clientes desistirem antes de ver sua oferta.`,
      `Notei que o site da ${nome} está com tempo de resposta lento, o que prejudica tanto o posicionamento no Google quanto a taxa de pessoas que chegam até o WhatsApp.`,
      `Um ponto técnico simples na ${nome}: a lentidão inicial do site costuma derrubar boa parte dos acessos pagos e orgânicos antes da página abrir.`,
      `Vi que o site da ${nome} está demorando para carregar — otimizar velocidade e fluxo de contato costuma gerar ganho imediato sem precisar gastar mais em anúncios.`,
    ];
    return { hook_label: 'Site Lento', text: vars[idx % vars.length] };
  }

  if (hasGap('Site sem WhatsApp')) {
    const vars = [
      `Notei que o site de vocês está no ar, mas quem acessa pelo celular não encontra um botão direto e prático para chamar no WhatsApp na hora.${offerTail}`,
      `Dei uma olhada no site da ${nome} e percebi que falta um atalho claro de WhatsApp para converter o visitante em conversa imediata.${offerTail}`,
      `Um detalhe curioso: o site da ${nome} já existe, porém sem um ponto de contato rápido de WhatsApp muita gente acaba desistindo no meio do caminho.${offerTail}`,
      `Vi o site de vocês no ar — só senti falta de uma entrada direta pro WhatsApp, que hoje costuma dobrar a taxa de contato de quem pesquisa no Google.${offerTail}`,
    ];
    return { hook_label: 'Site sem WhatsApp', text: vars[idx % vars.length] };
  }

  if (hasGap('Sem Site') || hasGap('Site Fora do Ar')) {
    const label = hasGap('Site Fora do Ar') ? 'Site Fora do Ar' : 'Sem Site Próprio';
    const vars = [
      `Percebi que quem busca a ${nome} no Google ainda não encontra uma página própria funcionando com cardápio/serviços e botão direto de WhatsApp.${offerTail}`,
      `Hoje vocês têm força na busca local, mas sem um site próprio ativo acabam deixando clientes prontos para fechar escaparem para concorrentes.${offerTail}`,
      `Notei que falta uma página própria da ${nome} no ar para transformar essa procura do Google em contatos qualificados direto no WhatsApp.${offerTail}`,
      `Com a visibilidade que vocês já têm no Maps, colocar um site rápido no ar integrado ao WhatsApp e a um agente de atendimento gera demanda no piloto automático.${offerTail}`,
    ];
    return { hook_label: label, text: vars[idx % vars.length] };
  }

  if (hasGap('Sem Tráfego Rastreado')) {
    const vars = [
      `Vi o site de vocês no ar, mas notei que ainda não há rastreamento ativo (Pixel/Google Tag) para recuperar quem visitou e não chamou.${offerTail}`,
      `Percebi que o site da ${nome} está publicado sem tags de conversão/remarketing — ou seja, vocês não aproveitam quem já demonstrou interesse.${offerTail}`,
      `Um ponto rápido: o site está bonito, mas sem Pixel ou Google Analytics vocês ficam no escuro sobre quantos clientes chegam e saem sem contato.${offerTail}`,
      `Dá para extrair bem mais resultado do site atual da ${nome} ativando rastreamento e automação de atendimento para não perder nenhum interessado.${offerTail}`,
    ];
    return { hook_label: 'Sem Tráfego Rastreado', text: vars[idx % vars.length] };
  }

  const vars = [
    `Desenvolvemos sistemas inteligentes e agentes de atendimento sob medida para eliminar retrabalho manual e transformar mais contatos em clientes.${offerTail}`,
    `Ajudamos empresas como a ${nome} a automatizar atendimento no WhatsApp, qualificação e rotinas internas com IA prática.${offerTail}`,
    `Nosso foco na AutonomIA Systems é destravar gargalos comerciais e operacionais com sistemas leves que geram retorno rápido.${offerTail}`,
    `Trabalhamos exatamente conectando presença digital, atendimento ágil no WhatsApp e automação inteligente para negócios locais.${offerTail}`,
  ];
  return { hook_label: offerContext ? 'Oferta da Lente' : 'Eficiência & IA B2B', text: vars[idx % vars.length] };
}

function buildCta(idx) {
  const vars = [
    `Faz sentido trocarmos uma ideia rápida de 5 minutinhos sobre isso?`,
    `Posso te mandar um exemplo prático de como aplicamos isso em empresas parecidas?`,
    `Você mesmo cuida dessa parte por aí ou tem alguém da equipe que avalia essas melhorias?`,
    `Se você tiver 2 minutos, posso te mostrar sem compromisso o que identificamos — posso enviar?`,
  ];
  return vars[idx % vars.length];
}

/**
 * Gera abordagem personalizada em 3 blocos com rotação determinística anti-repetição.
 * Suporta offerContext (Lente Customizada) e socialProof (Prova Social Hiper-Local sem vazar nomes).
 */
export function generateSmartCopy(lead, {
  modeId = 'equilibrado',
  modeOrLens = null,
  operador = 'Rafael Oliveira',
  variationIndex = null,
  offerContext = null,
  socialProof = null,
} = {}) {
  const lensArg = modeOrLens || modeId;
  const evalResult = evaluateLead(lead, lensArg);
  const rawIdx = variationIndex !== null && variationIndex !== undefined
    ? Number(variationIndex)
    : hashString(String(lead?.id || lead?.nome_fantasia || 'lead'));

  const idx = ((Number.isFinite(rawIdx) ? rawIdx : 0) % TOTAL_VARIATIONS + TOTAL_VARIATIONS) % TOTAL_VARIATIONS;
  const effectiveOffer = offerContext || evalResult.oferta_contexto || null;

  const opening = buildOpening(lead, operador || 'Rafael Oliveira', idx, socialProof);
  const hook = buildHook(lead, evalResult.mode, evalResult.etiquetas_dor, idx, effectiveOffer);
  const cta = buildCta(idx);

  return {
    text: `${opening}\n\n${hook.text} ${cta}`,
    hook_label: socialProof?.ativo ? `Prova Social Local · ${hook.hook_label}` : hook.hook_label,
    variation_index: idx,
    total_variations: TOTAL_VARIATIONS,
    mode: evalResult.mode,
    social_proof_active: Boolean(socialProof?.ativo),
  };
}
