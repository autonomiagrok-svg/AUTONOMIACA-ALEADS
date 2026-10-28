# Como chegar a 1.000+ leads em Governador Valadares

## Situação atual (dados públicos verificados)

~200 estabelecimentos mapeados manualmente a partir de guias e listagens.

## Por que não “inventar” até 1.000

Nomes e endereços fictícios geram:

- visitas a estabelecimentos inexistentes;
- ligações para números errados;
- perda de confiança do time de vendas.

## Mercado real (referências públicas)

| CNAE / categoria | Ordem de grandeza em GV |
|------------------|-------------------------|
| Bares / pubs (listagens) | ~1.000+ (ex.: Restaurant Guru ~1046) |
| Bares e restaurantes (Acharei) | ~1.057 na categoria |
| Lanchonetes (CNAE 5611-2/03) | centenas a ~900+ ativas em algumas bases |
| Restaurantes (CNAE 5611-2/01) | ~600+ |
| Padarias | ~130–230 |
| Mercearias | dezenas a centenas |

**Somente esses CNAEs já passam de 1.000 empresas ativas** na cidade.

## Caminho oficial para 1.000+ leads reais

### 1) Exportar da Receita / agregadores de CNPJ

Filtros sugeridos (município IBGE **3127701** — Governador Valadares):

- `5611-2/01` Restaurantes  
- `5611-2/03` Lanchonetes  
- `5611-2/04` e `5611-2/05` Bares  
- `4721-1/02` Padaria/confeitaria  
- `4712-1/00` Minimercados/mercearias  
- `4723-7/00` Varejo de bebidas  
- `5510-8/*` Hotéis  
- `8230-0/*` / `9329-8/*` Eventos  

Ferramentas: **CNPJá**, **Econodata**, **Empresaqui**, dados abertos RFB (CNPJ).

### 2) Importar no Xiquim Leads

```bash
# POST /api/import
curl -X POST http://localhost:3100/api/import \
  -H 'content-type: application/json' \
  -d '{"items":[
    {"nome_fantasia":"Bar Exemplo","segmento":"BAR","bairro":"Centro","telefone":"(33) 3xxx-xxxx","fonte":"CNPJá","cnpj":"00.000.000/0001-00"}
  ]}'
```

Campos aceitos: `nome_fantasia`, `razao_social`, `cnpj`, `segmento`, `telefone`, `endereco`, `bairro`, `potencial`, `fonte`, `observacoes`.

Duplicatas por nome fantasia são ignoradas.

### 3) Qualificar no funil

1. Importar 1.000+ do CNAE  
2. Filtrar por bairro de rota da Xiquim Vargas  
3. Priorizar `potencial=ALTO` (Centro, alto giro, telefone)  
4. Registrar ligações/visitas  

## Meta operacional sugerida

| Fase | Meta |
|------|------|
| Agora | ~200 leads públicos curados |
| + export CNAE | 1.000–2.000 leads empresariais |
| + rotas ERP | carteira alinhada à logística |
