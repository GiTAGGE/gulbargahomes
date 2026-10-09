/**
 * Netlify Identity defaults to open registration. Force the login tab unless
 * the URL contains an invite/recovery token from a Netlify email link.
 *
 * Email links land on the site root with a hash (#recovery_token=…). The
 * widget modal is easy to miss on the public homepage, so we send those links
 * to /admin/index.html first. After login, always reload admin so Decap CMS
 * retries Git Gateway /settings with a fresh JWT.
 */
(function () {
  var INVITE_HASH = /invite_token|confirmation_token|recovery_token|email_change_token/;
  var IDENTITY_API = "https://gulbargahomes.com/.netlify/identity";
  var ADMIN_HREF = "/admin/index.html";

  var hash = window.location.hash || "";
  var path = window.location.pathname || "";
  if (INVITE_HASH.test(hash) && path.indexOf("/admin/") === -1) {
    window.location.replace(ADMIN_HREF + hash);
    return;
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

  function guardIdentity() {
    var identity = getIdentity();
    if (!identity || identity.__gulbargaHomesGuarded) return;

    var originalOpen = identity.open.bind(identity);
    identity.open = function (mode, options) {
      var hasInviteFlow = INVITE_HASH.test(window.location.hash || "");
      if (!hasInviteFlow && mode !== "login") {
        mode = "login";
      }
      return originalOpen(mode, options);
    };

    identity.__gulbargaHomesGuarded = true;
    identity.__gulbargaHomesOriginalOpen = originalOpen;
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
