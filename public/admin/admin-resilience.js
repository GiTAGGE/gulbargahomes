/**
 * GulbargaHomes admin resilience: offline awareness, session recovery, and
 * clearer handling when Netlify Identity tokens expire after long editing.
 */
(function () {
  var BANNER_ID = "gulbargahomes-admin-banner";
  var TOKEN_ERROR = /ACCESS_TOKEN_ERROR|failed getting jwt access token/i;
  var REFRESH_INTERVAL_MS = 3 * 60 * 1000;

  function getIdentity() {
    return window.netlifyIdentity || null;
  }

  function getCurrentUser() {
    var identity = getIdentity();
    if (!identity || !identity.gotrue) return null;
    return identity.gotrue.currentUser();
  }

  function isEditingEntry() {
    return /#\/collections\/.+\/(new|entries)\//.test(window.location.hash || "");
  }

  function refreshSession(force) {
    var user = getCurrentUser();
    if (!user || typeof user.jwt !== "function") return Promise.resolve(false);

    return user
      .jwt(!!force)
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function showBanner(kind, message, action) {
    var existing = document.getElementById(BANNER_ID);
    if (existing) existing.remove();

    var banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.setAttribute("role", "status");
    banner.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:99999",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "gap:12px",
      "flex-wrap:wrap",
      "padding:10px 16px",
      "font:600 14px/1.4 system-ui,sans-serif",
      "color:#fff",
      "box-shadow:0 4px 16px rgba(0,0,0,.15)",
    ].join(";");

    if (kind === "offline") {
      banner.style.background = "#b45309";
    } else if (kind === "error") {
      banner.style.background = "#b91c1c";
    } else {
      banner.style.background = "#1a5142";
    }

    var text = document.createElement("span");
    text.textContent = message;
    banner.appendChild(text);

    if (action) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.style.cssText = [
        "border:0",
        "border-radius:999px",
        "padding:6px 14px",
        "font:inherit",
        "font-weight:700",
        "cursor:pointer",
        "background:#fff",
        "color:#0f2a24",
      ].join(";");
      button.addEventListener("click", action.onClick);
      banner.appendChild(button);
    }

    document.body.appendChild(banner);
  }

  function hideBanner() {
    var banner = document.getElementById(BANNER_ID);
    if (banner) banner.remove();
  }

  function openLogin() {
    var identity = getIdentity();
    if (!identity) return;
    identity.open("login");
  }

  function handleSessionExpired() {
    showBanner(
      "error",
      "Your login session expired. Your draft is saved in this browser — refresh the session to publish without losing edits.",
      {
        label: "Refresh session",
        onClick: function () {
          refreshSession(true).then(function (ok) {
            if (ok) {
              hideBanner();
              showBanner("info", "Session restored. You can publish now.", null);
              window.setTimeout(hideBanner, 4000);
              return;
            }
            openLogin();
          });
        },
      },
    );
  }

  function handleOffline() {
    showBanner(
      "offline",
      "You are offline. Keep editing — Decap CMS saves a local draft in this browser. Publish after you reconnect.",
      null,
    );
  }

  function handleOnline() {
    hideBanner();
    refreshSession(true).then(function (ok) {
      if (!ok && getCurrentUser()) {
        handleSessionExpired();
        return;
      }
      if (ok) {
        showBanner("info", "Back online. Session refreshed — you can publish now.", null);
        window.setTimeout(hideBanner, 3500);
      }
    });
  }

  function isTokenError(value) {
    if (!value) return false;
    if (typeof value === "string") return TOKEN_ERROR.test(value);
    if (value.message && TOKEN_ERROR.test(value.message)) return true;
    if (value.toString && TOKEN_ERROR.test(value.toString())) return true;
    return false;
  }

  function watchErrors() {
    window.addEventListener("unhandledrejection", function (event) {
      if (isTokenError(event.reason)) {
        event.preventDefault();
        handleSessionExpired();
      }
    });

    var originalError = console.error;
    console.error = function () {
      for (var i = 0; i < arguments.length; i++) {
        if (isTokenError(arguments[i])) {
          handleSessionExpired();
          break;
        }
      }
      return originalError.apply(console, arguments);
    };
  }

  function registerCmsHooks() {
    if (!window.CMS || !window.CMS.registerEventListener) {
      window.setTimeout(registerCmsHooks, 200);
      return;
    }

    function guardPublish() {
      if (!navigator.onLine) {
        handleOffline();
        return Promise.reject(new Error("Offline — draft saved locally. Reconnect to publish."));
      }

      return refreshSession(true).then(function (ok) {
        if (ok) return;
        handleSessionExpired();
        return Promise.reject(
          new Error("Session expired — use Refresh session or log in again. Your draft is still in this browser."),
        );
      });
    }

    window.CMS.registerEventListener({
      name: "prePublish",
      handler: guardPublish,
    });

    window.CMS.registerEventListener({
      name: "preSave",
      handler: guardPublish,
    });
  }

  function startTokenRefreshLoop() {
    window.setInterval(function () {
      if (!navigator.onLine) return;
      refreshSession(true).then(function (ok) {
        if (!ok && getCurrentUser()) {
          handleSessionExpired();
        }
      });
    }, REFRESH_INTERVAL_MS);
  }

  function onTabVisible() {
    if (document.visibilityState !== "visible") return;
    if (!navigator.onLine) return;
    refreshSession(true).then(function (ok) {
      if (!ok && getCurrentUser()) handleSessionExpired();
    });
  }

  function warnBeforeUnload(event) {
    if (!isEditingEntry()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function init() {
    watchErrors();
    registerCmsHooks();
    startTokenRefreshLoop();

    if (!navigator.onLine) {
      handleOffline();
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", onTabVisible);
    document.addEventListener("visibilitychange", onTabVisible);
    window.addEventListener("beforeunload", warnBeforeUnload);

    var identity = getIdentity();
    if (identity) {
      identity.on("login", function () {
        hideBanner();
        refreshSession(true);
      });
      identity.on("logout", hideBanner);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
