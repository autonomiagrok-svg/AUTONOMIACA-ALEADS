import { importRows } from './store.js';

const SEED_LEADS = [
  {
    nome_fantasia: 'Exemplo — Bar Centro (placeholder)',
    segmento: 'BAR',
    subsegmento: 'Boteco',
    endereco: 'Centro',
    bairro: 'Centro',
    cidade: 'Governador Valadares',
    fonte: 'Template inicial — substituir por dados públicos reais',
    status: 'NOVO',
    potencial: 'ALTO',
    observacoes: 'Lead de exemplo para validar o funil. Substitua por estabelecimentos encontrados em fontes públicas.',
    tags: ['exemplo', 'centro'],
  },
];

const result = importRows(SEED_LEADS);
console.log(`Leads de demonstração adicionados: ${result.added}; total visível no aplicativo: ${result.total}.`);
