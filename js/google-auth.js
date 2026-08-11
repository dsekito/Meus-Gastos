(function attachGoogleAuth(global) {
  const SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.appdata",
  ].join(" ");

  function create({ clientId }) {
    let accessToken = null;
    let expiresAt = 0;
    let tokenClient = null;

    function ensureConfigured() {
      if (!clientId || clientId.includes("SEU_CLIENT_ID")) {
        throw new Error("GOOGLE_CLIENT_ID_NOT_CONFIGURED");
      }
      if (!global.google?.accounts?.oauth2) throw new Error("GOOGLE_IDENTITY_UNAVAILABLE");
    }

    async function fetchUser() {
      const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error(`USERINFO_${response.status}`);
      const profile = await response.json();
      return {
        id: profile.sub,
        email: profile.email,
        user_metadata: { full_name: profile.name, avatar_url: profile.picture },
      };
    }

    function signIn() {
      ensureConfigured();
      return new Promise((resolve, reject) => {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: async (response) => {
            if (response.error) return reject(new Error(response.error));
            accessToken = response.access_token;
            expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) - 30) * 1000;
            try {
              resolve(await fetchUser());
            } catch (error) {
              reject(error);
            }
          },
          error_callback: (error) => reject(new Error(error.type || "GOOGLE_OAUTH_ERROR")),
        });
        tokenClient.requestAccessToken({ prompt: "select_account" });
      });
    }

    function clearToken() {
      accessToken = null;
      expiresAt = 0;
    }

    // Sair localmente não revoga o consentimento. Revogação é reservada à
    // desconexão definitiva da conta e exigiria novo consentimento no próximo uso.
    function signOut() {
      clearToken();
      return Promise.resolve();
    }

    return {
      signIn,
      signOut,
      clearToken,
      getAccessToken: () => accessToken,
      isAccessTokenExpired: () => !!accessToken && Date.now() >= expiresAt,
    };
  }

  global.MGGoogleAuth = { create };
})(window);
