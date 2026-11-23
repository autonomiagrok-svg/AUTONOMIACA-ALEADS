import fs from 'node:fs';
import path from 'node:path';

let configFile = process.env.CONFIG_FILE
  ? path.resolve(process.env.CONFIG_FILE)
  : path.join(process.cwd(), 'data', 'config.json');

let cachedFileData = undefined;

const DEFAULT_OPERATORS = [
  { name: 'Rafael Oliveira', role: 'Especialista em Sistemas & Automação Inteligente', badge: 'Especialista em Sistemas' },
  { name: 'Sara Rosseto', role: 'Consultora de Inteligência Operacional & IA', badge: 'Consultora de IA & Processos' },
];

export function setConfigFile(filePath) {
  configFile = path.resolve(filePath);
  cachedFileData = undefined;
}

export function resetConfigCache() {
  cachedFileData = undefined;
}

function loadConfigFile() {
  if (cachedFileData !== undefined) return cachedFileData;
  try {
    if (!fs.existsSync(configFile)) {
      cachedFileData = {};
      return cachedFileData;
    }
    const raw = fs.readFileSync(configFile, 'utf8').trim();
    const parsed = raw ? JSON.parse(raw) : {};
    cachedFileData = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    cachedFileData = {};
  }
  return cachedFileData;
}

/**
 * Porta 3 USB-C (Contrato v1.0): Configuração White-Label e Feature Flags.
 */
export function getConfig() {
  const fileCfg = loadConfigFile();
  const fileTenant = fileCfg.tenant && typeof fileCfg.tenant === 'object' ? fileCfg.tenant : {};
  const fileFlags = fileCfg.feature_flags && typeof fileCfg.feature_flags === 'object' ? fileCfg.feature_flags : {};

  const defaultUf = String(process.env.DEFAULT_UF || fileTenant.default_uf || 'MG')
    .trim()
    .toUpperCase()
    .slice(0, 2) || 'MG';

  return {
    contract_version: '1.0',
    shell_enabled: process.env.SHELL_ENABLED !== undefined
      ? process.env.SHELL_ENABLED !== 'false'
      : (fileCfg.shell_enabled !== undefined ? Boolean(fileCfg.shell_enabled) : true),
    ui_mode: process.env.UI_MODE
      ? (process.env.UI_MODE === 'simplificado' ? 'simplificado' : 'avancado')
      : (fileCfg.ui_mode === 'simplificado' ? 'simplificado' : 'avancado'),
    storage_mode: process.env.STORAGE_EPHEMERAL === 'true'
      ? 'ephemeral'
      : (fileCfg.storage_mode === 'ephemeral' ? 'ephemeral' : 'persistent'),
    tenant: {
      id: process.env.TENANT_ID || fileTenant.id || 'default',
      brand_name: process.env.BRAND_NAME || fileTenant.brand_name || 'AutonomIA Systems',
      ramo: process.env.BRAND_RAMO || fileTenant.ramo || 'Sistemas Inteligentes, Agentes Digitais e Automação de Processos',
      slogan: process.env.BRAND_SLOGAN || fileTenant.slogan || 'Seu 1º Funcionário Digital',
      default_city: process.env.DEFAULT_CITY || fileTenant.default_city || 'Governador Valadares',
      default_uf: defaultUf,
      operators: Array.isArray(fileTenant.operators) && fileTenant.operators.length
        ? fileTenant.operators
        : DEFAULT_OPERATORS.map((op) => ({ ...op })),
    },
    feature_flags: {
      maps_autopilot: true,
      xray_v2: true,
      empirical_calibration: true,
      territory_lookalike: true,
      offline_sync: false,
      ...fileFlags,
    },
  };
}
