// Regressions for the review fixes: OAuth timeouts, UTC date math, projected
// balance cost/precision, Drive main-document selection, local store removal
// and service-worker caching of failed navigations.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
global.window = global;
require("../js/domain.js");
require("../js/document-validator.js");
require("../js/google-auth.js");
require("../js/google-drive-repository.js");

const domain = global.MGDomain;

async function testOAuthTimeouts() {
  const values = new Map();
  global.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  let tokenCallback = null;
  global.google = { accounts: { oauth2: { initTokenClient(config) {
    tokenCallback = config.callback;
    return { requestAccessToken() {} };
  } } } };

  // The popup limit must leave room for account choice, consent and 2FA.
  const originalSetTimeout = global.setTimeout;
  const delays = [];
  global.setTimeout = (_callback, delay) => { delays.push(delay); return 0; };
  const auth = global.MGGoogleAuth.create({ clientId: "client.apps.googleusercontent.com" });
  auth.signIn().catch(() => {});
  global.setTimeout = originalSetTimeout;
  assert.ok(delays.some(delay => delay >= 120000), `popup timeout too short: ${delays}`);

  // userinfo must not hang forever once the token arrives.
  global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const slowAuth = global.MGGoogleAuth.create({ clientId: "client.apps.googleusercontent.com", requestTimeoutMs: 10 });
  const pending = slowAuth.signIn();
  tokenCallback({ access_token: "token", expires_in: 3600 });
  await assert.rejects(pending, { message: "USERINFO_TIMEOUT" });
}

function testUtcDateMath() {
  const script = `
    global.window = global;
    require(${JSON.stringify(path.join(root, "js/domain.js"))});
    const d = global.MGDomain;
    console.log(JSON.stringify([
      d.addDays("2026-11-11", 1), d.addDays("2026-12-31", 1), d.addDays("2024-03-01", -1),
      d.addMonthsClamped("2026-01-31", 1), d.addMonthsClamped("2024-01-31", 1), d.addMonthsClamped("2026-11-15", 2),
      d.adjustBusinessDay("2026-11-14", "next"), d.adjustBusinessDay("2026-11-15", "previous"),
    ]));`;
  const expected = ["2026-11-12", "2027-01-01", "2024-02-29", "2026-02-28", "2024-02-29", "2027-01-15", "2026-11-16", "2026-11-13"];
  for (const TZ of ["America/Sao_Paulo", "UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    const output = execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ }, encoding: "utf8", timeout: 10000 });
    assert.deepEqual(JSON.parse(output), expected, `date math differs in ${TZ}`);
  }
}

function naiveProjectedBalance(date, settings, totals) {
  let balance = Number(settings.current_balance);
  const reference = settings.balance_reference_date;
  if (date > reference) for (let c = domain.addDays(reference, 1); c <= date; c = domain.addDays(c, 1)) balance += totals.get(c) || 0;
  else for (let c = domain.addDays(date, 1); c <= reference; c = domain.addDays(c, 1)) balance -= totals.get(c) || 0;
  return Math.round(balance * 100) / 100;
}

function testProjectedBalance() {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const entries = Array.from({ length: 400 }, (_, index) => ({
    id: String(index),
    date: domain.addDays("2025-06-01", Math.floor(random() * 500)),
    value: Math.round(random() * 100000) / 100,
    flow_type: random() > 0.6 ? "income" : "expense",
  }));
  const totals = domain.dailyEntryNet(entries);
  const settings = { current_balance: 1234.56, balance_reference_date: "2026-01-15" };
  for (const date of ["2025-05-01", "2025-12-31", "2026-01-15", "2026-01-16", "2026-08-20", "2026-12-31"]) {
    assert.equal(domain.projectedBalance(date, settings, totals), naiveProjectedBalance(date, settings, totals), date);
  }
  const minimum = domain.minimumProjectedBalance("2026-01-01", "2026-01-31", settings, totals);
  let expected = { date: "2026-01-01", balance: naiveProjectedBalance("2026-01-01", settings, totals) };
  for (let c = "2026-01-02"; c <= "2026-01-31"; c = domain.addDays(c, 1)) {
    const balance = naiveProjectedBalance(c, settings, totals);
    if (balance < expected.balance) expected = { date: c, balance };
  }
  assert.deepEqual(minimum, expected);

  // Integer cents: no floating residue.
  const cents = domain.projectedBalance("2026-01-03", { current_balance: 0.1, balance_reference_date: "2026-01-01" },
    new Map([["2026-01-02", 0.2], ["2026-01-03", 0.1]]));
  assert.equal(cents, 0.4);

  // Cost must not grow with the days since an old reference date.
  const oldReference = { current_balance: 0, balance_reference_date: "1996-01-01" };
  const started = performance.now();
  for (let day = 0; day < 42; day++) domain.projectedBalance(domain.addDays("2026-11-01", day), oldReference, totals);
  assert.ok(performance.now() - started < 200, "projectedBalance is proportional to elapsed days");
}

async function testDriveMainDocumentSelection() {
  const listed = [];
  global.fetch = async (url) => {
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/drive/v3/files?")) {
      const params = new URL(url).searchParams;
      listed.push(params);
      if (params.get("q").includes("name = 'meus-gastos.json'")) {
        return json({ files: [{ id: "oldest", name: "meus-gastos.json", version: "3" }, { id: "newer", name: "meus-gastos.json", version: "1" }] });
      }
      return json({ files: [] });
    }
    if (url.includes("/files/oldest?alt=media")) return json({ schemaVersion: 2, revision: 1, entries: [{ id: "kept", value: 1 }], recurrenceSeries: [] });
    throw new Error(`unexpected request ${url}`);
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const repository = global.MGGoogleDriveRepository.create({ getAccessToken: () => "token" });
    const document = await repository.load();
    assert.deepEqual(document.entries.map(entry => entry.id), ["kept"]);
    assert.equal(listed.find(params => params.get("q").includes("meus-gastos.json")).get("orderBy"), "createdTime");
    assert.equal(repository.getDocumentStats().duplicateDocumentCount, 1);
  } finally {
    console.warn = originalWarn;
  }
}

async function testLocalStoreRemoveForgetsSnapshot() {
  const records = new Map();
  const database = {
    objectStoreNames: { contains: () => true },
    transaction() {
      let pending = 0;
      const transaction = {};
      const settle = () => { if (--pending === 0) setTimeout(() => !transaction.aborted && transaction.oncomplete?.()); };
      const request = (work) => {
        pending++;
        const result = {};
        setTimeout(() => { result.result = work(); result.onsuccess?.(); settle(); });
        return result;
      };
      transaction.abort = () => { transaction.aborted = true; setTimeout(() => transaction.onabort?.()); };
      transaction.objectStore = () => ({
        get: key => request(() => structuredClone(records.get(key))),
        put: (value, key) => request(() => records.set(key, structuredClone(value))),
        delete: key => request(() => records.delete(key)),
      });
      return transaction;
    },
  };
  global.indexedDB = { open() {
    const result = {};
    setTimeout(() => { result.result = database; result.onsuccess(); });
    return result;
  } };
  require("../js/local-store.js");
  const store = global.MGLocalStore;
  await store.load("user");
  await store.save("user", { entries: [1] });
  await store.remove("user");
  // Without forgetting the observed snapshot this save fails with a conflict.
  await store.save("user", { entries: [2] });
  assert.deepEqual(records.get("user"), { entries: [2] });
}

async function testServiceWorkerNeverCachesErrorPages() {
  const listeners = {};
  const puts = [];
  const cached = new Map([["./index.html", "CACHED_APP"]]);
  const cache = { put: (key, value) => { puts.push([String(key.url || key), value.status]); return Promise.resolve(); }, addAll: async () => {} };
  const context = {
    URL, Request: class { constructor(url) { this.url = url; } },
    self: { location: { origin: "https://app.example" }, registration: { scope: "https://app.example/MeusGastos/" },
      addEventListener: (name, handler) => { listeners[name] = handler; }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => cache, match: async key => cached.get(key), keys: async () => [] },
    fetch: async () => ({ ok: false, status: 404, type: "basic", clone() { return this; } }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "sw.js"), "utf8"), context);
  const navigate = async (url) => {
    let responded;
    listeners.fetch({ request: { url, method: "GET", mode: "navigate" }, respondWith: value => { responded = value; }, waitUntil() {} });
    return responded;
  };
  assert.equal(await navigate("https://app.example/MeusGastos/"), "CACHED_APP");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(puts, [], "a 404 navigation replaced the offline app");

  context.fetch = async () => ({ ok: true, status: 200, type: "basic", clone() { return this; } });
  await navigate("https://app.example/MeusGastos/outputs/report.html");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(puts, [], "another page in scope replaced the offline app");
  await navigate("https://app.example/MeusGastos/");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(puts.length, 1);

  // Offline revalidation of a cached asset must not leak a rejection.
  cached.set("https://app.example/MeusGastos/app.js", "CACHED_JS");
  context.caches.match = async key => cached.get(typeof key === "string" ? key : key.url);
  context.fetch = async () => { throw new TypeError("offline"); };
  let backgroundWork;
  let answer;
  listeners.fetch({ request: { url: "https://app.example/MeusGastos/app.js", method: "GET", mode: "cors" },
    respondWith: value => { answer = value; }, waitUntil: value => { backgroundWork = value; } });
  assert.equal(await answer, "CACHED_JS");
  await backgroundWork;
}

function testManifestIconsAreNotForcedMaskable() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  assert.ok(manifest.icons.every(icon => !icon.purpose.split(" ").includes("maskable") || icon.purpose === "maskable"));
}

function testContentSecurityPolicy() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  assert.ok(policy, "CSP meta missing");
  assert.match(policy, /object-src 'none'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-(inline|eval)'/);
  assert.ok(html.indexOf('charset="utf-8"') < html.indexOf("Content-Security-Policy"));
}

(async () => {
  await testOAuthTimeouts();
  testUtcDateMath();
  testProjectedBalance();
  await testDriveMainDocumentSelection();
  await testLocalStoreRemoveForgetsSnapshot();
  await testServiceWorkerNeverCachesErrorPages();
  testManifestIconsAreNotForcedMaskable();
  testContentSecurityPolicy();
  console.log("review fixes tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
