/**
 * Netlify Identity defaults to open registration. Force the login tab unless
 * the URL contains an invite/recovery token from a Netlify email link.
 *
 * Decap CMS also uses the URL hash (#/collections/…). If the CMS boots while
 * a recovery_token is still in the hash, the router wins and the reset popup
 * never appears. We stash email-link hashes and block CMS until Identity finishes.
 */
(function () {
  var INVITE_HASH = /invite_token|confirmation_token|recovery_token|email_change_token/;
  var IDENTITY_API = "https://gulbargahomes.com/.netlify/identity";
  var ADMIN_HREF = "/admin/index.html";
  var STASH_KEY = "gulbarga_identity_email_hash";

  function readStashedHash() {
    try {
      return sessionStorage.getItem(STASH_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function writeStashedHash(hash) {
    try {
      sessionStorage.setItem(STASH_KEY, hash);
      window.__gulbargaIdentityEmailPending = true;
    } catch (error) {
      /* Private mode. */
    }
  }

  function clearStashedHash() {
    try {
      sessionStorage.removeItem(STASH_KEY);
    } catch (error) {
      /* Ignore. */
    }
    window.__gulbargaIdentityEmailPending = false;
    window.dispatchEvent(new Event("gulbarga-identity-email-flow-done"));
  }

  function stashIdentityEmailHash() {
    var hash = window.location.hash || "";
    if (INVITE_HASH.test(hash)) {
      writeStashedHash(hash);
    }
  }

  stashIdentityEmailHash();

  window.gulbargaHomesIdentityEmailPending = function () {
    if (window.__gulbargaIdentityEmailPending) return true;
    return INVITE_HASH.test(readStashedHash());
  };

  var hash = window.location.hash || "";
  var path = window.location.pathname || "";
  if (INVITE_HASH.test(hash) && path.indexOf("/admin/") === -1) {
    window.location.replace(ADMIN_HREF + hash);
    return;
  }

  if (path.indexOf("/admin/") !== -1) {
    var pending = readStashedHash();
    if (pending && !INVITE_HASH.test(hash)) {
      window.location.replace(ADMIN_HREF + pending);
      return;
    }
  }

  function getIdentity() {
    return window.netlifyIdentity || null;
  }

  function clearAuthStorage() {
    try {
      localStorage.removeItem("gotrue.user");
      localStorage.removeItem("netlify-cms-user");
    } catch (error) {
      /* Private mode. */
    }

    var host = window.location.hostname;
    document.cookie =
      "nf_jwt=; Max-Age=0; path=/; domain=" + host + "; SameSite=Lax";
    document.cookie = "nf_jwt=; Max-Age=0; path=/; SameSite=Lax";
  }

  function ensureInit() {
    var identity = getIdentity();
    if (!identity || identity.__gulbargaHomesInited) return;
    try {
      identity.init({ APIUrl: IDENTITY_API });
    } catch (error) {
      /* Already initialized. */
    }
    identity.__gulbargaHomesInited = true;
  }

  function goToAdmin() {
    window.location.replace(ADMIN_HREF);
  }

  function applyStashedHashToLocation() {
    var pending = readStashedHash();
    if (!pending || !INVITE_HASH.test(pending)) return;
    if (window.location.hash === pending) return;
    window.location.hash = pending.replace(/^#/, "");
  }

  function openEmailFlowModal(originalOpen) {
    var pending = readStashedHash();
    if (!pending) return;

    if (/recovery_token=/.test(pending)) {
      originalOpen("recovery");
      return;
    }
    if (/invite_token=/.test(pending)) {
      originalOpen("signup");
      return;
    }
    if (/confirmation_token=/.test(pending)) {
      originalOpen("signup");
    }
  }

  function processPendingEmailAuth(originalOpen) {
    var pending = readStashedHash();
    if (!pending || !INVITE_HASH.test(pending)) return;

    window.__gulbargaProcessingEmailAuth = true;
    clearAuthStorage();

    var identity = getIdentity();
    if (identity && identity.currentUser && identity.currentUser()) {
      try {
        identity.logout();
      } catch (error) {
        /* Ignore. */
      }
    }

    applyStashedHashToLocation();
    openEmailFlowModal(originalOpen);
    window.__gulbargaProcessingEmailAuth = false;
  }

  function guardIdentity() {
    var identity = getIdentity();
    if (!identity || identity.__gulbargaHomesGuarded) return;

    var originalOpen = identity.open.bind(identity);
    identity.open = function (mode, options) {
      var hasInviteFlow =
        INVITE_HASH.test(window.location.hash || "") ||
        INVITE_HASH.test(readStashedHash());
      if (!hasInviteFlow && mode !== "login") {
        mode = "login";
      }
      return originalOpen(mode, options);
    };

    identity.__gulbargaHomesGuarded = true;

    identity.on("init", function () {
      processPendingEmailAuth(originalOpen);
    });

    identity.on("login", function () {
      clearStashedHash();
    });

    identity.on("close", function () {
      if (!INVITE_HASH.test(readStashedHash())) return;
      window.setTimeout(function () {
        if (!INVITE_HASH.test(window.location.hash || "")) {
          clearStashedHash();
        }
      }, 300);
    });
  }

  function bindAdminRedirect() {
    var identity = getIdentity();
    if (!identity || identity.__gulbargaHomesLoginBound) return;

    identity.on("login", goToAdmin);
    identity.__gulbargaHomesLoginBound = true;
  }

  function bindLogoutCleanup() {
    var identity = getIdentity();
    if (!identity || identity.__gulbargaHomesLogoutBound) return;

    identity.on("logout", function () {
      if (window.__gulbargaProcessingEmailAuth) return;
      if (INVITE_HASH.test(readStashedHash())) return;

      clearAuthStorage();
      try {
        identity.close();
      } catch (error) {
        /* Ignore. */
      }
      window.location.replace(ADMIN_HREF + "?auth=logged-out");
    });
    identity.__gulbargaHomesLogoutBound = true;
  }

  function enforceLoggedOutLanding() {
    if (!/[?&]auth=logged-out(?:&|$)/.test(window.location.search || "")) return;

    clearAuthStorage();
    var identity = getIdentity();
    if (identity && identity.currentUser && identity.currentUser()) {
      try {
        identity.logout();
      } catch (error) {
        /* Ignore. */
      }
    }
    window.history.replaceState(null, "", ADMIN_HREF);
  }

  function init() {
    ensureInit();
    guardIdentity();
    bindAdminRedirect();
    bindLogoutCleanup();
    enforceLoggedOutLanding();
  }

  if (window.netlifyIdentity) {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
