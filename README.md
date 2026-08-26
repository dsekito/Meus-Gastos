# Meus Gastos

Aplicativo financeiro local-first. Os dados ficam no IndexedDB do dispositivo e
são sincronizados com a pasta privada `appDataFolder` do Google Drive do usuário.

O aplicativo pode ser instalado diretamente pelo navegador como PWA no Android,
iOS e desktop. Não é necessário gerar um APK para uso pessoal.

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
- Google Drive `appDataFolder/meus-gastos.json`: documento privado, consolidado e
  versionado com lançamentos, recorrências e configurações.

Alterações locais são persistidas imediatamente e agrupadas por um pequeno intervalo
antes do envio. Cada lote gera uma única revisão do documento no Drive. A fila usa
identificadores de mutação para preservar edições feitas enquanto outro envio está em
andamento. O aplicativo interrompe a gravação quando identifica que o mesmo registro
mudou em outro dispositivo.

Antes de substituir a cópia local, o documento remoto é validado quanto ao schema,
IDs duplicados, datas, coleções e configurações. O resumo de sincronização registra a
última tentativa, o último sucesso e o tamanho do documento. A restauração de um
backup cria primeiro uma cópia automática do estado atual no Google Drive.

Versões antigas criavam um arquivo de diferença por lançamento. Esses arquivos são
lidos uma vez durante a migração e suas versões são registradas no documento
consolidado, evitando baixá-los novamente em cada dispositivo.

## Sessão e autorização do Google Drive

O perfil e os dados permanecem disponíveis no dispositivo depois que o navegador ou
o aplicativo é fechado. O token de acesso ao Google Drive não é gravado no aparelho.
Isso é intencional: no modelo OAuth para aplicações web, o token é curto e uma nova
autorização deve partir de uma ação da pessoa. Quando o token expira, o aplicativo
continua funcionando localmente e mostra a ação **Autorizar Drive**. Nas autorizações
seguintes, o e-mail salvo é enviado como dica e a seleção de conta é omitida quando
o Google ainda reconhece a sessão e o consentimento anterior.

Para sincronização totalmente contínua, inclusive após reiniciar o aplicativo, é
necessário adicionar um backend OAuth que armazene o refresh token de forma segura.
Não grave access tokens ou refresh tokens no `localStorage` ou no IndexedDB.

## Instalação

Em produção HTTPS, abra o menu do navegador e escolha **Instalar app** ou
**Adicionar à tela de início**. O manifesto e o service worker mantêm a interface
disponível offline; os dados continuam sendo lidos do IndexedDB.

## Migração dos dados atuais

Esta versão não consulta mais o Supabase. Antes de publicar a troca, exporte os
lançamentos, recorrências e configurações atuais. Não apague o projeto Supabase até
que esses dados sejam importados, o arquivo `meus-gastos.json` seja criado no Drive
e os totais sejam conferidos. A transferência exige acesso ao projeto antigo e deve
ser executada antes do corte da versão em produção.

## Testes

```powershell
node test/domain.test.js
node test/document-validator.test.js
node test/sync-service.test.js
node test/google-drive-repository.test.js
node test/google-auth.test.js
node test/local-store.test.js
node --check js/app.js
node --check js/document-validator.js
node --check js/google-auth.js
node --check js/google-drive-repository.js
node --check js/local-store.js
```
