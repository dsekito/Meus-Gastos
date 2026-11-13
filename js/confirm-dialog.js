(function attachConfirmDialog(global) {
  // Accessible replacement for window.confirm: a native modal <dialog> that
  // traps focus, answers Esc as "cancel" and returns focus to its opener.
  // Every text goes through textContent, never HTML.
  function create(dialog) {
    const title = dialog.querySelector("[data-confirm-title]");
    const description = dialog.querySelector("[data-confirm-description]");
    const details = dialog.querySelector("[data-confirm-details]");
    const accept = dialog.querySelector("[data-confirm-accept]");
    const cancel = dialog.querySelector("[data-confirm-cancel-label]");
    let resolver = null;
    let opener = null;

    function settle(value) {
      if (!resolver) return;
      const resolve = resolver;
      resolver = null;
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      opener = null;
      resolve(value);
    }

    accept.addEventListener("click", () => settle(true));
    dialog.querySelectorAll("[data-confirm-cancel]").forEach((button) => {
      button.addEventListener("click", () => settle(false));
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      settle(false);
    });
    dialog.addEventListener("close", () => settle(false));

    function ask({
      title: titleText,
      description: descriptionText = "",
      details: detailLines = [],
      confirmLabel = "Confirmar",
      cancelLabel = "Cancelar",
      tone = "primary",
    }) {
      settle(false);
      opener = global.document.activeElement;
      title.textContent = titleText;
      description.textContent = descriptionText;
      description.hidden = !descriptionText;
      details.replaceChildren(...detailLines.filter(Boolean).map((line) => {
        const item = global.document.createElement("li");
        item.textContent = line;
        return item;
      }));
      details.hidden = !details.children.length;
      accept.textContent = confirmLabel;
      cancel.textContent = cancelLabel;
      accept.classList.toggle("danger-action", tone === "danger");
      const answer = new Promise((resolve) => { resolver = resolve; });
      dialog.showModal();
      // A destructive choice is never the default focus.
      (tone === "danger" ? cancel : accept).focus();
      return answer;
    }

    return { ask };
  }

  global.MGConfirmDialog = { create };
})(window);
