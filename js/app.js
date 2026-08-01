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
      );
      const domain = window.MGDomain;
      const localStore = window.MGLocalStore;
      const repository = window.MGSupabaseRepository.create(supabaseClient);

      const state = {
        types: defaultTypes,

        descriptions: defaultDescriptions,

        entries: [],

        settings: {
            current_balance: 10000,
            balance_reference_date: todayISO(),
            income_day_15: 9365.96,
            income_last_business_day: 8011.84,
          },

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
        type = document.querySelector("#type"),
        desc = document.querySelector("#description"),
        recurrence = document.querySelector("#recurrence"),
        installments = document.querySelector("#installments"),
        installmentsField = document.querySelector("#installmentsField"),
        filterType = document.querySelector("#filterType"),
        filterMonth = document.querySelector("#filterMonth"),
        filterStatus = document.querySelector("#filterStatus"),
        monthTotal = document.querySelector("#monthTotal"),
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
        selectedDateLabel = document.querySelector("#selectedDateLabel"),
        selectedBalance = document.querySelector("#selectedBalance"),
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

        if (e.target.closest("#markPaidSelection")) {
          markSelectedAsPaid();
          return;
        }

        if (e.target.closest("#markPendingSelection")) {
          markSelectedAsPending();
          return;
        }
      };

      function storageKey(name, userId = state.user?.id) {
        return localStore.key(name, userId);
      }

      function readLocal(name, fallback) {
        return localStore.read(name, state.user?.id, fallback);
      }

      function saveLocal() {
        localStore.save(state.user?.id, state);
      }

      function clearLocalForUser(userId) {
        localStore.clear(userId);
      }

      function clearSessionState() {
        state.user = null;
        state.entries = [];
        state.syncQueue = [];
        state.deletedEntryIds = new Set();
        state.types = defaultTypes;
        state.descriptions = defaultDescriptions;
        state.settings = {
          current_balance: 10000,
          balance_reference_date: todayISO(),
          income_day_15: 9365.96,
          income_last_business_day: 8011.84,
        };
      }

      function loadLocalForUser(userId) {
        state.types = readLocal("types", defaultTypes);
        state.descriptions = readLocal("desc", defaultDescriptions);
        state.entries = readLocal("entries", []);
        state.settings = readLocal("settings", {
          current_balance: 10000,
          balance_reference_date: todayISO(),
          income_day_15: 9365.96,
          income_last_business_day: 8011.84,
        });
        state.syncQueue = readLocal("sync-queue", []);

        const legacyUserId = localStorage.getItem("mg-user-id");
        if (!state.entries.length && (!legacyUserId || legacyUserId === userId)) {
          try {
            const legacyEntries = JSON.parse(localStorage.getItem("mg-entries") || "[]");
            if (legacyEntries.length) {
              state.entries = legacyEntries;
              state.types = JSON.parse(localStorage.getItem("mg-types") || "null") || defaultTypes;
              state.descriptions = JSON.parse(localStorage.getItem("mg-desc") || "null") || defaultDescriptions;
              state.settings = JSON.parse(localStorage.getItem("mg-settings") || "null") || state.settings;
              state.syncQueue = legacyEntries.map((entry) => ({ type: "upsert", entry }));
              saveLocal();
              ["mg-types", "mg-desc", "mg-entries", "mg-settings", "mg-user-id"].forEach((key) =>
                localStorage.removeItem(key),
              );
            }
          } catch (error) {
            console.warn("Não foi possível migrar o cache anterior.", error);
          }
        }
        state.deletedEntryIds = new Set(
          state.syncQueue.filter((operation) => operation.type === "delete").map((operation) => operation.id),
        );
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
          await syncSettings();
          setSyncStatus("synced", "Alterações sincronizadas");
          return true;
        } catch (error) {
          console.error(error);
          setSyncStatus("pending", "Sincronização pendente");
          show(
            "Alteração salva neste aparelho. A sincronização será tentada novamente.",
          );
          return false;
        }
      }

      function updateAuthArea() {
        authScreen.hidden = !!state.user;
        appShell.hidden = !state.user;
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

        if (data.length) {
          state.entries = data;
          state.types = [
            ...new Set([...state.types, ...data.map((entry) => entry.type)]),
          ].sort();
          state.descriptions = [
            ...new Set([
              ...state.descriptions,
              ...data.map((entry) => entry.description),
            ]),
          ].sort();
          saveLocal();
          render();
          show("Lançamentos sincronizados.");
          return;
        }

        if (state.entries.length) {
          state.entries.forEach(queueUpsert);
          await syncEntries();
          show("Lançamentos deste aparelho foram enviados para sua conta.");
        }
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
        } else {
          await syncSettings();
        }
        saveLocal();
        render();
      }
      async function setCurrentUser(user) {
        if (state.user?.id === user?.id) return;
        state.user = user || null;
        if (state.user) loadLocalForUser(state.user.id);
        updateAuthArea();
        if (state.user) {
          normalizeEntryIds();
          await syncEntries();
          await loadCloudEntries();
          await loadCloudSettings();
          setSyncStatus("synced", "Dados sincronizados");
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
        const userId = state.user?.id;
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
          show(`Não foi possível sair: ${error.message}`);
          return;
        }
        if (userId) clearLocalForUser(userId);
        clearSessionState();
        updateAuthArea();
        setSyncStatus("idle", "Entre para sincronizar");
        show("Sessão encerrada.");
      }

      async function initializeAuth() {
        updateAuthArea();
        supabaseClient.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_OUT") {
            if (state.user?.id) clearLocalForUser(state.user.id);
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
        loadCloudEntries().catch((error) => console.error(error));
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
      function renderEntry(e) {
        return `
      <div
        class="entry ${state.selectedEntries.has(e.id) ? "selected" : ""}"
        data-entry="${e.id}">
          <div class="entry-date">
              <span class="entry-day">
                  ${formatDay(e.date)}
              </span>
              <span class="entry-month">
                  ${formatMonth(e.date)}
              </span>
          </div>
          <div class="entry-content">
              <div class="entry-header">
                  <div class="entry-title">
                      <span
                          class="entry-dot"
                          style="background:${categoryColor(e.type)}">
                      </span>
                      ${esc(e.type)}
                  </div>
                  <div class="entry-value">
                      ${money(e.value)}
                  </div>
              </div>
              <div class="entry-description">
                ${esc(e.description)}
                ${e.detail ? ` - ${esc(e.detail)}` : ""}
              </div>
              <div class="entry-footer">
                  <div class="entry-meta">
                      ${
                        state.selectionMode
                          ? ""
                          : `
                      <button
                          class="status-button ${e.paid ? "paid" : "pending"}"
                          data-toggle-status="${e.id}">
                          ${e.paid ? "✔ Pago" : "○ Em aberto"}
                      </button>
                      `
                      }

                      ${
                        e.installment
                          ? `<span>${e.installment.current}/${e.installment.total}</span>`
                          : ""
                      }
                  </div>
                  ${
                    state.selectionMode
                      ? ""
                      : `
                  <button
                      class="entry-menu"
                      data-edit="${e.id}">
                      ⋮
                  </button>
                  `
                  }
              </div>
          </div>
      </div>
      `;
      }

      function updateSummary(entries) {
        monthTotal.textContent = money(
          entries.reduce((a, e) => a + e.value, 0),
        );

        paidTotal.textContent = money(
          entries.filter((e) => e.paid).reduce((a, e) => a + e.value, 0),
        );

        pendingTotal.textContent = money(
          entries.filter((e) => !e.paid).reduce((a, e) => a + e.value, 0),
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
        return state.entries.filter((e) => e.date.slice(0, 7) === month);
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

      function addDays(date, days) {
        return domain.addDays(date, days);
      }

      function lastBusinessDay(year, monthIndex) {
        return domain.lastBusinessDay(year, monthIndex);
      }

      function getRecurringIncome(date) {
        return domain.recurringIncome(date, state.settings);
      }

      function buildDailyEntryTotals() {
        return domain.dailyEntryTotals(state.entries);
      }

      function getDailyNet(date, entryTotals) {
        return getRecurringIncome(date) - (entryTotals.get(date) || 0);
      }

      function getProjectedBalance(date, entryTotals) {
        return domain.projectedBalance(date, state.settings, entryTotals);
      }
      function renderCalendar() {
        const month = filterMonth.value;
        if (!month) return;
        const [year, monthNumber] = month.split("-").map(Number);
        const monthIndex = monthNumber - 1;
        const firstDay = new Date(year, monthIndex, 1, 12);
        const daysInMonth = new Date(year, monthNumber, 0).getDate();
        const entryTotals = buildDailyEntryTotals();

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
          const income = getRecurringIncome(date);
          const projected = getProjectedBalance(date, entryTotals);
          cells.push(`
            <button class="calendar-day ${date === state.selectedCalendarDate ? "selected" : ""} ${income ? "has-income" : ""} ${costs ? "has-cost" : ""} ${projected < 0 ? "balance-negative" : "balance-positive"}" data-calendar-date="${date}" type="button">
              <span class="calendar-date">${day}</span>
              ${income ? `<span class="calendar-income">+ ${calendarMoney(income)}</span>` : ""}
              ${costs ? `<span class="calendar-cost">Gastos ${calendarMoney(costs)}</span>` : ""}
              <span class="calendar-projection">${calendarMoney(projected)}</span>
            </button>
          `);
        }
        calendarGrid.innerHTML = cells.join("");

        const selected = state.selectedCalendarDate;
        selectedDateLabel.textContent = `Saldo em ${new Date(`${selected}T12:00`).toLocaleDateString("pt-BR")}`;
        selectedBalance.textContent = calendarMoney(getProjectedBalance(selected, entryTotals));
        calendarPanel.classList.toggle("compact", !state.calendarExpanded);
        toggleCalendar.setAttribute("aria-expanded", String(state.calendarExpanded));
        toggleCalendar.textContent = state.calendarExpanded
          ? "Ocultar calendário"
          : "Ver calendário completo";
      }

      function updateCount(entries) {
        count.textContent = `${entries.length} lançamento${entries.length === 1 ? "" : "s"}`;
      }

      function renderEntries(entries) {
        rows.innerHTML = entries.length
          ? entries.map(renderEntry).join("")
          : '<div class="empty">Nenhum lançamento encontrado.</div>';
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

        updateSummary(monthly);
        currentBalanceTotal.textContent = money(
          getProjectedBalance(todayISO(), buildDailyEntryTotals()),
        );
        const referenceDate = state.settings.balance_reference_date || todayISO();
        balanceReferenceSummary.textContent = `Saldo informado em ${new Date(`${referenceDate}T12:00`).toLocaleDateString("pt-BR")}`;

        const list = getFilteredEntries(monthly, ft, fs);

        updateCount(list);
        filteredSubtotal.textContent = money(
          list.reduce((total, entry) => total + Number(entry.value), 0),
        );

        renderEntries(list);
        renderCalendar();

        panelTitle.textContent = state.selectionMode
          ? `${state.selectedEntries.size} selecionado${state.selectedEntries.size > 1 ? "s" : ""}`
          : state.filterDate
            ? `Lançamentos de ${new Date(`${state.filterDate}T12:00`).toLocaleDateString("pt-BR")}`
            : "Lançamentos";

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
                                  title="Desmarcar todos">
                                  ☒
                              </button>
                          `
                    : `
                              <button
                                  id="selectAll"
                                  class="icon-button"
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
                          title="Marcar como pago">
                          ✔
                      </button>
                      `
                      : `
                      <button
                          id="markPendingSelection"
                          class="icon-button"
                          title="Marcar como pendente">
                          ↺
                      </button>
                      `
                  }

                  <button
                      id="deleteSelection"
                      class="icon-button"
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

      function openNew() {
        state.editingId = null;
        modalTitle.textContent = "Novo lançamento";
        form.reset();
        installmentsField.style.display = "none";
        recurrence.value = "single";
        installments.value = 2;
        dateInput.value = new Date().toISOString().slice(0, 10);
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
          if (!state[key].includes(clean)) state[key].push(clean);
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
        state.activeEntry = id;
        const rect = button.getBoundingClientRect();
        contextMenu.style.left = `${Math.min(rect.right - 220, window.innerWidth - 230)}px`;
        contextMenu.style.top = `${rect.bottom + 6}px`;
        contextMenu.classList.remove("hidden");
      }

      function closeContextMenu() {
        contextMenu.classList.add("hidden");
      }

      function handleMenuAction(action) {
        closeContextMenu();
        switch (action) {
          case "edit":
            editEntry();
            break;
          case "toggle-status":
            toggleEntryStatus();
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

      function createEntry(entry) {
        const createdAt = new Date().toISOString();
        if (recurrence.value === "single") {
          const created = {
            id: generateId(),
            created_at: createdAt,
            ...entry,
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
        show(
          entry.paid
            ? "Lançamento marcado como pago."
            : "Lançamento marcado como pendente.",
        );
      }

      function deleteEntry() {
        const entry = getActiveEntry();
        if (!entry) return;
        if (!confirm("Deseja realmente excluir este lançamento?")) return;
        state.entries = state.entries.filter((e) => e.id !== entry.id);
        queueDelete(entry.id, entry.updated_at);
        closeContextMenu();
        save();
        render();
        show("Lançamento excluído.");
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
          (entry) => !state.selectedEntries.has(entry.id),
        );
        deletedEntries.forEach((entry) => queueDelete(entry.id, entry.updated_at));

        save();

        exitSelectionMode();

        show(
          `${total} lançamento${total > 1 ? "s" : ""} excluído${total > 1 ? "s" : ""}.`,
        );
      }
      function fillForm(entry) {
        dateInput.value = entry.date;
        valueInput.value = entry.value;
        type.value = entry.type;
        desc.value = entry.description;
        detailInput.value = entry.detail;
        paidInput.checked = entry.paid;
        recurrence.value = entry.installment ? "installments" : "single";
        installmentsField.style.display = entry.installment ? "" : "none";
        installments.value = entry.installment?.total ?? 2;
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
      type.onchange = (e) => addOption(e, "types", type);
      desc.onchange = (e) => addOption(e, "descriptions", desc);
      recurrence.onchange = () => {
        installmentsField.style.display =
          recurrence.value === "installments" ? "" : "none";
      };

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
        saveLocal();
        setSyncStatus("syncing", "Sincronizando configurações...");
        try {
          await syncSettings();
          setSyncStatus("synced", "Configurações sincronizadas");
          settingsDialog.close();
          render();
          show("Configurações financeiras sincronizadas.");
        } catch (error) {
          console.error(error);
          setSyncStatus("pending", "Sincronização pendente");
          show("Não foi possível sincronizar as configurações.");
        }
      };

      let pressTimer = null;
      let longPressTriggered = false;

      rows.addEventListener("pointerdown", (e) => {
        const card = e.target.closest("[data-entry]");

        if (!card) return;

        if (e.target.closest(".entry-menu")) return;

        if (e.target.closest(".status-button")) return;

        if (state.selectionMode) return;

        pressTimer = setTimeout(() => {
          longPressTriggered = true;

          enterSelectionMode(card.dataset.entry);
        }, 500);
      });

      rows.addEventListener("pointerup", () => {
        clearTimeout(pressTimer);
      });

      rows.addEventListener("pointerleave", () => {
        clearTimeout(pressTimer);
      });

      rows.addEventListener("pointercancel", () => {
        clearTimeout(pressTimer);
      });

      rows.addEventListener("click", (e) => {
        const card = e.target.closest("[data-entry]");

        if (!card) return;

        if (longPressTriggered) {
          longPressTriggered = false;
          e.preventDefault();
          return;
        }

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
        }
      });

      form.onsubmit = async (e) => {
        e.preventDefault();

        const editing = !!state.editingId;

        const date = dateInput.value;
        const totalValue = Number(valueInput.value);
        const detail = detailInput.value.trim();
        const paid = paidInput.checked;

        const entry = {
          date,
          value: totalValue,
          type: type.value,
          description: desc.value,
          detail,
          paid,
        };

        if (editing) {
          if (!updateEntry(entry)) return;
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
              : "Lançamento salvo e sincronizado."
            : "Lançamento salvo neste aparelho; sincronização pendente.",
        );
      };

      async function startApp() {
        render();
        await initializeAuth();
        window.MEUS_GASTOS_IMPORT?.then((entries) => {
          if (state.user || localStorage.getItem("mg-imported") === "1") return;
          state.entries = entries;
          state.types = [
            ...new Set([...state.types, ...entries.map((e) => e.type)]),
          ].sort();
          state.descriptions = [
            ...new Set([
              ...state.descriptions,
              ...entries.map((e) => e.description),
            ]),
          ].sort();
          localStorage.setItem("mg-imported", "1");
          save();
          render();
          show(`${entries.length} registros importados.`);
        }).catch(() =>
          show("Não foi possível carregar os registros importados."),
        );
      }

      startApp();
