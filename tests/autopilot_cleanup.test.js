import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestAndEnrichMapsBatch } from '../src/autopilot_engine.js';
import {
  createMission,
  getActiveMission,
  getMission,
  updateMissionProgress,
  recordMissionBatch,
  completeMission,
  stopMission,
  clearMissionsForTest,
} from '../src/maps_mission.js';
import { analyzeBaseHealth, executeCleanup } from '../src/cleanup_engine.js';
import {
  setDataDir,
  createLead,
  listLeads,
  getLead,
  getStorageHealth,
  flushWrites,
} from '../src/store.js';

test('maps_mission.js gerencia ciclo completo de 1 segmento (criação, rolagem, captura profunda, lotes, conclusão e parada)', () => {
  clearMissionsForTest();

  const m = createMission({
    cidade: 'Governador Valadares',
    uf: 'MG',
    segmento: 'CLINICA',
    autoDiagnose: true,
    silent: true,
  });

  assert.equal(m.status, 'RUNNING');
  assert.equal(m.phase, 'WAITING_MAPS');
  assert.equal(m.query, 'Clínica em Governador Valadares MG');
  assert.ok(m.maps_url.includes(`#autonomia_mission=${m.id}`));
  assert.ok(m.lote_origem.startsWith('Maps • Clínica •'));
  assert.equal(getActiveMission()?.id, m.id);

  // Fase 1: Rolagem obrigatória até o final
  updateMissionProgress(m.id, {
    phase: 'SCROLLING_TO_END',
    scroll_discovered: 42,
    reached_end: true,
    message: 'Fim da lista atingido',
  }, { silent: true });

  assert.equal(getMission(m.id).phase, 'SCROLLING_TO_END');
  assert.equal(getMission(m.id).scroll_discovered, 42);
  assert.equal(getMission(m.id).reached_end, true);

  // Fase 2: Captura profunda + lotes em streaming
  updateMissionProgress(m.id, {
    phase: 'DEEP_CAPTURING',
    total_to_capture: 42,
    captured_count: 5,
  }, { silent: true });

  recordMissionBatch(m.id, {
    imported: 4,
    updated: 1,
    duplicates: 0,
    invalid: 0,
    diagnosed_count: 5,
    matrix_summary: { OURO: 2, EXPANSAO: 1, ENTRADA: 2, OBSERVACAO: 0 },
    lead_ids_lote: ['l1', 'l2', 'l3', 'l4', 'l5'],
    lead_ids_acionaveis: ['l1', 'l2'],
  }, { captured_count: 5, total_to_capture: 42 }, { silent: true });

  recordMissionBatch(m.id, {
    imported: 3,
    updated: 2,
    duplicates: 0,
    invalid: 0,
    diagnosed_count: 4,
    matrix_summary: { OURO: 1, EXPANSAO: 2, ENTRADA: 1, OBSERVACAO: 1 },
    lead_ids_lote: ['l6', 'l7', 'l8', 'l9', 'l10'],
    lead_ids_acionaveis: ['l6'],
  }, { captured_count: 10, total_to_capture: 42 }, { silent: true });

  const afterBatches = getMission(m.id);
  assert.equal(afterBatches.imported, 7);
  assert.equal(afterBatches.updated, 3);
  assert.equal(afterBatches.diagnosed_count, 9);
  assert.equal(afterBatches.captured_count, 10);
  assert.equal(afterBatches.lead_ids_lote.length, 10);
  assert.equal(afterBatches.lead_ids_acionaveis.length, 3);
  assert.equal(afterBatches.matrix_summary.OURO, 3);

  completeMission(m.id, { captured_count: 42, total_to_capture: 42 }, { silent: true });
  assert.equal(getMission(m.id).status, 'COMPLETED');
  assert.equal(getMission(m.id).phase, 'COMPLETED');
  assert.ok(getMission(m.id).finished_at);

  // Nova missão com termo livre customizado, trava anti-duplo clique (< 3s) e parada manual
  const m2 = createMission({
    cidade: 'Ipatinga',
    uf: 'MG',
    customQuery: 'Clínica Odontológica',
    silent: true,
  });
  const m2DuplicateClick = createMission({
    cidade: 'Ipatinga',
    uf: 'MG',
    customQuery: 'Clínica Odontológica',
    silent: true,
  });
  assert.equal(m2DuplicateClick.id, m2.id);
  assert.equal(m2.query, 'Clínica Odontológica em Ipatinga MG');
  stopMission(m2.id, 'Parado pelo operador', { silent: true });
  assert.equal(getMission(m2.id).status, 'STOPPED');
  assert.equal(getMission(m2.id).phase, 'STOPPED');
});

test('ingestAndEnrichMapsBatch (offline) faz ingestão, merge O(1), diagnóstico automático e ordenação na Matriz', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomia-maps-ingest-test-'));
  setDataDir(dir);

  try {
    const existing = createLead({
      nome_fantasia: 'Clínica Vida Nova',
      segmento: 'CLINICA',
      cidade: 'Governador Valadares',
      whatsapp: '(33) 99999-1111',
      fonte: 'Google Maps (Captura Assistida)',
      fonte_tipo: 'MAPS',
      fonte_url: 'https://www.google.com/maps/place/Clinica+Vida+Nova',
    });
    await flushWrites();

    const diagnoseFn = async (lead) => {
      if (lead.website) {
        return {
          diagnostico_fatos: {
            website_audit: {
              online: true,
              https: true,
              has_whatsapp: false,
              has_meta_pixel: false,
              has_gtm_or_ads: false,
              has_ecommerce: true,
              stack_detectada: ['SHOPIFY'],
              ttfb_ms: 380,
            },
            cnpj_info: { situacao_cadastral: 'ATIVA', capital_social: 180000 },
          },
          etiquetas_dor: ['E-commerce sem Pixel', 'Site sem WhatsApp'],
          diagnostico_em: new Date().toISOString(),
        };
      }
      return {
        diagnostico_fatos: { website_audit: null, cnpj_info: null },
        etiquetas_dor: ['Sem Site'],
        diagnostico_em: new Date().toISOString(),
      };
    };

    const res = await ingestAndEnrichMapsBatch(
      [
        {
          nome_fantasia: 'Clínica Vida Nova',
          categoria_raw: 'Clínica médica',
          cidade: 'Governador Valadares',
          uf: 'MG',
          whatsapp: '(33) 99999-1111',
          website: 'https://clinicavidanova.com.br',
          avaliacao: 4.8,
          total_avaliacoes: 120,
          fonte_url: 'https://www.google.com/maps/place/Clinica+Vida+Nova',
        },
        {
          nome_fantasia: 'Pet Shop Feliz',
          categoria_raw: 'Pet shop',
          cidade: 'Governador Valadares',
          uf: 'MG',
          telefone: '(33) 98888-2222',
          website: null,
          avaliacao: 4.9,
          total_avaliacoes: 95,
          fonte_url: 'https://www.google.com/maps/place/Pet+Shop+Feliz',
        },
        {
          nome_fantasia: 'Lugar Sem Contato',
          categoria_raw: 'Restaurante',
          cidade: 'Governador Valadares',
          uf: 'MG',
          telefone: null,
          whatsapp: null,
          website: null,
          fonte_url: 'https://www.google.com/maps/place/Lugar+Sem+Contato',
        },
      ],
      {
        autoDiagnose: true,
        modeOrLens: 'cacador_digital',
        loteOrigem: 'Maps • Clínica • 22/11 17:40',
        diagnoseFn,
      }
    );

    assert.equal(res.imported, 2);
    assert.equal(res.updated, 1);
    assert.equal(res.diagnosed_count, 3);
    assert.equal(res.lead_ids_lote.length, 3);
    assert.equal(res.lead_ids_acionaveis.length, 2);
    assert.ok(res.matrix_summary.OURO >= 1);

    const enriched = getLead(existing.id);
    assert.equal(enriched.website, 'https://clinicavidanova.com.br');
    assert.ok(enriched.etiquetas_dor.includes('E-commerce sem Pixel'));

    const pet = listLeads().find((l) => l.nome_fantasia === 'Pet Shop Feliz');
    assert.equal(pet.segmento, 'PETSHOP');
    assert.equal(pet.whatsapp, '(33) 98888-2222');

    await flushWrites();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeBaseHealth separa exatamente as 4 categorias e executeCleanup preserva ativos com backup obrigatório', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomia-cleanup-test-'));
  setDataDir(dir);

  try {
    const ativo1 = createLead({
      nome_fantasia: 'Cliente Fechado SA',
      status: 'CLIENTE',
      whatsapp: '(33) 99999-1000',
    });

    const ativo2 = createLead({
      nome_fantasia: 'Lead Com Sinal Quente',
      status: 'NOVO',
      ultimo_sinal: 'QUENTE',
    });

    const acionavel = createLead({
      nome_fantasia: 'Restaurante Real Maps',
      status: 'NOVO',
      whatsapp: '(33) 98888-2000',
      fonte: 'Google Maps (Captura Assistida)',
      fonte_tipo: 'MAPS',
    });

    const legado1 = createLead({
      nome_fantasia: 'Bar Sintético Antigo',
      status: 'NOVO',
      whatsapp: '(33) 97777-3000',
      fonte: 'Diretório Comercial',
      fonte_url: 'https://cnpj.biz/busca?cidade=GV',
    });

    const legado2 = createLead({
      nome_fantasia: 'Restaurante Pané Corrompido',
      status: 'NOVO',
      endereco: 'Abre ter. às 11:00',
      fonte: 'Google Maps (Captura Assistida)',
    });

    const fantasma = createLead({
      nome_fantasia: 'Lugar Fantasma',
      status: 'NOVO',
      endereco: 'Rua X, 100',
      fonte: 'Google Maps (Captura Assistida)',
    });

    await flushWrites();

    const health = analyzeBaseHealth(listLeads());
    assert.equal(health.total, 6);
    assert.equal(health.counts.ativos_protegidos, 2);
    assert.equal(health.counts.novos_acionaveis, 1);
    assert.equal(health.counts.legado_sintetico_ou_corrompido, 2);
    assert.equal(health.counts.fantasmas_sem_contato, 1);
    assert.equal(health.restante_apos_cirurgica, 3);
    assert.equal(health.removiveis_cirurgica, 3);

    await assert.rejects(
      () => executeCleanup({ mode: 'cirurgica', confirm: false }),
      /Confirmação explícita/i
    );

    const cir = await executeCleanup({ mode: 'cirurgica', confirm: true });
    assert.equal(cir.ok, true);
    assert.equal(cir.before_count, 6);
    assert.equal(cir.after_count, 3);
    assert.equal(cir.removed_count, 3);
    assert.equal(fs.existsSync(cir.backup_path), true);
    assert.equal(JSON.parse(fs.readFileSync(cir.backup_path, 'utf8')).length, 6);

    assert.ok(getLead(ativo1.id));
    assert.ok(getLead(ativo2.id));
    assert.ok(getLead(acionavel.id));
    assert.equal(getLead(legado1.id), null);
    assert.equal(getLead(legado2.id), null);
    assert.equal(getLead(fantasma.id), null);
    assert.equal(getStorageHealth().index_stats.total_indexed, 3);

    const rst = await executeCleanup({ mode: 'reset_total', confirm: true });
    assert.equal(rst.ok, true);
    assert.equal(rst.before_count, 3);
    assert.equal(rst.after_count, 0);
    assert.equal(rst.removed_count, 3);
    assert.equal(fs.existsSync(rst.backup_path), true);
    assert.equal(listLeads().length, 0);
    assert.equal(getStorageHealth().index_stats.total_indexed, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
