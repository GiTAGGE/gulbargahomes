/**
 * Netlify Identity defaults to open registration. Force the login tab unless
 * the URL contains an invite/recovery token from a Netlify email link.
 */
(function () {
  var INVITE_HASH = /invite_token|confirmation_token|recovery_token|email_change_token/;

  function guardIdentity() {
    var identity = window.netlifyIdentity;
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
    var identity = window.netlifyIdentity;
    if (!identity) return;

    identity.on("init", function (user) {
      if (!user) {
        identity.on("login", function () {
          if (window.location.pathname.indexOf("/admin/") === 0) return;
          window.location.href = "/admin/index.html";
        });
      }
    });
  }

  function init() {
    guardIdentity();
    bindAdminRedirect();
  }

  if (window.netlifyIdentity) {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
