const assert = require("node:assert/strict");

const values = new Map();
let lastTokenRequest = null;
global.window = global;
global.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
global.google = {
  accounts: {
    oauth2: {
      initTokenClient(config) {
        return {
          requestAccessToken(options) {
            lastTokenRequest = options;
            queueMicrotask(() => config.callback({
              access_token: "token-que-nao-deve-ser-persistido",
              expires_in: 3600,
            }));
          },
        };
      },
    },
  },
};
global.fetch = async () => ({
  ok: true,
  async json() {
    return {
      sub: "user-123",
      email: "usuario@example.com",
      name: "Usuário Teste",
      picture: "https://example.com/avatar.png",
    };
  },
});

require("../js/google-auth.js");

(async () => {
  const auth = global.MGGoogleAuth.create({ clientId: "client-id.apps.googleusercontent.com" });
  const user = await auth.signIn();

  assert.equal(user.id, "user-123");
  assert.equal(auth.hasAccessToken(), true);
  assert.equal(lastTokenRequest.prompt, "select_account");
  assert.deepEqual(auth.restoreSession(), user);
  assert.equal([...values.values()].some((value) => value.includes("token-que-nao-deve-ser-persistido")), false);

  const refreshedAuth = global.MGGoogleAuth.create({ clientId: "client-id.apps.googleusercontent.com" });
  assert.deepEqual(refreshedAuth.restoreSession(), user);
  assert.equal(refreshedAuth.hasAccessToken(), false);
  await refreshedAuth.signIn({ loginHint: user.email });
  assert.deepEqual(lastTokenRequest, { prompt: "", login_hint: user.email });

  refreshedAuth.clearToken();
  assert.deepEqual(refreshedAuth.restoreSession(), user);
  await refreshedAuth.signOut();
  assert.equal(refreshedAuth.restoreSession(), null);

  global.google.accounts.oauth2.initTokenClient = () => ({ requestAccessToken() {} });
  const blockedPopupAuth = global.MGGoogleAuth.create({
    clientId: "client-id.apps.googleusercontent.com",
    popupTimeoutMs: 5,
  });
  await assert.rejects(blockedPopupAuth.signIn(), { message: "GOOGLE_POPUP_TIMEOUT" });

  console.log("google auth tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
