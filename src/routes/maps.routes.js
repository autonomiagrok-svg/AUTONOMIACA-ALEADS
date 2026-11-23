import { SEGMENTS_CATALOG } from '../domain_signals.js';
import { getLens } from '../lenses_store.js';
import { ingestAndEnrichMapsBatch } from '../autopilot_engine.js';
import {
  createMission,
  getMission,
  getActiveMission,
  updateMissionProgress,
  recordMissionBatch,
  completeMission,
  stopMission,
} from '../maps_mission.js';
import { getConfig } from '../config.js';
import { eventHooks, EVENT_NAMES } from '../ports/event_hooks.js';

export function registerMapsRoutes(router) {
  router.add('GET', '/api/maps/segments', ({ send }) => send(200, { items: SEGMENTS_CATALOG }));

  router.add('POST', '/api/maps/mission', async ({ readBody, send }) => {
    const b = await readBody();
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return send(400, { error: 'Envie os parâmetros da missão em um objeto JSON' });
    }
    const cfg = getConfig();
    const modeParam = b.mode || 'equilibrado';
    const modeOrLens = getLens(modeParam) || modeParam;
    const mission = createMission({
      cidade: b.cidade || cfg.tenant.default_city,
      uf: b.uf || cfg.tenant.default_uf,
      segmento: b.segmento || 'RESTAURANTE',
      customQuery: b.custom_query || b.customQuery || '',
      autoDiagnose: b.auto_diagnose !== false,
      modeOrLens,
    });
    return send(201, { ok: true, mission, start_url: mission.maps_url });
  });

  router.add('GET', '/api/maps/mission/active', ({ send }) => send(200, { ok: true, mission: getActiveMission() }));

  router.add('POST', '/api/maps/mission/:id/progress', async ({ params, readBody, send }) => {
    const b = await readBody();
    const mission = updateMissionProgress(params.id, b || {});
    if (!mission) return send(404, { error: 'Missão não encontrada' });
    return send(200, { ok: true, mission });
  });

  router.add('POST', '/api/maps/mission/:id/complete', async ({ params, readBody, send }) => {
    const b = await readBody();
    const mission = completeMission(params.id, b || {});
    if (!mission) return send(404, { error: 'Missão não encontrada' });
    eventHooks.emit(EVENT_NAMES.MISSION_COMPLETED, { mission_id: mission.id, mission });
    return send(200, { ok: true, mission });
  });

  router.add('POST', '/api/maps/mission/:id/stop', async ({ params, readBody, send }) => {
    const b = await readBody();
    const mission = stopMission(params.id, b?.reason || 'Parado pelo operador');
    if (!mission) return send(404, { error: 'Missão não encontrada' });
    return send(200, { ok: true, mission });
  });

  router.add('POST', '/api/ingest/maps', async ({ readBody, send, req }) => {
    const b = await readBody();
    const rawLeads = Array.isArray(b) ? b : (b.leads || b.items || []);
    if (!Array.isArray(rawLeads) || !rawLeads.length) {
      return send(400, { error: 'Envie { leads: [...] } com os estabelecimentos capturados' });
    }
    if (rawLeads.length > 5000) {
      return send(413, { error: 'Ingestão limitada a 5.000 registros por lote' });
    }

    const mission = !Array.isArray(b) && b.mission_id ? getMission(b.mission_id) : null;
    const autoDiagnose = Array.isArray(b)
      ? true
      : (b.auto_diagnose !== undefined ? b.auto_diagnose !== false : (mission ? mission.auto_diagnose : true));
    const modeOrLens = mission ? mission.mode_or_lens : (getLens(b.mode) || b.mode || 'equilibrado');

    const result = await ingestAndEnrichMapsBatch(rawLeads, {
      autoDiagnose,
      modeOrLens,
      loteOrigem: mission?.lote_origem || b.lote_origem || null,
      defaultSegment: mission?.segmento || b.segmento || null,
      diagnoseLimit: 25,
      concurrency: 3,
    });

    if (mission) {
      recordMissionBatch(mission.id, result, b.progress || {});
    }

    eventHooks.emit(
      EVENT_NAMES.LEAD_CAPTURED,
      {
        source: 'maps',
        mission_id: mission?.id || null,
        imported: result.imported,
        updated: result.updated,
        lead_ids_lote: result.lead_ids_lote,
      },
      { idempotency_key: req.headers['idempotency-key'] }
    );

    return send(201, {
      ...result,
      mission: mission ? getMission(mission.id) : null,
    });
  }, { idempotent: true });
}
