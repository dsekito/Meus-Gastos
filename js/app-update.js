(function attachAppUpdate(global) {
  // A new service worker waits until the person accepts the update, so the
  // interface is never swapped (or reloaded) under an open form.
  const INSTALL_WAIT_MS = 15000;
  const ACTIVATION_WAIT_MS = 10000;

  function create({
    serviceWorker = global.navigator?.serviceWorker,
    reload = () => global.location.reload(),
    onUpdateAvailable = () => {},
    timers = global,
  } = {}) {
    let registration = null;
    let accepted = false;

    function waitingWorker() {
      return registration?.waiting && serviceWorker?.controller ? registration.waiting : null;
    }

    function announce() {
      if (waitingWorker()) onUpdateAvailable();
    }

    function settle(worker) {
      return new Promise((resolve) => {
        const timer = timers.setTimeout(resolve, INSTALL_WAIT_MS);
        worker.addEventListener("statechange", () => {
          if (worker.state === "installing") return;
          timers.clearTimeout(timer);
          resolve();
        });
      });
    }

    function track(worker) {
      if (worker) settle(worker).then(announce);
    }

    async function register(url) {
      if (!serviceWorker) return null;
      serviceWorker.addEventListener("controllerchange", () => {
        if (accepted) reload();
      });
      registration = await serviceWorker.register(url, { updateViaCache: "none" });
      if (!registration) return null;
      registration.addEventListener("updatefound", () => track(registration.installing));
      track(registration.installing);
      announce();
      // Offline or a server error: the cached version keeps working.
      await registration.update().catch(() => undefined);
      return registration;
    }

    async function checkForUpdate() {
      if (!registration) registration = await serviceWorker?.getRegistration?.() || null;
      if (!registration) return "unsupported";
      await registration.update();
      if (registration.installing) await settle(registration.installing);
      if (waitingWorker()) {
        onUpdateAvailable();
        return "available";
      }
      return "current";
    }

    function apply() {
      accepted = true;
      const worker = waitingWorker();
      if (!worker) {
        reload();
        return;
      }
      worker.postMessage({ type: "SKIP_WAITING" });
      // controllerchange reloads; this only covers a worker that never activates.
      timers.setTimeout(reload, ACTIVATION_WAIT_MS);
    }

    return { register, checkForUpdate, apply };
  }

  global.MGAppUpdate = { create };
})(window);
