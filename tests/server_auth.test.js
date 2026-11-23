import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

async function startTestServer(extraEnv = {}) {
  const port = await getFreePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        return {
          baseUrl,
          stop: () => new Promise((resolve) => {
            child.once('exit', () => resolve());
            child.kill();
          }),
        };
      }
    } catch {
      // Aguarda servidor subir
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  child.kill();
  throw new Error('Timeout ao iniciar servidor de teste');
}

test('server.js permite acesso livre quando APP_ACCESS_KEY está vazia', async () => {
  const srv = await startTestServer({ APP_ACCESS_KEY: '' });
  try {
    const authRes = await fetch(`${srv.baseUrl}/api/auth/status`);
    assert.equal(authRes.status, 200);
    const authData = await authRes.json();
    assert.equal(authData.protected, false);

    const leadsRes = await fetch(`${srv.baseUrl}/api/leads`);
    assert.equal(leadsRes.status, 200);
  } finally {
    await srv.stop();
  }
});

test('server.js exige x-access-key quando APP_ACCESS_KEY está definida e libera CORS', async () => {
  const secret = 'chave-teste-autonomia-2026';
  const srv = await startTestServer({ APP_ACCESS_KEY: secret });
  try {
    const healthRes = await fetch(`${srv.baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);

    const authRes = await fetch(`${srv.baseUrl}/api/auth/status`);
    assert.equal(authRes.status, 200);
    const authData = await authRes.json();
    assert.equal(authData.protected, true);

    const deniedRes = await fetch(`${srv.baseUrl}/api/leads`);
    assert.equal(deniedRes.status, 401);
    const deniedData = await deniedRes.json();
    assert.equal(deniedData.auth_required, true);

    const wrongRes = await fetch(`${srv.baseUrl}/api/leads`, {
      headers: { 'x-access-key': 'chave-errada' },
    });
    assert.equal(wrongRes.status, 401);

    const allowedRes = await fetch(`${srv.baseUrl}/api/leads`, {
      headers: { 'x-access-key': secret },
    });
    assert.equal(allowedRes.status, 200);

    const corsRes = await fetch(`${srv.baseUrl}/api/leads`, {
      method: 'OPTIONS',
      headers: { Origin: 'chrome-extension://abcdefghijklmnop' },
    });
    assert.equal(corsRes.status, 204);
    const allowHeaders = corsRes.headers.get('access-control-allow-headers') || '';
    assert.ok(allowHeaders.toLowerCase().includes('x-access-key'));

    // BUG-04: /api/auth/verify exige chave quando ativa e confirma autenticidade
    const verifyDenied = await fetch(`${srv.baseUrl}/api/auth/verify`);
    assert.equal(verifyDenied.status, 401);

    const verifyWrong = await fetch(`${srv.baseUrl}/api/auth/verify`, {
      headers: { 'x-access-key': 'errada' },
    });
    assert.equal(verifyWrong.status, 401);

    const verifyOk = await fetch(`${srv.baseUrl}/api/auth/verify`, {
      headers: { 'x-access-key': secret },
    });
    assert.equal(verifyOk.status, 200);
    const verifyData = await verifyOk.json();
    assert.equal(verifyData.ok, true);
    assert.equal(verifyData.auth_valid, true);
    assert.equal(verifyData.protected, true);
  } finally {
    await srv.stop();
  }
});

test('POST /api/leads/:id/followup valida datas UTC e PUT /api/leads/:id faz merge antes de checar duplicata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-onda0-'));
  const srv = await startTestServer({
    APP_ACCESS_KEY: '',
    LEADS_FILE: path.join(dir, 'leads.json'),
    LENSES_FILE: path.join(dir, 'lenses.json'),
  });

  try {
    // Cria Lead A em Governador Valadares e Lead B homônimo em Belo Horizonte
    const resA = await fetch(`${srv.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome_fantasia: 'Clínica Central', cidade: 'Governador Valadares' }),
    });
    assert.equal(resA.status, 201);

    const resB = await fetch(`${srv.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome_fantasia: 'Clínica Central', cidade: 'Belo Horizonte', uf: 'MG' }),
    });
    assert.equal(resB.status, 201);
    const { item: leadB } = await resB.json();

    // BUG-11: Update parcial de Lead B enviando nome_fantasia sem cidade não pode gerar falso 409 com Lead A de GV
    const putB = await fetch(`${srv.baseUrl}/api/leads/${leadB.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome_fantasia: 'Clínica Central', status: 'QUALIFICADO' }),
    });
    assert.equal(putB.status, 200);
    const putBData = await putB.json();
    assert.equal(putBData.item.status, 'QUALIFICADO');
    assert.equal(putBData.item.cidade, 'Belo Horizonte');

    // BUG-06: Data ISO válida deve passar e data impossível (2026-02-30) deve retornar 400
    const badDateRes = await fetch(`${srv.baseUrl}/api/leads/${leadB.id}/followup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proximo_contato: '2026-02-30' }),
    });
    assert.equal(badDateRes.status, 400);

    const goodDateRes = await fetch(`${srv.baseUrl}/api/leads/${leadB.id}/followup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proximo_contato: '2026-11-23', nota: 'Teste UTC' }),
    });
    assert.equal(goodDateRes.status, 200);
    const goodData = await goodDateRes.json();
    assert.equal(goodData.item.proximo_contato, '2026-11-23');
  } finally {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
