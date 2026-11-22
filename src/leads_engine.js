/**
 * Catálogo oficial de segmentos e termos de busca para a Captura Assistida no Google Maps.
 */
export const SEGMENTS_CATALOG = {
  RESTAURANTE: 'Restaurante',
  LANCHONETE: 'Lanchonete',
  PADARIA: 'Padaria',
  MERCADO: 'Supermercado',
  ADEGA: 'Adega',
  CLINICA: 'Clínica',
  ACADEMIA: 'Academia',
  OFICINA: 'Oficina Mecânica',
  SALAO: 'Salão de Beleza',
  PETSHOP: 'Pet Shop',
  FARMACIA: 'Farmácia',
  IMOBILIARIA: 'Imobiliária',
  ESCRITORIO: 'Escritório de Contabilidade',
  BAR: 'Bar',
  HOTEL: 'Hotel',
  LOJA: 'Loja',
};

export function getSegmentSearchLabel(segmento) {
  const key = String(segmento || 'RESTAURANTE').trim().toUpperCase();
  return SEGMENTS_CATALOG[key] || key;
}
