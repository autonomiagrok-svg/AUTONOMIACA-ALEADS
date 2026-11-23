import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { Router, applyCors, applySecurityHeaders, parseJsonBody, sendJson } from './src/http/router.js';
import { registerSystemRoutes } from './src/routes/system.routes.js';
import { registerLeadsRoutes } from './src/routes/leads.routes.js';
import { registerMapsRoutes } from './src/routes/maps.routes.js';
import { registerIntelligenceRoutes } from './src/routes/intelligence.routes.js';

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const publicDir = path.resolve(process.cwd(), 'public');
const sharedFiles = {
  '/shared/hygiene.js': path.resolve(process.cwd(), 'src', 'hygiene.js'),
  '/shared/domain_signals.js': path.resolve(process.cwd(), 'src', 'domain_signals.js'),
  '/shared/scoring_modes.js': path.resolve(process.cwd(), 'src', 'scoring_modes.js'),
  '/shared/copy_engine.js': path.resolve(process.cwd(), 'src', 'copy_engine.js'),
  '/shared/cadence_engine.js': path.resolve(process.cwd(), 'src', 'cadence_engine.js'),
  '/shared/relationship_analytics.js': path.resolve(process.cwd(), 'src', 'relationship_analytics.js'),
  '/shared/empirical_calibrator.js': path.resolve(process.cwd(), 'src', 'empirical_calibrator.js'),
  '/shared/territory_engine.js': path.resolve(process.cwd(), 'src', 'territory_engine.js'),
  '/shared/value_matrix.js': path.resolve(process.cwd(), 'src', 'value_matrix.js'),
};
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
};

function serveStatic(req, res, pathname) {
  if (pathname in sharedFiles) {
    const sharedPath = sharedFiles[pathname];
    if (!fs.existsSync(sharedPath)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    return req.method === 'HEAD' ? res.end() : fs.createReadStream(sharedPath).pipe(res);
  }
  let file;
  try { file = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const full = path.resolve(publicDir, `.${file}`);
  if (!(full === publicDir || full.startsWith(publicDir + path.sep)) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': MIME_TYPES[path.extname(full)] || 'application/octet-stream' });
  return req.method === 'HEAD' ? res.end() : fs.createReadStream(full).pipe(res);
}

export function createServer({ appAccessKey = String(process.env.APP_ACCESS_KEY || '').trim() } = {}) {
  const router = new Router();
  registerSystemRoutes(router, { appAccessKey });
  registerLeadsRoutes(router);
  registerMapsRoutes(router);
  registerIntelligenceRoutes(router);

  return http.createServer((req, res) => {
    applyCors(req, res);
    applySecurityHeaders(res);
    Promise.resolve((async () => {
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const p = url.pathname;
      if (appAccessKey && p.startsWith('/api/') && !(req.method === 'GET' && (p === '/api/health' || p === '/api/auth/status'))) {
        const providedKey = String(req.headers['x-access-key'] || url.searchParams.get('key') || '').trim();
        if (providedKey !== appAccessKey) {
          return sendJson(res, 401, { error: 'Chave de acesso inválida ou ausente', auth_required: true });
        }
      }
      const matched = router.match(req.method, p);
      if (matched) {
        return matched.handler({
          req,
          res,
          url,
          params: matched.params,
          readBody: () => parseJsonBody(req),
          send: (status, data, headers) => sendJson(res, status, data, headers),
        });
      }
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
      return sendJson(res, 404, { error: 'Rota não encontrada' });
    })()).catch((e) => {
      if (!e.status || e.status >= 500) console.error(e);
      if (!res.headersSent) sendJson(res, e.status || 500, { error: e.message || 'Erro interno' });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`AutonomIA Systems — Caça Leads ativo em http://${HOST}:${PORT}`);
    console.log('Operação: Sistemas Inteligentes, Agentes Digitais & Prospecção B2B');
  });
}
