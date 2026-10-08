/**
 * ThemesUI — UI for user-defined custom COLOR themes.
 *
 * Renders custom theme radios into the Style menu, and drives the
 * "Custom colour themes" modal (create / edit / import / export / delete).
 * Persists via ThemesStore and registers into ChartRegistry.CUSTOM_THEMES so
 * the chart engine treats a custom theme exactly like a built-in style.
 *
 * panel.js wires it up:
 *   ThemesUI.init({
 *     registry: ChartRegistry, store: ThemesStore,
 *     onApplyStyle: applyStyleSelection,      // (styleId) => void
 *     getCurrentStyle: function(){ return DataStore.style; },
 *     status: function(msg){ ... }            // optional toast
 *   });
 *
 * Full palette control: the user defines the categorical palette directly
 * (first colour = primary). The map ramp / swatches / icon palette are
 * auto-derived from it by ChartRegistry.registerCustomTheme (maps are hidden
 * on the main branch, so the categorical palette is what every visible chart
 * uses).
 */
/* global document, Connector */

var ThemesUI = (function () {
  "use strict";

  var R, S, applyStyle, getCurrentStyle, statusFn;
  var editingId = null; // non-null while editing an existing theme
  var installedFonts = null; // family names from the host (lowercased set), or null if not loaded yet
  var colorMode = "hex";     // "hex" | "cmyk" — how palette colours are typed/shown (stored value is always hex)

  var BUILTIN_IDS = { ocha: 1, hnrp: 1, flash: 1, gho: 1 };

  function $(id) { return document.getElementById(id); }

  // In-modal message (so validation/save/import feedback shows inside the
  // Custom themes dialog, properly styled — not in the panel's status bar
  // behind it). type: "error" | "warn" | "success" | "info".
  function modalMsg(msg, type) {
    var el = $("themes-msg");
    if (!el) { statusFn(msg, type === "error" ? "error" : (type || "success")); return; }
    type = type || "info";
    var icon = (typeof StatusUI !== "undefined" && StatusUI.iconFor) ? StatusUI.iconFor(type) : "";
    var body = (typeof StatusUI !== "undefined" && StatusUI.escape) ? StatusUI.escape(msg) : msg;
    el.innerHTML = icon + '<span class="status-text">' + body + "</span>";
    el.className = type;   // reuses the #status.<type> look (icon + colour tokens)
  }
  function clearModalMsg() { var el = $("themes-msg"); if (el) { el.className = ""; el.innerHTML = ""; } }

  // Analytics ping (anonymous; never sends the theme name). Events:
  // theme:create, theme:edit, theme:import, theme:export. (Applying a custom
  // theme is tracked as style:custom by panel.js.)
  function _ping(ev) {
    if (typeof window !== "undefined" && window.sendAnalyticsPing) {
      try { window.sendAnalyticsPing(ev); } catch (e) {}
    }
  }

  function init(opts) {
    R = opts.registry;
    S = opts.store;
    applyStyle = opts.onApplyStyle || function () {};
    getCurrentStyle = opts.getCurrentStyle || function () { return "ocha"; };
    statusFn = opts.status || function () {};

    // Load persisted custom themes into the registry.
    var saved = (S && S.loadAll) ? (S.loadAll() || []) : [];
    saved.forEach(function (t) { if (t && t.id && t.colors) R.registerCustomTheme(t); });

    renderRadios();
    wireModal();
    loadInstalledFonts();
  }

  // Populate the font picker datalist from Illustrator's installed fonts
  // (app.textFonts via ExtendScript — works on Mac + Windows). So users choose
  // a font that actually exists instead of typing a name that may not.
  function loadInstalledFonts() {
    var selT = $("theme-font-title"), selB = $("theme-font-body");
    if (!selT || !selB) return;
    // Illustrator only: the web shell has no Illustrator bridge.
    var cs = (typeof Connector !== "undefined") ? Connector.illustrator : null;
    if (!cs) return;
    try {
      cs.evalScript("getInstalledFonts()", function (res) {
        var fams;
        try { fams = JSON.parse(res); } catch (e) { return; }
        if (!fams || !fams.length) return;
        installedFonts = {};
        var html = '<option value="">Default (Roboto)</option>';
        for (var i = 0; i < fams.length; i++) {
          installedFonts[String(fams[i]).toLowerCase()] = true;
          html += '<option value="' + _esc(fams[i]) + '">' + _esc(fams[i]) + "</option>";
        }
        var tv = selT.value, bv = selB.value;   // preserve current selection
        selT.innerHTML = html; selB.innerHTML = html;
        _setFontSelect(selT, tv); _setFontSelect(selB, bv);
      });
    } catch (e) { /* outside CEP or host unavailable */ }
  }

  // Set a font <select> to a value, adding a "(not installed)" option first if
  // the value isn't among the installed fonts (e.g. editing an imported theme
  // whose font this machine lacks).
  function _setFontSelect(sel, name) {
    if (!sel) return;
    name = name || "";
    if (name) {
      var found = false;
      for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === name) { found = true; break; } }
      if (!found) {
        var o = document.createElement("option");
        o.value = name; o.textContent = name + " (not installed)";
        sel.appendChild(o);
      }
    }
    sel.value = name;
  }

  // ── Custom theme radios (in the Style menu) ─────────────
  function renderRadios() {
    var host = $("custom-style-list");
    if (!host) return;
    host.innerHTML = "";
    var current = getCurrentStyle();
    var ids = Object.keys(R.CUSTOM_THEMES || {});
    ids.forEach(function (id) {
      var th = R.CUSTOM_THEMES[id];
      var label = document.createElement("label");
      label.className = "menu-radio";
      var ramp = th.colors.slice(0, 6).map(function (c) {
        return '<span style="background:' + c + '"></span>';
      }).join("");
      label.innerHTML =
        '<input type="radio" name="style" value="' + id + '"' + (id === current ? " checked" : "") + "> " +
        _esc(th.name) +
        '<span class="style-ramp">' + ramp + "</span>";
      var radio = label.querySelector("input");
      radio.addEventListener("change", function () {
        if (this.checked) {
          applyStyle(this.value);
          var w = _missingFontMsg(R.CUSTOM_THEMES[this.value]);
          if (w) statusFn(w, "warn", true);   // applied from the menu — use the panel status bar
        }
      });
      host.appendChild(label);
    });
  }

  // ── Modal wiring ────────────────────────────────────────
  function wireModal() {
    var openBtn = $("manage-themes-btn");
    var modal = $("themes-modal");
    if (openBtn && modal) {
      openBtn.addEventListener("click", function () {
        resetEditor();
        renderThemesList();
        loadInstalledFonts();   // refresh in case the host wasn't ready at init
        modal.style.display = "flex";
      });
    }
    var closeBtn = $("themes-close");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (modal) {
      modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    }

    var addColor = $("theme-add-color");
    if (addColor) addColor.addEventListener("click", function () { addColorRow("#009EDB"); });

    var bh = $("cmode-hex"), bc = $("cmode-cmyk");
    if (bh) bh.addEventListener("click", function () { setColorMode("hex"); });
    if (bc) bc.addEventListener("click", function () { setColorMode("cmyk"); });

    var saveBtn = $("theme-save");
    if (saveBtn) saveBtn.addEventListener("click", saveTheme);

    var cancelBtn = $("theme-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", resetEditor);

    var importBtn = $("themes-import");
    if (importBtn) importBtn.addEventListener("click", doImport);
  }

  function closeModal() { var m = $("themes-modal"); if (m) m.style.display = "none"; }

  // ── Themes list (existing custom themes) ────────────────
  function renderThemesList() {
    var list = $("themes-list");
    if (!list) return;
    list.innerHTML = "";
    var ids = Object.keys(R.CUSTOM_THEMES || {});
    if (!ids.length) {
      list.innerHTML = '<div class="themes-empty">No custom themes yet. Build one below.</div>';
      return;
    }
    ids.forEach(function (id) {
      var th = R.CUSTOM_THEMES[id];
      var row = document.createElement("div");
      row.className = "themes-row";
      var ramp = th.colors.slice(0, 8).map(function (c) {
        return '<span style="background:' + c + '"></span>';
      }).join("");
      row.innerHTML =
        '<span class="themes-row-name">' + _esc(th.name) + "</span>" +
        '<span class="style-ramp themes-row-ramp">' + ramp + "</span>" +
        '<span class="themes-row-actions">' +
          '<button type="button" class="themes-mini-btn" data-act="edit">Edit</button>' +
          '<button type="button" class="themes-mini-btn" data-act="export">Export</button>' +
          '<button type="button" class="themes-mini-btn themes-danger" data-act="delete">Delete</button>' +
        "</span>";
      row.querySelector('[data-act="edit"]').addEventListener("click", function () { editTheme(id); });
      row.querySelector('[data-act="export"]').addEventListener("click", function () { exportTheme(id); });
      row.querySelector('[data-act="delete"]').addEventListener("click", function () { deleteTheme(id); });
      list.appendChild(row);
    });
  }

  // ── Palette editor ──────────────────────────────────────
  function addColorRow(hex) {
    var host = $("theme-colors");
    if (!host) return;
    hex = _normHex(hex) || "#009EDB";
    var row = document.createElement("div");
    row.className = "theme-color-row";
    row.innerHTML =
      '<span class="theme-color-tag"></span>' +
      '<input type="color" class="theme-color-swatch" value="' + hex + '">' +
      '<input type="text" class="theme-hex" value="' + _displayColor(hex) + '">' +
      '<button type="button" class="theme-color-rm" title="Remove">&times;</button>';
    var sw = row.querySelector(".theme-color-swatch");
    var tx = row.querySelector(".theme-hex");
    // The colour picker always holds the real hex; the text field shows hex or
    // CMYK depending on the mode and converts back to hex on edit.
    sw.addEventListener("input", function () { tx.value = _displayColor(sw.value); });
    tx.addEventListener("change", function () {
      var n = (colorMode === "cmyk") ? _cmykToHex(tx.value) : _normHex(tx.value);
      if (n) { sw.value = n; tx.value = _displayColor(n); }
      else { tx.value = _displayColor(sw.value); }
    });
    row.querySelector(".theme-color-rm").addEventListener("click", function () {
      row.parentNode.removeChild(row);
      markPrimary();
    });
    host.appendChild(row);
    markPrimary();
  }

  // Tag + highlight the first colour row as the Primary colour. Re-run whenever
  // rows are added/removed so removing the first promotes the next.
  function markPrimary() {
    var rows = document.querySelectorAll("#theme-colors .theme-color-row");
    for (var i = 0; i < rows.length; i++) {
      var tag = rows[i].querySelector(".theme-color-tag");
      if (i === 0) {
        rows[i].classList.add("is-primary");
        if (tag) tag.textContent = "Primary";
      } else {
        rows[i].classList.remove("is-primary");
        if (tag) tag.textContent = "";
      }
    }
  }

  // Read the palette as hex from the colour pickers (always hex regardless of
  // the hex/CMYK display mode), so storage stays RGB.
  function readColors() {
    var out = [];
    var sws = document.querySelectorAll("#theme-colors .theme-color-swatch");
    for (var i = 0; i < sws.length; i++) {
      var n = _normHex(sws[i].value);
      if (n) out.push(n);
    }
    return out;
  }

  // ── Hex / CMYK display mode ─────────────────────────────
  function _displayColor(hex) {
    return (colorMode === "cmyk") ? _hexToCmyk(hex) : (_normHex(hex) || hex);
  }
  // Naive (non-ICC) conversions — fine for typing brand CMYK values; the stored
  // colour is the resulting RGB hex.
  function _hexToCmyk(hex) {
    var n = _normHex(hex); if (!n) return "0, 0, 0, 0";
    var r = parseInt(n.substr(1, 2), 16) / 255,
        g = parseInt(n.substr(3, 2), 16) / 255,
        b = parseInt(n.substr(5, 2), 16) / 255;
    var k = 1 - Math.max(r, g, b), c = 0, m = 0, y = 0;
    if (k < 1) { c = (1 - r - k) / (1 - k); m = (1 - g - k) / (1 - k); y = (1 - b - k) / (1 - k); }
    function p(x) { return Math.round(x * 100); }
    return p(c) + ", " + p(m) + ", " + p(y) + ", " + p(k);
  }
  function _cmykToHex(str) {
    var parts = String(str).split(/[\s,\/]+/).filter(function (s) { return s !== ""; });
    if (parts.length < 4) return null;
    var v = parts.slice(0, 4).map(parseFloat);
    for (var i = 0; i < 4; i++) { if (isNaN(v[i]) || v[i] < 0 || v[i] > 100) return null; }
    var c = v[0] / 100, m = v[1] / 100, y = v[2] / 100, k = v[3] / 100;
    function h(x) { x = Math.max(0, Math.min(255, Math.round(255 * (1 - x) * (1 - k)))); return ("0" + x.toString(16)).slice(-2); }
    return ("#" + h(c) + h(m) + h(y)).toUpperCase();
  }
  function refreshColorInputs() {
    var rows = document.querySelectorAll("#theme-colors .theme-color-row");
    for (var i = 0; i < rows.length; i++) {
      var sw = rows[i].querySelector(".theme-color-swatch");
      var tx = rows[i].querySelector(".theme-hex");
      if (sw && tx) tx.value = _displayColor(sw.value);
    }
  }
  function setColorMode(mode) {
    colorMode = mode;
    var bh = $("cmode-hex"), bc = $("cmode-cmyk");
    if (bh) bh.classList.toggle("is-active", mode === "hex");
    if (bc) bc.classList.toggle("is-active", mode === "cmyk");
    refreshColorInputs();
  }

  function resetEditor() {
    editingId = null;
    var t = $("themes-editor-title"); if (t) t.textContent = "New theme";
    var name = $("theme-name"); if (name) name.value = "";
    var host = $("theme-colors"); if (host) host.innerHTML = "";
    clearModalMsg();
    _setFontSelect($("theme-font-title"), "");
    _setFontSelect($("theme-font-body"), "");
    // seed with three shades of blue as a starting point
    addColorRow("#009EDB"); addColorRow("#0074B7"); addColorRow("#002E6E");
  }

  function editTheme(id) {
    var th = R.CUSTOM_THEMES[id];
    if (!th) return;
    editingId = id;
    var t = $("themes-editor-title"); if (t) t.textContent = "Edit theme";
    var name = $("theme-name"); if (name) name.value = th.name;
    var host = $("theme-colors"); if (host) host.innerHTML = "";
    th.colors.forEach(function (c) { addColorRow(c); });
    _setFontSelect($("theme-font-title"), (th.fonts && th.fonts.title) || "");
    _setFontSelect($("theme-font-body"), (th.fonts && th.fonts.body) || "");
  }

  function saveTheme() {
    var nameEl = $("theme-name");
    var name = nameEl ? nameEl.value.trim() : "";
    var colors = readColors();
    if (!name) { modalMsg("Please name the theme.", "error"); return; }
    if (colors.length < 2) { modalMsg("Add at least two palette colours.", "error"); return; }

    var wasEditing = !!editingId;
    var id = editingId || _uniqueId(name);
    var theme = { id: id, name: name, colors: colors };

    // Optional fonts. When set, measure the per-character advance so layout
    // estimation stays tight for non-Roboto fonts; store it in the theme.
    var titleFont = (($("theme-font-title") || {}).value || "").trim();
    var bodyFont = (($("theme-font-body") || {}).value || "").trim();
    if (titleFont || bodyFont) {
      theme.fonts = { title: titleFont, body: bodyFont };
      theme.metrics = _measureMetrics(titleFont, bodyFont);
    }

    R.registerCustomTheme(theme);
    if (S && S.addOrUpdate) S.addOrUpdate(theme);
    _ping(wasEditing ? "theme:edit" : "theme:create");

    renderRadios();
    renderThemesList();
    editingId = null;
    var tt = $("themes-editor-title"); if (tt) tt.textContent = "New theme";
    // apply it immediately
    var radio = document.querySelector('input[name="style"][value="' + id + '"]');
    if (radio) { radio.checked = true; applyStyle(id); }
    var w = _missingFontMsg(R.CUSTOM_THEMES[id]);
    if (w) modalMsg(w, "warn");
    else modalMsg((wasEditing ? "Theme updated: " : "Theme saved: ") + name, "success");
  }

  function exportTheme(id) {
    var th = R.CUSTOM_THEMES[id];
    if (!th || !S || !S.exportTheme) return;
    // export a clean theme object (drop internal _styleObj / derived fields the
    // importer will rebuild; keep colors + optional ramp/swatches)
    var clean = { id: th.id, name: th.name, colors: th.colors, ramp: th.ramp, fonts: th.fonts, metrics: th.metrics };
    S.exportTheme(clean, function (res) {
      if (res) { _ping("theme:export"); modalMsg("Exported: " + res, "success"); }
      else modalMsg("Export cancelled.", "info");
    });
  }

  function deleteTheme(id) {
    var th = R.CUSTOM_THEMES[id];
    if (!th) return;
    R.removeCustomTheme(id);
    if (S && S.remove) S.remove(id);
    // if the deleted theme was active, fall back to OCHA
    if (getCurrentStyle() === id) {
      var ocha = document.querySelector('input[name="style"][value="ocha"]');
      if (ocha) { ocha.checked = true; }
      applyStyle("ocha");
    }
    renderRadios();
    renderThemesList();
    statusFn("Theme deleted: " + th.name);
  }

  function doImport() {
    if (!S || !S.importThemes) return;
    S.importThemes(function (incoming) { _applyImported(incoming || []); });
  }

  function _applyImported(incoming) {
    if (!incoming.length) { modalMsg("Nothing imported.", "info"); return; }
    var n = 0, missAll = {};
    incoming.forEach(function (t) {
      if (!t || !t.colors || !t.colors.length) return;
      if (!t.id || BUILTIN_IDS[t.id]) t.id = _uniqueId(t.name || "theme");
      R.registerCustomTheme(t);
      if (S.addOrUpdate) S.addOrUpdate(t);
      _missingFonts(R.CUSTOM_THEMES[t.id]).forEach(function (f) { missAll[f] = true; });
      n++;
    });
    if (n) _ping("theme:import");
    renderRadios();
    renderThemesList();
    var missNames = Object.keys(missAll);
    if (missNames.length) {
      var plural = missNames.length > 1;
      modalMsg("Imported " + n + " theme" + (n === 1 ? "" : "s") + ", but " +
        (plural ? "some fonts aren't" : "a font isn't") + ' installed on this computer: "' +
        missNames.join('", "') + '". Charts will use a default font (Arial) until you install ' +
        (plural ? "them" : "it") + ".", "warn");
    } else {
      modalMsg("Imported " + n + " theme" + (n === 1 ? "" : "s") + ".", "success");
    }
  }

  // ── helpers ─────────────────────────────────────────────
  function _normHex(h) {
    h = String(h || "").trim();
    if (h && h[0] !== "#") h = "#" + h;
    if (/^#[0-9a-fA-F]{3}$/.test(h)) {
      h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }
    return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : null;
  }
  function _slug(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
  }
  function _uniqueId(name) {
    var base = _slug(name), id = base, n = 2;
    while (BUILTIN_IDS[id] || (R.CUSTOM_THEMES && R.CUSTOM_THEMES[id])) { id = base + "-" + n; n++; }
    return id;
  }
  function _esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Which of a theme's fonts are NOT installed on this computer. Returns [] when
  // the theme has no fonts, or when the installed list isn't known yet (so we
  // never false-alarm). Matches family names case-insensitively.
  function _missingFonts(theme) {
    if (!theme || !theme.fonts || !installedFonts) return [];
    var want = [];
    if (theme.fonts.title) want.push(theme.fonts.title);
    if (theme.fonts.body && theme.fonts.body !== theme.fonts.title) want.push(theme.fonts.body);
    var miss = [];
    for (var i = 0; i < want.length; i++) {
      if (!installedFonts[String(want[i]).toLowerCase().trim()]) miss.push(want[i]);
    }
    return miss;
  }
  function _missingFontMsg(theme) {
    var miss = _missingFonts(theme);
    if (!miss.length) return "";
    var plural = miss.length > 1;
    return 'Font not installed: "' + miss.join('", "') + '". This theme uses a font your ' +
      "computer doesn't have, so charts show a default font (Arial) instead. Install " +
      (plural ? "these fonts" : "this font") + " - or ask whoever shared the theme which " +
      "font it needs - then reload the panel.";
  }

  // Measure a font's average per-character advance ratio via canvas. If the
  // font isn't installed the browser falls back, giving a close-enough value.
  // Returns null on anything implausible so the engine keeps the Roboto default.
  function _measureAdvance(stack, weight) {
    try {
      var ctx = document.createElement("canvas").getContext("2d");
      var size = 100;
      ctx.font = (weight ? weight + " " : "") + size + "px " + stack;
      var sample = "The quick brown Fox 1234567890 jumps";
      var adv = ctx.measureText(sample).width / (sample.length * size);
      return (adv > 0.2 && adv < 1.2) ? Math.round(adv * 1000) / 1000 : null;
    } catch (e) { return null; }
  }
  function _measureMetrics(titleFont, bodyFont) {
    function stack(n) { return n ? ('"' + n + '", Arial, Helvetica, sans-serif') : "Arial, Helvetica, sans-serif"; }
    var body = stack(bodyFont || titleFont);
    var head = stack(titleFont || bodyFont);
    var m = {};
    var la = _measureAdvance(body, "normal");  if (la) m.labelAdvance = la;
    var ha = _measureAdvance(head, "normal");  if (ha) m.headingAdvance = ha;
    var hb = _measureAdvance(head, "bold");     if (hb) m.headingBoldAdvance = hb;
    return m;
  }

  return { init: init, renderRadios: renderRadios };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = ThemesUI; }
