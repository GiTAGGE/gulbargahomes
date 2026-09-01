/**
 * Netlify Identity defaults to open registration. Force the login tab unless
 * the URL contains an invite/recovery token from a Netlify email link.
 *
 * After login, always reload /admin/index.html so Decap CMS retries Git
 * Gateway /settings with the new JWT. Skipping that reload is what left the
 * "backend is not returning valid settings" toast on screen.
 */
(function () {
  var INVITE_HASH = /invite_token|confirmation_token|recovery_token|email_change_token/;
  var IDENTITY_API = "https://gulbargahomes.com/.netlify/identity";
  var ADMIN_HREF = "/admin/index.html";

  function getIdentity() {
    return window.netlifyIdentity || null;
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
  }

  function bindAdminRedirect() {
    var identity = getIdentity();
    if (!identity || identity.__gulbargaHomesLoginBound) return;

    identity.on("login", goToAdmin);
    identity.__gulbargaHomesLoginBound = true;
  }

  function init() {
    ensureInit();
    guardIdentity();
    bindAdminRedirect();
  }

  if (window.netlifyIdentity) {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
