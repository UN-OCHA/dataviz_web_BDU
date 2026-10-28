/**
 * PanelUtils — Shared utility functions for all CEP panels.
 * Eliminates duplication of escapeHtml, path resolution, etc.
 */

/* exported PanelUtils */
/* global Connector */

var PanelUtils = (function () {
  "use strict";

  /**
   * Escape HTML special characters for safe insertion.
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Escape for HTML attribute values (includes single quotes).
   */
  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&apos;");
  }

  /**
   * Resolve a CEP extension path for use with Node.js fs.
   * Handles: file:// URI stripping, URI decoding, Windows drive letter fix.
   *
   * @param {string} rawPath - Path from csInterface.getSystemPath(SystemPath.EXTENSION)
   * @returns {string} Clean native filesystem path
   */
  function resolveExtensionPath(rawPath) {
    var p = rawPath.replace(/^file:\/{2,3}/, "/");
    p = decodeURIComponent(p);
    // Windows: strip leading "/" before drive letter (e.g., "/C:/..." → "C:/...")
    if (/^\/[A-Za-z]:/.test(p)) p = p.substring(1);
    return p;
  }

  /**
   * Show a small popover (a colour-swatch dropdown) on top of the whole
   * panel, next to the control that opened it.
   *
   * Popovers placed INSIDE the Design tab get cropped: the setting groups
   * are rounded cards with overflow:hidden, and the tab itself scrolls. So
   * the popover lives on <body> with fixed coordinates: below the anchor, or
   * above it when there is no room below, and kept inside the panel's width.
   * Scrolling or resizing would leave it floating away from its anchor, so
   * either one dismisses it through onDismiss (the caller's own close
   * function, which also clears its "active" swatch state).
   *
   * @param {Element} anchor    - the swatch / button the popover belongs to
   * @param {Element} el        - the popover element (not yet in the page)
   * @param {function} [onDismiss]
   */
  function placeFloating(anchor, el, onDismiss) {
    var GAP = 2, MARGIN = 4;
    el.style.position = "fixed";
    el.style.zIndex = "9999";
    el.style.margin = "0";
    el.style.right = "auto";
    el.style.visibility = "hidden";          // measure before showing
    document.body.appendChild(el);

    var a = anchor.getBoundingClientRect();
    var w = el.offsetWidth, h = el.offsetHeight;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var left = Math.min(Math.max(MARGIN, a.left), Math.max(MARGIN, vw - w - MARGIN));
    var top = a.bottom + GAP;
    if (top + h > vh - MARGIN && a.top - GAP - h >= MARGIN) top = a.top - GAP - h;
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
    el.style.visibility = "";

    if (onDismiss) {
      var dismiss = function (ev) {
        if (ev && ev.type === "scroll" && el.contains(ev.target)) return;
        window.removeEventListener("scroll", dismiss, true);
        window.removeEventListener("resize", dismiss);
        if (el.parentNode) onDismiss();      // still open: close it properly
      };
      window.addEventListener("scroll", dismiss, true);
      window.addEventListener("resize", dismiss);
    }
    return el;
  }

  /**
   * Run fn once every file in `dir` can be read without waiting.
   * In Illustrator the files are on disk, so fn runs right away (same as
   * before). On the web each file is a request to the site, and reading a
   * long list one by one would freeze the page — so they are fetched in
   * parallel in the background first, and fn runs when they have arrived.
   * Returns true when fn ran immediately.
   */
  function whenFolderReady(dir, fn) {
    if (Connector.fs.local) { fn(); return true; }
    var names = [];
    try { names = Connector.fs.list(dir); } catch (e) { names = []; }
    Connector.fs.preload(names.map(function (n) { return dir + "/" + n; })).then(fn, fn);
    return false;
  }

  // ── Empty boxes ─────────────────────────────────────────
  //
  // The Design and Data tabs gather their setting sections into collapsible
  // groups (design-groups.js, data-groups.js). panel.js shows and hides the
  // sections one by one for each chart type, so a group can be left with
  // nothing to show, and a section can be shown while its list is still empty
  // (e.g. "Event Icons" before any event exists). This one helper keeps both
  // tidy, for every group on every tab:
  //
  //   • a section that is shown but holds nothing the user can use gets the
  //     class "panel-empty" (styles.css hides it);
  //   • a group whose sections are all hidden, empty, or no longer inside it
  //     (Label Color / Label Size move into the icon legend) hides its header.
  //
  // "Something the user can use" = a form control, button or link, anything
  // the pointer treats as clickable (colour swatches are plain divs), or a
  // visible hint line. Subtrees hidden by an inline display:none don't count.
  // tests/shell/boot-check.js measures the painted result for every chart
  // type, so a new section that slips past this fails there.
  var USABLE = 'input:not([type="hidden"]), select, textarea, button, a[href], ' +
    '[contenteditable="true"], [role="button"], [role="slider"], [role="switch"], ' +
    '[tabindex]:not([tabindex="-1"]), [id$="-hint"], .hint, canvas';

  function hasUsableContent(el) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.style.display === "none" || c.hidden) continue;
      if (c.matches(USABLE) || getComputedStyle(c).cursor === "pointer") return true;
      if (hasUsableContent(c)) return true;
    }
    return false;
  }

  /**
   * @param {Array} groups - [{ wrapper, body, sections: [el, ...] }, ...]
   * @returns {{refresh: function}}
   */
  function keepGroupsTidy(groups) {
    var queued = false;

    function refresh() {
      queued = false;
      groups.forEach(function (g) {
        var anyUsable = false;
        g.sections.forEach(function (s) {
          var usable = s.parentNode === g.body && s.style.display !== "none" && hasUsableContent(s);
          // Only touch the DOM on a real change, or the observer below would
          // re-trigger itself on every refresh.
          var isMarked = s.classList.contains("panel-empty");
          var shown = s.style.display !== "none" && s.parentNode === g.body;
          if (shown && !usable && !isMarked) s.classList.add("panel-empty");
          else if ((!shown || usable) && isMarked) s.classList.remove("panel-empty");
          if (usable) anyUsable = true;
        });
        var wanted = anyUsable ? "" : "none";
        if (g.wrapper.style.display !== wanted) g.wrapper.style.display = wanted;
      });
    }

    function queueRefresh() {
      if (queued) return;
      queued = true;
      // Coalesce the burst of changes a chart-type switch causes.
      (window.requestAnimationFrame || window.setTimeout)(refresh, 0);
    }

    var observer = new MutationObserver(queueRefresh);
    groups.forEach(function (g) {
      g.sections.forEach(function (s) {
        observer.observe(s, { attributes: true, attributeFilter: ["style", "class", "hidden"],
                              childList: true, subtree: true });
      });
      // A section moved out of (or back into) the group changes its body.
      observer.observe(g.body, { childList: true });
    });

    refresh();
    return { refresh: refresh };
  }

  return {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    resolveExtensionPath: resolveExtensionPath,
    placeFloating: placeFloating,
    whenFolderReady: whenFolderReady,
    keepGroupsTidy: keepGroupsTidy
  };
})();
