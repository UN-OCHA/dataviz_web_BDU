/**
 * StatusUI — Status bar message helpers.
 *
 * Shows and clears messages in the #status element.
 * Persistent messages (with links or data-persistent) survive clearStatus()
 * unless force is true.
 *
 * Each message gets a leading Font Awesome (solid) icon matching its type, so
 * the meaning reads from icon + colour, not colour alone. The asset panels
 * reuse StatusUI.iconFor()/escape() so every status surface looks the same.
 */

/* global */

var StatusUI = (function () {
  "use strict";

  var statusEl = document.getElementById("status");

  // FA6 solid glyphs (filled, currentColor — same style as the toolbar icons).
  // fill-rule="evenodd" so the inner cut-outs render regardless of subpath
  // winding direction.
  function svg(d) {
    return '<svg class="status-icon" viewBox="0 0 512 512" fill="currentColor" ' +
      'aria-hidden="true"><path fill-rule="evenodd" d="' + d + '"/></svg>';
  }
  var CIRCLE_CHECK = "M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369 209L241 337c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L335 175c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z";
  var CIRCLE_EXCL = "M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM256 128c13.3 0 24 10.7 24 24l0 112c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-112c0-13.3 10.7-24 24-24zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z";
  var CIRCLE_INFO = "M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336l24 0 0-64-24 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l48 0c13.3 0 24 10.7 24 24l0 88 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-80 0c-13.3 0-24-10.7-24-24s10.7-24 24-24zM256 144a32 32 0 1 1 0-64 32 32 0 1 1 0 64z";
  var TRI_EXCL = "M256 32c14.3 0 27.5 7.6 34.6 20l216 376c7.1 12.4 7.1 27.6-.1 39.9S486.3 488 472 488L40 488c-14.3 0-27.5-7.6-34.6-19.9s-7.2-27.6-.1-39.9L221.4 52c7.1-12.4 20.3-20 34.6-20zM256 160c-13.3 0-24 10.7-24 24l0 112c0 13.3 10.7 24 24 24s24-10.7 24-24l0-112c0-13.3-10.7-24-24-24zM288 384a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z";

  var ICONS = {
    success:     svg(CIRCLE_CHECK),
    error:       svg(CIRCLE_EXCL),
    info:        svg(CIRCLE_INFO),
    warn:        svg(TRI_EXCL),
    "data-warn": svg(TRI_EXCL),
    // "busy" = an async operation in progress (e.g. reflowing a chart after a
    // manual resize). Info colours, but an animated spinner instead of a glyph.
    busy:        '<span class="status-spinner" aria-hidden="true"></span>'
  };

  function iconFor(type) {
    return ICONS[type] || "";
  }

  function escape(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function show(msg, type, html, persistent) {
    if (!statusEl) return;
    // Message text is escaped unless the caller passes html (e.g. a "Load
    // sample data" link) — those callers build trusted markup themselves.
    var body = html ? msg : escape(msg);
    statusEl.innerHTML = iconFor(type) + '<span class="status-text">' + body + '</span>';
    statusEl.className = type;
    statusEl.style.display = "";
    if (persistent) {
      statusEl.dataset.persistent = "1";
    } else {
      delete statusEl.dataset.persistent;
    }
  }

  function clear(force) {
    if (!statusEl) return;
    if (!force && (statusEl.querySelector("a") || statusEl.dataset.persistent)) return;
    statusEl.textContent = "";
    statusEl.className = "";
    statusEl.style.display = "none";
    delete statusEl.dataset.persistent;
  }

  return {
    show:    show,
    clear:   clear,
    iconFor: iconFor,
    escape:  escape
  };
})();
