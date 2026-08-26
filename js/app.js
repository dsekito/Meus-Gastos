const descriptionOptionsByType = {
        ALIMENTAÇÃO: ["DELIVERY", "RESTAURANTE", "SUPERMERCADO"],
        ASSINATURAS: ["OUTRAS ASSINATURAS", "SOFTWARE", "STREAMING"],
        COMPRAS: ["CASA", "ELETRÔNICOS", "PRESENTES", "ROUPAS"],
        EDUCAÇÃO: ["CURSOS", "MATERIAL", "MENSALIDADE"],
        FINANCEIRO: ["EMPRÉSTIMO", "FINANCIAMENTO", "IMPOSTOS", "TARIFAS"],
        LAZER: ["ENTRETENIMENTO", "PASSEIOS", "VIAGENS"],
        MORADIA: ["ÁGUA", "ALUGUEL", "CONDOMÍNIO", "ENERGIA", "GÁS", "INTERNET", "MANUTENÇÃO"],
        OUTROS: ["OUTROS"],
        RECEITAS: ["BENEFÍCIOS", "FREELANCE", "REEMBOLSO", "RENDIMENTOS", "SALÁRIO"],
        SAÚDE: ["CONSULTAS", "FARMÁCIA", "PLANO DE SAÚDE"],
        TRANSPORTE: ["APLICATIVOS", "COMBUSTÍVEL", "MANUTENÇÃO", "SEGURO", "TRANSPORTE PÚBLICO"],
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
          current_balance: 0,
          balance_reference_date: todayISO(),
          onboarding_status: "pending",
        };
      }

      function normalizeSettings(settings = {}) {
        return {
          current_balance: Number(settings.current_balance ?? 0),
          balance_reference_date: settings.balance_reference_date || todayISO(),
          onboarding_status: ["pending", "completed"].includes(settings.onboarding_status)
            ? settings.onboarding_status
            : null,
        };
      }

      function profileOptions(savedOptions, defaults) {
        return Array.isArray(savedOptions)
          ? [...new Set(savedOptions)].sort()
          : [...defaults];
      }

      function createSyncDiagnostics() {
        return {
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastErrorCode: null,
          pendingCount: 0,
          documentSizeBytes: 0,
        };
      }

      const DOCUMENT_SIZE_WARNING_BYTES = 4 * 1024 * 1024;

      const state = {
        types: [...defaultTypes],

        descriptions: [...defaultDescriptions],

        customDescriptionOptionsByType: {},

        hiddenTypes: [],

        hiddenDescriptionsByType: {},

        entries: [],

        recurrenceSeries: [],

        recurrenceDirty: false,

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

        syncProgress: null,

        lastSyncedAt: null,

        syncConflict: null,

        syncDiagnostics: createSyncDiagnostics(),
      };
      let lastSyncProgressRenderedAt = 0;
      let lastSyncProgressPhase = null;
      let appReloadRequested = false;
      const synchronization = window.MGSyncService.create({
        state,
        repository,
        persist: saveLocal,
        normalizeEntryIds,
        onProgress: (progress) => {
          state.syncProgress = progress;
          const now = performance.now();
          const phaseChanged = progress.phase !== lastSyncProgressPhase;
          const finished = progress.total > 0 && progress.completed >= progress.total;
          if (phaseChanged || finished || now - lastSyncProgressRenderedAt >= 200) {
            lastSyncProgressRenderedAt = now;
            lastSyncProgressPhase = progress.phase || null;
            setSyncStatus("syncing", "Sincronizando alterações...");
          }
        },
      });
      const SYNC_DEBOUNCE_MS = 900;
      let scheduledSyncTimer = null;
      let activeSyncPromise = null;
      let syncRequestedWhileActive = false;

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
        ALIMENTAÇÃO: "#D97706",
        ASSINATURAS: "#7C3AED",
        COMPRAS: "#DB2777",
        EDUCAÇÃO: "#2563EB",
        FINANCEIRO: "#475569",
        LAZER: "#9333EA",
        MORADIA: "#0F766E",
        OUTROS: "#64748B",
        RECEITAS: "#15803D",
        SAÚDE: "#DC2626",
        TRANSPORTE: "#0369A1",
      };

      function categoryColor(type) {
        return CATEGORY_COLORS[type] || "#64748B";
      }

      const dialog = document.querySelector("#entryDialog"),
        form = document.querySelector("#entryForm"),
        modalTitle = document.querySelector("#entryDialogTitle"),
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
        monthEndBalanceTotal = document.querySelector("#monthEndBalanceTotal"),
        nextSevenDaysTotal = document.querySelector("#nextSevenDaysTotal"),
        nextSevenDaysSummary = document.querySelector("#nextSevenDaysSummary"),
        decisionPeriodLabel = document.querySelector("#decisionPeriodLabel"),
        financialGuidance = document.querySelector("#financialGuidance"),
        financialGuidanceTitle = document.querySelector("#financialGuidanceTitle"),
        financialGuidanceDetail = document.querySelector("#financialGuidanceDetail"),
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
        deleteConfirmDialog = document.querySelector("#deleteConfirmDialog"),
        deleteConfirmForm = document.querySelector("#deleteConfirmForm"),
        deleteConfirmTitle = document.querySelector("#deleteConfirmTitle"),
        deleteConfirmDescription = document.querySelector("#deleteConfirmDescription"),
        deleteConfirmEntry = document.querySelector("#deleteConfirmEntry"),
        confirmDelete = document.querySelector("#confirmDelete"),
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
        onboardingDialog = document.querySelector("#onboardingDialog"),
        onboardingForm = document.querySelector("#onboardingForm"),
        onboardingBalance = document.querySelector("#onboardingBalance"),
        onboardingReferenceDate = document.querySelector("#onboardingReferenceDate"),
        onboardingCategoryOptions = document.querySelector("#onboardingCategoryOptions"),
        onboardingCategoryError = document.querySelector("#onboardingCategoryError"),
        skipOnboarding = document.querySelector("#skipOnboarding"),
        saveOnboarding = document.querySelector("#saveOnboarding"),
        currentBalanceInput = document.querySelector("#currentBalance"),
        balanceReferenceDateInput = document.querySelector("#balanceReferenceDate"),
        saveSettings = document.querySelector("#saveSettings"),
        downloadBackup = document.querySelector("#downloadBackup"),
        createDriveBackup = document.querySelector("#createDriveBackup"),
        loadDriveBackups = document.querySelector("#loadDriveBackups"),
        driveBackupSelect = document.querySelector("#driveBackupSelect"),
        restoreDriveBackup = document.querySelector("#restoreDriveBackup"),
        deleteTypeOption = document.querySelector("#deleteTypeOption"),
        deleteTypeOptionButton = document.querySelector("#deleteTypeOptionButton"),
        deleteDescriptionType = document.querySelector("#deleteDescriptionType"),
        deleteDescriptionOption = document.querySelector("#deleteDescriptionOption"),
        deleteDescriptionOptionButton = document.querySelector("#deleteDescriptionOptionButton"),
        openRecentRecordsMain = document.querySelector("#openRecentRecordsMain"),
        openRecordsManagerMain = document.querySelector("#openRecordsManagerMain"),
        recordsManagerDialog = document.querySelector("#recordsManagerDialog"),
        recordsManagerList = document.querySelector("#recordsManagerList"),
        recordsManagerCount = document.querySelector("#recordsManagerCount"),
        managerFilterType = document.querySelector("#managerFilterType"),
        managerFilterDescription = document.querySelector("#managerFilterDescription"),
        managerFilterStatus = document.querySelector("#managerFilterStatus"),
        managerSelectAll = document.querySelector("#managerSelectAll"),
        managerSelectionSummary = document.querySelector("#managerSelectionSummary"),
        managerToggleBulk = document.querySelector("#managerToggleBulk"),
        managerBulkEditor = document.querySelector("#managerBulkEditor"),
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
        optionDialog = document.querySelector("#optionDialog"),
        optionForm = document.querySelector("#optionForm"),
        optionDialogTitle = document.querySelector("#optionDialogTitle"),
        optionDialogDescription = document.querySelector("#optionDialogDescription"),
        optionName = document.querySelector("#optionName"),
        saveOption = document.querySelector("#saveOption"),
        syncStatus = document.querySelector("#syncStatus"),
        syncNotice = document.querySelector("#syncNotice"),
        syncNoticeTitle = document.querySelector("#syncNoticeTitle"),
        syncNoticeDetail = document.querySelector("#syncNoticeDetail"),
        syncNoticeAction = document.querySelector("#syncNoticeAction");

      let recentRecordsVisible = 10;
      let recentRecordsReturnToSettings = false;
      let returnToRecentAfterEdit = false;
      const managerSelectedEntries = new Set();
      let optionDialogResolver = null;
      let pendingDeletionAction = null;

      function todayISO() {
        return domain.todayISO();
      }

      function pendingSyncCount() {
        return state.syncQueue.length + (state.settingsDirty ? 1 : 0) + (state.recurrenceDirty ? 1 : 0);
      }

      function refreshSyncDiagnostics(patch = {}) {
        const remoteStats = repository.getDocumentStats?.() || {};
        state.syncDiagnostics = {
          ...createSyncDiagnostics(),
          ...state.syncDiagnostics,
          ...patch,
          pendingCount: pendingSyncCount(),
          documentSizeBytes: remoteStats.sizeBytes ?? state.syncDiagnostics?.documentSizeBytes ?? 0,
        };
      }

      function recordSyncAttempt() {
        refreshSyncDiagnostics({ lastAttemptAt: new Date().toISOString(), lastErrorCode: null });
      }

      function recordSyncFailure(error) {
        refreshSyncDiagnostics({ lastErrorCode: error?.message || "SYNC_UNKNOWN_ERROR" });
      }

      function syncErrorLabel(code) {
        if (code === "GOOGLE_DRIVE_INVALID_DOCUMENT") return "a cópia do Drive é inválida";
        if (code === "GOOGLE_DRIVE_UNSUPPORTED_SCHEMA") return "a cópia foi criada por uma versão mais nova";
        if (code === "GOOGLE_DRIVE_TIMEOUT") return "o Google Drive demorou para responder";
        if (["GOOGLE_AUTH_EXPIRED", "GOOGLE_AUTH_REQUIRED"].includes(code)) return "é necessário autorizar o Google Drive";
        if (code === "GOOGLE_DRIVE_CANCELLED") return "a sincronização foi cancelada";
        return "não foi possível concluir a sincronização";
      }

      function formatFileSize(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return null;
        if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
        return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
      }

      function isRemoteDocumentLarge() {
        return Number(state.syncDiagnostics?.documentSizeBytes || 0) >= DOCUMENT_SIZE_WARNING_BYTES;
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
        const pendingLabel = pending === 1 ? "1 alteração pendente de envio" : `${pending} alterações pendentes de envio`;
        const title = stateName === "conflict"
          ? "Conflito de sincronização"
          : pending > 0
            ? pendingLabel
            : "Dados protegidos";
        const titleElement = document.createElement("strong");
        titleElement.textContent = title;
        const detail = document.createElement("span");
        const fileSize = formatFileSize(state.syncDiagnostics?.documentSizeBytes);
        detail.textContent = `${formatLastSync()}. Os dados também ficam salvos neste dispositivo.${fileSize ? ` Documento no Drive: ${fileSize}.` : ""}`;
        settingsSyncSummary.replaceChildren(titleElement, detail);
        if (stateName !== "synced" && state.syncDiagnostics?.lastErrorCode) {
          const attempt = state.syncDiagnostics.lastAttemptAt
            ? new Date(state.syncDiagnostics.lastAttemptAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
            : null;
          const errorDetail = document.createElement("span");
          errorDetail.textContent = `Última tentativa${attempt ? ` em ${attempt}` : ""}: ${syncErrorLabel(state.syncDiagnostics.lastErrorCode)}.`;
          errorDetail.title = `Código: ${state.syncDiagnostics.lastErrorCode}`;
          settingsSyncSummary.append(errorDetail);
        }
        if (isRemoteDocumentLarge()) {
          const warning = document.createElement("span");
          warning.className = "sync-size-warning";
          warning.textContent = "O arquivo está ficando grande. Crie um backup antes de adicionar muitos novos lançamentos.";
          settingsSyncSummary.append(warning);
        }
      }

      function setSyncStatus(stateName, message) {
        const pending = pendingSyncCount();
        const pendingLabel = pending === 1 ? "1 alteração pendente de envio" : `${pending} alterações pendentes de envio`;
        syncStatus.dataset.state = stateName;
        syncNotice.dataset.state = stateName;
        updateSettingsSyncSummary(stateName);
        syncNoticeAction.dataset.action = "";

        if (stateName === "synced") {
          syncStatus.textContent = "Tudo sincronizado";
          syncStatus.setAttribute("aria-label", `${formatLastSync()}; tudo sincronizado`);
          syncNotice.hidden = false;
          syncNoticeAction.hidden = true;
          syncNoticeTitle.textContent = "Tudo sincronizado";
          syncNoticeDetail.textContent = isRemoteDocumentLarge()
            ? `${formatLastSync()}. O arquivo está ficando grande; recomendamos criar um backup.`
            : `${formatLastSync()}. Seus dados também estão salvos neste dispositivo.`;
          return;
        }

        if (stateName === "queued") {
          syncStatus.textContent = "Salvo neste aparelho";
          syncStatus.setAttribute("aria-label", `${pendingLabel}. Salvo neste aparelho e aguardando envio ao Google Drive.`);
          syncNotice.hidden = false;
          syncNoticeAction.hidden = true;
          syncNoticeTitle.textContent = "Salvo neste aparelho";
          syncNoticeDetail.textContent = `${pendingLabel.charAt(0).toUpperCase() + pendingLabel.slice(1)}. O envio ao Google Drive começará em instantes.`;
          return;
        }

        if (stateName === "idle") {
          syncStatus.textContent = message;
          syncStatus.setAttribute("aria-label", message);
          syncNotice.hidden = true;
          return;
        }

        syncNotice.hidden = false;
        syncNoticeAction.hidden = false;
        syncNoticeAction.disabled = false;
        syncNoticeAction.removeAttribute("aria-busy");

        if (stateName === "syncing") {
          syncStatus.textContent = "Sincronizando";
          syncStatus.setAttribute("aria-label", message);
          syncNoticeTitle.textContent = "Sincronizando com o Google Drive";
          const progress = state.syncProgress;
          const percentage = progress?.total ? Math.round((progress.completed / progress.total) * 100) : null;
          syncNoticeDetail.textContent = percentage !== null
            ? progress.phase === "checking"
              ? `Conferindo ${progress.total} alteração${progress.total === 1 ? "" : "ões"} no Google Drive antes do envio.`
              : progress.phase === "preparing"
                ? `Preparando ${progress.completed} de ${progress.total} alterações (${percentage}%).`
                : progress.total === 1
                  ? "Enviando um lote consolidado ao Google Drive."
                  : `Enviando ${progress.completed} de ${progress.total} alterações (${percentage}%).`
            : pending > 0 ? `Enviando ${pendingLabel}.` : "Conferindo os dados deste dispositivo com o Google Drive.";
          syncNoticeAction.disabled = false;
          syncNoticeAction.textContent = "Cancelar sincronização";
          syncNoticeAction.setAttribute("aria-label", "Cancelar sincronização em andamento");
          syncNoticeAction.dataset.action = "cancel";
          return;
        }

        if (stateName === "conflict") {
          syncStatus.textContent = "Conflito de sincronização";
          syncStatus.setAttribute("aria-label", "Conflito de sincronização precisa ser resolvido");
          syncNoticeTitle.textContent = "Alterações em dois dispositivos";
          syncNoticeDetail.textContent = "Escolha qual versão deve ser mantida antes de continuar a sincronização.";
          syncNoticeAction.hidden = false;
          syncNoticeAction.textContent = "Resolver conflito";
          syncNoticeAction.dataset.action = "resolve-conflict";
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
          syncStatus.textContent = "Sincronização pausada";
          syncStatus.setAttribute("aria-label", "Sessão local ativa; autorize o Google Drive para sincronizar");
          syncNoticeTitle.textContent = "Seus dados estão disponíveis neste dispositivo";
          syncNoticeDetail.textContent = pending > 0
            ? `${pendingLabel.charAt(0).toUpperCase() + pendingLabel.slice(1)}. Autorize o Drive para enviar quando desejar.`
            : "Você continua conectado ao aplicativo. Autorize o Drive apenas quando quiser sincronizar.";
          syncNoticeAction.hidden = false;
          syncNoticeAction.textContent = "Autorizar Drive";
          syncNoticeAction.dataset.action = "authorize";
          return;
        }

        if (state.syncDiagnostics?.lastErrorCode === "GOOGLE_DRIVE_INVALID_DOCUMENT") {
          syncStatus.textContent = "Cópia do Drive inválida";
          syncStatus.setAttribute("aria-label", "A cópia do Google Drive precisa de recuperação. Os dados deste aparelho foram preservados.");
          syncNoticeTitle.textContent = "A cópia do Drive precisa de recuperação";
          syncNoticeDetail.textContent = "Seus dados deste aparelho foram preservados. Escolha um backup válido para recuperar a sincronização.";
          syncNoticeAction.textContent = "Restaurar backup";
          syncNoticeAction.setAttribute("aria-label", "Abrir as opções para restaurar um backup válido");
          syncNoticeAction.dataset.action = "restore-backup";
          return;
        }

        if (state.syncDiagnostics?.lastErrorCode === "GOOGLE_DRIVE_UNSUPPORTED_SCHEMA") {
          syncStatus.textContent = "Atualização necessária";
          syncStatus.setAttribute("aria-label", "Atualize o aplicativo antes de sincronizar com o Google Drive.");
          syncNoticeTitle.textContent = "Atualize o aplicativo para continuar";
          syncNoticeDetail.textContent = "A cópia do Drive foi criada por uma versão mais nova. Seus dados deste aparelho continuam preservados.";
          syncNoticeAction.textContent = "Verificar atualização";
          syncNoticeAction.setAttribute("aria-label", "Verificar se há uma atualização do aplicativo");
          syncNoticeAction.dataset.action = "update-app";
          return;
        }

        syncStatus.textContent = "Sincronização pendente";
        syncStatus.setAttribute("aria-label", `${pendingLabel}; tente novamente`);
        syncNoticeTitle.textContent = "Não foi possível sincronizar agora";
        syncNoticeDetail.textContent = state.syncDiagnostics?.lastErrorCode === "GOOGLE_DRIVE_TIMEOUT"
          ? "O Google Drive demorou para responder. Seus dados continuam salvos neste aparelho."
          : pending > 0
            ? `${pendingLabel.charAt(0).toUpperCase() + pendingLabel.slice(1)}. Tudo continua salvo neste dispositivo.`
            : "Os dados continuam salvos neste dispositivo. Tente conferir o Google Drive novamente.";
        syncNoticeAction.hidden = false;
        syncNoticeAction.textContent = "Tentar novamente";
        syncNoticeAction.setAttribute("aria-label", "Tentar sincronizar novamente com o Google Drive");
        syncNoticeAction.dataset.action = "retry";
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
        refreshSyncDiagnostics();
        return localStore.save(state.user.id, {
          entries: state.entries,
          recurrenceSeries: state.recurrenceSeries,
          recurrenceDirty: state.recurrenceDirty,
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
          syncDiagnostics: state.syncDiagnostics,
          savedAt: new Date().toISOString(),
        }).catch((error) => {
          console.error("Não foi possível salvar os dados locais.", error);
          throw error;
        });
      }

      async function loadLocal(userId) {
        const cached = await localStore.load(userId);
        if (!cached) return;
        state.entries = cached.entries || [];
        state.recurrenceSeries = cached.recurrenceSeries || [];
        state.recurrenceDirty = !!cached.recurrenceDirty;
        state.settings = normalizeSettings(cached.settings);
        state.settingsDirty = !!cached.settingsDirty;
        state.types = profileOptions(cached.types, defaultTypes);
        state.descriptions = profileOptions(cached.descriptions, defaultDescriptions);
        state.customDescriptionOptionsByType = cached.customDescriptionOptionsByType || {};
        state.hiddenTypes = cached.hiddenTypes || [];
        state.hiddenDescriptionsByType = cached.hiddenDescriptionsByType || {};
        state.syncQueue = cached.syncQueue || [];
        state.lastSyncedAt = cached.lastSyncedAt || null;
        state.syncConflict = cached.syncConflict || null;
        state.syncDiagnostics = { ...createSyncDiagnostics(), ...(cached.syncDiagnostics || {}) };
        state.deletedEntryIds = new Set(
          state.syncQueue.filter((item) => item.type === "delete").map((item) => item.id),
        );
      }

      function clearSessionState() {
        if (scheduledSyncTimer) {
          clearTimeout(scheduledSyncTimer);
          scheduledSyncTimer = null;
        }
        syncRequestedWhileActive = false;
        state.user = null;
        state.entries = [];
        state.recurrenceSeries = [];
        state.recurrenceDirty = false;
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
        state.syncDiagnostics = createSyncDiagnostics();
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
        state.syncProgress = null;
        state.lastSyncedAt = new Date().toISOString();
        state.syncConflict = null;
        refreshSyncDiagnostics({
          lastAttemptAt: state.syncDiagnostics?.lastAttemptAt || state.lastSyncedAt,
          lastSuccessAt: state.lastSyncedAt,
          lastErrorCode: null,
        });
        await saveLocal();
        setSyncStatus("synced", "Tudo sincronizado");
      }

      async function performSynchronization() {
        recordSyncAttempt();
        setSyncStatus("syncing", "Sincronizando alterações...");
        try {
          await syncEntries();
          if (state.recurrenceDirty) {
            await repository.replaceRecurrenceSeries(state.recurrenceSeries);
            state.recurrenceDirty = false;
          }
          if (state.settingsDirty) {
            await syncSettings();
            state.settingsDirty = false;
          }
          await markSynchronizationComplete();
          return true;
        } catch (error) {
          state.syncProgress = null;
          recordSyncFailure(error);
          console.error(error);
          if (error.message === "GOOGLE_DRIVE_CANCELLED") {
            await saveLocal();
            setSyncStatus("pending", "Sincronização cancelada");
            show("Sincronização cancelada. As alterações continuam salvas neste dispositivo para uma nova tentativa.", null, { announce: false });
            return false;
          }
          if (["GOOGLE_AUTH_EXPIRED", "GOOGLE_AUTH_REQUIRED"].includes(error.message)) {
            await expireGoogleSession();
            show("Seus dados estão salvos neste dispositivo. Reconecte o Google para sincronizar.", null, { announce: false });
            return false;
          }
          if (isSyncConflict(error)) {
            state.syncConflict = { message: error.message, occurredAt: new Date().toISOString() };
            await saveLocal();
            setSyncStatus("conflict", "Conflito de sincronização");
            show("Há alterações em dois dispositivos. Escolha qual versão deseja manter.", null, { announce: false });
            return false;
          }
          setSyncStatus("pending", "Sincronização pendente");
          await saveLocal().catch((saveError) => console.error("Não foi possível registrar a falha de sincronização.", saveError));
          show(
            error.message === "GOOGLE_DRIVE_INVALID_DOCUMENT"
              ? "A cópia no Google Drive parece inválida. Seus dados locais foram preservados."
              : error.message === "GOOGLE_DRIVE_UNSUPPORTED_SCHEMA"
                ? "A cópia no Google Drive foi criada por uma versão mais nova do aplicativo. Seus dados locais foram preservados."
                : error.message === "GOOGLE_DRIVE_TIMEOUT"
              ? "O Google Drive demorou para responder. A alteração está salva neste dispositivo e será enviada na próxima tentativa."
              : "Alteração salva neste dispositivo e aguardando conexão para sincronizar.",
            null,
            { announce: false },
          );
          return false;
        }
      }

      async function flushSynchronization() {
        if (scheduledSyncTimer) {
          clearTimeout(scheduledSyncTimer);
          scheduledSyncTimer = null;
        }
        if (!state.user || !navigator.onLine || !googleAuth.hasAccessToken()) {
          setSyncStatus("pending", navigator.onLine ? "Reconecte o Google para sincronizar" : "Sem conexão");
          return false;
        }
        if (activeSyncPromise) {
          syncRequestedWhileActive = true;
          return activeSyncPromise;
        }

        activeSyncPromise = (async () => {
          let synced = false;
          do {
            syncRequestedWhileActive = false;
            synced = await performSynchronization();
          } while (
            synced
            && syncRequestedWhileActive
            && hasPendingChanges()
            && navigator.onLine
            && googleAuth.hasAccessToken()
          );
          return synced;
        })();

        try {
          return await activeSyncPromise;
        } finally {
          activeSyncPromise = null;
        }
      }

      function scheduleSynchronization() {
        if (!state.user || !navigator.onLine || !googleAuth.hasAccessToken()) {
          setSyncStatus("pending", navigator.onLine ? "Reconecte o Google para sincronizar" : "Sem conexão");
          return;
        }
        if (activeSyncPromise) {
          syncRequestedWhileActive = true;
          return;
        }
        if (scheduledSyncTimer) clearTimeout(scheduledSyncTimer);
        setSyncStatus("queued", "Alterações salvas neste aparelho. Aguardando envio ao Google Drive.");
        scheduledSyncTimer = setTimeout(() => {
          scheduledSyncTimer = null;
          flushSynchronization().catch((error) => console.error(error));
        }, SYNC_DEBOUNCE_MS);
      }

      async function save({ waitForSync = false } = {}) {
        await saveLocal();
        if (!hasPendingChanges()) return true;
        if (waitForSync) return flushSynchronization();
        scheduleSynchronization();
        return false;
      }

      function hasPendingChanges() {
        return state.syncQueue.length > 0 || state.settingsDirty || state.recurrenceDirty;
      }

      async function retryPendingSynchronization() {
        if (!state.user || !hasPendingChanges()) return true;
        const synced = await save({ waitForSync: true });
        if (synced) {
          render();
          show("Alterações pendentes foram sincronizadas.", null, { announce: false });
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
          : '<button class="auth-button" id="reconnectGoogle" type="button" aria-label="Autorizar Google Drive para sincronizar" title="Autorizar sincronização"><span aria-hidden="true">↻</span><span class="button-label">Sincronizar</span></button>';
        authArea.innerHTML = `<span class="signed-user" title="${esc(state.user.email || "")}">${esc(name || "Usuário")}</span>${reconnectButton}<button class="auth-button" id="signOut" type="button" aria-label="Sair da conta" title="Sair da conta"><span aria-hidden="true">⎋</span><span class="button-label">Sair</span></button>`;
      }

      async function syncEntries() {
        if (!state.user) {
          setSyncStatus("idle", "Entre para sincronizar");
          return;
        }
        repository.beginSync?.();
        await synchronization.syncEntries(state.user.id);
      }

      function cancelSynchronization() {
        if (syncStatus.dataset.state !== "syncing") return;
        syncNoticeAction.disabled = true;
        syncNoticeAction.textContent = "Cancelando...";
        syncNoticeAction.setAttribute("aria-label", "Cancelando sincronização");
        repository.cancelPendingRequests?.();
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
        missing.forEach((entry) => {
          state.entries.push(entry);
          queueUpsert(entry);
        });
        return missing.length;
      }

      async function loadCloudRecurrenceSeries({ preserveLocalDirty = false } = {}) {
        if (preserveLocalDirty && state.recurrenceDirty) return;
        state.recurrenceSeries = await repository.fetchRecurrenceSeries();
        state.recurrenceDirty = false;
        let generatedEntries = 0;
        for (const series of state.recurrenceSeries) {
          generatedEntries += await materializeRecurrenceSeries(series);
        }
        if (generatedEntries) await save({ waitForSync: true });
        maybeOpenOnboarding();
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
      async function loadCloudSettings({ preserveLocalDirty = false } = {}) {
        if (preserveLocalDirty && state.settingsDirty) return;
        const data = await repository.fetchSettings();
        if (data) {
          state.settings = normalizeSettings(data);
          state.types = profileOptions(data.types, defaultTypes);
          state.descriptions = profileOptions(data.descriptions, defaultDescriptions);
          state.customDescriptionOptionsByType = data.customDescriptionOptionsByType || {};
          state.hiddenTypes = data.hiddenTypes || [];
          state.hiddenDescriptionsByType = data.hiddenDescriptionsByType || {};
          state.settingsDirty = false;
        } else {
          await syncSettings();
          state.settingsDirty = false;
        }
        await saveLocal();
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
          localStore.requestPersistence?.().catch((error) => console.error(error));
          if (!googleAuth.hasAccessToken()) {
            setSyncStatus(state.syncConflict ? "conflict" : "pending", state.syncConflict ? "Conflito de sincronização" : "Autorize o Google Drive para sincronizar");
            render();
            return;
          }
          let hasPendingSync = false;
          try {
            recordSyncAttempt();
            normalizeEntryIds();
            if (hasPendingChanges()) {
              // Envie todas as coleções locais antes de ler a nuvem. Se o envio
              // falhar, os loaders abaixo preservam cada coleção ainda marcada
              // como dirty para não descartar uma edição feita offline.
              hasPendingSync = !(await performSynchronization());
            }
            await loadCloudEntries();
            await loadCloudSettings({ preserveLocalDirty: hasPendingSync });
            await loadCloudRecurrenceSeries({ preserveLocalDirty: hasPendingSync });
            if (new URLSearchParams(window.location.search).get("restore-financiamento") === "1") {
              const restored = await restoreTodayFinancingTypes();
              window.history.replaceState({}, "", window.location.pathname);
              show(restored ? `${restored} tipo${restored === 1 ? "" : "s"} restaurado${restored === 1 ? "" : "s"} com segurança.` : "Nenhum tipo alterado hoje precisou ser restaurado.");
            }
            if (!hasPendingSync) await markSynchronizationComplete();
            else await saveLocal();
          } catch (error) {
            recordSyncFailure(error);
            console.error(error);
            setSyncStatus("pending", "Sincronização pendente");
            await saveLocal();
            show(
              error.message === "GOOGLE_DRIVE_INVALID_DOCUMENT"
                ? "A cópia no Google Drive parece inválida. Seus dados locais foram preservados."
                : error.message === "GOOGLE_DRIVE_UNSUPPORTED_SCHEMA"
                  ? "A cópia no Drive foi criada por uma versão mais nova. Atualize o aplicativo antes de sincronizar."
                  : error.message === "GOOGLE_DRIVE_TIMEOUT"
                ? "O Google Drive demorou para responder. Seus dados locais foram preservados e a sincronização será tentada novamente."
                : "Não foi possível concluir a sincronização agora. Seus dados locais foram preservados.",
              null,
              { announce: false },
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
          const user = await googleAuth.signIn({ loginHint: state.user?.email || "" });
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

      async function restoreTodayFinancingTypes() {
        if (!state.user || !repository.fetchLegacyEntries) return 0;
        const baseEntries = await repository.fetchLegacyEntries();
        const originalTypes = new Map(baseEntries.map((entry) => [entry.id, entry.type]));
        const today = todayISO();
        let restored = 0;
        state.entries.forEach((entry) => {
          const originalType = originalTypes.get(entry.id);
          const changedToday = entry.updated_at?.slice(0, 10) === today;
          if (changedToday && entry.type === "FINANCIAMENTO" && originalType && originalType !== "FINANCIAMENTO") {
            entry.type = originalType;
            queueUpsert(entry);
            restored++;
          }
        });
        if (restored) await save();
        return restored;
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
          else setSyncStatus("pending", "Autorize o Google Drive para sincronizar");
          return;
        }

        const originalLabel = trigger?.textContent;
        if (trigger) {
          trigger.disabled = true;
          trigger.setAttribute("aria-busy", "true");
          trigger.textContent = "Sincronizando...";
        }
        recordSyncAttempt();
        setSyncStatus("syncing", "Sincronizando com o Google Drive");

        try {
          repository.beginSync?.();
          await repository.load();
          const synced = await retryPendingSynchronization();
          await loadCloudEntries();
          await loadCloudSettings({ preserveLocalDirty: !synced });
          await loadCloudRecurrenceSeries({ preserveLocalDirty: !synced });
          if (!synced) {
            await saveLocal();
            render();
            return false;
          }
          await markSynchronizationComplete();
          render();
          show("Dados sincronizados com o Google Drive.", null, { announce: false });
          return true;
        } catch (error) {
          recordSyncFailure(error);
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
          await saveLocal().catch((saveError) => console.error("Não foi possível registrar a falha de sincronização.", saveError));
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
        const action = syncNoticeAction.dataset.action;
        if (action === "cancel") return cancelSynchronization();
        if (action === "authorize") return signInWithGoogle(syncNoticeAction);
        if (action === "restore-backup") return openBackupRecovery();
        if (action === "update-app") return verifyApplicationUpdate(syncNoticeAction);
        if (action === "resolve-conflict") {
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
        if (document.visibilityState !== "visible" || !state.user || !googleAuth.hasAccessToken()) return;
        retryPendingSynchronization()
          .then(async (synced) => {
            await repository.load();
            await loadCloudEntries();
            await loadCloudSettings({ preserveLocalDirty: !synced });
            await loadCloudRecurrenceSeries({ preserveLocalDirty: !synced });
            render();
          })
          .catch((error) => {
            recordSyncFailure(error);
            setSyncStatus("pending", "Sincronização pendente");
            saveLocal().catch((saveError) => console.error("Não foi possível registrar a falha de sincronização.", saveError));
            console.error(error);
          });
      });

      window.addEventListener("online", () => {
        retrySynchronization().catch((error) => console.error(error));
      });

      window.addEventListener("offline", () => {
        if (state.user) setSyncStatus("pending", "Sem conexão");
      });

      window.addEventListener("beforeunload", (event) => {
        if (appReloadRequested || !state.user || !hasPendingChanges()) return;
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

      function selectOption(select, value) {
        const selectedIndex = [...select.options].findIndex((option) => option.value === value);
        select.selectedIndex = selectedIndex >= 0 ? selectedIndex : 0;
      }

      function entryTypeOptions(selectedType = "") {
        return [...state.types, selectedType]
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

      function renderEntryOptions(
        selectedType = type.value,
        selectedDescription = desc.value,
      ) {
        selectedType = selectedType === "__new__" ? "" : selectedType;
        selectedDescription = selectedDescription === "__new__" ? "" : selectedDescription;
        fill(type, entryTypeOptions(selectedType), "Selecione", true);
        selectOption(type, selectedType);
        fill(desc, entryDescriptionOptions(selectedType, selectedDescription), "Selecione", true);
        selectOption(desc, selectedDescription);
        desc.disabled = !selectedType;
      }

      function renderOptionManagement({
        selectedType = deleteTypeOption.value,
        descriptionType = deleteDescriptionType.value,
        selectedDescription = deleteDescriptionOption.value,
      } = {}) {
        selectedType = selectedType === "__new__" ? "" : selectedType;
        descriptionType = descriptionType === "__new__" ? "" : descriptionType;
        selectedDescription = selectedDescription === "__new__" ? "" : selectedDescription;
        fill(deleteTypeOption, entryTypeOptions(), "Selecione o tipo", true);
        selectOption(deleteTypeOption, selectedType);
        fill(deleteDescriptionType, entryTypeOptions(), "Selecione o tipo", true);
        selectOption(deleteDescriptionType, descriptionType);
        fill(deleteDescriptionOption, entryDescriptionOptions(descriptionType), "Selecione a descrição", true);
        selectOption(deleteDescriptionOption, selectedDescription);
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
        managerSelectionSummary.textContent = managerSelectedEntries.size
          ? `${managerSelectedEntries.size} selecionado${managerSelectedEntries.size === 1 ? "" : "s"}`
          : "Selecione registros para editar em lote.";
        managerToggleBulk.disabled = managerSelectedEntries.size === 0;
        managerBulkEditor.hidden = !managerBulkEditor.classList.contains("visible");
        recordsManagerList.innerHTML = entries.length
          ? entries.map((entry) => `<article class="managed-record">
              <input type="checkbox" data-manager-select="${entry.id}" ${managerSelectedEntries.has(entry.id) ? "checked" : ""} aria-label="Selecionar ${esc(entry.description)}" />
              <div><strong>${esc(entry.description)}</strong><small>${new Date(`${entry.date}T12:00`).toLocaleDateString("pt-BR")} · ${esc(entry.type)} · ${entry.paid ? "Pago" : "Em aberto"} · ${money(entry.value)}</small></div>
              <button class="secondary" type="button" data-manager-edit="${entry.id}" aria-label="Editar ${esc(entry.description)}">✏</button>
            </article>`).join("")
          : '<div class="recent-records-empty">Nenhum registro encontrado com estes filtros.</div>';
      }

      function openRecordsManagerDialog() {
        managerSelectedEntries.clear();
        managerFilterType.value = "";
        managerFilterDescription.value = "";
        managerFilterStatus.value = "";
        managerBulkType.value = "";
        managerBulkDescription.value = "";
        managerBulkEditor.classList.remove("visible");
        managerBulkEditor.hidden = true;
        renderRecordsManager();
        if (settingsDialog.open) settingsDialog.close();
        requestAnimationFrame(() => {
          if (!recordsManagerDialog.open) recordsManagerDialog.showModal();
        });
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
          <article class="entry dense-entry ${selected ? "selected" : ""} ${statusPending ? "status-pending" : ""} ${statusChanged ? "status-changed" : ""}" data-entry="${e.id}" role="${state.selectionMode ? "button" : "group"}" ${state.selectionMode ? `tabindex="0" aria-pressed="${selected}"` : ""} aria-busy="${statusPending}" aria-label="${state.selectionMode ? `Selecionar ${esc(e.description)}` : `${esc(e.description)}, ${money(e.value)}, ${statusLabel}. Toque para editar.`}">
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
          </article>`;
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

      function updateDecisionOverview(month) {
        const [year, monthNumber] = month.split("-").map(Number);
        const monthEnd = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`;
        const entryNet = buildDailyEntryNet();
        const currentBalance = getProjectedBalance(todayISO(), entryNet);
        const monthEndBalance = getProjectedBalance(monthEnd, entryNet);
        const nextSevenDaysEnd = domain.addDays(todayISO(), 6);
        const upcomingEntries = state.entries.filter((entry) =>
          !entry.excluded_from_series
          && !entry.paid
          && (entry.flow_type || "expense") === "expense"
          && entry.date >= todayISO()
          && entry.date <= nextSevenDaysEnd
        );
        const upcomingTotal = upcomingEntries.reduce((total, entry) => total + Number(entry.value), 0);
        const upcomingIncomeTotal = state.entries
          .filter((entry) =>
            !entry.excluded_from_series
            && !entry.paid
            && entry.flow_type === "income"
            && entry.date >= todayISO()
            && entry.date <= nextSevenDaysEnd
          )
          .reduce((total, entry) => total + Number(entry.value), 0);
        const sevenDayMinimum = domain.minimumProjectedBalance(
          todayISO(),
          nextSevenDaysEnd,
          state.settings,
          entryNet,
        );
        const monthLabel = new Date(year, monthNumber - 1, 1, 12).toLocaleDateString("pt-BR", {
          month: "long",
          year: "numeric",
        });

        decisionPeriodLabel.textContent = `Visão de ${monthLabel}`;
        currentBalanceTotal.textContent = money(currentBalance);
        monthEndBalanceTotal.textContent = money(monthEndBalance);
        monthEndBalanceTotal.dataset.negative = String(monthEndBalance < 0);
        nextSevenDaysTotal.textContent = money(upcomingTotal);
        nextSevenDaysSummary.textContent = upcomingEntries.length
          ? `${upcomingEntries.length} conta${upcomingEntries.length === 1 ? "" : "s"} em aberto`
          : "Nenhuma conta em aberto";

        if (monthEndBalance < 0) {
          financialGuidance.dataset.tone = "danger";
          financialGuidanceTitle.textContent = "Saldo negativo previsto";
          financialGuidanceDetail.textContent = `A projeção indica ${money(Math.abs(monthEndBalance))} abaixo de zero no fim do mês.`;
        } else if (upcomingEntries.length && sevenDayMinimum.balance < 0) {
          financialGuidance.dataset.tone = "danger";
          financialGuidanceTitle.textContent = "Contas próximas acima do saldo previsto";
          const minimumDate = new Date(`${sevenDayMinimum.date}T12:00`).toLocaleDateString("pt-BR");
          financialGuidanceDetail.textContent = upcomingIncomeTotal > 0
            ? `Mesmo considerando ${money(upcomingIncomeTotal)} de receitas a receber, o saldo pode ficar ${money(Math.abs(sevenDayMinimum.balance))} abaixo de zero em ${minimumDate}.`
            : `O saldo pode ficar ${money(Math.abs(sevenDayMinimum.balance))} abaixo de zero em ${minimumDate}.`;
        } else if (upcomingEntries.length) {
          financialGuidance.dataset.tone = "attention";
          financialGuidanceTitle.textContent = `${upcomingEntries.length} conta${upcomingEntries.length === 1 ? "" : "s"} nos próximos 7 dias`;
          financialGuidanceDetail.textContent = upcomingIncomeTotal > 0
            ? `${money(upcomingTotal)} vencem no período; ${money(upcomingIncomeTotal)} de receitas a receber já foram consideradas na projeção.`
            : `${money(upcomingTotal)} precisam de atenção nesse período.`;
        } else {
          financialGuidance.dataset.tone = "positive";
          financialGuidanceTitle.textContent = "Tudo sob controle";
          financialGuidanceDetail.textContent = "Não há contas em aberto para os próximos 7 dias.";
        }
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
        updateDecisionOverview(month);
        const referenceDate = state.settings.balance_reference_date || todayISO();
        balanceReferenceSummary.textContent = `Calculado desde ${new Date(`${referenceDate}T12:00`).toLocaleDateString("pt-BR")}`;

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
        openRecordsManagerMain.hidden = state.selectionMode;
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

      function updateEntryFormValidity() {
        const totalValue = Number(valueInput.value);
        const invalidValue = valueInput.value !== ""
          && (totalValue === 0 || ((isRecurringValue() || flowType.value === "income") && totalValue < 0));
        valueInput.setCustomValidity(invalidValue ? "Informe um valor maior que zero." : "");

        const invalidEndDate = isRecurringValue()
          && endMode.value === "on_date"
          && endDate.value !== ""
          && dateInput.value !== ""
          && endDate.value < dateInput.value;
        endDate.setCustomValidity(
          invalidEndDate ? "A data final deve ser igual ou posterior à data inicial." : "",
        );
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
        updateEntryFormValidity();
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

      function onboardingCategoryLabel(value) {
        const lower = value.toLocaleLowerCase("pt-BR");
        return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
      }

      function renderOnboardingCategories() {
        const visibleTypes = new Set(
          state.types.filter((option) => !state.hiddenTypes.includes(option)),
        );
        onboardingCategoryOptions.innerHTML = defaultTypes.map((option, index) => `
          <label class="onboarding-category-option" for="onboarding-category-${index}">
            <input
              id="onboarding-category-${index}"
              type="checkbox"
              name="onboarding-category"
              value="${esc(option)}"
              ${visibleTypes.has(option) ? "checked" : ""}
            />
            <span>${esc(onboardingCategoryLabel(option))}</span>
          </label>
        `).join("");
      }

      function maybeOpenOnboarding() {
        const isNewProfile = state.settings.onboarding_status === "pending"
          && state.entries.length === 0
          && state.recurrenceSeries.length === 0;
        if (!state.user || !isNewProfile || onboardingDialog.open) return;
        onboardingBalance.value = state.settings.current_balance;
        onboardingReferenceDate.value = state.settings.balance_reference_date || todayISO();
        onboardingCategoryError.hidden = true;
        renderOnboardingCategories();
        onboardingDialog.showModal();
        requestAnimationFrame(() => onboardingBalance.focus());
      }

      async function finishOnboarding({ skipped = false } = {}) {
        const selectedCategories = [...onboardingCategoryOptions.querySelectorAll("input:checked")]
          .map((input) => input.value);
        if (!skipped && selectedCategories.length === 0) {
          onboardingCategoryError.hidden = false;
          onboardingCategoryOptions.querySelector("input")?.focus();
          return;
        }

        onboardingCategoryError.hidden = true;
        const activeButton = skipped ? skipOnboarding : saveOnboarding;
        const resetButton = setButtonBusy(
          activeButton,
          true,
          skipped ? "Pulando..." : "Preparando...",
        );
        const inactiveButton = skipped ? saveOnboarding : skipOnboarding;
        inactiveButton.disabled = true;

        try {
          state.settings = {
            ...state.settings,
            current_balance: skipped ? state.settings.current_balance : Number(onboardingBalance.value),
            balance_reference_date: skipped
              ? state.settings.balance_reference_date
              : onboardingReferenceDate.value,
            onboarding_status: "completed",
          };
          if (!skipped) {
            state.hiddenTypes = defaultTypes.filter((option) => !selectedCategories.includes(option));
          }
          state.settingsDirty = true;
          await save();
          onboardingDialog.close();
          render();
          show(skipped
            ? "Configuração inicial pulada. Você pode ajustar a projeção nas configurações."
            : "Tudo pronto. Sua projeção financeira já usa o saldo informado.");
        } catch (error) {
          console.error(error);
          show("Não foi possível salvar a configuração inicial. Tente novamente.");
        } finally {
          resetButton();
          inactiveButton.disabled = false;
        }
      }

      async function openBackupRecovery() {
        if (!settingsDialog.open) openSettingsDialog();
        const backups = await loadGoogleDriveBackups();
        const target = backups.length ? driveBackupSelect : loadDriveBackups;
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.focus({ preventScroll: true });
      }

      async function verifyApplicationUpdate(trigger) {
        const resetButton = setButtonBusy(trigger, true, "Verificando...");
        try {
          const registration = await navigator.serviceWorker?.getRegistration();
          await registration?.update();
          appReloadRequested = true;
          window.location.reload();
        } catch (error) {
          console.error(error);
          resetButton();
          show("Não foi possível verificar a atualização agora. Tente novamente quando estiver conectado.");
        }
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

      function createBackupSnapshot() {
        return {
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
      }

      function setButtonBusy(button, busy, busyLabel) {
        if (!button) return () => {};
        const label = button.textContent;
        button.disabled = busy;
        button.toggleAttribute("aria-busy", busy);
        if (busy) button.textContent = busyLabel;
        return () => {
          button.disabled = false;
          button.removeAttribute("aria-busy");
          button.textContent = label;
        };
      }

      async function createGoogleDriveBackup() {
        if (!state.user || !googleAuth.hasAccessToken()) {
          show("Reconecte o Google para criar um backup no Drive.");
          return;
        }
        const resetButton = setButtonBusy(createDriveBackup, true, "Criando...");
        try {
          await repository.createDriveBackup(createBackupSnapshot());
          show("Backup completo criado no Google Drive.");
          await loadGoogleDriveBackups();
        } catch (error) {
          console.error(error);
          show("Não foi possível criar o backup no Google Drive agora.");
        } finally {
          resetButton();
        }
      }

      async function loadGoogleDriveBackups() {
        if (!state.user || !googleAuth.hasAccessToken()) {
          show("Reconecte o Google para consultar seus backups.");
          return [];
        }
        const resetButton = setButtonBusy(loadDriveBackups, true, "Carregando...");
        try {
          const backups = await repository.listDriveBackups();
          driveBackupSelect.innerHTML = '<option value="">Selecione um backup</option>';
          backups.forEach((backup) => {
            const date = backup.name.slice("meus-gastos-backup-".length, -5).replace(/-(\d{3})Z$/, ".$1Z").replace(/-/g, (match, index, value) => index > 9 ? ":" : match);
            const option = document.createElement("option");
            option.value = backup.id;
            option.textContent = date ? `Backup ${date.replace("T", " ").replace("Z", " UTC")}` : backup.name;
            driveBackupSelect.append(option);
          });
          restoreDriveBackup.disabled = true;
          show(backups.length ? `${backups.length} backup${backups.length === 1 ? " encontrado" : "s encontrados"} no Google Drive.` : "Nenhum backup do Google Drive foi encontrado.");
          return backups;
        } catch (error) {
          console.error(error);
          show("Não foi possível consultar os backups agora.");
          return [];
        } finally {
          resetButton();
        }
      }

      async function restoreGoogleDriveBackup() {
        const id = driveBackupSelect.value;
        if (!id) return;
        if (!confirm("Restaurar este backup substituirá os lançamentos, opções e recorrências atuais. Deseja continuar?")) return;
        const resetButton = setButtonBusy(restoreDriveBackup, true, "Restaurando...");
        try {
          const backup = await repository.fetchDriveBackup(id);
          await repository.createDriveBackup(createBackupSnapshot());
          const settings = backup.settings;
          const previousEntries = state.entries;
          state.entries = structuredClone(backup.entries);
          state.recurrenceSeries = structuredClone(backup.recurrenceSeries || []);
          state.settings = normalizeSettings(settings);
          state.types = profileOptions(settings.types, defaultTypes);
          state.descriptions = profileOptions(settings.descriptions, defaultDescriptions);
          state.customDescriptionOptionsByType = settings.customDescriptionOptionsByType || {};
          state.hiddenTypes = settings.hiddenTypes || [];
          state.hiddenDescriptionsByType = settings.hiddenDescriptionsByType || {};
          state.settingsDirty = true;
          state.recurrenceDirty = true;
          const restoredIds = new Set(state.entries.map((entry) => entry.id));
          previousEntries.filter((entry) => !restoredIds.has(entry.id)).forEach((entry) => queueDelete(entry.id, entry.updated_at));
          state.entries.forEach((entry) => queueUpsert(entry));
          await save();
          render();
          show("Backup restaurado. Uma cópia dos dados anteriores foi criada no Drive e a sincronização foi iniciada.");
        } catch (error) {
          console.error(error);
          show(error.message === "BACKUP_INVALID" ? "Este arquivo não é um backup válido do Meus Gastos." : "Não foi possível restaurar o backup agora.");
        } finally {
          resetButton();
        }
      }

      async function addOption(key, descriptionType = type.value, onCreated = null) {
        const value = await new Promise((resolve) => {
          optionDialogTitle.textContent = key === "types" ? "Novo tipo" : "Nova descrição";
          optionDialogDescription.textContent = key === "types"
            ? "Crie uma opção para classificar lançamentos futuros."
            : `Crie uma descrição para ${descriptionType}.`;
          optionName.value = "";
          optionDialogResolver = resolve;
          optionDialog.showModal();
          optionName.focus();
        });
        if (!value?.trim()) return null;

        const clean = value.trim().toUpperCase();
        if (key === "types") {
          state.types = sortedOptions([...state.types, clean]);
          state.hiddenTypes = state.hiddenTypes.filter((item) => item !== clean);
        } else {
          const selectedType = descriptionType;
          if (!selectedType) return null;
          state.descriptions = sortedOptions([...state.descriptions, clean]);
          state.customDescriptionOptionsByType = {
            ...state.customDescriptionOptionsByType,
            [selectedType]: sortedOptions([
              ...(state.customDescriptionOptionsByType[selectedType] || []),
              clean,
            ]),
          };
          state.hiddenDescriptionsByType = {
            ...state.hiddenDescriptionsByType,
            [selectedType]: (state.hiddenDescriptionsByType[selectedType] || []).filter((item) => item !== clean),
          };
        }
        state.settingsDirty = true;
        onCreated?.(clean);
        await save();
        renderOptionManagement();
        return clean;
      }

      function addMonths(dateString, months) {
        const d = new Date(dateString + "T12:00");
        d.setMonth(d.getMonth() + months);
        return d.toISOString().slice(0, 10);
      }
      let toastTimer = null;
      function show(msg, action = null, { announce = true } = {}) {
        clearTimeout(toastTimer);
        toast.setAttribute("role", announce ? "status" : "presentation");
        toast.setAttribute("aria-live", announce ? "polite" : "off");
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
            toast.setAttribute("role", "status");
            toast.setAttribute("aria-live", "polite");
            action.onClick();
          };
          toast.appendChild(button);
        }
        toast.classList.add("show");
        toastTimer = setTimeout(() => {
          toast.classList.remove("show");
          toast.setAttribute("role", "status");
          toast.setAttribute("aria-live", "polite");
        }, action ? 5000 : 2400);
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
        series.updated_at = new Date().toISOString();
        state.recurrenceSeries.push(series);
        state.recurrenceDirty = true;
        await materializeRecurrenceSeries(series);
      }

      async function removeGeneratedSeriesEntries(seriesId, fromScheduledDate = null) {
        const removed = state.entries.filter((entry) => {
          if (entry.series_id !== seriesId || entry.detached_from_series) return false;
          return !fromScheduledDate || entry.scheduled_date >= fromScheduledDate;
        });
        removed.forEach((entry) => queueDelete(entry.id, entry.updated_at));
        state.entries = state.entries.filter((entry) => {
          if (entry.series_id !== seriesId || entry.detached_from_series) return true;
          return fromScheduledDate && entry.scheduled_date < fromScheduledDate;
        });
      }

      function removeSeriesEntries(seriesId, fromScheduledDate = null) {
        const removed = state.entries.filter((entry) =>
          entry.series_id === seriesId
          && (!fromScheduledDate || entry.scheduled_date >= fromScheduledDate),
        );
        removed.forEach((entry) => queueDelete(entry.id, entry.updated_at));
        const removedIds = new Set(removed.map((entry) => entry.id));
        state.entries = state.entries.filter((entry) => !removedIds.has(entry.id));
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
          shortened.updated_at = new Date().toISOString();
          const originalIndex = state.recurrenceSeries.findIndex((series) => series.id === original.id);
          state.recurrenceSeries[originalIndex] = shortened;
          state.recurrenceDirty = true;
          await removeGeneratedSeriesEntries(original.id, cutDate);

          const nextSeries = recurrenceSeriesFromForm(generateId(), dateInput.value);
          nextSeries.updated_at = new Date().toISOString();
          state.recurrenceSeries.push(nextSeries);
          state.recurrenceDirty = true;
          await materializeRecurrenceSeries(nextSeries);
          return "future";
        }

        const updated = {
          ...original,
          ...recurrenceSeriesFromForm(original.id, original.start_date),
          start_date: original.start_date,
        };
        updated.updated_at = new Date().toISOString();
        const index = state.recurrenceSeries.findIndex((series) => series.id === original.id);
        state.recurrenceSeries[index] = updated;
        state.recurrenceDirty = true;
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

      function closeDeleteConfirmation() {
        pendingDeletionAction = null;
        if (deleteConfirmDialog.open) deleteConfirmDialog.close();
      }

      function requestDeleteConfirmation({ title, description, entryLabel, confirmLabel = "Excluir", onConfirm }) {
        pendingDeletionAction = onConfirm;
        deleteConfirmTitle.textContent = title;
        deleteConfirmDescription.textContent = description;
        deleteConfirmEntry.textContent = entryLabel;
        confirmDelete.textContent = confirmLabel;
        deleteConfirmDialog.showModal();
      }

      async function performDeleteEntry(entry) {
        const originalIndex = state.entries.findIndex((item) => item.id === entry.id);
        const snapshot = structuredClone(entry);
        state.entries = state.entries.filter((item) => item.id !== entry.id);
        queueDelete(entry.id, entry.updated_at);
        closeContextMenu();
        render();
        await save();
        show("Lançamento excluído.", {
          label: "Desfazer",
          onClick: async () => {
            if (state.entries.some((item) => item.id === snapshot.id)) return;
            state.entries.splice(Math.max(0, Math.min(originalIndex, state.entries.length)), 0, snapshot);
            state.deletedEntryIds.delete(snapshot.id);
            queueUpsert(snapshot);
            render();
            await save();
            show("Lançamento restaurado.");
          },
        });
      }

      function deleteEntry() {
        const entry = getActiveEntry();
        if (!entry) return;
        if (entry.series_id) {
          closeContextMenu();
          seriesScopeDialog.showModal();
          return;
        }
        closeContextMenu();
        requestDeleteConfirmation({
          title: "Excluir lançamento?",
          description: "O lançamento será removido da sua lista e sincronizado com o Google Drive.",
          entryLabel: `${entry.description} · ${money(entry.value)}`,
          onConfirm: () => performDeleteEntry(entry),
        });
      }

      async function deleteRecurringScope(scope) {
        const entry = getActiveEntry();
        if (!entry?.series_id) return;
        const series = state.recurrenceSeries.find((item) => item.id === entry.series_id);
        const seriesIndex = state.recurrenceSeries.findIndex((item) => item.id === entry.series_id);
        const seriesSnapshot = series ? structuredClone(series) : null;
        const entriesSnapshot = state.entries
          .filter((item) => item.series_id === entry.series_id)
          .map((item) => structuredClone(item));
        const cutDate = entry.scheduled_date || entry.date;
        if (scope === "this") {
          entry.detached_from_series = true;
          entry.excluded_from_series = true;
          queueUpsert(entry);
          await save();
        } else if (scope === "future" && series && cutDate > series.start_date) {
          const shortened = {
            ...series,
            end_mode: "on_date",
            end_date: domain.addDays(cutDate, -1),
            occurrence_count: null,
          };
          shortened.updated_at = new Date().toISOString();
          const index = state.recurrenceSeries.findIndex((item) => item.id === series.id);
          state.recurrenceSeries[index] = shortened;
          state.recurrenceDirty = true;
          removeSeriesEntries(series.id, cutDate);
        } else {
          removeSeriesEntries(entry.series_id);
          state.recurrenceSeries = state.recurrenceSeries.filter((item) => item.id !== entry.series_id);
          state.recurrenceDirty = true;
        }
        seriesScopeDialog.close();
        render();
        await save();
        const successMessage = scope === "this"
          ? "Ocorrência excluída."
          : scope === "future"
            ? "Esta e as próximas ocorrências foram excluídas."
            : "Série recorrente excluída.";
        show(successMessage, {
          label: "Desfazer",
          onClick: async () => {
            const snapshotIds = new Set(entriesSnapshot.map((item) => item.id));
            state.entries
              .filter((item) => item.series_id === entry.series_id && !snapshotIds.has(item.id))
              .forEach((item) => queueDelete(item.id, item.updated_at));
            state.entries = state.entries.filter((item) => item.series_id !== entry.series_id);
            entriesSnapshot.forEach((item) => {
              state.entries.push(item);
              state.deletedEntryIds.delete(item.id);
              queueUpsert(item);
            });
            if (seriesSnapshot) {
              state.recurrenceSeries = state.recurrenceSeries.filter((item) => item.id !== seriesSnapshot.id);
              state.recurrenceSeries.splice(
                Math.max(0, Math.min(seriesIndex, state.recurrenceSeries.length)),
                0,
                seriesSnapshot,
              );
              state.recurrenceDirty = true;
            }
            render();
            await save();
            show("Exclusão da recorrência desfeita.");
          },
        });
      }

      async function performDeleteSelectedEntries(selectedIds) {
        const snapshots = state.entries
          .map((entry, index) => ({ entry: structuredClone(entry), index }))
          .filter(({ entry }) => selectedIds.has(entry.id));
        state.entries = state.entries.filter(
          (entry) => !selectedIds.has(entry.id) || Boolean(entry.series_id),
        );
        snapshots.forEach(({ entry }) => {
          const currentEntry = state.entries.find((item) => item.id === entry.id);
          if (entry.series_id && currentEntry) {
            currentEntry.detached_from_series = true;
            currentEntry.excluded_from_series = true;
            queueUpsert(currentEntry);
          } else {
            queueDelete(entry.id, entry.updated_at);
          }
        });

        exitSelectionMode();
        await save();
        const total = snapshots.length;
        show(
          `${total} lançamento${total > 1 ? "s" : ""} excluído${total > 1 ? "s" : ""}.`,
          {
            label: "Desfazer",
            onClick: async () => {
              snapshots.sort((a, b) => a.index - b.index).forEach(({ entry, index }) => {
                const existing = state.entries.find((item) => item.id === entry.id);
                if (existing) Object.assign(existing, entry);
                else state.entries.splice(Math.max(0, Math.min(index, state.entries.length)), 0, entry);
                state.deletedEntryIds.delete(entry.id);
                queueUpsert(entry);
              });
              render();
              await save();
              show("Exclusão desfeita.");
            },
          },
        );
      }

      function deleteSelectedEntries() {
        const selectedIds = new Set(state.selectedEntries);
        const total = selectedIds.size;

        if (total === 0) {
          exitSelectionMode();
          return;
        }
        requestDeleteConfirmation({
          title: `Excluir ${total} lançamento${total > 1 ? "s" : ""}?`,
          description: "Os itens selecionados serão removidos da lista.",
          entryLabel: `${total} lançamento${total > 1 ? "s selecionados" : " selecionado"}`,
          confirmLabel: `Excluir ${total}`,
          onConfirm: () => performDeleteSelectedEntries(selectedIds),
        });
      }
      function fillForm(entry) {
        const series = entry.series_id
          ? state.recurrenceSeries.find((item) => item.id === entry.series_id)
          : null;
        dateInput.value = entry.date;
        valueInput.value = entry.value;
        flowType.value = entry.flow_type || "expense";
        renderEntryOptions(entry.type, entry.description);
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
      onboardingForm.onsubmit = async (event) => {
        event.preventDefault();
        if (!onboardingForm.reportValidity()) return;
        await finishOnboarding();
      };
      skipOnboarding.onclick = () => finishOnboarding({ skipped: true });
      onboardingDialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finishOnboarding({ skipped: true });
      });
      downloadBackup.onclick = downloadManualBackup;
      createDriveBackup.onclick = createGoogleDriveBackup;
      loadDriveBackups.onclick = loadGoogleDriveBackups;
      driveBackupSelect.onchange = () => { restoreDriveBackup.disabled = !driveBackupSelect.value; };
      restoreDriveBackup.onclick = restoreGoogleDriveBackup;
      deleteTypeOptionButton.onclick = removeTypeOption;
      deleteDescriptionOptionButton.onclick = removeDescriptionOption;
      deleteTypeOption.onchange = async () => {
        if (deleteTypeOption.value !== "__new__") return;
        const added = await addOption("types", undefined, (newType) => {
          renderOptionManagement({ selectedType: newType });
        });
        renderOptionManagement({ selectedType: added || "" });
        if (added) show(`Tipo “${added}” adicionado às opções de lançamento.`);
      };
      deleteDescriptionType.onchange = async () => {
        if (deleteDescriptionType.value === "__new__") {
          const added = await addOption("types", undefined, (newType) => {
            renderOptionManagement({ descriptionType: newType });
          });
          renderOptionManagement({ descriptionType: added || "" });
          if (added) show(`Tipo “${added}” adicionado às opções de lançamento.`);
          return;
        }
        renderOptionManagement();
      };
      deleteDescriptionOption.onchange = async () => {
        if (deleteDescriptionOption.value !== "__new__") return;
        const selectedType = deleteDescriptionType.value;
        const added = await addOption("descriptions", selectedType, (newDescription) => {
          renderOptionManagement({
            descriptionType: selectedType,
            selectedDescription: newDescription,
          });
        });
        renderOptionManagement({
          descriptionType: selectedType,
          selectedDescription: added || "",
        });
        if (added) show(`Descrição “${added}” adicionada às opções de ${selectedType}.`);
      };
      openRecentRecordsMain.onclick = () => openRecentRecordsDialog(false);
      openRecordsManagerMain.onclick = openRecordsManagerDialog;
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
      managerToggleBulk.onclick = () => {
        managerBulkEditor.classList.toggle("visible");
        managerBulkEditor.hidden = !managerBulkEditor.classList.contains("visible");
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
      document
        .querySelectorAll("[data-close-option]")
        .forEach((button) => (button.onclick = () => {
          optionDialog.close();
          optionDialogResolver?.(null);
          optionDialogResolver = null;
        }));
      optionForm.onsubmit = (event) => {
        event.preventDefault();
        if (!optionForm.reportValidity()) return;
        const value = optionName.value.trim();
        optionDialog.close();
        optionDialogResolver?.(value);
        optionDialogResolver = null;
      };
      optionDialog.addEventListener("cancel", () => {
        optionDialogResolver?.(null);
        optionDialogResolver = null;
      });
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
          const newType = await addOption("types", undefined, (createdType) => {
            renderEntryOptions(createdType, "");
          });
          renderEntryOptions(newType || "", "");
          return;
        }
        desc.value = "";
        renderEntryOptions();
      };
      desc.onchange = async () => {
        if (desc.value !== "__new__") return;
        const selectedType = type.value;
        const newDescription = await addOption("descriptions", selectedType, (createdDescription) => {
          renderEntryOptions(selectedType, createdDescription);
        });
        renderEntryOptions(selectedType, newDescription || "");
      };
      [flowType, recurrence, recurrenceInterval, customUnit, endMode, endDate, occurrenceCount, businessDayAdjustment]
        .forEach((control) => {
          control.onchange = updateEntryFormVisibility;
          control.oninput = updateEntryFormVisibility;
        });
      [dateInput, valueInput].forEach((control) => {
        control.onchange = updateEntryFormValidity;
        control.oninput = updateEntryFormValidity;
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

      deleteConfirmForm.onsubmit = async (event) => {
        event.preventDefault();
        const action = pendingDeletionAction;
        if (!action) return;
        pendingDeletionAction = null;
        confirmDelete.disabled = true;
        confirmDelete.setAttribute("aria-busy", "true");
        deleteConfirmDialog.close();
        try {
          await action();
        } finally {
          confirmDelete.disabled = false;
          confirmDelete.removeAttribute("aria-busy");
        }
      };
      document.querySelectorAll("[data-close-delete-confirm]").forEach((button) => {
        button.onclick = closeDeleteConfirmation;
      });
      deleteConfirmDialog.addEventListener("cancel", () => {
        pendingDeletionAction = null;
      });

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
          ...state.settings,
          current_balance: Number(currentBalanceInput.value),
          balance_reference_date: balanceReferenceDateInput.value,
        };
        state.settingsDirty = true;
        try {
          const synced = await save();
          settingsDialog.close();
          render();
          show(synced
            ? "Projeção financeira salva e sincronizada."
            : "Projeção salva neste dispositivo. A sincronização continuará em segundo plano.");
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

        const entry = state.entries.find((item) => item.id === card.dataset.entry);
        if (entry) editEntry(entry);
      });

      rows.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target !== e.target.closest("[data-entry]")) return;

        const card = e.target.closest("[data-entry]");
        if (!card) return;

        if (!state.selectionMode) return;
        e.preventDefault();
        toggleSelection(card.dataset.entry);
      });

      form.onsubmit = async (e) => {
        e.preventDefault();

        const editing = !!state.editingId;
        const editingEntry = state.entries.find((entry) => entry.id === state.editingId);

        const date = dateInput.value;
        const totalValue = Number(valueInput.value);
        const detail = detailInput.value.trim();
        const paid = paidInput.checked;

        updateEntryFormValidity();
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
        if ("serviceWorker" in navigator && window.isSecureContext) {
          navigator.serviceWorker.register("./sw.js").catch((error) => {
            console.warn("Não foi possível ativar o modo instalável/offline.", error);
          });
        }
      }

      startApp();
