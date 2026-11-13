// "Gerenciar registros": filter every record, select several and change
// their status, type or description at once. Owns its dialog and events.
(function attachRecordsManager(global) {
  function create({ state, domain, esc, money, fill, sortedOptions, entryTypeOptions, entryDescriptionOptions, confirmDialog,
    financialMutation, queueUpsert, render, show, pendingSyncMessage, editEntry, closeSettings }) {
    const recordsManagerDialog = document.querySelector("#recordsManagerDialog");
    const recordsManagerList = document.querySelector("#recordsManagerList");
    const recordsManagerCount = document.querySelector("#recordsManagerCount");
    const managerFilterType = document.querySelector("#managerFilterType");
    const managerFilterDescription = document.querySelector("#managerFilterDescription");
    const managerFilterStatus = document.querySelector("#managerFilterStatus");
    const managerSelectAll = document.querySelector("#managerSelectAll");
    const managerSelectionSummary = document.querySelector("#managerSelectionSummary");
    const managerToggleBulk = document.querySelector("#managerToggleBulk");
    const managerBulkEditor = document.querySelector("#managerBulkEditor");
    const managerMarkPaid = document.querySelector("#managerMarkPaid");
    const managerMarkPending = document.querySelector("#managerMarkPending");
    const managerBulkType = document.querySelector("#managerBulkType");
    const managerBulkDescription = document.querySelector("#managerBulkDescription");
    const managerApplyChanges = document.querySelector("#managerApplyChanges");
    const managerSelectedEntries = new Set();

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
            <input type="checkbox" data-manager-select="${esc(entry.id)}" ${managerSelectedEntries.has(entry.id) ? "checked" : ""} aria-label="Selecionar ${esc(entry.description)}" />
            <div><strong>${esc(entry.description)}</strong><small>${new Date(`${entry.date}T12:00`).toLocaleDateString("pt-BR")} · ${esc(entry.type)} · ${domain.entryStatusLabel(entry)} · ${money(entry.value)}</small></div>
            <button class="secondary" type="button" data-manager-edit="${esc(entry.id)}" aria-label="Editar ${esc(entry.description)}"><svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
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
      closeSettings();
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
      const changes = [paid === null ? null : paid ? "marcar como pago/recebido" : "marcar em aberto", nextType ? `tipo: ${nextType}` : null, nextDescription ? `descrição: ${nextDescription}` : null].filter(Boolean);
      if (changes.length && !await confirmDialog.ask({
        title: `Alterar ${managerSelectedEntries.size} registro(s)?`,
        description: "Somente os registros selecionados serão alterados.",
        details: changes.map((change) => change.charAt(0).toUpperCase() + change.slice(1)),
        confirmLabel: "Aplicar alterações",
      })) return;
      const selectedIds = new Set(managerSelectedEntries);
      managerApplyChanges.disabled = true;
      managerApplyChanges.setAttribute("aria-busy", "true");
      try {
        const result = await financialMutation(() => {
          let changed = 0;
          state.entries.forEach((entry) => {
            if (!selectedIds.has(entry.id)) return;
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
          return changed;
        });
        if (!result.ok) { renderRecordsManager(); return; }
        managerSelectedEntries.clear();
        renderRecordsManager();
        render();
        show(result.value ? `${result.value} registro(s) atualizado(s). ${pendingSyncMessage()}` : "Nenhuma alteração necessária nos registros selecionados.");
      } finally {
        managerApplyChanges.disabled = false;
        managerApplyChanges.removeAttribute("aria-busy");
      }
    }

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
    document
      .querySelectorAll("[data-close-records-manager]")
      .forEach((button) => (button.onclick = () => recordsManagerDialog.close()));

    return { open: openRecordsManagerDialog };
  }

  global.MGRecordsManager = { create };
})(window);
