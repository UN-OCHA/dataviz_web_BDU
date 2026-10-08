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
   * Web shell: hand an asset SVG (icon, flag, location map) to the user as
   * a download — the web counterpart of placing it on the artboard.
   * Reads the file at `path` unless `text` (e.g. a recoloured icon) is given.
   * callback(err) — err is a message string, like the place functions'.
   */
  function downloadSvgAsset(path, fileName, text, callback) {
    try {
      if (text == null) text = Connector.fs.readText(path);
    } catch (e) {
      callback("This file isn't available in the web version.");
      return;
    }
    Connector.files.saveText({
      title: "Save SVG", extensions: ["svg"], defaultName: fileName,
      mime: "image/svg+xml", text: text
    }, function (err) { callback(err ? ("Couldn't download: " + err.message) : null); });
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

  return {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    resolveExtensionPath: resolveExtensionPath,
    placeFloating: placeFloating,
    downloadSvgAsset: downloadSvgAsset,
    whenFolderReady: whenFolderReady
  };
})();
