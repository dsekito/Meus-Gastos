# Meus Gastos

Aplicativo financeiro local-first. Os dados ficam no IndexedDB do dispositivo e,
se a pessoa quiser, são sincronizados com a pasta privada `appDataFolder` do
Google Drive dela. Também é possível usar o app sem conta (modo local).

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

## Organização do código

Cada arquivo em `js/` expõe um único objeto `window.MG*`. Regras financeiras puras
ficam em `domain.js`; a interface monta o restante a partir de módulos por assunto:

- `profile-defaults.js`: categorias e configurações iniciais de um perfil.
- `entry-form-rules.js`: validação, resumo da recorrência e prévia das parcelas do formulário.
- `projection-view.js` e `monthly-view.js`: marcação da Projeção e do consolidado Mensal.
- `sync-status-view.js`: o que o status e o aviso de sincronização dizem em cada situação.
- `records-manager.js`: o diálogo “Gerenciar registros” e a edição em lote.
- `credit-cards.js`: cadastro de cartões e a data sugerida pela forma de pagamento.
- `entry-filters.js`: quais lançamentos passam nos filtros dos registros, as opções de forma de pagamento e os totais exibidos.
- `app.js`: estado da sessão, navegação, formulário e a ligação entre os módulos.

## Estrutura de dados

- IndexedDB `meus-gastos`: cache local e fila de alterações pendentes por usuário.
  Cada registro leva `schemaVersion` (hoje 1); registros antigos, sem o campo,
  têm o mesmo formato e são lidos como versão 1. Se o registro foi salvo por uma
  versão mais nova do app (por exemplo, uma cópia offline antiga aberta depois de
  uma atualização), o app não o exibe, não sincroniza nem grava por cima: mostra
  apenas o aviso para **Atualizar interface**. Ao mudar o formato, incremente
  `LOCAL_SCHEMA_VERSION` em `js/local-store.js` e acrescente a migração em `upgrade()`.
- Google Drive `appDataFolder/meus-gastos.json`: documento privado, consolidado e
  versionado com lançamentos, recorrências e configurações.

Alterações locais são persistidas imediatamente e agrupadas por um pequeno intervalo
antes do envio. Cada lote gera uma única revisão do documento no Drive. A fila usa
identificadores de mutação para preservar edições feitas enquanto outro envio está em
andamento. O aplicativo interrompe a gravação quando identifica que o mesmo registro
mudou em outro dispositivo.

Cada envio consolida lançamentos, configurações e recorrências em uma única gravação
quando houver alterações nessas coleções. As operações remotas são serializadas,
e novas edições durante o upload permanecem pendentes para o próximo lote. Após
uma resposta perdida, um resultado remoto idêntico é reconhecido sem reenviar o
mesmo conteúdo. Conflitos com conteúdo diferente continuam exigindo resolução.

O limite de tempo cobre a leitura completa da resposta, inclusive o corpo do
arquivo. Cancelar interrompe requisições e a espera entre tentativas. Erros
transitórios podem disparar até três novas tentativas de ciclo, com pausas de
5, 10 e 20 segundos, enquanto houver conexão e autorização válida. Erros de
autorização, conflitos e documentos inválidos não entram nesse ciclo automático.
Retornar à aba não repete consultas concluídas há menos de 30 segundos quando não
há alterações locais. O arquivo consolidado ainda é transferido inteiro quando
há mudanças; esta revisão não transforma o Drive em um banco com sincronização
incremental de registros.

Se dois aparelhos criarem o documento principal ao mesmo tempo no primeiro uso,
todos passam a usar o arquivo mais antigo (`orderBy=createdTime`). A quantidade de
duplicatas aparece em `getDocumentStats().duplicateDocumentCount`.

Antes de substituir a cópia local, o documento remoto é validado quanto ao schema,
IDs duplicados, datas, coleções e configurações. O resumo de sincronização registra a
última tentativa, o último sucesso e o tamanho do documento.

### Recuperação de backups: limite desta versão

A importação JSON e a recuperação de backups do Drive são **aditivas e locais**.
Antes da confirmação, o aplicativo apresenta uma prévia. Lançamentos existentes,
IDs conflitantes, exclusões pendentes, saldo, configurações e recorrências atuais
são preservados. Ocorrências recuperadas ficam avulsas; o backup não reativa séries.
O commit local usa uma única transação IndexedDB com comparação do snapshot.
Uma prévia obsoleta é rejeitada, sem sobrescrever mudanças de outra aba.

**Ao confirmar uma recuperação com novos lançamentos, todo envio ao Drive fica
pausado por segurança, inclusive alterações futuras.** O aplicativo mostra um aviso
persistente. Os dados recuperados ficam somente neste aparelho; guarde uma cópia
local e não limpe o armazenamento do navegador. Recuperar um backup do Drive apenas
lê esse arquivo: não substitui o documento remoto nem cria uma restauração destrutiva.

O escritor remoto existente consulta uma versão e depois envia um PATCH sem
precondição atômica. Isso não impede toda corrida entre dispositivos. A recuperação
sincronizada permanece indisponível até existir um protocolo remoto comprovadamente
seguro. A sincronização normal de perfis sem recuperação mantém seu fluxo anterior.
O teste com a conta Google real não foi executado nesta entrega; os testes de
integração usam perfis isolados, IndexedDB real e serviços Google simulados.

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

## Modo local (sem conta Google)

Na primeira tela, **Usar só neste aparelho** abre o app sem entrar com o Google.
O aparelho recebe um perfil local com id estável `local:<uuid>`, guardado no
`localStorage` (chave `meus-gastos-local-profile`) junto com a data de criação;
nenhum token, e-mail ou dado pessoal é gravado. Os dados financeiros ficam no
IndexedDB sob esse id, como em qualquer perfil.

No modo local nada é enviado para a internet: o status mostra **Modo local** e o
cabeçalho oferece **Conectar Google**. As alterações continuam registradas na fila
local para que possam ser enviadas depois. Limpar os dados do navegador apaga os
lançamentos de um perfil local; crie um backup ou conecte o Google para ter uma cópia.

### Conectar o Google depois

Ao conectar, o app autoriza a conta, salva o estado atual e lê o Google Drive
antes de mover qualquer coisa (se o Drive não puder ser lido, nada é movido):

- **Sem dados na conta** (Drive vazio e nenhuma cópia da conta neste aparelho): os
  dados do perfil local passam para o id da conta e são enviados ao Drive.
- **A conta já tem dados**: o app mostra quantos lançamentos há em cada lado e pede
  uma escolha explícita: **Manter os deste aparelho** (o Drive passa a ter
  exatamente os dados do aparelho; lançamentos que só existiam no Drive são
  removidos), **Manter os do Google Drive** (os lançamentos do perfil local são
  descartados) ou **Cancelar** (nada muda e o app continua no modo local). Fechar
  o diálogo equivale a cancelar.

A gravação usa uma única transação do IndexedDB (`MGLocalStore.transfer`) que
confere os dois registros (compare-and-swap), grava a conta e apaga o perfil local
juntos: ou tudo é confirmado, ou nada muda. Se os dados mudaram durante a conexão
(por exemplo, em outra aba) ou a gravação falhar, a sessão Google é descartada e a
pessoa continua no modo local com os mesmos dados. Se o app for fechado no meio da
conexão, o perfil local tem prioridade na próxima abertura.

A lógica fica em `js/local-profile.js` (`window.MGLocalProfile`).

## Cartões de crédito

Em **Ajustes > Tipos, descrições e cartões**, cadastre cada cartão com o dia do
fechamento e o dia do vencimento da fatura. Nas despesas, o campo **Forma de
pagamento** oferece os cartões cadastrados, e o cartão escolhido fica gravado no
lançamento.

Num **novo** lançamento, escolher o cartão também troca a data pelo vencimento
da fatura em que uma compra feita hoje cai. A data continua editável. Um novo
lançamento de despesa já abre com a **última forma de pagamento usada** num
lançamento novo neste aparelho e, se for um cartão, com a data do vencimento. Só
o id do cartão (ou vazio, para Pix, débito ou dinheiro) fica no `localStorage`,
na chave `meus-gastos-last-payment-method:<id do perfil>`; não é sincronizado. Ao
**editar** um lançamento, a forma de pagamento pode ser trocada, mas a data não
muda: ela já é a data do pagamento, e a data da compra não é conhecida.

- Compras feitas **a partir do dia do fechamento** vão para a fatura seguinte.
- Se o vencimento é no mesmo dia ou antes do fechamento, a fatura vence no mês
  seguinte ao fechamento.
- Dias que não existem no mês (por exemplo, 31 em fevereiro) usam o último dia.
- Em compras parceladas, a 1ª parcela fica no vencimento sugerido e as demais
  nos meses seguintes.

Em **Registros > Filtrar**, a lista pode ser filtrada por movimentação
(despesas ou receitas) e por forma de pagamento: "Pix, débito ou dinheiro"
(despesas sem cartão), "Qualquer cartão de crédito", um cartão ou "Cartão
excluído". Cada registro pago com cartão mostra o nome dele. O resumo do botão
mostra só os filtros ativos e quantos são, e abaixo dos filtros ficam as
entradas, as saídas e o saldo do que está na lista, com sinal.

Recorrências e parcelamentos guardam o cartão na série ou no plano, e todas as
ocorrências e parcelas o recebem; editar "Em toda a série" ou o parcelamento
troca o cartão em todas. Excluir um cartão não altera os lançamentos feitos com
ele: ao editá-los, a opção aparece como **Cartão excluído** e continua gravada.

Os cartões ficam em `settings.credit_cards` (`id`, `name`, `closing_day`,
`due_day`); lançamentos e séries pagos com cartão têm `credit_card_id`. Os dois
campos são opcionais, ficam ausentes quando não há cartão, são validados ao ler
o Drive, backups e importações, e vão junto na sincronização e nos backups. As
regras ficam em `MGDomain.creditCardDueDate` e `MGDomain.withCreditCard`, e a
interface em `js/credit-cards.js`.

Versões anteriores do app ignoram esses campos e os descartam ao gravar: um
aparelho ainda não atualizado pode apagar a lista de cartões ao salvar a
projeção e tirar o cartão de um lançamento que editar. Atualize a interface em
todos os aparelhos ao começar a usar cartões.

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

## Interface e segurança das alterações

A tela inicial usa um painel compacto de saldo e projeções, com período selecionado
separado dos próximos sete dias. **Saldo projetado hoje** inclui lançamentos pendentes:
não é uma afirmação de saldo bancário realizado. Datas de referência e projeção são
exibidas.

O saldo informado é o saldo da conta na **data-base**: já inclui o que foi pago nessa
data, mas não o que ainda está em aberto. Por isso, lançamentos da data-base marcados
como pagos não alteram a projeção, e os que estão em aberto são descontados (ou somados,
no caso de entradas a receber). Ao mudar o status de um lançamento da data-base, o app
pergunta se deve atualizar o saldo informado pelo valor do lançamento. Aceitando, a
projeção continua igual e o saldo acompanha o banco; recusando, o saldo não muda. O
ajuste pode ser desfeito pelo aviso que aparece em seguida.

Confirmações (exclusões, alterações em lote, recuperação de backup e ajuste de saldo)
usam um diálogo do próprio app, acessível por teclado e leitor de tela, em vez da
janela nativa do navegador. Nas ações destrutivas, o foco inicial fica em
**Cancelar**. Bordas de campos e botões têm contraste mínimo de 3:1.

A lista de **Registros** abre com todos os status. O filtro de status continua
disponível, e o atalho das próximas movimentações mostra apenas os em aberto.

O botão de novo lançamento fica no fluxo da página, sem cobrir cartões. A navegação
mantém cinco destinos. O modo local sem alterações para enviar não exibe um aviso
bloqueante; a autorização continua acessível no cabeçalho. Alertas críticos abrem os
detalhes automaticamente e ações de cancelar/resolver continuam visíveis.

Criação, edição, exclusões, ajustes de saldo e operações em lote protegem a memória
e a fila contra falhas da persistência local. Em conflito entre abas, a aplicação
recarrega o snapshot completo e exige uma nova ação, sem reaplicar o estado antigo.
Falhar e repetir uma criação não deve duplicar o lançamento. Ocorrências recorrentes
personalizadas e exclusões reservam seus slots, inclusive ao encurtar ou dividir séries.
Na criação de compras parceladas, as parcelas começam em aberto; cada pagamento
pode ser registrado posteriormente. A limitação de recuperação local descrita acima
continua válida, inclusive ao converter um registro recuperado em parcelas.

## Estilos

Todo o CSS fica em `mobile.css`; o `index.html` não tem estilos embutidos. O início
do arquivo reúne as regras-base que antes ficavam no `index.html`, reduzidas às
declarações que de fato alteram algum estilo calculado. Estilos novos vão depois
delas, para manter a ordem da cascata.

## Testes

A interface tem cinco destinos: Início, Registros, Projeção, Mensal e Ajustes, com
navegação pelo histórico do navegador. O mês escolhido é compartilhado entre as
áreas; **Voltar ao mês atual** só aparece quando outro mês está selecionado. O
Início mostra apenas o resumo e as próximas movimentações; Projeção e Mensal ficam
na barra de navegação. No formulário, repetição e detalhes ficam em uma seção opcional. Em compras
parceladas, informe o **valor total da compra**: a prévia mostra a divisão e o
ajuste dos centavos na última parcela, conforme a regra financeira existente.

Na área **Mensal** (`#mensal`), escolha o ano e a situação dos lançamentos para
consultar entradas, saídas, saldo de cada mês e acumulado desde janeiro, além dos
totais anuais. O saldo é **entradas menos saídas**, sem incluir o saldo inicial da
conta. O filtro permite realizados, em aberto ou ambos. Parcelas e recorrências
são somadas por ocorrência registrada, na respectiva data; não há estimativa de
ocorrências ainda não geradas. Despesas negativas reduzem o total de saídas.
**Ver lançamentos** abre os registros daquele mês com a mesma situação selecionada.

Na aba Projeção, o resumo mostra o **saldo no início** (fim do dia anterior ao
mês), as **entradas** e **saídas** do mês inteiro, com o que ainda está a receber
e a pagar, e o **saldo no fim**. O gráfico **Evolução do saldo** desenha o saldo
ao fim de cada dia, com a linha de hoje, o menor saldo marcado e o trecho abaixo
de zero em vermelho; ao tocar ou passar o ponteiro sobre ele, o saldo do dia é
exibido. Em **Dia a dia**, cada data com lançamentos traz o saldo ao fim do dia
(com o aviso “negativo” quando for o caso) e os lançamentos daquela data; tocar em
um lançamento abre a edição. No mês atual, os dias anteriores a hoje ficam
recolhidos em **Dias anteriores**.

“A receber” identifica uma entrada ainda não recebida. Essa distinção aparece no
resumo de sete dias, na projeção, no histórico, no gerenciador e no consolidado.
A classificação exata `A RECEBER` no tipo ou status de um registro antigo também
é reconhecida como entrada na leitura, mesmo quando a movimentação foi gravada
com o padrão de despesa. Os dados antigos não são regravados automaticamente.
Quando uma
nova interface fica disponível, o app oferece atualização preservando os dados
locais e pede para concluir formulários abertos antes de recarregar. A nova versão
só é ativada quando a pessoa toca em **Atualizar interface**; **Verificar
atualização** apenas procura uma versão nova e nunca recarrega a página. Em conexão
lenta, a abertura usa a cópia offline após 3 segundos.

O consolidado mensal, o parcelamento, as agregações diárias, as projeções e os
subtotais da interface somam em centavos inteiros e convertem para reais apenas no
resultado.
Execute `node test/monthly-cash-flow.test.js` para os casos financeiros e
`node test/monthly-cash-flow.e2e.cjs` com o servidor local na porta 8000 para
validar filtros, navegação e layout do consolidado em cinco tamanhos de tela.

Para validar a interface em um perfil fictício e isolado, mantenha o servidor
local na porta 8000 e execute `node test/mobile-navigation.e2e.cjs`. O teste usa
Playwright com Edge, sem acessar serviços externos, e salva capturas e medidas em
`outputs/mobile-improvements/`. Ele verifica navegação, projeção, ajustes,
parcelamento, persistência local e acesso aos controles em telas pequenas e em
paisagem. A integração real com o Google Drive depende de uma conta autorizada.

```powershell
npm run check      # verificação de sintaxe de js/*.js e sw.js
npm test           # todos os testes unitários (test/*.test.js)
npm start          # servidor local na porta 8000 (em outro terminal)
npm run test:e2e   # todos os testes E2E (exigem Playwright e Microsoft Edge)
```

O `package.json` não declara dependências: o Playwright precisa estar disponível
no ambiente (`npm i -D playwright`, se ainda não estiver instalado).

As regras de desenvolvimento do projeto estão em `agents.md`.

`test/local-profile.test.js` cobre a migração do modo local (sem dados remotos,
conflito, falha de gravação e compare-and-swap) sobre o `MGLocalStore` real com um
IndexedDB em memória. `node test/local-profile.e2e.cjs` exercita a tela de entrada,
o modo local e as três escolhas de conflito com Google simulado; a variável
`MG_BASE_URL` permite usar outro servidor local além de `http://localhost:8000`.

`node test/sync-pipeline.e2e.cjs` exercita o app e o repositório reais com serviços
Google simulados, incluindo edição de configuração durante o upload. Nenhum
dado de usuário é enviado ao Google nesses testes. O envio combinado é validado
como uma única gravação por lote; um segundo upload só é necessário quando há
uma edição adicional durante o primeiro.

Os testes descrevem comportamento, não a escrita do código. `node test/app-behavior.e2e.cjs`
cobre filtros, edição, desfazer, salvar e adicionar outro, parcelas, recorrências,
alertas de saldo, onboarding e categorias padrão; `node test/sync-notice.e2e.cjs` cobre
o que o status e o aviso de sincronização dizem em cada situação, com o Google Drive
simulado. Os testes unitários que leem arquivos verificam apenas a marcação do
`index.html`, as versões do cache e textos proibidos no código, como `confirm(`.
