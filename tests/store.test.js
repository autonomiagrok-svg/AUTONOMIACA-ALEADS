import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  setStoreFile,
  createLead,
  importRows,
  findLeadDuplicates,
  listLeads,
  flushWrites,
} from '../src/store.js';

function createTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomia-caca-leads-'));
  const file = path.join(dir, 'leads.json');
  setStoreFile(file);
  return { dir, file };
}

test('deduplicação detecta duplicatas por fonte_url, telefone fixo, domínio e CNPJ', async () => {
  const { dir } = createTempStore();
  try {
    createLead({
      nome_fantasia: 'Restaurante Alpha',
      cidade: 'Governador Valadares',
      cnpj: '05.652.750/0001-61',
      telefone: '(33) 3271-1000',
      website: 'https://www.alpha.com.br/cardapio',
      fonte_url: 'https://www.google.com/maps/place/Restaurante+Alpha',
    });

    // 1. Por fonte_url
    const dupUrl = findLeadDuplicates({
      nome_fantasia: 'Outro Nome Qualquer',
      cidade: 'Belo Horizonte',
      fonte_url: 'https://www.google.com/maps/place/Restaurante+Alpha/',
    });
    assert.equal(dupUrl.length, 1);

    // 2. Por telefone fixo
    const dupPhone = findLeadDuplicates({
      nome_fantasia: 'Alpha Filial',
      cidade: 'Ipatinga',
      telefone: '3332711000',
    });
    assert.equal(dupPhone.length, 1);

    // 3. Por domínio do website
    const dupDomain = findLeadDuplicates({
      nome_fantasia: 'Alpha Ltda',
      cidade: 'Caratinga',
      website: 'http://alpha.com.br/sobre',
    });
    assert.equal(dupDomain.length, 1);

    // 4. Por CNPJ válido
    const dupCnpj = findLeadDuplicates({
      nome_fantasia: 'Alpha Matriz',
      cidade: 'Vitória',
      cnpj: '05652750000161',
    });
    assert.equal(dupCnpj.length, 1);

    // 5. Redes sociais genéricas não devem causar falso positivo por domínio
    createLead({
      nome_fantasia: 'Bar Beta',
      cidade: 'Governador Valadares',
      website: 'https://instagram.com/barbeta',
    });
    const notDupSocial = findLeadDuplicates({
      nome_fantasia: 'Loja Gama',
      cidade: 'Governador Valadares',
      website: 'https://instagram.com/lojagama',
    });
    assert.equal(notDupSocial.length, 0);

    await flushWrites();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('escritas concorrentes via Promise.all preservam 100% dos registros sem corromper o JSON', async () => {
  const { dir, file } = createTempStore();
  try {
    const total = 40;
    const tasks = Array.from({ length: total }, (_, i) =>
      Promise.resolve().then(() =>
        createLead({
          nome_fantasia: `Empresa Concorrente ${i + 1}`,
          cidade: 'Governador Valadares',
          segmento: 'ESCRITORIO',
        })
      )
    );

    await Promise.all(tasks);
    await flushWrites();

    const inMemory = listLeads();
    assert.equal(inMemory.length, total);

    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(Array.isArray(onDisk), true);
    assert.equal(onDisk.length, total);

    const res = importRows([
      { nome_fantasia: 'Empresa Concorrente 1', cidade: 'Governador Valadares' },
      { nome_fantasia: 'Empresa Nova 41', cidade: 'Governador Valadares' },
    ]);
    await flushWrites();

    assert.equal(res.added, 1);
    assert.equal(res.duplicates, 1);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, total + 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
