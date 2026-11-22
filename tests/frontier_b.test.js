import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWebsiteHtml, buildPainTags } from '../src/classifier.js';
import { evaluateValueMatrix, summarizeMatrix } from '../src/value_matrix.js';
import { generateSmartCopy } from '../src/copy_engine.js';
import { LeadIndex } from '../src/storage/lead_index.js';
import { WalJsonAdapter } from '../src/storage/wal_adapter.js';
import {
  setStoreFile,
  createLead,
  updateLead,
  getLead,
  listLeads,
  flushWal,
  compactNow,
  getStorageHealth,
} from '../src/store.js';

test('Raio-X 2ª geração detecta SHOPIFY, WOOCOMMERCE, WIX, LINK_BIO, mobile, SEO, schema e novas dores', () => {
  const shopifyHtml = `
    <html>
      <head>
        <title>Loja Premium de Roupas</title>
        <meta name="description" content="Moda masculina e feminina com entrega rápida." />
        <script src="https://cdn.shopify.com/s/files/1/store.js"></script>
        <script type="application/ld+json">{"@type":"LocalBusiness","name":"Loja Premium"}</script>
      </head>
      <body>Sem viewport mobile e sem pixel</body>
    </html>
  `;
  const parsedShop = parseWebsiteHtml(shopifyHtml);
  assert.ok(parsedShop.stack_detectada.includes('SHOPIFY'));
  assert.equal(parsedShop.has_ecommerce, true);
  assert.equal(parsedShop.has_viewport_mobile, false);
  assert.equal(parsedShop.seo_basico_ok, true);
  assert.equal(parsedShop.has_schema_local, true);

  const tagsShop = buildPainTags(
    { website: 'https://lojapremium.com.br', whatsapp: '(33) 99999-1111' },
    { website_audit: { ...parsedShop, online: true, https: true, ttfb_ms: 2100 } }
  );
  assert.ok(tagsShop.includes('Sem Mobile'));
  assert.ok(tagsShop.includes('Site Lento'));
  assert.ok(tagsShop.includes('E-commerce sem Pixel'));

  const wooParsed = parseWebsiteHtml('<div class="woocommerce wp-content"><meta name="viewport" content="width=device-width"></div>');
  assert.ok(wooParsed.stack_detectada.includes('WOOCOMMERCE'));
  assert.ok(wooParsed.stack_detectada.includes('WORDPRESS'));
  assert.equal(wooParsed.has_viewport_mobile, true);

  const wixParsed = parseWebsiteHtml('<html><body>Site Wix</body></html>', { 'x-wix-request-id': 'abc123' });
  assert.ok(wixParsed.stack_detectada.includes('WIX'));

  const bioParsed = parseWebsiteHtml('<html><title>Links</title></html>', {}, 'https://linktr.ee/lojadobairro');
  assert.ok(bioParsed.stack_detectada.includes('LINK_BIO'));
  const bioTags = buildPainTags(
    { website: 'https://linktr.ee/lojadobairro' },
    { website_audit: { ...bioParsed, online: true, https: true, ttfb_ms: 300 } }
  );
  assert.ok(bioTags.includes('Só Link na Bio'));

  const copyEcom = generateSmartCopy(
    { id: 'ec1', nome_fantasia: 'Loja Premium', website: 'https://lojapremium.com.br', etiquetas_dor: tagsShop },
    { modeId: 'cacador_digital', variationIndex: 0 }
  );
  assert.equal(copyEcom.hook_label, 'E-commerce sem Pixel');
});

test('evaluateValueMatrix separa corretamente os 4 quadrantes e zera caixa para CNPJ Inativo', () => {
  const leadOuro = {
    id: 'q-ouro',
    nome_fantasia: 'Clínica Ouro',
    segmento: 'CLINICA',
    status: 'NOVO',
    whatsapp: '(33) 99999-1111',
    avaliacao: 4.8,
    total_avaliacoes: 120,
    cnpj: '05.652.750/0001-61',
    website: 'https://clinicaouro.com.br',
    etiquetas_dor: ['Site sem WhatsApp', 'Sem Tráfego Rastreado'],
    diagnostico_fatos: {
      website_audit: { online: true, has_ecommerce: false, stack_detectada: ['RD_STATION'] },
      cnpj_info: { situacao_cadastral: 'ATIVA', capital_social: 250000 },
    },
  };

  const leadExpansao = {
    id: 'q-exp',
    nome_fantasia: 'Loja Consolidada',
    segmento: 'LOJA',
    status: 'NOVO',
    whatsapp: '(33) 99999-2222',
    avaliacao: 4.7,
    total_avaliacoes: 250,
    cnpj: '05.652.750/0001-61',
    website: 'https://lojaconsolidada.com.br',
    etiquetas_dor: [],
    diagnostico_fatos: {
      website_audit: { online: true, has_ecommerce: true, has_meta_pixel: true, has_whatsapp: true, stack_detectada: ['SHOPIFY'] },
      cnpj_info: { situacao_cadastral: 'ATIVA', capital_social: 300000 },
    },
  };

  const leadEntrada = {
    id: 'q-ent',
    nome_fantasia: 'Lanchonete Pequena',
    segmento: 'LANCHONETE',
    status: 'NOVO',
    whatsapp: '(33) 99999-3333',
    avaliacao: 4.0,
    total_avaliacoes: 6,
    website: null,
    etiquetas_dor: ['Sem Site', 'Sem Mobile'],
  };

  const leadObs = {
    id: 'q-obs',
    nome_fantasia: 'Empresa Baixada',
    segmento: 'CLINICA',
    status: 'NOVO',
    avaliacao: 4.9,
    total_avaliacoes: 300,
    website: 'https://empresabaixada.com.br',
    etiquetas_dor: ['CNPJ Inativo'],
    diagnostico_fatos: {
      cnpj_info: { situacao_cadastral: 'BAIXADA', capital_social: 500000 },
    },
  };

  const mOuro = evaluateValueMatrix(leadOuro);
  const mExp = evaluateValueMatrix(leadExpansao);
  const mEnt = evaluateValueMatrix(leadEntrada);
  const mObs = evaluateValueMatrix(leadObs);

  assert.equal(mOuro.quadrante, 'OURO');
  assert.ok(mOuro.caixa_score >= 45 && mOuro.brecha_score >= 45);

  assert.equal(mExp.quadrante, 'EXPANSAO');
  assert.ok(mExp.caixa_score >= 45 && mExp.brecha_score < 45);

  assert.equal(mEnt.quadrante, 'ENTRADA');
  assert.ok(mEnt.caixa_score < 45 && mEnt.brecha_score >= 45);

  assert.equal(mObs.quadrante, 'OBSERVACAO');
  assert.equal(mObs.caixa_score, 0);

  const summary = summarizeMatrix([leadOuro, leadExpansao, leadEntrada, leadObs]);
  assert.equal(summary.quadrantes.OURO.total, 1);
  assert.equal(summary.quadrantes.EXPANSAO.total, 1);
  assert.equal(summary.quadrantes.ENTRADA.total, 1);
  assert.equal(summary.quadrantes.OBSERVACAO.total, 1);
  assert.deepEqual(summary.quadrantes.OURO.lead_ids, ['q-ouro']);

  // Negócio local realista do Google Maps: 50+ avaliações, nota 4.4, telefone/endereço e Sem Site -> OURO
  const mapsLocalForte = evaluateValueMatrix({
    id: 'maps-forte',
    nome_fantasia: 'Lanchonete Sabor Real',
    segmento: 'LANCHONETE',
    status: 'NOVO',
    whatsapp: '(33) 99999-4444',
    endereco: 'Av. Minas Gerais, 500 - Centro',
    avaliacao: 4.4,
    total_avaliacoes: 62,
    website: null,
  });
  assert.equal(mapsLocalForte.quadrante, 'OURO');
  assert.ok(mapsLocalForte.caixa_score >= 45);
  assert.ok(mapsLocalForte.brecha_score >= 45);

  // Negócio local pequeno do Google Maps: 3 avaliações e Sem Site -> ENTRADA
  const mapsLocalPequeno = evaluateValueMatrix({
    id: 'maps-pequeno',
    nome_fantasia: 'Quiosque da Praça',
    segmento: 'LANCHONETE',
    status: 'NOVO',
    whatsapp: '(33) 99999-5555',
    endereco: 'Rua A, 10',
    avaliacao: 4.1,
    total_avaliacoes: 3,
    website: null,
  });
  assert.equal(mapsLocalPequeno.quadrante, 'ENTRADA');
  assert.ok(mapsLocalPequeno.caixa_score < 45);
  assert.ok(mapsLocalPequeno.brecha_score >= 45);
});

test('WalJsonAdapter e store.js gravam no WAL, sobrevivem a linha truncada no replay e compactam corretamente', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomia-wal-test-'));
  const file = path.join(dir, 'leads.json');
  const walFile = path.join(dir, 'leads.wal.ndjson');

  try {
    setStoreFile(file, { compactThreshold: 10 });

    const l1 = createLead({ nome_fantasia: 'Empresa WAL 1', cidade: 'Governador Valadares', whatsapp: '(33) 99999-1111' });
    const l2 = createLead({ nome_fantasia: 'Empresa WAL 2', cidade: 'Governador Valadares', whatsapp: '(33) 99999-2222' });
    updateLead(l1.id, { status: 'QUALIFICADO' });
    await flushWal();

    // Antes de atingir o limiar (10), o WAL deve conter as 3 operações e leads.json ainda estar com snapshot inicial []
    assert.equal(fs.existsSync(walFile), true);
    const walLinesBefore = fs.readFileSync(walFile, 'utf8').trim().split('\n');
    assert.equal(walLinesBefore.length, 3);
    assert.equal(getStorageHealth().storage_stats.wal_ops, 3);

    // Simula queda abrupta com última linha corrompida/truncada no WAL
    fs.appendFileSync(walFile, '{"op":"UPSERT","lead":{"id":"corrompido', 'utf8');

    // Simula reinicialização fria (nova instância carregando snapshot + replay resiliente do WAL)
    const coldAdapter = new WalJsonAdapter(file, { compactThreshold: 10 });
    const recovered = coldAdapter.load();
    assert.equal(recovered.length, 2);
    const rec1 = recovered.find((x) => x.id === l1.id);
    assert.equal(rec1.status, 'QUALIFICADO');
    assert.equal(recovered.some((x) => x.id === l2.id), true);

    // Após replay na inicialização fria, o snapshot foi compactado e o WAL foi limpo
    assert.equal(fs.readFileSync(walFile, 'utf8').trim(), '');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 2);

    // Testa compactação automática (threshold = 3) e manual (compactNow)
    setStoreFile(file, { compactThreshold: 3 });
    assert.equal(listLeads().length, 2);
    createLead({ nome_fantasia: 'Auto Compact 1', cidade: 'Governador Valadares' });
    createLead({ nome_fantasia: 'Auto Compact 2', cidade: 'Governador Valadares' });
    createLead({ nome_fantasia: 'Auto Compact 3', cidade: 'Governador Valadares' });
    await flushWal();

    assert.equal(getStorageHealth().storage_stats.wal_ops, 0);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 5);

    const lExtra = createLead({ nome_fantasia: 'Manual Compact', cidade: 'Governador Valadares' });
    await flushWal();
    assert.equal(getStorageHealth().storage_stats.wal_ops, 1);

    const statsAfter = await compactNow();
    assert.equal(statsAfter.wal_ops, 0);
    assert.equal(getLead(lExtra.id)?.nome_fantasia, 'Manual Compact');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 6);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('LeadIndex mantém lookups O(1) consistentes após upsert e remove', () => {
  const index = new LeadIndex();
  const lead = {
    id: 'idx-1',
    nome_fantasia: 'Padaria Índice',
    cidade: 'Governador Valadares',
    cnpj: '05.652.750/0001-61',
    telefone: '(33) 3271-9000',
    whatsapp: '(33) 99999-9000',
    website: 'https://www.padariaindice.com.br/contato',
    fonte_url: 'https://www.google.com/maps/place/Padaria+Indice',
  };

  index.upsert(lead);
  assert.equal(index.getById('idx-1')?.nome_fantasia, 'Padaria Índice');
  assert.equal(index.findDuplicateCandidates({ cnpj: '05652750000161' }).length, 1);
  assert.equal(index.findDuplicateCandidates({ telefone: '3332719000' }).length, 1);
  assert.equal(index.findDuplicateCandidates({ whatsapp: '5533999999000' }).length, 1);
  assert.equal(index.findDuplicateCandidates({ website: 'http://padariaindice.com.br' }).length, 1);
  assert.equal(index.findDuplicateCandidates({ fonte_url: 'https://www.google.com/maps/place/Padaria+Indice/' }).length, 1);

  // Atualiza domínio e telefone — chaves antigas não devem mais dar match
  index.upsert({ ...lead, telefone: '(33) 3271-8000', website: 'https://novodominio.com.br' });
  assert.equal(index.findDuplicateCandidates({ telefone: '3332719000' }).length, 0);
  assert.equal(index.findDuplicateCandidates({ telefone: '3332718000' }).length, 1);
  assert.equal(index.findDuplicateCandidates({ website: 'http://padariaindice.com.br' }).length, 0);
  assert.equal(index.findDuplicateCandidates({ website: 'https://novodominio.com.br' }).length, 1);

  // Remove — todas as chaves devem sumir
  assert.equal(index.remove('idx-1'), true);
  assert.equal(index.getById('idx-1'), null);
  assert.equal(index.findDuplicateCandidates({ cnpj: '05652750000161' }).length, 0);
  assert.equal(index.getStats().total_indexed, 0);
});

test('evaluateValueMatrix ignora etiquetas conflitantes legadas e summarizeMatrix separa celular vs fixo', () => {
  // Lead legado com Sem Site + Sem Mobile + Sem HTTPS salvos no JSON -> brecha_score deve ser exato (50, não 95)
  const leadLegacy = {
    id: 'mx-legacy',
    nome_fantasia: 'Restaurante Legado',
    segmento: 'RESTAURANTE',
    status: 'NOVO',
    whatsapp: '(33) 99999-1111',
    endereco: 'Rua Principal, 100',
    avaliacao: 4.5,
    total_avaliacoes: 80,
    website: null,
    etiquetas_dor: ['Sem Site', 'Sem Mobile', 'Sem HTTPS', 'Site Lento'],
  };
  const evalLegacy = evaluateValueMatrix(leadLegacy);
  assert.equal(evalLegacy.quadrante, 'OURO');
  assert.equal(evalLegacy.brecha_score, 50);
  assert.deepEqual(evalLegacy.sinais_brecha, ['Sem Site']);

  // Lead OURO apenas com telefone FIXO
  const leadFixo = {
    id: 'mx-fixo',
    nome_fantasia: 'Padaria Fixo',
    segmento: 'PADARIA',
    status: 'NOVO',
    telefone: '(33) 3271-2222',
    whatsapp: null,
    endereco: 'Av. Brasil, 200',
    avaliacao: 4.6,
    total_avaliacoes: 95,
    website: null,
    etiquetas_dor: ['Sem Site'],
  };

  // Lead OURO com whatsapp_status INVALIDO -> fora das duas listas prontas
  const leadInvalido = {
    id: 'mx-invalido',
    nome_fantasia: 'Bar Inválido',
    segmento: 'BAR',
    status: 'NOVO',
    telefone: '(33) 3271-3333',
    whatsapp_status: 'INVALIDO',
    endereco: 'Av. Brasil, 300',
    avaliacao: 4.6,
    total_avaliacoes: 110,
    website: null,
  };

  // Lead com CNPJ Inativo -> fora das listas prontas
  const leadCnpjInativo = {
    id: 'mx-inativo',
    nome_fantasia: 'Clínica Baixada',
    segmento: 'CLINICA',
    status: 'NOVO',
    whatsapp: '(33) 99999-4444',
    avaliacao: 4.8,
    total_avaliacoes: 200,
    website: null,
    etiquetas_dor: ['CNPJ Inativo', 'Sem Site'],
    diagnostico_fatos: { cnpj_info: { situacao_cadastral: 'BAIXADA' } },
  };

  const summary = summarizeMatrix([leadLegacy, leadFixo, leadInvalido, leadCnpjInativo]);
  const ouro = summary.quadrantes.OURO;
  assert.equal(ouro.total, 3);
  assert.equal(ouro.acionaveis_celular, 1);
  assert.equal(ouro.acionaveis_fixo, 1);
  assert.equal(ouro.acionaveis, 2);
  assert.deepEqual(ouro.lead_ids_prontos_celular, ['mx-legacy']);
  assert.deepEqual(ouro.lead_ids_prontos_com_fixo.sort(), ['mx-fixo', 'mx-legacy']);
  assert.equal(ouro.lead_ids_prontos_com_fixo.includes('mx-invalido'), false);
  assert.equal(summary.quadrantes.ENTRADA.lead_ids_prontos_com_fixo.includes('mx-inativo'), false);
});
