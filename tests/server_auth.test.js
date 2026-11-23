import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

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
  } finally {
    await srv.stop();
  }
});
