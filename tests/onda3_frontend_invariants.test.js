import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();

function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function listFrontendJsFiles() {
  const jsDir = path.join(root, 'public', 'js');
  const portsDir = path.join(jsDir, 'ports');
  const files = [path.join(root, 'public', 'app.js')];
  for (const name of fs.readdirSync(jsDir)) {
    const full = path.join(jsDir, name);
    if (fs.statSync(full).isFile() && name.endsWith('.js')) files.push(full);
  }
  if (fs.existsSync(portsDir)) {
    for (const name of fs.readdirSync(portsDir)) {
      const full = path.join(portsDir, name);
      if (fs.statSync(full).isFile() && name.endsWith('.js')) files.push(full);
    }
  }
  return files;
}

test('Onda 3: arquivos obrigatórios existem e tokens.css define --touch-target-min: 44px e tokens dark semânticos', () => {
  const required = [
    'public/tokens.css',
    'public/js/runtime_adapter.js',
    'public/js/ports/config.js',
    'public/js/ports/input_adapter.js',
    'public/js/ports/output_actions.js',
  ];
  for (const rel of required) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, `Arquivo ausente: ${rel}`);
  }

  const tokensCss = fs.readFileSync(path.join(root, 'public', 'tokens.css'), 'utf8');
  assert.match(tokensCss, /--touch-target-min:\s*44px;/);
  const semanticTokens = [
    '--surface-bg:',
    '--surface-panel:',
    '--surface-card:',
    '--border-subtle:',
    '--border-strong:',
    '--text-primary:',
    '--text-muted:',
    '--accent-primary:',
    '--accent-strong:',
    '--status-success:',
    '--status-warn:',
    '--status-danger:',
  ];
  for (const tok of semanticTokens) {
    assert.ok(tokensCss.includes(tok), `Token semântico ausente em tokens.css: ${tok}`);
  }
});

test('Onda 3 Invariante 3: zero window.prompt/confirm nativos e zero handlers HTML inline em public/', () => {
  const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.equal(/\bon(?:click|change|input)\s*=/i.test(indexHtml), false, 'index.html ainda contém handler inline');

  for (const file of listFrontendJsFiles()) {
    const raw = fs.readFileSync(file, 'utf8');
    const clean = stripJsComments(raw);
    const rel = path.relative(root, file);

    assert.equal(
      /(?:window\.)?(?:prompt|confirm)\s*\(/.test(clean),
      false,
      `${rel} ainda contém chamada nativa de prompt() ou confirm()`
    );
    assert.equal(
      /\bon(?:click|change|input)\s*=/i.test(clean),
      false,
      `${rel} ainda contém handler HTML inline (onclick=/onchange=/oninput=)`
    );
  }
});

test('Onda 3 Porta 3 (Config) e Porta 2 (OutputActions) respeitam Contrato v1.0, ui_mode e shell_enabled', async () => {
  const store = new Map();
  const sandbox = {
    URL,
    structuredClone,
    crypto: { randomUUID: () => 'uuid-test-1234' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    fetch: async (url) => {
      if (url === '/api/config') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            contract_version: '1.0',
            shell_enabled: true,
            ui_mode: 'avancado',
            storage_mode: 'ephemeral',
            tenant: { id: 'lab-1', brand_name: 'Lab Teste', default_city: 'Vitória', default_uf: 'ES' },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    open: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  for (const rel of [
    'public/js/runtime_adapter.js',
    'public/js/ports/config.js',
    'public/js/ports/output_actions.js',
  ]) {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }

  const cfgApi = sandbox.AppPorts.config;
  const loaded = await cfgApi.init();
  assert.equal(loaded.contract_version, '1.0');
  assert.equal(loaded.shell_enabled, true);
  assert.equal(loaded.storage_mode, 'ephemeral');
  assert.equal(loaded.tenant.brand_name, 'Lab Teste');
  assert.equal(cfgApi.getVisibleViews().length, 10);

  // Modo Simplificado deve expor exatamente as 4 abas essenciais
  const mode = cfgApi.setUiMode('simplificado');
  assert.equal(mode, 'simplificado');
  assert.deepEqual(Array.from(cfgApi.getVisibleViews()), ['motor', 'leads', 'dialer', 'agenda']);
  assert.equal(store.get('autonomia_ui_mode'), 'simplificado');

  // Shell disabled
  assert.equal(cfgApi.setShellEnabled(false), false);
  assert.equal(cfgApi.get().shell_enabled, false);

  // Override injetável em OutputActions
  let customCalled = null;
  sandbox.AppPorts.outputActions.configure({
    openWhatsApp: (phone, text) => {
      customCalled = { phone, text };
      return { ok: true, url: 'custom://wa' };
    },
  });
  const outRes = sandbox.AppPorts.outputActions.openWhatsApp('33999991111', 'Oi');
  assert.equal(outRes.ok, true);
  assert.equal(outRes.url, 'custom://wa');
  assert.equal(customCalled?.phone, '33999991111');
  assert.equal(customCalled?.text, 'Oi');
});
