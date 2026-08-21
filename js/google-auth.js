(function attachGoogleAuth(global) {
  const SESSION_KEY = "meus-gastos-google-user";
  const SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.appdata",
  ].join(" ");

  function create({ clientId, popupTimeoutMs = 15000 }) {
    let accessToken = null;
    let expiresAt = 0;
    let tokenClient = null;

    function persistUser(user) {
      try {
        global.localStorage?.setItem(SESSION_KEY, JSON.stringify(user));
      } catch (error) {
        console.warn("Não foi possível persistir a sessão local.", error);
      }
    }

    function restoreSession() {
      try {
        const saved = JSON.parse(global.localStorage?.getItem(SESSION_KEY) || "null");
        return saved?.id ? saved : null;
      } catch (error) {
        console.warn("Não foi possível restaurar a sessão local.", error);
        return null;
      }
    }

    function forgetSession() {
      try {
        global.localStorage?.removeItem(SESSION_KEY);
      } catch (error) {
        console.warn("Não foi possível remover a sessão local.", error);
      }
    }

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

    function signIn({ loginHint = "" } = {}) {
      ensureConfigured();
      return new Promise((resolve, reject) => {
        let finished = false;
        const popupTimeout = setTimeout(() => {
          if (finished) return;
          finished = true;
          clearToken();
          reject(new Error("GOOGLE_POPUP_TIMEOUT"));
        }, popupTimeoutMs);

        function finish(callback) {
          if (finished) return false;
          finished = true;
          clearTimeout(popupTimeout);
          callback();
          return true;
        }

        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: async (response) => {
            if (response.error) {
              finish(() => reject(new Error(response.error)));
              return;
            }
            if (finished) return;
            accessToken = response.access_token;
            expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) - 30) * 1000;
            try {
              const user = await fetchUser();
              finish(() => {
                persistUser(user);
                resolve(user);
              });
            } catch (error) {
              finish(() => reject(error));
            }
          },
          error_callback: (error) => finish(() => reject(new Error(error.type || "GOOGLE_OAUTH_ERROR"))),
        });
        tokenClient.requestAccessToken({
          prompt: loginHint ? "" : "select_account",
          ...(loginHint ? { login_hint: loginHint } : {}),
        });
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
      forgetSession();
      return Promise.resolve();
    }

    return {
      signIn,
      signOut,
      clearToken,
      restoreSession,
      getAccessToken: () => accessToken,
      hasAccessToken: () => Boolean(accessToken),
      isAccessTokenExpired: () => !!accessToken && Date.now() >= expiresAt,
    };
  }

  global.MGGoogleAuth = { create };
})(window);
