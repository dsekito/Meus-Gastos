// Perfil local e migração para a conta Google, sobre o MGLocalStore real com
// um IndexedDB em memória que respeita transações (commit ou abort inteiro).
const assert = require("node:assert/strict");

global.window = global;

const records = new Map();
let failNextCommit = false;

function createTransaction() {
  const staged = new Map();
  let aborted = false;
  let pending = 0;
  const transaction = { error: null };
  let finished = false;
  const settle = () => queueMicrotask(() => {
    if (pending || aborted || finished) return;
    finished = true;
    if (failNextCommit && staged.size) {
      failNextCommit = false;
      transaction.error = new Error("QuotaExceededError");
      transaction.onabort?.();
      return;
    }
    staged.forEach((value, key) => (value === undefined ? records.delete(key) : records.set(key, value)));
    transaction.oncomplete?.();
  });
  const request = (operation) => {
    const req = {};
    pending++;
    queueMicrotask(() => {
      if (aborted) return;
      req.result = operation();
      req.onsuccess?.();
      pending--;
      settle();
    });
    return req;
  };
  const read = (key) => structuredClone(staged.has(key) ? staged.get(key) : records.get(key));
  transaction.objectStore = () => ({
    get: (key) => request(() => read(key)),
    put: (value, key) => request(() => { staged.set(key, structuredClone(value)); return key; }),
    delete: (key) => request(() => { staged.set(key, undefined); }),
  });
  transaction.abort = () => {
    aborted = true;
    queueMicrotask(() => transaction.onabort?.());
  };
  return transaction;
}

const database = {
  objectStoreNames: { contains: () => true },
  createObjectStore() {},
  close() {},
  transaction: createTransaction,
};
global.indexedDB = {
  open() {
    const req = {};
    queueMicrotask(() => { req.result = database; req.onsuccess?.(); });
    return req;
  },
};

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

require("../js/local-store.js");
require("../js/local-profile.js");
const store = global.MGLocalStore;
const profile = global.MGLocalProfile;

const LOCAL_ID = "local:11111111-1111-4111-8111-111111111111";
const GOOGLE_ID = "google-sub-123";
let mutationCounter = 0;
const createMutationId = () => `mutation-${++mutationCounter}`;

function entry(id, value, date = "2026-02-28") {
  return { id, date, value, type: "ALIMENTAÇÃO", description: "MERCADO", paid: false };
}

function localRecord() {
  return {
    entries: [entry("a", 10.1), entry("b", -3.33, "2025-12-31")],
    recurrenceSeries: [],
    settings: { current_balance: 100.05, balance_reference_date: "2026-01-31", onboarding_status: "completed" },
    types: ["ALIMENTAÇÃO"],
    syncQueue: [{ type: "upsert", entry: entry("a", 10.1), baseUpdatedAt: null, mutationId: "old" }],
    syncDiagnostics: { lastErrorCode: "X" },
  };
}

async function reset(initial = {}) {
  records.clear();
  failNextCommit = false;
  for (const [key, value] of Object.entries(initial)) records.set(key, structuredClone(value));
}

const emptyRemote = async () => ({ entries: [], recurrenceSeries: [], settings: null });

const tests = {
  async "perfil local tem id estável e não guarda token"() {
    const storage = memoryStorage();
    const first = profile.create(storage, () => "22222222-2222-4222-8222-222222222222");
    const second = profile.create(storage, () => "33333333-3333-4333-8333-333333333333");
    assert.equal(first.id, "local:22222222-2222-4222-8222-222222222222");
    assert.equal(second.id, first.id, "escolher o modo local de novo não cria outro perfil");
    assert.equal(profile.restore(storage).id, first.id);
    assert.ok(!/token/i.test(storage.getItem(profile.PROFILE_KEY)));
    assert.ok(profile.isLocalUser(first));
    assert.ok(!profile.isLocalUser({ id: GOOGLE_ID }));
    profile.forget(storage);
    assert.equal(profile.restore(storage), null);
  },

  async "perfil local inválido ou corrompido é ignorado"() {
    const storage = memoryStorage();
    storage.setItem(profile.PROFILE_KEY, "{não é json");
    assert.equal(profile.restore(storage), null);
    storage.setItem(profile.PROFILE_KEY, JSON.stringify({ id: "google-sub" }));
    assert.equal(profile.restore(storage), null);
  },

  async "migração interrompida: perfil local tem prioridade na abertura"() {
    const localUser = { id: LOCAL_ID, local: true };
    const googleUser = { id: GOOGLE_ID };
    assert.deepEqual(profile.resolveStartupUser({ googleUser, localUser }), { user: localUser, forgetGoogleSession: true });
    assert.deepEqual(profile.resolveStartupUser({ googleUser }), { user: googleUser, forgetGoogleSession: false });
    assert.deepEqual(profile.resolveStartupUser({}), { user: null, forgetGoogleSession: false });
  },

  async "sem dados remotos: move tudo e apaga o perfil local na mesma transação"() {
    await reset({ [LOCAL_ID]: localRecord() });
    const plan = await profile.planMigration({ store, localId: LOCAL_ID, googleId: GOOGLE_ID, readRemote: emptyRemote });
    assert.equal(plan.kind, "move");
    const result = await profile.commitMigration({ store, plan, now: "2026-11-12T00:00:00.000Z", createMutationId });
    assert.equal(result.status, "migrated");
    assert.equal(result.choice, "device");
    assert.equal(records.has(LOCAL_ID), false);
    const moved = records.get(GOOGLE_ID);
    assert.deepEqual(moved.entries.map((item) => item.id), ["a", "b"]);
    assert.equal(moved.settings.current_balance, 100.05);
    assert.deepEqual(moved.syncQueue.map((op) => [op.type, op.entry.id, op.baseUpdatedAt]), [["upsert", "a", null], ["upsert", "b", null]]);
    assert.equal(new Set(moved.syncQueue.map((op) => op.mutationId)).size, 2, "cada operação tem mutationId próprio");
    assert.equal(moved.settingsDirty, true);
    assert.equal(moved.recurrenceDirty, true);
    assert.equal(moved.syncDiagnostics, undefined);
  },

  async "perfil local vazio não consulta o Drive nem gera conflito"() {
    await reset({ [LOCAL_ID]: { entries: [], recurrenceSeries: [], settings: { current_balance: 0 } }, [GOOGLE_ID]: { entries: [entry("g", 5)] } });
    let remoteReads = 0;
    const plan = await profile.planMigration({ store, localId: LOCAL_ID, googleId: GOOGLE_ID, readRemote: async () => { remoteReads++; return emptyRemote(); } });
    assert.equal(plan.kind, "empty");
    assert.equal(remoteReads, 0);
    await profile.commitMigration({ store, plan });
    assert.equal(records.has(LOCAL_ID), false);
    assert.deepEqual(records.get(GOOGLE_ID).entries.map((item) => item.id), ["g"], "dados da conta intactos");
  },

  async "conflito com o Drive exige escolha e cancelar não muda nada"() {
    await reset({ [LOCAL_ID]: localRecord() });
    const before = structuredClone([...records]);
    const remote = { entries: [entry("r1", 7), entry("a", 1)], recurrenceSeries: [], settings: { current_balance: 0 } };
    const plan = await profile.planMigration({ store, localId: LOCAL_ID, googleId: GOOGLE_ID, readRemote: async () => remote });
    assert.equal(plan.kind, "conflict");
    assert.deepEqual(plan.summary, { deviceEntries: 2, deviceSeries: 0, accountEntries: 2, accountSeries: 0 });
    await assert.rejects(profile.commitMigration({ store, plan }), /LOCAL_MIGRATION_CHOICE_REQUIRED/);
    await assert.rejects(profile.commitMigration({ store, plan, choice: "merge" }), /LOCAL_MIGRATION_CHOICE_REQUIRED/);
    assert.deepEqual((await profile.commitMigration({ store, plan, choice: "cancel" })).status, "cancelled");
    assert.deepEqual([...records], before);
  },

  async "conflito: manter os do aparelho substitui a conta e remove o que só existe no Drive"() {
    await reset({ [LOCAL_ID]: localRecord(), [GOOGLE_ID]: { entries: [entry("old", 2)], syncQueue: [], settings: {} } });
    const remote = { entries: [entry("r1", 7), entry("a", 1)], recurrenceSeries: [], settings: {} };
    const plan = await profile.planMigration({ store, localId: LOCAL_ID, googleId: GOOGLE_ID, readRemote: async () => remote });
    assert.equal(plan.kind, "conflict");
    assert.equal(plan.summary.accountEntries, 3, "conta = Drive + cópia deste aparelho, sem repetir ids");
    await profile.commitMigration({ store, plan, choice: "device", createMutationId });
    const moved = records.get(GOOGLE_ID);
    assert.equal(records.has(LOCAL_ID), false);
    assert.deepEqual(moved.entries.map((item) => item.id), ["a", "b"]);
    assert.deepEqual(moved.syncQueue.map((op) => `${op.type}:${op.id || op.entry.id}`), ["upsert:a", "upsert:b", "delete:r1"]);
    assert.ok(moved.syncQueue.every((op) => op.baseUpdatedAt === null));
  },

  async "conflito: manter os do Drive apaga só o perfil local"() {
    const account = { entries: [entry("g", 9)], syncQueue: [], settings: { current_balance: 1 } };
    await reset({ [LOCAL_ID]: localRecord(), [GOOGLE_ID]: account });
    const plan = await profile.planMigration({ store, localId: LOCAL_ID, googleId: GOOGLE_ID, readRemote: emptyRemote });
    assert.equal(plan.kind, "conflict", "a cópia da conta neste aparelho também conta como dados");
    const result = await profile.commitMigration({ store, plan, choice: "drive" });
    assert.equal(result.choice, "drive");
    assert.equal(records.has(LOCAL_ID), false);
    assert.deepEqual(records.get(GOOGLE_ID), account);
  },

  async "falha de gravação reverte tudo: perfil local e conta continuam iguais"() {
    await reset({ [LOCAL_ID]: localRecord() });
    const plan = await profile.planMigration({ store, localId: LOCAL_ID, googleId: GOOGLE_ID, readRemote: emptyRemote });
    failNextCommit = true;
    await assert.rejects(profile.commitMigration({ store, plan, createMutationId }), /QuotaExceededError/);
    assert.deepEqual(records.get(LOCAL_ID), localRecord(), "o perfil local não foi apagado");
    assert.equal(records.has(GOOGLE_ID), false, "nada parcial na conta");
    // O mesmo plano pode ser repetido depois da falha.
    await profile.commitMigration({ store, plan, createMutationId });
    assert.equal(records.has(LOCAL_ID), false);
    assert.equal(records.get(GOOGLE_ID).entries.length, 2);
  },

  async "alteração entre a prévia e a gravação aborta com conflito (compare-and-swap)"() {
    await reset({ [LOCAL_ID]: localRecord() });
    const plan = await profile.planMigration({ store, localId: LOCAL_ID, googleId: GOOGLE_ID, readRemote: emptyRemote });
    const edited = { ...localRecord(), entries: [...localRecord().entries, entry("c", 0.01, "2024-02-29")] };
    records.set(LOCAL_ID, edited);
    await assert.rejects(profile.commitMigration({ store, plan }), /LOCAL_STORE_CONFLICT/);
    assert.deepEqual(records.get(LOCAL_ID), edited, "a edição nova é preservada");
    assert.equal(records.has(GOOGLE_ID), false);

    await reset({ [LOCAL_ID]: localRecord() });
    const second = await profile.planMigration({ store, localId: LOCAL_ID, googleId: GOOGLE_ID, readRemote: emptyRemote });
    records.set(GOOGLE_ID, { entries: [entry("outra-aba", 1)] });
    await assert.rejects(profile.commitMigration({ store, plan: second }), /LOCAL_STORE_CONFLICT/);
    assert.deepEqual(records.get(GOOGLE_ID).entries.map((item) => item.id), ["outra-aba"]);
    assert.ok(records.has(LOCAL_ID));
  },

  async "falha ao ler o Drive não migra nada"() {
    await reset({ [LOCAL_ID]: localRecord() });
    await assert.rejects(
      profile.planMigration({ store, localId: LOCAL_ID, googleId: GOOGLE_ID, readRemote: async () => { throw new Error("GOOGLE_DRIVE_TIMEOUT"); } }),
      /GOOGLE_DRIVE_TIMEOUT/,
    );
    assert.deepEqual(records.get(LOCAL_ID), localRecord());
    assert.equal(records.has(GOOGLE_ID), false);
  },

  async "ids inválidos são recusados"() {
    await assert.rejects(profile.planMigration({ store, localId: "google-sub", googleId: GOOGLE_ID, readRemote: emptyRemote }), /INVALID_IDS/);
    await assert.rejects(profile.planMigration({ store, localId: LOCAL_ID, googleId: LOCAL_ID, readRemote: emptyRemote }), /INVALID_IDS/);
  },

  async "registro migrado preserva recuperação local e trata listas vazias"() {
    const record = profile.buildMigratedRecord(
      { entries: [{ ...entry("x", 1), import_local_only: true }], settings: {} },
      { createMutationId },
    );
    assert.equal(record.syncQueue[0].localOnly, true, "recuperação local continua com envio pausado");
    assert.deepEqual(record.recurrenceSeries, []);
    assert.deepEqual(profile.buildMigratedRecord({}, { createMutationId }).syncQueue, []);
    assert.equal(profile.hasDeviceData({ entries: [], settings: { current_balance: -0.001 } }), false, "menos de um centavo não é dado");
    assert.equal(profile.hasDeviceData({ entries: [], settings: { current_balance: -0.01 } }), true, "saldo negativo é dado");
  },
};

(async () => {
  for (const [name, test] of Object.entries(tests)) {
    await test();
    console.log(`ok - ${name}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
