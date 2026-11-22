# AutonomIA Systems — Caça Leads B2B

Plataforma de inteligência comercial, captação ativa no Google Maps, qualificação técnica automatizada e prospecção de alta cadência para a **AutonomIA Systems**.

---

## 1. Arquitetura Zero-Dependências

- **Runtime:** Node.js `>= 20` (100% ESM nativo: `node:http`, `fetch`, `node:test`, `node:assert/strict`) — **zero `npm install`**.
- **Frontend:** HTML5 + CSS3 + Vanilla JS modularizado, compartilhando regras puras com o backend via `/shared/...`.
- **Extensão de Captura:** Chrome / Edge **Manifest V3** (`extension/`) com HUD flutuante, rolagem exaustiva até o fim do feed e streaming em tempo real.
- **Armazenamento de Escala:** Snapshot JSON (`data/leads.json`) + **Write-Ahead Log NDJSON** (`data/leads.wal.ndjson` via `WalJsonAdapter`) + **Índices Secundários O(1) em RAM** (`LeadIndex` para deduplicação instantânea por URL, CNPJ, telefone, domínio e nome+cidade).

---

## 2. Os 5 Pilares Operacionais

1. **ENCONTRAR (`⚡ Motor de Busca` + `extension/`):**
   - **Fonte Única Ativa — Google Maps:** Selecione **1 segmento por vez** (ou digite um **Termo Livre**) e inicie a missão. A extensão abre o Maps, executa a **Fase 1 (Rolagem Obrigatória até o Final da Lista)** e a **Fase 2 (Captura Profunda de 100% dos cards)** enviando lotes de 5 leads em streaming com telefone, site, endereço, bairro, nota e total de avaliações.
   - **Entradas Auxiliares:** Importação de CSV com prévia/deduplicação e Cadastro Manual.
2. **CLASSIFICAR (`src/classifier.js` + `src/scoring_modes.js` + `src/value_matrix.js`):**
   - **Raio-X Digital de 2ª Geração (< 512 KB):** Detecta HTTPS, botão de WhatsApp no site, Meta Pixel, Google Tag/GTM, stack (`SHOPIFY`, `NUVEMSHOP`, `WOOCOMMERCE`, `WORDPRESS`, `WIX`, `RD_STATION`, `LINK_BIO`), viewport mobile, SEO básico, schema `LocalBusiness` e `ttfb_ms`.
   - **Enriquecimento CNPJ (BrasilAPI):** Razão social, situação cadastral, capital social, data de abertura (`Empresa Recente <= 18m`) e quadro societário (`socios`).
   - **4 Modos Nativos + Lentes Customizáveis (`data/lenses.json`) + Auto-Calibragem Bayesiana (`alpha = 5`)** com pontuação explicável (`breakdown`).
   - **Matriz Dinheiro (Caixa) × Brecha (Dor):** Classifica cada lead em **💎 OURO**, **📈 EXPANSÃO**, **⚡ ENTRADA** ou **👀 OBSERVAÇÃO**.
3. **TERRITÓRIO (`src/territory_engine.js`):**
   - **Bolsões de Oceano Azul:** Agrupa `Cidade + Bairro + Segmento` destacando regiões com alta oportunidade digital e baixa penetração comercial.
   - **Motor Lookalike ("Clones do Melhor Cliente"):** Similaridade determinística (0–100%) com Índice de Jaccard de dores para abordar vizinhos semelhantes com **Prova Social Hiper-Local**.
4. **CONTACTAR (`📞 Power Dialer` + `src/copy_engine.js`):**
   - Fila focada 1-a-1 com atalhos de teclado (`Enter` Abrir WhatsApp, `V` Girar Variação, `S` Pular, `I` Inválido).
   - **Motor de Copy Dinâmica em 3 Blocos:** Abertura com prova real (sócio/nota/prova social local) + gancho cirúrgico da dor principal + CTA de baixa fricção, com **4 variações anti-repetição**.
5. **MANTER (`📅 Agenda do Dia` + `src/cadence_engine.js` + `src/relationship_analytics.js`):**
   - Termômetro de temperatura (`QUENTE`, `MORNO`, `ESFRIANDO`, `CONGELADO`), SLAs por estágio, **Valor em Risco (`priority_score`)**, máquina de estados por número de toque (incluindo recomendação de troca de canal no 3º toque e *break-up* elegante/hibernação +45d no 4º+) e **Radar de Conversão**.

---

## 3. Comandos Rápidos

```bash
# Iniciar o servidor local em http://127.0.0.1:3100
npm start

# Executar a suíte completa de testes unitários nativos
npm test
```

---

## 4. Instalação da Extensão Chrome / Edge

1. Abra `chrome://extensions` (ou `edge://extensions`) e ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione a pasta `extension/` na raiz deste repositório.
3. No painel (`http://127.0.0.1:3100`), acesse **⚡ Motor de Busca**, escolha 1 segmento e clique em **⚡ Iniciar Caça Completa no Google Maps**.

---

## 5. Segurança, Faxina Segura e Backups

- Os arquivos `data/leads.json`, `data/*.wal.ndjson`, `data/lenses.json` e `data/backups/` são protegidos no `.gitignore`.
- Em **🧠 Inteligência → ⚙️ Saúde do Motor & Escala**, você pode:
  - Compactar o WAL manualmente (**🗜️ Compactar WAL**).
  - Baixar um snapshot completo (**💾 Baixar Backup JSON** / `GET /api/system/backup`).
  - Executar **🧹 Auditar & Limpar Base** (**Faxina Cirúrgica** ou **Reset Total**), que sempre grava um backup automático com timestamp em `data/backups/` antes de qualquer remoção.
