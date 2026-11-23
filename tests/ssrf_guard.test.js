import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExternalUrl } from '../src/http/ssrf_guard.js';
import { auditWebsite } from '../src/classifier.js';

test('validateExternalUrl bloqueia IPs privados, loopback, metadata, localhost e protocolos não HTTP', async () => {
  const blockedUrls = [
    'http://127.0.0.1:3100',
    'http://localhost/admin',
    'http://sub.localhost:8080/',
    'http://impressora.local/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/status',
    'http://172.16.5.10/',
    'http://192.168.1.1/',
    'http://[::1]:3100/',
    'http://[::ffff:127.0.0.1]/',
    'file:///etc/passwd',
    'ftp://files.example.com/data.csv',
  ];

  for (const url of blockedUrls) {
    await assert.rejects(
      () => validateExternalUrl(url),
      (err) => err?.code === 'SSRF_BLOCKED',
      `Esperava bloqueio SSRF para ${url}`
    );
  }
});

test('validateExternalUrl bloqueia domínio externo cujo DNS resolve para IP privado', async () => {
  const fakeLookup = async () => [{ address: '10.10.0.5', family: 4 }];
  await assert.rejects(
    () => validateExternalUrl('https://rebind.exemplo.com.br', { lookupImpl: fakeLookup }),
    (err) => err?.code === 'SSRF_BLOCKED'
  );
});

test('validateExternalUrl aprova URL pública externa com lookup mockado', async () => {
  const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const res = await validateExternalUrl('https://exemplo.com.br/contato', { lookupImpl: fakeLookup });
  assert.equal(res.hostname, 'exemplo.com.br');
  assert.deepEqual(res.addresses, ['93.184.216.34']);
});

test('auditWebsite interrompe imediatamente sem fallback HTTP quando SSRF bloqueia', async () => {
  let fetchCalled = 0;
  let validatorCalls = 0;
  const fakeFetch = async () => {
    fetchCalled += 1;
    throw new Error('não deveria chamar fetch');
  };
  const strictValidator = async (url) => {
    validatorCalls += 1;
    return validateExternalUrl(url);
  };

  const result = await auditWebsite('http://127.0.0.1:3100', {
    fetchImpl: fakeFetch,
    validateUrlImpl: strictValidator,
  });

  assert.equal(result.online, false);
  assert.equal(fetchCalled, 0);
  assert.equal(validatorCalls, 1);
  assert.ok(result.error);
});
