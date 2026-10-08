/**
 * Icon/Flag Column UI — Picker, row list, radio buttons, and auto-fill.
 *
 * Manages the icon/flag column feature: radio toggles (none/icons/flags),
 * per-row icon picker popup (search, family pills, lazy-loading grid),
 * auto-fill from column values, and the Design tab row list.
 *
 * Dependencies (via init):
 *   store         — DataStore reference
 *   generate      — generateSVG function
 *   schedule      — scheduleLiveUpdate function
 *   clearIconCache — SvgInlineUtils.clearCache
 *   getPreviewHtml — SvgInlineUtils.getPreviewHtml
 *   resolveFlag   — SvgInlineUtils.resolveFlag
 *   resolveIcon   — SvgInlineUtils.resolveIcon
 *   assetFlagsDir — path to flags directory
 *   assetIconsDir — path to icons-cache directory
 *   syncIconColor — ColorPickersUI.syncIconColor
 *   buildLegendRows — SeriesLegendUI.buildLegendRows
 *   buildKfIconRows — KeyFiguresUI.buildIconRows
 */

/* global IconsPanel, FlagsData, PanelUtils, Connector */

var IconFlagUI = (function () {
  "use strict";

  // Injected dependencies
  var _store, _generate, _schedule, _clearIconCache;
  var _getPreviewHtml, _resolveFlag, _resolveIcon;
  var _assetFlagsDir, _assetIconsDir;
  var _syncIconColor, _buildLegendRows, _buildKfIconRows, _buildTimelineIconRows;

  // DOM refs
  var iconColSection, radNone, radFlags, radIcons;
  var iconAutofillWrap, selIconMatchCol, btnIconAutofill, iconColHint;
  var iconColorWrap;
  var iconPickerPopup, iconPickerSearch, iconPickerGrid;
  var iconPickerClose, iconPickerFamilyPills;
  var iconRowListEl;

  // Picker state
  var iconPickerTargetRow = -1;
  var iconPickerActiveFamily = "";
  var iconPickerMode = "row-icons"; // "row-icons" | "icon-series" | "keyfigures"

  // SVG thumbnails for built-in icon shapes (shared with legend rows)
  var SHAPE_THUMBS = {
    people: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="6" cy="5" r="2.5"/><path d="M6,9C3,9,1,11,1,13.5a1,1,0,0,0,2,0C3,12,4,11,6,11s3,1,3,2.5a1,1,0,0,0,2,0C11,11,9,9,6,9Z"/><circle cx="18" cy="5" r="2.5"/><path d="M18,9c-3,0-5,2-5,4.5a1,1,0,0,0,2,0c0-1.5,1-2.5,3-2.5s3,1,3,2.5a1,1,0,0,0,2,0C23,11,21,9,18,9Z"/></svg>',
    man: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="12" cy="4" r="3"/><path d="M12,9C8,9,5,12,5,15a1.5,1.5,0,0,0,3,0c0-2,1.5-3,4-3s4,1,4,3a1.5,1.5,0,0,0,3,0C19,12,16,9,12,9Z"/><rect x="8" y="16" width="2" height="5" rx="1"/><rect x="14" y="16" width="2" height="5" rx="1"/></svg>',
    woman: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="12" cy="4" r="3"/><path d="M12,9C8,9,5,12,5,15a1.5,1.5,0,0,0,3,0c0-2,1.5-3,4-3s4,1,4,3a1.5,1.5,0,0,0,3,0C19,12,16,9,12,9Z"/><rect x="9" y="16" width="2" height="5" rx="1"/><rect x="13" y="16" width="2" height="5" rx="1"/></svg>',
    dot: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="12" cy="12" r="8"/></svg>',
    square: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>'
  };

  var escapeHtml = PanelUtils.escapeHtml;
  var escapeAttr = PanelUtils.escapeAttr;

  function liveUpdate() {
    if (_store.hasData()) { _generate(); _schedule(); }
  }

  // ── Radio Buttons + Checkbox Sync ──────────────────────

  function syncCheckboxes() {
    var type = _store.iconColType || "none";
    if (radNone) radNone.checked = (type === "none");
    if (radFlags) radFlags.checked = (type === "flags");
    if (radIcons) radIcons.checked = (type === "icons");
    // Show autofill controls when a type is selected
    if (iconAutofillWrap) iconAutofillWrap.style.display = (type !== "none") ? "" : "none";
    if (iconColHint) iconColHint.style.display = (type !== "none") ? "" : "none";
    // Show icon color only for humanitarian icons (not flags), hide for keyfigures (has its own)
    var isKF = (_store.chartType || "hbar") === "keyfigures";
    if (iconColorWrap) iconColorWrap.style.display = (type === "icons" && !isKF) ? "" : "none";
    if (_syncIconColor) _syncIconColor();
    populateMatchCol();
    renderRowList();
  }

  function populateMatchCol() {
    if (!selIconMatchCol) return;
    selIconMatchCol.innerHTML = "";
    var headers = _store.headers || [];
    for (var h = 0; h < headers.length; h++) {
      var opt = document.createElement("option");
      opt.value = h;
      opt.textContent = headers[h];
      selIconMatchCol.appendChild(opt);
    }
    // Default to labelCol (e.g. "Heading" for KF sample data)
    if (_store.labelCol != null && _store.labelCol < headers.length) {
      selIconMatchCol.value = _store.labelCol;
    }
  }

  function onRadioChange() {
    var selected = "none";
    if (radFlags && radFlags.checked) selected = "flags";
    else if (radIcons && radIcons.checked) selected = "icons";

    var prev = _store.iconColType || "none";
    _store.iconColType = selected;
    // Clear selections when switching type (flag refs aren't valid as icon refs and vice versa)
    if (selected !== prev) _store.iconSelections = [];

    syncCheckboxes();
    _clearIconCache();
    renderRowList();
    liveUpdate();
  }

  // ── Auto-fill ──────────────────────────────────────────

  function doAutofill() {
    var colIdx = selIconMatchCol ? parseInt(selIconMatchCol.value, 10) : 0;
    if (isNaN(colIdx)) return;
    var rows = _store.rows || [];
    var type = _store.iconColType;
    if (type === "none" || !rows.length) return;

    var matched = 0;
    for (var r = 0; r < rows.length; r++) {
      var cellVal = String(rows[r][colIdx] || "").trim();
      if (!cellVal) continue;
      if (_store.iconSelections[r]) { matched++; continue; }

      var resolved = null;
      if (type === "flags") {
        resolved = _resolveFlag(cellVal, _assetFlagsDir);
      } else if (type === "icons") {
        resolved = _resolveIcon(cellVal, _assetIconsDir);
      }

      if (resolved) {
        if (type === "flags") {
          // Find matching flag code from FlagsData
          var key = cellVal.trim();
          var flagEntry = null;
          if (typeof FlagsData !== "undefined") {
            for (var fi = 0; fi < FlagsData.length; fi++) {
              if (FlagsData[fi].code && FlagsData[fi].code.toUpperCase() === key.toUpperCase()) {
                flagEntry = FlagsData[fi]; break;
              }
              if (FlagsData[fi].name && FlagsData[fi].name.toLowerCase() === key.toLowerCase()) {
                flagEntry = FlagsData[fi]; break;
              }
            }
          }
          _store.setIconSelection(r, flagEntry ? flagEntry.code : key);
        } else {
          _store.setIconSelection(r, cellVal);
        }
        matched++;
      }
    }

    _clearIconCache();
    renderRowList();
    liveUpdate();

    if (iconColHint) {
      iconColHint.textContent = "Matched " + matched + " of " + rows.length + " rows.";
      setTimeout(function () {
        iconColHint.textContent = "Select icons per row below, or auto-fill from a column.";
      }, 3000);
    }
  }

  // ── Per-Row Icon List (Design tab) ─────────────────────

  function renderRowList() {
    if (!iconRowListEl) return;
    var type = _store.iconColType || "none";
    if (type === "none" || !_store.rows || !_store.rows.length) {
      iconRowListEl.innerHTML = "";
      iconRowListEl.style.display = "none";
      return;
    }

    iconRowListEl.style.display = "";
    var labelCol = _store.labelCol || 0;
    var html = [];

    for (var r = 0; r < _store.rows.length; r++) {
      var label = String(_store.rows[r][labelCol] || "Row " + (r + 1));
      var iconRef = _store.iconSelections[r] || null;
      var preview = "";
      if (iconRef) {
        preview = _getPreviewHtml(iconRef, type, _assetFlagsDir, _assetIconsDir);
      }

      html.push('<div class="icon-row-item">');
      html.push('<span class="icon-row-label">' + escapeHtml(label) + '</span>');
      html.push('<button class="icon-row-pick-btn' + (iconRef ? ' has-icon' : '') +
        '" data-row="' + r + '" title="' + (iconRef ? escapeAttr(iconRef) : 'Click to select') + '">');
      if (preview) {
        html.push('<span class="icon-row-pick-preview">' + preview + '</span>');
      } else {
        html.push('<span class="icon-row-pick-empty">+</span>');
      }
      html.push('</button>');
      if (iconRef) {
        html.push('<button class="icon-row-clear" data-row="' + r + '" title="Remove">&times;</button>');
      }
      html.push('</div>');
    }

    iconRowListEl.innerHTML = html.join("");

    // Attach pick and clear handlers
    var pickBtns = iconRowListEl.querySelectorAll(".icon-row-pick-btn");
    for (var p = 0; p < pickBtns.length; p++) {
      pickBtns[p].addEventListener("click", function () {
        var rowIdx = parseInt(this.getAttribute("data-row"), 10);
        if (!isNaN(rowIdx)) openPicker(rowIdx);
      });
    }
    var clearBtns = iconRowListEl.querySelectorAll(".icon-row-clear");
    for (var c = 0; c < clearBtns.length; c++) {
      clearBtns[c].addEventListener("click", function () {
        var rowIdx = parseInt(this.getAttribute("data-row"), 10);
        if (!isNaN(rowIdx)) {
          _store.setIconSelection(rowIdx, null);
          _clearIconCache();
          renderRowList();
          liveUpdate();
        }
      });
    }
  }

  // ── Icon/Flag Picker Popup ─────────────────────────────

  function openPicker(rowIndex, mode) {
    iconPickerTargetRow = rowIndex;
    iconPickerMode = mode || "row-icons";
    if (!iconPickerPopup) return;

    iconPickerPopup.style.display = "flex";
    iconPickerActiveFamily = "";
    if (iconPickerSearch) {
      iconPickerSearch.value = "";
      iconPickerSearch.focus();
    }
    renderFamilyPills();
    renderGrid("");
  }

  function closePicker() {
    if (iconPickerPopup) iconPickerPopup.style.display = "none";
    iconPickerTargetRow = -1;
  }

  // Modes that always display humanitarian icons regardless of
  // _store.iconColType (which is only relevant to the row-icons flow
  // on bar/col/stacked/table charts). Timeline and Key Figures have
  // their own per-row icon pickers and don't touch iconColType, so
  // falling through to "none" here used to render an empty picker.
  function forcedIconsMode() {
    return iconPickerMode === "icon-series" ||
           iconPickerMode === "keyfigures" ||
           iconPickerMode === "timeline";
  }

  function renderFamilyPills() {
    if (!iconPickerFamilyPills) return;
    var type = forcedIconsMode() ? "icons" : _store.iconColType;
    if (type !== "icons") {
      iconPickerFamilyPills.style.display = "none";
      return;
    }
    var iconsList = (typeof IconsPanel !== "undefined" && IconsPanel.getIconList) ? IconsPanel.getIconList() : [];
    var famMap = {};
    var famOrder = [];
    for (var i = 0; i < iconsList.length; i++) {
      var fam = iconsList[i].family || "Other";
      if (!famMap[fam]) { famMap[fam] = true; famOrder.push(fam); }
    }
    if (!famOrder.length) { iconPickerFamilyPills.style.display = "none"; return; }

    famOrder.sort();
    var html = '<button class="icon-picker-pill' + (!iconPickerActiveFamily ? ' active' : '') +
      '" data-family="">All</button>';
    for (var f = 0; f < famOrder.length; f++) {
      var isActive = iconPickerActiveFamily === famOrder[f];
      html += '<button class="icon-picker-pill' + (isActive ? ' active' : '') +
        '" data-family="' + escapeAttr(famOrder[f]) + '">' + escapeHtml(famOrder[f]) + '</button>';
    }
    iconPickerFamilyPills.innerHTML = html;
    iconPickerFamilyPills.style.display = "flex";

    var pills = iconPickerFamilyPills.querySelectorAll(".icon-picker-pill");
    for (var p = 0; p < pills.length; p++) {
      pills[p].addEventListener("click", function () {
        iconPickerActiveFamily = this.getAttribute("data-family") || "";
        var allPills = iconPickerFamilyPills.querySelectorAll(".icon-picker-pill");
        for (var a = 0; a < allPills.length; a++) {
          allPills[a].classList.toggle("active", (allPills[a].getAttribute("data-family") || "") === iconPickerActiveFamily);
        }
        renderGrid(iconPickerSearch ? iconPickerSearch.value : "");
      });
    }
  }

  function renderGrid(query) {
    if (!iconPickerGrid) return;
    var type = forcedIconsMode() ? "icons" : _store.iconColType;
    var q = (query || "").toLowerCase().trim();
    var html = "";
    var itemRefs = [];

    if (type === "flags") {
      if (typeof FlagsData === "undefined") { iconPickerGrid.innerHTML = "No flags data"; return; }
      for (var i = 0; i < FlagsData.length; i++) {
        var f = FlagsData[i];
        if (q && f.name.toLowerCase().indexOf(q) === -1 &&
            (!f.code || f.code.toLowerCase().indexOf(q) === -1)) continue;
        var flagRef = f.code || f.name;
        html += '<button class="icon-picker-item" data-ref="' + escapeAttr(flagRef) + '" title="' +
          escapeAttr(f.name + (f.code ? " (" + f.code + ")" : "")) + '">';
        html += '<span class="icon-picker-item-preview" data-lazy-ref="' + escapeAttr(flagRef) + '"></span>';
        html += '<span class="icon-picker-item-name">' + escapeHtml(f.name) + '</span>';
        html += '</button>';
        itemRefs.push(flagRef);
      }
    } else if (type === "icons") {
      // In icon-series mode, show built-in shapes first
      if (iconPickerMode === "icon-series" && !iconPickerActiveFamily) {
        var builtInShapes = [
          { key: "people", name: "People" },
          { key: "man", name: "Man" },
          { key: "woman", name: "Woman" },
          { key: "dot", name: "Dot" },
          { key: "square", name: "Square" }
        ];
        for (var bi = 0; bi < builtInShapes.length; bi++) {
          var bs = builtInShapes[bi];
          if (q && bs.name.toLowerCase().indexOf(q) === -1 && bs.key.indexOf(q) === -1) continue;
          html += '<button class="icon-picker-item" data-ref="' + escapeAttr(bs.key) + '" title="' + escapeAttr(bs.name) + '">';
          html += '<span class="icon-picker-item-preview">' + (SHAPE_THUMBS[bs.key] || '') + '</span>';
          html += '<span class="icon-picker-item-name">' + escapeHtml(bs.name) + '</span>';
          html += '</button>';
        }
      }
      var iconsList = (typeof IconsPanel !== "undefined" && IconsPanel.getIconList) ? IconsPanel.getIconList() : [];
      if (!iconsList.length) {
        try {
          var fsList = Connector.fs.list(_assetIconsDir);
          for (var fi = 0; fi < fsList.length; fi++) {
            if (fsList[fi].indexOf(".svg") === -1) continue;
            var key = fsList[fi].replace(".svg", "");
            iconsList.push({ key: key, name: key.replace(/-/g, " "), family: "Other" });
          }
        } catch (e) { /* ignore */ }
      }
      for (var j = 0; j < iconsList.length; j++) {
        var ic = iconsList[j];
        if (iconPickerActiveFamily && (ic.family || "Other") !== iconPickerActiveFamily) continue;
        if (q && ic.name.toLowerCase().indexOf(q) === -1 &&
            ic.key.toLowerCase().indexOf(q) === -1) continue;
        html += '<button class="icon-picker-item" data-ref="' + escapeAttr(ic.key) + '" title="' +
          escapeAttr(ic.name + (ic.family ? " (" + ic.family + ")" : "")) + '">';
        html += '<span class="icon-picker-item-preview" data-lazy-ref="' + escapeAttr(ic.key) + '"></span>';
        html += '<span class="icon-picker-item-name">' + escapeHtml(ic.name) + '</span>';
        html += '</button>';
        itemRefs.push(ic.key);
      }
    }

    if (!html) html = '<div style="padding:12px;color:var(--text-tertiary);font-size:11px;grid-column:1/-1;">No results</div>';
    iconPickerGrid.innerHTML = html;

    var items = iconPickerGrid.querySelectorAll(".icon-picker-item");
    for (var k = 0; k < items.length; k++) {
      items[k].addEventListener("click", onPickerItemClick);
    }

    if (itemRefs.length > 0) {
      // On the web, fetch the folder's files in the background first so the
      // previews don't freeze the page (immediate in Illustrator).
      PanelUtils.whenFolderReady(type === "flags" ? _assetFlagsDir : _assetIconsDir, function () {
        lazyLoadPreviews(type, itemRefs, 0);
      });
    }
  }

  function lazyLoadPreviews(type, refs, startIdx) {
    var BATCH = 20;
    var end = Math.min(startIdx + BATCH, refs.length);
    for (var i = startIdx; i < end; i++) {
      var ref = refs[i];
      var el = iconPickerGrid ? iconPickerGrid.querySelector('[data-lazy-ref="' + ref.replace(/"/g, '\\"') + '"]') : null;
      if (!el) continue;
      var preview = _getPreviewHtml(ref, type, _assetFlagsDir, _assetIconsDir);
      if (preview) {
        el.innerHTML = preview;
      } else {
        el.textContent = type === "flags" ? ref : "?";
        el.style.fontSize = "10px";
        el.style.color = "var(--text-tertiary)";
      }
      el.removeAttribute("data-lazy-ref");
    }
    if (end < refs.length) {
      setTimeout(function () { lazyLoadPreviews(type, refs, end); }, 10);
    }
  }

  function onPickerItemClick(e) {
    var btn = e.currentTarget;
    var ref = btn.getAttribute("data-ref");
    if (!ref || iconPickerTargetRow < 0) return;

    if (iconPickerMode === "icon-series") {
      // Icon chart per-row shape selection
      if (!_store.iconShapes) _store.iconShapes = [];
      _store.iconShapes[iconPickerTargetRow] = ref;
      closePicker();
      // Re-render icon series legend rows
      var legendRows = document.getElementById("icon-legend-rows");
      if (legendRows && _buildLegendRows) _buildLegendRows(legendRows, true);
    } else if (iconPickerMode === "keyfigures") {
      _store.setIconSelection(iconPickerTargetRow, ref);
      closePicker();
      _clearIconCache();
      if (_buildKfIconRows) _buildKfIconRows();
    } else if (iconPickerMode === "timeline") {
      _store.setIconSelection(iconPickerTargetRow, ref);
      closePicker();
      _clearIconCache();
      if (_buildTimelineIconRows) _buildTimelineIconRows();
    } else {
      // Bar/column/table row icon selection
      _store.setIconSelection(iconPickerTargetRow, ref);
      closePicker();
      _clearIconCache();
      renderRowList();
    }
    liveUpdate();
  }

  // ── Event Binding ──────────────────────────────────────

  function bindEvents() {
    if (radNone) radNone.addEventListener("change", onRadioChange);
    if (radFlags) radFlags.addEventListener("change", onRadioChange);
    if (radIcons) radIcons.addEventListener("change", onRadioChange);

    if (btnIconAutofill) {
      btnIconAutofill.addEventListener("click", doAutofill);
    }

    if (iconPickerClose) {
      iconPickerClose.addEventListener("click", closePicker);
    }

    if (iconPickerSearch) {
      iconPickerSearch.addEventListener("input", function () {
        renderGrid(iconPickerSearch.value);
      });
    }

    // Close picker on outside click
    document.addEventListener("mousedown", function (e) {
      if (iconPickerPopup && iconPickerPopup.style.display !== "none" &&
          !iconPickerPopup.contains(e.target) &&
          !e.target.classList.contains("icon-row-pick-btn") &&
          !e.target.closest(".icon-row-pick-btn") &&
          !e.target.classList.contains("icon-legend-shape") &&
          !e.target.closest(".icon-legend-shape")) {
        closePicker();
      }
    });
  }

  // ── Init ───────────────────────────────────────────────

  function init(deps) {
    _store          = deps.store;
    _generate       = deps.generate;
    _schedule       = deps.schedule;
    _clearIconCache = deps.clearIconCache;
    _getPreviewHtml = deps.getPreviewHtml;
    _resolveFlag    = deps.resolveFlag;
    _resolveIcon    = deps.resolveIcon;
    _assetFlagsDir  = deps.assetFlagsDir;
    _assetIconsDir  = deps.assetIconsDir;
    _syncIconColor  = deps.syncIconColor;
    _buildLegendRows = deps.buildLegendRows;
    _buildKfIconRows = deps.buildKfIconRows;
    _buildTimelineIconRows = deps.buildTimelineIconRows;

    // Resolve DOM refs
    iconColSection        = document.getElementById("icon-col-section");
    radNone               = document.getElementById("rad-none");
    radFlags              = document.getElementById("rad-flags");
    radIcons              = document.getElementById("rad-icons");
    iconAutofillWrap      = document.getElementById("icon-autofill-wrap");
    selIconMatchCol       = document.getElementById("sel-icon-match-col");
    btnIconAutofill       = document.getElementById("btn-icon-autofill");
    iconColHint           = document.getElementById("icon-col-hint");
    iconColorWrap         = document.getElementById("icon-color-wrap");
    iconPickerPopup       = document.getElementById("row-icon-picker-popup");
    iconPickerSearch      = document.getElementById("row-icon-picker-search");
    iconPickerGrid        = document.getElementById("row-icon-picker-grid");
    iconPickerClose       = document.getElementById("row-icon-picker-close");
    iconPickerFamilyPills = document.getElementById("row-icon-picker-family-pills");
    iconRowListEl         = document.getElementById("icon-row-list");

    bindEvents();
  }

  // ── Public API ─────────────────────────────────────────

  return {
    init:           init,
    syncCheckboxes: syncCheckboxes,
    renderRowList:  renderRowList,
    openPicker:     openPicker,
    closePicker:    closePicker,
    SHAPE_THUMBS:   SHAPE_THUMBS
  };
})();
