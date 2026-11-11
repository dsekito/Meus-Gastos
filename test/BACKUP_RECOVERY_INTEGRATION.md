# Recuperação aditiva: contrato de integração

## API

Carregar `js/backup-recovery.js` depois de `document-validator.js` e `local-store.js`, antes de `app.js`. Incluir o novo módulo no cache versionado da PWA (integração pelo responsável da UI).

```js
const recovery = MGBackupRecovery.create({
  store: MGLocalStore,
  getUserId: () => state.user?.id,
});
const userId = state.user.id;
// Primeiro aguardar gravações/sync em andamento e persistir alterações locais.
// Bloquear edição/envios automáticos enquanto a recuperação estiver aberta.
const input = await file.text(); // ou await repository.fetchDriveBackup(id), somente leitura
const preview = await recovery.preview(userId, input);
// Mostrar added, duplicateIds, conflictIds, deletedIds, detached,
// ignoredRecurrenceSeries e aviso explícito LOCAL APENAS, SEM SINCRONIZAÇÃO.
// Em cancelar:
recovery.discard(preview.previewId);
// Em confirmação EXPLÍCITA (não executar em cancelar):
const result = await recovery.commit(userId, preview.previewId, { confirmed: true });
// SOMENTE agora aplicar result.data ao estado ou chamar loadLocal(userId),
// reconstruir deletedEntryIds a partir da fila e renderizar.
// NÃO chamar o antigo save() de restauração, queueDelete(), queueUpsert()
// sobre todo o backup, nem substituir settings/recurrenceSeries.
```

`preview(userId, input)` aceita texto JSON de backup schema 1 ou array legado de lançamentos; também aceita objeto de backup já baixado e validado. Não escreve. Retorna token opaco vinculado ao usuário e estatísticas. Uma nova prévia invalida a anterior. A prévia pública e o arquivo não são usados como autoridade de escrita após a confirmação: o plano interno contém cópias independentes.

`commit(userId, previewId, {confirmed:true})` faz compare-and-swap de todo o snapshot local numa ÚNICA transação readwrite do IndexedDB. Só resolve após oncomplete. Retorna `{data, added, duplicateIds, conflictIds, deletedIds, detached, ignoredSettings, ignoredRecurrenceSeries, localOnly, remoteSyncSupported}`. Aborto/quota não altera o snapshot persistido. Pode-se tentar novamente o mesmo plano após erro de persistência; após conflito deve gerar nova prévia. O token é consumido no sucesso. Troca de usuário impede aplicar o resultado na nova sessão.

## Política conservadora obrigatória

- Nunca há restauração destrutiva. IDs existentes/conflitantes e IDs com exclusão pendente/tombstone local são preservados, não sobrescritos nem ressuscitados.
- Configurações, saldo, categorias, recorrências existentes e flags dirty são preservados. As definições de recorrência do backup NÃO são importadas. Ocorrências recuperadas tornam-se avulsas (`series_id:null`, `detached_from_series:true`) e mantêm `recovery_source_series_id` como proveniência. A prévia contabiliza esses desligamentos. Não há referência pendente a uma série inexistente nem reativação de geração automática.
- Novas entradas carregam `import_local_only:true` e operações locais `localOnly:true`, com base remota nula. Não remover estes marcadores.
- O escritor atual do Drive faz GET de versão e PATCH incondicional: há uma janela TOCTOU, NÃO é CAS remoto. Não foi introduzida alegação de suporte a precondições da API. Por isso, sync-service E repository rejeitam lotes com recuperação local antes de qualquer requisição: `SAFE_IMPORT_REMOTE_DISABLED`. O lote INTEIRO fica bloqueado, inclusive outras alterações e settings nele incluídos. A UI deve explicar isso e não repetir automaticamente nem alegar que os dados foram enviados. Para recuperação sincronizada será necessário protocolo remoto condicional comprovado ou log imutável implementado separadamente.
- Importação local não exige token Google. Ler backup no Drive continua exigindo autorização. Nenhum teste novo faz escrita no Drive real.

## Erros e armazenamento

- `IMPORT_INVALID`: arquivo/schema/IDs/datas/valores/flags/coleções inválidos. Não altera estado.
- `IMPORT_CONFIRMATION_REQUIRED`: confirmação explícita ausente.
- `IMPORT_PREVIEW_EXPIRED`: prévia consumida, descartada, substituída ou de outro usuário.
- `IMPORT_USER_CHANGED`: usuário atual mudou; não aplicar resultado na UI.
- `LOCAL_STORE_CONFLICT`: outra aba/rotina alterou o snapshot. Não repetir save com estado velho. Recarregar, preservar o formulário não salvo separadamente e gerar nova prévia.
- `INDEXED_DB_TRANSACTION_ABORTED` ou erro de armazenamento: não aplicar a recuperação em memória; informar falha, manter dados anteriores.

`MGLocalStore.save()` também passou a comparar atomicamente o último snapshot observado nesta aba com o persistido, para impedir que uma aba antiga apague a recuperação depois. A primeira gravação em chave já existente exige `load()` anterior. Somente chamar `load(userId)` quando o snapshot for aplicado ao estado que será salvo; leituras de diagnóstico/prévia devem usar `load(userId,{observe:false})`. O módulo de recuperação já usa leitura não observadora.

## Evidências RED/GREEN executadas

Ciclos incrementais com falha observada antes da produção:

1. Parser estrito ausente → parser GREEN; rejeição de números coercíveis, duplicatas, datas impossíveis, schema desconhecido e chaves perigosas.
2. CAS IndexedDB ausente → CAS GREEN em Edge headless real.
3. Save comum de aba antiga retornava UNSAFE_SUCCESS → save condicional GREEN.
4. Módulo de recuperação ausente → prévia/commit aditivos GREEN.
5. Guardas ausentes permitiam upload e chamada de rede → guardas em sync e repository GREEN, zero chamadas.
6. Falha de persistência apagava fila após upload → restauração da fila GREEN (lote e caminho legado).
7. Flags/coleções inválidas aceitas → validação estrita GREEN.
8. Tombstones/IDs de fila fora da view eram ressuscitados → exclusão/reserva de IDs GREEN.
9. Prévia anterior ainda podia ser confirmada → invalidação/descarte GREEN.
10. Troca de usuário durante commit retornava snapshot anterior à UI → verificação pós-commit GREEN.
11. Aborto real do IndexedDB rejeitava com null → erro explícito GREEN, readback idêntico ao anterior e retry confirmado.
12. Editor que recria objeto removia bloqueio local → marcador sticky da fila GREEN.
13. Leitura da prévia autorizava save de uma UI antiga → leitura não observadora GREEN.

Comandos principais:

```
node --test test/backup-recovery.test.js test/recovery-sync-guard.test.js
node test/recovery-indexeddb.e2e.cjs
node test/local-store.test.js
node test/document-validator.test.js
node test/sync-service.test.js
node test/google-drive-repository.test.js
node test/sync-resilience.test.js
```

E2E cria servidor localhost em porta efêmera e perfil isolado do Edge; testa duas abas, conflito, aborto após put, readback e retry sem dados reais. Não equivale a teste do Drive real ou concorrência de dois dispositivos reais. A suíte global inclui testes da UI em desenvolvimento por outro agente; não alterar expectativas de UI a partir deste módulo.
