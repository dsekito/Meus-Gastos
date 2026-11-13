const assert = require("node:assert/strict");

global.window = global;
require("../js/app-update.js");

function emitter(extra = {}) {
  const handlers = {};
  return {
    ...extra,
    addEventListener(name, handler) { (handlers[name] ||= []).push(handler); },
    emit(name) { (handlers[name] || []).forEach(handler => handler()); },
  };
}

function setup({ controlled = true, waiting = null, updateFound = null } = {}) {
  const calls = { reload: 0, available: 0, messages: [] };
  const registration = emitter({
    waiting,
    installing: null,
    async update() {
      if (updateFound) {
        registration.installing = updateFound;
        registration.emit("updatefound");
      }
    },
  });
  const serviceWorker = emitter({
    controller: controlled ? {} : null,
    register: async () => registration,
    getRegistration: async () => registration,
  });
  const timers = { setTimeout: () => 0, clearTimeout() {} };
  const update = global.MGAppUpdate.create({
    serviceWorker,
    timers,
    reload: () => { calls.reload += 1; },
    onUpdateAvailable: () => { calls.available += 1; },
  });
  return { update, registration, serviceWorker, calls };
}

function worker() {
  const calls = [];
  const item = emitter({ state: "installing", postMessage: message => calls.push(message) });
  item.messages = calls;
  return item;
}

(async () => {
  // First install (no controller): nothing to offer, nothing reloads.
  {
    const { update, serviceWorker, calls } = setup({ controlled: false });
    await update.register("./sw.js");
    serviceWorker.emit("controllerchange");
    assert.equal(calls.available, 0);
    assert.equal(calls.reload, 0, "first activation must not reload the page");
  }

  // A version already waiting is offered, but never applied on its own.
  {
    const waiting = worker();
    const { update, serviceWorker, calls } = setup({ waiting });
    await update.register("./sw.js");
    assert.equal(calls.available, 1);
    serviceWorker.emit("controllerchange");
    assert.equal(calls.reload, 0, "an update not accepted must not reload");
    update.apply();
    assert.deepEqual(waiting.messages, [{ type: "SKIP_WAITING" }]);
    assert.equal(calls.reload, 0);
    serviceWorker.emit("controllerchange");
    assert.equal(calls.reload, 1);
  }

  // Manual check: a version found and installed is offered, not reloaded.
  {
    const incoming = worker();
    const { update, registration, calls } = setup({ updateFound: incoming });
    const result = update.checkForUpdate();
    await Promise.resolve();
    incoming.state = "installed";
    registration.waiting = incoming;
    incoming.emit("statechange");
    assert.equal(await result, "available");
    assert.ok(calls.available >= 1);
    assert.equal(calls.reload, 0);
  }

  // Manual check without a new version keeps the page as it is.
  {
    const { update, calls } = setup();
    assert.equal(await update.checkForUpdate(), "current");
    assert.equal(calls.reload, 0);
    assert.equal(calls.available, 0);
  }

  // Without service worker support the check says so.
  {
    const update = global.MGAppUpdate.create({ serviceWorker: undefined });
    assert.equal(await update.checkForUpdate(), "unsupported");
  }

  console.log("app update tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
