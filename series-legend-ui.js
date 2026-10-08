/**
 * SeriesLegendUI — Icon chart legend rows, stacked chart series colors,
 * and stacked stroke controls.
 *
 * Shared between icon charts (per-row shape + color + label)
 * and stacked charts (per-column color + label).
 *
 * Dependencies (via init):
 *   store            — DataStore reference
 *   generate         — generateSVG function
 *   schedule         — scheduleLiveUpdate function
 *   getIconPalette   — ColorPickersUI.getIconPalette
 *   getSwatches      — ColorPickersUI.getSwatches
 *   closeDropdown    — ColorPickersUI.closeDropdown
 *   buildSeriesDropdown — ColorPickersUI.buildSeriesDropdown
 *   openPicker       — IconFlagUI.openPicker
 *   SHAPE_THUMBS     — IconFlagUI.SHAPE_THUMBS
 *   assetIconsDir    — path to icons-cache directory
 *   syncStrokeColor  — ColorPickersUI.syncStrokeColor
 */

/* global IconLibrary, IconFlagUI, Connector */

var SeriesLegendUI = (function () {
  "use strict";

  // Injected dependencies
  var _store, _generate, _schedule;
  var _getIconPalette, _getSwatches, _closeDropdown, _buildSeriesDropdown;
  var _openPicker, _SHAPE_THUMBS;
  var _assetIconsDir, _syncStrokeColor;

  // DOM refs
  var iconOptionsSection, iconSeriesSection, iconLegendSection;
  var iconSizeSlider, iconSizeDisplay;
  var iconShowLegendCheck, iconLegendLayoutRow, iconLegendLayoutPicker;
  var iconLegendRows;
  var stackedColorsSection, stackedColorRows;
  var stackedStrokeSection, stackedStrokeToggle, stackedStrokeOptions;
  var stackedLegendSection, stackedLegendToggle;
  var stackedStrokeWidth, stackedStrokeWidthRange;

  // Icon SVGs are read through the shell's Connector
  var fs = (typeof Connector !== "undefined") ? Connector.fs : null;

  function liveUpdate() {
    if (_store.hasData()) { _generate(); _schedule(); }
  }

  // ── Shape Thumbnail ────────────────────────────────────

  function getShapeThumb(shape) {
    if (_SHAPE_THUMBS[shape]) return _SHAPE_THUMBS[shape];
    // IconLibrary (curated 29)
    if (typeof IconLibrary !== "undefined") {
      var lib = IconLibrary.get(shape);
      if (lib) {
        return '<svg viewBox="' + lib.viewBox + '" fill="currentColor" width="16" height="16">' + lib.svg + '</svg>';
      }
    }
    // Full OCHA icon set — read from icons-cache on disk
    if (_assetIconsDir && fs) {
      try {
        var svgPath = _assetIconsDir + "/" + shape + ".svg";
        var svgContent = fs.readText(svgPath);
        if (svgContent) {
          var vbMatch = svgContent.match(/viewBox="([^"]+)"/);
          var vb = vbMatch ? vbMatch[1] : "0 0 24 24";
          var inner = svgContent.replace(/<\?xml[^>]*\?>/g, "")
            .replace(/<svg[^>]*>/, "").replace(/<\/svg>/, "").trim();
          return '<svg viewBox="' + vb + '" fill="currentColor" width="16" height="16">' + inner + '</svg>';
        }
      } catch (e) { /* file not found — fall through */ }
    }
    return _SHAPE_THUMBS.people;
  }

  // ── Legend / Series Color Rows ──────────────────────────

  function buildLegendRows(container, showLabels) {
    if (!_store.headers) {
      container.innerHTML = "";
      return;
    }

    var chartType = _store.chartType || "hbar";
    var isIconChart = (chartType === "icon");
    var useIconPal = (chartType === "icon" || chartType === "stacked-bar" || chartType === "stacked-col" || chartType === "sankey" || chartType === "cluster" || chartType === "line" || chartType === "cluster-line");
    var palette = useIconPal ? _getIconPalette() : _getSwatches().map(function (s) { return s.hex; });
    var html = "";

    if (isIconChart && showLabels) {
      // Per-row mode for icon chart: each row gets shape + color + label
      var rowCount = _store.rows.length;
      var defaultShape = _store.iconShape || "people";

      if (!_store.iconColors) _store.iconColors = [];
      while (_store.iconColors.length < rowCount) {
        _store.iconColors.push(palette[_store.iconColors.length % palette.length]);
      }

      if (!_store.iconShapes) _store.iconShapes = [];
      while (_store.iconShapes.length < rowCount) {
        _store.iconShapes.push(defaultShape);
      }

      for (var r = 0; r < rowCount; r++) {
        var rowLabel = _store.rows[r][_store.labelCol];
        if (rowLabel == null || rowLabel === "") rowLabel = "Row " + (r + 1);
        var color = _store.iconColors[r] || palette[r % palette.length];
        var seriesShape = _store.iconShapes[r] || defaultShape;

        html += '<div class="icon-legend-row">';
        html += '<button class="icon-legend-shape" data-series="' + r + '" title="Change icon">' +
          getShapeThumb(seriesShape) + '</button>';
        html += '<div class="icon-legend-color" data-series="' + r + '" style="background:' + color + ';"></div>';

        var customLabel = (_store.iconLegendLabels && _store.iconLegendLabels[r]) || "";
        html += '<input type="text" class="icon-legend-input" data-series="' + r + '" ' +
          'placeholder="' + String(rowLabel).replace(/"/g, '&quot;') + '" ' +
          'value="' + customLabel.replace(/"/g, '&quot;') + '">';

        html += '</div>';
      }
    } else {
      // Per-column mode for stacked charts
      var cols = _store.valueCols;
      if (!cols || !cols.length) {
        cols = [_store.valueCol || 1];
      }

      // Line small multiples default to a SINGLE colour (the style
      // primary); the swatches read/write a name-keyed override map
      // instead of the distinct-per-series iconColors array. So we skip
      // the iconColors seeding here and resolve each swatch against
      // clusterLineColors[name] || primary.
      var isClusterLine = (chartType === "cluster-line");
      var clPrimary = (typeof ChartRegistry !== "undefined" && ChartRegistry.getStyle)
        ? ((ChartRegistry.getStyle(_store.style || "ocha").colors || ["#009EDB"])[0])
        : "#009EDB";
      var clColors = (isClusterLine && _store.clusterLineColors && typeof _store.clusterLineColors === "object")
        ? _store.clusterLineColors : {};

      if (!isClusterLine) {
        if (!_store.iconColors) {
          _store.iconColors = [];
          for (var ic = 0; ic < cols.length; ic++) {
            _store.iconColors.push(palette[ic % palette.length]);
          }
        }
        while (_store.iconColors.length < cols.length) {
          _store.iconColors.push(palette[_store.iconColors.length % palette.length]);
        }
      }

      for (var r2 = 0; r2 < cols.length; r2++) {
        var colIdx = cols[r2];
        var headerName = _store.headers[colIdx] || ("Series " + (r2 + 1));
        var color2 = isClusterLine
          ? (clColors[headerName] || clPrimary)
          : (_store.iconColors[r2] || palette[r2 % palette.length]);

        html += '<div class="icon-legend-row">';
        html += '<div class="icon-legend-color" data-series="' + r2 + '" style="background:' + color2 + ';"></div>';

        if (showLabels) {
          var customLabel2 = (_store.iconLegendLabels && _store.iconLegendLabels[r2]) || "";
          html += '<input type="text" class="icon-legend-input" data-series="' + r2 + '" ' +
            'placeholder="' + headerName.replace(/"/g, '&quot;') + '" ' +
            'value="' + customLabel2.replace(/"/g, '&quot;') + '">';
        } else {
          html += '<span class="icon-legend-input" style="border:none;background:none;padding:0;font-size:11px;color:var(--text-secondary);">' +
            headerName + '</span>';
        }

        html += '</div>';
      }
    }
    container.innerHTML = html;

    // Wire per-row icon shape pickers (icon chart only)
    if (isIconChart && showLabels) {
      var shapeBtns = container.querySelectorAll('.icon-legend-shape');
      for (var si2 = 0; si2 < shapeBtns.length; si2++) {
        shapeBtns[si2].addEventListener("click", (function (btn) {
          return function (e) {
            e.stopPropagation();
            var idx = parseInt(btn.getAttribute("data-series"), 10);
            _closeDropdown();
            _openPicker(idx, "icon-series");
          };
        })(shapeBtns[si2]));
      }
    }

    // Wire swatch color pickers (via ColorPickersUI shared dropdown)
    var colorBtns = container.querySelectorAll('.icon-legend-color');
    for (var ci = 0; ci < colorBtns.length; ci++) {
      colorBtns[ci].addEventListener("click", (function (btn) {
        return function (e) {
          e.stopPropagation();
          var idx = parseInt(btn.getAttribute("data-series"), 10);
          var ctype = _store.chartType || "hbar";
          var isCL = (ctype === "cluster-line");
          // For small multiples, the swatch edits a name-keyed override
          // map (clusterLineColors); other multi-series charts use the
          // positional iconColors array.
          var clCols = (_store.valueCols && _store.valueCols.length) ? _store.valueCols : [_store.valueCol || 1];
          var clName = _store.headers[clCols[idx]] || ("Series " + (idx + 1));
          var currentColor = isCL
            ? ((_store.clusterLineColors && _store.clusterLineColors[clName]) || "")
            : ((_store.iconColors && _store.iconColors[idx]) || "");
          _buildSeriesDropdown(btn, currentColor, function (hex) {
            if (isCL) {
              if (!_store.clusterLineColors) _store.clusterLineColors = {};
              _store.clusterLineColors[clName] = hex;
            } else {
              if (!_store.iconColors) _store.iconColors = [];
              _store.iconColors[idx] = hex;
            }
            btn.style.background = hex;
            liveUpdate();
          });
        };
      })(colorBtns[ci]));
    }

    // Wire label inputs
    if (showLabels) {
      var labelInputs = container.querySelectorAll('input.icon-legend-input');
      for (var li = 0; li < labelInputs.length; li++) {
        labelInputs[li].addEventListener("input", (function (inp) {
          return function () {
            var idx = parseInt(inp.getAttribute("data-series"), 10);
            if (!_store.iconLegendLabels) _store.iconLegendLabels = [];
            _store.iconLegendLabels[idx] = inp.value.trim();
            liveUpdate();
          };
        })(labelInputs[li]));
      }
    }
  }

  // ── Stacked Stroke ─────────────────────────────────────

  function syncStackedStrokeUI() {
    if (!stackedStrokeToggle) return;
    stackedStrokeToggle.checked = _store.stackedStroke;
    if (stackedStrokeOptions) stackedStrokeOptions.style.display = _store.stackedStroke ? "flex" : "none";
    var sw = Math.round(_store.stackedStrokeWidth || 2);
    if (stackedStrokeWidth) stackedStrokeWidth.value = sw;
    if (stackedStrokeWidthRange) stackedStrokeWidthRange.value = sw;
    // Stroke color swatch is owned by ColorPickersUI
    if (_syncStrokeColor) _syncStrokeColor(_store.stackedStrokeColor || "#FFFFFF");
  }

  // ── Visibility (called from updateChartOptions) ────────

  function updateVisibility(type, isStacked) {
    var isIconType = (type === "icon");
    // Cluster and line also want per-series color swatches (one colour
    // per line/bar group), but NOT the segment-stroke option (their
    // marks aren't adjacent segments of one bar). Line keeps its own
    // legend toggle in Line Options, so it's excluded from showsLegend.
    var hasSeriesColors = isStacked || type === "cluster" || type === "line" || type === "cluster-line";

    // Icon chart sections
    if (iconOptionsSection) iconOptionsSection.style.display = "none";
    if (iconSeriesSection) iconSeriesSection.style.display = isIconType ? "block" : "none";
    if (iconLegendSection) iconLegendSection.style.display = isIconType ? "block" : "none";
    if (isIconType && iconLegendRows) buildLegendRows(iconLegendRows, true);

    // Series-colors panel (stacked + cluster + line)
    if (stackedColorsSection) stackedColorsSection.style.display = hasSeriesColors ? "block" : "none";
    // Stroke option (stacked only — cluster bars aren't adjacent segments)
    if (stackedStrokeSection) stackedStrokeSection.style.display = isStacked ? "block" : "none";
    // Legend toggle — stacked and cluster both use multi-series colors
    // and benefit from a legend. The field name is still `stackedLegend`
    // in the store for backwards compatibility with 0.10 configs.
    var showsLegend = isStacked || type === "cluster";
    if (stackedLegendSection) stackedLegendSection.style.display = showsLegend ? "block" : "none";
    if (hasSeriesColors) {
      if (stackedColorRows) buildLegendRows(stackedColorRows, false);
    }
    if (isStacked) {
      syncStackedStrokeUI();
    }
  }

  // ── Reparent label sections into legend for icon charts ─
  //
  // For the Icon chart, Label Color / Label Size move into the icon legend
  // section (as "Legend Text Color / Size"); for every other type they go
  // back home. The home is marked with an invisible placeholder left at the
  // moment of the move — NOT remembered once at startup: design-groups.js
  // relocates every Design section into its collapsible groups after the
  // first call, so a position captured earlier no longer exists. (That stale
  // position made the restore throw, which stranded both controls inside the
  // hidden icon legend for all other chart types until the panel reloaded.)

  function moveToLegend(section, target) {
    if (section.parentNode === target) return;
    if (!section._homeMarker) {
      section._homeMarker = document.createComment(" home of #" + section.id + " ");
    }
    section.parentNode.insertBefore(section._homeMarker, section);
    target.appendChild(section);
  }

  function moveHome(section) {
    var marker = section._homeMarker;
    if (marker && marker.parentNode) marker.parentNode.replaceChild(section, marker);
  }

  function reparentLabelSections(type) {
    var labelColorSection = document.getElementById("label-color-section");
    var labelScaleSection = document.getElementById("label-scale-section");
    if (!labelColorSection || !labelScaleSection) return;

    var lcLabel = labelColorSection.querySelector(".section-label");
    var lsLabel = labelScaleSection.querySelector(".section-label");

    if (type === "icon") {
      if (lcLabel) lcLabel.textContent = "Legend Text Color";
      if (lsLabel) lsLabel.textContent = "Legend Text Size";
      if (iconLegendSection) {
        moveToLegend(labelColorSection, iconLegendSection);
        moveToLegend(labelScaleSection, iconLegendSection);
      }
    } else {
      if (lcLabel) lcLabel.textContent = "Label Color";
      if (lsLabel) lsLabel.textContent = "Label Size";
      moveHome(labelColorSection);
      moveHome(labelScaleSection);
    }

    // Key Figures: hide label color (has its own text color picker)
    if (type === "keyfigures") {
      labelColorSection.style.display = "none";
    }
  }

  // ── Sync UI ↔ Store ────────────────────────────────────

  function syncToUI() {
    // Icon size slider
    if (iconSizeSlider) {
      iconSizeSlider.value = _store.iconSize || 20;
      if (iconSizeDisplay) iconSizeDisplay.textContent = _store.iconSize || 20;
    }

    // Icon legend toggle & layout
    if (iconShowLegendCheck) {
      iconShowLegendCheck.checked = _store.iconShowLegend !== false;
      if (iconLegendLayoutRow) {
        iconLegendLayoutRow.style.display = iconShowLegendCheck.checked ? "" : "none";
      }
    }
    if (iconLegendLayoutPicker) {
      var layoutVal = _store.iconLegendLayout || "horizontal";
      var layoutBtns = iconLegendLayoutPicker.querySelectorAll(".icon-pick");
      for (var lb = 0; lb < layoutBtns.length; lb++) {
        if (layoutBtns[lb].getAttribute("data-layout") === layoutVal) {
          layoutBtns[lb].classList.add("active");
        } else {
          layoutBtns[lb].classList.remove("active");
        }
      }
    }

    // Stacked stroke
    syncStackedStrokeUI();

    // Stacked legend toggle
    if (stackedLegendToggle) stackedLegendToggle.checked = !!_store.stackedLegend;
  }

  function syncFromUI() {
    if (iconSizeSlider) _store.iconSize = parseInt(iconSizeSlider.value, 10) || 20;
    if (stackedStrokeToggle) _store.stackedStroke = stackedStrokeToggle.checked;
    if (stackedStrokeWidth) _store.stackedStrokeWidth = Math.round(parseFloat(stackedStrokeWidth.value) || 2);
  }

  // ── Event Binding ──────────────────────────────────────

  function bindEvents() {
    // Icon size slider
    if (iconSizeSlider) {
      iconSizeSlider.addEventListener("input", function () {
        var val = parseInt(iconSizeSlider.value, 10) || 20;
        if (iconSizeDisplay) iconSizeDisplay.textContent = val;
        _store.iconSize = val;
        liveUpdate();
      });
    }

    // Icon legend toggle
    if (iconShowLegendCheck) {
      iconShowLegendCheck.addEventListener("change", function () {
        _store.iconShowLegend = iconShowLegendCheck.checked;
        if (iconLegendLayoutRow) iconLegendLayoutRow.style.display = iconShowLegendCheck.checked ? "" : "none";
        liveUpdate();
      });
    }

    // Icon legend layout buttons
    if (iconLegendLayoutPicker) {
      var legendLayoutBtns = iconLegendLayoutPicker.querySelectorAll(".icon-pick");
      for (var llb = 0; llb < legendLayoutBtns.length; llb++) {
        legendLayoutBtns[llb].addEventListener("click", (function (btn) {
          return function () {
            var layout = btn.getAttribute("data-layout");
            _store.iconLegendLayout = layout;
            var all = iconLegendLayoutPicker.querySelectorAll(".icon-pick");
            for (var a = 0; a < all.length; a++) all[a].classList.remove("active");
            btn.classList.add("active");
            liveUpdate();
          };
        })(legendLayoutBtns[llb]));
      }
    }

    // Stacked legend toggle
    if (stackedLegendToggle) {
      stackedLegendToggle.addEventListener("change", function () {
        _store.stackedLegend = this.checked;
        liveUpdate();
      });
    }

    // Stacked stroke toggle
    if (stackedStrokeToggle) {
      stackedStrokeToggle.addEventListener("change", function () {
        _store.stackedStroke = this.checked;
        if (stackedStrokeOptions) stackedStrokeOptions.style.display = this.checked ? "flex" : "none";
        if (this.checked && !_store.stackedStrokeWidth) {
          _store.stackedStrokeWidth = 2;
          if (stackedStrokeWidth) stackedStrokeWidth.value = 2;
          if (stackedStrokeWidthRange) stackedStrokeWidthRange.value = 2;
        }
        liveUpdate();
      });
    }

    // Stacked stroke width (number input)
    if (stackedStrokeWidth) {
      stackedStrokeWidth.addEventListener("input", function () {
        var v = Math.min(8, Math.max(1, Math.round(parseFloat(this.value) || 2)));
        _store.stackedStrokeWidth = v;
        if (stackedStrokeWidthRange) stackedStrokeWidthRange.value = v;
        liveUpdate();
      });
      stackedStrokeWidth.addEventListener("blur", function () {
        var v = Math.min(8, Math.max(1, Math.round(parseFloat(this.value) || 2)));
        this.value = v;
      });
    }

    // Stacked stroke width (range slider)
    if (stackedStrokeWidthRange) {
      stackedStrokeWidthRange.addEventListener("input", function () {
        var v = Math.round(parseFloat(this.value) || 2);
        _store.stackedStrokeWidth = v;
        if (stackedStrokeWidth) stackedStrokeWidth.value = v;
        liveUpdate();
      });
    }
  }

  // ── Init ───────────────────────────────────────────────

  function init(deps) {
    _store              = deps.store;
    _generate           = deps.generate;
    _schedule           = deps.schedule;
    _getIconPalette     = deps.getIconPalette;
    _getSwatches        = deps.getSwatches;
    _closeDropdown      = deps.closeDropdown;
    _buildSeriesDropdown = deps.buildSeriesDropdown;
    _openPicker         = deps.openPicker;
    _SHAPE_THUMBS       = deps.SHAPE_THUMBS;
    _assetIconsDir      = deps.assetIconsDir;
    _syncStrokeColor    = deps.syncStrokeColor;

    // Resolve DOM refs
    iconOptionsSection    = document.getElementById("icon-options-section");
    iconSeriesSection     = document.getElementById("icon-series-section");
    iconLegendSection     = document.getElementById("icon-legend-section");
    iconSizeSlider        = document.getElementById("icon-size-slider");
    iconSizeDisplay       = document.getElementById("icon-size-display");
    iconShowLegendCheck   = document.getElementById("icon-show-legend");
    iconLegendLayoutRow   = document.getElementById("icon-legend-layout-row");
    iconLegendLayoutPicker = document.getElementById("icon-legend-layout-picker");
    iconLegendRows        = document.getElementById("icon-legend-rows");
    stackedColorsSection  = document.getElementById("stacked-colors-section");
    stackedColorRows      = document.getElementById("stacked-color-rows");
    stackedStrokeSection  = document.getElementById("stacked-stroke-section");
    stackedStrokeToggle   = document.getElementById("stacked-stroke-toggle");
    stackedStrokeOptions  = document.getElementById("stacked-stroke-options");
    stackedStrokeWidth    = document.getElementById("stacked-stroke-width");
    stackedStrokeWidthRange = document.getElementById("stacked-stroke-width-range");
    stackedLegendSection  = document.getElementById("stacked-legend-section");
    stackedLegendToggle   = document.getElementById("stacked-legend-toggle");

    bindEvents();
  }

  // ── Public API ─────────────────────────────────────────

  return {
    init:               init,
    buildLegendRows:    buildLegendRows,
    syncStackedStrokeUI: syncStackedStrokeUI,
    updateVisibility:   updateVisibility,
    reparentLabelSections: reparentLabelSections,
    syncToUI:           syncToUI,
    syncFromUI:         syncFromUI
  };
})();
