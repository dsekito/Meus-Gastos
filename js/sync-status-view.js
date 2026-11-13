// What the sync status line, the sync notice and the settings summary say,
// for each synchronization state. Reads the app state; never changes it.
(function attachSyncStatusView(global) {
  function create({ state, elements, hasLocalOnlyRecovery, isLocalSession, pendingSyncCount, hasAccessToken,
    documentSizeWarningBytes }) {
    const { syncStatus, syncNotice, syncNoticeTitle, syncNoticeDetail, syncNoticeAction, settingsSyncSummary } = elements;

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
        return Number(state.syncDiagnostics?.documentSizeBytes || 0) >= documentSizeWarningBytes;
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
        if (isLocalSession() && !hasLocalOnlyRecovery()) {
          const title = document.createElement("strong");
          title.textContent = "Modo local · sem sincronização";
          const detail = document.createElement("span");
          detail.textContent = "Os dados ficam só neste aparelho e nada é enviado para a internet. Use “Conectar Google” no topo da tela para guardar uma cópia no seu Google Drive. Se limpar os dados do navegador, os lançamentos deste aparelho serão apagados.";
          settingsSyncSummary.replaceChildren(title, detail);
          return;
        }
        if (hasLocalOnlyRecovery()) {
          const title = document.createElement("strong");
          title.textContent = "Recuperação local · envio pausado";
          const detail = document.createElement("span");
          detail.textContent = "Os lançamentos recuperados estão apenas neste aparelho. Todo envio ao Drive, inclusive alterações futuras, está pausado por segurança. Guarde uma cópia local e não limpe os dados do navegador.";
          settingsSyncSummary.replaceChildren(title, detail);
          return;
        }
        const pending = pendingSyncCount();
        const pendingLabel = pending === 1 ? "1 alteração pendente de envio" : `${pending} alterações pendentes de envio`;
        const title = stateName === "conflict"
          ? "Conflito de sincronização"
          : pending > 0
            ? pendingLabel
            : state.lastSyncedAt ? "Cópia do Drive atualizada" : "Salvo neste aparelho";
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

      // Sem conta não há sincronização: o status é sempre "Modo local", com o
      // caminho para conectar o Google no cabeçalho.
      function showLocalModeStatus() {
        syncStatus.dataset.state = "local";
        syncNotice.dataset.state = "local";
        syncStatus.textContent = "Modo local";
        syncStatus.setAttribute("aria-label", "Modo local: dados salvos só neste aparelho, sem sincronização");
        syncNotice.hidden = true;
        syncNoticeTitle.textContent = "Modo local: dados só neste aparelho";
        syncNoticeDetail.textContent = "Nada é enviado para a internet. Conecte o Google para guardar uma cópia no seu Drive.";
        syncNoticeAction.hidden = false;
        syncNoticeAction.textContent = "Conectar Google";
        syncNoticeAction.dataset.action = "authorize";
        syncNoticeAction.setAttribute("aria-label", "Conectar sua conta Google para sincronizar");
        updateSettingsSyncSummary("local");
      }

      function setSyncStatus(stateName, message) {
        const syncDetails = document.querySelector("#syncDetails");
        const critical = hasLocalOnlyRecovery() || stateName === "conflict"
          || ["GOOGLE_DRIVE_INVALID_DOCUMENT", "GOOGLE_DRIVE_UNSUPPORTED_SCHEMA"].includes(state.syncDiagnostics?.lastErrorCode);
        if (syncDetails) {
          if (critical) syncDetails.open = true;
          else if (syncNotice.dataset.state !== stateName) syncDetails.open = false;
        }
        if (hasLocalOnlyRecovery()) {
          syncStatus.dataset.state = "local-only";
          syncNotice.dataset.state = "local-only";
          syncStatus.textContent = "Recuperação local · envio pausado";
          syncStatus.setAttribute("aria-label", "Recuperação salva apenas neste aparelho. Todo envio ao Google Drive está pausado por segurança.");
          syncNotice.hidden = false;
          syncNoticeTitle.textContent = "Recuperação salva apenas neste aparelho";
          syncNoticeDetail.textContent = "Todo envio ao Google Drive está pausado por segurança, inclusive alterações futuras. Não limpe os dados deste aparelho: a recuperação ainda não tem cópia sincronizada.";
          syncNoticeAction.hidden = true;
          syncNoticeAction.dataset.action = "";
          syncNoticeAction.removeAttribute("aria-label");
          updateSettingsSyncSummary("local-only");
          return;
        }
        if (isLocalSession()) {
          showLocalModeStatus();
          return;
        }
        const pending = pendingSyncCount();
        const pendingLabel = pending === 1 ? "1 alteração pendente de envio" : `${pending} alterações pendentes de envio`;
        syncStatus.dataset.state = stateName;
        syncNotice.dataset.state = stateName;
        updateSettingsSyncSummary(stateName);
        syncNoticeAction.dataset.action = "";
        syncNoticeAction.removeAttribute("aria-label");

        if (stateName === "synced") {
          syncStatus.textContent = "Tudo sincronizado";
          syncStatus.setAttribute("aria-label", `${formatLastSync()}; tudo sincronizado`);
          syncNotice.hidden = !isRemoteDocumentLarge();
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

        if (state.user && !hasAccessToken()) {
          syncStatus.textContent = pending > 0 ? "Envio pendente" : "Modo local";
          syncStatus.dataset.state = pending > 0 ? "pending" : "local";
          syncStatus.setAttribute("aria-label", "Sessão local ativa; autorize o Google Drive para sincronizar");
          syncNotice.hidden = pending === 0 && !critical;
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

    return { setStatus: setSyncStatus, updateSettingsSummary: updateSettingsSyncSummary };
  }

  global.MGSyncStatusView = { create };
})(window);
