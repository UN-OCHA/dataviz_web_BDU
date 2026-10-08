/**
 * FlagsPanel — Country flag gallery & placement.
 * Reads SVG flags bundled in client/flags/.
 * Simple panel: search + grid, click to place in Illustrator.
 */

/* global Connector, FlagsData, PanelUtils */

var FlagsPanel = (function () {
  "use strict";

  var panelEl = null;
  var listEl = null;
  var searchEl = null;
  var statusEl = null;
  var isOpen = false;
  var csInterface = null;
  var flagsDir = "";   // Full native path to client/flags/
  var idCounter = 0;   // For scoping SVG IDs in inline previews

  // ── Initialization ─────────────────────────────────────

  function init() {
    panelEl = document.getElementById("flags-panel");
    listEl = document.getElementById("flags-list");
    searchEl = document.getElementById("flags-search");
    statusEl = document.getElementById("flags-status");

    if (!panelEl) return;

    // Illustrator bridge (null in the web shell, where nothing is placed)
    csInterface = Connector.illustrator;

    // Resolve flags directory
    flagsDir = Connector.paths.flags;

    // Event listeners
    if (searchEl) {
      searchEl.addEventListener("input", renderList);
    }

    // Close button
    var closeBtn = document.getElementById("btn-flags-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", close);
    }

    renderList();
  }

  // ── Rendering ──────────────────────────────────────────

  // ── Recent flags (localStorage) ─────────────────────────
  var RECENT_KEY = "ocha_dataviz_recent_flags";
  var RECENT_MAX = 8;
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
  }
  function pushRecent(file) {
    try {
      var arr = getRecent().filter(function (k) { return k !== file; });
      arr.unshift(file);
      if (arr.length > RECENT_MAX) arr = arr.slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  function recentHtml() {
    var recents = getRecent();
    if (!recents.length) return "";
    var items = [];
    for (var r = 0; r < recents.length; r++) {
      for (var ri = 0; ri < FlagsData.length; ri++) {
        if (FlagsData[ri].file === recents[r]) { items.push(FlagsData[ri]); break; }
      }
    }
    if (!items.length) return "";
    var h = '<div class="flags-recent"><div class="flags-recent-label">Recent</div><div class="flags-grid">';
    for (var i = 0; i < items.length; i++) {
      var f = items[i];
      h += '<button class="flags-item" data-file="' + escapeAttr(f.file) + '" title="' + escapeAttr(f.name + (f.code ? " (" + f.code + ")" : "")) + '">';
      h += '<div class="flags-item-preview">' + getSvgInline(f.file) + '</div>';
      h += '<span class="flags-item-name">' + escapeHtml(f.name) + '</span></button>';
    }
    h += '</div></div>';
    return h;
  }

  var previewsReady = false;

  function renderList() {
    if (!listEl) return;
    // Web: draw the list only once the panel is open and the flag files
    // have arrived (see PanelUtils.whenFolderReady). Illustrator: as before.
    if (!Connector.fs.local) {
      if (!isOpen) return;
      if (!previewsReady) {
        listEl.innerHTML = '<div class="flags-empty">Loading flags…</div>';
        PanelUtils.whenFolderReady(flagsDir, function () { previewsReady = true; renderList(); });
        return;
      }
    }
    var query = (searchEl ? searchEl.value : "").toLowerCase().trim();

    var filtered = [];
    for (var i = 0; i < FlagsData.length; i++) {
      var flag = FlagsData[i];
      if (query) {
        var nameMatch = flag.name.toLowerCase().indexOf(query) !== -1;
        var codeMatch = flag.code && flag.code.toLowerCase().indexOf(query) !== -1;
        if (!nameMatch && !codeMatch) continue;
      }
      filtered.push(flag);
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="flags-empty">No flags found</div>';
      return;
    }

    var html = '<div class="flags-grid">';
    for (var j = 0; j < filtered.length; j++) {
      var f = filtered[j];
      var svgContent = getSvgInline(f.file);
      html += '<button class="flags-item" data-file="' + escapeAttr(f.file) + '" title="' + escapeAttr(f.name + (f.code ? " (" + f.code + ")" : "")) + '">';
      html += '<div class="flags-item-preview">' + svgContent + '</div>';
      html += '<span class="flags-item-name">' + escapeHtml(f.name) + '</span>';
      html += '</button>';
    }
    html += '</div>';
    listEl.innerHTML = (query ? "" : recentHtml()) + html;

    // Attach click handlers
    var buttons = listEl.querySelectorAll(".flags-item");
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].addEventListener("click", onFlagClick);
    }
  }

  // ── Click to place ─────────────────────────────────────

  function onFlagClick(evt) {
    var btn = evt.currentTarget;
    var file = btn.getAttribute("data-file");
    if (!file) return;

    // Find flag info
    var flag = null;
    for (var i = 0; i < FlagsData.length; i++) {
      if (FlagsData[i].file === file) { flag = FlagsData[i]; break; }
    }
    if (!flag) return;

    var svgPath = flagsDir + "/" + file;
    btn.classList.add("flags-item-loading");
    setStatus((csInterface ? "Placing " : "Preparing ") + flag.name + "…");

    placeFlag(svgPath, flag.name, function (err) {
      btn.classList.remove("flags-item-loading");
      if (err) {
        setStatus((err || "").replace(/^ERROR:\s*/i, ""), true);
      } else {
        setStatus(flag.name + (csInterface ? " placed" : " downloaded"));
        pushRecent(file);
      }
    });
  }

  function placeFlag(svgPath, flagName, callback) {
    if (!csInterface) {
      // Web shell: download the flag instead of placing it.
      PanelUtils.downloadSvgAsset(svgPath, svgPath.split("/").pop(), null, function (err) {
        callback(err);
        if (!err && typeof sendAnalyticsPing === "function") sendAnalyticsPing("tool:flags");
      });
      return;
    }
    var escapedPath = svgPath.replace(/\\/g, "/").replace(/'/g, "\\'");
    var escapedName = (flagName || "").replace(/'/g, "\\'");
    // Reuse placeIcon ExtendScript function — it works for any SVG
    var script = "placeIcon('" + escapedPath + "', 'Flag — " + escapedName + "')";
    csInterface.evalScript(script, function (result) {
      if (result && result.indexOf("ERROR") === 0) {
        callback(result);
      } else {
        callback(null);
        if (typeof sendAnalyticsPing === "function") sendAnalyticsPing("tool:flags");
      }
    });
  }

  // ── SVG reading ────────────────────────────────────────

  function getSvgInline(file) {
    try {
      var fs = Connector.fs;
      var filePath = flagsDir + "/" + file;
      if (fs.exists(filePath)) {
        var content = fs.readText(filePath);
        // Strip <style> blocks to prevent CSS leaks into the panel
        content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
        // Strip XML declarations and doctype
        content = content.replace(/<\?xml[^?]*\?>/gi, "");
        content = content.replace(/<!DOCTYPE[^>]*>/gi, "");
        // Force overflow hidden so elements beyond viewBox are clipped
        content = content.replace(/<svg\b/, '<svg overflow="hidden"');
        // Scope all IDs to avoid conflicts when multiple flags are inlined
        var scope = "f" + (idCounter++);
        content = content.replace(/\bid="([^"]+)"/g, 'id="' + scope + '_$1"');
        content = content.replace(/url\(#([^)]+)\)/g, 'url(#' + scope + '_$1)');
        content = content.replace(/xlink:href="#([^"]+)"/g, 'xlink:href="#' + scope + '_$1"');
        return content;
      }
    } catch (e) { /* silent */ }
    return '<svg viewBox="0 0 56 38"><rect width="56" height="38" fill="#ddd" rx="2"/></svg>';
  }

  // ── Panel open/close ───────────────────────────────────

  function open() {
    if (!panelEl) return;
    panelEl.classList.add("flags-panel-visible");
    isOpen = true;
    setMainUIVisible(false);

    if (searchEl) {
      searchEl.value = "";
      searchEl.focus();
    }
    setStatus("");
    renderList();
  }

  function close() {
    if (!panelEl) return;
    panelEl.classList.remove("flags-panel-visible");
    isOpen = false;
    setMainUIVisible(true);
  }

  function toggle() {
    if (isOpen) close(); else open();
  }

  function setMainUIVisible(show) {
    var display = show ? "" : "none";
    var tabBar = document.getElementById("tab-bar");
    var panelBody = document.getElementById("panel-body");
    var bottomBar = document.getElementById("bottom-bar");
    if (tabBar) tabBar.style.display = display;
    if (panelBody) panelBody.style.display = display;
    if (bottomBar) bottomBar.style.display = display;
  }

  // ── Utilities ──────────────────────────────────────────

  function setStatus(msg, isError) {
    if (!statusEl) return;
    if (!msg) { statusEl.textContent = ""; statusEl.className = "panel-status"; return; }
    // Leading icon (check / exclamation) to match the main status banner.
    var icon = (typeof StatusUI !== "undefined") ? StatusUI.iconFor(isError ? "error" : "success") : "";
    var text = (typeof StatusUI !== "undefined") ? StatusUI.escape(msg) : msg;
    statusEl.innerHTML = icon + '<span class="panel-status-text">' + text + '</span>';
    statusEl.className = "panel-status" + (isError ? " panel-status--error" : "");
  }

  var escapeHtml = PanelUtils.escapeHtml;
  var escapeAttr = PanelUtils.escapeAttr;

  // ── Public API ─────────────────────────────────────────

  return {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () { return isOpen; }
  };
})();
// Initialized from panel.js via FlagsPanel.init()
