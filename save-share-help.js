/* ══════════════════════════════════════════════
   Save & share help
   ──────────────────────────────────────────────
   The "How it works" link in the Data tab's Save & share group opens a
   small window explaining, in plain words, what Copy chart, Save… and
   Load… are for. Markup: #save-share-help-modal in index.html (the Use AI
   window's look). Same in the plugin and the web version.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  function init() {
    var link = document.getElementById("btn-save-share-help");
    var modal = document.getElementById("save-share-help-modal");
    if (!link || !modal) return;
    var ok = document.getElementById("save-share-help-ok");
    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      modal.style.display = "flex";
      if (ok) ok.focus();
    }
    function close() {
      modal.style.display = "none";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    link.addEventListener("click", open);
    if (ok) ok.addEventListener("click", close);
    var x = document.getElementById("save-share-help-close");
    if (x) x.addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.style.display === "flex") close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
