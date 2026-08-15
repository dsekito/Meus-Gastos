const assert = require("node:assert/strict");

global.window = global;

let remote = {
  schemaVersion: 1,
  revision: 2,
  entries: [{ id: "one", value: 10, updated_at: "v1" }],
  recurrenceSeries: [],
  settings: null,
};
let driveVersion = "7";
const deltaFiles = new Map();
let nextDeltaId = 1;

global.fetch = async (url, options = {}) => {
  if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
    const query = new URL(url).searchParams.get("q") || "";
    let files = [];
    if (query.includes("meus-gastos.json")) files = [{ id: "drive-file", name: "meus-gastos.json", version: driveVersion }];
    else if (query.includes("meus-gastos-entry-")) {
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
    return new Response(JSON.stringify({ version: driveVersion }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("/files/drive-file?uploadType=media") && options.method === "PATCH") {
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

require("../js/google-drive-repository.js");

(async () => {
  const repository = global.MGGoogleDriveRepository.create({
    getAccessToken: () => "test-token",
  });

  assert.equal((await repository.fetchEntries())[0].value, 10);
  const saved = await repository.upsertEntry({ id: "one", value: 25 });
  assert.equal(saved.value, 25);
  assert.ok(saved.updated_at);
  assert.equal((await repository.fetchEntries())[0].value, 25);
  assert.equal(remote.entries[0].value, 10, "o arquivo histórico não deve ser regravado");
  assert.equal(deltaFiles.size, 1);

  await repository.deleteEntry("one");
  assert.deepEqual(await repository.fetchEntries(), []);
  assert.equal(deltaFiles.size, 1, "a exclusão atualiza somente o arquivo da diferença");

  await repository.applyEntryOperations([
    { type: "upsert", entry: { id: "two", value: 30 }, baseUpdatedAt: null },
    { type: "upsert", entry: { id: "three", value: 40 }, baseUpdatedAt: null },
  ]);
  assert.equal((await repository.fetchEntries()).length, 2);
  assert.equal(deltaFiles.size, 3, "cada lançamento alterado usa um arquivo pequeno");

  const delta = [...deltaFiles.values()].find((file) => file.name.includes("two"));
  delta.content = JSON.stringify({ id: "two", deleted: false, entry: { id: "two", value: 99, updated_at: "other-device" } });
  delta.version = "99";
  await assert.rejects(
    repository.applyEntryOperations([{ type: "upsert", entry: { id: "two", value: 30 }, baseUpdatedAt: "bulk-saved" }]),
    /CONFLICT/,
  );

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
