const assert = require("node:assert/strict");

global.window = global;

let remote = {
  schemaVersion: 1,
  revision: 2,
  entries: [{ id: "one", value: 10, updated_at: "2026-08-01T10:00:00.000Z" }],
  recurrenceSeries: [],
  settings: null,
};
let driveVersion = "7";
const deltaFiles = new Map();
let nextDeltaId = 1;
let deltaIndexRequests = 0;
let mainDocumentWrites = 0;
let transientVersionFailures = 0;
let versionRequestAttempts = 0;

global.fetch = async (url, options = {}) => {
  if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
    const query = new URL(url).searchParams.get("q") || "";
    let files = [];
    if (query.includes("meus-gastos.json")) files = [{ id: "drive-file", name: "meus-gastos.json", version: driveVersion }];
    else if (query.includes("meus-gastos-entry-")) {
      deltaIndexRequests++;
      files = [...deltaFiles.values()]
        .filter((file) => !query.includes("name =") || query.includes(file.name));
    }
    return new Response(JSON.stringify({ files }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("/files/drive-file?alt=media")) {
    return new Response(JSON.stringify(remote), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("/files/drive-file?fields=version")) {
    versionRequestAttempts++;
    if (transientVersionFailures > 0) {
      transientVersionFailures--;
      return new Response("temporarily unavailable", { status: 503 });
    }
    return new Response(JSON.stringify({ version: driveVersion }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("/files/drive-file?uploadType=media") && options.method === "PATCH") {
    mainDocumentWrites++;
    remote = JSON.parse(options.body);
    driveVersion = String(Number(driveVersion) + 1);
    return new Response(JSON.stringify({ id: "drive-file", version: driveVersion }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  const deltaMatch = url.match(/\/files\/(delta-\d+)\?uploadType=media/);
  if (deltaMatch && options.method === "PATCH") {
    const previous = deltaFiles.get(deltaMatch[1]);
    const file = { ...previous, version: String(Number(previous.version) + 1), content: options.body };
    deltaFiles.set(file.id, file);
    return new Response(JSON.stringify({ id: file.id, name: file.name, version: file.version }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("/upload/drive/v3/files?uploadType=multipart") && options.method === "POST") {
    const metadata = JSON.parse(await options.body.get("metadata").text());
    const file = {
      id: `delta-${nextDeltaId++}`,
      name: metadata.name,
      version: "1",
      content: await options.body.get("file").text(),
    };
    deltaFiles.set(file.id, file);
    return new Response(JSON.stringify({ id: file.id, name: file.name, version: file.version }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  const deltaContentMatch = url.match(/\/files\/(delta-\d+)\?alt=media/);
  if (deltaContentMatch) {
    return new Response(deltaFiles.get(deltaContentMatch[1]).content, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
};

require("../js/document-validator.js");
require("../js/google-drive-repository.js");

(async () => {
  const repository = global.MGGoogleDriveRepository.create({
    getAccessToken: () => "test-token",
  });

  assert.equal((await repository.fetchEntries())[0].value, 10);
  assert.ok(repository.getDocumentStats().sizeBytes > 0, "o tamanho do documento remoto deve ser medido");
  const saved = await repository.upsertEntry({ id: "one", value: 25 });
  assert.equal(saved.value, 25);
  assert.ok(saved.updated_at);
  assert.equal((await repository.fetchEntries())[0].value, 25);
  assert.equal(remote.entries[0].value, 25, "o documento consolidado deve receber a alteração");
  assert.equal(deltaFiles.size, 0, "novas alterações não devem criar um arquivo por lançamento");

  await repository.deleteEntry("one");
  assert.deepEqual(await repository.fetchEntries(), []);
  assert.deepEqual(remote.entries, []);

  const deltaIndexRequestsBeforeBatch = deltaIndexRequests;
  await repository.applyEntryOperations([
    { type: "upsert", entry: { id: "two", value: 30 }, baseUpdatedAt: null },
    { type: "upsert", entry: { id: "three", value: 40 }, baseUpdatedAt: null },
  ]);
  assert.equal((await repository.fetchEntries()).length, 2);
  assert.equal(deltaFiles.size, 0, "o lote inteiro deve permanecer em um único documento");
  assert.equal(mainDocumentWrites, 3, "cada operação ou lote deve gerar apenas uma gravação principal");
  assert.equal(deltaIndexRequests, deltaIndexRequestsBeforeBatch, "o índice recém-carregado é reutilizado no envio em lote");

  transientVersionFailures = 1;
  const versionAttemptsBeforeRetry = versionRequestAttempts;
  await repository.upsertEntry({ id: "retry-safe", value: 50 });
  assert.equal(versionRequestAttempts, versionAttemptsBeforeRetry + 2, "leituras transitórias devem usar retry com backoff");

  const writesBeforeLargeBatch = mainDocumentWrites;
  await repository.applyEntryOperations(
    Array.from({ length: 2449 }, (_, index) => ({
      type: "upsert",
      entry: { id: `bulk-${index}`, value: index },
      baseUpdatedAt: null,
    })),
  );
  assert.equal(mainDocumentWrites, writesBeforeLargeBatch + 1, "2.449 alterações devem gerar uma única gravação no Drive");

  const previousVersion = remote.entries.find((entry) => entry.id === "two").updated_at;
  const deltaIndexRequestsBeforeConflict = deltaIndexRequests;
  remote.entries = remote.entries.map((entry) => entry.id === "two"
    ? { ...entry, value: 99, updated_at: "2026-08-26T12:00:00.000Z" }
    : entry);
  driveVersion = String(Number(driveVersion) + 1);
  await repository.load();
  await assert.rejects(
    repository.applyEntryOperations([{ type: "upsert", entry: { id: "two", value: 30 }, baseUpdatedAt: previousVersion }]),
    /CONFLICT/,
  );
  assert.equal(deltaIndexRequests, deltaIndexRequestsBeforeConflict + 1, "uma nova sincronização volta a conferir alterações de outro dispositivo");

  const preservedEntries = await repository.fetchEntries();
  remote = {
    ...remote,
    entries: [
      { id: "duplicate", value: 1, updated_at: "2026-08-26T13:00:00.000Z" },
      { id: "duplicate", value: 2, updated_at: "2026-08-26T14:00:00.000Z" },
    ],
  };
  driveVersion = String(Number(driveVersion) + 1);
  await assert.rejects(repository.load(), /GOOGLE_DRIVE_INVALID_DOCUMENT/);
  assert.deepEqual(await repository.fetchEntries(), preservedEntries, "um documento inválido não deve substituir a cópia válida em memória");

  const expiredRepository = global.MGGoogleDriveRepository.create({
    getAccessToken: () => "expired-token",
    isAccessTokenExpired: () => true,
  });
  await assert.rejects(expiredRepository.fetchEntries(), /GOOGLE_AUTH_EXPIRED/);

  console.log("google drive repository tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
