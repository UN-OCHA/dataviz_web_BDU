/**
 * Chart Builder — builds chart config, validates data, resolves icons,
 * and calls ChartRegistry.render().
 *
 * Returns the SVG string (or null when data is missing / invalid).
 *
 * init(deps) dependencies:
 *   store           – DataStore
 *   showStatus      – function(msg, type, html)
 *   clearStatus     – function(forceAll)
 *   onSankeyLoad    – function(type) — loads sankey sample and refreshes
 *   onKfLoad        – function() — loads KF sample and refreshes
 *   getIconPalette  – function() → [hex, …]
 *   getSwatches     – function() → [{hex}, …]
 *   assetFlagsDir   – string path
 *   assetIconsDir   – string path
 */

/* global ChartRegistry, SvgInlineUtils */

var ChartBuilder = (function () {
  "use strict";

  // ── Private references (set by init) ─────────────────

  var _store;
  var _showStatus;
  var _clearStatus;
  var _onSankeyLoad;
  var _onKfLoad;
  var _onTimelineLoad;
  var _getIconPalette;
  var _getSwatches;
  var _assetFlagsDir;
  var _assetIconsDir;

  // ── Constants ────────────────────────────────────────

  var MULTI_VALUE_TYPES = {
    "stacked-bar": true,
    "stacked-col": true,
    "icon": true,
    "cluster": true,
    "cluster-donut": true
  };

  var ICON_COL_TYPES = {
    "hbar": true,
    "vbar": true,
    "stacked-bar": true,
    "stacked-col": true,
    "table": true,
    "keyfigures": true
  };

  // ── Data validation & selection ──────────────────────

  function getData(chartType) {
    var isMulti = MULTI_VALUE_TYPES[chartType];

    if (chartType === "sankey") {
      if (_store.headers && _store.headers.length < 3) {
        if (!document.getElementById("load-sankey-2")) {
          _showStatus(
            'Sankey needs 3 columns (Source, Target, Value) — or alternating step and value columns (Source, Value, Intermediate, Value, Target) for multi-level flows. Load sample: ' +
            '<a href="#" id="load-sankey-2" style="color:inherit;text-decoration:underline;">2-level</a> · ' +
            '<a href="#" id="load-sankey-3" style="color:inherit;text-decoration:underline;">3-level</a>',
            "error", true
          );
          _bindSankeyLink("load-sankey-2", "sankey-2");
          _bindSankeyLink("load-sankey-3", "sankey-3");
        }
        return null;
      }
      var sankeyData = _store.toSankeyData();
      if (!sankeyData || !sankeyData.length) {
        if (!document.getElementById("load-sankey-2b")) {
          _showStatus(
            'Sankey data needs numeric values in its Value column(s). Load sample: ' +
            '<a href="#" id="load-sankey-2b" style="color:inherit;text-decoration:underline;">2-level</a> · ' +
            '<a href="#" id="load-sankey-3b" style="color:inherit;text-decoration:underline;">3-level</a>',
            "error", true
          );
          _bindSankeyLink("load-sankey-2b", "sankey-2");
          _bindSankeyLink("load-sankey-3b", "sankey-3");
        }
        return null;
      }
      return sankeyData;
    }

    if (chartType === "keyfigures") {
      if (_store.headers && _store.headers.length < 3) {
        if (!document.getElementById("load-kf-sample")) {
          _showStatus(
            'Key Figures needs 3 columns: Figure, Heading, Body. ' +
            '<a href="#" id="load-kf-sample" style="color:inherit;text-decoration:underline;">Load sample data</a>',
            "error", true
          );
          var kfLink = document.getElementById("load-kf-sample");
          if (kfLink) kfLink.addEventListener("click", function (e) {
            e.preventDefault();
            _onKfLoad();
          });
        }
        return null;
      }
      var kfData = _store.toKeyFiguresData();
      if (!kfData || !kfData.length) {
        if (!document.getElementById("load-kf-sample")) {
          _showStatus(
            'Key Figures data not valid. Check your columns (Figure, Heading, Body). ' +
            '<a href="#" id="load-kf-sample" style="color:inherit;text-decoration:underline;">Load sample data</a>',
            "error", true
          );
          var kfLink2 = document.getElementById("load-kf-sample");
          if (kfLink2) kfLink2.addEventListener("click", function (e) {
            e.preventDefault();
            _onKfLoad();
          });
        }
        return null;
      }
      return kfData;
    }

    if (chartType === "timeline") {
      // Schema accepted: a Date column plus at least one of Label or
      // Description. All three is the default template, but 2-col
      // grids work too (Date + Label, or Date + Description).
      var headers = (_store.headers || []).map(function (h) {
        return String(h == null ? "" : h).trim().toLowerCase();
      });
      var hasDate = headers.indexOf("date") !== -1;
      var hasLabel = headers.indexOf("label") !== -1;
      var hasDesc = headers.indexOf("description") !== -1;
      var badSchema = !hasDate || (!hasLabel && !hasDesc);

      var tlData = badSchema ? [] : _store.toTimelineData();

      if (badSchema || !tlData || !tlData.length) {
        var msg = badSchema
          ? 'Timeline needs a Date column and at least one of Label or Description. '
          : 'Each timeline row needs a Date and at least one of Label or Description. ';
        // Always re-show + re-bind so the link survives any force-clear path.
        _showStatus(
          msg +
          '<a href="#" id="load-timeline-sample" style="color:inherit;text-decoration:underline;">Load sample data</a>',
          "error", true, true
        );
        var tlLink = document.getElementById("load-timeline-sample");
        if (tlLink) tlLink.addEventListener("click", function (e) {
          e.preventDefault();
          if (typeof _onTimelineLoad === "function") _onTimelineLoad();
        });
        return null;
      }
      return tlData;
    }

    if (chartType === "table") {
      // Tables don't use the label/value abstraction at all — the table
      // renderer reads `DataStore.headers` and `DataStore.rows` directly
      // (see chart-table.js). getData's only remaining job here is to
      // signal "there is data" via a non-empty array so the bail-on-
      // empty check at the top of render() doesn't short-circuit. We
      // return rows verbatim; the renderer ignores the structure.
      //
      // (Without this branch, "table" fell through to toChartData below,
      // which expects a numeric value column — causing every row to be
      // filtered out when the second column is text like "WFP" / "WHO",
      // and the chart silently produced no SVG. Hit during batch import
      // of the cluster status board.)
      var tableRows = _store.rows || [];
      return tableRows.length ? tableRows : null;
    }

    // Line and small-multiple lines: multi-series, but the X axis is an
    // ordered sequence — pass preserveOrder so points keep row order.
    if (chartType === "line" || chartType === "cluster-line") {
      return _store.toMultiValueData(true);
    }

    if (isMulti) {
      return _store.toMultiValueData();
    }

    return _store.toChartData();
  }

  function _bindSankeyLink(id, type) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("click", function (e) {
      e.preventDefault();
      _onSankeyLoad(type);
    });
  }

  // ── Config builder ───────────────────────────────────

  function buildConfig() {
    return {
      width: _store.chartWidth || 500,
      height: _store.chartHeight || 0,
      colors: _store.colors || null,
      barThickness: _store.barThickness || 0,
      barSpacing: _store.barSpacing || 0,
      verticalPadding: _store.verticalPadding || 0,
      style: _store.style || "ocha",
      subtitle: _store.chartSubtitle || "",
      comments: _store.chartComments || "",
      footer: _store.chartFooter || "",
      shade: !!_store.shade,
      lineShowDots: _store.lineShowDots !== false,
      lineDotSize: _store.lineDotSize != null ? _store.lineDotSize : 4,
      lineLabelPos: _store.lineLabelPos || "auto",
      lineLabelBg: _store.lineLabelBg || "none",
      lineValueLabels: _store.lineValueLabels !== false,
      lineSeriesEndLabels: _store.lineSeriesEndLabels !== false,
      lineLegend: !!_store.lineLegend,
      lineShowYAxis: !!_store.lineShowYAxis,
      lineHiddenLabels: _store.lineHiddenLabels || [],
      bubbleOrientation: _store.bubbleOrientation || "horizontal",
      timelineOrientation: _store.timelineOrientation || "horizontal",
      timelineEventSpacing: _store.timelineEventSpacing || 90,
      timelineCategoryColors: _store.timelineCategoryColors || {},
      timelineLegend: _store.timelineLegend !== false,
      timelineCompactArcs: !!_store.timelineCompactArcs,
      clusterDonutLegend: _store.clusterDonutLegend !== false,
      clusterDonutCategoryColors: _store.clusterDonutCategoryColors || {},
      clusterLineColors: _store.clusterLineColors || {},
      clusterLineYAxis: _store.clusterLineYAxis !== false,
      clusterLineValueLabels: !!_store.clusterLineValueLabels,
      clusterLineIndependentScale: !!_store.clusterLineIndependentScale,
      sliceColors: _store.sliceColors || {},
      pieLegend: !!_store.pieLegend,
      headerTextWidth: _store.headerTextWidth || 100,
      footerTextWidth: _store.footerTextWidth || 100,
      timelineRowGap: _store.timelineRowGap || 0,
      clusterOrientation: _store.clusterOrientation || "horizontal",
      bubbleSeparation: _store.bubbleSeparation || 0,
      donutCenterTitle: _store.donutCenterTitle || "",
      donutCenterLabel: _store.donutCenterLabel || "",
      donutHole: _store.donutHole != null ? _store.donutHole : 60,
      pieLabelMode: _store.pieLabelMode || "auto",
      pieLabelContent: _store.pieLabelContent || "label-pct",
      pieLeaderLines: _store.pieLeaderLines !== false,
      pieLabelDistance: _store.pieLabelDistance != null ? _store.pieLabelDistance : 24,
      barLabelMode: _store.barLabelMode || "outside",
      stackedStroke: _store.stackedStroke,
      stackedStrokeWidth: _store.stackedStrokeWidth || 2,
      stackedStrokeColor: _store.stackedStrokeColor || "#FFFFFF",
      stackedLegend: !!_store.stackedLegend,
      // Fixed axis maximum (null = auto). Used by hbar/vbar/stacked-*/
      // cluster/line/bubble to anchor the scale so two charts can be
      // made directly comparable by typing the same number in both.
      axisMax: (_store.axisMax != null && _store.axisMax > 0) ? _store.axisMax : null,
      hideZeroLabels: !!_store.hideZeroLabels,
      // Series names for the legend — pulled from the grid column headers.
      // valueCols is the ordered list of value-column indexes used by
      // stacked/bubble renderers. If valueCols isn't set, we fall back to
      // every column except the label column.
      seriesNames: (function () {
        var cols = _store.valueCols;
        if (!cols || !cols.length) {
          cols = [];
          for (var i = 0; i < _store.headers.length; i++) {
            if (i !== _store.labelCol) cols.push(i);
          }
        }
        return cols.map(function (c) { return _store.headers[c] || ("Series " + (c + 1)); });
      })(),
      numberFormat: _store.numberFormat || "auto",
      valuePrefix: _store.valuePrefix || "",
      valueSuffix: _store.valueSuffix || "",
      iconShape: _store.iconShape || "people",
      iconSize: _store.iconSize || 20,
      iconLegendLabels: _store.iconLegendLabels || null,
      iconShowLegend: _store.iconShowLegend !== false,
      iconLegendLayout: _store.iconLegendLayout || "horizontal",
      autoSort: _store.autoSort !== false,
      labelColor: _store.labelColor || null,
      textScale: _store.textScale || 100,
      labelScale: _store.labelScale || 100,
      sankeyNodeWidth: _store.sankeyNodeWidth || 20,
      sankeyNodePadding: _store.sankeyNodePadding || 15,
      sankeyLinkOpacity: _store.sankeyLinkOpacity != null ? _store.sankeyLinkOpacity : 0.4,
      sankeyLabelMode: _store.sankeyLabelMode || "both",
      // A multi-level grid (one column per step, >3 columns) declares the
      // chain explicitly — toSankeyData emits chained links (Health is a
      // target in one and a source in the next), which need "connect" or
      // the renderer splits the repeated label into two nodes. The user's
      // "Repeated labels" choice only applies to the classic 3-column
      // layout, where the intent is genuinely ambiguous.
      sankeyNodeMode: (_store.headers && _store.headers.length > 3)
        ? "connect"
        : (_store.sankeyNodeMode || "auto"),
      // Key Figures
      kfAutoCols: _store.kfAutoCols !== false,
      kfMaxCols: _store.kfMaxCols || 3,
      kfAutoWidth: _store.kfAutoWidth !== false,
      kfColWidth: _store.kfColWidth || 150,
      iconPosition: _store.kfIconPosition || "left",
      showSeparators: _store.kfShowSeparators !== false,
      unitPaddingH: _store.kfPadH || 12,
      unitPaddingV: _store.kfPadV || 10,
      unitGap: _store.kfGap || 8,
      iconColor: _store.kfIconColor || "#009EDB",
      textColor: _store.kfTextColor || "#000000"
    };
  }

  // ── Icon / flag SVG resolution ───────────────────────

  // Row-icon colour: null/auto follows the chart — the user's first custom
  // colour if set, otherwise the active style's primary — so icons recolour
  // with the bars when the style (OCHA / HNRP / Flash / GHO) changes. An
  // explicit pick from the icon colour swatch always wins. Flags are never
  // tinted (real flag colours).
  function resolvedRowIconColor() {
    if (_store.rowIconColor) return _store.rowIconColor;
    if (_store.colors && _store.colors[0]) return _store.colors[0];
    var st = ChartRegistry.getStyle(_store.style || "ocha");
    return (st && st.colors && st.colors[0]) || "#009EDB";
  }

  function resolveIcons(chartType, data, config) {
    // Timeline: always resolve icons from per-row iconSelections (no column mapping needed).
    if (chartType === "timeline") {
      var hasTlIcon = false;
      for (var k = 0; k < data.length; k++) {
        if (data[k].iconRef) { hasTlIcon = true; break; }
      }
      if (!hasTlIcon) return;
      SvgInlineUtils.resolveDataIcons(data, "icons", _assetFlagsDir, _assetIconsDir);
      config.iconColType = "icons";
      config.rowIconColor = resolvedRowIconColor();
      return;
    }

    if (_store.iconColType === "none" || !ICON_COL_TYPES[chartType]) return;

    var hasAny = false;
    for (var i = 0; i < _store.iconSelections.length; i++) {
      if (_store.iconSelections[i]) { hasAny = true; break; }
    }
    if (!hasAny) return;

    config.iconColType = _store.iconColType;
    config.rowIconColor = resolvedRowIconColor();

    if (chartType !== "table") {
      SvgInlineUtils.resolveDataIcons(data, _store.iconColType, _assetFlagsDir, _assetIconsDir);
    } else {
      config.iconSelections = _store.iconSelections;
      var selMap = {};
      for (var s = 0; s < _store.iconSelections.length; s++) {
        var ref = _store.iconSelections[s];
        if (!ref || selMap[ref]) continue;
        if (_store.iconColType === "flags") {
          selMap[ref] = SvgInlineUtils.resolveFlag(ref, _assetFlagsDir);
        } else {
          selMap[ref] = SvgInlineUtils.resolveIcon(ref, _assetIconsDir);
        }
      }
      config.iconSvgMap = selMap;
    }
  }

  // ── Per-row / per-series color resolution ────────────

  function resolveColors(chartType, data, config) {
    if (chartType === "icon") {
      var rowIcons = [];
      var rowColors = [];
      var palette = _getIconPalette();
      for (var i = 0; i < data.length; i++) {
        var srcRow = data[i]._srcRow != null ? data[i]._srcRow : i;
        rowIcons.push((_store.iconShapes && _store.iconShapes[srcRow]) || config.iconShape || "people");
        rowColors.push((_store.iconColors && _store.iconColors[srcRow]) || palette[i % palette.length]);
      }
      config.rowIcons = rowIcons;
      config.colors = rowColors;
    } else if (chartType === "cluster-line") {
      // Small multiples default to a SINGLE colour. Leave config.colors
      // as the resolved style palette (so colors[0] = the style
      // primary) and do NOT apply the per-series iconColors array here —
      // per-panel overrides come from clusterLineColors instead.
      return;
    } else if (_store.iconColors) {
      config.colors = _store.iconColors.slice();
      var neededLen = (_store.valueCols && _store.valueCols.length) || 1;
      if (config.colors.length < neededLen) {
        var isStackType = (chartType === "stacked-bar" || chartType === "stacked-col" || chartType === "sankey");
        var extendPal = isStackType ? _getIconPalette() : _getSwatches().map(function (s) { return s.hex; });
        while (config.colors.length < neededLen) {
          config.colors.push(extendPal[config.colors.length % extendPal.length]);
        }
        _store.iconColors = config.colors.slice();
      }
    }
  }

  // ── Main render entry point ──────────────────────────

  /**
   * Build config, validate data, resolve icons/colors, render chart.
   * Returns SVG string or null.
   */
  function render() {
    var chartType = _store.chartType || "hbar";

    // Clear previous status
    // Non-force clear preserves persistent messages (those with clickable links)
    if (chartType === "pie" || chartType === "donut" || chartType === "sankey" || chartType === "keyfigures" || chartType === "timeline") {
      _clearStatus();
    } else {
      _clearStatus(true);
    }

    // Get and validate data
    var data = getData(chartType);
    if (!data || !data.length) {
      // Sankey, keyfigures, and timeline show their own specific errors with
      // sample links inside getData() — don't overwrite them with a generic message.
      if (_store.rows && _store.rows.length > 0 &&
          chartType !== "sankey" &&
          chartType !== "keyfigures" &&
          chartType !== "timeline") {
        _showStatus("Data doesn't have valid numeric values for this chart type. Check your data or load sample data.", "error");
      }
      return null;
    }

    // Pie/donut cap — persistent until user reduces rows or switches chart type
    if (chartType === "pie" || chartType === "donut") {
      if (data.length > 7) {
        _showStatus('Maximum 7 values for pie/donut. Reduce to 7 rows or switch to another chart type such as bar.', "error", false, true);
        return null;
      }
      // Data is valid now — force-clear any leftover persistent error
      _clearStatus(true);
    }

    // Sankey single-color override
    var config = buildConfig();
    if (chartType === "sankey" && _store.sankeyColorMode === "single" && _store.sankeySingleColor) {
      config.colors = [_store.sankeySingleColor];
    }

    resolveIcons(chartType, data, config);
    resolveColors(chartType, data, config);

    // For timelines with a Category column, refresh the design-panel
    // category-colour rows now that the data is loaded — picks up
    // edits to category names without needing a full chart-type
    // change.
    if (chartType === "timeline" && typeof ColorPickersUI !== "undefined" && ColorPickersUI.buildTimelineCategoryRows) {
      try { ColorPickersUI.buildTimelineCategoryRows(); } catch (e) { /* no-op */ }
    }
    // Per-slice colour swatches stay in sync with the data on every
    // render — labels can change as the user edits the grid.
    if ((chartType === "pie" || chartType === "donut") &&
        typeof ColorPickersUI !== "undefined" && ColorPickersUI.buildSliceColorRows) {
      try { ColorPickersUI.buildSliceColorRows(); } catch (e) { /* no-op */ }
    }
    if (chartType === "cluster-donut" &&
        typeof ColorPickersUI !== "undefined" && ColorPickersUI.buildClusterDonutCategoryRows) {
      try { ColorPickersUI.buildClusterDonutCategoryRows(); } catch (e) { /* no-op */ }
    }

    var title = _store.chartTitle || "";
    var svg = ChartRegistry.render(chartType, title, data, config);
    // ChartRegistry.takeWarnings() drains and resets the warning buffer
    // populated by renderers via pushWarning() during render. Stashed
    // here so the panel can read them after each render via
    // ChartBuilder.getWarnings(). Backwards-compatible: render() still
    // returns the SVG string as before.
    _lastWarnings = ChartRegistry.takeWarnings ? ChartRegistry.takeWarnings() : [];
    return svg;
  }

  // ── Public API ───────────────────────────────────────

  var _lastWarnings = [];

  function getWarnings() {
    return _lastWarnings;
  }

  function init(deps) {
    _store          = deps.store;
    _showStatus     = deps.showStatus;
    _clearStatus    = deps.clearStatus;
    _onSankeyLoad   = deps.onSankeyLoad;
    _onKfLoad       = deps.onKfLoad;
    _onTimelineLoad = deps.onTimelineLoad;
    _getIconPalette = deps.getIconPalette;
    _getSwatches    = deps.getSwatches;
    _assetFlagsDir  = deps.assetFlagsDir;
    _assetIconsDir  = deps.assetIconsDir;
  }

  return {
    init: init,
    render: render,
    getWarnings: getWarnings
  };

})();
