import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSmartCopy } from '../src/copy_engine.js';

test('generateSmartCopy personaliza texto com sócio, nota e dor real do modo ativo', () => {
  const lead = {
    id: 'lead-copy-1',
    nome_fantasia: 'Clínica Vida',
    segmento: 'CLINICA',
    cidade: 'Governador Valadares',
    avaliacao: 4.8,
    total_avaliacoes: 140,
    website: 'https://clinicavida.com.br',
    socios: ['FERNANDA LIMA'],
    etiquetas_dor: ['Site sem WhatsApp'],
  };

  const digital = generateSmartCopy(lead, {
    modeId: 'cacador_digital',
    operador: 'Rafael Oliveira',
    variationIndex: 0,
  });

  assert.ok(digital.text.includes('Fernanda'));
  assert.ok(digital.text.includes('Clínica Vida'));
  assert.ok(digital.text.includes('WhatsApp'));
  assert.equal(digital.hook_label, 'Site sem WhatsApp');

  const leadSemSocio = {
    ...lead,
    socios: [],
    website: null,
    etiquetas_dor: ['Sem Site'],
  };
  const digitalMaps = generateSmartCopy(leadSemSocio, {
    modeId: 'cacador_digital',
    operador: 'Sara Rosseto',
    variationIndex: 0,
  });
  assert.ok(digitalMaps.text.includes('140'));
  assert.ok(digitalMaps.text.includes('4.8'));
  assert.equal(digitalMaps.hook_label, 'Sem Site Próprio');

  const direta = generateSmartCopy(lead, {
    modeId: 'venda_direta',
    operador: 'Rafael Oliveira',
    variationIndex: 0,
  });
  assert.equal(direta.hook_label, 'Escala & Parceria B2B');
  assert.notEqual(direta.text, digital.text);
});

test('generateSmartCopy garante rotação anti-repetição entre variationIndex 0, 1 e 2', () => {
  const lead = {
    id: 'lead-rotacao',
    nome_fantasia: 'Padaria Central',
    segmento: 'PADARIA',
    cidade: 'Governador Valadares',
    avaliacao: 4.7,
    total_avaliacoes: 85,
    etiquetas_dor: ['Sem Site'],
  };

  const v0 = generateSmartCopy(lead, { modeId: 'cacador_digital', operador: 'Rafael Oliveira', variationIndex: 0 });
  const v1 = generateSmartCopy(lead, { modeId: 'cacador_digital', operador: 'Rafael Oliveira', variationIndex: 1 });
  const v2 = generateSmartCopy(lead, { modeId: 'cacador_digital', operador: 'Rafael Oliveira', variationIndex: 2 });

  assert.notEqual(v0.text, v1.text);
  assert.notEqual(v1.text, v2.text);
  assert.notEqual(v0.text, v2.text);
  assert.equal(v0.variation_index, 0);
  assert.equal(v1.variation_index, 1);
  assert.equal(v2.variation_index, 2);
});
