(function () {
  if (!window.__GULBARGA_CLOUDINARY_CONFIG) return;

  function register() {
    if (!window.CMS || !window.decapCmsMediaLibraryCloudinary) return false;
    window.decapCmsMediaLibraryCloudinary.init({
      config: window.__GULBARGA_CLOUDINARY_CONFIG,
    });
    return true;
  }

  if (!register()) {
    document.addEventListener("DOMContentLoaded", function () {
      var attempts = 0;
      var timer = window.setInterval(function () {
        attempts += 1;
        if (register() || attempts > 40) {
          window.clearInterval(timer);
        }
      }, 100);
    });
  }
})();
