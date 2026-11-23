# Empacotamento Mobile WebView / APK — AutonomIA Caça Leads

Este guia descreve como empacotar o vertical (`public/` + API HTTP) em um aplicativo Android WebView ou Capacitor APK aproveitando as **Portas USB-C v1.0** e o núcleo **Offline-First (`IndexedDB` + `sync_queue`)**.

---

## 1. Arquitetura de Montagem (`window.CacaLeadsVertical.mount`)

O frontend expõe a fachada canônica `window.CacaLeadsVertical` (`contract_version: '1.0'`), permitindo inicializar o vertical dentro de um WebView Android ou Shell Capacitor passando adaptadores nativos sem forks no código-fonte:

```js
window.CacaLeadsVertical.mount(document.getElementById('appRoot'), {
  shell_enabled: true,       // false caso o app host forneça navegação própria
  ui_mode: 'simplificado',   // ativa as 4 abas essenciais: motor, leads, dialer, agenda
}, {
  runtimeAdapter: {
    openExternal(url) {
      // Ponte opcional via Android JavascriptInterface ou Capacitor Browser/AppLauncher
      if (window.AndroidBridge?.openIntent) {
        window.AndroidBridge.openIntent(url);
        return true;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    },
  },
  outputActions: {
    openWhatsApp(phone, text) {
      const url = window.Hygiene?.buildWhatsAppLink(phone, text);
      if (!url) return { ok: false, url: null };
      if (window.AndroidBridge?.openWhatsAppIntent) {
        window.AndroidBridge.openWhatsAppIntent(url);
        return { ok: true, url };
      }
      window.RuntimeAdapter.openExternal(url);
      return { ok: true, url };
    },
    callPhone(phone) {
      const digits = String(phone || '').replace(/\D/g, '');
      if (!digits) return { ok: false, url: null };
      const url = `tel:${digits}`;
      if (window.AndroidBridge?.dialIntent) {
        window.AndroidBridge.dialIntent(url);
        return { ok: true, url };
      }
      window.RuntimeAdapter.openExternal(url);
      return { ok: true, url };
    },
  },
});
```

---

## 2. Bridges Nativos Recomendados (Android WebView / Capacitor)

### 2.1 Capacitor (`capacitor.config.json`)
- Aponte `webDir` para `public` (ou carregue a URL HTTPS do serviço Render Starter).
- Caso use `webDir: "public"` com API remota: configure o endpoint base da API ou um proxy reverso local e inclua o domínio do servidor em `connect-src` da CSP caso necessário.
- Plugins nativos úteis:
  - `@capacitor/app` / `@capacitor/browser` para links externos;
  - `@capacitor/clipboard` sobrescrevendo `runtimeAdapter.copyToClipboard`;
  - `@capacitor/filesystem` + `@capacitor/share` sobrescrevendo `outputActions.exportCsv` e `outputActions.exportBackup`.

### 2.2 Android WebView (`shouldOverrideUrlLoading`)
No cliente `WebViewClient` em Kotlin/Java, intercepte os esquemas `tel:`, `mailto:`, `whatsapp:` e URLs `https://wa.me/...` para disparar `Intent(Intent.ACTION_VIEW, uri)` ou `Intent(Intent.ACTION_DIAL, uri)` diretamente para os apps nativos do aparelho.

---

## 3. Garantias de UX Mobile e Offline-First no APK

1. **Alvos de toque de 44×44px (`--touch-target-min: 44px`):** definidos em `public/tokens.css` e aplicados automaticamente abaixo de `860px` em `public/styles.css` para botões, abas, selects, chips de sinal, filtros e badge da fila.
2. **Layouts adaptativos (`<= 768px`):**
   - A tabela de Leads converte-se em cards verticais (`table.leads-mobile-cards` com `data-label`).
   - O Pipeline Kanban exibe seletor por abas de estágio (`.kanban-mobile-tabs`) evitando rolagem horizontal forçada.
3. **Resiliência Offline em Campo (`IndexedDB` + `sync_queue`):**
   - **Leituras (a):** Leads, Lentes, Metadados, Config e Resumo da Agenda operam a partir do espelho `autonomia_caca_leads_v1` no IndexedDB.
   - **Mutações (b):** Contatos, follow-ups, interações, edições e conversões aplicam atualização otimista local e gravam na store `sync_queue` com `Idempotency-Key` (UUID v4) e backoff exponencial, disparando `SyncQueue.flush({ force: true })` no evento `online`.
   - **Exige Rede (c):** Raio-X HTTP, novas missões do Google Maps e Backup JSON completo exibem aviso não bloqueante enquanto o dispositivo estiver sem internet.
4. **Persistência em Produção:** Para dados duráveis atrás do app mobile, utilize `render.starter.yaml` com disco persistente montado em `/var/data` (`LEADS_FILE` e `LENSES_FILE`), reservando `render.free.yaml` / `render.yaml` apenas para demonstrações efêmeras (`STORAGE_EPHEMERAL="true"`).
