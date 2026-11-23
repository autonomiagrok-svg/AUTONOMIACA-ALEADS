import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';
import { setStoreFile, createLead, registerFollowUpOutcome, flushWrites } from '../src/store.js';
import { toIsoDateLocal } from '../src/domain_signals.js';
import { setLensesFile } from '../src/lenses_store.js';
import { setConfigFile, resetConfigCache } from '../src/config.js';
import { EventHooks, eventHooks, EVENT_NAMES } from '../src/ports/event_hooks.js';

async function withIsolatedHttpServer(fn, { appAccessKey = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda2-api-'));
  setStoreFile(path.join(dir, 'leads.json'));
  setLensesFile(path.join(dir, 'lenses.json'));
  setConfigFile(path.join(dir, 'config.json'));
  eventHooks.clear();

  const server = createServer({ appAccessKey });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    await fn({ baseUrl, dir });
  } finally {
    await flushWrites().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    eventHooks.clear();
    resetConfigCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('GET /api/config e /api/meta seguem Contrato v1.0 sem hardcodes legados', async () => {
  await withIsolatedHttpServer(async ({ baseUrl, dir }) => {
    const cfgRes = await fetch(`${baseUrl}/api/config`);
    assert.equal(cfgRes.status, 200);
    const cfg = await cfgRes.json();
    assert.equal(cfg.contract_version, '1.0');
    assert.equal(typeof cfg.shell_enabled, 'boolean');
    assert.ok(['simplificado', 'avancado'].includes(cfg.ui_mode));
    assert.equal(cfg.tenant.brand_name, 'AutonomIA Systems');
    assert.equal(JSON.stringify(cfg).includes('05.652.750/0001-61'), false);

    const metaRes = await fetch(`${baseUrl}/api/meta`);
    assert.equal(metaRes.status, 200);
    const metaRaw = await metaRes.text();
    assert.equal(metaRaw.includes('05.652.750/0001-61'), false);
    assert.equal(metaRaw.includes('Rua Afonso Pena'), false);

    // Override branco via data/config.json isolado
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ tenant: { id: 'tenant-sp', brand_name: 'Partner Tech', default_city: 'Campinas', default_uf: 'SP' } }),
      'utf8'
    );
    resetConfigCache();
    const cfg2 = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(cfg2.tenant.id, 'tenant-sp');
    assert.equal(cfg2.tenant.brand_name, 'Partner Tech');
    assert.equal(cfg2.tenant.default_city, 'Campinas');
    assert.equal(cfg2.tenant.default_uf, 'SP');
  });
});

test('GET /api/leads?view=summary omite objetos pesados e preserva métricas essenciais', async () => {
  await withIsolatedHttpServer(async ({ baseUrl }) => {
    const heavyLead = createLead({
      nome_fantasia: 'Clínica Pesada',
      segmento: 'CLINICA',
      whatsapp: '(33) 99999-1111',
      website: 'https://clinicapesada.com.br',
      etiquetas_dor: ['Site sem WhatsApp'],
      diagnostico_fatos: {
        website_audit: {
          online: true,
          https: true,
          ttfb_ms: 420,
          stack_detectada: ['WORDPRESS', 'ELEMENTOR'],
          raw_dump: 'X'.repeat(4000),
        },
        cnpj_info: {
          situacao_cadastral: 'ATIVA',
          capital_social: 150000,
          extra_blob: 'Y'.repeat(2000),
        },
      },
    });
    // Adiciona interações simuladas
    await fetch(`${baseUrl}/api/leads/${heavyLead.id}/interacoes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'WHATSAPP', resumo: 'Mensagem inicial enviada' }),
    });

    const fullRes = await fetch(`${baseUrl}/api/leads`);
    const fullText = await fullRes.text();
    const sumRes = await fetch(`${baseUrl}/api/leads?view=summary`);
    assert.equal(sumRes.status, 200);
    const sumText = await sumRes.text();
    const sumData = JSON.parse(sumText);

    assert.equal(sumData.items.length, 1);
    const item = sumData.items[0];
    assert.equal('diagnostico_fatos' in item, false);
    assert.equal('interacoes' in item, false);
    assert.equal(item.interacoes_count, 1);
    assert.ok(item.ultimo_toque_em);
    assert.deepEqual(item.stack_detectada, ['WORDPRESS', 'ELEMENTOR']);
    assert.equal(item.ttfb_ms, 420);
    assert.ok(sumText.length < fullText.length * 0.4, `Esperava redução drástica: summary=${sumText.length}, full=${fullText.length}`);
  });
});

test('GET /api/agenda/summary retorna contagens coerentes com leads atrasados e agendados', async () => {
  await withIsolatedHttpServer(async ({ baseUrl }) => {
    const atrasado = createLead({
      nome_fantasia: 'Lead Atrasado',
      status: 'CONTATADO',
      whatsapp: '(33) 99999-2222',
    });
    registerFollowUpOutcome(atrasado.id, { proximo_contato: '2020-01-10' });

    const hojeStr = toIsoDateLocal(new Date());
    const hoje = createLead({
      nome_fantasia: 'Lead Hoje',
      status: 'CONTATADO',
      whatsapp: '(33) 99999-2223',
    });
    registerFollowUpOutcome(hoje.id, { proximo_contato: hojeStr });

    createLead({
      nome_fantasia: 'Lead Novo Em Dia',
      status: 'NOVO',
      whatsapp: '(33) 99999-3333',
    });

    const res = await fetch(`${baseUrl}/api/agenda/summary?mode=equilibrado`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.total_leads, 3);
    assert.equal(data.buckets.ATRASADO, 1);
    assert.equal(data.buckets.HOJE, 1);
    assert.equal(data.urgentes_hoje, 2);
    assert.ok(data.temperaturas);
    assert.ok(typeof data.gargalo_principal === 'string');
  });
});

test('withIdempotency evita duplicidade em POST /interacoes e /contato com mesmo Idempotency-Key', async () => {
  await withIsolatedHttpServer(async ({ baseUrl }) => {
    const lead = createLead({
      nome_fantasia: 'Restaurante Idempotente',
      whatsapp: '(33) 99999-4444',
    });

    const ixHeaders = { 'content-type': 'application/json', 'Idempotency-Key': 'key-ix-001' };
    const ixPayload = JSON.stringify({ tipo: 'NOTA', resumo: 'Registro único' });

    const r1 = await fetch(`${baseUrl}/api/leads/${lead.id}/interacoes`, { method: 'POST', headers: ixHeaders, body: ixPayload });
    assert.equal(r1.status, 201);
    assert.equal(r1.headers.get('x-idempotent-replay'), null);
    const d1 = await r1.json();

    const r2 = await fetch(`${baseUrl}/api/leads/${lead.id}/interacoes`, { method: 'POST', headers: ixHeaders, body: ixPayload });
    assert.equal(r2.status, 201);
    assert.equal(r2.headers.get('x-idempotent-replay'), 'true');
    const d2 = await r2.json();
    assert.equal(d2.item.id, d1.item.id);

    const cHeaders = { 'content-type': 'application/json', 'Idempotency-Key': 'key-contato-001' };
    const cPayload = JSON.stringify({ canal: 'whatsapp', resumo: 'Contato único' });

    const c1 = await fetch(`${baseUrl}/api/leads/${lead.id}/contato`, { method: 'POST', headers: cHeaders, body: cPayload });
    assert.equal(c1.status, 200);
    assert.equal(c1.headers.get('x-idempotent-replay'), null);

    const c2 = await fetch(`${baseUrl}/api/leads/${lead.id}/contato`, { method: 'POST', headers: cHeaders, body: cPayload });
    assert.equal(c2.status, 200);
    assert.equal(c2.headers.get('x-idempotent-replay'), 'true');

    const fullLead = await (await fetch(`${baseUrl}/api/leads/${lead.id}`)).json();
    // Deve haver apenas 1 NOTA + 1 WHATSAPP = 2 interações (não 4!)
    assert.equal(fullLead.interacoes.length, 2);
  });
});

test('EventHooks entrega envelope canônico, isola falhas de listeners e dispara eventos nas rotas', async () => {
  const localBus = new EventHooks();
  const received = [];
  const unsub1 = localBus.subscribe('teste.evento', () => {
    throw new Error('Listener defeituoso simulado');
  });
  localBus.subscribe('teste.evento', (env) => {
    received.push(env);
  });

  const env = localBus.emit('teste.evento', { valor: 42 }, { idempotency_key: 'evt-1', tenant_id: 't1' });
  assert.equal(env.contract_version, '1.0');
  assert.equal(env.idempotency_key, 'evt-1');
  assert.equal(env.tenant_id, 't1');
  assert.ok(env.occurred_at);
  assert.deepEqual(env.data, { valor: 42 });
  assert.equal(received.length, 1);

  unsub1();

  // Verifica emissão real via HTTP nas rotas canônicas
  await withIsolatedHttpServer(async ({ baseUrl }) => {
    const events = [];
    eventHooks.subscribe(EVENT_NAMES.LEAD_CAPTURED, (e) => events.push(e));
    eventHooks.subscribe(EVENT_NAMES.LEAD_CONTACTED, (e) => events.push(e));
    eventHooks.subscribe(EVENT_NAMES.LEAD_CONVERTED, (e) => events.push(e));

    const createRes = await fetch(`${baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome_fantasia: 'Empresa Evento', whatsapp: '(33) 99999-5555' }),
    });
    const { item } = await createRes.json();

    await fetch(`${baseUrl}/api/leads/${item.id}/contato`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canal: 'whatsapp' }),
    });

    await fetch(`${baseUrl}/api/leads/${item.id}/converter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resumo: 'Fechado' }),
    });

    assert.deepEqual(
      events.map((e) => e.event),
      ['lead.captured', 'lead.contacted', 'lead.converted']
    );
    for (const e of events) {
      assert.equal(e.contract_version, '1.0');
      assert.ok(e.idempotency_key);
      assert.ok(e.occurred_at);
    }
  });
});
