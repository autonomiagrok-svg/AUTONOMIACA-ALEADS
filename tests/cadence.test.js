import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeLeadCadence,
  recommendNextStep,
  generateSmartFollowUp,
} from '../src/cadence_engine.js';
import { computeRelationshipInsights } from '../src/relationship_analytics.js';
import {
  setStoreFile,
  createLead,
  registerFollowUpOutcome,
  getLead,
  flushWrites,
} from '../src/store.js';

const NOW = new Date('2026-11-22T15:00:00-03:00');

test('analyzeLeadCadence classifica corretamente todos os buckets operacionais', () => {
  const atrasado = analyzeLeadCadence({
    status: 'CONTATADO',
    proximo_contato: '2026-11-20',
    interacoes: [{ tipo: 'WHATSAPP', criado_em: '2026-11-18T12:00:00Z' }],
  }, { now: NOW });
  assert.equal(atrasado.bucket, 'ATRASADO');

  const hoje = analyzeLeadCadence({
    status: 'CONTATADO',
    proximo_contato: '2026-11-22',
    interacoes: [{ tipo: 'WHATSAPP', criado_em: '2026-11-19T12:00:00Z' }],
  }, { now: NOW });
  assert.equal(hoje.bucket, 'HOJE');

  const propostaParada = analyzeLeadCadence({
    status: 'PROPOSTA',
    interacoes: [{ tipo: 'PROPOSTA', criado_em: '2026-11-15T12:00:00Z' }],
  }, { now: NOW });
  assert.equal(propostaParada.bucket, 'PROPOSTA_PARADA');

  const semResposta = analyzeLeadCadence({
    status: 'CONTATADO',
    interacoes: [{ tipo: 'WHATSAPP', criado_em: '2026-11-17T12:00:00Z' }],
  }, { now: NOW });
  assert.equal(semResposta.bucket, 'SEM_RESPOSTA');

  const posVenda = analyzeLeadCadence({
    status: 'CLIENTE',
    convertido_em: '2026-10-10T12:00:00Z',
    interacoes: [],
  }, { now: NOW });
  assert.equal(posVenda.bucket, 'POS_VENDA');

  const reativacao = analyzeLeadCadence({
    status: 'DESCARTADO',
    whatsapp: '(33) 99999-8888',
    avaliacao: 4.8,
    total_avaliacoes: 50,
    etiquetas_dor: ['Sem Site'],
    interacoes: [{ tipo: 'WHATSAPP', criado_em: '2026-09-20T12:00:00Z' }],
  }, { now: NOW });
  assert.equal(reativacao.bucket, 'REATIVACAO');
});

test('priority_score ordena PROPOSTA parada de alto valor acima de CONTATADO frio', () => {
  const propostaAlta = analyzeLeadCadence({
    status: 'PROPOSTA',
    whatsapp: '(33) 99999-1111',
    avaliacao: 4.8,
    total_avaliacoes: 120,
    etiquetas_dor: ['Sem Site'],
    interacoes: [{ tipo: 'PROPOSTA', criado_em: '2026-11-14T12:00:00Z' }],
  }, { now: NOW, modeId: 'cacador_digital' });

  const contatadoFrio = analyzeLeadCadence({
    status: 'CONTATADO',
    telefone: '(33) 3271-1000',
    etiquetas_dor: ['Só Telefone Fixo'],
    interacoes: [{ tipo: 'LIGACAO', criado_em: '2026-11-10T12:00:00Z' }],
  }, { now: NOW, modeId: 'cacador_digital' });

  assert.ok(
    propostaAlta.priority_score > contatadoFrio.priority_score,
    `Esperado PROPOSTA (${propostaAlta.priority_score}) > CONTATADO (${contatadoFrio.priority_score})`
  );
});

test('recommendNextStep segue máquina de estados de toques e sobrescrita por sinal', () => {
  const baseLead = {
    nome_fantasia: 'Empresa Teste',
    status: 'CONTATADO',
    telefone: '(33) 3271-5555',
    whatsapp: '(33) 99999-5555',
    email: 'contato@empresateste.com.br',
    etiquetas_dor: ['Site sem WhatsApp'],
  };

  const t1 = recommendNextStep(baseLead, analyzeLeadCadence({
    ...baseLead,
    interacoes: [{ tipo: 'WHATSAPP', criado_em: '2026-11-19T12:00:00Z' }],
  }, { now: NOW }));
  assert.equal(t1.estrategia, 'RESGATE_LEVE');
  assert.equal(t1.alerta_excesso, false);

  const t2 = recommendNextStep(baseLead, analyzeLeadCadence({
    ...baseLead,
    interacoes: [
      { tipo: 'WHATSAPP', criado_em: '2026-11-19T12:00:00Z' },
      { tipo: 'FOLLOWUP', criado_em: '2026-11-16T12:00:00Z' },
    ],
  }, { now: NOW }));
  assert.equal(t2.estrategia, 'NOVO_ANGULO_DOR');

  const t3 = recommendNextStep(baseLead, analyzeLeadCadence({
    ...baseLead,
    interacoes: [
      { tipo: 'WHATSAPP', criado_em: '2026-11-19T12:00:00Z' },
      { tipo: 'FOLLOWUP', criado_em: '2026-11-16T12:00:00Z' },
      { tipo: 'WHATSAPP', criado_em: '2026-11-12T12:00:00Z' },
    ],
  }, { now: NOW }));
  assert.equal(t3.estrategia, 'TROCA_CANAL');
  assert.ok(['LIGACAO', 'EMAIL'].includes(t3.canal_sugerido));

  const t4 = recommendNextStep(baseLead, analyzeLeadCadence({
    ...baseLead,
    interacoes: [
      { tipo: 'WHATSAPP', criado_em: '2026-11-19T12:00:00Z' },
      { tipo: 'FOLLOWUP', criado_em: '2026-11-16T12:00:00Z' },
      { tipo: 'WHATSAPP', criado_em: '2026-11-12T12:00:00Z' },
      { tipo: 'LIGACAO', criado_em: '2026-11-08T12:00:00Z' },
    ],
  }, { now: NOW }));
  assert.equal(t4.estrategia, 'BREAKUP_ELEGANTE');
  assert.equal(t4.alerta_excesso, true);

  const objecao = recommendNextStep({ ...baseLead, ultimo_sinal: 'OBJECAO_PRECO' }, analyzeLeadCadence({
    ...baseLead,
    ultimo_sinal: 'OBJECAO_PRECO',
    interacoes: [{ tipo: 'WHATSAPP', criado_em: '2026-11-19T12:00:00Z' }],
  }, { now: NOW }));
  assert.equal(objecao.estrategia, 'OBJECAO_PRECO');
});

test('generateSmartFollowUp gera variações distintas para variationIndex 0, 1 e 2', () => {
  const lead = {
    id: 'lead-fu-1',
    nome_fantasia: 'Clínica Horizonte',
    status: 'CONTATADO',
    socios: ['ANDREIA COSTA'],
    etiquetas_dor: ['Site sem WhatsApp'],
    interacoes: [
      { tipo: 'WHATSAPP', criado_em: '2026-11-18T12:00:00Z' },
      { tipo: 'FOLLOWUP', criado_em: '2026-11-14T12:00:00Z' },
    ],
  };

  const f0 = generateSmartFollowUp(lead, { operador: 'Rafael Oliveira', variationIndex: 0, now: NOW });
  const f1 = generateSmartFollowUp(lead, { operador: 'Rafael Oliveira', variationIndex: 1, now: NOW });
  const f2 = generateSmartFollowUp(lead, { operador: 'Rafael Oliveira', variationIndex: 2, now: NOW });

  assert.equal(f0.estrategia, 'NOVO_ANGULO_DOR');
  assert.notEqual(f0.text, f1.text);
  assert.notEqual(f1.text, f2.text);
  assert.notEqual(f0.text, f2.text);
  assert.ok(f0.text.includes('Andreia'));
});

test('computeRelationshipInsights calcula efetividade por toque, origem e gargalo', () => {
  const dataset = [
    {
      id: '1',
      nome_fantasia: 'Lead 1',
      status: 'CLIENTE',
      fonte_tipo: 'MAPS',
      etiquetas_dor: ['Sem Site'],
      interacoes: [
        { tipo: 'WHATSAPP', criado_em: '2026-11-20T12:00:00Z' },
        { tipo: 'VISITA', criado_em: '2026-11-21T12:00:00Z' },
      ],
    },
    {
      id: '2',
      nome_fantasia: 'Lead 2',
      status: 'CONTATADO',
      fonte_tipo: 'MAPS',
      etiquetas_dor: ['Sem Site'],
      interacoes: [
        { tipo: 'WHATSAPP', criado_em: '2026-11-15T12:00:00Z' },
      ],
    },
    {
      id: '3',
      nome_fantasia: 'Lead 3',
      status: 'PROPOSTA',
      fonte: 'OpenStreetMap / Overpass API',
      etiquetas_dor: ['Site sem WhatsApp'],
      interacoes: [
        { tipo: 'WHATSAPP', criado_em: '2026-11-10T12:00:00Z' },
        { tipo: 'PROPOSTA', criado_em: '2026-11-12T12:00:00Z' },
      ],
    },
  ];

  const insights = computeRelationshipInsights(dataset, { now: NOW });
  assert.equal(insights.total_leads, 3);
  assert.equal(insights.buckets.PROPOSTA_PARADA, 1);
  assert.equal(insights.buckets.SEM_RESPOSTA, 1);
  assert.equal(insights.efetividade_por_toque['2'].avancos, 2);
  assert.equal(insights.efetividade_por_toque.percentual_avancos_2plus, 100);
  const mapsOrigin = insights.conversao_por_origem.find((o) => o.origem === 'Maps');
  assert.equal(mapsOrigin.contatados, 2);
  assert.equal(mapsOrigin.avancos, 1);
  assert.equal(mapsOrigin.taxa_avanco, 50);
  assert.ok(insights.gargalo_principal.includes('PROPOSTA/VISITA'));
});

test('registerFollowUpOutcome persiste sinal, interação e agendamento em diretório isolado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomia-cadence-test-'));
  const file = path.join(dir, 'leads.json');
  setStoreFile(file);

  try {
    const created = createLead({
      nome_fantasia: 'Restaurante Cadência',
      cidade: 'Governador Valadares',
      whatsapp: '(33) 99999-4444',
      status: 'CONTATADO',
    });

    const afterSignal = registerFollowUpOutcome(created.id, {
      sinal: 'OBJECAO_PRECO',
      sinal_nota: 'Achou caro na primeira call',
      registrar_toque: false,
    });
    assert.equal(afterSignal.ultimo_sinal, 'OBJECAO_PRECO');
    assert.equal(afterSignal.ultimo_sinal_nota, 'Achou caro na primeira call');
    assert.equal(afterSignal.interacoes.length, 1);

    const afterTouch = registerFollowUpOutcome(created.id, {
      tipo: 'WHATSAPP',
      registrar_toque: true,
      proximo_contato: '2026-11-25',
      proximo_contato_nota: 'Enviar plano enxuto',
      status: 'PROPOSTA',
      resumo: 'Enviada opção modular via WhatsApp',
    });

    await flushWrites();
    const persisted = getLead(created.id);
    assert.equal(persisted.status, 'PROPOSTA');
    assert.equal(persisted.proximo_contato, '2026-11-25');
    assert.equal(persisted.proximo_contato_nota, 'Enviar plano enxuto');
    assert.equal(persisted.interacoes.length, 2);
    assert.equal(persisted.interacoes[0].tipo, 'WHATSAPP');
    assert.ok(persisted.ultimo_contato_em);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
