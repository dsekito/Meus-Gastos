# Regras do projeto Meus Gastos

Aplicativo de finanças pessoais **local-first**, distribuído como **PWA** (Android,
iOS e desktop), em **JavaScript puro**, com dados no **IndexedDB** e sincronização
opcional na pasta privada `appDataFolder` do Google Drive. Estas regras valem para
qualquer pessoa ou agente que altere o código.

Prioridade em caso de conflito: **integridade dos dados > segurança e privacidade >
acessibilidade > desempenho > estética.**

---

## 1. Integridade financeira

1. Valores monetários são somados e comparados em **centavos inteiros**
   (`Math.round(valor * 100)`). Nunca acumule `Number` de reais em laços de soma
   novos; converta para reais somente na exibição.
2. Datas de calendário são strings `YYYY-MM-DD`. Aritmética de datas usa UTC
   (`Date.UTC`) para não depender do fuso do aparelho. Horários de auditoria
   (`created_at`, `updated_at`) são ISO 8601 em UTC.
3. Parcelamentos distribuem o resto dos centavos de forma determinística (na última
   parcela) e a soma das parcelas deve ser igual ao total informado.
4. Regras de domínio (saldo, projeção, recorrência, parcelamento, consolidado) ficam
   em funções **puras** em `js/domain.js`, sem DOM, sem I/O, com testes unitários.
5. Toda mudança de cálculo financeiro precisa de teste com casos de borda: mês de
   28/29/30/31 dias, virada de ano, valores negativos (estornos), centavos ímpares
   e listas vazias.

## 2. Dados locais, sincronização e conflitos

1. **Nenhuma ação do usuário pode perder dados silenciosamente.** Em falha de
   persistência, reverta o estado em memória e informe a pessoa.
2. Gravações no IndexedDB que dependem do estado atual usam leitura e escrita na
   **mesma transação** (compare-and-swap). Nunca `load()` seguido de `save()`.
3. A fila de sincronização é idempotente: cada operação tem `mutationId`; reenviar
   não pode duplicar registros.
4. Conflito entre dispositivos ou abas **nunca** é resolvido sobrescrevendo dados
   sem confirmação. Mostre o conflito e ofereça uma escolha explícita.
5. Todo documento remoto ou importado é validado (schema, IDs únicos, datas,
   tipos) **antes** de substituir qualquer dado local. Entradas externas são uma
   fronteira de confiança.
6. Mudanças de formato de dados exigem incremento de `schemaVersion`, migração
   testada e compatibilidade de leitura com a versão anterior. Exceção: um campo
   novo e **opcional**, que versões anteriores leem sem erro, dispensa o
   incremento se for validado na entrada, ficar ausente quando vazio (perfis que
   não o usam mantêm o formato) e o `README.md` disser o que acontece quando uma
   versão anterior grava sem ele.
7. Requisições de rede têm timeout, cancelamento e novas tentativas com backoff
   apenas para operações idempotentes (GET/HEAD) ou erros comprovadamente
   transitórios.

## 3. Segurança e privacidade (LGPD)

1. Dados financeiros ficam no aparelho e no Drive da própria pessoa. Não adicione
   backend, analytics, rastreadores ou SDKs de terceiros sem decisão explícita.
2. Escopos OAuth mínimos (`drive.appdata`, `openid`, `email`, `profile`). Tokens de
   acesso ficam **somente em memória**; nunca em `localStorage`, IndexedDB ou logs.
3. Todo texto vindo do usuário, do Drive ou de importação passa por `esc()` antes de
   entrar em HTML. Prefira `textContent` quando não houver marcação.
4. Mantenha a Content-Security-Policy de `index.html`. Nova origem externa só entra
   com justificativa e atualização da CSP. Proibido `eval`, `new Function` e
   handlers inline (`onclick=`).
5. Não registre no console dados financeiros, e-mails ou tokens.
6. Exportações e backups deixam claro ao usuário onde o arquivo fica e o que contém.

## 4. Acessibilidade (WCAG 2.2 nível AA)

1. Áreas de toque de **no mínimo 48×48 px** (Material) e 44×44 pt (Apple HIG), com
   pelo menos 8 px entre alvos adjacentes.
2. Contraste mínimo de **4,5:1** para texto e **3:1** para ícones, bordas de campo e
   estados de foco.
3. Corpo de texto com **16 px** ou mais; layout funcional com zoom de 200% e fonte
   ampliada do sistema, sem rolagem horizontal.
4. HTML semântico primeiro (`button`, `label`, `dialog`, `details`); ARIA só quando
   não houver elemento nativo equivalente. Todo controle tem nome acessível.
5. Foco visível em todos os elementos interativos; ordem de foco lógica; diálogos
   prendem e devolvem o foco.
6. Informação nunca depende só de cor: receitas, despesas e status também têm sinal
   (+/−), texto ou ícone.
7. Respeite `prefers-reduced-motion` e `prefers-color-scheme` quando houver
   animações ou temas.
8. Mensagens de status assíncronas usam `aria-live`.

## 5. Experiência mobile

1. **Mobile-first**: projete para 320 px de largura e amplie. Valide em 320, 375,
   412 px, paisagem e desktop, sem rolagem horizontal em nenhuma delas; o teste
   E2E da tela alterada verifica isso na página inteira, não só no componente.
2. Margens laterais de no mínimo 16 px e respeito a `env(safe-area-inset-*)`.
3. Ações principais na zona do polegar; nada fixo pode cobrir conteúdo ou campos.
4. Campos usam o teclado certo: `inputmode="decimal"` para valores sempre
   positivos, `type="date"` / `type="month"` para datas, `autocomplete` adequado.
   Campos que aceitam negativos (saldo) não usam `inputmode="decimal"`: o teclado
   do iOS não tem o sinal de menos.
5. Todo elemento interativo tem estados de **pressionado, desabilitado e
   carregando**; ações assíncronas bloqueiam duplo envio.
6. Toda ação destrutiva pede confirmação ou oferece desfazer.
7. Mensagens de erro dizem o que aconteceu e o que fazer, em português claro, sem
   códigos internos.
8. Formatação com `Intl` em `pt-BR` (moeda BRL, datas, números).

## 6. PWA e desempenho

1. Funciona offline após a primeira visita. O service worker só grava em cache
   respostas `ok` e nunca substitui o app por uma página de erro.
2. Toda mudança em arquivo do app shell incrementa `CACHE_NAME` em `sw.js` e o
   parâmetro `?v=` correspondente em `index.html` e `sw.js`.
3. Atualizações de interface são oferecidas ao usuário; nunca recarregue a página
   com formulário aberto.
4. Metas (celular intermediário, 4G): **LCP < 2,5 s, INP < 200 ms, CLS < 0,1**.
   Renderizações não podem ter custo proporcional ao número de dias desde a data
   de referência do saldo.
5. Sem frameworks nem dependências de runtime novas sem justificativa de tamanho e
   benefício. Dependências de desenvolvimento (testes) são permitidas.
6. Manifesto com ícones `any` e, se houver, ícones `maskable` próprios, com área
   de segurança.

## 7. Código

1. JavaScript moderno sem build; cada módulo em `js/` expõe um único objeto
   `window.MG*`. Lógica nova vai para o módulo do seu domínio, não para `app.js`.
2. Estilos novos vão para `mobile.css`. Não aumente o CSS inline de `index.html`.
3. Funções pequenas, nomes descritivos em inglês no código; textos da interface e
   documentação em português do Brasil.
4. Não deixe código morto, `console.log` de depuração ou arquivos temporários no
   repositório.
5. Commits no padrão **Conventional Commits** (`feat:`, `fix:`, `style:`,
   `refactor:`, `test:`, `docs:`), um assunto por commit.

## 8. Testes e entrega

1. Correção de bug vem com teste que falhava antes da correção.
2. Antes de concluir qualquer tarefa: `npm test` (unitários) e, para mudanças de
   interface ou fluxo, `npm run test:e2e` com o servidor local na porta 8000.
3. Testes E2E usam perfis sintéticos e serviços Google simulados; nunca contas ou
   dados reais.
4. Testes que dependem da data de hoje fixam o relógio (`page.clock` no
   Playwright; data explícita nos unitários), para não mudar de resultado
   conforme o dia em que rodam.
5. Testes devem descrever o comportamento **correto**. Testes que documentam
   defeitos são removidos ou invertidos quando o defeito é corrigido.
6. Atualize o `README.md` quando mudar comportamento visível, formato de dados ou
   procedimento de configuração.
