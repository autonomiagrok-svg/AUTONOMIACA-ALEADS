import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ingestAndEnrichMapsBatch } from '../src/autopilot_engine.js';
import {
  createMission,
  getMission,
  recordMissionBatch,
  clearMissionsForTest,
} from '../src/maps_mission.js';
import { setDataDir, getLead, flushWrites } from '../src/store.js';

const root = process.cwd();

test('ingestAndEnrichMapsBatch calcula telemetry completa e não vaza _capture_meta para o Lead persistido', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomia-telemetry-test-'));
  setDataDir(dir);

  try {
    const batch = [
      {
        nome_fantasia: 'Pizzaria Centro',
        categoria_raw: 'Pizzaria',
        telefone: '(33) 99988-7766',
        website: 'https://pizzariacentro.com.br',
        endereco: 'Rua A, 100 - Centro, Governador Valadares - MG',
        bairro: 'Centro',
        cidade: 'Governador Valadares',
        uf: 'MG',
        avaliacao: 4.7,
        fonte_url: 'https://www.google.com/maps/place/Pizzaria+Centro',
        _capture_meta: { source: 'detail', panel_found: true, raw_phone_found: true, raw_website_found: true },
      },
      {
        nome_fantasia: 'Oficina Fixo',
        categoria_raw: 'Oficina mecânica',
        telefone: '(33) 3271-4040',
        endereco: 'Av. Brasil, 200',
        cidade: 'Governador Valadares',
        uf: 'MG',
        _capture_meta: { source: 'detail', panel_found: true, raw_phone_found: true, raw_website_found: false },
      },
      {
        nome_fantasia: 'Loja Tel Inválido',
        categoria_raw: 'Loja',
        telefone: '123',
        website: 'https://lojateste.com.br',
        cidade: 'Governador Valadares',
        uf: 'MG',
        _capture_meta: { source: 'card_only', panel_found: false, raw_phone_found: true, raw_website_found: true },
      },
    ];

    const res = await ingestAndEnrichMapsBatch(batch, { autoDiagnose: false });
    assert.equal(res.imported, 3);
    assert.deepEqual(res.telemetry, {
      received: 3,
      detail_ok: 2,
      card_only_fallback: 1,
      raw_phone_present: 3,
      valid_phone_kept: 2,
      phone_dropped_hygiene: 1,
      with_whatsapp: 1,
      with_landline: 1,
      with_website: 2,
      with_address: 2,
      with_bairro: 1,
      with_rating: 1,
    });

    for (const id of res.lead_ids_lote) {
      const saved = getLead(id);
      assert.ok(saved);
      assert.equal('_capture_meta' in saved, false, 'Lead persistido não pode conter _capture_meta');
    }
  } finally {
    await flushWrites().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recordMissionBatch acumula telemetry em múltiplos lotes, calcula rates e controla anomaly_warning', () => {
  clearMissionsForTest();

  // Caso 1: 2 lotes sem nenhum telefone válido (3 + 2 = 5 cards) -> dispara anomaly_warning
  const mWarn = createMission({ cidade: 'Governador Valadares', uf: 'MG', segmento: 'RESTAURANTE', silent: true });
  assert.equal(mWarn.telemetry.anomaly_warning, null);

  recordMissionBatch(mWarn.id, {
    imported: 3,
    telemetry: {
      received: 3, detail_ok: 0, card_only_fallback: 3,
      raw_phone_present: 0, valid_phone_kept: 0, phone_dropped_hygiene: 0,
      with_whatsapp: 0, with_landline: 0, with_website: 1, with_address: 3, with_bairro: 2, with_rating: 3,
    },
    lead_ids_lote: ['a1', 'a2', 'a3'],
  }, { captured_count: 3, total_to_capture: 10 }, { silent: true });
  assert.equal(getMission(mWarn.id).telemetry.anomaly_warning, null);

  recordMissionBatch(mWarn.id, {
    imported: 2,
    telemetry: {
      received: 2, detail_ok: 0, card_only_fallback: 2,
      raw_phone_present: 0, valid_phone_kept: 0, phone_dropped_hygiene: 0,
      with_whatsapp: 0, with_landline: 0, with_website: 1, with_address: 2, with_bairro: 1, with_rating: 2,
    },
    lead_ids_lote: ['a4', 'a5'],
  }, { captured_count: 5, total_to_capture: 10 }, { silent: true });

  const afterZeroTel = getMission(mWarn.id);
  assert.equal(afterZeroTel.telemetry.received, 5);
  assert.equal(afterZeroTel.telemetry.card_only_fallback, 5);
  assert.equal(afterZeroTel.telemetry.rates.phone_pct, 0);
  assert.equal(afterZeroTel.telemetry.rates.website_pct, 40);
  assert.match(afterZeroTel.telemetry.anomaly_warning, /0 telefones válidos capturados após 5\+ cards/);

  // Se o próximo lote traz painéis com telefone válido, anomaly_warning limpa
  recordMissionBatch(mWarn.id, {
    imported: 5,
    telemetry: {
      received: 5, detail_ok: 5, card_only_fallback: 0,
      raw_phone_present: 5, valid_phone_kept: 5, phone_dropped_hygiene: 0,
      with_whatsapp: 4, with_landline: 1, with_website: 4, with_address: 5, with_bairro: 4, with_rating: 5,
    },
    lead_ids_lote: ['b1', 'b2', 'b3', 'b4', 'b5'],
  }, { captured_count: 10, total_to_capture: 10 }, { silent: true });

  const recovered = getMission(mWarn.id);
  assert.equal(recovered.telemetry.received, 10);
  assert.equal(recovered.telemetry.valid_phone_kept, 5);
  assert.equal(recovered.telemetry.with_whatsapp, 4);
  assert.equal(recovered.telemetry.with_landline, 1);
  assert.equal(recovered.telemetry.rates.detail_pct, 50);
  assert.equal(recovered.telemetry.rates.phone_pct, 50);
  assert.equal(recovered.telemetry.rates.whatsapp_pct, 40);
  assert.equal(recovered.telemetry.rates.website_pct, 60);
  assert.equal(recovered.telemetry.anomaly_warning, null);

  // Caso 2: telefones brutos descartados na higienização
  const mDropped = createMission({ cidade: 'Ipatinga', uf: 'MG', segmento: 'CLINICA', silent: true });
  recordMissionBatch(mDropped.id, {
    imported: 5,
    telemetry: {
      received: 5, detail_ok: 5, card_only_fallback: 0,
      raw_phone_present: 5, valid_phone_kept: 0, phone_dropped_hygiene: 5,
      with_whatsapp: 0, with_landline: 0, with_website: 2, with_address: 5, with_bairro: 0, with_rating: 5,
    },
    lead_ids_lote: ['c1', 'c2', 'c3', 'c4', 'c5'],
  }, { captured_count: 5, total_to_capture: 5 }, { silent: true });
  assert.match(getMission(mDropped.id).telemetry.anomaly_warning, /descartados na higienização/);
});

test('extension/content.js ignora div[role="main"] do feed e extrai telefone/site do painel de detalhes correto', () => {
  let onMessageHandler = null;

  const feedMain = {
    querySelector(sel) {
      if (sel === 'div[role="feed"]') return { tag: 'feed' };
      if (sel === 'h1') return { textContent: 'Resultados' };
      return null;
    },
    querySelectorAll() { return []; },
  };

  const phoneBtn = {
    getAttribute(attr) {
      if (attr === 'data-item-id') return 'phone:tel:+5533999887766';
      if (attr === 'aria-label') return 'Telefone: (33) 99988-7766';
      return null;
    },
    textContent: '(33) 99988-7766',
  };
  const webLink = {
    getAttribute(attr) {
      if (attr === 'data-item-id') return 'authority';
      if (attr === 'href') return 'https://clinicaexemplo.com.br';
      return null;
    },
  };
  const addrBtn = {
    getAttribute(attr) {
      if (attr === 'aria-label') return 'Endereço: Rua Minas Gerais, 500 - Centro, Governador Valadares - MG';
      return null;
    },
    textContent: 'Rua Minas Gerais, 500 - Centro, Governador Valadares - MG',
  };

  const detailMain = {
    querySelector(sel) {
      if (sel === 'div[role="feed"]') return null;
      if (sel === 'h1') return { textContent: 'Clínica Exemplo' };
      if (sel === 'button[data-item-id], a[data-item-id]') return phoneBtn;
      if (sel === 'button[data-item-id^="phone:tel:"]') return phoneBtn;
      if (sel === 'button[data-item-id="address"]') return addrBtn;
      if (sel === 'a[data-item-id="authority"]') return webLink;
      return null;
    },
    querySelectorAll() { return []; },
    innerText: 'Clínica Exemplo',
  };

  const sandbox = {
    URL,
    window: null,
    document: {
      querySelectorAll(sel) {
        if (sel === 'div[role="main"]') return [feedMain, detailMain];
        if (sel === 'a[href*="/maps/place/"]') return [];
        return [];
      },
      querySelector(sel) {
        if (sel === 'div[role="main"]') return feedMain;
        if (sel === '#searchboxinput') return { value: 'Clínica em Governador Valadares MG' };
        return null;
      },
    },
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => { onMessageHandler = fn; } },
        onConnect: { addListener: () => {} },
      },
    },
    addEventListener: () => {},
    location: {
      origin: 'https://www.google.com',
      href: 'https://www.google.com/maps/place/Clinica+Exemplo/@-18.85,-41.94,15z',
      hash: '',
      pathname: '/maps/place/Clinica+Exemplo',
      search: '',
    },
    history: { replaceState: () => {} },
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(root, 'extension', 'content.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'extension/content.js' });

  assert.equal(typeof onMessageHandler, 'function');
  let capturedResp = null;
  onMessageHandler({ type: 'CAPTURE_VISIBLE' }, null, (resp) => { capturedResp = resp; });
  assert.equal(capturedResp?.ok, true);
  assert.equal(capturedResp.leads.length, 1);
  assert.equal(capturedResp.leads[0].nome_fantasia, 'Clínica Exemplo');
  assert.equal(capturedResp.leads[0].telefone, '+5533999887766');
  assert.equal(capturedResp.leads[0].whatsapp, '+5533999887766');
  assert.equal(capturedResp.leads[0].website, 'https://clinicaexemplo.com.br/');
});
