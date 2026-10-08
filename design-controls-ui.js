/**
 * DesignControlsUI — Chart-specific design controls and slider bindings.
 *
 * Covers: line options, shade, donut, sankey sliders, bubble orientation +
 * separation, pie/donut label controls, bar label mode, value format,
 * auto-sort, height & bar-thickness auto/manual sliders, text & label scale.
 *
 * Dependencies (via init):
 *   store          — DataStore reference
 *   generate       — generateSVG function
 *   schedule       — scheduleLiveUpdate function
 *   readLineLabelBg — ColorPickersUI.readLineLabelBg
 */

var DesignControlsUI = (function () {
  "use strict";

  // Injected dependencies
  var _store, _generate, _schedule, _readLineLabelBg;

  // ── DOM refs ───────────────────────────────────────────

  // Line chart
  var lineOptionsSection, shadeCheck, lineShowDotsCheck, lineLabelPosSelect;
  var lineDotSizeSlider, lineDotSizeDisplay, lineDotSizeRow;
  var lineValueLabelsCheck, lineShowYAxisCheck, lineIndepScaleCheck, lineIndepScaleRow;
  var lineEndLabelsCheck, lineEndLabelsRow, lineLegendCheck, lineLegendRow;
  var lineLabelTableGroup, lineLabelTable, lineLabelsAll, lineLabelsNone;

  // Donut
  var donutCenterSection, donutCenterTitleInput, donutCenterLabelInput, donutCenterAutoCheck;
  var donutHoleSection, donutHoleSlider, donutHoleDisplay;

  // Sankey
  var sankeyOptionsSection;
  var sankeyNodeWidthSlider, sankeyNodeWidthDisplay;
  var sankeyNodePaddingSlider, sankeyNodePaddingDisplay;
  var sankeyLinkOpacitySlider, sankeyLinkOpacityDisplay;
  var sankeyLabelModeSelect, sankeyAutoDefaultsCheckbox;
  var sankeyNodeModeSelect;

  // Bubble
  var bubbleOrientation, bubbleOrientBtns;
  var bubbleSeparationSection, bubbleSeparationSlider;
  var bubbleSeparationDisplay, bubbleSeparationAuto;

  // Timeline
  var timelineOrientation, timelineOrientBtns;
  var timelineSpacingSection, timelineSpacingSlider, timelineSpacingDisplay, timelineSpacingReset;
  var TIMELINE_SPACING_DEFAULT = 90;

  // Cluster
  var clusterOrientation, clusterOrientBtns;

  // Pie/Donut labels
  var pieLabelSection, pieLabelModeSelect, pieLabelContentSelect, leaderLinesCheck;
  var pieLabelDistanceSlider, pieLabelDistanceDisplay;

  // Bar labels
  var barLabelSection, barLabelModeSelect;

  // Value format
  var numberFormatSelect, valuePrefixInput, valueSuffixInput;

  // Auto-sort
  var autoSortCheck;
  var autoSortOption;

  // Scale (axis max override, for cross-chart comparison)
  var scaleSection, axisMaxInput, axisMaxReset;

  // Hide zero-value labels
  var hideZeroSection, hideZeroCheck;

  // Height slider (auto/manual)
  var heightSlider, heightDisplay, heightAutoCheck;

  // Bar thickness slider (auto/manual)
  var barThicknessSection, barThicknessSlider, barThicknessDisplay, barThicknessAutoCheck;
  var barSpacingSection, barSpacingSlider, barSpacingDisplay, barSpacingAutoCheck;

  // Text & label scale
  var textScaleSlider, textScaleDisplay;
  var labelScaleSlider, labelScaleDisplay;

  // ── Helpers ────────────────────────────────────────────

  function liveUpdate() {
    if (_store.hasData()) { _generate(); _schedule(); }
  }

  // Debounced live update for text-like inputs (donut center, etc.)
  var textUpdateTimer = null;
  function debouncedUpdate() {
    if (textUpdateTimer) clearTimeout(textUpdateTimer);
    textUpdateTimer = setTimeout(function () {
      liveUpdate();
    }, 1000);
  }

  // ── Scale (axis max) ───────────────────────────────────

  // Chart types where "Maximum value" is meaningful. Pie/donut always
  // sum to 100%, timeline/map/table/key figures/sankey/icon don't have
  // a numeric axis the user is thinking about.
  var SCALE_TYPES = {
    "hbar": true, "vbar": true,
    "stacked-bar": true, "stacked-col": true,
    "cluster": true, "line": true, "bubble": true
  };

  // Parse the user's "Maximum value" input. Accepts plain numbers,
  // optional comma thousand separators, and the K/M/B shortcuts OCHA
  // uses across the tool (so "2.5M" → 2,500,000). Returns null when
  // the field is blank or the input can't be parsed — null means "auto".
  function parseAxisMax(str) {
    if (str == null) return null;
    var s = String(str).trim().replace(/,/g, "");
    if (!s) return null;
    var m = s.match(/^(-?[0-9]*\.?[0-9]+)\s*([kKmMbB]?)$/);
    if (!m) return null;
    var n = parseFloat(m[1]);
    var suf = m[2].toUpperCase();
    if (suf === "K") n *= 1000;
    else if (suf === "M") n *= 1000000;
    else if (suf === "B") n *= 1000000000;
    if (!isFinite(n) || n <= 0) return null;
    return n;
  }

  // Format a stored numeric axisMax back into what the user typed
  // shape — uses K/M/B when the number is a clean multiple, plain
  // number otherwise so round-tripping doesn't surprise them.
  function formatAxisMax(n) {
    if (n == null) return "";
    if (n >= 1000000000 && n % 1000000000 === 0) return (n / 1000000000) + "B";
    if (n >= 1000000 && n % 1000000 === 0) return (n / 1000000) + "M";
    if (n >= 1000 && n % 1000 === 0) return (n / 1000) + "K";
    return String(n);
  }

  // ── Bubble Separation ──────────────────────────────────

  function syncBubbleSeparationUI() {
    var isAuto = _store.bubbleSeparation === 0;
    if (bubbleSeparationAuto) bubbleSeparationAuto.checked = isAuto;
    if (isAuto) {
      bubbleSeparationSlider.classList.add("auto-active");
      bubbleSeparationDisplay.textContent = "Auto";
    } else {
      bubbleSeparationSlider.classList.remove("auto-active");
      bubbleSeparationDisplay.textContent = _store.bubbleSeparation + "px";
    }
    bubbleSeparationSlider.value = _store.bubbleSeparation || 0;
  }

  // ── Bar Thickness Visibility ───────────────────────────

  function updateBarThicknessVisibility() {
    if (!barThicknessSection) return;
    var type = _store.chartType || "hbar";
    var BAR_TYPES = { "hbar": true, "vbar": true, "stacked-bar": true, "stacked-col": true, "cluster": true };
    barThicknessSection.style.display = BAR_TYPES[type] ? "block" : "none";
    if (barSpacingSection) {
      barSpacingSection.style.display = BAR_TYPES[type] ? "block" : "none";
    }
  }

  // ── Line value-label table ─────────────────────────────
  // A grid mirroring the data: one column per series, one checkbox per
  // value. Ticked = that point's value label is shown. Writes a list of
  // "row:series" keys to store.lineHiddenLabels (the renderer skips
  // those). Row index matches the renderer's data order (both read
  // toMultiValueData(true)); series index is the value-column position.
  var LINE_LABEL_CAP = 6; // matches the renderer's line cap

  function lineSeriesCols() {
    var cols = (_store.valueCols && _store.valueCols.length)
      ? _store.valueCols.slice()
      : [_store.valueCol != null ? _store.valueCol : 1];
    return cols.slice(0, LINE_LABEL_CAP);
  }

  function buildLineLabelTable() {
    if (!lineLabelTable) return;
    var data = _store.toMultiValueData ? _store.toMultiValueData(true) : [];
    var cols = lineSeriesCols();
    if (!data.length || !cols.length) { lineLabelTable.innerHTML = ""; return; }

    var hidden = Array.isArray(_store.lineHiddenLabels) ? _store.lineHiddenLabels : [];
    var hiddenSet = {};
    for (var hh = 0; hh < hidden.length; hh++) hiddenSet[hidden[hh]] = true;

    function esc(s) {
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    var html = "<table><thead><tr><th></th>";
    for (var s = 0; s < cols.length; s++) {
      var nm = _store.headers[cols[s]] || ("Series " + (s + 1));
      html += '<th data-col="' + s + '" title="' + esc(nm) + ' — click to toggle column">' + esc(nm) + "</th>";
    }
    html += "</tr></thead><tbody>";
    for (var r = 0; r < data.length; r++) {
      html += '<tr><td class="cat" title="' + esc(data[r].label) + '">' + esc(data[r].label) + "</td>";
      for (var s2 = 0; s2 < cols.length; s2++) {
        var key = r + ":" + s2;
        var checked = hiddenSet[key] ? "" : " checked";
        html += '<td><input type="checkbox" class="lbl" data-key="' + key + '"' + checked + "></td>";
      }
      html += "</tr>";
    }
    html += "</tbody></table>";
    lineLabelTable.innerHTML = html;

    // Per-cell toggles
    var boxes = lineLabelTable.querySelectorAll("input.lbl");
    for (var b = 0; b < boxes.length; b++) {
      boxes[b].addEventListener("change", (function (box) {
        return function () { setLabelHidden(box.getAttribute("data-key"), !box.checked); };
      })(boxes[b]));
    }
    // Column header click → toggle the whole series' labels
    var ths = lineLabelTable.querySelectorAll("th[data-col]");
    for (var th = 0; th < ths.length; th++) {
      ths[th].addEventListener("click", (function (header) {
        return function () { toggleLabelColumn(parseInt(header.getAttribute("data-col"), 10), data.length); };
      })(ths[th]));
    }
  }

  function setLabelHidden(key, hide) {
    if (!Array.isArray(_store.lineHiddenLabels)) _store.lineHiddenLabels = [];
    var pos = _store.lineHiddenLabels.indexOf(key);
    if (hide) { if (pos === -1) _store.lineHiddenLabels.push(key); }
    else { if (pos !== -1) _store.lineHiddenLabels.splice(pos, 1); }
    liveUpdate();
  }

  function toggleLabelColumn(s, rowCount) {
    if (!Array.isArray(_store.lineHiddenLabels)) _store.lineHiddenLabels = [];
    // If any row in this column is currently shown, hide them all;
    // otherwise show them all.
    var anyShown = false;
    for (var r = 0; r < rowCount; r++) {
      if (_store.lineHiddenLabels.indexOf(r + ":" + s) === -1) { anyShown = true; break; }
    }
    for (var r2 = 0; r2 < rowCount; r2++) {
      var key = r2 + ":" + s;
      var pos = _store.lineHiddenLabels.indexOf(key);
      if (anyShown) { if (pos === -1) _store.lineHiddenLabels.push(key); }
      else { if (pos !== -1) _store.lineHiddenLabels.splice(pos, 1); }
    }
    buildLineLabelTable();
    liveUpdate();
  }

  function syncLineLabelTableVisibility() {
    if (!lineLabelTableGroup) return;
    var show = (_store.chartType === "line") &&
               (_store.lineValueLabels !== false) &&
               _store.hasData && _store.hasData();
    lineLabelTableGroup.style.display = show ? "block" : "none";
  }

  // ── Visibility (called from updateChartOptions) ────────

  function updateVisibility(type) {
    // Line Options serve two chart types:
    //   • "line"          — full set (value labels, Y axis, end labels,
    //                       legend, shade, dots, label position/bg, table)
    //   • "cluster-line"  — small multiples: only the per-panel basics
    //                       apply (dots, dot size, shade). The rest are
    //                       single-plot concepts and are hidden.
    var isLine = (type === "line");
    var isClusterLine = (type === "cluster-line");
    if (lineOptionsSection) lineOptionsSection.style.display = (isLine || isClusterLine) ? "block" : "none";

    if (isLine || isClusterLine) {
      // Shared between both: value-labels toggle and Y-axis toggle
      // (for small multiples, the Y axis appears on every panel).
      var shared = [
        document.getElementById("line-value-labels-row"),
        document.getElementById("line-yaxis-row")
      ];
      for (var sh = 0; sh < shared.length; sh++) {
        if (shared[sh]) shared[sh].style.display = "";
      }
      // Single-line-only controls — hidden for the small-multiples grid.
      var lineOnly = [
        lineEndLabelsRow, lineLegendRow,
        document.getElementById("line-pos-group"),
        document.getElementById("line-bg-group"),
        lineLabelTableGroup
      ];
      for (var lo = 0; lo < lineOnly.length; lo++) {
        if (lineOnly[lo]) lineOnly[lo].style.display = isClusterLine ? "none" : "";
      }

      // CRITICAL: refresh the shared value-labels / Y-axis checkboxes
      // from the PER-TYPE store field. updateVisibility runs on every
      // chart-type switch (before the next generate reads the checkboxes
      // back via syncFromUI). Without this the checkboxes keep the
      // previous type's state and that stale value leaks into the new
      // type's field — e.g. switching to small multiples would inherit
      // the line chart's "value labels on / Y axis off".
      if (lineValueLabelsCheck) lineValueLabelsCheck.checked = isClusterLine
        ? !!_store.clusterLineValueLabels
        : (_store.lineValueLabels !== false);
      if (lineShowYAxisCheck) lineShowYAxisCheck.checked = isClusterLine
        ? (_store.clusterLineYAxis !== false)
        : !!_store.lineShowYAxis;

      // "Separate scale per chart" — small-multiples only.
      if (lineIndepScaleRow) lineIndepScaleRow.style.display = isClusterLine ? "" : "none";
      if (lineIndepScaleCheck) lineIndepScaleCheck.checked = !!_store.clusterLineIndependentScale;
    }

    if (isLine) {
      // End-of-line labels and the legend only make sense with 2+ lines.
      var lineSeriesN = (_store.valueCols && _store.valueCols.length) || 1;
      var lineMulti = lineSeriesN > 1;
      if (lineEndLabelsRow) lineEndLabelsRow.style.display = lineMulti ? "block" : "none";
      if (lineLegendRow) lineLegendRow.style.display = lineMulti ? "block" : "none";
      // Rebuild the per-value-label grid from current data, then show
      // it only when value labels are turned on.
      buildLineLabelTable();
      syncLineLabelTableVisibility();
    }

    // Bubble orientation + separation
    if (bubbleOrientation) {
      if (type === "bubble") {
        bubbleOrientation.classList.add("visible");
      } else {
        bubbleOrientation.classList.remove("visible");
      }
    }
    if (bubbleSeparationSection) {
      bubbleSeparationSection.style.display = (type === "bubble") ? "block" : "none";
    }

    // Timeline orientation + event spacing
    if (timelineOrientation) {
      if (type === "timeline") {
        timelineOrientation.classList.add("visible");
      } else {
        timelineOrientation.classList.remove("visible");
      }
    }
    if (timelineSpacingSection) {
      // Only makes sense for horizontal; vertical has its own per-row layout.
      var showTlSpacing = (type === "timeline") &&
        ((_store.timelineOrientation || "horizontal") === "horizontal");
      timelineSpacingSection.style.display = showTlSpacing ? "block" : "none";
    }

    // Cluster orientation
    if (clusterOrientation) {
      if (type === "cluster") {
        clusterOrientation.classList.add("visible");
      } else {
        clusterOrientation.classList.remove("visible");
      }
    }

    // Donut center text & hole size — also apply to cluster-donut.
    // For cluster-donut only the Auto checkbox actually drives output
    // (the heading/label text fields don't make sense on a per-donut
    // cluster); the renderer simply ignores those fields.
    var isDonutFamily = (type === "donut" || type === "cluster-donut");
    if (donutCenterSection) donutCenterSection.style.display = isDonutFamily ? "block" : "none";
    if (donutHoleSection) donutHoleSection.style.display = isDonutFamily ? "block" : "none";

    // Sankey options
    if (sankeyOptionsSection) sankeyOptionsSection.style.display = (type === "sankey") ? "block" : "none";

    // Timeline category colours — visible whenever the chart is a
    // timeline. The section auto-fills from the data's "Category"
    // column (or shows a one-line hint if there's no Category column
    // yet).
    var timelineCategoriesSection = document.getElementById("timeline-categories-section");
    if (timelineCategoriesSection) {
      timelineCategoriesSection.style.display = (type === "timeline") ? "block" : "none";
      if (type === "timeline") {
        // Sync legend toggle from store
        var tlLegendToggle = document.getElementById("timeline-legend-toggle");
        if (tlLegendToggle) tlLegendToggle.checked = _store.timelineLegend !== false;
        if (typeof ColorPickersUI !== "undefined" && ColorPickersUI.buildTimelineCategoryRows) {
          ColorPickersUI.buildTimelineCategoryRows();
        }
      }
    }

    // Pie/Donut label options — slice labels also apply to each donut
    // in a cluster-donut (default mode is "none" so it's quiet by
    // default, but the user can flip it on for big donuts).
    if (pieLabelSection) pieLabelSection.style.display = (type === "pie" || type === "donut" || type === "cluster-donut") ? "block" : "none";

    // Cluster Donut legend toggle — default ON, lives in its own
    // section because the field (clusterDonutLegend) is separate
    // from stackedLegend (different default, different chart family).
    var cdLegendSection = document.getElementById("cluster-donut-legend-section");
    var cdLegendToggle = document.getElementById("cluster-donut-legend-toggle");
    if (cdLegendSection) {
      cdLegendSection.style.display = (type === "cluster-donut") ? "block" : "none";
      if (cdLegendToggle) cdLegendToggle.checked = (_store.clusterDonutLegend !== false);
    }

    // Pie / donut legend toggle — default OFF (direct labelling
    // is the primary mode); user can flip it on to add a chip
    // strip above the chart.
    var pieLegendToggle = document.getElementById("pie-legend-toggle");
    if (pieLegendToggle) pieLegendToggle.checked = !!_store.pieLegend;

    // Per-slice colour swatches (pie / donut) — visible for both
    // and rebuilt every chart-type change so the rows match the
    // current data.
    var sliceColorsSec = document.getElementById("slice-colors-section");
    if (sliceColorsSec) {
      sliceColorsSec.style.display = (type === "pie" || type === "donut") ? "block" : "none";
      if ((type === "pie" || type === "donut") &&
          typeof ColorPickersUI !== "undefined" && ColorPickersUI.buildSliceColorRows) {
        ColorPickersUI.buildSliceColorRows();
      }
    }

    // Per-category colour swatches (cluster donut).
    var cdCatsSec = document.getElementById("cluster-donut-categories-section");
    if (cdCatsSec) {
      cdCatsSec.style.display = (type === "cluster-donut") ? "block" : "none";
      if (type === "cluster-donut" &&
          typeof ColorPickersUI !== "undefined" && ColorPickersUI.buildClusterDonutCategoryRows) {
        ColorPickersUI.buildClusterDonutCategoryRows();
      }
    }

    // Bar/Column value labels (includes stacked)
    var isBar = (type === "hbar" || type === "vbar" || type === "stacked-bar" || type === "stacked-col");
    if (barLabelSection) barLabelSection.style.display = isBar ? "block" : "none";

    // "Totals only" option — stacked types only
    var isStacked = (type === "stacked-bar" || type === "stacked-col");
    if (barLabelModeSelect) {
      var totalOpt = barLabelModeSelect.querySelector('option[value="total"]');
      if (totalOpt) totalOpt.style.display = isStacked ? "" : "none";
      if (!isStacked && barLabelModeSelect.value === "total") {
        barLabelModeSelect.value = "outside";
        _store.barLabelMode = "outside";
      }
    }

    // Value format — hide for icon charts (no numeric values)
    var valueFormatSection = document.getElementById("value-format-section");
    if (valueFormatSection) valueFormatSection.style.display = (type === "icon") ? "none" : "block";

    // Bar thickness
    updateBarThicknessVisibility();

    // Scale (axis max) — only for types where a numeric axis exists
    if (scaleSection) scaleSection.style.display = SCALE_TYPES[type] ? "block" : "none";
    // Hide-zero-labels — same type list (every chart that prints a
    // numeric value label per data point).
    if (hideZeroSection) hideZeroSection.style.display = SCALE_TYPES[type] ? "block" : "none";

    // Auto-sort: hide for sankey, key figures, timeline, and line —
    // not meaningful for those types. Line and timeline have an ordered
    // X axis (sequence/time); sorting by magnitude would scramble it.
    var hideSort = (type === "sankey" || type === "keyfigures" ||
                    type === "timeline" || type === "line");
    if (autoSortOption) autoSortOption.style.display = hideSort ? "none" : "";
    if (autoSortCheck) autoSortCheck.checked = _store.autoSort !== false;
  }

  // ── Sync UI ↔ Store ────────────────────────────────────

  function syncToUI() {
    // Height slider
    if (heightSlider) {
      var vp = _store.verticalPadding || 0;
      if (vp === 0) {
        heightAutoCheck.checked = true;
        heightSlider.classList.add("auto-active");
        heightSlider.value = 0;
        heightDisplay.textContent = "Auto";
      } else {
        heightAutoCheck.checked = false;
        heightSlider.classList.remove("auto-active");
        heightSlider.value = vp;
        heightDisplay.textContent = vp > 0 ? ("+" + vp) : String(vp);
      }
    }

    // Bar thickness
    if (barThicknessSlider) {
      var bt = _store.barThickness || 0;
      if (bt === 0) {
        barThicknessAutoCheck.checked = true;
        barThicknessSlider.classList.add("auto-active");
        barThicknessSlider.value = 20;
        barThicknessDisplay.textContent = "Auto";
      } else {
        barThicknessAutoCheck.checked = false;
        barThicknessSlider.classList.remove("auto-active");
        barThicknessSlider.value = bt;
        barThicknessDisplay.textContent = bt + "px";
      }
    }

    // Bar spacing — gap between columns/rows. 0 = Auto.
    if (barSpacingSlider) {
      var bs = _store.barSpacing || 0;
      if (bs === 0) {
        barSpacingAutoCheck.checked = true;
        barSpacingSlider.classList.add("auto-active");
        barSpacingSlider.value = 10;
        barSpacingDisplay.textContent = "Auto";
      } else {
        barSpacingAutoCheck.checked = false;
        barSpacingSlider.classList.remove("auto-active");
        barSpacingSlider.value = bs;
        barSpacingDisplay.textContent = bs + "px";
      }
    }
    updateBarThicknessVisibility();

    // Shade
    if (shadeCheck) shadeCheck.checked = !!_store.shade;

    // Line chart options
    // Value labels + Y axis are shared checkboxes but back DIFFERENT
    // fields per type: small multiples (cluster-line) have their own
    // defaults (Y axis on, labels off) vs the single line (labels on,
    // Y axis off).
    var clType = (_store.chartType === "cluster-line");
    if (lineValueLabelsCheck) lineValueLabelsCheck.checked = clType
      ? !!_store.clusterLineValueLabels
      : (_store.lineValueLabels !== false);
    if (lineShowYAxisCheck) lineShowYAxisCheck.checked = clType
      ? (_store.clusterLineYAxis !== false)
      : !!_store.lineShowYAxis;
    if (lineIndepScaleCheck) lineIndepScaleCheck.checked = !!_store.clusterLineIndependentScale;
    if (lineEndLabelsCheck) lineEndLabelsCheck.checked = _store.lineSeriesEndLabels !== false;
    if (lineLegendCheck) lineLegendCheck.checked = !!_store.lineLegend;
    if (lineShowDotsCheck) lineShowDotsCheck.checked = _store.lineShowDots !== false;
    if (lineDotSizeSlider) {
      var ds = _store.lineDotSize != null ? _store.lineDotSize : 4;
      lineDotSizeSlider.value = ds;
      if (lineDotSizeDisplay) lineDotSizeDisplay.textContent = ds + "px";
    }
    // Grey out / hide dot size slider when dots are off
    if (lineDotSizeRow) {
      lineDotSizeRow.style.opacity = (_store.lineShowDots !== false) ? "1" : "0.4";
    }
    if (lineLabelPosSelect) lineLabelPosSelect.value = _store.lineLabelPos || "auto";

    // Donut center text
    if (donutCenterTitleInput) donutCenterTitleInput.value = _store.donutCenterTitle || "";
    if (donutCenterLabelInput) donutCenterLabelInput.value = _store.donutCenterLabel || "";
    if (donutCenterAutoCheck) donutCenterAutoCheck.checked = _store.donutCenterAuto !== false;

    // Donut hole size
    if (donutHoleSlider) {
      var dh = _store.donutHole != null ? _store.donutHole : 60;
      donutHoleSlider.value = dh;
      donutHoleDisplay.textContent = dh + "%";
    }

    // Bubble separation
    if (bubbleSeparationSlider) syncBubbleSeparationUI();

    // Bubble orientation
    if (bubbleOrientBtns) {
      var orient = _store.bubbleOrientation || "horizontal";
      for (var bi = 0; bi < bubbleOrientBtns.length; bi++) {
        if (bubbleOrientBtns[bi].getAttribute("data-orient") === orient) {
          bubbleOrientBtns[bi].classList.add("active");
        } else {
          bubbleOrientBtns[bi].classList.remove("active");
        }
      }
    }

    // Timeline orientation
    if (timelineOrientBtns) {
      var tlOrient = _store.timelineOrientation || "horizontal";
      for (var ti = 0; ti < timelineOrientBtns.length; ti++) {
        if (timelineOrientBtns[ti].getAttribute("data-orient") === tlOrient) {
          timelineOrientBtns[ti].classList.add("active");
        } else {
          timelineOrientBtns[ti].classList.remove("active");
        }
      }
    }

    // Cluster orientation
    if (clusterOrientBtns) {
      var clOrient = _store.clusterOrientation || "horizontal";
      for (var ci = 0; ci < clusterOrientBtns.length; ci++) {
        if (clusterOrientBtns[ci].getAttribute("data-orient") === clOrient) {
          clusterOrientBtns[ci].classList.add("active");
        } else {
          clusterOrientBtns[ci].classList.remove("active");
        }
      }
    }

    // Timeline event spacing
    if (timelineSpacingSlider) {
      var sp = _store.timelineEventSpacing || TIMELINE_SPACING_DEFAULT;
      timelineSpacingSlider.value = sp;
      if (timelineSpacingDisplay) timelineSpacingDisplay.textContent = sp + "px";
    }
    var tlCompactCheck = document.getElementById("timeline-compact-arcs");
    if (tlCompactCheck) tlCompactCheck.checked = !!_store.timelineCompactArcs;
    var tlRowGapSlider = document.getElementById("timeline-rowgap-slider");
    var tlRowGapDisplay = document.getElementById("timeline-rowgap-display");
    if (tlRowGapSlider) {
      var rg = (_store.timelineRowGap && _store.timelineRowGap > 0) ? _store.timelineRowGap : 30;
      tlRowGapSlider.value = rg;
      if (tlRowGapDisplay) tlRowGapDisplay.textContent = rg + "px";
    }

    // Pie/donut label options
    if (pieLabelModeSelect) pieLabelModeSelect.value = _store.pieLabelMode || "auto";
    if (pieLabelContentSelect) pieLabelContentSelect.value = _store.pieLabelContent || "label-pct";
    if (leaderLinesCheck) leaderLinesCheck.checked = _store.pieLeaderLines !== false;
    if (pieLabelDistanceSlider) {
      var pld = _store.pieLabelDistance != null ? _store.pieLabelDistance : 24;
      pieLabelDistanceSlider.value = pld;
      if (pieLabelDistanceDisplay) pieLabelDistanceDisplay.textContent = pld + "px";
    }

    // Bar/Column value labels
    if (barLabelModeSelect) barLabelModeSelect.value = _store.barLabelMode || "outside";

    // Value format
    if (numberFormatSelect) numberFormatSelect.value = _store.numberFormat || "auto";
    if (valuePrefixInput) valuePrefixInput.value = _store.valuePrefix || "";
    if (valueSuffixInput) valueSuffixInput.value = _store.valueSuffix || "";

    // Auto-sort
    if (autoSortCheck) autoSortCheck.checked = _store.autoSort !== false;

    // Text scale slider
    if (textScaleSlider) {
      var ts = _store.textScale || 100;
      textScaleSlider.value = ts;
      textScaleDisplay.textContent = ts + "%";
    }

    // Label scale slider
    if (labelScaleSlider) {
      var ls = _store.labelScale || 100;
      labelScaleSlider.value = ls;
      labelScaleDisplay.textContent = ls + "%";
    }

    // Header / footer text width sliders — round-trip with stored
    // config (default 100% when missing or out of range).
    var hdrTwS = document.getElementById("header-text-width-slider");
    var hdrTwD = document.getElementById("header-text-width-display");
    if (hdrTwS) {
      var htw = (_store.headerTextWidth && _store.headerTextWidth > 0) ? _store.headerTextWidth : 100;
      hdrTwS.value = htw;
      if (hdrTwD) hdrTwD.textContent = htw + "%";
    }
    var ftrTwS = document.getElementById("footer-text-width-slider");
    var ftrTwD = document.getElementById("footer-text-width-display");
    if (ftrTwS) {
      var ftw = (_store.footerTextWidth && _store.footerTextWidth > 0) ? _store.footerTextWidth : 100;
      ftrTwS.value = ftw;
      if (ftrTwD) ftrTwD.textContent = ftw + "%";
    }

    // Sankey options
    if (sankeyNodeWidthSlider) {
      var snw = _store.sankeyNodeWidth || 20;
      sankeyNodeWidthSlider.value = snw;
      sankeyNodeWidthDisplay.textContent = snw;
    }
    if (sankeyNodePaddingSlider) {
      var snp = _store.sankeyNodePadding || 15;
      sankeyNodePaddingSlider.value = snp;
      sankeyNodePaddingDisplay.textContent = snp;
    }
    if (sankeyLinkOpacitySlider) {
      var slo = _store.sankeyLinkOpacity != null ? _store.sankeyLinkOpacity : 0.4;
      sankeyLinkOpacitySlider.value = Math.round(slo * 100);
      sankeyLinkOpacityDisplay.textContent = Math.round(slo * 100) + "%";
    }
    if (sankeyLabelModeSelect) sankeyLabelModeSelect.value = _store.sankeyLabelMode || "both";
    if (sankeyNodeModeSelect) sankeyNodeModeSelect.value = _store.sankeyNodeMode || "auto";

    // Scale (axis max) — reflect stored value; empty when auto
    if (axisMaxInput) axisMaxInput.value = formatAxisMax(_store.axisMax);

    // Hide zero-value labels
    if (hideZeroCheck) hideZeroCheck.checked = !!_store.hideZeroLabels;
  }

  function syncFromUI() {
    // Height
    if (heightAutoCheck) {
      _store.verticalPadding = heightAutoCheck.checked ? 0 : (parseInt(heightSlider.value, 10) || 0);
    }
    // Bar thickness
    if (barThicknessAutoCheck) {
      _store.barThickness = barThicknessAutoCheck.checked ? 0 : (parseInt(barThicknessSlider.value, 10) || 0);
    }
    // Bar spacing — px between columns or rows; 0 = Auto.
    if (barSpacingAutoCheck) {
      _store.barSpacing = barSpacingAutoCheck.checked ? 0 : (parseInt(barSpacingSlider.value, 10) || 0);
    }
    // Shade
    if (shadeCheck) _store.shade = shadeCheck.checked;
    // Line options
    var clTypeR = (_store.chartType === "cluster-line");
    if (lineValueLabelsCheck) {
      if (clTypeR) _store.clusterLineValueLabels = lineValueLabelsCheck.checked;
      else _store.lineValueLabels = lineValueLabelsCheck.checked;
    }
    if (lineShowYAxisCheck) {
      if (clTypeR) _store.clusterLineYAxis = lineShowYAxisCheck.checked;
      else _store.lineShowYAxis = lineShowYAxisCheck.checked;
    }
    if (clTypeR && lineIndepScaleCheck) _store.clusterLineIndependentScale = lineIndepScaleCheck.checked;
    if (lineEndLabelsCheck) _store.lineSeriesEndLabels = lineEndLabelsCheck.checked;
    if (lineLegendCheck) _store.lineLegend = lineLegendCheck.checked;
    if (lineShowDotsCheck) _store.lineShowDots = lineShowDotsCheck.checked;
    if (lineDotSizeSlider) _store.lineDotSize = parseInt(lineDotSizeSlider.value, 10) || 4;
    if (lineLabelPosSelect) _store.lineLabelPos = lineLabelPosSelect.value;
    if (_readLineLabelBg) _store.lineLabelBg = _readLineLabelBg();
    // Donut
    if (donutCenterTitleInput) _store.donutCenterTitle = donutCenterTitleInput.value.trim();
    if (donutCenterLabelInput) _store.donutCenterLabel = donutCenterLabelInput.value.trim();
    if (donutCenterAutoCheck) _store.donutCenterAuto = donutCenterAutoCheck.checked;
    if (donutHoleSlider) _store.donutHole = parseInt(donutHoleSlider.value, 10) || 60;
    // Pie labels
    if (pieLabelModeSelect) _store.pieLabelMode = pieLabelModeSelect.value;
    if (pieLabelContentSelect) _store.pieLabelContent = pieLabelContentSelect.value;
    if (leaderLinesCheck) _store.pieLeaderLines = leaderLinesCheck.checked;
    // Bar label mode
    if (barLabelModeSelect) _store.barLabelMode = barLabelModeSelect.value;
    // Value format
    if (numberFormatSelect) _store.numberFormat = numberFormatSelect.value;
    if (valuePrefixInput) _store.valuePrefix = valuePrefixInput.value;
    if (valueSuffixInput) _store.valueSuffix = valueSuffixInput.value;
    // Auto-sort
    if (autoSortCheck) _store.autoSort = autoSortCheck.checked;
    // Text & label scale
    if (textScaleSlider) _store.textScale = parseInt(textScaleSlider.value, 10) || 100;
    if (labelScaleSlider) _store.labelScale = parseInt(labelScaleSlider.value, 10) || 100;
    // Sankey
    if (sankeyNodeWidthSlider) _store.sankeyNodeWidth = parseInt(sankeyNodeWidthSlider.value, 10) || 20;
    if (sankeyNodePaddingSlider) _store.sankeyNodePadding = parseInt(sankeyNodePaddingSlider.value, 10) || 15;
    if (sankeyLinkOpacitySlider) _store.sankeyLinkOpacity = (parseInt(sankeyLinkOpacitySlider.value, 10) || 40) / 100;
    if (sankeyLabelModeSelect) _store.sankeyLabelMode = sankeyLabelModeSelect.value;
    if (sankeyNodeModeSelect) _store.sankeyNodeMode = sankeyNodeModeSelect.value;
  }

  // ── Event Binding ──────────────────────────────────────

  function bindEvents() {

    // ── Shade checkbox ──
    if (shadeCheck) {
      shadeCheck.addEventListener("change", function () {
        _store.shade = shadeCheck.checked;
        liveUpdate();
      });
    }

    // ── Line chart options ──
    function onLineOptionChange() {
      _store.lineShowDots = lineShowDotsCheck.checked;
      _store.lineLabelPos = lineLabelPosSelect.value;
      if (_readLineLabelBg) _store.lineLabelBg = _readLineLabelBg();
      if (lineDotSizeRow) {
        lineDotSizeRow.style.opacity = _store.lineShowDots ? "1" : "0.4";
      }
      liveUpdate();
    }
    if (lineShowDotsCheck) lineShowDotsCheck.addEventListener("change", onLineOptionChange);
    if (lineLabelPosSelect) lineLabelPosSelect.addEventListener("change", onLineOptionChange);

    // New line toggles: value labels, Y axis, end-of-line labels, legend.
    // Value labels + Y axis back per-type fields (see syncToUI).
    if (lineValueLabelsCheck) lineValueLabelsCheck.addEventListener("change", function () {
      if (_store.chartType === "cluster-line") {
        _store.clusterLineValueLabels = lineValueLabelsCheck.checked;
      } else {
        _store.lineValueLabels = lineValueLabelsCheck.checked;
        syncLineLabelTableVisibility();   // per-label grid is moot when labels off
      }
      liveUpdate();
    });
    // "Which value labels to show" — All / None shortcuts
    if (lineLabelsAll) lineLabelsAll.addEventListener("click", function (e) {
      e.preventDefault();
      _store.lineHiddenLabels = [];
      buildLineLabelTable();
      liveUpdate();
    });
    if (lineLabelsNone) lineLabelsNone.addEventListener("click", function (e) {
      e.preventDefault();
      var data = _store.toMultiValueData ? _store.toMultiValueData(true) : [];
      var cols = lineSeriesCols();
      var keys = [];
      for (var r = 0; r < data.length; r++) {
        for (var s = 0; s < cols.length; s++) keys.push(r + ":" + s);
      }
      _store.lineHiddenLabels = keys;
      buildLineLabelTable();
      liveUpdate();
    });
    if (lineShowYAxisCheck) lineShowYAxisCheck.addEventListener("change", function () {
      if (_store.chartType === "cluster-line") _store.clusterLineYAxis = lineShowYAxisCheck.checked;
      else _store.lineShowYAxis = lineShowYAxisCheck.checked;
      liveUpdate();
    });
    // Separate scale per chart (small multiples). Turning it ON also
    // switches the per-panel Y axis OFF by default (the point is reading
    // trends, not magnitudes) — the user can turn the Y axis back on.
    if (lineIndepScaleCheck) lineIndepScaleCheck.addEventListener("change", function () {
      _store.clusterLineIndependentScale = lineIndepScaleCheck.checked;
      if (lineIndepScaleCheck.checked) {
        _store.clusterLineYAxis = false;
        if (lineShowYAxisCheck) lineShowYAxisCheck.checked = false;
      }
      liveUpdate();
    });
    if (lineEndLabelsCheck) lineEndLabelsCheck.addEventListener("change", function () {
      _store.lineSeriesEndLabels = lineEndLabelsCheck.checked;
      liveUpdate();
    });
    if (lineLegendCheck) lineLegendCheck.addEventListener("change", function () {
      _store.lineLegend = lineLegendCheck.checked;
      liveUpdate();
    });
    if (lineDotSizeSlider) {
      lineDotSizeSlider.addEventListener("input", function () {
        var val = parseInt(lineDotSizeSlider.value, 10) || 4;
        _store.lineDotSize = val;
        if (lineDotSizeDisplay) lineDotSizeDisplay.textContent = val + "px";
        liveUpdate();
      });
    }

    // ── Donut center text ──
    if (donutCenterTitleInput) {
      donutCenterTitleInput.addEventListener("input", function () {
        _store.donutCenterTitle = donutCenterTitleInput.value.trim();
        debouncedUpdate();
      });
    }
    if (donutCenterLabelInput) {
      donutCenterLabelInput.addEventListener("input", function () {
        _store.donutCenterLabel = donutCenterLabelInput.value.trim();
        debouncedUpdate();
      });
    }
    if (donutCenterAutoCheck) {
      donutCenterAutoCheck.addEventListener("change", function () {
        _store.donutCenterAuto = donutCenterAutoCheck.checked;
        liveUpdate();
      });
    }

    // ── Timeline legend toggle ──
    var tlLegendToggle = document.getElementById("timeline-legend-toggle");
    if (tlLegendToggle) {
      tlLegendToggle.addEventListener("change", function () {
        _store.timelineLegend = tlLegendToggle.checked;
        liveUpdate();
      });
    }

    // ── Cluster donut legend toggle ──
    var cdLegendToggleEl = document.getElementById("cluster-donut-legend-toggle");
    if (cdLegendToggleEl) {
      cdLegendToggleEl.addEventListener("change", function () {
        _store.clusterDonutLegend = cdLegendToggleEl.checked;
        liveUpdate();
      });
    }

    // ── Pie / donut legend toggle ──
    var pieLegendToggleEl = document.getElementById("pie-legend-toggle");
    if (pieLegendToggleEl) {
      pieLegendToggleEl.addEventListener("change", function () {
        _store.pieLegend = pieLegendToggleEl.checked;
        liveUpdate();
      });
    }

    // ── Donut hole size ──
    if (donutHoleSlider) {
      donutHoleSlider.addEventListener("input", function () {
        var val = parseInt(donutHoleSlider.value, 10) || 60;
        donutHoleDisplay.textContent = val + "%";
        _store.donutHole = val;
        liveUpdate();
      });
    }

    // ── Sankey sliders ──
    if (sankeyNodeWidthSlider) {
      sankeyNodeWidthSlider.addEventListener("input", function () {
        var val = parseInt(sankeyNodeWidthSlider.value, 10) || 20;
        sankeyNodeWidthDisplay.textContent = val;
        _store.sankeyNodeWidth = val;
        if (sankeyAutoDefaultsCheckbox) sankeyAutoDefaultsCheckbox.checked = false;
        liveUpdate();
      });
    }
    if (sankeyNodePaddingSlider) {
      sankeyNodePaddingSlider.addEventListener("input", function () {
        var val = parseInt(sankeyNodePaddingSlider.value, 10) || 15;
        sankeyNodePaddingDisplay.textContent = val;
        _store.sankeyNodePadding = val;
        if (sankeyAutoDefaultsCheckbox) sankeyAutoDefaultsCheckbox.checked = false;
        liveUpdate();
      });
    }
    if (sankeyLinkOpacitySlider) {
      sankeyLinkOpacitySlider.addEventListener("input", function () {
        var val = parseInt(sankeyLinkOpacitySlider.value, 10) || 40;
        sankeyLinkOpacityDisplay.textContent = val + "%";
        _store.sankeyLinkOpacity = val / 100;
        if (sankeyAutoDefaultsCheckbox) sankeyAutoDefaultsCheckbox.checked = false;
        liveUpdate();
      });
    }

    // Sankey reset to defaults
    if (sankeyAutoDefaultsCheckbox) {
      sankeyAutoDefaultsCheckbox.addEventListener("change", function () {
        if (sankeyAutoDefaultsCheckbox.checked) {
          sankeyNodeWidthSlider.value = 20;
          sankeyNodeWidthDisplay.textContent = "20";
          _store.sankeyNodeWidth = 20;
          sankeyNodePaddingSlider.value = 15;
          sankeyNodePaddingDisplay.textContent = "15";
          _store.sankeyNodePadding = 15;
          sankeyLinkOpacitySlider.value = 40;
          sankeyLinkOpacityDisplay.textContent = "40%";
          _store.sankeyLinkOpacity = 0.4;
          liveUpdate();
        }
      });
    }

    if (sankeyLabelModeSelect) {
      sankeyLabelModeSelect.addEventListener("change", function () {
        _store.sankeyLabelMode = sankeyLabelModeSelect.value;
        liveUpdate();
      });
    }

    if (sankeyNodeModeSelect) {
      sankeyNodeModeSelect.addEventListener("change", function () {
        _store.sankeyNodeMode = sankeyNodeModeSelect.value;
        liveUpdate();
      });
    }

    // ── Scale (axis max) ──
    if (axisMaxInput) {
      // Commit on blur (so the user can finish typing "2.5M" before
      // we parse it) and on Enter. Live update whenever we commit.
      var commitAxisMax = function () {
        var parsed = parseAxisMax(axisMaxInput.value);
        _store.axisMax = parsed;
        // Reformat so the field shows the canonical shape (e.g. "2.5M"
        // instead of "2500000"). Leave blank alone.
        axisMaxInput.value = parsed == null ? "" : formatAxisMax(parsed);
        liveUpdate();
      };
      axisMaxInput.addEventListener("blur", commitAxisMax);
      axisMaxInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          axisMaxInput.blur();
        }
      });
    }
    if (axisMaxReset) {
      axisMaxReset.addEventListener("click", function () {
        _store.axisMax = null;
        if (axisMaxInput) axisMaxInput.value = "";
        liveUpdate();
      });
    }

    // ── Hide zero-value labels ──
    if (hideZeroCheck) {
      hideZeroCheck.addEventListener("change", function () {
        _store.hideZeroLabels = hideZeroCheck.checked;
        liveUpdate();
      });
    }

    // ── Bubble separation ──
    if (bubbleSeparationAuto) {
      bubbleSeparationAuto.addEventListener("change", function () {
        if (this.checked) {
          _store.bubbleSeparation = 0;
          bubbleSeparationSlider.value = 0;
          syncBubbleSeparationUI();
          liveUpdate();
        } else {
          syncBubbleSeparationUI();
        }
      });
    }
    if (bubbleSeparationSlider) {
      bubbleSeparationSlider.addEventListener("input", function () {
        var val = parseInt(bubbleSeparationSlider.value, 10) || 0;
        _store.bubbleSeparation = val;
        if (bubbleSeparationAuto) bubbleSeparationAuto.checked = (val === 0);
        bubbleSeparationDisplay.textContent = val === 0 ? "Auto" : val + "px";
        bubbleSeparationSlider.classList.toggle("auto-active", val === 0);
        liveUpdate();
      });
    }

    // ── Bubble orientation ──
    if (bubbleOrientBtns) {
      for (var bo = 0; bo < bubbleOrientBtns.length; bo++) {
        bubbleOrientBtns[bo].addEventListener("click", (function (btn) {
          return function () {
            var orient = btn.getAttribute("data-orient");
            _store.bubbleOrientation = orient;
            for (var k = 0; k < bubbleOrientBtns.length; k++) {
              bubbleOrientBtns[k].classList.remove("active");
            }
            btn.classList.add("active");
            liveUpdate();
          };
        })(bubbleOrientBtns[bo]));
      }
    }

    // ── Timeline orientation ──
    if (timelineOrientBtns) {
      for (var to = 0; to < timelineOrientBtns.length; to++) {
        timelineOrientBtns[to].addEventListener("click", (function (btn) {
          return function () {
            var orient = btn.getAttribute("data-orient");
            _store.timelineOrientation = orient;
            for (var tk = 0; tk < timelineOrientBtns.length; tk++) {
              timelineOrientBtns[tk].classList.remove("active");
            }
            btn.classList.add("active");
            // Toggle visibility of spacing slider — vertical doesn't use it.
            if (timelineSpacingSection) {
              timelineSpacingSection.style.display = (orient === "horizontal") ? "block" : "none";
            }
            liveUpdate();
          };
        })(timelineOrientBtns[to]));
      }
    }

    // ── Cluster orientation ──
    if (clusterOrientBtns) {
      for (var co = 0; co < clusterOrientBtns.length; co++) {
        clusterOrientBtns[co].addEventListener("click", (function (btn) {
          return function () {
            var orient = btn.getAttribute("data-orient");
            _store.clusterOrientation = orient;
            for (var ck = 0; ck < clusterOrientBtns.length; ck++) {
              clusterOrientBtns[ck].classList.remove("active");
            }
            btn.classList.add("active");
            liveUpdate();
          };
        })(clusterOrientBtns[co]));
      }
    }

    // ── Timeline event spacing ──
    if (timelineSpacingSlider) {
      timelineSpacingSlider.addEventListener("input", function () {
        var val = parseInt(timelineSpacingSlider.value, 10) || TIMELINE_SPACING_DEFAULT;
        _store.timelineEventSpacing = val;
        if (timelineSpacingDisplay) timelineSpacingDisplay.textContent = val + "px";
        liveUpdate();
      });
    }
    if (timelineSpacingReset) {
      timelineSpacingReset.addEventListener("click", function () {
        _store.timelineEventSpacing = TIMELINE_SPACING_DEFAULT;
        if (timelineSpacingSlider) timelineSpacingSlider.value = TIMELINE_SPACING_DEFAULT;
        if (timelineSpacingDisplay) timelineSpacingDisplay.textContent = TIMELINE_SPACING_DEFAULT + "px";
        liveUpdate();
      });
    }
    var tlCompactBindEl = document.getElementById("timeline-compact-arcs");
    if (tlCompactBindEl) {
      tlCompactBindEl.addEventListener("change", function () {
        _store.timelineCompactArcs = tlCompactBindEl.checked;
        liveUpdate();
      });
    }
    // Row gap slider — always represents an explicit px value, no
    // "auto" mode. Default 30, range 14-80. Lets the user trade
    // visual breathing room against vertical chart height directly.
    var tlRowGapSliderEl = document.getElementById("timeline-rowgap-slider");
    var tlRowGapDisplayEl = document.getElementById("timeline-rowgap-display");
    var tlRowGapResetEl = document.getElementById("timeline-rowgap-reset");
    if (tlRowGapSliderEl) {
      tlRowGapSliderEl.addEventListener("input", function () {
        var v = parseInt(tlRowGapSliderEl.value, 10) || 30;
        _store.timelineRowGap = v;
        if (tlRowGapDisplayEl) tlRowGapDisplayEl.textContent = v + "px";
        liveUpdate();
      });
    }
    if (tlRowGapResetEl) {
      tlRowGapResetEl.addEventListener("click", function () {
        _store.timelineRowGap = 30;
        if (tlRowGapSliderEl) tlRowGapSliderEl.value = 30;
        if (tlRowGapDisplayEl) tlRowGapDisplayEl.textContent = "30px";
        liveUpdate();
      });
    }

    // ── Pie/Donut label controls ──
    if (pieLabelModeSelect) {
      pieLabelModeSelect.addEventListener("change", function () {
        _store.pieLabelMode = pieLabelModeSelect.value;
        liveUpdate();
      });
    }
    if (pieLabelContentSelect) {
      pieLabelContentSelect.addEventListener("change", function () {
        _store.pieLabelContent = pieLabelContentSelect.value;
        liveUpdate();
      });
    }
    if (leaderLinesCheck) {
      leaderLinesCheck.addEventListener("change", function () {
        _store.pieLeaderLines = leaderLinesCheck.checked;
        liveUpdate();
      });
    }
    if (pieLabelDistanceSlider) {
      pieLabelDistanceSlider.addEventListener("input", function () {
        var val = parseInt(pieLabelDistanceSlider.value, 10) || 24;
        _store.pieLabelDistance = val;
        if (pieLabelDistanceDisplay) pieLabelDistanceDisplay.textContent = val + "px";
        liveUpdate();
      });
    }

    // ── Bar/Column value labels ──
    if (barLabelModeSelect) {
      barLabelModeSelect.addEventListener("change", function () {
        _store.barLabelMode = barLabelModeSelect.value;
        liveUpdate();
      });
    }

    // ── Value format ──
    function onValueFormatChange() {
      _store.numberFormat = numberFormatSelect.value;
      _store.valuePrefix = valuePrefixInput.value;
      _store.valueSuffix = valueSuffixInput.value;
      liveUpdate();
    }
    if (numberFormatSelect) numberFormatSelect.addEventListener("change", onValueFormatChange);
    if (valuePrefixInput) valuePrefixInput.addEventListener("input", onValueFormatChange);
    if (valueSuffixInput) valueSuffixInput.addEventListener("input", onValueFormatChange);

    // ── Auto-sort ──
    if (autoSortCheck) {
      autoSortCheck.addEventListener("change", function () {
        _store.autoSort = autoSortCheck.checked;
        liveUpdate();
      });
    }

    // ── Height slider (auto/manual) ──
    // Split input/change: preview on drag (generate only), AI update on release (schedule)
    // Helper: format the height slider display ("+50", "-25", "0")
    function fmtHeight(val) {
      if (val === 0) return "0";
      return val > 0 ? "+" + val : String(val);
    }

    if (heightAutoCheck) {
      heightAutoCheck.addEventListener("change", function () {
        if (this.checked) {
          _store.verticalPadding = 0;
          // Also release a fixed pixel height (set by dragging the chart on
          // the artboard) — Auto must always return to content-driven height.
          _store.chartHeight = 0;
          heightSlider.classList.add("auto-active");
          heightDisplay.textContent = "Auto";
        } else {
          var val = parseInt(heightSlider.value, 10) || 0;
          _store.verticalPadding = val;
          heightSlider.classList.remove("auto-active");
          heightDisplay.textContent = fmtHeight(val);
        }
        liveUpdate();
      });
    }
    if (heightSlider) {
      heightSlider.addEventListener("input", function () {
        if (heightAutoCheck.checked) {
          heightAutoCheck.checked = false;
          heightSlider.classList.remove("auto-active");
        }
        var val = parseInt(heightSlider.value, 10) || 0;
        _store.verticalPadding = val;
        // The slider takes over from a drag-fixed pixel height (if any) —
        // otherwise moving it would appear to do nothing.
        _store.chartHeight = 0;
        heightDisplay.textContent = fmtHeight(val);
        if (_store.hasData()) _generate();
      });
      heightSlider.addEventListener("change", function () {
        _schedule();
      });
    }

    // ── Bar thickness slider (auto/manual) ──
    if (barThicknessAutoCheck) {
      barThicknessAutoCheck.addEventListener("change", function () {
        if (this.checked) {
          _store.barThickness = 0;
          barThicknessSlider.classList.add("auto-active");
          barThicknessDisplay.textContent = "Auto";
        } else {
          var val = parseInt(barThicknessSlider.value, 10) || 0;
          _store.barThickness = val;
          barThicknessSlider.classList.remove("auto-active");
          barThicknessDisplay.textContent = val + "px";
        }
        liveUpdate();
      });
    }
    if (barThicknessSlider) {
      barThicknessSlider.addEventListener("input", function () {
        if (barThicknessAutoCheck.checked) {
          barThicknessAutoCheck.checked = false;
          barThicknessSlider.classList.remove("auto-active");
        }
        var val = parseInt(barThicknessSlider.value, 10) || 0;
        _store.barThickness = val;
        barThicknessDisplay.textContent = val + "px";
        if (_store.hasData()) _generate();
      });
      barThicknessSlider.addEventListener("change", function () {
        _schedule();
      });
    }

    // ── Bar spacing slider (auto/manual) ──
    if (barSpacingAutoCheck) {
      barSpacingAutoCheck.addEventListener("change", function () {
        if (this.checked) {
          _store.barSpacing = 0;
          barSpacingSlider.classList.add("auto-active");
          barSpacingDisplay.textContent = "Auto";
        } else {
          var val = parseInt(barSpacingSlider.value, 10) || 0;
          _store.barSpacing = val;
          barSpacingSlider.classList.remove("auto-active");
          barSpacingDisplay.textContent = val + "px";
        }
        liveUpdate();
      });
    }
    if (barSpacingSlider) {
      barSpacingSlider.addEventListener("input", function () {
        if (barSpacingAutoCheck.checked) {
          barSpacingAutoCheck.checked = false;
          barSpacingSlider.classList.remove("auto-active");
        }
        var val = parseInt(barSpacingSlider.value, 10) || 0;
        _store.barSpacing = val;
        barSpacingDisplay.textContent = val + "px";
        if (_store.hasData()) _generate();
      });
      barSpacingSlider.addEventListener("change", function () {
        _schedule();
      });
    }

    // ── Text scale slider ──
    if (textScaleSlider) {
      textScaleSlider.addEventListener("input", function () {
        var val = parseInt(textScaleSlider.value, 10) || 100;
        textScaleDisplay.textContent = val + "%";
        _store.textScale = val;
        liveUpdate();
      });
    }

    // ── Label scale slider ──
    if (labelScaleSlider) {
      labelScaleSlider.addEventListener("input", function () {
        var val = parseInt(labelScaleSlider.value, 10) || 100;
        labelScaleDisplay.textContent = val + "%";
        _store.labelScale = val;
        liveUpdate();
      });
    }

    // ── Header / footer text width ─────────────────────────
    // Two sliders on the Text tab that narrow the wrap zone for
    // title-block text and footer text without moving the left
    // anchor. Default 100% = full chart width (matches what every
    // chart did before this control existed). Range 30-100%.
    var hdrTwSlider  = document.getElementById("header-text-width-slider");
    var hdrTwDisplay = document.getElementById("header-text-width-display");
    var hdrTwReset   = document.getElementById("header-text-width-reset");
    var ftrTwSlider  = document.getElementById("footer-text-width-slider");
    var ftrTwDisplay = document.getElementById("footer-text-width-display");
    var ftrTwReset   = document.getElementById("footer-text-width-reset");
    if (hdrTwSlider) {
      hdrTwSlider.addEventListener("input", function () {
        var v = parseInt(hdrTwSlider.value, 10) || 100;
        _store.headerTextWidth = v;
        if (hdrTwDisplay) hdrTwDisplay.textContent = v + "%";
        liveUpdate();
      });
    }
    if (hdrTwReset) {
      hdrTwReset.addEventListener("click", function () {
        _store.headerTextWidth = 100;
        if (hdrTwSlider) hdrTwSlider.value = 100;
        if (hdrTwDisplay) hdrTwDisplay.textContent = "100%";
        liveUpdate();
      });
    }
    if (ftrTwSlider) {
      ftrTwSlider.addEventListener("input", function () {
        var v = parseInt(ftrTwSlider.value, 10) || 100;
        _store.footerTextWidth = v;
        if (ftrTwDisplay) ftrTwDisplay.textContent = v + "%";
        liveUpdate();
      });
    }
    if (ftrTwReset) {
      ftrTwReset.addEventListener("click", function () {
        _store.footerTextWidth = 100;
        if (ftrTwSlider) ftrTwSlider.value = 100;
        if (ftrTwDisplay) ftrTwDisplay.textContent = "100%";
        liveUpdate();
      });
    }
  }

  // ── Init ───────────────────────────────────────────────

  function init(deps) {
    _store          = deps.store;
    _generate       = deps.generate;
    _schedule       = deps.schedule;
    _readLineLabelBg = deps.readLineLabelBg;

    // Resolve DOM refs
    lineOptionsSection      = document.getElementById("line-options-section");
    shadeCheck              = document.getElementById("shade-check");
    lineShowDotsCheck       = document.getElementById("line-show-dots");
    lineDotSizeSlider       = document.getElementById("line-dot-size");
    lineDotSizeDisplay      = document.getElementById("line-dot-size-display");
    lineDotSizeRow          = document.getElementById("line-dot-size-row");
    lineLabelPosSelect      = document.getElementById("line-label-pos");
    lineValueLabelsCheck    = document.getElementById("line-value-labels");
    lineShowYAxisCheck      = document.getElementById("line-show-yaxis");
    lineIndepScaleCheck     = document.getElementById("line-indep-scale");
    lineIndepScaleRow       = document.getElementById("line-indep-scale-row");
    lineEndLabelsCheck      = document.getElementById("line-end-labels");
    lineEndLabelsRow        = document.getElementById("line-end-labels-row");
    lineLegendCheck         = document.getElementById("line-legend");
    lineLegendRow           = document.getElementById("line-legend-row");
    lineLabelTableGroup     = document.getElementById("line-label-table-group");
    lineLabelTable          = document.getElementById("line-label-table");
    lineLabelsAll           = document.getElementById("line-labels-all");
    lineLabelsNone          = document.getElementById("line-labels-none");

    donutCenterSection      = document.getElementById("donut-center-section");
    donutCenterTitleInput   = document.getElementById("donut-center-title");
    donutCenterLabelInput   = document.getElementById("donut-center-label");
    donutCenterAutoCheck    = document.getElementById("donut-center-auto");
    donutHoleSection        = document.getElementById("donut-hole-section");
    donutHoleSlider         = document.getElementById("donut-hole-slider");
    donutHoleDisplay        = document.getElementById("donut-hole-display");

    sankeyOptionsSection    = document.getElementById("sankey-options-section");
    sankeyNodeWidthSlider   = document.getElementById("sankey-node-width");
    sankeyNodeWidthDisplay  = document.getElementById("sankey-node-width-display");
    sankeyNodePaddingSlider = document.getElementById("sankey-node-padding");
    sankeyNodePaddingDisplay = document.getElementById("sankey-node-padding-display");
    sankeyLinkOpacitySlider = document.getElementById("sankey-link-opacity");
    sankeyLinkOpacityDisplay = document.getElementById("sankey-link-opacity-display");
    sankeyLabelModeSelect   = document.getElementById("sankey-label-mode");
    sankeyNodeModeSelect    = document.getElementById("sankey-node-mode");
    sankeyAutoDefaultsCheckbox = document.getElementById("sankey-auto-defaults");

    bubbleOrientation       = document.getElementById("bubble-orientation");
    bubbleOrientBtns        = bubbleOrientation ? bubbleOrientation.querySelectorAll(".toggle-btn") : [];

    timelineOrientation     = document.getElementById("timeline-orientation");
    timelineOrientBtns      = timelineOrientation ? timelineOrientation.querySelectorAll(".toggle-btn") : [];
    timelineSpacingSection  = document.getElementById("timeline-spacing-section");
    timelineSpacingSlider   = document.getElementById("timeline-spacing-slider");
    timelineSpacingDisplay  = document.getElementById("timeline-spacing-display");
    timelineSpacingReset    = document.getElementById("timeline-spacing-reset");

    clusterOrientation      = document.getElementById("cluster-orientation");
    clusterOrientBtns       = clusterOrientation ? clusterOrientation.querySelectorAll(".toggle-btn") : [];
    bubbleSeparationSection = document.getElementById("bubble-separation-section");
    bubbleSeparationSlider  = document.getElementById("bubble-separation-slider");
    bubbleSeparationDisplay = document.getElementById("bubble-separation-display");
    bubbleSeparationAuto    = document.getElementById("bubble-separation-auto");

    pieLabelSection         = document.getElementById("pie-label-section");
    pieLabelModeSelect      = document.getElementById("pie-label-mode");
    pieLabelContentSelect   = document.getElementById("pie-label-content");
    leaderLinesCheck        = document.getElementById("leader-lines-check");
    pieLabelDistanceSlider  = document.getElementById("pie-label-distance");
    pieLabelDistanceDisplay = document.getElementById("pie-label-distance-display");

    barLabelSection         = document.getElementById("bar-label-section");
    barLabelModeSelect      = document.getElementById("bar-label-mode");

    numberFormatSelect      = document.getElementById("number-format");
    valuePrefixInput        = document.getElementById("value-prefix");
    valueSuffixInput        = document.getElementById("value-suffix");

    autoSortCheck           = document.getElementById("auto-sort-check");
    autoSortOption          = document.getElementById("auto-sort-option");

    scaleSection            = document.getElementById("scale-section");
    axisMaxInput            = document.getElementById("axis-max-input");
    axisMaxReset            = document.getElementById("axis-max-reset");

    hideZeroSection         = document.getElementById("hide-zero-section");
    hideZeroCheck           = document.getElementById("hide-zero-labels");

    heightSlider            = document.getElementById("height-slider");
    heightDisplay           = document.getElementById("height-display");
    heightAutoCheck         = document.getElementById("height-auto");

    barThicknessSection     = document.getElementById("bar-thickness-section");
    barThicknessSlider      = document.getElementById("bar-thickness-slider");
    barThicknessDisplay     = document.getElementById("bar-thickness-display");
    barThicknessAutoCheck   = document.getElementById("bar-thickness-auto");

    barSpacingSection       = document.getElementById("bar-spacing-section");
    barSpacingSlider        = document.getElementById("bar-spacing-slider");
    barSpacingDisplay       = document.getElementById("bar-spacing-display");
    barSpacingAutoCheck     = document.getElementById("bar-spacing-auto");

    textScaleSlider         = document.getElementById("text-scale-slider");
    textScaleDisplay        = document.getElementById("text-scale-display");
    labelScaleSlider        = document.getElementById("label-scale-slider");
    labelScaleDisplay       = document.getElementById("label-scale-display");

    bindEvents();
  }

  // ── Public API ─────────────────────────────────────────

  return {
    init:             init,
    updateVisibility: updateVisibility,
    syncToUI:         syncToUI,
    syncFromUI:       syncFromUI
  };
})();
