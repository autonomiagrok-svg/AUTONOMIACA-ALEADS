import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createServer } from '../server.js';
import { setStoreFile, createLead, getLead, flushWrites } from '../src/store.js';
import { setLensesFile } from '../src/lenses_store.js';
import { setConfigFile, resetConfigCache, getConfig } from '../src/config.js';
import { eventHooks } from '../src/ports/event_hooks.js';
import * as RelationshipAnalytics from '../src/relationship_analytics.js';
import * as DomainSignals from '../src/domain_signals.js';

const root = process.cwd();

async function withIsolatedHttpServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda4-sync-'));
  setStoreFile(path.join(dir, 'leads.json'));
  setLensesFile(path.join(dir, 'lenses.json'));
  setConfigFile(path.join(dir, 'config.json'));
  eventHooks.clear();

  const server = createServer();
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

function createFrontendSandbox({ baseUrl = '', fetchImpl = null, initialOnline = true } = {}) {
  const lsMap = new Map();
  const listeners = new Map();
  const toasts = [];
  const nav = { onLine: initialOnline };

  const sandbox = {
    URL,
    URLSearchParams,
    structuredClone,
    crypto,
    navigator: nav,
    location: { origin: baseUrl || 'http://127.0.0.1:3100' },
    RelationshipAnalytics,
    DomainSignals,
    toast: (msg) => toasts.push(msg),
    localStorage: {
      getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
      setItem: (k, v) => lsMap.set(k, String(v)),
      removeItem: (k) => lsMap.delete(k),
    },
    addEventListener: (ev, cb) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(cb);
    },
    dispatchEvent(evName) {
      for (const cb of listeners.get(evName) || []) cb({ type: evName });
    },
    fetch: fetchImpl || ((reqPath, init) => {
      const target = /^https?:\/\//i.test(reqPath) ? reqPath : `${baseUrl}${reqPath}`;
      return globalThis.fetch(target, init);
    }),
    open: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  for (const rel of [
    'public/js/runtime_adapter.js',
    'public/js/storage/indexeddb_adapter.js',
    'public/js/storage/sync_queue.js',
    'public/js/ports/config.js',
  ]) {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }

  return { sandbox, nav, toasts };
}

test('Onda 4: manifestos Render, docs/MOBILE_WEBVIEW_READY.md, index.html e feature_flags.offline_sync === true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onda4-cfg-'));
  try {
    setConfigFile(path.join(dir, 'config.json'));
    resetConfigCache();
    const cfg = getConfig();
    assert.equal(cfg.feature_flags.offline_sync, true);
  } finally {
    resetConfigCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const starterPath = path.join(root, 'render.starter.yaml');
  const freePath = path.join(root, 'render.free.yaml');
  const defaultRenderPath = path.join(root, 'render.yaml');
  const mobileDocPath = path.join(root, 'docs', 'MOBILE_WEBVIEW_READY.md');

  for (const p of [starterPath, freePath, defaultRenderPath, mobileDocPath]) {
    assert.equal(fs.existsSync(p), true, `Arquivo obrigatório ausente: ${path.relative(root, p)}`);
  }

  const starter = fs.readFileSync(starterPath, 'utf8');
  assert.match(starter, /plan:\s*starter/);
  assert.match(starter, /mountPath:\s*\/var\/data/);
  assert.match(starter, /LEADS_FILE/);
  assert.match(starter, /\/var\/data\/leads\.json/);
  assert.match(starter, /LENSES_FILE/);
  assert.match(starter, /\/var\/data\/lenses\.json/);
  assert.match(starter, /STORAGE_EPHEMERAL/);

  const freeYaml = fs.readFileSync(freePath, 'utf8');
  assert.match(freeYaml, /plan:\s*free/);
  assert.match(freeYaml, /STORAGE_EPHEMERAL/);
  assert.match(freeYaml, /"true"|true/);

  const renderYaml = fs.readFileSync(defaultRenderPath, 'utf8');
  assert.match(renderYaml, /plan:\s*free/);
  assert.match(renderYaml, /STORAGE_EPHEMERAL/);

  const mobileDoc = fs.readFileSync(mobileDocPath, 'utf8');
  assert.match(mobileDoc, /CacaLeadsVertical\.mount/);
  assert.match(mobileDoc, /openWhatsApp/);
  assert.match(mobileDoc, /callPhone/);
  assert.match(mobileDoc, /IndexedDB/);
  assert.match(mobileDoc, /sync_queue/);

  const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(indexHtml, /\/js\/storage\/indexeddb_adapter\.js/);
  assert.match(indexHtml, /\/js\/storage\/sync_queue\.js/);
  assert.match(indexHtml, /id="syncQueueBadge"/);
});

test('Onda 4: offline enqueue -> flush contra servidor real, idempotência sem duplicação e backoff exponencial', async () => {
  await withIsolatedHttpServer(async ({ baseUrl }) => {
    const lead = createLead({
      nome_fantasia: 'Padaria Offline First',
      segmento: 'PADARIA',
      telefone: '(33) 3271-1010',
      whatsapp: '33999112233',
      cidade: 'Governador Valadares',
      uf: 'MG',
    });

    const { sandbox } = createFrontendSandbox({ baseUrl });
    const storage = sandbox.createIndexedDbAdapter({ memoryFallback: true });

    let networkFailMode = false;
    const queue = sandbox.createSyncQueue({
      storage,
      baseDelayMs: 1500,
      maxDelayMs: 60000,
      httpClient: async (reqPath, init) => {
        if (networkFailMode) {
          throw new TypeError('Failed to fetch');
        }
        return globalThis.fetch(`${baseUrl}${reqPath}`, init);
      },
    });

    const contatoItem = await queue.enqueue({
      method: 'POST',
      path: `/api/leads/${lead.id}/contato`,
      body: { canal: 'whatsapp', resumo: 'Contato enfileirado offline' },
    });
    const followupItem = await queue.enqueue({
      method: 'POST',
      path: `/api/leads/${lead.id}/followup`,
      body: {
        sinal: 'QUENTE',
        proximo_contato: '2099-05-10',
        proximo_contato_nota: 'Follow-up offline',
        registrar_toque: false,
      },
    });

    assert.equal(await storage.countSyncItems(), 2);

    // Simula queda de rede durante tentativa de flush -> backoff exponencial
    networkFailMode = true;
    const failedFlush = await queue.flush({ force: true });
    assert.equal(failedFlush.halted, true);
    assert.equal(failedFlush.synced, 0);
    assert.equal(await storage.countSyncItems(), 2);

    const pendingAfterFail = await storage.listSyncItems();
    assert.equal(pendingAfterFail[0].attempts, 1);
    assert.ok(pendingAfterFail[0].next_retry_at > Date.now());
    assert.equal(pendingAfterFail[1].attempts, 0);

    // Sem force=true respeita next_retry_at no primeiro item e não retransmite antes da hora
    networkFailMode = false;
    await queue.flush({ force: false });
    assert.equal(await storage.countSyncItems(), 1); // apenas o 2º item (next_retry_at=0) foi enviado

    // Agora com force=true envia o contato restante
    const recoveredFlush = await queue.flush({ force: true });
    assert.equal(recoveredFlush.synced, 1);
    assert.equal(await storage.countSyncItems(), 0);

    // Verifica persistência real no backend
    const persisted = getLead(lead.id);
    assert.equal(persisted.status, 'CONTATADO');
    assert.equal(persisted.ultimo_sinal, 'QUENTE');
    assert.equal(persisted.proximo_contato, '2099-05-10');
    const ixCountBeforeReplay = persisted.interacoes.length;
    assert.equal(ixCountBeforeReplay, 2);

    // Idempotência ponta a ponta: reenviar exatamente a mesma requisição com o mesmo idempotency_key
    const replayRes = await globalThis.fetch(`${baseUrl}${contatoItem.path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': contatoItem.idempotency_key,
      },
      body: JSON.stringify(contatoItem.body),
    });
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.headers.get('x-idempotent-replay'), 'true');
    assert.equal(getLead(lead.id).interacoes.length, ixCountBeforeReplay);
    assert.ok(followupItem.idempotency_key.length >= 32);
  });
});

test('Onda 4: Taxonomia (a, b, c) no RuntimeAdapter (espelhamento, fallback leitura/mutação e bloqueio internet-only)', async () => {
  await withIsolatedHttpServer(async ({ baseUrl }) => {
    const lead = createLead({
      nome_fantasia: 'Clínica Resiliente',
      segmento: 'CLINICA',
      whatsapp: '33988776655',
      cidade: 'Governador Valadares',
      uf: 'MG',
    });

    const { sandbox, nav, toasts } = createFrontendSandbox({ baseUrl, initialOnline: true });

    // Fase Online: leituras alimentam espelho OfflineStorage em background
    const listRes = await sandbox.RuntimeAdapter.http('/api/leads');
    assert.equal(listRes.items.length, 1);
    await sandbox.RuntimeAdapter.http('/api/meta');
    await sandbox.RuntimeAdapter.http('/api/config');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await sandbox.OfflineStorage.getAllLeads()).length, 1);

    // Fase Offline: navigator.onLine = false
    nav.onLine = false;

    // Categoria (a): Leituras offline nativas
    const summaryRes = await sandbox.RuntimeAdapter.http('/api/leads?view=summary&q=Resiliente');
    assert.equal(summaryRes.offline_cache, true);
    assert.equal(summaryRes.items.length, 1);
    assert.equal(summaryRes.items[0].nome_fantasia, 'Clínica Resiliente');

    const detailRes = await sandbox.RuntimeAdapter.http(`/api/leads/${lead.id}`);
    assert.equal(detailRes.offline_cache, true);
    assert.equal(detailRes.item.id, lead.id);

    const agendaRes = await sandbox.RuntimeAdapter.http('/api/agenda/summary?mode=equilibrado');
    assert.equal(agendaRes.offline_cache, true);
    assert.equal(agendaRes.total_leads, 1);

    // Categoria (b): Mutação otimista + enfileiramento SyncQueue
    const mutRes = await sandbox.RuntimeAdapter.http(`/api/leads/${lead.id}/contato`, {
      method: 'POST',
      body: JSON.stringify({ canal: 'whatsapp', resumo: 'Disparo offline dialer' }),
    });
    assert.equal(mutRes.queued_offline, true);
    assert.equal(mutRes.item.status, 'CONTATADO');
    assert.equal(await sandbox.OfflineStorage.countSyncItems(), 1);

    // Leitura subsequente já enxerga atualização otimista local
    const detailAfterMut = await sandbox.RuntimeAdapter.http(`/api/leads/${lead.id}`);
    assert.equal(detailAfterMut.item.status, 'CONTATADO');

    // Categoria (c): Operação internet-only exibe aviso claro e bloqueia sem travar
    await assert.rejects(
      sandbox.RuntimeAdapter.http(`/api/leads/${lead.id}/diagnose`, { method: 'POST', body: '{}' }),
      (err) => err.offlineBlocked === true && err.offlineNotified === true && /Sem internet/.test(err.message)
    );
    await assert.rejects(
      sandbox.RuntimeAdapter.http('/api/maps/mission', { method: 'POST', body: '{}' }),
      (err) => err.offlineBlocked === true
    );
    assert.ok(toasts.some((t) => /Raio-X e novas buscas no Maps/.test(t)));

    // Reconexão: evento 'online' ou flush sincroniza a mutação enfileirada
    nav.onLine = true;
    const syncRes = await sandbox.SyncQueue.flush({ force: true });
    assert.equal(syncRes.synced, 1);
    assert.equal(await sandbox.OfflineStorage.countSyncItems(), 0);
    assert.equal(getLead(lead.id).status, 'CONTATADO');
  });
});
