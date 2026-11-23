import { listLeads } from '../store.js';
import { listLenses, getLens, createLens, updateLens, deleteLens } from '../lenses_store.js';
import { buildCalibratedLensProposal } from '../empirical_calibrator.js';
import { computeTerritoryClusters } from '../territory_engine.js';
import { summarizeMatrix } from '../value_matrix.js';
import { computeRelationshipInsights } from '../relationship_analytics.js';

export function registerIntelligenceRoutes(router) {
  router.add('GET', '/api/lenses', ({ send }) => send(200, { items: listLenses() }));

  router.add('POST', '/api/lenses', async ({ readBody, send }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(400, { error: 'Envie os dados da lente em um objeto JSON' });
    const item = createLens(b);
    return send(201, { item });
  });

  router.add('PUT', '/api/lenses/:id', async ({ params, readBody, send }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) return send(400, { error: 'Envie os dados da lente em um objeto JSON' });
    const item = updateLens(params.id, b);
    if (!item) return send(404, { error: 'Lente não encontrada' });
    return send(200, { item });
  });

  router.add('DELETE', '/api/lenses/:id', ({ params, send }) => {
    const ok = deleteLens(params.id);
    return ok ? send(200, { ok: true }) : send(404, { error: 'Lente não encontrada' });
  });

  router.add('GET', '/api/intelligence/calibration', ({ url, send }) => {
    const baseParam = url.searchParams.get('base') || 'equilibrado';
    const baseLens = getLens(baseParam) || baseParam;
    return send(200, buildCalibratedLensProposal(listLeads(), baseLens));
  });

  router.add('GET', '/api/intelligence/territory', ({ url, send }) => {
    const modeParam = url.searchParams.get('mode') || 'equilibrado';
    const minLeads = Math.max(1, Number(url.searchParams.get('min_leads') || 2) || 2);
    const modeOrLens = getLens(modeParam) || modeParam;
    return send(200, computeTerritoryClusters(listLeads(), { modeOrLens, minLeads }));
  });

  router.add('GET', '/api/intelligence/matrix', ({ send }) => send(200, summarizeMatrix(listLeads())));

  router.add('GET', '/api/agenda/summary', ({ url, send }) => {
    const modeParam = url.searchParams.get('mode') || 'equilibrado';
    const modeOrLens = getLens(modeParam) || modeParam;
    const insights = computeRelationshipInsights(listLeads(), { modeId: modeOrLens });
    return send(200, {
      urgentes_hoje: insights.urgentes_hoje,
      buckets: insights.buckets,
      temperaturas: insights.temperaturas,
      gargalo_principal: insights.gargalo_principal,
      total_leads: insights.total_leads,
    });
  });
}
