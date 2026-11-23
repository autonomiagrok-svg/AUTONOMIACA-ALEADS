import {
  listLeads, stats, metaLists, compactNow, getStorageHealth,
  LEAD_STATUSES, SEGMENTS, POTENTIALS, WHATSAPP_STATUSES,
} from '../store.js';
import { analyzeBaseHealth, executeCleanup } from '../cleanup_engine.js';
import { getConfig } from '../config.js';

export function registerSystemRoutes(router, { appAccessKey = '' } = {}) {
  router.add('GET', '/api/auth/status', ({ send }) => send(200, { protected: Boolean(appAccessKey) }));

  router.add('GET', '/api/auth/verify', ({ send }) => {
    return send(200, { ok: true, auth_valid: true, protected: Boolean(appAccessKey) });
  });

  router.add('GET', '/api/health', ({ send }) => {
    const cfg = getConfig();
    return send(200, {
      ok: true,
      service: 'autonomia-caca-leads',
      leads_count: stats().total,
      app: 'autonomia-systems-caca-leads',
      version: '2.0.0',
      storage: cfg.storage_mode === 'ephemeral' ? 'ephemeral' : 'json',
      empresa: cfg.tenant.brand_name,
      ramo: cfg.tenant.ramo,
      territorio: `${cfg.tenant.default_city} / ${cfg.tenant.default_uf}`,
    });
  });

  router.add('GET', '/api/config', ({ send }) => send(200, getConfig()));

  router.add('GET', '/api/meta', ({ send }) => {
    const cfg = getConfig();
    return send(200, {
      segmentos: SEGMENTS,
      status: LEAD_STATUSES,
      potencial: POTENTIALS,
      whatsapp_status: WHATSAPP_STATUSES,
      ...metaLists(),
      empresa: {
        nome: cfg.tenant.brand_name,
        ramo: cfg.tenant.ramo,
        slogan: cfg.tenant.slogan,
        operadores: cfg.tenant.operators.map((op) => op.name),
      },
      territorio: {
        cidade_base: cfg.tenant.default_city,
        uf: cfg.tenant.default_uf,
        empresa_referencia: cfg.tenant.brand_name,
      },
    });
  });

  router.add('GET', '/api/system/health-deep', ({ send }) => {
    const mem = process.memoryUsage();
    const { storage_stats, index_stats } = getStorageHealth();
    return send(200, {
      ok: true,
      leads_count: stats().total,
      memory_rss_mb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
      memory_heap_mb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
      ram_budget_mb: 512,
      storage_stats,
      index_stats,
      uptime_sec: Math.round(process.uptime()),
    });
  });

  router.add('POST', '/api/system/compact', async ({ send }) => {
    const storage_stats = await compactNow();
    return send(200, { ok: true, storage_stats });
  });

  router.add('GET', '/api/system/backup', async ({ res }) => {
    await compactNow();
    const d = new Date();
    const dateTag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const payload = JSON.stringify(listLeads(), null, 2);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="autonomia-leads-backup-${dateTag}.json"`,
      'cache-control': 'no-store',
    });
    return res.end(payload);
  });

  router.add('GET', '/api/system/cleanup/preview', ({ send }) => send(200, analyzeBaseHealth(listLeads())));

  router.add('POST', '/api/system/cleanup/execute', async ({ readBody, send }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return send(400, { error: 'Envie { mode, confirm: true } em um objeto JSON' });
    }
    const result = await executeCleanup({ mode: b.mode, confirm: b.confirm === true });
    return send(200, result);
  });
}
