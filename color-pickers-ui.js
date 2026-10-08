/**
 * Color Pickers UI — Swatch dropdowns, color state, and palette management.
 *
 * Centralizes all color picker interactions: chart color, label color,
 * line label background, icon color, stacked stroke color, sankey color mode.
 * Manages the shared dropdown lifecycle (open, close, outside-click dismiss).
 *
 * Dependencies (via init):
 *   store         — DataStore reference
 *   generate      — generateSVG function
 *   schedule      — scheduleLiveUpdate function
 *   clearIconCache — SvgInlineUtils.clearCache (for icon color changes)
 */

/* global ChartRegistry, PanelUtils */

var ColorPickersUI = (function () {
  "use strict";

  // Injected dependencies
  var _store, _generate, _schedule, _clearIconCache;

  // Palettes — updated when style changes
  var ochaSwatches = [];
  var defaultIconPalette = [];

  // Dropdown lifecycle state (only one dropdown open at a time)
  var activeDropdown = null;

  // DOM refs (resolved in init)
  var chartColorSection, chartColorSwatch, chartColorName;
  var labelColorSwatch, labelColorName;
  var lineLabelBgSwatch, lineLabelBgName;
  var iconColorSwatch, iconColorName;
  var stackedStrokeColor;
  var sankeyColorSwatches, sankeyColorModeSelect, sankeySingleColorRow;
  var timelineCategoriesSection, timelineCategoryRows, timelineCategoriesHint;
  var sliceColorsSection, sliceColorRows, sliceColorsHint;
  var clusterDonutCategoriesSection, clusterDonutCategoryRows, clusterDonutCategoriesHint;

  // ── Constants ────────────────────────────────────────

  var LABEL_COLOR_OPTIONS = [
    { hex: null, name: "Auto", mode: "auto" },
    { hex: "#000000", name: "Black", mode: "black" },
    { hex: "#FFFFFF", name: "White", mode: "white" }
  ];

  var LINE_LABEL_BG_OPTIONS = [
    { mode: "none", hex: null, name: "None" },
    { mode: "white", hex: "#FFFFFF", name: "White" },
    { mode: "black", hex: "#000000", name: "Black" }
  ];

  // ── Shared dropdown management ───────────────────────

  function closeDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
      var active = document.querySelector(".icon-legend-color.active");
      if (active) active.classList.remove("active");
    }
  }

  /** Return label for a color: "UN Blue" for #009EDB, otherwise the hex code. */
  function findName(hex) {
    if (!hex) return "";
    if (hex.toUpperCase() === "#009EDB") return "UN Blue";
    return hex.toUpperCase();
  }

  function liveUpdate() {
    if (_store.hasData()) { _generate(); _schedule(); }
  }

  // ── Sync helpers (called from panel.js hooks) ────────

  /** Update chart color swatch display. Called from updateChartOptions. */
  function syncChartColorUI(isSingleColor) {
    chartColorSection.style.display = isSingleColor ? "block" : "none";
    if (isSingleColor) {
      // Default to the style's primary chart color (not the swatch palette index)
      var st = ChartRegistry.getStyle(_store.style || "ocha");
      var defaultColor = (st.colors && st.colors[0]) || "#009EDB";
      var curColor = (_store.colors && _store.colors[0]) || defaultColor;
      chartColorSwatch.style.background = curColor;
      chartColorName.textContent = findName(curColor);
    }
  }

  /** Update label color swatch display. Called from syncUIFromStore. */
  function syncLabelColorToUI() {
    var lcVal = _store.labelColor || null;
    var mode = lcVal === "#000000" ? "black" : lcVal === "#FFFFFF" ? "white" : "auto";
    labelColorSwatch.setAttribute("data-mode", mode);
    if (mode === "auto") {
      labelColorSwatch.style.background = "";
      labelColorName.textContent = "Auto";
    } else {
      labelColorSwatch.style.background = lcVal;
      labelColorName.textContent = mode === "black" ? "Black" : "White";
    }
  }

  /** Read label color from swatch data attribute. Called from syncStoreFromUI. */
  function readLabelColor() {
    var mode = labelColorSwatch.getAttribute("data-mode") || "auto";
    return mode === "black" ? "#000000" : mode === "white" ? "#FFFFFF" : null;
  }

  /** Update line label bg swatch display. */
  function syncLineLabelBg(mode) {
    lineLabelBgSwatch.setAttribute("data-mode", mode);
    var mark = lineLabelBgSwatch.querySelector(".label-color-auto-mark");
    if (mode === "none") {
      lineLabelBgSwatch.style.background = "var(--bg-layer-1)";
      lineLabelBgSwatch.style.border = "1.5px dashed var(--text-tertiary)";
      if (mark) { mark.textContent = "OFF"; mark.style.display = ""; }
      lineLabelBgName.textContent = "None";
    } else {
      lineLabelBgSwatch.style.background = mode === "black" ? "#000000" : "#FFFFFF";
      lineLabelBgSwatch.style.border = mode === "white" ? "1px solid var(--border-field)" : "";
      if (mark) mark.style.display = "none";
      lineLabelBgName.textContent = mode === "black" ? "Black" : "White";
    }
  }

  /** Sync from store. Called from syncUIFromStore. */
  function syncLineLabelBgToUI() {
    syncLineLabelBg(_store.lineLabelBg || "none");
  }

  /** Read line label bg mode. Called from syncStoreFromUI. */
  function readLineLabelBg() {
    return lineLabelBgSwatch.getAttribute("data-mode") || "none";
  }

  /** Update icon color swatch display. */
  function syncIconColor() {
    if (!iconColorSwatch) return;
    // null = auto: icons follow the chart (user colour override or the
    // active style's primary) — show the colour that will actually be used.
    var color = _store.rowIconColor;
    if (!color) {
      if (_store.colors && _store.colors[0]) {
        color = _store.colors[0];
      } else if (typeof ChartRegistry !== "undefined" && ChartRegistry.getStyle) {
        var sty = ChartRegistry.getStyle(_store.style || "ocha");
        color = (sty && sty.colors && sty.colors[0]) || "#009EDB";
      } else {
        color = "#009EDB";
      }
    }
    iconColorSwatch.style.background = color;
    if (iconColorName) iconColorName.textContent = findName(color);
  }

  /** Update stacked stroke color swatch. Called from syncStackedStrokeUI. */
  function syncStrokeColor(hex) {
    if (stackedStrokeColor) stackedStrokeColor.style.background = hex;
  }

  // ── Timeline category colour rows ───────────────────────
  //
  // Reads the optional "Category" column from the active data and
  // produces one row per unique category, in order of first
  // appearance. Each row has [colour swatch button] + [name]; click
  // the swatch to open the standard palette dropdown and pick a
  // colour, which gets stored in _store.timelineCategoryColors.
  //
  // Returns true when at least one category was found, false otherwise
  // (so the caller can show a hint instead of an empty list).

  function findTimelineCategoryColumn() {
    var headers = (_store.headers || []).map(function (h) {
      return String(h == null ? "" : h).trim().toLowerCase();
    });
    return headers.indexOf("category");
  }

  function collectTimelineCategories() {
    var idx = findTimelineCategoryColumn();
    if (idx === -1) return [];
    var seen = {};
    var ordered = [];
    var rows = _store.rows || [];
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i] && rows[i][idx];
      if (v == null) continue;
      var s = String(v).trim();
      if (!s || seen[s]) continue;
      seen[s] = true;
      ordered.push(s);
    }
    return ordered;
  }

  // Resolve the colour for a category — explicit override wins, else
  // pick from the active style's icon palette (brand-coherent ramp).
  // The timeline line uses style.colors[0] (brand primary), so we
  // filter that out of the candidate pool — categories never share
  // the line colour by accident. Mirrors the renderer in
  // chart-timeline.js so the panel swatches always match the SVG.
  function resolveTimelineCategoryColor(name, index) {
    var override = _store.timelineCategoryColors && _store.timelineCategoryColors[name];
    if (override) return override;
    var styleName = _store.style || "ocha";
    var st = ChartRegistry.getStyle(styleName);
    var lineColor = ((st && st.colors && st.colors[0]) || "#009EDB").toLowerCase();
    var sourcePalette = ChartRegistry.getIconPalette(styleName) || (st && st.colors) || ["#009EDB"];
    var palette = [];
    for (var p = 0; p < sourcePalette.length; p++) {
      if (String(sourcePalette[p]).toLowerCase() !== lineColor) palette.push(sourcePalette[p]);
    }
    if (!palette.length) palette = sourcePalette;
    return palette[index % palette.length];
  }

  function buildTimelineCategoryRows() {
    if (!timelineCategoryRows) return;
    timelineCategoryRows.innerHTML = "";
    var cats = collectTimelineCategories();

    if (timelineCategoriesHint) {
      timelineCategoriesHint.style.display = cats.length ? "none" : "block";
    }
    if (!cats.length) return;

    if (!_store.timelineCategoryColors) _store.timelineCategoryColors = {};

    for (var i = 0; i < cats.length; i++) {
      (function (name, idx) {
        var hex = resolveTimelineCategoryColor(name, idx);
        var row = document.createElement("div");
        row.className = "icon-legend-row";
        row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;";

        var swatch = document.createElement("button");
        swatch.className = "icon-legend-color";
        swatch.type = "button";
        swatch.style.cssText = "width:18px;height:18px;border-radius:3px;background:" + hex + ";border:1px solid var(--border-color, #ccc);cursor:pointer;flex-shrink:0;padding:0;position:relative;";
        swatch.title = "Pick a colour for " + name;

        var label = document.createElement("span");
        label.textContent = name;
        label.style.cssText = "font-size:12px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

        swatch.addEventListener("click", function (ev) {
          ev.stopPropagation();
          buildSeriesDropdown(swatch, hex, function (newHex) {
            if (!_store.timelineCategoryColors) _store.timelineCategoryColors = {};
            _store.timelineCategoryColors[name] = newHex;
            swatch.style.background = newHex;
            liveUpdate();
          });
        });

        row.appendChild(swatch);
        row.appendChild(label);
        timelineCategoryRows.appendChild(row);
      })(cats[i], i);
    }
  }

  // ── Pie / Donut: per-slice colour rows ─────────────────
  //
  // One swatch + label per data row. Defaults to the chart's primary
  // colour (config.colors[0] resolved via the active style); user
  // overrides are stored in _store.sliceColors keyed by slice label.

  function primaryStyleColor() {
    var st = ChartRegistry.getStyle(_store.style || "ocha");
    return (st && st.colors && st.colors[0]) || "#009EDB";
  }

  function buildSliceColorRows() {
    if (!sliceColorRows) return;
    sliceColorRows.innerHTML = "";

    var rows = _store.rows || [];
    var labelCol = (_store.labelCol != null) ? _store.labelCol : 0;
    var labels = [];
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var raw = rows[i] && rows[i][labelCol];
      if (raw == null) continue;
      var name = String(raw).trim();
      if (!name || seen[name]) continue;
      seen[name] = true;
      labels.push(name);
    }

    if (sliceColorsHint) sliceColorsHint.style.display = labels.length ? "none" : "block";
    if (!labels.length) return;

    if (!_store.sliceColors) _store.sliceColors = {};
    var fallback = primaryStyleColor();

    for (var k = 0; k < labels.length; k++) {
      (function (name) {
        var hex = (_store.sliceColors && _store.sliceColors[name]) || fallback;
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;";
        var swatch = document.createElement("button");
        swatch.type = "button";
        swatch.style.cssText = "width:18px;height:18px;border-radius:3px;background:" + hex + ";border:1px solid var(--border-color, #ccc);cursor:pointer;flex-shrink:0;padding:0;position:relative;";
        swatch.title = "Pick a colour for " + name;
        var labelEl = document.createElement("span");
        labelEl.textContent = name;
        labelEl.style.cssText = "font-size:12px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        swatch.addEventListener("click", function (ev) {
          ev.stopPropagation();
          buildSeriesDropdown(swatch, hex, function (newHex) {
            if (!_store.sliceColors) _store.sliceColors = {};
            _store.sliceColors[name] = newHex;
            swatch.style.background = newHex;
            liveUpdate();
          });
        });
        row.appendChild(swatch);
        row.appendChild(labelEl);
        sliceColorRows.appendChild(row);
      })(labels[k]);
    }
  }

  // ── Cluster Donut: per-category colour rows ────────────
  //
  // One swatch + label per series (column header beyond the label
  // column). Default = chart's primary colour. Overrides stored in
  // _store.clusterDonutCategoryColors keyed by series name.

  function buildClusterDonutCategoryRows() {
    if (!clusterDonutCategoryRows) return;
    clusterDonutCategoryRows.innerHTML = "";

    var headers = _store.headers || [];
    var labelCol = (_store.labelCol != null) ? _store.labelCol : 0;
    var cats = [];
    for (var i = 0; i < headers.length; i++) {
      if (i === labelCol) continue;
      var name = String(headers[i] == null ? "" : headers[i]).trim();
      if (!name) continue;
      cats.push(name);
    }

    if (clusterDonutCategoriesHint) clusterDonutCategoriesHint.style.display = cats.length ? "none" : "block";
    if (!cats.length) return;

    if (!_store.clusterDonutCategoryColors) _store.clusterDonutCategoryColors = {};
    var fallback = primaryStyleColor();

    for (var k = 0; k < cats.length; k++) {
      (function (name) {
        var hex = (_store.clusterDonutCategoryColors && _store.clusterDonutCategoryColors[name]) || fallback;
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;";
        var swatch = document.createElement("button");
        swatch.type = "button";
        swatch.style.cssText = "width:18px;height:18px;border-radius:3px;background:" + hex + ";border:1px solid var(--border-color, #ccc);cursor:pointer;flex-shrink:0;padding:0;position:relative;";
        swatch.title = "Pick a colour for " + name;
        var labelEl = document.createElement("span");
        labelEl.textContent = name;
        labelEl.style.cssText = "font-size:12px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        swatch.addEventListener("click", function (ev) {
          ev.stopPropagation();
          buildSeriesDropdown(swatch, hex, function (newHex) {
            if (!_store.clusterDonutCategoryColors) _store.clusterDonutCategoryColors = {};
            _store.clusterDonutCategoryColors[name] = newHex;
            swatch.style.background = newHex;
            liveUpdate();
          });
        });
        row.appendChild(swatch);
        row.appendChild(labelEl);
        clusterDonutCategoryRows.appendChild(row);
      })(cats[k]);
    }
  }

  /** Build sankey single-color swatches for current style. */
  function buildSankeySwatches() {
    sankeyColorSwatches.innerHTML = "";
    var styleName = _store.style || "ocha";
    var swatches = ChartRegistry.getSwatches(styleName);
    var currentColor = _store.sankeySingleColor || (swatches[0] && swatches[0].hex) || "#009EDB";
    for (var ci = 0; ci < swatches.length; ci++) {
      var sw = document.createElement("span");
      sw.style.cssText = "width:16px;height:16px;border-radius:3px;cursor:pointer;display:inline-block;background:" + swatches[ci].hex + ";border:2px solid " + (swatches[ci].hex === currentColor ? "var(--text-primary)" : "transparent");
      sw.setAttribute("data-color", swatches[ci].hex);
      sw.title = swatches[ci].name || swatches[ci].hex;
      sw.addEventListener("click", (function (hex, el) {
        return function () {
          _store.sankeySingleColor = hex;
          var all = sankeyColorSwatches.querySelectorAll("span");
          for (var k = 0; k < all.length; k++) all[k].style.borderColor = "transparent";
          el.style.borderColor = "var(--text-primary)";
          liveUpdate();
        };
      })(swatches[ci].hex, sw));
      sankeyColorSwatches.appendChild(sw);
    }
  }

  // ── Style change handler ─────────────────────────────

  /** Called when style radio changes. Updates palettes and sankey color. */
  function onStyleChange(styleName) {
    ochaSwatches = ChartRegistry.getSwatches(styleName);
    defaultIconPalette = ChartRegistry.getIconPalette(styleName);
    // Reset sankey single color to new style's primary
    var st = ChartRegistry.getStyle(styleName);
    _store.sankeySingleColor = (st.colors && st.colors[0]) || "#009EDB";
    // Always rebuild sankey swatches so they stay in sync with the active style
    if (sankeyColorSwatches) buildSankeySwatches();
    // Same for timeline categories — auto-assigned colours come from
    // the active style's icon palette, so the swatches in the panel
    // need to update whenever the style changes.
    if (timelineCategoryRows) buildTimelineCategoryRows();
    if (sliceColorRows) buildSliceColorRows();
    if (clusterDonutCategoryRows) buildClusterDonutCategoryRows();
  }

  // ── Palette access (for buildIconLegendRows etc.) ────

  function getSwatches() { return ochaSwatches; }
  function getIconPalette() { return defaultIconPalette; }

  /** Reusable: build a swatch dropdown anchored to an element.
   *  Used by per-series color pickers in buildIconLegendRows. */
  function buildSeriesDropdown(btn, currentHex, onSelect) {
    closeDropdown();
    btn.classList.add("active");
    var dropdown = document.createElement("div");
    dropdown.className = "swatch-dropdown";
    for (var si = 0; si < ochaSwatches.length; si++) {
      var sw = document.createElement("button");
      sw.className = "swatch-option";
      if (ochaSwatches[si].hex.toLowerCase() === (currentHex || "").toLowerCase()) {
        sw.className += " selected";
      }
      sw.style.background = ochaSwatches[si].hex;
      sw.title = ochaSwatches[si].name;
      sw.setAttribute("data-hex", ochaSwatches[si].hex);
      dropdown.appendChild(sw);
    }
    PanelUtils.placeFloating(btn, dropdown, closeDropdown);
    activeDropdown = dropdown;

    var opts = dropdown.querySelectorAll(".swatch-option");
    for (var oi = 0; oi < opts.length; oi++) {
      opts[oi].addEventListener("click", (function (opt) {
        return function (ev) {
          ev.stopPropagation();
          onSelect(opt.getAttribute("data-hex"));
          closeDropdown();
        };
      })(opts[oi]));
    }
  }

  // ── Event binding ────────────────────────────────────

  function bindEvents() {
    // ── Chart color swatch ──
    if (chartColorSwatch) {
      chartColorSwatch.addEventListener("click", function (e) {
        e.stopPropagation();
        closeDropdown();
        chartColorSwatch.classList.add("active");
        var currentColor = (_store.colors && _store.colors[0]) || "#009EDB";

        var dropdown = document.createElement("div");
        dropdown.className = "swatch-dropdown";
        for (var si = 0; si < ochaSwatches.length; si++) {
          var sw = document.createElement("button");
          sw.className = "swatch-option";
          if (ochaSwatches[si].hex.toLowerCase() === currentColor.toLowerCase()) {
            sw.className += " selected";
          }
          sw.style.background = ochaSwatches[si].hex;
          sw.title = ochaSwatches[si].name;
          sw.setAttribute("data-hex", ochaSwatches[si].hex);
          dropdown.appendChild(sw);
        }
        PanelUtils.placeFloating(chartColorSwatch, dropdown, closeDropdown);
        activeDropdown = dropdown;

        var opts = dropdown.querySelectorAll(".swatch-option");
        for (var oi = 0; oi < opts.length; oi++) {
          opts[oi].addEventListener("click", (function (opt) {
            return function (ev) {
              ev.stopPropagation();
              var hex = opt.getAttribute("data-hex");
              _store.colors = [hex];
              chartColorSwatch.style.background = hex;
              chartColorName.textContent = findName(hex);
              closeDropdown();
              liveUpdate();
            };
          })(opts[oi]));
        }
      });
    }

    // ── Label color swatch (Auto / Black / White) ──
    if (labelColorSwatch) {
      labelColorSwatch.setAttribute("data-mode", "auto");
      labelColorSwatch.addEventListener("click", function (e) {
        e.stopPropagation();
        closeDropdown();
        labelColorSwatch.classList.add("active");

        var dropdown = document.createElement("div");
        dropdown.className = "swatch-dropdown";
        for (var li = 0; li < LABEL_COLOR_OPTIONS.length; li++) {
          var opt = LABEL_COLOR_OPTIONS[li];
          var sw = document.createElement("button");
          sw.className = "swatch-option";
          if (opt.mode === "auto") {
            sw.style.background = "var(--bg-layer-1)";
            sw.style.border = "1.5px dashed var(--text-tertiary)";
            sw.innerHTML = '<span style="font-size:8px;font-weight:700;color:var(--text-secondary);">A</span>';
          } else {
            sw.style.background = opt.hex;
          }
          var curMode = labelColorSwatch.getAttribute("data-mode") || "auto";
          if (opt.mode === curMode) sw.className += " selected";
          sw.title = opt.name;
          sw.setAttribute("data-lmode", opt.mode);
          sw.setAttribute("data-lhex", opt.hex || "");
          sw.setAttribute("data-lname", opt.name);
          dropdown.appendChild(sw);
        }
        PanelUtils.placeFloating(labelColorSwatch, dropdown, closeDropdown);
        activeDropdown = dropdown;

        var opts = dropdown.querySelectorAll(".swatch-option");
        for (var oi = 0; oi < opts.length; oi++) {
          opts[oi].addEventListener("click", (function (o) {
            return function (ev) {
              ev.stopPropagation();
              var mode = o.getAttribute("data-lmode");
              var hex = o.getAttribute("data-lhex") || null;
              var name = o.getAttribute("data-lname");
              labelColorSwatch.setAttribute("data-mode", mode);
              if (mode === "auto") {
                labelColorSwatch.style.background = "";
              } else {
                labelColorSwatch.style.background = hex;
              }
              labelColorName.textContent = name;
              _store.labelColor = hex;
              closeDropdown();
              liveUpdate();
            };
          })(opts[oi]));
        }
      });
    }

    // ── Line label background swatch (None / White / Black) ──
    if (lineLabelBgSwatch) {
      lineLabelBgSwatch.setAttribute("data-mode", "none");
      lineLabelBgSwatch.addEventListener("click", function (e) {
        e.stopPropagation();
        closeDropdown();
        lineLabelBgSwatch.classList.add("active");

        var dropdown = document.createElement("div");
        dropdown.className = "swatch-dropdown";
        for (var bi = 0; bi < LINE_LABEL_BG_OPTIONS.length; bi++) {
          var opt = LINE_LABEL_BG_OPTIONS[bi];
          var sw = document.createElement("button");
          sw.className = "swatch-option";
          if (opt.mode === "none") {
            sw.style.background = "var(--bg-layer-1)";
            sw.style.border = "1.5px dashed var(--text-tertiary)";
            sw.innerHTML = '<span style="font-size:7px;font-weight:700;color:var(--text-secondary);">OFF</span>';
          } else {
            sw.style.background = opt.hex;
            if (opt.mode === "white") sw.style.border = "1px solid var(--border-field)";
          }
          var curMode = lineLabelBgSwatch.getAttribute("data-mode") || "none";
          if (opt.mode === curMode) sw.className += " selected";
          sw.title = opt.name;
          sw.setAttribute("data-bgmode", opt.mode);
          sw.setAttribute("data-bgname", opt.name);
          dropdown.appendChild(sw);
        }
        PanelUtils.placeFloating(lineLabelBgSwatch, dropdown, closeDropdown);
        activeDropdown = dropdown;

        var swOpts = dropdown.querySelectorAll(".swatch-option");
        for (var si = 0; si < swOpts.length; si++) {
          swOpts[si].addEventListener("click", (function (o) {
            return function (ev) {
              ev.stopPropagation();
              var mode = o.getAttribute("data-bgmode");
              syncLineLabelBg(mode);
              _store.lineLabelBg = mode;
              closeDropdown();
              liveUpdate();
            };
          })(swOpts[si]));
        }
      });
    }

    // ── Icon color swatch ──
    if (iconColorSwatch) {
      iconColorSwatch.addEventListener("click", function () {
        var existing = document.getElementById("icon-color-picker-popup");
        if (existing) { existing.remove(); return; }

        var popup = document.createElement("div");
        popup.id = "icon-color-picker-popup";
        popup.className = "swatch-popup";
        popup.style.cssText = "position:absolute;z-index:9999;background:var(--surface);border:1px solid var(--border-default);border-radius:8px;padding:6px;display:flex;flex-wrap:wrap;gap:4px;width:180px;box-shadow:0 4px 12px rgba(0,0,0,.15);";

        var rect = iconColorSwatch.getBoundingClientRect();
        popup.style.left = rect.left + "px";
        popup.style.top = (rect.bottom + 4) + "px";

        for (var si = 0; si < ochaSwatches.length; si++) {
          var sw = ochaSwatches[si];
          var btn = document.createElement("button");
          btn.style.cssText = "width:22px;height:22px;border-radius:3px;border:1px solid var(--border-default);cursor:pointer;background:" + sw.hex + ";padding:0;";
          btn.title = sw.name;
          btn.setAttribute("data-hex", sw.hex);
          btn.addEventListener("click", function () {
            _store.rowIconColor = this.getAttribute("data-hex");
            syncIconColor();
            popup.remove();
            _clearIconCache();
            liveUpdate();
          });
          popup.appendChild(btn);
        }

        document.body.appendChild(popup);

        // Close on outside click
        setTimeout(function () {
          document.addEventListener("mousedown", function handler(ev) {
            if (!popup.contains(ev.target) && ev.target !== iconColorSwatch) {
              popup.remove();
              document.removeEventListener("mousedown", handler);
            }
          });
        }, 0);
      });
    }

    // ── Stacked stroke color ──
    if (stackedStrokeColor) {
      stackedStrokeColor.addEventListener("click", function (e) {
        e.stopPropagation();
        // Toggle: if already open, just close
        if (activeDropdown && activeDropdown._isStrokeColor) {
          closeDropdown();
          return;
        }
        closeDropdown();
        var dd = document.createElement("div");
        dd.className = "swatch-dropdown";
        dd._isStrokeColor = true;
        // White + black first, then style palette
        var strokeColors = ["#FFFFFF", "#000000"];
        for (var sp = 0; sp < ochaSwatches.length; sp++) {
          strokeColors.push(ochaSwatches[sp].hex);
        }
        var currentHex = (_store.stackedStrokeColor || "#FFFFFF").toLowerCase();
        for (var sci = 0; sci < strokeColors.length; sci++) {
          var opt = document.createElement("button");
          opt.className = "swatch-option";
          if (strokeColors[sci].toLowerCase() === currentHex) {
            opt.className += " selected";
          }
          opt.style.background = strokeColors[sci];
          opt.setAttribute("data-hex", strokeColors[sci]);
          dd.appendChild(opt);
          opt.addEventListener("click", (function (hex) {
            return function (ev) {
              ev.stopPropagation();
              _store.stackedStrokeColor = hex;
              stackedStrokeColor.style.background = hex;
              closeDropdown();
              liveUpdate();
            };
          })(strokeColors[sci]));
        }
        PanelUtils.placeFloating(stackedStrokeColor, dd, closeDropdown);
        activeDropdown = dd;
      });
    }

    // ── Sankey color mode ──
    if (sankeyColorModeSelect) {
      sankeyColorModeSelect.addEventListener("change", function () {
        _store.sankeyColorMode = sankeyColorModeSelect.value;
        sankeySingleColorRow.style.display = (sankeyColorModeSelect.value === "single") ? "flex" : "none";
        if (sankeyColorModeSelect.value === "single") {
          if (!_store.sankeySingleColor) {
            var st = ChartRegistry.getStyle(_store.style || "ocha");
            _store.sankeySingleColor = (st.colors && st.colors[0]) || "#009EDB";
          }
          buildSankeySwatches();
        }
        liveUpdate();
      });
    }

    // ── Close dropdown on outside click ──
    document.addEventListener("click", function (e) {
      if (activeDropdown && !activeDropdown.contains(e.target) &&
          !e.target.classList.contains("icon-legend-color") &&
          e.target !== stackedStrokeColor &&
          e.target !== chartColorSwatch) {
        closeDropdown();
      }
    });
  }

  // ── Init ─────────────────────────────────────────────

  /**
   * @param {Object} deps
   * @param {Object}   deps.store          — DataStore
   * @param {Function} deps.generate       — generateSVG
   * @param {Function} deps.schedule       — scheduleLiveUpdate
   * @param {Function} deps.clearIconCache — SvgInlineUtils.clearCache
   */
  function init(deps) {
    _store          = deps.store;
    _generate       = deps.generate;
    _schedule       = deps.schedule;
    _clearIconCache = deps.clearIconCache;

    // Initial palettes from default style
    ochaSwatches       = ChartRegistry.OCHA_SWATCHES;
    defaultIconPalette = ChartRegistry.ICON_PALETTE;

    // Resolve DOM refs
    chartColorSection    = document.getElementById("chart-color-section");
    chartColorSwatch     = document.getElementById("chart-color-swatch");
    chartColorName       = document.getElementById("chart-color-name");
    labelColorSwatch     = document.getElementById("label-color-swatch");
    labelColorName       = document.getElementById("label-color-name");
    lineLabelBgSwatch    = document.getElementById("line-label-bg-swatch");
    lineLabelBgName      = document.getElementById("line-label-bg-name");
    iconColorSwatch      = document.getElementById("icon-color-swatch");
    iconColorName        = document.getElementById("icon-color-name");
    stackedStrokeColor   = document.getElementById("stacked-stroke-color");
    sankeyColorSwatches  = document.getElementById("sankey-color-swatches");
    sankeyColorModeSelect = document.getElementById("sankey-color-mode");
    sankeySingleColorRow = document.getElementById("sankey-single-color-row");
    timelineCategoriesSection = document.getElementById("timeline-categories-section");
    timelineCategoryRows = document.getElementById("timeline-category-rows");
    timelineCategoriesHint = document.getElementById("timeline-categories-hint");
    sliceColorsSection = document.getElementById("slice-colors-section");
    sliceColorRows = document.getElementById("slice-color-rows");
    sliceColorsHint = document.getElementById("slice-colors-hint");
    clusterDonutCategoriesSection = document.getElementById("cluster-donut-categories-section");
    clusterDonutCategoryRows = document.getElementById("cluster-donut-category-rows");
    clusterDonutCategoriesHint = document.getElementById("cluster-donut-categories-hint");

    bindEvents();
  }

  return {
    init:                init,
    closeDropdown:       closeDropdown,
    getSwatches:         getSwatches,
    getIconPalette:      getIconPalette,
    onStyleChange:       onStyleChange,
    syncChartColorUI:    syncChartColorUI,
    syncLabelColorToUI:  syncLabelColorToUI,
    readLabelColor:      readLabelColor,
    syncLineLabelBgToUI: syncLineLabelBgToUI,
    readLineLabelBg:     readLineLabelBg,
    syncIconColor:       syncIconColor,
    syncStrokeColor:     syncStrokeColor,
    buildSankeySwatches: buildSankeySwatches,
    buildSeriesDropdown: buildSeriesDropdown,
    buildTimelineCategoryRows: buildTimelineCategoryRows,
    buildSliceColorRows: buildSliceColorRows,
    buildClusterDonutCategoryRows: buildClusterDonutCategoryRows
  };
})();
