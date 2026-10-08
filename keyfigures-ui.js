/**
 * KeyFiguresUI — Modular UI handler for Key Figures chart options.
 *
 * Manages Design tab interactions for the Key Figures chart type.
 * First feature built with the modular pattern (init-based dependencies).
 * Keeps panel.js additions to ~15 lines of wiring.
 */

/* global ChartRegistry, SvgInlineUtils, Connector, PanelUtils */

var KeyFiguresUI = (function () {
  "use strict";

  // Dependencies (injected via init)
  var _store;
  var _generateSVG;
  var _scheduleLiveUpdate;
  var _openIconPicker;
  var _getSwatches;
  var _assetIconsDir;

  // DOM refs
  var section;
  var iconPosSelect;
  var showSepsCb;
  var textColorSwatch, textColorName;
  var iconColorSwatch, iconColorName;
  var defaultPaddingCb;
  var paddingSlidersDiv;
  var autoColsCb;
  var maxColsSlider, maxColsDisplay;
  var autoWidthCb;
  var colWidthSlider, colWidthDisplay;
  var padHSlider, padHDisplay;
  var padVSlider, padVDisplay;
  var gapSlider, gapDisplay;
  var iconRowList;

  // ── Init ──────────────────────────────────────────────

  function init(deps) {
    _store = deps.store;
    _generateSVG = deps.generate;
    _scheduleLiveUpdate = deps.schedule;
    _openIconPicker = deps.openIconPicker;
    _getSwatches = deps.getSwatches;
    _assetIconsDir = deps.assetIconsDir || "";

    section          = document.getElementById("keyfigures-options-section");
    autoColsCb       = document.getElementById("kf-auto-cols");
    maxColsSlider    = document.getElementById("kf-max-cols");
    maxColsDisplay   = document.getElementById("kf-max-cols-display");
    autoWidthCb      = document.getElementById("kf-auto-width");
    colWidthSlider   = document.getElementById("kf-col-width");
    colWidthDisplay  = document.getElementById("kf-col-width-display");
    iconPosSelect    = document.getElementById("kf-icon-position");
    showSepsCb       = document.getElementById("kf-show-separators");
    textColorSwatch  = document.getElementById("kf-text-color-swatch");
    textColorName    = document.getElementById("kf-text-color-name");
    iconColorSwatch  = document.getElementById("kf-icon-color-swatch");
    iconColorName    = document.getElementById("kf-icon-color-name");
    defaultPaddingCb = document.getElementById("kf-default-padding");
    paddingSlidersDiv = document.getElementById("kf-padding-sliders");
    padHSlider       = document.getElementById("kf-pad-h");
    padHDisplay      = document.getElementById("kf-pad-h-display");
    padVSlider       = document.getElementById("kf-pad-v");
    padVDisplay      = document.getElementById("kf-pad-v-display");
    gapSlider        = document.getElementById("kf-gap");
    gapDisplay       = document.getElementById("kf-gap-display");
    iconRowList      = document.getElementById("kf-icon-rows");

    bindEvents();
  }

  // ── Event Binding ──────────────────────────────────────

  function bindEvents() {
    // Column Number — same pattern as bar thickness: slider always interactive,
    // CSS class auto-active for greyed look, input event unchecks auto
    if (autoColsCb) autoColsCb.addEventListener("change", function () {
      _store.kfAutoCols = this.checked;
      if (maxColsSlider) {
        if (this.checked) {
          maxColsSlider.classList.add("auto-active");
          if (maxColsDisplay) maxColsDisplay.textContent = "Auto";
        } else {
          maxColsSlider.classList.remove("auto-active");
          var val = parseInt(maxColsSlider.value, 10) || 3;
          if (maxColsDisplay) maxColsDisplay.textContent = val;
        }
      }
      update();
    });

    if (maxColsSlider) {
      maxColsSlider.addEventListener("input", function () {
        if (autoColsCb && autoColsCb.checked) {
          autoColsCb.checked = false;
          _store.kfAutoCols = false;
          maxColsSlider.classList.remove("auto-active");
        }
        var val = parseInt(this.value, 10) || 3;
        if (maxColsDisplay) maxColsDisplay.textContent = val;
        _store.kfMaxCols = val;
        update();
      });
      maxColsSlider.addEventListener("change", function () { _scheduleLiveUpdate(); });
    }

    // Column Width — same pattern
    if (autoWidthCb) autoWidthCb.addEventListener("change", function () {
      _store.kfAutoWidth = this.checked;
      if (colWidthSlider) {
        if (this.checked) {
          colWidthSlider.classList.add("auto-active");
          if (colWidthDisplay) colWidthDisplay.textContent = "Auto";
        } else {
          colWidthSlider.classList.remove("auto-active");
          var val = parseInt(colWidthSlider.value, 10) || 150;
          if (colWidthDisplay) colWidthDisplay.textContent = val + "px";
        }
      }
      update();
    });

    if (colWidthSlider) {
      colWidthSlider.addEventListener("input", function () {
        if (autoWidthCb && autoWidthCb.checked) {
          autoWidthCb.checked = false;
          _store.kfAutoWidth = false;
          colWidthSlider.classList.remove("auto-active");
        }
        var val = parseInt(this.value, 10) || 150;
        if (colWidthDisplay) colWidthDisplay.textContent = val + "px";
        _store.kfColWidth = val;
        update();
      });
      colWidthSlider.addEventListener("change", function () { _scheduleLiveUpdate(); });
    }

    if (iconPosSelect) iconPosSelect.addEventListener("change", function () {
      _store.kfIconPosition = this.value;
      update();
    });

    if (showSepsCb) showSepsCb.addEventListener("change", function () {
      _store.kfShowSeparators = this.checked;
      update();
    });

    // Default padding checkbox — hides/shows sliders
    if (defaultPaddingCb) defaultPaddingCb.addEventListener("change", function () {
      if (this.checked) {
        // Reset to defaults
        _store.kfPadH = 12; _store.kfPadV = 10; _store.kfGap = 8;
        if (padHSlider) { padHSlider.value = 12; if (padHDisplay) padHDisplay.textContent = "12px"; }
        if (padVSlider) { padVSlider.value = 10; if (padVDisplay) padVDisplay.textContent = "10px"; }
        if (gapSlider) { gapSlider.value = 8; if (gapDisplay) gapDisplay.textContent = "8px"; }
        if (paddingSlidersDiv) paddingSlidersDiv.style.display = "none";
        update();
      } else {
        if (paddingSlidersDiv) paddingSlidersDiv.style.display = "block";
      }
    });

    if (padHSlider) padHSlider.addEventListener("input", function () {
      var val = parseInt(this.value, 10) || 12;
      if (padHDisplay) padHDisplay.textContent = val + "px";
      _store.kfPadH = val;
      defaultPaddingCb.checked = false;
      update();
    });

    if (padVSlider) padVSlider.addEventListener("input", function () {
      var val = parseInt(this.value, 10) || 10;
      if (padVDisplay) padVDisplay.textContent = val + "px";
      _store.kfPadV = val;
      defaultPaddingCb.checked = false;
      update();
    });

    if (gapSlider) gapSlider.addEventListener("input", function () {
      var val = parseInt(this.value, 10) || 8;
      if (gapDisplay) gapDisplay.textContent = val + "px";
      _store.kfGap = val;
      defaultPaddingCb.checked = false;
      update();
    });

    // Icon color swatch — opens a style-aware palette dropdown
    if (iconColorSwatch) iconColorSwatch.addEventListener("click", function (e) {
      e.stopPropagation();
      openSwatchDropdown(iconColorSwatch, "kfIconColor", "#009EDB");
    });

    // Text color swatch — Auto / Black / White dropdown (same pattern as label color)
    if (textColorSwatch) textColorSwatch.addEventListener("click", function (e) {
      e.stopPropagation();
      openTextColorDropdown(textColorSwatch);
    });
  }

  function update() {
    if (_store.hasData()) {
      _generateSVG();
      _scheduleLiveUpdate();
    }
  }

  // ── Swatch Dropdown (consistent with other color pickers) ────

  var _activeDropdown = null;

  function closeKfDropdown() {
    if (_activeDropdown) {
      _activeDropdown.remove();
      _activeDropdown = null;
      var active = document.querySelector(".kf-swatch-active");
      if (active) active.classList.remove("kf-swatch-active");
    }
  }

  /** Style-aware palette dropdown for icon color. */
  function openSwatchDropdown(anchorEl, storeKey, defaultColor) {
    closeKfDropdown();
    anchorEl.classList.add("kf-swatch-active");

    var swatches = _getSwatches ? _getSwatches() : [];
    var currentHex = (_store[storeKey] || defaultColor).toLowerCase();
    var dropdown = document.createElement("div");
    dropdown.className = "swatch-dropdown";

    for (var i = 0; i < swatches.length; i++) {
      var sw = document.createElement("button");
      sw.className = "swatch-option";
      if (swatches[i].hex.toLowerCase() === currentHex) sw.className += " selected";
      sw.style.background = swatches[i].hex;
      sw.title = swatches[i].name;
      sw.setAttribute("data-hex", swatches[i].hex);
      dropdown.appendChild(sw);
    }
    PanelUtils.placeFloating(anchorEl, dropdown, closeKfDropdown);
    _activeDropdown = dropdown;

    var opts = dropdown.querySelectorAll(".swatch-option");
    for (var oi = 0; oi < opts.length; oi++) {
      opts[oi].addEventListener("click", (function (opt) {
        return function (ev) {
          ev.stopPropagation();
          var hex = opt.getAttribute("data-hex");
          _store[storeKey] = hex;
          anchorEl.style.background = hex;
          closeKfDropdown();
          syncSwatches();
          update();
        };
      })(opts[oi]));
    }
  }

  /** Update text color swatch button appearance. */
  function syncTextColorSwatch(el, hex) {
    if (!el) return;
    if (hex) {
      el.style.background = hex;
      el.style.border = "";
      el.innerHTML = "";
    } else {
      // Auto — show dashed border with "A" label
      el.style.background = "var(--bg-layer-1)";
      el.style.border = "1.5px dashed var(--text-tertiary)";
      el.innerHTML = '<span style="font-size:8px;font-weight:700;color:var(--text-secondary);pointer-events:none;">A</span>';
    }
  }

  var TEXT_COLOR_OPTIONS = [
    { hex: "#000000", name: "Black" },
    { hex: "#FFFFFF", name: "White" },
    { hex: null,      name: "Auto", mode: "auto" }
  ];

  /** Text color dropdown: Black / White / Auto. */
  function openTextColorDropdown(anchorEl) {
    closeKfDropdown();
    anchorEl.classList.add("kf-swatch-active");

    var dropdown = document.createElement("div");
    dropdown.className = "swatch-dropdown";
    var curHex = (_store.kfTextColor || "#000000").toLowerCase();

    for (var i = 0; i < TEXT_COLOR_OPTIONS.length; i++) {
      var opt = TEXT_COLOR_OPTIONS[i];
      var sw = document.createElement("button");
      sw.className = "swatch-option";
      if (opt.mode === "auto") {
        sw.style.background = "var(--bg-layer-1)";
        sw.style.border = "1.5px dashed var(--text-tertiary)";
        sw.innerHTML = '<span style="font-size:8px;font-weight:700;color:var(--text-secondary);">A</span>';
        if (!_store.kfTextColor) sw.className += " selected";
      } else {
        sw.style.background = opt.hex;
        if (opt.hex.toLowerCase() === curHex) sw.className += " selected";
      }
      sw.title = opt.name;
      sw.setAttribute("data-hex", opt.hex || "");
      sw.setAttribute("data-mode", opt.mode || "");
      dropdown.appendChild(sw);
    }
    PanelUtils.placeFloating(anchorEl, dropdown, closeKfDropdown);
    _activeDropdown = dropdown;

    var btns = dropdown.querySelectorAll(".swatch-option");
    for (var bi = 0; bi < btns.length; bi++) {
      btns[bi].addEventListener("click", (function (btn) {
        return function (ev) {
          ev.stopPropagation();
          var mode = btn.getAttribute("data-mode");
          var hex = btn.getAttribute("data-hex") || null;
          _store.kfTextColor = hex;
          syncTextColorSwatch(anchorEl, hex);
          closeKfDropdown();
          syncSwatches();
          update();
        };
      })(btns[bi]));
    }
  }

  // Close dropdown on outside click
  document.addEventListener("click", function (e) {
    if (_activeDropdown && !_activeDropdown.contains(e.target)) {
      closeKfDropdown();
    }
  });

  // ── Per-row Icon Assignment ────────────────────────────

  function buildIconRows() {
    if (!iconRowList || !_store) return;
    iconRowList.innerHTML = "";

    var data = _store.toKeyFiguresData ? _store.toKeyFiguresData() : [];
    if (!data.length) return;

    for (var i = 0; i < data.length; i++) {
      var row = document.createElement("div");
      row.className = "kf-icon-row";
      row.style.cssText = "display:flex;align-items:center;gap:6px;padding:3px 0;";

      // Icon preview button
      var iconBtn = document.createElement("button");
      iconBtn.className = "kf-icon-btn";
      iconBtn.style.cssText = "width:24px;height:24px;border:1px solid var(--border-default);border-radius:4px;cursor:pointer;background:var(--bg-input);display:flex;align-items:center;justify-content:center;padding:2px;overflow:hidden;";
      iconBtn.setAttribute("data-row", i);

      var ref = _store.iconSelections && _store.iconSelections[i];
      if (ref && typeof SvgInlineUtils !== "undefined" && _assetIconsDir) {
        // Try to load icon SVG preview
        var previewSvg = loadIconPreview(ref);
        if (previewSvg) {
          iconBtn.innerHTML = previewSvg;
        } else {
          iconBtn.textContent = "✓";
        }
      } else {
        iconBtn.textContent = "+";
        iconBtn.style.color = "var(--text-tertiary)";
        iconBtn.style.fontSize = "14px";
      }

      iconBtn.addEventListener("click", (function (idx) {
        return function () {
          if (_openIconPicker) _openIconPicker(idx, "keyfigures");
        };
      })(i));
      row.appendChild(iconBtn);

      // Label
      var label = document.createElement("span");
      label.style.cssText = "font-size:11px;color:var(--text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      label.textContent = data[i].label || ("Row " + (i + 1));
      row.appendChild(label);

      iconRowList.appendChild(row);
    }
  }

  function loadIconPreview(ref) {
    if (!ref || !_assetIconsDir) return null;
    try {
      var fs = Connector.fs;
      // Icon ref format: "family/icon-name" or just "icon-name"
      var parts = ref.split("/");
      var iconFile;
      if (parts.length >= 2) {
        iconFile = fs.join(_assetIconsDir, parts[0], parts[1] + ".svg");
      } else {
        iconFile = fs.join(_assetIconsDir, ref + ".svg");
      }
      if (fs.exists(iconFile)) {
        var raw = fs.readText(iconFile);
        // Extract SVG, strip width/height, set to 18px
        raw = raw.replace(/width="[^"]*"/, 'width="18"').replace(/height="[^"]*"/, 'height="18"');
        // Apply icon color
        var color = _store.kfIconColor || "#009EDB";
        raw = raw.replace(/fill="[^"]*"/g, 'fill="' + color + '"');
        return raw;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ── Show / Hide ────────────────────────────────────────

  function show() {
    if (section) section.style.display = "block";
    if (!_store.iconColType || _store.iconColType === "none") _store.iconColType = "icons";
    // Hide padding sliders if default is checked
    if (paddingSlidersDiv && defaultPaddingCb) {
      paddingSlidersDiv.style.display = defaultPaddingCb.checked ? "none" : "block";
    }
    // Sync slider visual states with auto checkboxes (CSS class, not disabled)
    var colsAuto = _store.kfAutoCols !== false;
    var widthAuto = _store.kfAutoWidth !== false;
    if (maxColsSlider) {
      if (colsAuto) { maxColsSlider.classList.add("auto-active"); } else { maxColsSlider.classList.remove("auto-active"); }
      if (maxColsDisplay) maxColsDisplay.textContent = colsAuto ? "Auto" : (_store.kfMaxCols || 3);
    }
    if (colWidthSlider) {
      if (widthAuto) { colWidthSlider.classList.add("auto-active"); } else { colWidthSlider.classList.remove("auto-active"); }
      if (colWidthDisplay) colWidthDisplay.textContent = widthAuto ? "Auto" : ((_store.kfColWidth || 150) + "px");
    }
    updateIconColorVisibility();
    syncSwatches();
  }

  function updateIconColorVisibility() {
    // Hide icon color when flags are selected (flags have their own colors)
    var iconColorRow = document.getElementById("kf-icon-color-row");
    if (iconColorRow) {
      iconColorRow.style.display = (_store.iconColType === "flags") ? "none" : "";
    }
  }

  function hide() {
    if (section) section.style.display = "none";
  }

  /** Return label for a color: "UN Blue" for #009EDB, otherwise the hex code. */
  function colorLabel(hex) {
    if (!hex) return "";
    if (hex.toUpperCase() === "#009EDB") return "UN Blue";
    return hex.toUpperCase();
  }

  function syncSwatches() {
    var icoHex = _store.kfIconColor || "#009EDB";
    if (iconColorSwatch) iconColorSwatch.style.background = icoHex;
    if (iconColorName) iconColorName.textContent = colorLabel(icoHex);
    syncTextColorSwatch(textColorSwatch, _store.kfTextColor);
    // Text color label
    if (textColorName) {
      var tc = _store.kfTextColor;
      if (!tc) {
        textColorName.textContent = "Auto";
      } else if (tc === "#000000") {
        textColorName.textContent = "Black";
      } else if (tc === "#FFFFFF") {
        textColorName.textContent = "White";
      } else {
        textColorName.textContent = colorLabel(tc);
      }
    }
  }

  // ── Sync UI ↔ Store ────────────────────────────────────

  function syncToUI() {
    if (iconPosSelect)   iconPosSelect.value = _store.kfIconPosition || "left";
    if (showSepsCb)      showSepsCb.checked = _store.kfShowSeparators !== false;
    if (padHSlider)      { padHSlider.value = _store.kfPadH || 12; if (padHDisplay) padHDisplay.textContent = (_store.kfPadH || 12) + "px"; }
    if (padVSlider)      { padVSlider.value = _store.kfPadV || 10; if (padVDisplay) padVDisplay.textContent = (_store.kfPadV || 10) + "px"; }
    if (gapSlider)       { gapSlider.value = _store.kfGap || 8; if (gapDisplay) gapDisplay.textContent = (_store.kfGap || 8) + "px"; }
    syncSwatches();
    updateIconColorVisibility();
    buildIconRows();
  }

  function syncFromUI() {
    if (!_store) return;
    if (iconPosSelect)   _store.kfIconPosition = iconPosSelect.value;
    if (showSepsCb)      _store.kfShowSeparators = showSepsCb.checked;
    if (padHSlider)      _store.kfPadH = parseInt(padHSlider.value, 10) || 12;
    if (padVSlider)      _store.kfPadV = parseInt(padVSlider.value, 10) || 10;
    if (gapSlider)       _store.kfGap = parseInt(gapSlider.value, 10) || 8;
  }

  // ── Public API ─────────────────────────────────────────

  return {
    init: init,
    show: show,
    hide: hide,
    syncToUI: syncToUI,
    syncFromUI: syncFromUI,
    buildIconRows: buildIconRows
  };
})();
