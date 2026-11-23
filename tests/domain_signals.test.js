import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SITE_DEPENDENT_PAIN_TAGS,
  sanitizePainTags,
  extractContactProfile,
  inferOrigin,
  inferOriginKey,
  mapCategoryToSegment,
  hashString,
  toIsoDateLocal,
  addDaysIsoDate,
  isValidIsoDate,
} from '../src/domain_signals.js';

test('sanitizePainTags normaliza etiqueta principal de site e remove contradições', () => {
  const noSite = sanitizePainTags({
    website: null,
    etiquetas_dor: ['Sem Site', 'Sem Mobile', 'Sem HTTPS', 'Site Lento', 'Empresa Recente'],
  });
  assert.deepEqual(noSite.sort(), ['Empresa Recente', 'Sem Site'].sort());

  const linkBio = sanitizePainTags({
    website: 'https://linktr.ee/exemplo',
    etiquetas_dor: ['Sem Site', 'Sem Mobile', 'E-commerce sem Pixel'],
  });
  assert.deepEqual(linkBio, ['Só Link na Bio']);

  const onlineWithGaps = sanitizePainTags({
    website: 'https://loja.com.br',
    diagnostico_fatos: { website_audit: { online: true } },
    etiquetas_dor: ['Sem Mobile', 'Site Lento', 'E-commerce sem Pixel'],
  });
  assert.equal(onlineWithGaps.length, 3);
  assert.ok(SITE_DEPENDENT_PAIN_TAGS.has('E-commerce sem Pixel'));
});

test('extractContactProfile distingue celular, fixo, só fixo, WhatsApp inválido e e-mail', () => {
  const cel = extractContactProfile({ whatsapp: '(33) 99999-1111' });
  assert.equal(cel.hasMobile, true);
  assert.equal(cel.hasLandline, false);
  assert.equal(cel.isLandlineOnly, false);
  assert.equal(cel.hasAnyPhone, true);
  assert.equal(cel.primaryType, 'CELULAR');

  const fixo = extractContactProfile({ telefone: '(33) 3271-1000' });
  assert.equal(fixo.hasMobile, false);
  assert.equal(fixo.hasLandline, true);
  assert.equal(fixo.isLandlineOnly, true);
  assert.equal(fixo.hasAnyPhone, true);
  assert.equal(fixo.primaryType, 'FIXO');

  const misto = extractContactProfile({ whatsapp: '(33) 99999-1111', telefone: '(33) 3271-1000' });
  assert.equal(misto.hasMobile, true);
  assert.equal(misto.hasLandline, true);
  assert.equal(misto.isLandlineOnly, false);

  const invalidWa = extractContactProfile({ whatsapp: '(33) 99999-1111', whatsapp_status: 'INVALIDO' });
  assert.equal(invalidWa.waInvalid, true);
  assert.equal(invalidWa.hasMobile, false);
  assert.equal(invalidWa.isLandlineOnly, false);
  assert.equal(invalidWa.hasAnyPhone, true);

  const onlyEmail = extractContactProfile({ email: 'contato@empresa.com.br' });
  assert.equal(onlyEmail.hasAnyPhone, false);
  assert.equal(onlyEmail.hasEmail, true);
  assert.equal(onlyEmail.primaryType, 'DESCONHECIDO');
});

test('inferOrigin, mapCategoryToSegment e hashString são consistentes e determinísticos', () => {
  assert.deepEqual(inferOrigin({ fonte_tipo: 'MAPS' }), { key: 'MAPS', label: 'Maps' });
  assert.equal(inferOriginKey({ fonte: 'OpenStreetMap Overpass' }), 'OSM');
  assert.deepEqual(inferOrigin({ lote_origem: 'CSV • 23/11 10:00' }), { key: 'CSV', label: 'CSV' });
  assert.deepEqual(inferOrigin({ fonte: 'Cadastro manual' }), { key: 'MANUAL', label: 'Manual' });

  assert.equal(mapCategoryToSegment('Clínica odontológica'), 'CLINICA');
  assert.equal(mapCategoryToSegment('Hamburgueria artesanal'), 'LANCHONETE');
  assert.equal(mapCategoryToSegment('Qualquer', 'ACADEMIA'), 'ACADEMIA');
  assert.equal(mapCategoryToSegment('Desconhecido'), 'OUTRO');

  const h1 = hashString('lead-abc-123');
  const h2 = hashString('lead-abc-123');
  const h3 = hashString('lead-abc-124');
  assert.equal(typeof h1, 'number');
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test('helpers de data local e validação ISO são UTC-neutros', () => {
  assert.equal(toIsoDateLocal(new Date('2026-11-23T12:00:00')), '2026-11-23');
  assert.equal(addDaysIsoDate('2026-11-28', 4), '2026-12-02');
  assert.equal(addDaysIsoDate('2026-02-28', 1), '2026-03-01');
  assert.equal(isValidIsoDate('2026-11-23'), true);
  assert.equal(isValidIsoDate('2026-02-30'), false);
  assert.equal(isValidIsoDate('23/11/2026'), false);
});
