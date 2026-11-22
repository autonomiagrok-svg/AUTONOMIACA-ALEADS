import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, buildWhatsAppLink, validateCNPJ, normalizeDomain } from '../src/hygiene.js';

test('normalizePhone e buildWhatsAppLink tratam DDD 55 (11 dígitos) sem confundir com DDI', () => {
  const norm = normalizePhone('(55) 99999-8888');
  assert.equal(norm.valido, true);
  assert.equal(norm.tipo, 'CELULAR');
  assert.equal(norm.whatsapp_provavel, true);
  assert.equal(norm.digits, '55999998888');
  assert.equal(norm.e164, '5555999998888');

  const link = buildWhatsAppLink('(55) 99999-8888', 'Olá');
  assert.equal(link, 'https://wa.me/5555999998888?text=Ol%C3%A1');
});

test('normalizePhone e buildWhatsAppLink não duplicam DDI 55 em número de 13 dígitos', () => {
  const norm = normalizePhone('+55 (33) 99999-8888');
  assert.equal(norm.valido, true);
  assert.equal(norm.tipo, 'CELULAR');
  assert.equal(norm.digits, '33999998888');
  assert.equal(norm.e164, '5533999998888');

  const link = buildWhatsAppLink('5533999998888');
  assert.equal(link, 'https://wa.me/5533999998888');
});

test('normalizePhone separa corretamente FIXO (10 dígitos) de CELULAR (11 dígitos com 9)', () => {
  const fixo = normalizePhone('(33) 3271-1234');
  assert.equal(fixo.valido, true);
  assert.equal(fixo.tipo, 'FIXO');
  assert.equal(fixo.whatsapp_provavel, false);

  const celular = normalizePhone('(33) 98888-7777');
  assert.equal(celular.valido, true);
  assert.equal(celular.tipo, 'CELULAR');
  assert.equal(celular.whatsapp_provavel, true);

  const invalido = normalizePhone('12345');
  assert.equal(invalido.valido, false);
  assert.equal(invalido.tipo, 'DESCONHECIDO');
  assert.equal(invalido.e164, null);
});

test('validateCNPJ valida dígitos verificadores e rejeita sequências repetidas', () => {
  const valid = validateCNPJ('05.652.750/0001-61');
  assert.equal(valid.valido, true);
  assert.equal(valid.digits, '05652750000161');
  assert.equal(valid.formatted, '05.652.750/0001-61');

  const wrongCheck = validateCNPJ('05.652.750/0001-62');
  assert.equal(wrongCheck.valido, false);

  const repeated = validateCNPJ('00.000.000/0000-00');
  assert.equal(repeated.valido, false);

  const allOnes = validateCNPJ('11111111111111');
  assert.equal(allOnes.valido, false);
});

test('normalizeDomain limpa URLs comerciais e ignora domínios de redes sociais', () => {
  assert.equal(normalizeDomain('https://www.empresa.com.br/contato?utm=1'), 'empresa.com.br');
  assert.equal(normalizeDomain('http://SUB.Empresa.COM/'), 'sub.empresa.com');
  assert.equal(normalizeDomain('https://instagram.com/minhaempresa'), null);
  assert.equal(normalizeDomain('https://www.facebook.com/pagina'), null);
  assert.equal(normalizeDomain('https://linktr.ee/loja'), null);
  assert.equal(normalizeDomain('https://wa.me/5533999998888'), null);
});
