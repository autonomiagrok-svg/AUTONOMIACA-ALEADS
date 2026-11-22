import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateLead } from '../src/scoring_modes.js';
import {
  setLensesFile,
  listLenses,
  getLens,
  createLens,
  updateLens,
  deleteLens,
  flushLensesWrites,
} from '../src/lenses_store.js';
import {
  analyzeEmpiricalPerformance,
  buildCalibratedLensProposal,
} from '../src/empirical_calibrator.js';
import {
  computeTerritoryClusters,
  findLookalikeLeads,
} from '../src/territory_engine.js';
import { generateSmartCopy } from '../src/copy_engine.js';

test('evaluateLead com lente customizada altera ordenação e gera breakdown coerente com score', () => {
  const customLens = {
    id: 'lens_clinicas_centro',
    nome: 'Sites p/ Clínicas Centro',
    oferta_contexto: 'landing page de alta conversão com WhatsApp integrado',
    pesos: {
      tem_whatsapp: 15,
      sem_site: 5,
      site_sem_whatsapp: 30,
      sem_trafego: 10,
      sem_https: 0,
      empresa_recente: 0,
      nota_alta: 10,
      volume_avaliacoes: 5,
      cnpj_ativo: 5,
      so_fixo_penalidade: -15,
    },
    filtros: {
      exigir_whatsapp: true,
      segmentos_boost: ['CLINICA'],
      bairros_boost: ['Centro'],
    },
  };

  const clinicaAlvo = {
    id: 'c1',
    nome_fantasia: 'Clínica Sorriso',
    segmento: 'CLINICA',
    bairro: 'Centro',
    whatsapp: '(33) 99999-1111',
    website: 'https://clinicasorriso.com.br',
    avaliacao: 4.8,
    total_avaliacoes: 45,
    etiquetas_dor: ['Site sem WhatsApp'],
  };

  const barComum = {
    id: 'b1',
    nome_fantasia: 'Bar Esquina',
    segmento: 'BAR',
    bairro: 'Vila Bretas',
    telefone: '(33) 3271-1000',
    etiquetas_dor: ['Sem Site', 'Só Telefone Fixo'],
  };

  const evClinica = evaluateLead(clinicaAlvo, customLens);
  const evBar = evaluateLead(barComum, customLens);

  assert.ok(evClinica.score > evBar.score);
  assert.equal(evClinica.acionavel, true);
  assert.equal(evBar.acionavel, false); // lente exige WhatsApp
  assert.ok(Array.isArray(evClinica.breakdown) && evClinica.breakdown.length >= 4);

  const sumPoints = evClinica.breakdown.reduce((acc, item) => acc + item.pontos, 0);
  assert.equal(evClinica.score, Math.max(0, Math.min(100, sumPoints)));
});

test('CRUD de lenses_store.js funciona em diretório temporário isolado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomia-lenses-test-'));
  const file = path.join(dir, 'lenses.json');
  setLensesFile(file);

  try {
    assert.deepEqual(listLenses(), []);

    const created = createLens({
      nome: 'Clínicas VIP',
      descricao: 'Clínicas sem WhatsApp no site',
      oferta_contexto: 'página de agendamento com WhatsApp',
      pesos: { site_sem_whatsapp: 30 },
      filtros: { exigir_whatsapp: true, segmentos_boost: ['clinica'], bairros_boost: ['Centro'] },
    });
    assert.ok(created.id.startsWith('lens_'));
    assert.equal(created.pesos.site_sem_whatsapp, 30);
    assert.deepEqual(created.filtros.segmentos_boost, ['CLINICA']);
    assert.equal(getLens(created.id)?.nome, 'Clínicas VIP');

    const updated = updateLens(created.id, { nome: 'Clínicas VIP v2', pesos: { tem_whatsapp: 25 } });
    assert.equal(updated.nome, 'Clínicas VIP v2');
    assert.equal(updated.pesos.tem_whatsapp, 25);
    assert.equal(updated.pesos.site_sem_whatsapp, 30);

    await flushLensesWrites();
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].nome, 'Clínicas VIP v2');

    assert.equal(deleteLens(created.id), true);
    assert.equal(deleteLens('lens_inexistente'), false);
    await flushLensesWrites();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empirical_calibrator aplica suavização Bayesiana contra ruído de amostra pequena e detecta alto lift', () => {
  const leads = [];

  // 1 lead raro com 'Sem HTTPS' que teve 100% de sucesso (1 de 1) -> deve ter confianca INSUFICIENTE e delta 0
  leads.push({
    id: 'rare-1',
    status: 'CLIENTE',
    segmento: 'HOTEL',
    website: 'http://hotelraro.com.br',
    etiquetas_dor: ['Sem HTTPS'],
  });

  // 20 leads com 'Site sem WhatsApp': 12 sucessos (60%)
  for (let i = 0; i < 20; i++) {
    leads.push({
      id: `ssw-${i}`,
      status: i < 12 ? 'PROPOSTA' : 'CONTATADO',
      segmento: 'CLINICA',
      website: `https://clinica${i}.com.br`,
      etiquetas_dor: ['Site sem WhatsApp'],
    });
  }

  // 79 leads comuns de controle: apenas 7 sucessos (~8.8%) -> taxa base global = 20 / 100 = 20%
  for (let i = 0; i < 79; i++) {
    leads.push({
      id: `ctrl-${i}`,
      status: i < 7 ? 'VISITA' : 'DESCARTADO',
      segmento: 'BAR',
      website: `https://bar${i}.com.br`,
      etiquetas_dor: [],
    });
  }

  const analysis = analyzeEmpiricalPerformance(leads);
  assert.equal(analysis.amostra_total, 100);
  assert.equal(analysis.sucessos_totais, 20);
  assert.equal(analysis.base_rate, 0.2);

  const rareSig = analysis.sinais.find((s) => s.chave === 'dor:Sem HTTPS');
  assert.equal(rareSig.amostra, 1);
  assert.equal(rareSig.confianca, 'INSUFICIENTE');
  assert.equal(rareSig.delta_peso_sugerido, 0);

  const strongSig = analysis.sinais.find((s) => s.chave === 'dor:Site sem WhatsApp');
  assert.equal(strongSig.amostra, 20);
  assert.equal(strongSig.sucessos, 12);
  assert.equal(strongSig.confianca, 'ALTA');
  assert.ok(strongSig.lift > 2, `Lift esperado > 2, obtido ${strongSig.lift}`);
  assert.ok(strongSig.delta_peso_sugerido > 0);

  const proposal = buildCalibratedLensProposal(leads, 'equilibrado');
  const compRow = proposal.comparativo.find((c) => c.campo === 'site_sem_whatsapp');
  assert.ok(compRow.depois > compRow.antes);
  assert.equal(proposal.proposta_lente.nome, 'Auto-Calibrada (Empírica)');
});

test('computeTerritoryClusters ranqueia bolsão Oceano Azul acima de bolsão saturado', () => {
  const leads = [
    // Bolsão Oceano Azul: Esplanada + CLINICA (5 prontos, nota alta, sem site, 0% penetração)
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `ocean-${i}`,
      nome_fantasia: `Clínica Esplanada ${i}`,
      cidade: 'Governador Valadares',
      bairro: 'Esplanada',
      segmento: 'CLINICA',
      status: 'NOVO',
      whatsapp: `(33) 99999-100${i}`,
      avaliacao: 4.8,
      total_avaliacoes: 60,
      website: null,
      etiquetas_dor: ['Sem Site'],
    })),
    // Bolsão Saturado: Centro + BAR (5 leads, todos já contatados/descartados, 100% penetração)
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `sat-${i}`,
      nome_fantasia: `Bar Centro ${i}`,
      cidade: 'Governador Valadares',
      bairro: 'Centro',
      segmento: 'BAR',
      status: 'CONTATADO',
      whatsapp: `(33) 98888-200${i}`,
      avaliacao: 4.1,
      website: 'https://bar.com.br',
      etiquetas_dor: [],
    })),
  ];

  const { bolsoes } = computeTerritoryClusters(leads, { minLeads: 2 });
  assert.equal(bolsoes.length, 2);
  assert.equal(bolsoes[0].bairro, 'Esplanada');
  assert.equal(bolsoes[0].segmento, 'CLINICA');
  assert.equal(bolsoes[0].prontos_para_abordar, 5);
  assert.equal(bolsoes[0].taxa_penetracao, 0);
  assert.equal(bolsoes[0].dor_dominante, 'Sem Site');
  assert.ok(bolsoes[0].indice_oceano_azul > bolsoes[1].indice_oceano_azul);
});

test('findLookalikeLeads prioriza clone no mesmo bairro/segmento/dor e exclui referência e CNPJ Inativo', () => {
  const refClient = {
    id: 'ref-cliente',
    nome_fantasia: 'Clínica Referência Confidencial',
    status: 'CLIENTE',
    segmento: 'CLINICA',
    categoria_raw: 'Clínica odontológica',
    bairro: 'Esplanada',
    cidade: 'Governador Valadares',
    uf: 'MG',
    avaliacao: 4.8,
    total_avaliacoes: 80,
    website: 'https://ref.com.br',
    etiquetas_dor: ['Site sem WhatsApp'],
  };

  const allLeads = [
    refClient,
    {
      id: 'clone-perfeito',
      nome_fantasia: 'Odonto Esplanada',
      status: 'NOVO',
      segmento: 'CLINICA',
      categoria_raw: 'Clínica odontológica',
      bairro: 'Esplanada',
      cidade: 'Governador Valadares',
      uf: 'MG',
      avaliacao: 4.7,
      total_avaliacoes: 75,
      whatsapp: '(33) 99999-3333',
      website: 'https://odontoesplanada.com.br',
      etiquetas_dor: ['Site sem WhatsApp'],
    },
    {
      id: 'inativo-clone',
      nome_fantasia: 'Clínica Baixada',
      status: 'NOVO',
      segmento: 'CLINICA',
      bairro: 'Esplanada',
      cidade: 'Governador Valadares',
      uf: 'MG',
      whatsapp: '(33) 99999-4444',
      etiquetas_dor: ['Site sem WhatsApp', 'CNPJ Inativo'],
    },
    {
      id: 'distante',
      nome_fantasia: 'Oficina Outra Cidade',
      status: 'NOVO',
      segmento: 'OFICINA',
      bairro: 'Industrial',
      cidade: 'Ipatinga',
      uf: 'MG',
      telefone: '(31) 3821-1000',
      etiquetas_dor: ['Sem Site'],
    },
  ];

  const clones = findLookalikeLeads(refClient, allLeads, { limit: 10 });
  assert.equal(clones.length, 2); // excluiu ref-cliente e inativo-clone
  assert.equal(clones[0].lead.id, 'clone-perfeito');
  assert.equal(clones[0].mesmo_bairro, true);
  assert.ok(clones[0].similarity_score >= 85);
  assert.ok(clones[0].razoes_match.some((r) => r.includes('Esplanada')));
  assert.ok(clones[0].razoes_match.some((r) => r.includes('CLINICA')));
});

test('generateSmartCopy incorpora Prova Social Hiper-Local sem vazar nome do cliente referência', () => {
  const candidate = {
    id: 'cand-1',
    nome_fantasia: 'Odonto Esplanada',
    segmento: 'CLINICA',
    bairro: 'Esplanada',
    cidade: 'Governador Valadares',
    website: 'https://odontoesplanada.com.br',
    etiquetas_dor: ['Site sem WhatsApp'],
  };

  const res = generateSmartCopy(candidate, {
    modeId: 'cacador_digital',
    operador: 'Rafael Oliveira',
    variationIndex: 0,
    offerContext: 'landing page com WhatsApp integrado',
    socialProof: { ativo: true, bairro: 'Esplanada', cidade: 'Governador Valadares', segmento: 'CLINICA' },
  });

  assert.equal(res.social_proof_active, true);
  assert.ok(res.text.includes('Esplanada'));
  assert.ok(res.text.toLowerCase().includes('clínica'));
  assert.ok(res.text.includes('landing page com WhatsApp integrado'));
  assert.equal(res.text.includes('Clínica Referência Confidencial'), false);
});
