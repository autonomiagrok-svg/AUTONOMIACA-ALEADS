# Xiquim Vargas Caça Leads

Aplicação local para cadastrar e organizar estabelecimentos comerciais a partir de fontes públicas. Não foi projetada para armazenar dados pessoais de consumidores nem para envio automático de mensagens.

## Executar

Requer Node.js 20 ou superior; não há dependências npm para instalar.

```powershell
cd caca-leads
npm start
```

Abra `http://127.0.0.1:3100`. Por padrão, o servidor escuta somente no próprio computador. `PORT` e `HOST` podem ser definidos no ambiente. Não exponha o serviço em uma rede pública sem implementar autenticação e controles adicionais.

O armazenamento usado pelo servidor e pela interface é `data/leads.json`, gravado atomicamente. O arquivo `data/leads.db` e `src/db.js` são legado do protótipo SQLite e não são a fonte de dados da aplicação atual. Os scripts de seed atualizados gravam no mesmo JSON que a interface lê.

## Funcionalidades

- Painel com totais por status, segmento, cidade e conversão.
- Busca nativa por nome, razão social, telefone/WhatsApp, CNPJ, e-mail, endereço, observações, fonte e tags; filtros por status, segmento, cidade, disponibilidade/validação de WhatsApp e fonte, com ordenação por score, nome, data, verificação ou retorno.
- Pipeline comercial por estágio.
- Cadastro, edição, exclusão e ficha de cada estabelecimento.
- Registro de interações, contato confirmado, conversão em cliente e fila de follow-ups atrasados, de hoje e dos próximos sete dias.
- Mensagens sugeridas e editáveis por etapa (primeiro contato, sem resposta, follow-up, catálogo, pós-visita, proposta, pós-venda e reativação). O WhatsApp abre com um rascunho; o funil só avança depois da confirmação manual do operador.
- Importação CSV com prévia, identificação de registros potencialmente duplicados e seleção explícita; exportação CSV inclui contatos, origem, validação e follow-up.
- Scripts opcionais `npm run seed` (lead de demonstração) e `node src/seed_map_gv.js` (base mapeada); ambos são idempotentes por nome e bairro.

## Rotas principais

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/health`, `/api/meta` | Estado e metadados |
| GET | `/api/stats`, `/api/pipeline` | Indicadores |
| GET | `/api/leads?q=&status=&segmento=&cidade=&whatsapp=&verificacao=&fonte=&sort=` | Busca, filtros e ordenação |
| GET | `/api/followups?period=atrasado%7Choje%7Csemana` | Fila de retornos |
| GET/POST/PUT/DELETE | `/api/leads/:id` | Consulta e manutenção |
| POST | `/api/leads/:id/interacoes` | Registrar interação |
| POST | `/api/leads/:id/contato` | Registrar contato e avançar funil |
| POST | `/api/leads/:id/followup` | Agendar próximo contato |
| POST | `/api/leads/:id/converter` | Converter para cliente |
| POST | `/api/import` | Importar até 5.000 registros |
| POST | `/api/import/preview` | Prévia e conferência de duplicatas |
| GET | `/api/export.csv` | Exportar leads |

Status aceitos: `NOVO`, `QUALIFICADO`, `CONTATADO`, `VISITA`, `PROPOSTA`, `CLIENTE` e `DESCARTADO`.

## Notas de operação

- A base enviada contém 1.000 registros. Confirme a fonte e a atualidade de cada registro antes de contatar o estabelecimento.
- Cadastro, importação e exportação não verificam a veracidade dos dados nem enriquecem cadastros automaticamente.
- Abrir ligação, e-mail ou rascunho do WhatsApp registra apenas que o canal foi iniciado; confirme o envio/contato na interface para avançar o funil.
- O servidor não possui login; por isso, permanece vinculado a `127.0.0.1` por padrão.
