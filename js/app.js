const defaultTypes = [
        "TRABALHO",
        "GAS",
        "NUBANK",
        "IPVA",
        "IPTU",
        "CONDOMINIO",
        "FINANCIAMENTO",
        "OBJETIVO",
        "PERSON",
        "FIT",
        "FRAN",
      ];
      const defaultDescriptions = [
        "TRABALHO",
        "GAS",
        "ASSINATURA",
        "CARRO",
        "CASA",
        "CONDOMINIO",
        "FINANCIAMENTO",
        "EMPRESTIMO",
        "MEL",
        "PRESENTES",
        "ROUPAS",
        "BRUNA",
        "TEC",
        "FIT",
        "COMIDA",
        "VIAGEM",
        "SAUDE",
        "RESTAURANTE",
        "BEBIDAS",
        "BARBEARIA",
        "CASHBACK",
        "FRAN",
        "RECORRENTE",
      ];

      const SUPABASE_URL = "https://gluyucuvvvfkztzjhbyj.supabase.co";
      const SUPABASE_PUBLISHABLE_KEY =
        "sb_publishable_KPlZr5eXf58-6-O89Gqr0A_OKIkj_Me";
      const APP_URL = "https://dsekito.github.io/Meus-Gastos/";
      const supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        {
          auth: {
            autoRefreshToken: true,
            // Mantém somente a sessão de autenticação no navegador. Lançamentos e
            // configurações continuam sendo carregados exclusivamente da nuvem.
            persistSession: true,
            detectSessionInUrl: true,
          },
        },
      );
      const domain = window.MGDomain;
      const localStore = window.MGLocalStore;
      const repository = window.MGSupabaseRepository.create(supabaseClient);
      let entriesChannel = null;

      function createDefaultSettings() {
        return {
          current_balance: 10000,
          balance_reference_date: todayISO(),
          income_day_15: 9365.96,
          income_last_business_day: 8011.84,
        };
      }

      const state = {
        types: [...defaultTypes],

        descriptions: [...defaultDescriptions],

        entries: [],

        recurrenceSeries: [],

        settings: createDefaultSettings(),

        settingsDirty: false,

        selectedCalendarDate: null,

        filterDate: null,

        calendarExpanded: false,

        activeEntry: null,

        editingId: null,

        selectionMode: false,

        selectedEntries: new Set(),

        user: null,

        deletedEntryIds: new Set(),

        syncQueue: [],
      };
      const synchronization = window.MGSyncService.create({
        state,
        repository,
        persist: saveLocal,
        normalizeEntryIds,
      });

      const money = (n) =>
        new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(n);

      const calendarMoney = (n) =>
        new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(n);

      const esc = (s) =>
        String(s).replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c],
        );
      const CATEGORY_COLORS = {
        TRABALHO: "#F97316",
        GAS: "#8B5CF6",
        NUBANK: "#7E22CE",
        IPVA: "#DC2626",
        IPTU: "#B45309",
        CONDOMINIO: "#16A34A",
        FINANCIAMENTO: "#4B5563",
        OBJETIVO: "#EAB308",
        PERSON: "#EC4899",
        FIT: "#22C55E",
        FRAN: "#06B6D4",
      };

      function categoryColor(type) {
        return CATEGORY_COLORS[type] || "#64748B";
      }

      const dialog = document.querySelector("#entryDialog"),
        form = document.querySelector("#entryForm"),
        modalTitle = document.querySelector(".modal h2"),
        dateInput = document.querySelector("#date"),
        valueInput = document.querySelector("#value"),
        detailInput = document.querySelector("#detail"),
        paidInput = document.querySelector("#paid"),
        paidField = document.querySelector("#paidField"),
        type = document.querySelector("#type"),
        desc = document.querySelector("#description"),
        flowType = document.querySelector("#flowType"),
        recurrence = document.querySelector("#recurrence"),
        installments = document.querySelector("#installments"),
        installmentsField = document.querySelector("#installmentsField"),
        recurrenceFields = document.querySelector("#recurrenceFields"),
        recurrenceInterval = document.querySelector("#recurrenceInterval"),
        customUnitField = document.querySelector("#customUnitField"),
        customUnit = document.querySelector("#customUnit"),
        endMode = document.querySelector("#endMode"),
        endDateField = document.querySelector("#endDateField"),
        endDate = document.querySelector("#endDate"),
        occurrenceCountField = document.querySelector("#occurrenceCountField"),
        occurrenceCount = document.querySelector("#occurrenceCount"),
        businessDayAdjustment = document.querySelector("#businessDayAdjustment"),
        recurrenceSummary = document.querySelector("#recurrenceSummary"),
        editScopeField = document.querySelector("#editScopeField"),
        editScope = document.querySelector("#editScope"),
        paidLabel = document.querySelector("#paidLabel"),
        filterType = document.querySelector("#filterType"),
        filterMonth = document.querySelector("#filterMonth"),
        filterStatus = document.querySelector("#filterStatus"),
        monthTotal = document.querySelector("#monthTotal"),
        incomeTotal = document.querySelector("#incomeTotal"),
        currentBalanceTotal = document.querySelector("#currentBalanceTotal"),
        balanceReferenceSummary = document.querySelector("#balanceReferenceSummary"),
        paidTotal = document.querySelector("#paidTotal"),
        pendingTotal = document.querySelector("#pendingTotal"),
        count = document.querySelector("#count"),
        panelTitle = document.querySelector("#panelTitle"),
        toast = document.querySelector("#toast"),
        selectionActions = document.querySelector("#selectionActions"),
        dateFilterInfo = document.querySelector("#dateFilterInfo"),
        dateFilterLabel = document.querySelector("#dateFilterLabel"),
        clearDateFilter = document.querySelector("#clearDateFilter"),
        openModal = document.querySelector("#openModal"),
        openModalMobile = document.querySelector("#openModalMobile"),
        rows = document.querySelector("#rows"),
        contextMenu = document.querySelector("#contextMenu"),
        authArea = document.querySelector("#authArea"),
        authScreen = document.querySelector("#authScreen"),
        appShell = document.querySelector("#appShell"),
        signInGoogleScreen = document.querySelector("#signInGoogleScreen"),
        filteredSubtotal = document.querySelector("#filteredSubtotal"),
        calendarGrid = document.querySelector("#calendarGrid"),
        calendarPanel = document.querySelector(".calendar-panel"),
        calendarCaption = document.querySelector("#calendarCaption"),
        monthlyMinimumLabel = document.querySelector("#monthlyMinimumLabel"),
        monthlyMinimumBalance = document.querySelector("#monthlyMinimumBalance"),
        toggleCalendar = document.querySelector("#toggleCalendar"),
        settingsDialog = document.querySelector("#settingsDialog"),
        settingsForm = document.querySelector("#settingsForm"),
        openSettings = document.querySelector("#openSettings"),
        currentBalanceInput = document.querySelector("#currentBalance"),
        incomeDay15Input = document.querySelector("#incomeDay15"),
        incomeLastBusinessDayInput = document.querySelector("#incomeLastBusinessDay"),
        balanceReferenceDateInput = document.querySelector("#balanceReferenceDate"),
        previousMonth = document.querySelector("#previousMonth"),
        nextMonth = document.querySelector("#nextMonth"),
        seriesScopeDialog = document.querySelector("#seriesScopeDialog"),
        bulkDateDialog = document.querySelector("#bulkDateDialog"),
        bulkDateForm = document.querySelector("#bulkDateForm"),
        bulkDateInput = document.querySelector("#bulkDate"),
        saveBulkDate = document.querySelector("#saveBulkDate"),
        saveEntry = document.querySelector("#saveEntry"),
        forecastPeriod = document.querySelector("#forecastPeriod"),
        forecastHealth = document.querySelector("#forecastHealth"),
        forecastMinimum = document.querySelector("#forecastMinimum"),
        forecastChart = document.querySelector("#forecastChart"),
        forecastStartLabel = document.querySelector("#forecastStartLabel"),
        forecastMiddleLabel = document.querySelector("#forecastMiddleLabel"),
        forecastEndLabel = document.querySelector("#forecastEndLabel"),
        syncStatus = document.querySelector("#syncStatus");

      function todayISO() {
        return domain.todayISO();
      }

      function setSyncStatus(stateName, message) {
        syncStatus.dataset.state = stateName;
        syncStatus.textContent = message;
      }

      selectionActions.onclick = (e) => {
        e.stopPropagation();

        if (e.target.closest("#exitSelection")) {
          exitSelectionMode();
          return;
        }

        if (e.target.closest("#selectAll")) {
          selectAllFiltered();
          return;
        }

        if (e.target.closest("#deleteSelection")) {
          deleteSelectedEntries();
          return;
        }

        if (e.target.closest("#editDateSelection")) {
          openBulkDateDialog();
          return;
        }

        if (e.target.closest("#markPaidSelection")) {
          markSelectedAsPaid();
          return;
        }

        if (e.target.closest("#markPendingSelection")) {
          markSelectedAsPending();
          return;
        }
      };

      function saveLocal() {
        // Não persistimos lançamentos, configurações ou fila de sincronização no navegador.
      }

      function clearSessionState() {
        state.user = null;
        state.entries = [];
        state.recurrenceSeries = [];
        state.syncQueue = [];
        state.deletedEntryIds = new Set();
        state.types = [...defaultTypes];
        state.descriptions = [...defaultDescriptions];
        state.settings = createDefaultSettings();
        state.settingsDirty = false;
        state.selectedCalendarDate = null;
        state.filterDate = null;
        state.calendarExpanded = false;
        state.activeEntry = null;
        state.editingId = null;
        state.selectionMode = false;
        state.selectedEntries = new Set();
      }

      function resetStateForUser(user) {
        clearSessionState();
        state.user = user;
      }

      function queueUpsert(entry) {
        synchronization.queueUpsert(entry);
      }

      function queueDelete(id, baseUpdatedAt = null) {
        synchronization.queueDelete(id, baseUpdatedAt);
      }

      async function save() {
        saveLocal();
        setSyncStatus("syncing", "Sincronizando alterações...");
        try {
          await syncEntries();
          if (state.settingsDirty) {
            await syncSettings();
            state.settingsDirty = false;
          }
          setSyncStatus("synced", "Alterações sincronizadas");
          return true;
        } catch (error) {
          console.error(error);
          setSyncStatus("pending", "Sincronização pendente");
          show(
            "Alteração ainda não foi sincronizada. Mantenha esta página aberta.",
          );
          return false;
        }
      }

      function hasPendingChanges() {
        return state.syncQueue.length > 0 || state.settingsDirty;
      }

      async function retryPendingSynchronization() {
        if (!state.user || !hasPendingChanges()) return true;
        const synced = await save();
        if (synced) {
          render();
          show("Alterações pendentes foram sincronizadas.");
        }
        return synced;
      }

      function updateAuthArea() {
        authScreen.hidden = !!state.user;
        appShell.hidden = !state.user;
        openModalMobile.hidden = !state.user;
        if (!state.user) {
          authArea.innerHTML =
            '<button class="auth-button" id="signInGoogle" type="button">Entrar com Google</button>';
          return;
        }

        const name = state.user.user_metadata?.full_name || state.user.email;
        authArea.innerHTML = `<span class="signed-user" title="${esc(state.user.email || "")}">${esc(name || "Usuário")}</span><button class="auth-button" id="signOut" type="button" aria-label="Sair da conta" title="Sair da conta"><span aria-hidden="true">⎋</span><span class="button-label">Sair</span></button>`;
      }

      async function syncEntries() {
        if (!state.user) {
          setSyncStatus("idle", "Entre para sincronizar");
          return;
        }
        await synchronization.syncEntries(state.user.id);
      }
      async function fetchAllCloudEntries() {
        return repository.fetchEntries();
      }
      async function loadCloudEntries() {
        setSyncStatus("syncing", "Carregando seus lançamentos...");
        const data = await fetchAllCloudEntries();
        const entriesById = new Map(data.map((entry) => [entry.id, entry]));

        for (const operation of state.syncQueue) {
          if (operation.type === "delete") {
            entriesById.delete(operation.id);
          } else {
            entriesById.set(operation.entry.id, operation.entry);
          }
        }

        state.entries = [...entriesById.values()];
        state.types = [
          ...new Set([...state.types, ...state.entries.map((entry) => entry.type)]),
        ].sort();
        state.descriptions = [
          ...new Set([
            ...state.descriptions,
            ...state.entries.map((entry) => entry.description),
          ]),
        ].sort();
        render();
      }

      function materializationHorizon(series) {
        const anchor = series.start_date > todayISO() ? series.start_date : todayISO();
        return domain.addMonthsClamped(anchor, 18);
      }

      function occurrenceEntry(series, occurrence) {
        return {
          id: generateId(),
          date: occurrence.date,
          scheduled_date: occurrence.scheduled_date,
          series_id: series.id,
          detached_from_series: false,
          excluded_from_series: false,
          flow_type: series.flow_type,
          value: Number(series.value),
          type: series.type,
          description: series.description,
          detail: series.detail || "",
          paid: false,
          installment: null,
          created_at: new Date().toISOString(),
        };
      }

      async function materializeRecurrenceSeries(series) {
        if (!series.active) return 0;
        const existingDates = new Set(
          state.entries
            .filter((entry) => entry.series_id === series.id)
            .map((entry) => entry.scheduled_date),
        );
        const generated = domain.generateRecurringOccurrences(
          series,
          series.start_date,
          materializationHorizon(series),
        );
        const missing = generated
          .filter((occurrence) => !existingDates.has(occurrence.scheduled_date))
          .map((occurrence) => occurrenceEntry(series, occurrence));
        if (!missing.length) return 0;
        const saved = await repository.upsertEntries(missing, state.user.id);
        const versions = new Map(saved.map((entry) => [entry.id, entry.updated_at]));
        missing.forEach((entry) => {
          entry.updated_at = versions.get(entry.id) || entry.updated_at;
          state.entries.push(entry);
        });
        return missing.length;
      }

      async function loadCloudRecurrenceSeries() {
        state.recurrenceSeries = await repository.fetchRecurrenceSeries();
        for (const series of state.recurrenceSeries) {
          await materializeRecurrenceSeries(series);
        }

      }

      function applyRealtimeEntry(payload) {
        const id = payload.new?.id || payload.old?.id;
        if (!id) return;

        const hasPendingLocalChange = state.syncQueue.some((operation) =>
          operation.type === "upsert"
            ? operation.entry.id === id
            : operation.id === id,
        );
        if (hasPendingLocalChange) return;

        if (payload.eventType === "DELETE") {
          state.entries = state.entries.filter((entry) => entry.id !== id);
        } else {
          const index = state.entries.findIndex((entry) => entry.id === id);
          if (index >= 0) state.entries[index] = payload.new;
          else state.entries.push(payload.new);
          state.types = [...new Set([...state.types, payload.new.type])].sort();
          state.descriptions = [
            ...new Set([...state.descriptions, payload.new.description]),
          ].sort();
        }
        saveLocal();
        render();
      }

      function stopEntrySubscription() {
        repository.removeChannel(entriesChannel);
        entriesChannel = null;
      }

      function subscribeToEntryChanges() {
        if (!state.user) return;
        stopEntrySubscription();
        entriesChannel = repository.subscribeToEntries(
          state.user.id,
          applyRealtimeEntry,
          (status) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              console.warn("Atualização em tempo real indisponível; usando recarga ao abrir o app.");
            }
          },
        );
      }

      async function syncSettings() {
        if (!state.user) return;
        await repository.upsertSettings(
          state.user.id,
          state.settings,
          state.types,
          state.descriptions,
        );
      }
      async function loadCloudSettings() {
        const data = await repository.fetchSettings();
        if (data) {
          state.settings = {
            ...data,
            balance_reference_date: data.balance_reference_date || todayISO(),
          };
          state.types = [...new Set([...defaultTypes, ...(data.types || [])])].sort();
          state.descriptions = [...new Set([...defaultDescriptions, ...(data.descriptions || [])])].sort();
          state.settingsDirty = false;
        } else {
          await syncSettings();
          state.settingsDirty = false;
        }
        saveLocal();
        render();
      }
      async function setCurrentUser(user) {
        if (state.user?.id === user?.id) return;
        state.user = user || null;
        if (state.user) resetStateForUser(state.user);
        updateAuthArea();
        if (state.user) {
          let hasPendingSync = false;
          try {
            normalizeEntryIds();
            try {
              await syncEntries();
            } catch (error) {
              // Uma operação pendente não pode impedir a leitura da nuvem.
              // A fila continua preservada para uma nova tentativa posterior.
              hasPendingSync = true;
              console.error(error);
              setSyncStatus("pending", "Sincronização pendente");
            }
            await loadCloudEntries();
            await loadCloudSettings();
            await loadCloudRecurrenceSeries();
            subscribeToEntryChanges();
            if (!hasPendingSync) setSyncStatus("synced", "Dados sincronizados");
          } finally {
            // Mesmo com falha temporária de rede, a tela continua responsiva.
            render();
          }
        } else {
          setSyncStatus("idle", "Entre para sincronizar");
        }
      }

      async function signInWithGoogle() {
        if (window.location.protocol === "file:") {
          show("Abra o site publicado para entrar com Google.");
          return;
        }
        const { error } = await supabaseClient.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: APP_URL },
        });
        if (error) show(`Não foi possível iniciar o login: ${error.message}`);
      }

      async function signOut() {
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
          show(`Não foi possível sair: ${error.message}`);
          return;
        }
        stopEntrySubscription();
        clearSessionState();
        updateAuthArea();
        setSyncStatus("idle", "Entre para sincronizar");
        show("Sessão encerrada.");
      }

      async function initializeAuth() {
        updateAuthArea();
        supabaseClient.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_OUT") {
            stopEntrySubscription();
            clearSessionState();
            updateAuthArea();
            return;
          }
          if (event === "SIGNED_IN") {
            setCurrentUser(session?.user).catch((error) => {
              console.error(error);
              show("Não foi possível carregar seus lançamentos.");
            });
          }
        });
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
          show("Não foi possível verificar o login.");
          return;
        }
        await setCurrentUser(data.session?.user);
      }

      authArea.onclick = async (event) => {
        if (event.target.closest("#signInGoogle")) await signInWithGoogle();
        if (event.target.closest("#signOut")) await signOut();
      };

      signInGoogleScreen.onclick = () => signInWithGoogle();

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || !state.user) return;
        retryPendingSynchronization()
          .then(async () => {
            await loadCloudEntries();
            await loadCloudRecurrenceSeries();
            render();
          })
          .catch((error) => console.error(error));
      });

      window.addEventListener("online", () => {
        retryPendingSynchronization().catch((error) => console.error(error));
      });

      window.addEventListener("beforeunload", (event) => {
        if (!state.user || !hasPendingChanges()) return;
        event.preventDefault();
        event.returnValue = "";
      });
      function fill(select, values, placeholder) {
        select.innerHTML =
          `<option value="">${placeholder}</option>` +
          values.map((x) => `<option>${esc(x)}</option>`).join("") +
          '<option value="__new__">＋ Adicionar nova opção…</option>';
      }
      function formatDay(date) {
        return new Date(date + "T12:00").toLocaleDateString("pt-BR", {
          day: "2-digit",
        });
      }

      function formatMonth(date) {
        return new Date(date + "T12:00")
          .toLocaleDateString("pt-BR", {
            month: "short",
          })
          .replace(".", "")
          .toUpperCase();
      }
      function renderDenseEntry(e) {
        const selected = state.selectedEntries.has(e.id);
        const isIncome = (e.flow_type || "expense") === "income";
        const statusLabel = e.paid
          ? (isIncome ? "Recebido" : "Pago")
          : (isIncome ? "A receber" : "Em aberto");
        return `
          <div class="entry dense-entry ${selected ? "selected" : ""}" data-entry="${e.id}">
            <div class="entry-content">
              <div class="entry-summary">
                <div class="entry-header">
                  <div class="entry-title" title="${esc(e.description)}${e.detail ? ` - ${esc(e.detail)}` : ""}">
                    <span class="entry-dot" style="background:${categoryColor(e.type)}"></span>
                    <span class="entry-title-text">${esc(e.description)}${e.detail ? ` <span class="entry-detail-inline">- ${esc(e.detail)}</span>` : ""}</span>
                  </div>
                  <div class="entry-value ${isIncome ? "income" : ""}">${isIncome ? "+ " : ""}${money(e.value)}</div>
                </div>
                <div class="entry-footer">
                  <div class="entry-meta-line">
                    <span>${formatDay(e.date)} ${formatMonth(e.date)}</span>
                    <span class="entry-type">${esc(e.type)}</span>
                    <span class="entry-flow">${isIncome ? "Receita" : "Despesa"}</span>
                    ${e.installment ? `<span class="entry-installment">${e.installment.current}/${e.installment.total}</span>` : ""}
                    ${state.selectionMode ? "" : `<button class="status-button ${e.paid ? "paid" : "pending"}" data-toggle-status="${e.id}">${statusLabel}</button>`}
                  </div>
                </div>
              </div>
            </div>
            ${state.selectionMode ? "" : `<button class="entry-menu" data-edit="${e.id}" aria-label="Mais opções para ${esc(e.description)}">⋮</button>`}
          </div>`;
      }

      function updateSummary(entries, month) {
        const expenses = entries.filter((entry) => (entry.flow_type || "expense") === "expense");
        const incomes = entries.filter((entry) => (entry.flow_type || "expense") === "income");
        monthTotal.textContent = money(
          expenses.reduce((a, e) => a + Number(e.value), 0),
        );
        const [year, monthNumber] = month.split("-").map(Number);
        const daysInMonth = new Date(year, monthNumber, 0).getDate();
        let recurringIncomeTotal = 0;
        for (let day = 1; day <= daysInMonth; day += 1) {
          recurringIncomeTotal += getRecurringIncome(`${month}-${String(day).padStart(2, "0")}`);
        }
        incomeTotal.textContent = money(
          recurringIncomeTotal + incomes.reduce((a, e) => a + Number(e.value), 0),
        );

        paidTotal.textContent = money(
          expenses.filter((e) => e.paid).reduce((a, e) => a + Number(e.value), 0),
        );

        pendingTotal.textContent = money(
          expenses.filter((e) => !e.paid).reduce((a, e) => a + Number(e.value), 0),
        );
      }

      function renderFilterTypes() {
        const selected = filterType.value;

        filterType.innerHTML =
          '<option value="">Todos os tipos</option>' +
          state.types.map((x) => `<option>${esc(x)}</option>`).join("");

        filterType.value = selected;
      }

      function getMonthlyEntries(month) {
        return state.entries.filter((e) => !e.excluded_from_series && e.date.slice(0, 7) === month);
      }

      function getFilteredEntries(entries, type, status, date = state.filterDate) {
        return entries
          .filter(
            (e) =>
              (!type || e.type === type) &&
              (!status || (status === "paid") === e.paid) &&
              (!date || e.date === date),
          )
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date) ||
              a.type.localeCompare(b.type, "pt-BR") ||
              String(b.created_at || "").localeCompare(String(a.created_at || "")),
          );
      }

      function getRecurringIncome(date) {
        return domain.recurringIncome(date, state.settings);
      }

      function buildDailyEntryTotals() {
        return domain.dailyEntryTotals(state.entries);
      }

      function buildDailyEntryNet() {
        return domain.dailyEntryNet(state.entries);
      }

      function getProjectedBalance(date, entryNet) {
        return domain.projectedBalance(date, state.settings, entryNet);
      }

      function renderCalendar() {
        const month = filterMonth.value;
        if (!month) return;
        const [year, monthNumber] = month.split("-").map(Number);
        const monthIndex = monthNumber - 1;
        const firstDay = new Date(year, monthIndex, 1, 12);
        const daysInMonth = new Date(year, monthNumber, 0).getDate();
        const entryTotals = buildDailyEntryTotals();
        const entryNet = buildDailyEntryNet();
        const entryIncomeTotals = domain.dailyIncomeTotals(state.entries);
        let minimumBalance = Infinity;
        let minimumBalanceDate = `${month}-01`;

        if (!state.selectedCalendarDate?.startsWith(month)) {
          state.selectedCalendarDate = `${month}-01`;
        }

        calendarCaption.textContent = firstDay.toLocaleDateString("pt-BR", {
          month: "long",
          year: "numeric",
        });

        const cells = Array.from({ length: firstDay.getDay() }, () =>
          '<div class="calendar-day empty-day"></div>',
        );
        for (let day = 1; day <= daysInMonth; day++) {
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const costs = entryTotals.get(date) || 0;
          const income = getRecurringIncome(date) + (entryIncomeTotals.get(date) || 0);
          const projected = getProjectedBalance(date, entryNet);
          if (projected < minimumBalance) {
            minimumBalance = projected;
            minimumBalanceDate = date;
          }
          cells.push(`
            <button class="calendar-day ${date === state.selectedCalendarDate ? "selected" : ""} ${income ? "has-income" : ""} ${costs ? "has-cost" : ""} ${projected < 0 ? "balance-negative" : "balance-positive"}" data-calendar-date="${date}" type="button" aria-label="Dia ${day}: saldo ${calendarMoney(projected)}, entrada ${calendarMoney(income)}, saída ${calendarMoney(costs)}">
              <span class="calendar-date">${day}</span>
              <span class="calendar-metric calendar-projection"><span class="calendar-metric-label">Saldo</span><span class="calendar-metric-value">${calendarMoney(projected)}</span></span>
              <span class="calendar-metric calendar-income"><span class="calendar-metric-label">Entrada</span><span class="calendar-metric-value">${calendarMoney(income)}</span></span>
              <span class="calendar-metric calendar-cost"><span class="calendar-metric-label">Saída</span><span class="calendar-metric-value">${calendarMoney(costs)}</span></span>
            </button>
          `);
        }
        calendarGrid.innerHTML = cells.join("");

        monthlyMinimumLabel.textContent = `Menor saldo em ${new Date(`${minimumBalanceDate}T12:00`).toLocaleDateString("pt-BR")}`;
        monthlyMinimumBalance.textContent = calendarMoney(minimumBalance);
        calendarPanel.classList.toggle("compact", !state.calendarExpanded);
        toggleCalendar.setAttribute("aria-expanded", String(state.calendarExpanded));
        toggleCalendar.textContent = state.calendarExpanded
          ? "Ocultar calendário"
          : "Ver calendário";
      }

      function updateCount(entries) {
        count.textContent = `${entries.length} lançamento${entries.length === 1 ? "" : "s"}`;
      }

      function timelineDateLabel(date) {
        const formatted = new Date(`${date}T12:00`).toLocaleDateString("pt-BR", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }).replaceAll(".", "");
        if (date === todayISO()) return `Hoje, ${formatted.split(", ").at(-1)}`;
        return formatted.charAt(0).toUpperCase() + formatted.slice(1);
      }

      function renderTimelineEntry(entry) {
        const selected = state.selectedEntries.has(entry.id);
        const isIncome = (entry.flow_type || "expense") === "income";
        const statusLabel = entry.paid
          ? (isIncome ? "Recebido" : "Pago")
          : (isIncome ? "A receber" : "Em aberto");
        return `
          <div class="timeline-entry ${selected ? "selected" : ""}" data-entry="${entry.id}">
            <span class="timeline-dot" style="background:${categoryColor(entry.type)}" aria-hidden="true"></span>
            <div class="timeline-entry-copy">
              <strong>${esc(entry.description)}</strong>
              <span>${esc(entry.detail || entry.type)} · ${statusLabel}</span>
            </div>
            <div class="timeline-entry-value ${isIncome ? "income" : "expense"}">${isIncome ? "+ " : "− "}${money(entry.value)}</div>
            ${state.selectionMode ? "" : `<button class="entry-menu" data-edit="${entry.id}" aria-label="Mais opções para ${esc(entry.description)}">Mais</button>`}
          </div>`;
      }

      function renderEntries(entries) {
        if (!entries.length) {
          rows.innerHTML = '<div class="empty">Nenhum lançamento encontrado.</div>';
          return;
        }
        const entryNet = buildDailyEntryNet();
        const groups = new Map();
        entries.forEach((entry) => {
          if (!groups.has(entry.date)) groups.set(entry.date, []);
          groups.get(entry.date).push(entry);
        });
        rows.innerHTML = [...groups.entries()].map(([date, dailyEntries]) => `
          <section class="timeline-group" aria-label="${timelineDateLabel(date)}">
            <div class="timeline-day-head">
              <h3>${timelineDateLabel(date)}</h3>
              <div><span>Saldo após o dia</span><strong>${money(getProjectedBalance(date, entryNet))}</strong></div>
            </div>
            ${dailyEntries.map(renderTimelineEntry).join("")}
          </section>
        `).join("");
      }

      function renderForecast(month) {
        const [year, monthNumber] = month.split("-").map(Number);
        const daysInMonth = new Date(year, monthNumber, 0).getDate();
        const monthStart = `${month}-01`;
        const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
        const start = todayISO().startsWith(month) ? todayISO() : monthStart;
        const entryNet = buildDailyEntryNet();
        const points = [];
        for (let cursor = start; cursor <= monthEnd; cursor = domain.addDays(cursor, 1)) {
          points.push({ date: cursor, value: getProjectedBalance(cursor, entryNet) });
        }
        if (!points.length) return;

        const endBalance = points.at(-1).value;
        const minimum = points.reduce((lowest, point) => point.value < lowest.value ? point : lowest, points[0]);
        currentBalanceTotal.textContent = money(endBalance);
        forecastPeriod.textContent = `até ${new Date(`${monthEnd}T12:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`;
        forecastMinimum.textContent = `Menor saldo: ${money(minimum.value)}`;
        forecastHealth.textContent = minimum.value >= 0
          ? "Saldo positivo durante todo o mês"
          : `Atenção: saldo negativo em ${new Date(`${minimum.date}T12:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "")}`;
        forecastHealth.classList.toggle("negative", minimum.value < 0);
        forecastStartLabel.textContent = start === todayISO() ? "Hoje" : "Início do mês";
        forecastMiddleLabel.textContent = `${Math.ceil(daysInMonth / 2)} ${new Date(`${month}-15T12:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}`;
        forecastEndLabel.textContent = `${daysInMonth} ${new Date(`${monthEnd}T12:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}`;

        const rect = forecastChart.getBoundingClientRect();
        const width = Math.max(280, Math.round(rect.width));
        const height = Math.max(112, Math.round(rect.height));
        const ratio = window.devicePixelRatio || 1;
        forecastChart.width = width * ratio;
        forecastChart.height = height * ratio;
        const ctx = forecastChart.getContext("2d");
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, width, height);
        const pad = { top: 18, right: 10, bottom: 16, left: 2 };
        const values = points.map((point) => point.value);
        const low = Math.min(0, ...values);
        const high = Math.max(0, ...values);
        const span = Math.max(1, high - low);
        const x = (index) => pad.left + (index / Math.max(1, points.length - 1)) * (width - pad.left - pad.right);
        const y = (value) => pad.top + ((high - value) / span) * (height - pad.top - pad.bottom);

        ctx.strokeStyle = "#a9b9c8";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y(0));
        ctx.lineTo(width - pad.right, y(0));
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = minimum.value < 0 ? "#b42318" : "#126b5b";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        points.forEach((point, index) => index ? ctx.lineTo(x(index), y(point.value)) : ctx.moveTo(x(index), y(point.value)));
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(x(points.length - 1), y(endBalance), 5, 0, Math.PI * 2);
        ctx.fill();
        forecastChart.setAttribute("aria-label", `Projeção de saldo de ${money(points[0].value)} até ${money(endBalance)}. Menor saldo ${money(minimum.value)}.`);
      }

      function render() {
        fill(type, state.types, "Selecione");
        fill(desc, state.descriptions, "Selecione");

        renderFilterTypes();

        const ft = filterType.value,
          fs = filterStatus.value;

        const current = new Date().toISOString().slice(0, 7);

        if (!filterMonth.value) filterMonth.value = current;

        const month = filterMonth.value;

        const monthly = getMonthlyEntries(month);

        updateSummary(monthly, month);
        const referenceDate = state.settings.balance_reference_date || todayISO();
        balanceReferenceSummary.textContent = `Saldo informado em ${new Date(`${referenceDate}T12:00`).toLocaleDateString("pt-BR")}`;

        const list = getFilteredEntries(monthly, ft, fs);

        updateCount(list);
        filteredSubtotal.textContent = money(
          list.reduce(
            (total, entry) => total + ((entry.flow_type || "expense") === "income" ? Number(entry.value) : -Number(entry.value)),
            0,
          ),
        );

        renderEntries(list);
        renderCalendar();
        renderForecast(month);

        panelTitle.textContent = state.selectionMode
          ? `${state.selectedEntries.size} selecionado${state.selectedEntries.size > 1 ? "s" : ""}`
          : state.filterDate
            ? `Lançamentos de ${new Date(`${state.filterDate}T12:00`).toLocaleDateString("pt-BR")}`
            : "Próximos lançamentos";

        count.style.display = state.selectionMode ? "none" : "";
        dateFilterInfo.classList.toggle(
          "visible",
          Boolean(state.filterDate) && !state.selectionMode,
        );
        dateFilterLabel.textContent = state.filterDate
          ? new Date(`${state.filterDate}T12:00`).toLocaleDateString("pt-BR")
          : "";

        let hasPendingSelection = false;

        if (state.selectionMode) {
          hasPendingSelection = state.entries.some(
            (entry) => state.selectedEntries.has(entry.id) && !entry.paid,
          );
        }

        selectionActions.innerHTML = state.selectionMode
          ? `
          <div class="selection-actions">

              <button
                  id="exitSelection"
                  class="icon-button"
                  type="button"
                  aria-label="Cancelar seleção"
                  title="Cancelar seleção">
                  ←
              </button>
              ${
                list.length === 0
                  ? ""
                  : list.every((entry) => state.selectedEntries.has(entry.id))
                    ? `
                              <button
                                  id="selectAll"
                                  class="icon-button"
                                  type="button"
                                  aria-label="Desmarcar todos os lançamentos"
                                  title="Desmarcar todos">
                                  ☒
                              </button>
                          `
                    : `
                              <button
                                  id="selectAll"
                                  class="icon-button"
                                  type="button"
                                  aria-label="Selecionar todos os lançamentos filtrados"
                                  title="Selecionar todos">
                                  ☑
                              </button>
                          `
              }
              <div class="selection-toolbar">

                  ${
                    hasPendingSelection
                      ? `
                      <button
                          id="markPaidSelection"
                          class="icon-button"
                          type="button"
                          aria-label="Marcar selecionados como pagos"
                          title="Marcar como pago">
                          ✔
                      </button>
                      `
                      : `
                      <button
                          id="markPendingSelection"
                          class="icon-button"
                          type="button"
                          aria-label="Marcar selecionados como pendentes"
                          title="Marcar como pendente">
                          ↺
                      </button>
                      `
                  }

                  <button
                      id="editDateSelection"
                      class="icon-button"
                      type="button"
                      aria-label="Alterar data dos selecionados"
                      title="Alterar data dos selecionados">
                      <span aria-hidden="true">📅</span>
                  </button>

                  <button
                      id="deleteSelection"
                      class="icon-button"
                      type="button"
                      aria-label="Excluir selecionados"
                      title="Excluir selecionados">
                      🗑
                  </button>

              </div>

          </div>
          `
          : "";
      }

      function markSelectedAsPaid() {
        let changed = 0;

        for (const entry of state.entries) {
          if (!state.selectedEntries.has(entry.id)) {
            continue;
          }

          if (!entry.paid) {
            entry.paid = true;
            queueUpsert(entry);
            changed++;
          }
        }

        if (changed > 0) {
          save();
        }

        exitSelectionMode();

        show(
          changed === 0
            ? "Os lançamentos selecionados já estavam pagos."
            : `${changed} lançamento${changed !== 1 ? "s" : ""} marcado${changed !== 1 ? "s" : ""} como pago.`,
        );
      }

      function markSelectedAsPending() {
        let changed = 0;

        for (const entry of state.entries) {
          if (!state.selectedEntries.has(entry.id)) {
            continue;
          }

          if (entry.paid) {
            entry.paid = false;
            queueUpsert(entry);
            changed++;
          }
        }

        if (changed > 0) {
          save();
        }

        exitSelectionMode();

        show(
          changed === 0
            ? "Os lançamentos selecionados já estavam pendentes."
            : `${changed} lançamento${changed !== 1 ? "s" : ""} marcado${changed !== 1 ? "s" : ""} como pendente.`,
        );
      }

      function selectAllFiltered() {
        const list = getFilteredEntries(
          getMonthlyEntries(filterMonth.value),
          filterType.value,
          filterStatus.value,
        );

        const allSelected =
          list.length > 0 &&
          list.every((entry) => state.selectedEntries.has(entry.id));

        if (allSelected) {
          list.forEach((entry) => {
            state.selectedEntries.delete(entry.id);
          });

          if (state.selectedEntries.size === 0) {
            exitSelectionMode();
            return;
          }
        } else {
          list.forEach((entry) => {
            state.selectedEntries.add(entry.id);
          });
        }

        render();
      }

      function isRecurringValue(value = recurrence.value) {
        return ["weekly", "monthly", "annual", "custom"].includes(value);
      }

      function openBulkDateDialog() {
        if (state.selectedEntries.size === 0) return;
        bulkDateInput.value = todayISO();
        bulkDateDialog.showModal();
        bulkDateInput.focus();
      }

      async function changeSelectedDate(newDate) {
        let changed = 0;

        for (const entry of state.entries) {
          if (!state.selectedEntries.has(entry.id) || entry.date === newDate) continue;
          entry.date = newDate;
          if (entry.series_id) entry.detached_from_series = true;
          queueUpsert(entry);
          changed++;
        }

        if (changed > 0) await save();
        bulkDateDialog.close();
        exitSelectionMode();
        show(
          changed === 0
            ? "Os lançamentos selecionados já estavam nessa data."
            : `Data de ${changed} lançamento${changed !== 1 ? "s" : ""} alterada.`,
        );
      }

      function recurrenceUnitLabel() {
        const unit = recurrence.value === "custom" ? customUnit.value : {
          weekly: "week",
          monthly: "month",
          annual: "year",
        }[recurrence.value];
        return {
          day: ["dia", "dias"],
          week: ["semana", "semanas"],
          month: ["mês", "meses"],
          year: ["ano", "anos"],
        }[unit] || ["período", "períodos"];
      }

      function updateRecurrenceSummary() {
        if (!isRecurringValue()) return;
        const interval = Math.max(1, Number(recurrenceInterval.value) || 1);
        const labels = recurrenceUnitLabel();
        let text = interval === 1 ? `A cada ${labels[0]}` : `A cada ${interval} ${labels[1]}`;
        if (endMode.value === "on_date" && endDate.value) {
          text += `, até ${new Date(`${endDate.value}T12:00`).toLocaleDateString("pt-BR")}`;
        } else if (endMode.value === "after_occurrences") {
          const total = Math.max(1, Number(occurrenceCount.value) || 1);
          text += `, por ${total} ocorrência${total === 1 ? "" : "s"}`;
        } else {
          text += ", sem data final";
        }
        if (businessDayAdjustment.value === "previous") text += ", movendo fins de semana para o dia útil anterior";
        if (businessDayAdjustment.value === "next") text += ", movendo fins de semana para o próximo dia útil";
        recurrenceSummary.textContent = `${text}.`;
      }

      function updateEntryFormVisibility() {
        const recurring = isRecurringValue();
        const installmentOption = recurrence.querySelector('option[value="installments"]');
        installmentOption.disabled = flowType.value === "income";
        if (flowType.value === "income" && recurrence.value === "installments") recurrence.value = "single";
        installmentsField.hidden = recurrence.value !== "installments";
        installmentsField.style.display = installmentsField.hidden ? "none" : "";
        recurrenceFields.hidden = !recurring;
        customUnitField.hidden = recurrence.value !== "custom";
        endDateField.hidden = !recurring || endMode.value !== "on_date";
        occurrenceCountField.hidden = !recurring || endMode.value !== "after_occurrences";
        recurrenceInterval.required = recurring;
        endDate.required = recurring && endMode.value === "on_date";
        occurrenceCount.required = recurring && endMode.value === "after_occurrences";
        paidLabel.textContent = flowType.value === "income" ? "Marcar como recebido" : "Marcar como pago";
        paidField.hidden = recurring;
        updateRecurrenceSummary();
      }

      function openNew() {
        state.editingId = null;
        modalTitle.textContent = "Novo lançamento";
        form.reset();
        flowType.value = "expense";
        recurrence.value = "single";
        installments.value = 2;
        recurrenceInterval.value = 1;
        endMode.value = "never";
        occurrenceCount.value = 12;
        businessDayAdjustment.value = "none";
        editScopeField.hidden = true;
        dateInput.value = new Date().toISOString().slice(0, 10);
        updateEntryFormVisibility();
        render();
        dialog.showModal();
      }

      function openSettingsDialog() {
        currentBalanceInput.value = state.settings.current_balance;
        balanceReferenceDateInput.value = state.settings.balance_reference_date || todayISO();
        incomeDay15Input.value = state.settings.income_day_15;
        incomeLastBusinessDayInput.value = state.settings.income_last_business_day;
        settingsDialog.showModal();
      }

      function addOption(event, key, select) {
        if (event.target.value !== "__new__") return;
        const label = key === "types" ? "novo tipo" : "nova descrição";
        const value = prompt(`Digite a ${label}:`);
        if (value && value.trim()) {
          const clean = value.trim().toUpperCase();
          if (!state[key].includes(clean)) {
            state[key] = [...state[key], clean];
            state.settingsDirty = true;
          }
          save();
          fill(select, state[key], "Selecione");
          select.value = clean;
          show("Opção adicionada à lista.");
        } else select.value = "";
      }
      function addMonths(dateString, months) {
        const d = new Date(dateString + "T12:00");
        d.setMonth(d.getMonth() + months);
        return d.toISOString().slice(0, 10);
      }
      function show(msg) {
        toast.textContent = msg;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2400);
      }

      function enterSelectionMode(id) {
        state.selectionMode = true;
        state.selectedEntries.clear();
        state.selectedEntries.add(id);

        render();
      }

      function exitSelectionMode() {
        state.selectionMode = false;

        state.selectedEntries.clear();

        render();
      }

      function toggleSelection(id) {
        if (state.selectedEntries.has(id)) {
          state.selectedEntries.delete(id);
        } else {
          state.selectedEntries.add(id);
        }

        if (state.selectedEntries.size === 0) {
          exitSelectionMode();
          return;
        }

        render();
      }

      function openContextMenu(button, id) {
        const isSameOpenEntry =
          state.activeEntry === id && !contextMenu.classList.contains("hidden");
        if (isSameOpenEntry) {
          closeContextMenu();
          return;
        }

        state.activeEntry = id;
        const rect = button.getBoundingClientRect();
        const viewportMargin = 8;
        const menuGap = 6;

        // Exibe de forma invisível para medir o tamanho real antes de posicionar.
        contextMenu.style.visibility = "hidden";
        contextMenu.classList.remove("hidden");
        const menuRect = contextMenu.getBoundingClientRect();
        const maxLeft = Math.max(
          viewportMargin,
          window.innerWidth - menuRect.width - viewportMargin,
        );
        const left = Math.max(
          viewportMargin,
          Math.min(rect.right - menuRect.width, maxLeft),
        );
        const fitsBelow =
          rect.bottom + menuGap + menuRect.height + viewportMargin <=
          window.innerHeight;
        const preferredTop = fitsBelow
          ? rect.bottom + menuGap
          : rect.top - menuRect.height - menuGap;
        const maxTop = Math.max(
          viewportMargin,
          window.innerHeight - menuRect.height - viewportMargin,
        );
        const top = Math.max(
          viewportMargin,
          Math.min(preferredTop, maxTop),
        );

        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
        contextMenu.style.visibility = "";
      }

      function closeContextMenu() {
        contextMenu.classList.add("hidden");
        contextMenu.style.visibility = "";
      }

      function handleMenuAction(action) {
        closeContextMenu();
        switch (action) {
          case "edit":
            editEntry();
            break;
          case "delete":
            deleteEntry();
            break;
        }
      }

      function getActiveEntry() {
        return state.entries.find((e) => e.id === state.activeEntry);
      }

      function editEntry() {
        const entry = getActiveEntry();
        if (!entry) return;
        state.editingId = entry.id;
        modalTitle.textContent = "Editar lançamento";
        fillForm(entry);
        dialog.showModal();
      }

      function generateId() {
        return crypto.randomUUID
          ? crypto.randomUUID()
          : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
              const random = (Math.random() * 16) | 0;
              const value = c === "x" ? random : (random & 0x3) | 0x8;
              return value.toString(16);
            });
      }

      function normalizeEntryIds() {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const replacements = new Map();
        const usedIds = new Set();

        for (const entry of state.entries) {
          if (uuidPattern.test(entry.id) && !usedIds.has(entry.id)) {
            usedIds.add(entry.id);
            continue;
          }
          const previousId = entry.id;
          let nextId = generateId();
          while (usedIds.has(nextId)) nextId = generateId();
          entry.id = nextId;
          usedIds.add(nextId);
          replacements.set(previousId, nextId);
        }

        if (!replacements.size) return;
        state.selectedEntries = new Set(
          [...state.selectedEntries].map((id) => replacements.get(id) || id),
        );
        state.deletedEntryIds = new Set(
          [...state.deletedEntryIds].map((id) => replacements.get(id) || id),
        );
        state.syncQueue = state.syncQueue.map((operation) =>
          operation.type === "upsert"
            ? { ...operation, entry: { ...operation.entry, id: replacements.get(operation.entry.id) || operation.entry.id } }
            : { ...operation, id: replacements.get(operation.id) || operation.id },
        );
        state.activeEntry = replacements.get(state.activeEntry) || state.activeEntry;
        state.editingId = replacements.get(state.editingId) || state.editingId;
        saveLocal();
      }

      function updateEntry(entry) {
        const index = state.entries.findIndex((e) => e.id === state.editingId);
        if (index < 0) return false;
        state.entries[index] = {
          ...state.entries[index],
          ...entry,
        };
        queueUpsert(state.entries[index]);
        state.editingId = null;
        return true;
      }

      function recurrenceSeriesFromForm(id, startDate) {
        return {
          id,
          flow_type: flowType.value,
          frequency: recurrence.value,
          interval_value: Math.max(1, Number(recurrenceInterval.value) || 1),
          custom_unit: recurrence.value === "custom" ? customUnit.value : null,
          weekdays: [],
          start_date: startDate,
          end_mode: endMode.value,
          end_date: endMode.value === "on_date" ? endDate.value : null,
          occurrence_count: endMode.value === "after_occurrences"
            ? Math.max(1, Number(occurrenceCount.value) || 1)
            : null,
          business_day_adjustment: businessDayAdjustment.value,
          value: Number(valueInput.value),
          type: type.value,
          description: desc.value,
          detail: detailInput.value.trim(),
          active: true,
        };
      }

      async function createRecurringSeries() {
        const series = recurrenceSeriesFromForm(generateId(), dateInput.value);
        const saved = await repository.upsertRecurrenceSeries(series, state.user.id);
        series.updated_at = saved.updated_at;
        state.recurrenceSeries.push(series);
        await materializeRecurrenceSeries(series);
      }

      async function removeGeneratedSeriesEntries(seriesId, fromScheduledDate = null) {
        await repository.deleteGeneratedEntries(seriesId, state.user.id, fromScheduledDate);
        state.entries = state.entries.filter((entry) => {
          if (entry.series_id !== seriesId || entry.detached_from_series) return true;
          return fromScheduledDate && entry.scheduled_date < fromScheduledDate;
        });
      }

      async function editRecurringSeries(entry) {
        const original = state.recurrenceSeries.find((series) => series.id === entry.series_id);
        if (!original || editScope.value === "this") {
          return updateEntry({
            date: dateInput.value,
            value: Number(valueInput.value),
            flow_type: flowType.value,
            type: type.value,
            description: desc.value,
            detail: detailInput.value.trim(),
            paid: paidInput.checked,
            detached_from_series: true,
          });
        }

        const cutDate = entry.scheduled_date || entry.date;
        if (editScope.value === "future" && cutDate > original.start_date) {
          const shortened = {
            ...original,
            end_mode: "on_date",
            end_date: domain.addDays(cutDate, -1),
            occurrence_count: null,
          };
          const shortenedSaved = await repository.upsertRecurrenceSeries(shortened, state.user.id);
          shortened.updated_at = shortenedSaved.updated_at;
          const originalIndex = state.recurrenceSeries.findIndex((series) => series.id === original.id);
          state.recurrenceSeries[originalIndex] = shortened;
          await removeGeneratedSeriesEntries(original.id, cutDate);

          const nextSeries = recurrenceSeriesFromForm(generateId(), dateInput.value);
          const saved = await repository.upsertRecurrenceSeries(nextSeries, state.user.id);
          nextSeries.updated_at = saved.updated_at;
          state.recurrenceSeries.push(nextSeries);
          await materializeRecurrenceSeries(nextSeries);
          return true;
        }

        const updated = {
          ...original,
          ...recurrenceSeriesFromForm(original.id, original.start_date),
          start_date: original.start_date,
        };
        const saved = await repository.upsertRecurrenceSeries(updated, state.user.id);
        updated.updated_at = saved.updated_at;
        const index = state.recurrenceSeries.findIndex((series) => series.id === original.id);
        state.recurrenceSeries[index] = updated;
        await removeGeneratedSeriesEntries(original.id);
        await materializeRecurrenceSeries(updated);
        return true;
      }

      function createEntry(entry) {
        const createdAt = new Date().toISOString();
        if (recurrence.value === "single") {
          const created = {
            id: generateId(),
            created_at: createdAt,
            ...entry,
            flow_type: entry.flow_type || "expense",
            series_id: null,
            scheduled_date: null,
            detached_from_series: false,
            excluded_from_series: false,
          };
          state.entries.push(created);
          queueUpsert(created);
          return;
        }
        const qty = Math.max(2, Number(installments.value));
        const installmentValue = Math.floor((entry.value / qty) * 100) / 100;
        let remaining = entry.value;
        for (let i = 0; i < qty; i++) {
          const value =
            i === qty - 1 ? Number(remaining.toFixed(2)) : installmentValue;
          remaining -= value;
          const created = {
            id: generateId(),
            created_at: createdAt,
            ...entry,
            flow_type: "expense",
            series_id: null,
            scheduled_date: null,
            detached_from_series: false,
            excluded_from_series: false,
            date: addMonths(entry.date, i),
            value,
            paid: false,
            installment: {
              current: i + 1,
              total: qty,
              original: entry.value,
            },
          };
          state.entries.push(created);
          queueUpsert(created);
        }
      }

      function toggleEntryStatus() {
        const entry = getActiveEntry();
        if (!entry) return;
        entry.paid = !entry.paid;
        queueUpsert(entry);
        closeContextMenu();
        save();
        render();
        const isIncome = (entry.flow_type || "expense") === "income";
        show(
          entry.paid
            ? (isIncome ? "Receita marcada como recebida." : "Lançamento marcado como pago.")
            : (isIncome ? "Receita marcada como a receber." : "Lançamento marcado como pendente."),
        );
      }

      function deleteEntry() {
        const entry = getActiveEntry();
        if (!entry) return;
        if (entry.series_id) {
          closeContextMenu();
          seriesScopeDialog.showModal();
          return;
        }
        if (!confirm("Deseja realmente excluir este lançamento?")) return;
        state.entries = state.entries.filter((e) => e.id !== entry.id);
        queueDelete(entry.id, entry.updated_at);
        closeContextMenu();
        save();
        render();
        show("Lançamento excluído.");
      }

      async function deleteRecurringScope(scope) {
        const entry = getActiveEntry();
        if (!entry?.series_id) return;
        const series = state.recurrenceSeries.find((item) => item.id === entry.series_id);
        const cutDate = entry.scheduled_date || entry.date;
        if (scope === "this") {
          entry.detached_from_series = true;
          entry.excluded_from_series = true;
          queueUpsert(entry);
          if (!await save()) throw new Error("Não foi possível sincronizar a exclusão da ocorrência.");
        } else if (scope === "future" && series && cutDate > series.start_date) {
          const shortened = {
            ...series,
            end_mode: "on_date",
            end_date: domain.addDays(cutDate, -1),
            occurrence_count: null,
          };
          const saved = await repository.upsertRecurrenceSeries(shortened, state.user.id);
          shortened.updated_at = saved.updated_at;
          const index = state.recurrenceSeries.findIndex((item) => item.id === series.id);
          state.recurrenceSeries[index] = shortened;
          await repository.deleteSeriesEntries(series.id, state.user.id, cutDate);
          state.entries = state.entries.filter(
            (item) => item.series_id !== series.id || item.scheduled_date < cutDate,
          );
        } else {
          await repository.deleteSeriesEntries(entry.series_id, state.user.id);
          await repository.deleteRecurrenceSeries(entry.series_id, state.user.id);
          state.entries = state.entries.filter((item) => item.series_id !== entry.series_id);
          state.recurrenceSeries = state.recurrenceSeries.filter((item) => item.id !== entry.series_id);
        }
        seriesScopeDialog.close();
        render();
        show(scope === "this" ? "Ocorrência excluída." : scope === "future" ? "Esta e as próximas ocorrências foram excluídas." : "Série recorrente excluída.");
      }

      function deleteSelectedEntries() {
        const total = state.selectedEntries.size;

        if (total === 0) {
          exitSelectionMode();
          return;
        }

        if (
          !confirm(
            `Deseja realmente excluir ${total} lançamento${total > 1 ? "s" : ""}?`,
          )
        ) {
          return;
        }

        const deletedEntries = state.entries.filter(
          (entry) => state.selectedEntries.has(entry.id),
        );
        state.entries = state.entries.filter(
          (entry) => !state.selectedEntries.has(entry.id) || Boolean(entry.series_id),
        );
        deletedEntries.forEach((entry) => {
          if (entry.series_id) {
            entry.detached_from_series = true;
            entry.excluded_from_series = true;
            queueUpsert(entry);
          } else {
            queueDelete(entry.id, entry.updated_at);
          }
        });

        save();

        exitSelectionMode();

        show(
          `${total} lançamento${total > 1 ? "s" : ""} excluído${total > 1 ? "s" : ""}.`,
        );
      }
      function fillForm(entry) {
        const series = entry.series_id
          ? state.recurrenceSeries.find((item) => item.id === entry.series_id)
          : null;
        dateInput.value = entry.date;
        valueInput.value = entry.value;
        flowType.value = entry.flow_type || "expense";
        type.value = entry.type;
        desc.value = entry.description;
        detailInput.value = entry.detail;
        paidInput.checked = entry.paid;
        recurrence.value = series?.frequency || (entry.installment ? "installments" : "single");
        installments.value = entry.installment?.total ?? 2;
        recurrenceInterval.value = series?.interval_value ?? 1;
        customUnit.value = series?.custom_unit || "day";
        endMode.value = series?.end_mode || "never";
        endDate.value = series?.end_date || "";
        occurrenceCount.value = series?.occurrence_count || 12;
        businessDayAdjustment.value = series?.business_day_adjustment || "none";
        editScopeField.hidden = !series;
        editScope.value = "this";
        updateEntryFormVisibility();
      }

      openModal.onclick = openNew;
      openModalMobile.onclick = openNew;
      openSettings.onclick = openSettingsDialog;
      document
        .querySelectorAll("[data-close]")
        .forEach((b) => (b.onclick = () => dialog.close()));
      document
        .querySelectorAll("[data-close-settings]")
        .forEach((b) => (b.onclick = () => settingsDialog.close()));
      document
        .querySelectorAll("[data-close-series-scope]")
        .forEach((button) => (button.onclick = () => seriesScopeDialog.close()));
      document
        .querySelectorAll("[data-close-bulk-date]")
        .forEach((button) => (button.onclick = () => bulkDateDialog.close()));
      bulkDateForm.onsubmit = async (event) => {
        event.preventDefault();
        if (!bulkDateForm.reportValidity()) return;
        saveBulkDate.disabled = true;
        saveBulkDate.setAttribute("aria-busy", "true");
        saveBulkDate.textContent = "Alterando…";
        try {
          await changeSelectedDate(bulkDateInput.value);
        } finally {
          saveBulkDate.disabled = false;
          saveBulkDate.removeAttribute("aria-busy");
          saveBulkDate.textContent = "Alterar data";
        }
      };
      seriesScopeDialog.onclick = async (event) => {
        const button = event.target.closest("[data-series-delete-scope]");
        if (!button) return;
        const buttons = [...seriesScopeDialog.querySelectorAll("button")];
        buttons.forEach((item) => { item.disabled = true; });
        button.setAttribute("aria-busy", "true");
        try {
          await deleteRecurringScope(button.dataset.seriesDeleteScope);
        } catch (error) {
          console.error(error);
          show("Não foi possível excluir a recorrência.");
        } finally {
          buttons.forEach((item) => { item.disabled = false; });
          button.removeAttribute("aria-busy");
        }
      };
      type.onchange = (e) => addOption(e, "types", type);
      desc.onchange = (e) => addOption(e, "descriptions", desc);
      [flowType, recurrence, recurrenceInterval, customUnit, endMode, endDate, occurrenceCount, businessDayAdjustment]
        .forEach((control) => {
          control.onchange = updateEntryFormVisibility;
          control.oninput = updateEntryFormVisibility;
        });

      [filterMonth, filterType, filterStatus].forEach((control) => {
        control.onchange = () => {
          if (control === filterMonth) state.filterDate = null;
          state.selectedEntries.clear();
          state.selectionMode = false;
          render();
        };
      });

      function changeCalendarMonth(offset) {
        const [year, month] = filterMonth.value.split("-").map(Number);
        const next = new Date(year, month - 1 + offset, 1, 12);
        filterMonth.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
        state.selectedEntries.clear();
        state.selectionMode = false;
        render();
      }

      previousMonth.onclick = () => changeCalendarMonth(-1);
      nextMonth.onclick = () => changeCalendarMonth(1);

      contextMenu.onclick = (e) => {
        const button = e.target.closest("[data-action]");
        if (!button) return;
        handleMenuAction(button.dataset.action);
      };

      document.addEventListener("pointerdown", (event) => {
        if (contextMenu.classList.contains("hidden")) return;
        if (contextMenu.contains(event.target)) return;
        if (event.target.closest(".entry-menu")) return;
        closeContextMenu();
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeContextMenu();
      });

      window.addEventListener("resize", () => {
        closeContextMenu();
        if (filterMonth.value) renderForecast(filterMonth.value);
      });
      window.addEventListener("scroll", closeContextMenu, true);

      calendarGrid.onclick = (event) => {
        const day = event.target.closest("[data-calendar-date]");
        if (!day) return;
        state.selectedCalendarDate = day.dataset.calendarDate;
        state.filterDate = day.dataset.calendarDate;
        state.selectedEntries.clear();
        state.selectionMode = false;
        render();
      };

      clearDateFilter.onclick = () => {
        state.filterDate = null;
        render();
      };

      toggleCalendar.onclick = () => {
        state.calendarExpanded = !state.calendarExpanded;
        renderCalendar();
      };

      settingsForm.onsubmit = async (event) => {
        event.preventDefault();
        state.settings = {
          current_balance: Number(currentBalanceInput.value),
          balance_reference_date: balanceReferenceDateInput.value,
          income_day_15: Number(incomeDay15Input.value),
          income_last_business_day: Number(incomeLastBusinessDayInput.value),
        };
        state.settingsDirty = true;
        const synced = await save();
        if (!synced) return;
        settingsDialog.close();
        render();
        show("Configurações financeiras sincronizadas.");
      };

      let pressTimer = null;
      let longPressEntryId = null;
      let pressPointerId = null;
      let pressStartX = 0;
      let pressStartY = 0;
      const longPressMoveTolerance = 12;

      function cancelLongPress() {
        clearTimeout(pressTimer);
        pressTimer = null;
        pressPointerId = null;
      }

      rows.addEventListener("pointerdown", (e) => {
        const card = e.target.closest("[data-entry]");

        if (!card) return;

        if (!e.isPrimary || e.button !== 0) return;

        if (e.target.closest(".entry-menu")) return;

        if (e.target.closest(".status-button")) return;

        if (state.selectionMode) return;

        cancelLongPress();
        longPressEntryId = null;
        pressPointerId = e.pointerId;
        pressStartX = e.clientX;
        pressStartY = e.clientY;

        pressTimer = setTimeout(() => {
          pressTimer = null;
          pressPointerId = null;
          longPressEntryId = card.dataset.entry;
          enterSelectionMode(longPressEntryId);
        }, 500);
      });

      rows.addEventListener("pointermove", (e) => {
        if (pressTimer === null || e.pointerId !== pressPointerId) return;
        const distance = Math.hypot(
          e.clientX - pressStartX,
          e.clientY - pressStartY,
        );
        if (distance > longPressMoveTolerance) cancelLongPress();
      });

      rows.addEventListener("pointerup", (e) => {
        if (e.pointerId === pressPointerId) cancelLongPress();
      });

      rows.addEventListener("pointerleave", (e) => {
        if (e.pointerId === pressPointerId) cancelLongPress();
      });

      rows.addEventListener("pointercancel", (e) => {
        if (e.pointerId === pressPointerId) cancelLongPress();
      });

      rows.addEventListener("click", (e) => {
        const card = e.target.closest("[data-entry]");

        if (!card) return;

        if (longPressEntryId === card.dataset.entry) {
          longPressEntryId = null;
          e.preventDefault();
          return;
        }

        longPressEntryId = null;

        if (state.selectionMode) {
          toggleSelection(card.dataset.entry);

          return;
        }

        const status = e.target.closest("[data-toggle-status]");

        if (status) {
          state.activeEntry = status.dataset.toggleStatus;

          toggleEntryStatus();

          return;
        }

        const menu = e.target.closest("[data-edit]");

        if (menu) {
          openContextMenu(menu, menu.dataset.edit);
          return;
        }

      });

      form.onsubmit = async (e) => {
        e.preventDefault();

        const editing = !!state.editingId;
        const editingEntry = state.entries.find((entry) => entry.id === state.editingId);

        const date = dateInput.value;
        const totalValue = Number(valueInput.value);
        const detail = detailInput.value.trim();
        const paid = paidInput.checked;

        valueInput.setCustomValidity(
          totalValue === 0 || ((isRecurringValue() || flowType.value === "income") && totalValue < 0)
            ? "Informe um valor maior que zero."
            : "",
        );
        endDate.setCustomValidity(
          isRecurringValue() && endMode.value === "on_date" && endDate.value < date
            ? "A data final deve ser igual ou posterior à data inicial."
            : "",
        );
        if (!form.reportValidity()) return;

        const entry = {
          date,
          value: totalValue,
          flow_type: flowType.value,
          type: type.value,
          description: desc.value,
          detail,
          paid,
        };

        saveEntry.disabled = true;
        saveEntry.setAttribute("aria-busy", "true");
        saveEntry.textContent = "Salvando…";
        try {
          if (editing && editingEntry?.series_id) {
            if (!await editRecurringSeries(editingEntry)) return;
            state.editingId = null;
          } else if (editing && isRecurringValue()) {
            state.entries = state.entries.filter((item) => item.id !== editingEntry.id);
            queueDelete(editingEntry.id, editingEntry.updated_at);
            await createRecurringSeries();
            state.editingId = null;
          } else if (editing) {
            if (!updateEntry(entry)) return;
          } else if (isRecurringValue()) {
            await createRecurringSeries();
          } else {
            createEntry(entry);
          }

          const synced = await save();
          dialog.close();
          render();
          show(
            synced
              ? editing
                ? "Lançamento atualizado e sincronizado."
                : isRecurringValue()
                  ? "Recorrência criada e sincronizada."
                  : "Lançamento salvo e sincronizado."
              : "Lançamento aguardando sincronização. Não feche esta página.",
          );
        } catch (error) {
          console.error(error);
          show("Não foi possível salvar a recorrência. Tente novamente.");
        } finally {
          saveEntry.disabled = false;
          saveEntry.removeAttribute("aria-busy");
          saveEntry.textContent = "Salvar lançamento";
        }
      };

      async function startApp() {
        localStore.clearLegacyCache();
        const previewHosts = new Set(["localhost", "127.0.0.1", "terminal.local"]);
        const isLocalPreview = previewHosts.has(window.location.hostname) && new URLSearchParams(window.location.search).has("preview");
        if (isLocalPreview) {
          const previewEntries = [
            { id: "10000000-0000-4000-8000-000000000001", date: todayISO(), value: 180, type: "ALIMENTAÇÃO", description: "Supermercado", detail: "Alimentação", paid: false, flow_type: "expense", created_at: new Date().toISOString() },
            { id: "10000000-0000-4000-8000-000000000002", date: todayISO(), value: 10000, type: "TRABALHO", description: "Salário", detail: "Receita", paid: true, flow_type: "income", created_at: new Date().toISOString() },
            { id: "10000000-0000-4000-8000-000000000003", date: domain.addDays(todayISO(), 1), value: 2200, type: "MORADIA", description: "Aluguel", detail: "Moradia", paid: false, flow_type: "expense", created_at: new Date().toISOString() },
            { id: "10000000-0000-4000-8000-000000000004", date: domain.addDays(todayISO(), 1), value: 89.9, type: "SERVIÇOS", description: "Plano de celular", detail: "Serviços", paid: false, flow_type: "expense", created_at: new Date().toISOString() },
            { id: "10000000-0000-4000-8000-000000000005", date: domain.addDays(todayISO(), 2), value: 500, type: "TRABALHO", description: "Freelance", detail: "Receita", paid: false, flow_type: "income", created_at: new Date().toISOString() },
            { id: "10000000-0000-4000-8000-000000000006", date: domain.addDays(todayISO(), 2), value: 100, type: "TRANSPORTE", description: "Combustível", detail: "Transporte", paid: false, flow_type: "expense", created_at: new Date().toISOString() },
          ];
          state.user = { id: "preview", email: "preview@local", user_metadata: { full_name: "Prévia" } };
          state.entries = previewEntries;
          state.settings = { current_balance: 10000, balance_reference_date: todayISO(), income_day_15: 0, income_last_business_day: 0 };
          updateAuthArea();
          render();
          setSyncStatus("synced", "Prévia local");
          return;
        }
        render();
        await initializeAuth();
      }

      startApp();
