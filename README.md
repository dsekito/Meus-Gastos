# Meus Gastos

Aplicativo financeiro local-first. Os dados ficam no IndexedDB do dispositivo e
são sincronizados com a pasta privada `appDataFolder` do Google Drive do usuário.

## Configuração do Google

1. Crie ou selecione um projeto no [Google Cloud Console](https://console.cloud.google.com/).
2. Ative a **Google Drive API**.
3. Configure a tela de consentimento OAuth e adicione os escopos `openid`,
   `email`, `profile` e `https://www.googleapis.com/auth/drive.appdata`.
4. Crie um ID do cliente OAuth 2.0 do tipo **Aplicativo da Web**.
5. Adicione às origens JavaScript autorizadas:
   - `http://localhost:8000` para desenvolvimento;
   - `https://dsekito.github.io` para produção.
6. Substitua o valor de `googleClientId` em `js/config.js`.
7. Enquanto o app estiver em teste, inclua as contas permitidas como usuários de
   teste na tela de consentimento. Para publicação, envie o app OAuth para análise.

O escopo `drive.appdata` é não sensível e só permite acessar os arquivos privados
criados por este aplicativo.

## Desenvolvimento local

Sirva o diretório por HTTP; o login Google não funciona abrindo `index.html`
diretamente pelo protocolo `file:`.

```powershell
python -m http.server 8000
```

Depois, abra `http://localhost:8000`.

## Estrutura de dados

- IndexedDB `meus-gastos`: cache local e fila de alterações pendentes por usuário.
- Google Drive `appDataFolder/meus-gastos.json`: documento privado versionado com
  lançamentos, recorrências e configurações.

O aplicativo relê o documento remoto antes de atualizar um lançamento e interrompe
a gravação quando identifica que o mesmo registro mudou em outro dispositivo.
Alterações em massa são consolidadas em uma única revisão do arquivo. Um backup
manual completo também pode ser baixado pela tela de configurações.

## Migração dos dados atuais

Esta versão não consulta mais o Supabase. Antes de publicar a troca, exporte os
lançamentos, recorrências e configurações atuais. Não apague o projeto Supabase até
que esses dados sejam importados, o arquivo `meus-gastos.json` seja criado no Drive
e os totais sejam conferidos. A transferência exige acesso ao projeto antigo e deve
ser executada antes do corte da versão em produção.

## Testes

```powershell
node test/domain.test.js
node test/google-drive-repository.test.js
node --check js/app.js
node --check js/google-auth.js
node --check js/google-drive-repository.js
node --check js/local-store.js
```
