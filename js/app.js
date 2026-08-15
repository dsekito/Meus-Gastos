const descriptionOptionsByType = {
        CASA: ["CONDOMINIO", "FRAN", "EMPRESTIMO", "FINANCIAMENTO", "GAS"],
        FIT: ["TICO", "CBD"],
        CARRO: ["IPVA"],
        MEL: ["OBJETIVO", "FESTA"],
        NUBANK: [
          "ASSINATURA", "BARBEARIA", "BEBIDAS", "BRUNA", "CARRO", "CASHBACK",
          "COMIDA", "FIT", "MEL", "PRESENTES", "RESTAURANTE", "ROUPAS", "SAUDE",
          "TEC", "VIAGEM",
        ],
        PERSON: [
          "ASSINATURA", "BARBEARIA", "BEBIDAS", "BRUNA", "CARRO", "CASHBACK",
          "COMIDA", "FIT", "MEL", "PRESENTES", "RESTAURANTE", "ROUPAS", "SAUDE",
          "TEC", "VIAGEM",
        ],
        TRABALHO: ["SALARIO"],
      };
      const defaultTypes = Object.keys(descriptionOptionsByType);
      const defaultDescriptions = [
        ...new Set(Object.values(descriptionOptionsByType).flat()),
      ].sort();

      const domain = window.MGDomain;
      const localStore = window.MGLocalStore;
      const googleAuth = window.MGGoogleAuth.create({
        clientId: window.MG_CONFIG?.googleClientId,
      });
      const repository = window.MGGoogleDriveRepository.create({
        getAccessToken: googleAuth.getAccessToken,
        isAccessTokenExpired: googleAuth.isAccessTokenExpired,
      });

      function createDefaultSettings() {
        return {
          current_balance: 10000,
          balance_reference_date: todayISO(),
        };
      }

      function normalizeSettings(settings = {}) {
        return {
          current_balance: Number(settings.current_balance ?? 10000),
          balance_reference_date: settings.balance_reference_date || todayISO(),
        };
      }

      const state = {
        types: [...defaultTypes],

        descriptions: [...defaultDescriptions],

        customDescriptionOptionsByType: {},

        hiddenTypes: [],

        hiddenDescriptionsByType: {},

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

        pendingStatusEntries: new Set(),

        recentlyChangedEntry: null,

        user: null,

        deletedEntryIds: new Set(),

        syncQueue: [],

        lastSyncedAt: null,

        syncConflict: null,
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
        balanceReferenceDateInput = document.querySelector("#balanceReferenceDate"),
        saveSettings = document.querySelector("#saveSettings"),
        downloadBackup = document.querySelector("#downloadBackup"),
        deleteTypeOption = document.querySelector("#deleteTypeOption"),
        deleteTypeOptionButton = document.querySelector("#deleteTypeOptionButton"),
        deleteDescriptionType = document.querySelector("#deleteDescriptionType"),
        deleteDescriptionOption = document.querySelector("#deleteDescriptionOption"),
        deleteDescriptionOptionButton = document.querySelector("#deleteDescriptionOptionButton"),
        openRecentRecords = document.querySelector("#openRecentRecords"),
        openRecentRecordsMain = document.querySelector("#openRecentRecordsMain"),
        openRecordsManager = document.querySelector("#openRecordsManager"),
        recordsManagerDialog = document.querySelector("#recordsManagerDialog"),
        recordsManagerList = document.querySelector("#recordsManagerList"),
        recordsManagerCount = document.querySelector("#recordsManagerCount"),
        managerFilterType = document.querySelector("#managerFilterType"),
        managerFilterDescription = document.querySelector("#managerFilterDescription"),
        managerFilterStatus = document.querySelector("#managerFilterStatus"),
        managerSelectAll = document.querySelector("#managerSelectAll"),
        managerMarkPaid = document.querySelector("#managerMarkPaid"),
        managerMarkPending = document.querySelector("#managerMarkPending"),
        managerBulkType = document.querySelector("#managerBulkType"),
        managerBulkDescription = document.querySelector("#managerBulkDescription"),
        managerApplyChanges = document.querySelector("#managerApplyChanges"),
        recentRecordsDialog = document.querySelector("#recentRecordsDialog"),
        recentRecordsList = document.querySelector("#recentRecordsList"),
        recentRecordsCount = document.querySelector("#recentRecordsCount"),
        loadMoreRecentRecords = document.querySelector("#loadMoreRecentRecords"),
        settingsSyncSummary = document.querySelector("#settingsSyncSummary"),
        bootstrapScreen = document.querySelector("#bootstrapScreen"),
        syncConflictDialog = document.querySelector("#syncConflictDialog"),
        useCloudVersion = document.querySelector("#useCloudVersion"),
        keepLocalVersion = document.querySelector("#keepLocalVersion"),
        previousMonth = document.querySelector("#previousMonth"),
        nextMonth = document.querySelector("#nextMonth"),
        seriesScopeDialog = document.querySelector("#seriesScopeDialog"),
        bulkDateDialog = document.querySelector("#bulkDateDialog"),
        bulkDateForm = document.querySelector("#bulkDateForm"),
        bulkDateInput = document.querySelector("#bulkDate"),
        saveBulkDate = document.querySelector("#saveBulkDate"),
        saveEntry = document.querySelector("#saveEntry"),
        syncStatus = document.querySelector("#syncStatus"),
        syncNotice = document.querySelector("#syncNotice"),
        syncNoticeTitle = document.querySelector("#syncNoticeTitle"),
        syncNoticeDetail = document.querySelector("#syncNoticeDetail"),
        syncNoticeAction = document.querySelector("#syncNoticeAction");

      let recentRecordsVisible = 10;
      let recentRecordsReturnToSettings = false;
      let returnToRecentAfterEdit = false;
      const managerSelectedEntries = new Set();

      function todayISO() {
        return domain.todayISO();
      }

      function formatDateInput(value) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, "0");
        const day = String(value.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      }

      function suggestedDateForType(selectedType) {
        const now = new Date();
        if (selectedType === "NUBANK") {
          const date = new Date(now.getFullYear(), now.getMonth() + 1, 1, 12);
          while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
          return formatDateInput(date);
        }
        if (selectedType === "PERSON") {
          return formatDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 20, 12));
        }
        return null;
      }

      function pendingSyncCount() {
        return state.syncQueue.length + (state.settingsDirty ? 1 : 0);
      }

      function formatLastSync() {
        if (!state.lastSyncedAt) return "Ainda não sincronizado neste dispositivo";
        const value = new Date(state.lastSyncedAt);
        if (Number.isNaN(value.getTime())) return "Última sincronização indisponível";
        const sameDay = value.toDateString() === new Date().toDateString();
        const time = value.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        return sameDay
          ? `Google Drive atualizado hoje às ${time}`
          : `Google Drive atualizado em ${value.toLocaleDateString("pt-BR")} às ${time}`;
      }

      function updateSettingsSyncSummary(stateName) {
        if (!settingsSyncSummary) return;
        const pending = pendingSyncCount();
        const pendingLabel = `${pending} alteração${pending === 1 ? "" : "ões"} aguardando envio`;
        const title = stateName === "conflict"
          ? "Conflito de sincronização"
          : pending > 0
            ? pendingLabel
            : "Dados protegidos";
        settingsSyncSummary.innerHTML = `<strong>${title}</strong>${formatLastSync()}. Os dados também ficam salvos neste dispositivo.`;
      }

      function setSyncStatus(stateName, message) {
        const pending = pendingSyncCount();
        const pendingLabel = `${pending} alteração${pending === 1 ? "" : "ões"} aguardando envio`;
        syncStatus.dataset.state = stateName;
        syncNotice.dataset.state = stateName;
        updateSettingsSyncSummary(stateName);

        if (stateName === "synced") {
          syncStatus.textContent = "Tudo sincronizado";
          syncStatus.setAttribute("aria-label", `${formatLastSync()}; tudo sincronizado`);
          syncNotice.hidden = false;
          syncNoticeAction.hidden = true;
          syncNoticeTitle.textContent = "Tudo sincronizado";
          syncNoticeDetail.textContent = `${formatLastSync()}. Seus dados também estão salvos neste dispositivo.`;
          return;
        }

        if (stateName === "idle") {
          syncStatus.textContent = message;
          syncStatus.setAttribute("aria-label", message);
          syncNotice.hidden = true;
          return;
        }

        syncNotice.hidden = false;
        syncNoticeAction.hidden = stateName === "syncing";

        if (stateName === "syncing") {
          syncStatus.textContent = "Sincronizando";
          syncStatus.setAttribute("aria-label", message);
          syncNoticeTitle.textContent = "Sincronizando com o Google Drive";
          syncNoticeDetail.textContent = pending > 0 ? `Enviando ${pendingLabel}.` : "Conferindo os dados deste dispositivo com o Google Drive.";
          return;
        }

        if (stateName === "conflict") {
          syncStatus.textContent = "Conflito de sincronização";
          syncStatus.setAttribute("aria-label", "Conflito de sincronização precisa ser resolvido");
          syncNoticeTitle.textContent = "Alterações em dois dispositivos";
          syncNoticeDetail.textContent = "Escolha qual versão deve ser mantida antes de continuar a sincronização.";
          syncNoticeAction.hidden = false;
          syncNoticeAction.textContent = "Resolver conflito";
          return;
        }

        if (!navigator.onLine) {
          syncStatus.textContent = "Sem conexão";
          syncStatus.setAttribute("aria-label", "Sem conexão com a internet");
          syncNoticeTitle.textContent = "Sem conexão com a internet";
          syncNoticeDetail.textContent = pending > 0
            ? `${pendingLabel.charAt(0).toUpperCase() + pendingLabel.slice(1)}. Tudo continua salvo neste dispositivo.`
            : "Seus dados estão disponíveis neste dispositivo. A conexão será verificada automaticamente quando voltar.";
          syncNoticeAction.hidden = true;
          return;
        }

        if (state.user && !googleAuth.hasAccessToken()) {
          syncStatus.textContent = "Reconexão necessária";
          syncStatus.setAttribute("aria-label", "Reconecte o Google para sincronizar");
          syncNoticeTitle.textContent = "Reconecte sua conta Google";
          syncNoticeDetail.textContent = pending > 0
            ? `${pendingLabel.charAt(0).toUpperCase() + pendingLabel.slice(1)}. Reconecte para enviar ao Google Drive.`
            : "Seus dados continuam disponíveis neste dispositivo. Reconecte para conferir o Google Drive.";
          syncNoticeAction.hidden = false;
          syncNoticeAction.textContent = "Reconectar Google";
          return;
        }

        syncStatus.textContent = "Sincronização pendente";
        syncStatus.setAttribute("aria-label", `${pendingLabel}; tente novamente`);
        syncNoticeTitle.textContent = "Não foi possível sincronizar agora";
        syncNoticeDetail.textContent = pending > 0
          ? `${pendingLabel.charAt(0).toUpperCase() + pendingLabel.slice(1)}. Tudo continua salvo neste dispositivo.`
          : "Os dados continuam salvos neste dispositivo. Tente conferir o Google Drive novamente.";
        syncNoticeAction.hidden = false;
        syncNoticeAction.textContent = "Tentar novamente";
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
        if (!state.user) return Promise.resolve();
        return localStore.save(state.user.id, {
          entries: state.entries,
          recurrenceSeries: state.recurrenceSeries,
          settings: state.settings,
          settingsDirty: state.settingsDirty,
          types: state.types,
          descriptions: state.descriptions,
          customDescriptionOptionsByType: state.customDescriptionOptionsByType,
          hiddenTypes: state.hiddenTypes,
          hiddenDescriptionsByType: state.hiddenDescriptionsByType,
          syncQueue: state.syncQueue,
          lastSyncedAt: state.lastSyncedAt,
          syncConflict: state.syncConflict,
          savedAt: new Date().toISOString(),
        }).catch((error) => console.error("Não foi possível salvar os dados locais.", error));
      }

      async function loadLocal(userId) {
        const cached = await localStore.load(userId);
        if (!cached) return;
        state.entries = cached.entries || [];
        state.recurrenceSeries = cached.recurrenceSeries || [];
        state.settings = normalizeSettings(cached.settings);
        state.settingsDirty = !!cached.settingsDirty;
        state.types = [...new Set([...defaultTypes, ...(cached.types || [])])].sort();
        state.descriptions = [...new Set([...defaultDescriptions, ...(cached.descriptions || [])])].sort();
        state.customDescriptionOptionsByType = cached.customDescriptionOptionsByType || {};
        state.hiddenTypes = cached.hiddenTypes || [];
        state.hiddenDescriptionsByType = cached.hiddenDescriptionsByType || {};
        state.syncQueue = cached.syncQueue || [];
        state.lastSyncedAt = cached.lastSyncedAt || null;
        state.syncConflict = cached.syncConflict || null;
        state.deletedEntryIds = new Set(
          state.syncQueue.filter((item) => item.type === "delete").map((item) => item.id),
        );
      }

      function clearSessionState() {
        state.user = null;
        state.entries = [];
        state.recurrenceSeries = [];
        state.syncQueue = [];
        state.deletedEntryIds = new Set();
        state.types = [...defaultTypes];
        state.descriptions = [...defaultDescriptions];
        state.customDescriptionOptionsByType = {};
        state.hiddenTypes = [];
        state.hiddenDescriptionsByType = {};
        state.settings = createDefaultSettings();
        state.settingsDirty = false;
        state.lastSyncedAt = null;
        state.syncConflict = null;
        state.selectedCalendarDate = null;
        state.filterDate = null;
        state.calendarExpanded = false;
        state.activeEntry = null;
        state.editingId = null;
        state.selectionMode = false;
        state.selectedEntries = new Set();
        state.pendingStatusEntries = new Set();
        state.recentlyChangedEntry = null;
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

      function isSyncConflict(error) {
        return error?.message === "GOOGLE_DRIVE_CONFLICT" || error?.message?.startsWith("CONFLICT:");
      }

      async function markSynchronizationComplete() {
        state.lastSyncedAt = new Date().toISOString();
        state.syncConflict = null;
        await saveLocal();
        setSyncStatus("synced", "Tudo sincronizado");
      }

      async function save() {
        await saveLocal();
        setSyncStatus("syncing", "Sincronizando alterações...");
        try {
          await syncEntries();
          if (state.settingsDirty) {
            await syncSettings();
            state.settingsDirty = false;
          }
          await markSynchronizationComplete();
          return true;
        } catch (error) {
          console.error(error);
          if (["GOOGLE_AUTH_EXPIRED", "GOOGLE_AUTH_REQUIRED"].includes(error.message)) {
            await expireGoogleSession();
            show("Seus dados estão salvos neste dispositivo. Reconecte o Google para sincronizar.");
            return false;
          }
          if (isSyncConflict(error)) {
            state.syncConflict = { message: error.message, occurredAt: new Date().toISOString() };
            await saveLocal();
            setSyncStatus("conflict", "Conflito de sincronização");
            show("Há alterações em dois dispositivos. Escolha qual versão deseja manter.");
            return false;
          }
          setSyncStatus("pending", "Sincronização pendente");
          show(
            error.message === "GOOGLE_DRIVE_TIMEOUT"
              ? "O Google Drive demorou para responder. A alteração está salva neste dispositivo e será enviada na próxima tentativa."
              : "Alteração salva neste dispositivo e aguardando conexão para sincronizar.",
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
        const reconnectButton = googleAuth.hasAccessToken()
          ? ""
          : '<button class="auth-button" id="reconnectGoogle" type="button" aria-label="Reconectar ao Google para sincronizar" title="Reconectar ao Google"><span aria-hidden="true">↻</span><span class="button-label">Reconectar</span></button>';
        authArea.innerHTML = `<span class="signed-user" title="${esc(state.user.email || "")}">${esc(name || "Usuário")}</span>${reconnectButton}<button class="auth-button" id="signOut" type="button" aria-label="Sair da conta" title="Sair da conta"><span aria-hidden="true">⎋</span><span class="button-label">Sair</span></button>`;
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

      async function syncSettings() {
        if (!state.user) return;
        await repository.upsertSettings(
          state.user.id,
          state.settings,
          state.types,
          state.descriptions,
          state.customDescriptionOptionsByType,
          state.hiddenTypes,
          state.hiddenDescriptionsByType,
        );
      }
      async function loadCloudSettings() {
        const data = await repository.fetchSettings();
        if (data) {
          state.settings = normalizeSettings(data);
          state.types = [...new Set([...defaultTypes, ...(data.types || [])])].sort();
          state.descriptions = [...new Set([...defaultDescriptions, ...(data.descriptions || [])])].sort();
          state.customDescriptionOptionsByType = data.customDescriptionOptionsByType || {};
          state.hiddenTypes = data.hiddenTypes || [];
          state.hiddenDescriptionsByType = data.hiddenDescriptionsByType || {};
          state.settingsDirty = false;
        } else {
          await syncSettings();
          state.settingsDirty = false;
        }
        saveLocal();
        render();
      }
      async function setCurrentUser(user) {
        const isSameUser = state.user?.id === user?.id;
        state.user = user || null;
        if (state.user && !isSameUser) {
          resetStateForUser(state.user);
          await loadLocal(state.user.id);
          render();
        }
        updateAuthArea();
        if (state.user) {
          if (!googleAuth.hasAccessToken()) {
            setSyncStatus(state.syncConflict ? "conflict" : "pending", state.syncConflict ? "Conflito de sincronização" : "Reconecte o Google para sincronizar");
            render();
            return;
          }
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
              if (isSyncConflict(error)) {
                state.syncConflict = { message: error.message, occurredAt: new Date().toISOString() };
                setSyncStatus("conflict", "Conflito de sincronização");
              } else {
                setSyncStatus("pending", "Sincronização pendente");
              }
            }
            await loadCloudEntries();
            await loadCloudSettings();
            await loadCloudRecurrenceSeries();
            if (!hasPendingSync) await markSynchronizationComplete();
            else await saveLocal();
          } catch (error) {
            console.error(error);
            setSyncStatus("pending", "Sincronização pendente");
            await saveLocal();
            show(
              error.message === "GOOGLE_DRIVE_TIMEOUT"
                ? "O Google Drive demorou para responder. Seus dados locais foram preservados e a sincronização será tentada novamente."
                : "Não foi possível concluir a sincronização agora. Seus dados locais foram preservados.",
            );
          } finally {
            // Mesmo com falha temporária de rede, a tela continua responsiva.
            render();
          }
        } else {
          setSyncStatus("idle", "Entre para sincronizar");
        }
      }

      async function signInWithGoogle(trigger = signInGoogleScreen) {
        if (window.location.protocol === "file:") {
          show("Abra o site publicado para entrar com Google.");
          return;
        }
        const triggerLabel = trigger.querySelector(".button-label");
        const originalLabel = triggerLabel?.textContent || trigger.textContent;
        trigger.disabled = true;
        trigger.setAttribute("aria-busy", "true");
        if (triggerLabel) triggerLabel.textContent = "Conectando…";
        else trigger.textContent = "Conectando…";
        try {
          const user = await googleAuth.signIn();
          await setCurrentUser(user);
        } catch (error) {
          console.error(error);
          show(
            error.message === "GOOGLE_CLIENT_ID_NOT_CONFIGURED"
              ? "Configure o Client ID do Google antes de entrar."
              : error.message === "GOOGLE_POPUP_TIMEOUT"
                ? "O Google não abriu neste navegador. Use o Chrome ou Edge para entrar."
                : "Não foi possível entrar com o Google.",
          );
        } finally {
          if (trigger.isConnected) {
            trigger.disabled = false;
            trigger.removeAttribute("aria-busy");
            if (triggerLabel) triggerLabel.textContent = originalLabel;
            else trigger.textContent = originalLabel;
          }
        }
      }

      async function signOut() {
        await googleAuth.signOut();
        repository.reset();
        clearSessionState();
        updateAuthArea();
        setSyncStatus("idle", "Entre para sincronizar");
        show("Sessão encerrada.");
      }

      async function expireGoogleSession() {
        await saveLocal();
        googleAuth.clearToken();
        repository.reset();
        updateAuthArea();
        setSyncStatus("pending", "Reconecte o Google para sincronizar");
        render();
      }

      async function initializeAuth() {
        try {
          const restoredUser = googleAuth.restoreSession();
          if (restoredUser) {
            await setCurrentUser(restoredUser);
          } else {
            updateAuthArea();
            setSyncStatus("idle", "Entre para acessar seu Google Drive");
          }
        } finally {
          bootstrapScreen.hidden = true;
          document.body.setAttribute("aria-busy", "false");
          updateAuthArea();
        }
      }

      async function retrySynchronization(trigger = null) {
        if (!state.user) return;
        if (!navigator.onLine) {
          setSyncStatus("pending", "Sem conexão");
          return;
        }
        if (!googleAuth.hasAccessToken()) {
          if (trigger) await signInWithGoogle(trigger);
          else setSyncStatus("pending", "Reconecte o Google para sincronizar");
          return;
        }

        const originalLabel = trigger?.textContent;
        if (trigger) {
          trigger.disabled = true;
          trigger.setAttribute("aria-busy", "true");
          trigger.textContent = "Sincronizando...";
        }
        setSyncStatus("syncing", "Sincronizando com o Google Drive");

        try {
          await repository.load();
          await retryPendingSynchronization();
          await loadCloudEntries();
          await loadCloudSettings();
          await loadCloudRecurrenceSeries();
          await markSynchronizationComplete();
          render();
          show("Dados sincronizados com o Google Drive.");
        } catch (error) {
          console.error(error);
          if (["GOOGLE_AUTH_EXPIRED", "GOOGLE_AUTH_REQUIRED"].includes(error.message)) {
            await expireGoogleSession();
          } else if (isSyncConflict(error)) {
            state.syncConflict = { message: error.message, occurredAt: new Date().toISOString() };
            await saveLocal();
            setSyncStatus("conflict", "Conflito de sincronização");
          } else {
            setSyncStatus("pending", "Sincronização pendente");
          }
        } finally {
          if (trigger?.isConnected) {
            trigger.disabled = false;
            trigger.removeAttribute("aria-busy");
            trigger.textContent = originalLabel;
          }
        }
      }

      function openSyncConflictDialog() {
        if (!syncConflictDialog.open) syncConflictDialog.showModal();
      }

      async function runConflictAction(button, loadingLabel, task) {
        const buttons = [useCloudVersion, keepLocalVersion];
        const originalContent = button.innerHTML;
        buttons.forEach((item) => { item.disabled = true; });
        button.setAttribute("aria-busy", "true");
        button.textContent = loadingLabel;
        try {
          await task();
        } catch (error) {
          console.error(error);
          state.syncConflict = state.syncConflict || { message: error.message, occurredAt: new Date().toISOString() };
          await saveLocal();
          if (["GOOGLE_AUTH_EXPIRED", "GOOGLE_AUTH_REQUIRED"].includes(error.message)) {
            await expireGoogleSession();
          } else {
            setSyncStatus("conflict", "Conflito de sincronização");
          }
          show("Não foi possível concluir a escolha. Seus dados continuam salvos neste dispositivo.");
        } finally {
          buttons.forEach((item) => { item.disabled = false; });
          button.removeAttribute("aria-busy");
          button.innerHTML = originalContent;
        }
      }

      async function useGoogleDriveVersion() {
        await runConflictAction(useCloudVersion, "Carregando dados do Drive...", async () => {
          state.syncQueue = [];
          state.deletedEntryIds = new Set();
          state.settingsDirty = false;
          state.syncConflict = null;
          repository.reset();
          await repository.load();
          await loadCloudEntries();
          await loadCloudSettings();
          await loadCloudRecurrenceSeries();
          await markSynchronizationComplete();
          syncConflictDialog.close();
          render();
          show("Versão do Google Drive carregada.");
        });
      }

      async function keepDeviceVersion() {
        await runConflictAction(keepLocalVersion, "Enviando dados deste dispositivo...", async () => {
          state.syncQueue = state.syncQueue.map((operation) => ({ ...operation, baseUpdatedAt: null }));
          state.syncConflict = null;
          await saveLocal();
          repository.reset();
          syncConflictDialog.close();
          await retrySynchronization();
        });
      }

      authArea.onclick = async (event) => {
        const signInButton = event.target.closest("#signInGoogle, #reconnectGoogle");
        if (signInButton) await signInWithGoogle(signInButton);
        if (event.target.closest("#signOut")) await signOut();
      };

      signInGoogleScreen.onclick = () => signInWithGoogle(signInGoogleScreen);
      syncNoticeAction.onclick = async () => {
        if (state.syncConflict) {
          if (!googleAuth.hasAccessToken()) await signInWithGoogle(syncNoticeAction);
          if (googleAuth.hasAccessToken()) openSyncConflictDialog();
          return;
        }
        await retrySynchronization(syncNoticeAction);
      };
      useCloudVersion.onclick = useGoogleDriveVersion;
      keepLocalVersion.onclick = keepDeviceVersion;
      document
        .querySelectorAll("[data-close-sync-conflict]")
        .forEach((button) => (button.onclick = () => syncConflictDialog.close()));

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || !state.user) return;
        repository.load()
          .then(() => retryPendingSynchronization())
          .then(async () => {
            await loadCloudEntries();
            await loadCloudRecurrenceSeries();
            render();
          })
          .catch((error) => console.error(error));
      });

      window.addEventListener("online", () => {
        retrySynchronization().catch((error) => console.error(error));
      });

      window.addEventListener("offline", () => {
        if (state.user) setSyncStatus("pending", "Sem conexão");
      });

      window.addEventListener("beforeunload", (event) => {
        if (!state.user || !hasPendingChanges()) return;
        event.preventDefault();
        event.returnValue = "";
      });
      function sortedOptions(values) {
        return [...new Set(values.filter(Boolean))].sort((a, b) =>
          String(a).localeCompare(String(b), "pt-BR"),
        );
      }

      function fill(select, values, placeholder, allowNew = false) {
        select.innerHTML =
          `<option value="">${placeholder}</option>` +
          sortedOptions(values).map((x) => `<option>${esc(x)}</option>`).join("") +
          (allowNew ? '<option value="__new__">＋ Adicionar nova opção…</option>' : "");
      }

      function entryTypeOptions(selectedType = "") {
        return [...state.types, ...defaultTypes, selectedType]
          .filter((option) => option === selectedType || !state.hiddenTypes.includes(option));
      }

      function entryDescriptionOptions(selectedType, selectedDescription = "") {
        const hidden = state.hiddenDescriptionsByType[selectedType] || [];
        return [
          ...(descriptionOptionsByType[selectedType] || []),
          ...(state.customDescriptionOptionsByType[selectedType] || []),
          selectedDescription,
        ].filter((option) => option === selectedDescription || !hidden.includes(option));
      }

      function renderEntryOptions() {
        const selectedType = type.value;
        const selectedDescription = desc.value;
        fill(type, entryTypeOptions(selectedType), "Selecione", true);
        type.value = selectedType;
        fill(desc, entryDescriptionOptions(selectedType, selectedDescription), "Selecione", true);
        desc.value = selectedDescription;
        desc.disabled = !selectedType;
      }

      function renderOptionManagement() {
        const selectedType = deleteTypeOption.value;
        const descriptionType = deleteDescriptionType.value;
        const selectedDescription = deleteDescriptionOption.value;
        fill(deleteTypeOption, entryTypeOptions(), "Selecione o tipo");
        deleteTypeOption.value = selectedType;
        fill(deleteDescriptionType, entryTypeOptions(), "Selecione o tipo");
        deleteDescriptionType.value = descriptionType;
        fill(deleteDescriptionOption, entryDescriptionOptions(descriptionType), "Selecione a descrição");
        deleteDescriptionOption.value = selectedDescription;
        deleteDescriptionOption.disabled = !descriptionType;
      }

      async function removeTypeOption() {
        const option = deleteTypeOption.value;
        if (!option || !confirm(`Excluir a opção de tipo “${option}”? Os lançamentos atuais não serão alterados.`)) return;
        state.types = state.types.filter((item) => item !== option);
        state.hiddenTypes = sortedOptions([...state.hiddenTypes, option]);
        state.settingsDirty = true;
        await save();
        renderOptionManagement();
        render();
        show(`Tipo “${option}” removido das opções.`);
      }

      async function removeDescriptionOption() {
        const selectedType = deleteDescriptionType.value;
        const option = deleteDescriptionOption.value;
        if (!selectedType || !option || !confirm(`Excluir a descrição “${option}” de “${selectedType}”? Os lançamentos atuais não serão alterados.`)) return;
        state.customDescriptionOptionsByType[selectedType] = (state.customDescriptionOptionsByType[selectedType] || []).filter((item) => item !== option);
        state.hiddenDescriptionsByType = {
          ...state.hiddenDescriptionsByType,
          [selectedType]: sortedOptions([...(state.hiddenDescriptionsByType[selectedType] || []), option]),
        };
        state.settingsDirty = true;
        await save();
        renderOptionManagement();
        render();
        show(`Descrição “${option}” removida das opções de ${selectedType}.`);
      }

      function managerFilteredEntries() {
        return state.entries
          .filter((entry) => !entry.excluded_from_series)
          .filter((entry) => !managerFilterType.value || entry.type === managerFilterType.value)
          .filter((entry) => !managerFilterDescription.value || entry.description === managerFilterDescription.value)
          .filter((entry) => !managerFilterStatus.value || (managerFilterStatus.value === "paid" ? entry.paid : !entry.paid))
          .sort((a, b) => b.date.localeCompare(a.date));
      }

      function renderRecordsManager() {
        const selectedType = managerFilterType.value;
        const selectedDescription = managerFilterDescription.value;
        const selectedBulkType = managerBulkType.value;
        const selectedBulkDescription = managerBulkDescription.value;
        fill(managerFilterType, sortedOptions(state.entries.map((entry) => entry.type)), "Todos os tipos");
        managerFilterType.value = selectedType;
        fill(managerFilterDescription, sortedOptions(state.entries
          .filter((entry) => !selectedType || entry.type === selectedType)
          .map((entry) => entry.description)), "Todas as descrições");
        managerFilterDescription.value = selectedDescription;
        fill(managerBulkType, entryTypeOptions(), "Não alterar");
        managerBulkType.value = selectedBulkType;
        fill(managerBulkDescription, selectedBulkType ? entryDescriptionOptions(selectedBulkType) : [], "Não alterar");
        managerBulkDescription.value = selectedBulkDescription;
        managerBulkDescription.disabled = !selectedBulkType;

        const entries = managerFilteredEntries();
        const allSelected = entries.length > 0 && entries.every((entry) => managerSelectedEntries.has(entry.id));
        managerSelectAll.textContent = allSelected ? "Desmarcar filtrados" : "Selecionar filtrados";
        recordsManagerCount.textContent = `${entries.length} registro${entries.length === 1 ? "" : "s"} encontrado${entries.length === 1 ? "" : "s"} · ${managerSelectedEntries.size} selecionado${managerSelectedEntries.size === 1 ? "" : "s"}`;
        recordsManagerList.innerHTML = entries.length
          ? entries.map((entry) => `<article class="managed-record">
              <input type="checkbox" data-manager-select="${entry.id}" ${managerSelectedEntries.has(entry.id) ? "checked" : ""} aria-label="Selecionar ${esc(entry.description)}" />
              <div><strong>${esc(entry.description)}</strong><small>${new Date(`${entry.date}T12:00`).toLocaleDateString("pt-BR")} · ${esc(entry.type)} · ${entry.paid ? "Pago" : "Em aberto"} · ${money(entry.value)}</small></div>
              <button class="secondary" type="button" data-manager-edit="${entry.id}" aria-label="Editar ${esc(entry.description)}">✏</button>
            </article>`).join("")
          : '<div class="recent-records-empty">Nenhum registro encontrado com estes filtros.</div>';
      }

      async function applyManagerChanges({ paid = null, includeFields = false } = {}) {
        if (!managerSelectedEntries.size) {
          show("Selecione ao menos um registro.");
          return;
        }
        const nextType = includeFields ? managerBulkType.value : "";
        const nextDescription = includeFields ? managerBulkDescription.value : "";
        let changed = 0;
        state.entries.forEach((entry) => {
          if (!managerSelectedEntries.has(entry.id)) return;
          let changedEntry = false;
          if (paid !== null && entry.paid !== paid) { entry.paid = paid; changedEntry = true; }
          if (nextType && entry.type !== nextType) { entry.type = nextType; changedEntry = true; }
          if (nextDescription && entry.description !== nextDescription) { entry.description = nextDescription; changedEntry = true; }
          if (changedEntry) {
            if (entry.series_id) entry.detached_from_series = true;
            queueUpsert(entry);
            changed++;
          }
        });
        if (!changed) { show("Nenhuma alteração necessária nos registros selecionados."); return; }
        managerApplyChanges.disabled = true;
        managerApplyChanges.setAttribute("aria-busy", "true");
        try {
          await save();
          managerSelectedEntries.clear();
          renderRecordsManager();
          render();
          show(`${changed} registro${changed === 1 ? "" : "s"} atualizado${changed === 1 ? "" : "s"}.`);
        } finally {
          managerApplyChanges.disabled = false;
          managerApplyChanges.removeAttribute("aria-busy");
        }
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
        const statusPending = state.pendingStatusEntries.has(e.id);
        const statusChanged = state.recentlyChangedEntry === e.id;
        const isIncome = (e.flow_type || "expense") === "income";
        const statusLabel = e.paid
          ? (isIncome ? "Recebido" : "Pago")
          : (isIncome ? "A receber" : "Em aberto");
        return `
          <div class="entry dense-entry ${selected ? "selected" : ""} ${statusPending ? "status-pending" : ""} ${statusChanged ? "status-changed" : ""}" data-entry="${e.id}" role="button" tabindex="0" aria-disabled="${statusPending}" aria-busy="${statusPending}" aria-label="Alterar status de ${esc(e.description)}. Status atual: ${statusLabel}">
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
                    ${state.selectionMode ? "" : `<button type="button" class="status-button ${e.paid ? "paid" : "pending"}" data-toggle-status="${e.id}" aria-label="Alterar status de ${esc(e.description)}. Status atual: ${statusLabel}" aria-pressed="${e.paid}" ${statusPending ? "disabled" : ""}><span class="status-button-label">${statusPending ? "Salvando" : statusLabel}</span></button>`}
                  </div>
                </div>
              </div>
            </div>
            ${state.selectionMode ? "" : `<button class="entry-menu" data-edit="${e.id}" aria-label="Mais opções para ${esc(e.description)}">⋮</button>`}
          </div>`;
      }

      function updateSummary(entries) {
        const expenses = entries.filter((entry) => (entry.flow_type || "expense") === "expense");
        monthTotal.textContent = money(
          expenses.reduce((a, e) => a + Number(e.value), 0),
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
          sortedOptions([...entryTypeOptions(), ...state.entries.map((entry) => entry.type)])
            .map((x) => `<option>${esc(x)}</option>`).join("");

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
          const income = entryIncomeTotals.get(date) || 0;
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

      function renderEntries(entries) {
        rows.innerHTML = entries.length
          ? entries.map(renderDenseEntry).join("")
          : '<div class="empty">Nenhum lançamento encontrado.</div>';
      }

      function render() {
        renderEntryOptions();
        renderOptionManagement();

        renderFilterTypes();

        const ft = filterType.value,
          fs = filterStatus.value;

        const current = new Date().toISOString().slice(0, 7);

        if (!filterMonth.value) filterMonth.value = current;

        const month = filterMonth.value;

        const monthly = getMonthlyEntries(month);

        updateSummary(monthly);
        currentBalanceTotal.textContent = money(
          getProjectedBalance(todayISO(), buildDailyEntryNet()),
        );
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

        panelTitle.textContent = state.selectionMode
          ? `${state.selectedEntries.size} selecionado${state.selectedEntries.size > 1 ? "s" : ""}`
          : state.filterDate
            ? `Lançamentos de ${new Date(`${state.filterDate}T12:00`).toLocaleDateString("pt-BR")}`
            : "Lançamentos";

        count.style.display = state.selectionMode ? "none" : "";
        openRecentRecordsMain.hidden = state.selectionMode;
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
        returnToRecentAfterEdit = false;
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
        dateInput.value = todayISO();
        updateEntryFormVisibility();
        render();
        dialog.showModal();
      }

      function openSettingsDialog() {
        currentBalanceInput.value = state.settings.current_balance;
        balanceReferenceDateInput.value = state.settings.balance_reference_date || todayISO();
        updateSettingsSyncSummary(syncStatus.dataset.state);
        settingsDialog.showModal();
      }

      function getRecentRecordGroups() {
        return domain.recentEntryGroups(state.entries);
      }

      function formatCreatedAt(entry) {
        if (!entry.created_at) return "Data de cadastro indisponível";
        const createdAt = new Date(entry.created_at);
        if (Number.isNaN(createdAt.getTime())) return "Data de cadastro indisponível";
        return `Cadastrado em ${createdAt.toLocaleDateString("pt-BR")} às ${createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
      }

      function renderRecentRecords() {
        const groups = getRecentRecordGroups();
        const visibleGroups = groups.slice(0, recentRecordsVisible);

        recentRecordsList.innerHTML = visibleGroups.length
          ? visibleGroups.map((group) => {
              const entry = group.primary;
              const isIncome = (entry.flow_type || "expense") === "income";
              const status = entry.paid
                ? (isIncome ? "Recebido" : "Pago")
                : (isIncome ? "A receber" : "Em aberto");
              const groupLabel = group.entries.length > 1
                ? `${group.entries.length} lançamentos agrupados`
                : "";
              const recordKind = entry.series_id
                ? "Série recorrente"
                : entry.installment
                  ? "Parcelamento"
                  : status;
              return `<article class="recent-record">
                <div class="recent-record-head">
                  <span class="recent-record-title" title="${esc(entry.description)}">${esc(entry.description)}</span>
                  <span class="recent-record-value ${isIncome ? "income" : ""}">${isIncome ? "+ " : ""}${money(entry.value)}</span>
                </div>
                ${groupLabel ? `<span class="recent-record-group-count">${groupLabel}</span>` : ""}
                <div class="recent-record-meta">
                  <span>${new Date(`${entry.date}T12:00`).toLocaleDateString("pt-BR")} · ${esc(entry.type)} · ${recordKind}</span>
                  <span>${formatCreatedAt(entry)}</span>
                </div>
                <div class="recent-record-actions">
                  <button class="secondary" type="button" data-edit-recent="${entry.id}" aria-label="Editar ${esc(entry.description)}">Editar</button>
                </div>
              </article>`;
            }).join("") + (visibleGroups.length >= groups.length ? '<div class="recent-records-empty">Você chegou ao fim do histórico.</div>' : "")
          : '<div class="recent-records-empty">Nenhum registro cadastrado ainda.</div>';

        recentRecordsCount.textContent = groups.length
          ? `Exibindo ${visibleGroups.length} de ${groups.length} cadastro${groups.length === 1 ? "" : "s"}, do mais recente ao mais antigo`
          : "Nenhum registro encontrado";
        loadMoreRecentRecords.hidden = visibleGroups.length >= groups.length;
      }

      function openRecentRecordsDialog(returnToSettings = false) {
        recentRecordsReturnToSettings = returnToSettings;
        recentRecordsVisible = 10;
        renderRecentRecords();
        if (settingsDialog.open) settingsDialog.close();
        recentRecordsDialog.showModal();
      }

      function closeRecentRecordsDialog() {
        recentRecordsDialog.close();
        if (recentRecordsReturnToSettings) settingsDialog.showModal();
      }

      async function downloadManualBackup() {
        const originalLabel = downloadBackup.textContent;
        downloadBackup.disabled = true;
        downloadBackup.setAttribute("aria-busy", "true");
        downloadBackup.textContent = "Preparando...";

        await new Promise((resolve) => setTimeout(resolve, 0));

        try {
          const backup = {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            entries: state.entries,
            recurrenceSeries: state.recurrenceSeries,
            settings: {
              ...state.settings,
              types: state.types,
              descriptions: state.descriptions,
              customDescriptionOptionsByType: state.customDescriptionOptionsByType,
              hiddenTypes: state.hiddenTypes,
              hiddenDescriptionsByType: state.hiddenDescriptionsByType,
            },
          };
          const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `meus-gastos-backup-${todayISO()}.json`;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          show("Backup preparado para download.");
        } finally {
          downloadBackup.disabled = false;
          downloadBackup.removeAttribute("aria-busy");
          downloadBackup.textContent = originalLabel;
        }
      }

      async function addOption(key) {
        const label = key === "types" ? "novo tipo" : "nova descrição";
        const value = prompt(`Digite ${key === "types" ? "o" : "a"} ${label}:`);
        if (!value?.trim()) return null;

        const clean = value.trim().toUpperCase();
        if (key === "types") {
          state.types = sortedOptions([...state.types, clean]);
        } else {
          const selectedType = type.value;
          if (!selectedType) return null;
          state.descriptions = sortedOptions([...state.descriptions, clean]);
          state.customDescriptionOptionsByType = {
            ...state.customDescriptionOptionsByType,
            [selectedType]: sortedOptions([
              ...(state.customDescriptionOptionsByType[selectedType] || []),
              clean,
            ]),
          };
        }
        state.settingsDirty = true;
        await save();
        return clean;
      }

      function addMonths(dateString, months) {
        const d = new Date(dateString + "T12:00");
        d.setMonth(d.getMonth() + months);
        return d.toISOString().slice(0, 10);
      }
      let toastTimer = null;
      function show(msg, action = null) {
        clearTimeout(toastTimer);
        toast.replaceChildren();
        const message = document.createElement("span");
        message.textContent = msg;
        toast.appendChild(message);
        if (action) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = action.label;
          button.onclick = () => {
            clearTimeout(toastTimer);
            toast.classList.remove("show");
            action.onClick();
          };
          toast.appendChild(button);
        }
        toast.classList.add("show");
        toastTimer = setTimeout(() => toast.classList.remove("show"), action ? 5000 : 2400);
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

      function editEntry(entryOverride = null, returnToHistory = false) {
        const entry = entryOverride || getActiveEntry();
        if (!entry) return;
        returnToRecentAfterEdit = returnToHistory;
        if (recentRecordsDialog.open) recentRecordsDialog.close();
        state.editingId = entry.id;
        modalTitle.textContent = "Editar lançamento";
        fillForm(entry);
        dialog.showModal();
      }

      function closeEntryDialog() {
        dialog.close();
        if (!returnToRecentAfterEdit) return;
        returnToRecentAfterEdit = false;
        renderRecentRecords();
        recentRecordsDialog.showModal();
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
          const updated = updateEntry({
            date: dateInput.value,
            value: Number(valueInput.value),
            flow_type: flowType.value,
            type: type.value,
            description: desc.value,
            detail: detailInput.value.trim(),
            paid: paidInput.checked,
            detached_from_series: true,
          });
          return updated ? "this" : null;
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
          return "future";
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
        return "all";
      }

      function recurringEditSuccessMessage(scope, synced) {
        const scopeLabel = scope === "this"
          ? "Ocorrência atualizada"
          : scope === "future"
            ? "Esta e as próximas ocorrências foram atualizadas"
            : "Recorrência atualizada";
        return synced
          ? `${scopeLabel} e sincronizada.`
          : `${scopeLabel} neste dispositivo. Sincronização pendente.`;
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

      async function toggleEntryStatus() {
        const entry = getActiveEntry();
        if (!entry || state.pendingStatusEntries.has(entry.id)) return;
        const previousPaid = entry.paid;
        entry.paid = !entry.paid;
        state.pendingStatusEntries.add(entry.id);
        state.recentlyChangedEntry = entry.id;
        queueUpsert(entry);
        closeContextMenu();
        render();
        if (navigator.vibrate) navigator.vibrate(20);
        const synced = await save();
        state.pendingStatusEntries.delete(entry.id);
        render();
        const isIncome = (entry.flow_type || "expense") === "income";
        const successMessage = synced ? (entry.paid
            ? (isIncome ? "Receita marcada como recebida." : "Lançamento marcado como pago.")
            : (isIncome ? "Receita marcada como a receber." : "Lançamento marcado como pendente."))
          : "Status salvo neste dispositivo. Sincronização pendente.";
        show(successMessage, {
          label: "Desfazer",
          onClick: async () => {
            if (state.pendingStatusEntries.has(entry.id)) return;
            entry.paid = previousPaid;
            state.pendingStatusEntries.add(entry.id);
            state.recentlyChangedEntry = entry.id;
            queueUpsert(entry);
            render();
            await save();
            state.pendingStatusEntries.delete(entry.id);
            render();
            show("Alteração desfeita.");
          },
        });
        setTimeout(() => {
          if (state.recentlyChangedEntry !== entry.id) return;
          state.recentlyChangedEntry = null;
          render();
        }, 700);
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
        await saveLocal();
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
        renderEntryOptions();
        desc.value = entry.description;
        renderEntryOptions();
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
      downloadBackup.onclick = downloadManualBackup;
      deleteTypeOptionButton.onclick = removeTypeOption;
      deleteDescriptionOptionButton.onclick = removeDescriptionOption;
      deleteDescriptionType.onchange = renderOptionManagement;
      openRecentRecords.onclick = () => openRecentRecordsDialog(true);
      openRecentRecordsMain.onclick = () => openRecentRecordsDialog(false);
      openRecordsManager.onclick = () => {
        managerSelectedEntries.clear();
        managerFilterType.value = "";
        managerFilterDescription.value = "";
        managerFilterStatus.value = "";
        managerBulkType.value = "";
        managerBulkDescription.value = "";
        renderRecordsManager();
        settingsDialog.close();
        recordsManagerDialog.showModal();
      };
      [managerFilterType, managerFilterDescription, managerFilterStatus].forEach((control) => {
        control.onchange = renderRecordsManager;
      });
      managerBulkType.onchange = () => {
        managerBulkDescription.value = "";
        renderRecordsManager();
      };
      managerSelectAll.onclick = () => {
        const entries = managerFilteredEntries();
        const allSelected = entries.length > 0 && entries.every((entry) => managerSelectedEntries.has(entry.id));
        entries.forEach((entry) => allSelected ? managerSelectedEntries.delete(entry.id) : managerSelectedEntries.add(entry.id));
        renderRecordsManager();
      };
      managerMarkPaid.onclick = () => applyManagerChanges({ paid: true });
      managerMarkPending.onclick = () => applyManagerChanges({ paid: false });
      managerApplyChanges.onclick = () => applyManagerChanges({ includeFields: true });
      recordsManagerList.onchange = (event) => {
        const id = event.target.dataset.managerSelect;
        if (!id) return;
        if (event.target.checked) managerSelectedEntries.add(id);
        else managerSelectedEntries.delete(id);
        renderRecordsManager();
      };
      recordsManagerList.onclick = (event) => {
        const button = event.target.closest("[data-manager-edit]");
        if (!button) return;
        const entry = state.entries.find((item) => item.id === button.dataset.managerEdit);
        recordsManagerDialog.close();
        editEntry(entry);
      };
      loadMoreRecentRecords.onclick = async () => {
        loadMoreRecentRecords.disabled = true;
        loadMoreRecentRecords.setAttribute("aria-busy", "true");
        loadMoreRecentRecords.textContent = "Carregando...";
        await new Promise((resolve) => setTimeout(resolve, 0));
        recentRecordsVisible += 10;
        renderRecentRecords();
        loadMoreRecentRecords.disabled = false;
        loadMoreRecentRecords.removeAttribute("aria-busy");
        loadMoreRecentRecords.textContent = "Ver mais 10";
      };
      recentRecordsList.onclick = (event) => {
        const editButton = event.target.closest("[data-edit-recent]");
        if (!editButton) return;
        const entry = state.entries.find((item) => item.id === editButton.dataset.editRecent);
        editEntry(entry, true);
      };
      document
        .querySelectorAll("[data-close]")
        .forEach((b) => (b.onclick = closeEntryDialog));
      dialog.addEventListener("cancel", (event) => {
        if (!returnToRecentAfterEdit) return;
        event.preventDefault();
        closeEntryDialog();
      });
      document
        .querySelectorAll("[data-close-settings]")
        .forEach((b) => (b.onclick = () => settingsDialog.close()));
      document
        .querySelectorAll("[data-close-recent-records]")
        .forEach((button) => (button.onclick = closeRecentRecordsDialog));
      recentRecordsDialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeRecentRecordsDialog();
      });
      document
        .querySelectorAll("[data-close-series-scope]")
        .forEach((button) => (button.onclick = () => seriesScopeDialog.close()));
      document
        .querySelectorAll("[data-close-bulk-date]")
        .forEach((button) => (button.onclick = () => bulkDateDialog.close()));
      document
        .querySelectorAll("[data-close-records-manager]")
        .forEach((button) => (button.onclick = () => recordsManagerDialog.close()));
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
      type.onchange = async () => {
        if (type.value === "__new__") {
          const newType = await addOption("types");
          type.value = "";
          desc.value = "";
          renderEntryOptions();
          type.value = newType || "";
          renderEntryOptions();
          return;
        }
        desc.value = "";
        renderEntryOptions();
        if (!state.editingId) {
          const suggestedDate = suggestedDateForType(type.value);
          if (suggestedDate) dateInput.value = suggestedDate;
        }
      };
      desc.onchange = async () => {
        if (desc.value !== "__new__") return;
        const newDescription = await addOption("descriptions");
        desc.value = "";
        renderEntryOptions();
        desc.value = newDescription || "";
      };
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

      window.addEventListener("resize", closeContextMenu);
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
        if (!settingsForm.reportValidity()) return;
        saveSettings.disabled = true;
        saveSettings.setAttribute("aria-busy", "true");
        saveSettings.textContent = "Salvando...";
        state.settings = {
          current_balance: Number(currentBalanceInput.value),
          balance_reference_date: balanceReferenceDateInput.value,
        };
        state.settingsDirty = true;
        try {
          const synced = await save();
          if (!synced) return;
          settingsDialog.close();
          render();
          show("Projeção financeira salva e sincronizada.");
        } finally {
          saveSettings.disabled = false;
          saveSettings.removeAttribute("aria-busy");
          saveSettings.textContent = "Salvar projeção";
        }
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

        state.activeEntry = card.dataset.entry;
        toggleEntryStatus();
      });

      rows.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target !== e.target.closest("[data-entry]")) return;

        const card = e.target.closest("[data-entry]");
        if (!card) return;

        e.preventDefault();
        if (state.selectionMode) {
          toggleSelection(card.dataset.entry);
          return;
        }

        state.activeEntry = card.dataset.entry;
        toggleEntryStatus();
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
          let recurringEditScope = null;
          if (editing && editingEntry?.series_id) {
            recurringEditScope = await editRecurringSeries(editingEntry);
            if (!recurringEditScope) {
              show("Não foi possível localizar a ocorrência para atualizar. Atualize a tela e tente novamente.");
              return;
            }
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
          closeEntryDialog();
          render();
          show(
            recurringEditScope
              ? recurringEditSuccessMessage(recurringEditScope, synced)
              : synced
                ? editing
                  ? "Lançamento atualizado e sincronizado."
                  : isRecurringValue()
                    ? "Recorrência criada e sincronizada."
                    : "Lançamento salvo e sincronizado."
                : "Lançamento salvo neste dispositivo e aguardando sincronização.",
          );
        } catch (error) {
          console.error(error);
          show(
            editing && editingEntry?.series_id
              ? "Não foi possível atualizar a recorrência. Seus dados não foram confirmados no Google Drive."
              : "Não foi possível salvar a recorrência. Tente novamente.",
          );
        } finally {
          saveEntry.disabled = false;
          saveEntry.removeAttribute("aria-busy");
          saveEntry.textContent = "Salvar lançamento";
        }
      };

      async function startApp() {
        localStore.clearLegacyCache();
        filterStatus.value = "pending";
        render();
        await initializeAuth();
      }

      startApp();
