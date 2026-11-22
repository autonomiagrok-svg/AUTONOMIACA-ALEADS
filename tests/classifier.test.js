import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWebsiteHtml, buildPainTags, SITE_DEPENDENT_PAIN_TAGS } from '../src/classifier.js';
import { evaluateLead, sanitizePainTags } from '../src/scoring_modes.js';
import { setStoreFile, importRows, createLead, listLeads, flushWrites } from '../src/store.js';

test('parseWebsiteHtml detecta WhatsApp, Meta Pixel, GTM, e-mails válidos e Instagram filtrando lixo', () => {
  const html = `
    <html>
      <head>
        <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
        <script src="https://www.googletagmanager.com/gtag/js?id=G-123"></script>
      </head>
      <body>
        <img src="logo@2x.png" />
        <script src="app@1.0.js"></script>
        <a href="mailto:erro@sentry.io">Sentry</a>
        <a href="mailto:contato@restaurantesabor.com.br">Contato</a>
        <a href="https://wa.me/5533999998888">WhatsApp</a>
        <a href="https://www.instagram.com/p/ABC123/">Post</a>
        <a href="https://www.instagram.com/reel/XYZ999/">Reel</a>
        <a href="https://www.instagram.com/restaurantesabor/">Perfil</a>
      </body>
    </html>
  `;

  const parsed = parseWebsiteHtml(html);
  assert.equal(parsed.has_whatsapp, true);
  assert.equal(parsed.has_meta_pixel, true);
  assert.equal(parsed.has_gtm_or_ads, true);
  assert.deepEqual(parsed.emails_found, ['contato@restaurantesabor.com.br']);
  assert.equal(parsed.instagram_found, 'https://instagram.com/restaurantesabor');
});

test('buildPainTags gera etiquetas padronizadas corretamente', () => {
  const refDate = new Date('2026-11-22T12:00:00Z');

  // Lead sem site e só telefone fixo
  const tags1 = buildPainTags(
    { website: null, telefone: '(33) 3271-1234', whatsapp: null },
    {},
    refDate
  );
  assert.ok(tags1.includes('Sem Site'));
  assert.ok(tags1.includes('Só Telefone Fixo'));

  // Lead com site online sem WhatsApp e sem tráfego + empresa recente
  const tags2 = buildPainTags(
    { website: 'https://empresa.com.br', whatsapp: '(33) 99999-8888' },
    {
      website_audit: {
        online: true,
        https: true,
        has_whatsapp: false,
        has_meta_pixel: false,
        has_gtm_or_ads: false,
      },
      cnpj_info: {
        situacao_cadastral: 'ATIVA',
        data_inicio_atividade: '2026-01-15',
      },
    },
    refDate
  );
  assert.ok(tags2.includes('Site sem WhatsApp'));
  assert.ok(tags2.includes('Sem Tráfego Rastreado'));
  assert.ok(tags2.includes('Empresa Recente'));
  assert.equal(tags2.includes('CNPJ Inativo'), false);

  // Lead com CNPJ inativo
  const tags3 = buildPainTags(
    { website: null },
    { cnpj_info: { situacao_cadastral: 'BAIXADA', data_inicio_atividade: '2015-03-10' } },
    refDate
  );
  assert.ok(tags3.includes('CNPJ Inativo'));
  assert.equal(tags3.includes('Empresa Recente'), false);
});

test('evaluateLead altera ranqueamento entre os 4 modos para o mesmo par de leads', () => {
  const leadSemSite = {
    id: 'lead-a',
    nome_fantasia: 'Pizzaria Estrela',
    avaliacao: 4.8,
    total_avaliacoes: 35,
    whatsapp: '(33) 99999-1111',
    website: null,
    etiquetas_dor: ['Sem Site'],
  };

  const leadConsolidado = {
    id: 'lead-b',
    nome_fantasia: 'Atacado Forte',
    avaliacao: 4.3,
    total_avaliacoes: 200,
    whatsapp: '(33) 98888-2222',
    cnpj: '05.652.750/0001-61',
    website: 'https://atacadoforte.com.br',
    etiquetas_dor: [],
    diagnostico_fatos: {
      website_audit: { online: true, https: true, has_whatsapp: true, has_meta_pixel: true, has_gtm_or_ads: true },
      cnpj_info: { situacao_cadastral: 'ATIVA', capital_social: 250000, socios: ['CARLOS ALMEIDA'] },
    },
  };

  const digitalA = evaluateLead(leadSemSite, 'cacador_digital');
  const digitalB = evaluateLead(leadConsolidado, 'cacador_digital');
  assert.ok(digitalA.score > digitalB.score, `Caçador Digital deveria preferir leadSemSite (${digitalA.score} > ${digitalB.score})`);
  assert.ok(digitalA.motivo_destaque.includes('4.8'));

  const diretaA = evaluateLead(leadSemSite, 'venda_direta');
  const diretaB = evaluateLead(leadConsolidado, 'venda_direta');
  assert.ok(diretaB.score > diretaA.score, `Venda Direta deveria preferir leadConsolidado (${diretaB.score} > ${diretaA.score})`);

  const leadRecente = {
    id: 'lead-c',
    nome_fantasia: 'Café Novo',
    avaliacao: 4.9,
    total_avaliacoes: 8,
    whatsapp: '(33) 99123-4567',
    etiquetas_dor: ['Empresa Recente', 'Sem Site'],
    socios: ['MARIA SOUZA'],
  };
  const novosC = evaluateLead(leadRecente, 'novos_entrantes');
  const novosB = evaluateLead(leadConsolidado, 'novos_entrantes');
  assert.ok(novosC.score > novosB.score, `Novos Entrantes deveria preferir leadRecente (${novosC.score} > ${novosB.score})`);

  const eqA = evaluateLead(leadSemSite, 'equilibrado');
  assert.equal(eqA.mode, 'equilibrado');
  assert.equal(eqA.acionavel, true);
});

test('merge enriquecido de duplicatas no store preenche campos vazios sem duplicar registro', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomia-merge-test-'));
  const file = path.join(dir, 'leads.json');
  setStoreFile(file);

  try {
    const first = importRows([
      {
        nome_fantasia: 'Restaurante Pané',
        cidade: 'Governador Valadares',
        uf: 'MG',
        fonte: 'Google Maps (Captura Assistida)',
        fonte_tipo: 'MAPS',
        fonte_url: 'https://www.google.com/maps/place/Restaurante+Pane',
        avaliacao: 4.2,
        total_avaliacoes: 15,
      },
    ], { batchPrefix: 'MAPS' });

    assert.equal(first.added, 1);
    assert.equal(first.updated, 0);

    // Re-captura profunda com telefone, website, bairro e endereço completo
    const second = importRows([
      {
        nome_fantasia: 'Restaurante Pané',
        cidade: 'Governador Valadares',
        uf: 'MG',
        telefone: '(33) 99988-7766',
        whatsapp: '(33) 99988-7766',
        telefone_tipo: 'CELULAR',
        website: 'https://restaurantepane.com.br',
        endereco: 'Rua Afonso Pena, 1200 - Centro',
        bairro: 'Centro',
        categoria_raw: 'Restaurante',
        segmento: 'RESTAURANTE',
        fonte_url: 'https://www.google.com/maps/place/Restaurante+Pane',
      },
    ], { batchPrefix: 'MAPS' });

    assert.equal(second.added, 0);
    assert.equal(second.updated, 1);
    assert.equal(second.duplicates, 0);

    await flushWrites();
    const all = listLeads();
    assert.equal(all.length, 1);
    assert.equal(all[0].telefone, '(33) 99988-7766');
    assert.equal(all[0].whatsapp, '(33) 99988-7766');
    assert.equal(all[0].telefone_tipo, 'CELULAR');
    assert.equal(all[0].website, 'https://restaurantepane.com.br');
    assert.equal(all[0].bairro, 'Centro');
    assert.equal(all[0].segmento, 'RESTAURANTE');
    assert.ok(all[0].lote_origem.startsWith('Maps •'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trava de consistência impede etiquetas de site online em leads Sem Site, Link na Bio ou Site Fora do Ar', async () => {
  // 1. Sem Site: nunca recebe tags dependentes de site mesmo se audit vier populado
  const tagsSemSite = buildPainTags(
    { website: null, whatsapp: '(33) 99999-1111' },
    { website_audit: { online: false, https: false, has_viewport_mobile: false, ttfb_ms: 3500, has_whatsapp: false } }
  );
  assert.ok(tagsSemSite.includes('Sem Site'));
  for (const forbidden of SITE_DEPENDENT_PAIN_TAGS) {
    assert.equal(tagsSemSite.includes(forbidden), false, `Sem Site não deveria receber "${forbidden}"`);
  }

  // 2. Site Fora do Ar: nunca recebe Sem Mobile, Sem HTTPS, Site Lento, etc.
  const tagsOffline = buildPainTags(
    { website: 'https://sitequebrado.com.br', whatsapp: '(33) 99999-2222' },
    { website_audit: { online: false, https: false, has_viewport_mobile: false, ttfb_ms: 4000, has_whatsapp: false } }
  );
  assert.ok(tagsOffline.includes('Site Fora do Ar'));
  for (const forbidden of SITE_DEPENDENT_PAIN_TAGS) {
    assert.equal(tagsOffline.includes(forbidden), false, `Site Fora do Ar não deveria receber "${forbidden}"`);
  }

  // 3. Só Link na Bio: nunca recebe Sem Mobile, Sem HTTPS, Site sem WhatsApp, etc.
  const tagsBio = buildPainTags(
    { website: 'https://linktr.ee/lanchonetex', whatsapp: '(33) 99999-3333' },
    { website_audit: { online: true, https: true, has_viewport_mobile: false, has_whatsapp: false, stack_detectada: ['LINK_BIO'] } }
  );
  assert.ok(tagsBio.includes('Só Link na Bio'));
  for (const forbidden of SITE_DEPENDENT_PAIN_TAGS) {
    assert.equal(tagsBio.includes(forbidden), false, `Só Link na Bio não deveria receber "${forbidden}"`);
  }

  // 4. Sanitização retroativa em tempo de leitura e na gravação do store
  const legacyDirtyLead = {
    nome_fantasia: 'Lanchonete Legado',
    website: null,
    whatsapp: '(33) 99999-4444',
    etiquetas_dor: ['Sem Site', 'Sem Mobile', 'Sem HTTPS', 'Site sem WhatsApp'],
  };
  const cleaned = sanitizePainTags(legacyDirtyLead);
  assert.deepEqual(cleaned, ['Sem Site']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomia-sanitize-test-'));
  try {
    setStoreFile(path.join(dir, 'leads.json'));
    const saved = createLead(legacyDirtyLead);
    await flushWrites();
    assert.deepEqual(saved.etiquetas_dor, ['Sem Site']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
