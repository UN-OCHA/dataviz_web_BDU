/**
 * DataStore — Central data model for Humanitarian DataViz Tool.
 * All input methods (paste, CSV upload, grid edit) write here.
 * The chart renderer reads from here via toChartData().
 */

/* global Papa */

var DataStore = (function () {
  "use strict";

  var store = {
    headers: ["Label", "Value"],
    rows: [],
    chartTitle: "",
    chartSubtitle: "",
    chartComments: "",
    chartFooter: "",
    chartType: "hbar",
    chartWidth: 500,
    chartHeight: 0, // 0 = auto
    barThickness: 0, // 0 = auto (breakpoint default)
    barSpacing: 0,   // 0 = auto. Otherwise px to put between columns
                     // (vbar / stacked-col / cluster-v) or between rows
                     // (hbar / stacked-bar / cluster-h). The renderer
                     // still grows the gap further when label widths
                     // would otherwise overlap, so this is a floor on
                     // the gap, not a hard cap.
    verticalPadding: 0, // 0–200 whitespace multiplier
    labelCol: 0,
    valueCol: 1,
    valueCols: null, // array for stacked/bubble charts (null = use valueCol)
    colors: null, // null = use style palette; array = user override
    labelColor: null, // null = style default; "#FFFFFF" = white; "#000000" = black
    textScale: 100, // 50–200 %; scales title, subtitle, comments, footer
    labelScale: 100, // 50–200 %; scales axis labels, values, legend
    style: "ocha", // "ocha" | "hnrp" | "flash" | "gho"
    shade: false, // line chart area fill
    lineShowDots: false, // show data point circles on line chart (OFF by default — cleaner; user can turn on)
    lineDotSize: 4, // data point radius in px (fixed, not scaled by chart width)
    lineLabelPos: "auto", // "auto" | "above" | "below"
    lineLabelBg: "none", // "none" | "white" | "black"
    lineValueLabels: true, // print each point's value (default on)
    lineSeriesEndLabels: true, // print series name at the end of each line (multi-series only)
    lineLegend: false, // show series legend above the plot (multi-series only)
    lineShowYAxis: false, // show gridded Y axis with tick values (default off → direct value labelling)
    lineHiddenLabels: [], // "row:series" keys whose value LABEL is hidden on the line chart (per-value-label table in Design tab)
    clusterLineColors: {}, // per-panel colour override for line small multiples, keyed by column header. Default empty → every panel uses the style primary (single colour); edit one to differentiate.
    clusterLineYAxis: true, // small multiples: show a Y axis on every panel (default ON — small panels read better with an axis than per-point labels)
    clusterLineValueLabels: false, // small multiples: print each point's value (default OFF — the per-panel Y axis carries the magnitude)
    clusterLineIndependentScale: false, // small multiples: each panel uses its own Y scale (default OFF = shared scale so panels are comparable). On = trend-reading; Y axis defaults off when this turns on.
    bubbleOrientation: "horizontal", // "horizontal" | "vertical"
    bubbleSeparation: 0, // -500 to 500: negative=overlap, 0=touching, positive=spacing
    timelineOrientation: "horizontal", // "horizontal" | "vertical"
    timelineEventSpacing: 90, // minimum column width per event (px). Controls auto-fold threshold.
    timelineCategoryColors: {}, // map of category name → hex; used to colour the dot fill per event when the data has a Category column. Empty default = auto-assign from palette in order of first appearance.
    timelineLegend: true, // show category legend above the timeline (only relevant when the data has a Category column).
    timelineCompactArcs: false, // when true, swap S-shape semicircle arcs for vertical dashed connectors so rows pack tighter.
    clusterDonutLegend: true, // show shared legend above the cluster donut grid (slice categories ↔ colour). Default on; user can untick from the design panel.
    clusterDonutCategoryColors: {}, // per-category colour override for cluster donut, keyed by series name. Default empty → primary brand colour (config.colors[0]) used for every category.
    sliceColors: {}, // per-slice colour override for pie/donut, keyed by slice label. Default empty → primary brand colour used for every slice.
    pieLegend: false, // show a legend strip above pie / donut. Default off — donut uses inside/outside slice labels (direct labelling) by default. User can flip on for legend-style display.
    headerTextWidth: 100, // width of the title / subtitle / comments wrapping zone, as a percentage of the chart width. Default 100 = full chart width. Slider in the Text tab lets the user narrow the wrap zone for tighter title columns.
    footerTextWidth: 100, // width of the footer wrapping zone, as a percentage of the chart width. Default 100 = full chart width.
    timelineRowGap: 30, // total px gap between S-shape rows. Reset → 30 (a roomy default that works for both compact and curved modes).
    clusterOrientation: "horizontal", // "horizontal" | "vertical" — for cluster (grouped) bars
    donutCenterTitle: "", // editable heading inside donut hole
    donutCenterLabel: "", // editable label inside donut hole
    donutCenterAuto: true, // when true and centerTitle/Label are empty, render the auto "Total + value" default; when false, leave the hole blank
    donutHole: 60, // inner circle size as % of outer radius (20–80)
    pieLabelMode: "auto", // "none" | "outside" | "inside" | "auto"
    pieLabelContent: "label-pct", // "pct" | "value" | "value-pct" | "label-pct" | "label-value" | "label-value-pct"
    pieLeaderLines: true, // show leader lines for outside labels
    pieLabelDistance: 24, // px between ring and label midpoint (outside mode)
    barLabelMode: "outside", // "outside" | "inside" | "total" | "none"
    stackedStroke: false, // enable stroke on stacked segments
    stackedStrokeWidth: 2, // stroke width in px
    stackedStrokeColor: "#FFFFFF", // stroke color
    stackedLegend: false, // show series legend above the chart (stacked only)
    // Axis max override — null = auto (nice-rounded to data max), number =
    // fixed maximum value used by the scale regardless of data. Lets the
    // user make two charts comparable (e.g. 2025 vs 2026) by typing the
    // same maximum in both. Applies to hbar/vbar/stacked-*/cluster/line/
    // bubble; irrelevant for pie/donut/timeline/etc.
    axisMax: null,
    // When true, value labels of "0" are suppressed across every chart
    // type that prints a numeric label per data point (bar, column,
    // cluster, line, bubble, stacked totals). Useful for comparison
    // charts where some categories are legitimately zero and a "0"
    // label on top of a blank spot adds visual noise.
    hideZeroLabels: false,
    numberFormat: "auto", // "auto" | "full" | "K" | "M" | "B"
    valuePrefix: "", // e.g. "US$ ", "€"
    valueSuffix: "", // e.g. "%", " units"
    autoSort: true, // auto-sort chart data largest→smallest
    iconShape: "people", // "people"|"man"|"woman"|"dot"|"square"|"{icon-id}"
    iconShapes: null, // null = use iconShape for all; array = per-series icon overrides
    iconSize: 20, // 12–48
    iconLegendLabels: null, // null = use column headers; array = custom labels
    iconColors: null, // null = use ICON_PALETTE; array = per-series color overrides
    iconShowLegend: true, // show/hide legend on icon chart
    iconLegendLayout: "horizontal", // "horizontal" | "vertical" | "grid"
    sankeyNodeWidth: 20, // 15–40: thickness of node bars
    sankeyNodePadding: 15, // 5–40: vertical gap between nodes
    sankeyLinkOpacity: 0.4, // 0.2–0.8: flow transparency
    sankeyLabelMode: "both", // "name" | "value" | "both" | "none"
    sankeyNodeMode: "auto", // how to treat a label that appears in BOTH the Source and Target columns. "auto"/"separate" = respect columns (default): the label becomes two nodes, one on the left (origin), one on the right (destination). "connect" = chain repeated labels into a multi-step flow (funding pipelines). See chart-sankey.js.
    source: null, // "paste" | "csv" | "xlsx" | "grid-edit" | "config"
    iconColType: "none", // "none" | "flags" | "icons"
    iconSelections: [], // parallel array to rows: ["AFG", "YEM", null, ...]
    rowIconColor: null, // null = auto: follow the chart (user colour override or style primary), so icons recolour when the style changes. Hex = explicit pick. Icons only — flags keep their real colours.
    sortCol: null, // column index currently sorted by, or null
    sortDir: null, // "asc" | "desc" | null
    onChange: null, // callback: function() {} — full re-render (grid + chart)
    onValueChange: null // callback: function() {} — chart-only update (cell edits)
  };

  // ── Notify ────────────────────────────────────────────

  function notify() {
    if (typeof store.onChange === "function") {
      store.onChange();
    }
  }

  // ── Loading Data ──────────────────────────────────────

  /**
   * Extract table data from an HTML string (e.g. clipboard text/html from
   * Excel or Word). Returns TSV string, or null if no <table> found.
   */
  function parseHtmlTable(html) {
    if (!html || html.indexOf("<t") === -1) return null;

    var doc = new DOMParser().parseFromString(html, "text/html");
    var table = doc.querySelector("table");
    if (!table) return null;

    var tsvRows = [];
    var rows = table.querySelectorAll("tr");
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll("th, td");
      var vals = [];
      for (var j = 0; j < cells.length; j++) {
        vals.push((cells[j].textContent || "").trim());
      }
      // Skip entirely empty rows
      if (vals.join("")) tsvRows.push(vals.join("\t"));
    }
    return tsvRows.length >= 2 ? tsvRows.join("\n") : null;
  }

  /**
   * Convert markdown / Word-style table to TSV so PapaParse can handle it.
   * Detects lines with | delimiters, strips them, skips separator rows.
   */
  function convertMarkdownTable(text) {
    var lines = text.split("\n");
    var mdCount = 0;
    for (var i = 0; i < lines.length; i++) {
      if (/^\|.*\|/.test(lines[i].trim())) mdCount++;
    }
    // At least 2 pipe-delimited lines to qualify as a markdown table
    if (mdCount < 2) return text;
    var rows = [];
    for (var j = 0; j < lines.length; j++) {
      var l = lines[j].trim();
      if (!l) continue;
      // Skip separator rows like |---|---|
      if (/^[\|\s\-:]+$/.test(l)) continue;
      // Strip leading/trailing pipes, split on |, trim cells
      var cells = l.replace(/^\|/, "").replace(/\|$/, "").split("|");
      for (var k = 0; k < cells.length; k++) cells[k] = cells[k].trim();
      rows.push(cells.join("\t"));
    }
    return rows.join("\n");
  }

  /**
   * Try to parse a string as a number, stripping thousand separators.
   * Handles: "1,234,567" → 1234567, "1,234.56" → 1234.56, "$1,200" → 1200
   * Returns the number if valid, or the original value if not numeric.
   */
  function parseNumeric(val) {
    if (typeof val === "number") return val;
    if (typeof val !== "string") return val;
    var s = val.trim();
    if (!s) return val;                       // empty stays as-is

    // Strip the decorations people paste from Excel / reports / web:
    // spaces (incl. non-breaking), currency symbols, and percent signs.
    // "45%" → 45, "$1,200" → 1200 (NOT 0.45 — a percentage column wants the
    // bar at 45, not 0.45). Anything left should be just digits, sign,
    // dot and comma.
    var c = s.replace(/[\s ]/g, "").replace(/[$€£¥%]/g, "");
    if (c === "" || c === "-" || c === "+") return val;   // only a symbol → keep text

    var hasComma = c.indexOf(",") >= 0;
    var hasDot = c.indexOf(".") >= 0;
    var normalized;

    if (hasComma && hasDot) {
      // Both separators present — the one that appears LAST is the decimal
      // point. "1,234.56" (US) → 1234.56 ; "1.234,56" (European) → 1234.56
      if (c.lastIndexOf(",") > c.lastIndexOf(".")) {
        normalized = c.replace(/\./g, "").replace(",", ".");
      } else {
        normalized = c.replace(/,/g, "");
      }
    } else if (hasComma) {
      // Only commas. Disambiguate by the digit-count rule (see below):
      //  - groups of exactly 3 → thousands separators → strip them
      //  - a single comma with <3 trailing digits → decimal comma → dot
      // Thousands grouping is ALWAYS 3-digit groups; "1,5" / "12,75" can't
      // be thousands, so the comma must be a decimal point. This is what
      // stops the old silent "1,5 → 15" corruption.
      if (/^[-+]?\d{1,3}(,\d{3})+$/.test(c)) {
        normalized = c.replace(/,/g, "");           // 1,234,567 → 1234567
      } else if (/^[-+]?\d+,\d+$/.test(c)) {
        normalized = c.replace(",", ".");           // 1,5 → 1.5
      } else {
        return val;                                 // garbled (e.g. "1,2,3") → keep text
      }
    } else {
      normalized = c;
    }

    var num = Number(normalized);
    return isNaN(num) ? val : num;
  }
  // Exposed so every data-entry path (typing, pasting, CSV load, AI import)
  // reads numbers the same way — one source of truth.
  store.coerceNumber = parseNumeric;

  /**
   * Count value cells that are filled in but couldn't be read as numbers
   * (e.g. "n/a", "TBD", "~5,000") for the CURRENT chart type. Empty cells are
   * fine (they read as a gap / zero). Returns 0 for chart types where free
   * text in a value column is legitimate (table, timeline, key figures).
   * The panel uses this to warn instead of silently dropping the value.
   */
  // Chart types where free text in a value column is legitimate, so a
  // non-numeric cell is NOT a problem (table shows raw text; timeline has its
  // own date/label/text shape; key figures accept text figures).
  var VALUE_TEXT_OK = { table: 1, timeline: 1, keyfigures: 1 };

  function valueColsForCheck() {
    return (store.valueCols && store.valueCols.length)
      ? store.valueCols
      : [store.valueCol];
  }

  store.getValueWarnings = function () {
    if (VALUE_TEXT_OK[store.chartType]) return 0;
    var cols = valueColsForCheck();
    var bad = 0;
    for (var i = 0; i < store.rows.length; i++) {
      var row = store.rows[i];
      if (!row) continue;
      var label = row[store.labelCol];
      if (label == null || label === "") continue;   // skip blank rows
      for (var k = 0; k < cols.length; k++) {
        var cell = row[cols[k]];
        if (cell == null || cell === "") continue;    // blank cell = allowed
        if (typeof cell !== "number" && isNaN(Number(cell))) bad++;
      }
    }
    return bad;
  };

  /**
   * Does this row have a value cell that was filled in but can't be read as a
   * number? Used by the data grid to tint the whole row red. Same rule as
   * getValueWarnings, per-row.
   */
  store.rowHasBadValue = function (r) {
    if (VALUE_TEXT_OK[store.chartType]) return false;
    var row = store.rows[r];
    if (!row) return false;
    var label = row[store.labelCol];
    if (label == null || label === "") return false;  // blank row → not flagged
    var cols = valueColsForCheck();
    for (var k = 0; k < cols.length; k++) {
      var cell = row[cols[k]];
      if (cell == null || cell === "") continue;       // blank cell = allowed
      if (typeof cell !== "number" && isNaN(Number(cell))) return true;
    }
    return false;
  };

  /**
   * Try to load from an HTML string containing a <table>.
   * Returns TSV string if a table is found, or null.
   */
  store.parseHtmlTable = parseHtmlTable;

  /**
   * Load from a CSV string (pasted or read from file).
   * Also supports markdown tables (| delimited) and Word/HTML table pastes.
   */
  store.loadFromCSVString = function (text) {
    if (!text || !text.trim()) return { error: "Empty data." };

    // Pre-process: convert markdown tables to TSV
    text = convertMarkdownTable(text);

    // Explicit tab delimiter when tabs are present (Excel/Word paste)
    // — avoids PapaParse auto-detect failures on short data
    var parseOpts = {
      header: false,
      dynamicTyping: true,
      skipEmptyLines: true
    };
    if (text.indexOf("\t") !== -1) {
      parseOpts.delimiter = "\t";
    }

    var result = Papa.parse(text.trim(), parseOpts);

    if (result.errors && result.errors.length) {
      return { error: result.errors[0].message };
    }

    var data = result.data;
    if (!data || !data.length) return { error: "No data rows found." };

    // Detect if first row is a header
    var firstRow = data[0];
    var looksLikeHeader = false;
    for (var i = 0; i < firstRow.length; i++) {
      if (typeof firstRow[i] === "string" && isNaN(Number(firstRow[i]))) {
        looksLikeHeader = true;
        break;
      }
    }

    if (looksLikeHeader) {
      store.headers = firstRow.map(function (h, idx) {
        return h != null ? String(h).trim() : "Column " + (idx + 1);
      });
      store.rows = data.slice(1);
    } else {
      store.headers = [];
      for (var j = 0; j < firstRow.length; j++) {
        store.headers.push("Column " + (j + 1));
      }
      store.rows = data;
    }

    // Enforce max row limit to prevent memory exhaustion
    var MAX_ROWS = 5000;
    if (store.rows.length > MAX_ROWS) {
      store.rows = store.rows.slice(0, MAX_ROWS);
    }

    // Normalize row lengths and clean numeric values (strip thousand separators)
    var colCount = store.headers.length;
    for (var ri = 0; ri < store.rows.length; ri++) {
      var row = store.rows[ri];
      if (!Array.isArray(row)) { store.rows[ri] = []; row = store.rows[ri]; }
      while (row.length < colCount) row.push("");
      if (row.length > colCount) store.rows[ri] = row.slice(0, colCount);
      for (var ci = 0; ci < row.length; ci++) {
        row[ci] = parseNumeric(row[ci]);
      }
    }

    store.labelCol = 0;
    store.valueCol = store.headers.length > 1 ? 1 : 0;
    store.valueCols = null;
    store.iconSelections = [];
    store.sortCol = null;
    store.sortDir = null;
    store.source = "paste";
    notify();
    var truncated = store.rows.length >= MAX_ROWS;
    return { ok: true, rowCount: store.rows.length, truncated: truncated };
  };

  // ── Cell Editing ──────────────────────────────────────

  store.updateCell = function (rowIndex, colIndex, value) {
    if (rowIndex < 0 || rowIndex >= store.rows.length) return;
    if (colIndex < 0 || colIndex >= store.headers.length) return;

    // parseNumeric now handles plain numbers, thousands/decimal commas,
    // currency symbols and percent — one consistent rule for every path.
    store.rows[rowIndex][colIndex] = parseNumeric(value);
    store.source = "grid-edit";
    // Trigger chart-only update (no grid re-render to avoid losing focus)
    if (typeof store.onValueChange === "function") {
      store.onValueChange();
    }
  };

  store.addRow = function () {
    var newRow = [];
    for (var i = 0; i < store.headers.length; i++) {
      newRow.push("");
    }
    store.rows.push(newRow);
    store.iconSelections.push(null);
    store.source = "grid-edit";
    notify();
  };

  store.removeRow = function (index) {
    if (index >= 0 && index < store.rows.length) {
      store.rows.splice(index, 1);
      store.iconSelections.splice(index, 1);
      store.source = "grid-edit";
      notify();
    }
  };

  store.moveRow = function (fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= store.rows.length) return;
    if (toIndex < 0 || toIndex >= store.rows.length) return;
    var row = store.rows.splice(fromIndex, 1)[0];
    store.rows.splice(toIndex, 0, row);
    var sel = store.iconSelections.splice(fromIndex, 1)[0];
    store.iconSelections.splice(toIndex, 0, sel);
    store.source = "grid-edit";
    notify();
  };

  store.removeColumn = function (index) {
    if (index < 0 || index >= store.headers.length) return;
    if (store.headers.length <= 1) return; // prevent deleting last column

    store.headers.splice(index, 1);
    for (var i = 0; i < store.rows.length; i++) {
      store.rows[i].splice(index, 1);
    }

    // Adjust labelCol
    if (store.labelCol === index) {
      store.labelCol = 0;
    } else if (store.labelCol > index) {
      store.labelCol--;
    }
    if (store.labelCol >= store.headers.length) store.labelCol = 0;

    // Adjust valueCol
    if (store.valueCol === index) {
      store.valueCol = Math.min(1, store.headers.length - 1);
    } else if (store.valueCol > index) {
      store.valueCol--;
    }
    if (store.valueCol >= store.headers.length) store.valueCol = Math.min(1, store.headers.length - 1);

    // Adjust valueCols (multi-value for stacked/bubble)
    if (store.valueCols) {
      store.valueCols = store.valueCols
        .filter(function (c) { return c !== index; })
        .map(function (c) { return c > index ? c - 1 : c; });
      if (!store.valueCols.length) store.valueCols = null;
    }

    store.source = "grid-edit";
    notify();
  };

  store.addColumn = function (name) {
    var newIndex = store.headers.length;
    store.headers.push(name || "Column " + (newIndex + 1));
    for (var i = 0; i < store.rows.length; i++) {
      store.rows[i].push("");
    }
    // Auto-include new column in valueCols for stacked/multi-value charts
    if (store.valueCols && newIndex !== store.labelCol) {
      store.valueCols.push(newIndex);
    }
    store.source = "grid-edit";
    notify();
  };

  store.moveColumn = function (fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= store.headers.length) return;
    if (toIndex < 0 || toIndex >= store.headers.length) return;

    // Move header
    var hdr = store.headers.splice(fromIndex, 1)[0];
    store.headers.splice(toIndex, 0, hdr);

    // Move cells in every row
    for (var i = 0; i < store.rows.length; i++) {
      var cell = store.rows[i].splice(fromIndex, 1)[0];
      store.rows[i].splice(toIndex, 0, cell);
    }

    // Adjust tracked column indices
    function adjustIdx(cur, from, to) {
      if (cur === from) return to;
      if (from < to) {
        // moved right: indices in (from, to] shift left
        if (cur > from && cur <= to) return cur - 1;
      } else {
        // moved left: indices in [to, from) shift right
        if (cur >= to && cur < from) return cur + 1;
      }
      return cur;
    }

    store.labelCol = adjustIdx(store.labelCol, fromIndex, toIndex);
    store.valueCol = adjustIdx(store.valueCol, fromIndex, toIndex);

    if (store.valueCols) {
      store.valueCols = store.valueCols.map(function (c) {
        return adjustIdx(c, fromIndex, toIndex);
      });
    }

    // Adjust sort column if active
    if (store.sortCol != null) {
      store.sortCol = adjustIdx(store.sortCol, fromIndex, toIndex);
    }

    store.source = "grid-edit";
    notify();
  };

  store.sortByColumn = function (colIndex, direction) {
    if (colIndex < 0 || colIndex >= store.headers.length) return;
    var dir = direction === "desc" ? -1 : 1;

    // Build indexed array so iconSelections can be rearranged in parallel
    var indexed = [];
    for (var si = 0; si < store.rows.length; si++) {
      indexed.push({ row: store.rows[si], sel: store.iconSelections[si] || null });
    }
    indexed.sort(function (a, b) {
      var va = a.row[colIndex];
      var vb = b.row[colIndex];
      var na = Number(va);
      var nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
      var sa = (va == null ? "" : String(va)).toLowerCase();
      var sb = (vb == null ? "" : String(vb)).toLowerCase();
      if (sa < sb) return -1 * dir;
      if (sa > sb) return 1 * dir;
      return 0;
    });
    for (var sj = 0; sj < indexed.length; sj++) {
      store.rows[sj] = indexed[sj].row;
      store.iconSelections[sj] = indexed[sj].sel;
    }

    store.sortCol = colIndex;
    store.sortDir = direction;
    store.source = "grid-edit";
    notify();
  };

  store.updateHeader = function (colIndex, value) {
    if (colIndex >= 0 && colIndex < store.headers.length) {
      store.headers[colIndex] = value || "Column " + (colIndex + 1);
      store.source = "grid-edit";
      // Trigger a re-render so chart legends, table headers, sankey
      // node names, etc. pick up the new header text immediately.
      // Without this notify(), the new header sits in the store but
      // the chart keeps drawing the old text until the user clears
      // and re-creates the chart.
      notify();
    }
  };

  store.clear = function () {
    store.headers = ["Label", "Value"];
    store.rows = [];
    store.labelCol = 0;
    store.valueCol = 1;
    store.valueCols = null;
    store.chartType = "hbar";
    store.chartWidth = 500;
    store.chartHeight = 0;
    store.barThickness = 0;
    store.barSpacing = 0;
    store.verticalPadding = 0;
    store.chartTitle = "";
    store.chartSubtitle = "";
    store.chartComments = "";
    store.chartFooter = "";
    store.colors = null;
    store.labelColor = null;
    store.textScale = 100;
    store.labelScale = 100;
    store.shade = false;
    store.lineShowDots = false;
    store.lineDotSize = 4;
    store.lineLabelPos = "auto";
    store.lineLabelBg = "none";
    store.lineValueLabels = true;
    store.lineSeriesEndLabels = true;
    store.lineLegend = false;
    store.lineShowYAxis = false;
    store.lineHiddenLabels = [];
    store.clusterLineColors = {};
    store.clusterLineYAxis = true;
    store.clusterLineValueLabels = false;
    store.clusterLineIndependentScale = false;
    store.bubbleOrientation = "horizontal";
    store.bubbleSeparation = 0;
    store.timelineOrientation = "horizontal";
    store.timelineEventSpacing = 90;
    store.timelineCategoryColors = {};
    store.timelineLegend = true;
    store.timelineCompactArcs = false;
    store.clusterDonutLegend = true;
    store.clusterDonutCategoryColors = {};
    store.sliceColors = {};
    store.pieLegend = false;
    store.headerTextWidth = 100;
    store.footerTextWidth = 100;
    store.timelineRowGap = 30;
    store.clusterOrientation = "horizontal";
    store.donutCenterTitle = "";
    store.donutCenterLabel = "";
    store.donutCenterAuto = true;
    store.donutHole = 60;
    store.pieLabelMode = "auto";
    store.pieLabelContent = "label-pct";
    store.pieLeaderLines = true;
    store.pieLabelDistance = 24;
    store.barLabelMode = "outside";
    store.stackedStroke = false;
    store.stackedStrokeWidth = 2;
    store.stackedStrokeColor = "#FFFFFF";
    store.stackedLegend = false;
    store.axisMax = null;
    store.hideZeroLabels = false;
    store.numberFormat = "auto";
    store.valuePrefix = "";
    store.valueSuffix = "";
    store.autoSort = true;
    store.iconShape = "people";
    store.iconShapes = null;
    store.iconSize = 20;
    store.iconLegendLabels = null;
    store.iconColors = null;
    store.iconShowLegend = true;
    store.iconLegendLayout = "horizontal";
    store.sankeyNodeWidth = 20;
    store.sankeyNodePadding = 15;
    store.sankeyLinkOpacity = 0.4;
    store.sankeyLabelMode = "both";
    store.sankeyNodeMode = "auto";
    store.iconColType = "none";
    store.iconSelections = [];
    store.rowIconColor = null;
    store.sortCol = null;
    store.sortDir = null;
    store.source = null;
    notify();
  };

  // ── Column Selection ──────────────────────────────────

  store.setLabelCol = function (index) {
    store.labelCol = index;
  };

  store.setValueCol = function (index) {
    store.valueCol = index;
  };

  store.setValueCols = function (indices) {
    store.valueCols = indices && indices.length ? indices : null;
  };

  store.setIconSelection = function (rowIndex, ref) {
    // Ensure array is long enough
    while (store.iconSelections.length < store.rows.length) {
      store.iconSelections.push(null);
    }
    store.iconSelections[rowIndex] = ref || null;
  };

  // ── Chart Data Output ─────────────────────────────────

  /**
   * Simple label/value pairs (for hbar, vbar, line, pie, donut).
   *
   * preserveOrder: when true, never reorder by value — used by the
   * line chart, whose X axis is an ordered sequence (years, quarters,
   * months). Sorting a time series by magnitude would scramble it.
   */
  store.toChartData = function (preserveOrder) {
    var data = [];
    for (var i = 0; i < store.rows.length; i++) {
      var row = store.rows[i];
      var label = row[store.labelCol];
      var value = row[store.valueCol];

      if (label == null || label === "") continue;
      var numVal = Number(value);
      if (isNaN(numVal)) continue;

      var item = {
        label: String(label).trim(),
        value: numVal,
        _srcRow: i
      };
      if (store.iconColType !== "none" && store.iconSelections[i]) {
        item.iconRef = store.iconSelections[i];
      }
      data.push(item);
    }
    if (!preserveOrder && store.autoSort) {
      data.sort(function (a, b) { return b.value - a.value; });
    }
    return data;
  };

  /**
   * Multi-value data (for stacked bar, stacked column, bubble, line).
   * Returns [{label, values: [v1, v2, ...]}]
   *
   * preserveOrder: when true, never reorder by value sum — used by the
   * line chart so its ordered X axis (time/sequence) is kept intact.
   * Each value column becomes one line.
   */
  store.toMultiValueData = function (preserveOrder) {
    var cols = store.valueCols;
    if (!cols || !cols.length) {
      // Fallback: single value column wrapped in array
      return store.toChartData(preserveOrder).map(function (d) {
        var item = { label: d.label, values: [d.value], _srcRow: d._srcRow };
        if (d.iconRef) item.iconRef = d.iconRef;
        return item;
      });
    }

    var data = [];
    for (var i = 0; i < store.rows.length; i++) {
      var row = store.rows[i];
      var label = row[store.labelCol];
      if (label == null || label === "") continue;

      var values = [];
      var hasValid = false;
      for (var c = 0; c < cols.length; c++) {
        var v = Number(row[cols[c]]);
        if (isNaN(v)) v = 0;
        else hasValid = true;
        values.push(v);
      }
      if (!hasValid) continue;

      var item = {
        label: String(label).trim(),
        values: values,
        _srcRow: i
      };
      if (store.iconColType !== "none" && store.iconSelections[i]) {
        item.iconRef = store.iconSelections[i];
      }
      data.push(item);
    }
    if (!preserveOrder && store.autoSort) {
      data.sort(function (a, b) {
        var sumA = 0, sumB = 0;
        for (var j = 0; j < a.values.length; j++) sumA += a.values[j];
        for (var j = 0; j < b.values.length; j++) sumB += b.values[j];
        return sumB - sumA;
      });
    }
    return data;
  };

  /**
   * Sankey data (for sankey diagram).
   * Returns [{source: str, target: str, value: num}]
   *
   * Two grid layouts are accepted:
   *
   * - 3 columns — classic edge list: Source, Target, Value. One link per row.
   *
   * - 5+ columns (odd count) — multi-level flow, INTERLEAVED: step and value
   *   columns alternate, so each value sits between the two steps it
   *   connects. 3 levels = Source | Value 1 | Intermediate | Value 2 | Target:
   *     Funding | 120 | Health | 70 | Sudan
   *     Funding | 120 | Health | 50 | Yemen
   *   → Funding→Health 120 (stated on both rows; the first statement wins),
   *     Health→Sudan 70, Health→Yemen 50.
   *   Steps sit at even column indexes (0, 2, 4…), values at odd indexes;
   *   the left-to-right step order is the display order, and each link
   *   carries its own value — step totals do not need to add up.
   *   A blank step cell shortens the path (Funding | 30 | (blank) | | Chad
   *   links Funding→Chad directly, using the value right of the left step).
   *   This is the format for multi-level flows; the chart always draws a
   *   connected chain for these grids.
   */
  store.toSankeyData = function () {
    var data = [];
    var i, row;

    // Classic 3-column edge list.
    if (store.headers.length <= 3) {
      for (i = 0; i < store.rows.length; i++) {
        row = store.rows[i];
        var src = row[0], tgt = row[1], val = Number(row[2]);
        if (!src || !tgt || isNaN(val) || val <= 0) continue;
        data.push({ source: String(src).trim(), target: String(tgt).trim(), value: val });
      }
      return data;
    }

    // Multi-level, interleaved: steps at even indexes, values at odd.
    // With an even column count (no clean alternation), fall back to
    // treating all but the last column as steps sharing the row's single
    // value — forgiving for hand-built sheets, though the interleaved
    // layout is the documented one.
    var nCols = store.headers.length;
    var interleaved = (nCols % 2 === 1);
    var stageCount = interleaved ? (nCols + 1) / 2 : nCols - 1;
    var seen = {};
    for (i = 0; i < store.rows.length; i++) {
      row = store.rows[i];
      // Non-blank steps, remembering each one's original step position so
      // links map to the right value column even when a step is blank.
      var path = [];
      for (var s = 0; s < stageCount; s++) {
        var cell = row[interleaved ? s * 2 : s];
        if (cell != null && String(cell).trim() !== "") {
          path.push({ name: String(cell).trim(), idx: s });
        }
      }
      for (var p = 0; p < path.length - 1; p++) {
        // Value for the link path[p] → path[p+1]: the value column right
        // of the left step (interleaved), or the row's single value (even
        // fallback layout).
        var v = interleaved
          ? Number(row[path[p].idx * 2 + 1])
          : Number(row[nCols - 1]);
        if (isNaN(v) || v <= 0) continue;
        var key = path[p].name + "\u0001" + path[p + 1].name;
        // Each link's value is stated absolutely — when several rows repeat
        // the same link (Funding→Health on every Health row), the first
        // statement wins. No summing: per-step values are explicit.
        if (seen.hasOwnProperty(key)) continue;
        seen[key] = true;
        data.push({ source: path[p].name, target: path[p + 1].name, value: v });
      }
    }
    return data;
  };

  /**
   * Key Figures data.
   * Uses 3 columns: key figure (col 0), heading (col 1), body (col 2).
   * Returns [{value: num|str, label: str, body: str, iconRef: str|null, _srcRow: i}]
   */
  store.bodyCol = 2;

  store.toKeyFiguresData = function () {
    var data = [];
    var figCol = 0;
    var headCol = 1;
    var bCol = store.bodyCol || 2;

    for (var i = 0; i < store.rows.length; i++) {
      var row = store.rows[i];
      var fig = row[figCol];
      var head = row[headCol];
      var body = row[bCol] || "";

      if (fig == null || fig === "") continue;

      var numVal = Number(String(fig).replace(/[,$%]/g, ""));
      var item = {
        value: isNaN(numVal) ? fig : numVal,
        label: String(head || "").trim(),
        body: String(body).trim(),
        _srcRow: i
      };

      if (store.iconColType !== "none" && store.iconSelections[i]) {
        item.iconRef = store.iconSelections[i];
      }

      data.push(item);
    }
    return data;
  };

  /**
   * Timeline data.
   * Uses 3 columns: date (col 0), label (col 1), description (col 2).
   * Dates are kept as free text (no parsing). Visual order = row order.
   * Returns [{date: str, label: str, text: str, iconRef: str|null, _srcRow: i}]
   */
  store.toTimelineData = function () {
    var data = [];
    // Column resolution by header name (case-insensitive). Date is
    // required; Label and Description are optional but at least one of
    // them must be present. Category is optional — when present, each
    // unique value gets a colour from the style palette (overridable
    // via timelineCategoryColors). Supported grids:
    //   [Date, Label]                            — 2 cols
    //   [Date, Description]                      — 2 cols
    //   [Date, Label, Description]               — 3 cols (default)
    //   [Date, Label, Description, Category]     — 4 cols
    // Column order is not strictly enforced beyond "Date is a column"
    // — we look each one up by name.
    var headers = (store.headers || []).map(function (h) {
      return String(h == null ? "" : h).trim().toLowerCase();
    });
    var dateIdx = headers.indexOf("date");
    var labelIdx = headers.indexOf("label");
    var textIdx = headers.indexOf("description");
    var catIdx = headers.indexOf("category");
    if (dateIdx === -1) return [];
    if (labelIdx === -1 && textIdx === -1) return [];

    for (var i = 0; i < store.rows.length; i++) {
      var row = store.rows[i] || [];
      var date = dateIdx >= 0 ? row[dateIdx] : "";
      var label = labelIdx >= 0 ? row[labelIdx] : "";
      var text = textIdx >= 0 ? row[textIdx] : "";
      var cat = catIdx >= 0 ? row[catIdx] : "";

      // Date required; at least one of Label / Description required.
      var hasDate = date != null && String(date).trim() !== "";
      var hasLabel = label != null && String(label).trim() !== "";
      var hasText = text != null && String(text).trim() !== "";
      if (!hasDate) continue;
      if (!hasLabel && !hasText) continue;

      var item = {
        date: String(date).trim(),
        label: String(label || "").trim(),
        text: String(text || "").trim(),
        _srcRow: i
      };
      if (cat != null && String(cat).trim() !== "") {
        item.category = String(cat).trim();
      }

      // Icons use the existing iconSelections array — picker writes here directly.
      if (store.iconSelections && store.iconSelections[i]) {
        item.iconRef = store.iconSelections[i];
      }

      data.push(item);
    }
    return data;
  };

  // ── Config Serialization (for groupItem.note) ─────────

  /**
   * Serialize full chart config to JSON string.
   * Stored in Illustrator groupItem.note for re-editing.
   */
  store.toConfig = function () {
    var cfg = {
      v: 1,
      chartType: store.chartType,
      chartTitle: store.chartTitle,
      chartSubtitle: store.chartSubtitle,
      chartComments: store.chartComments,
      chartFooter: store.chartFooter,
      headers: store.headers,
      rows: store.rows,
      labelCol: store.labelCol,
      valueCol: store.valueCol,
      chartWidth: store.chartWidth,
      chartHeight: store.chartHeight,
      barThickness: store.barThickness,
      barSpacing: store.barSpacing,
      verticalPadding: store.verticalPadding,
      style: store.style,
      shade: store.shade,
      lineShowDots: store.lineShowDots,
      lineDotSize: store.lineDotSize,
      lineLabelPos: store.lineLabelPos,
      lineLabelBg: store.lineLabelBg,
      lineValueLabels: store.lineValueLabels,
      lineSeriesEndLabels: store.lineSeriesEndLabels,
      lineLegend: store.lineLegend,
      lineShowYAxis: store.lineShowYAxis,
      lineHiddenLabels: store.lineHiddenLabels,
      clusterLineColors: store.clusterLineColors,
      clusterLineYAxis: store.clusterLineYAxis,
      clusterLineValueLabels: store.clusterLineValueLabels,
      clusterLineIndependentScale: store.clusterLineIndependentScale,
      bubbleOrientation: store.bubbleOrientation,
      bubbleSeparation: store.bubbleSeparation,
      timelineOrientation: store.timelineOrientation,
      timelineEventSpacing: store.timelineEventSpacing,
      timelineCategoryColors: store.timelineCategoryColors || {},
      timelineLegend: store.timelineLegend,
      timelineCompactArcs: !!store.timelineCompactArcs,
      clusterDonutLegend: store.clusterDonutLegend !== false,
      clusterDonutCategoryColors: store.clusterDonutCategoryColors || {},
      sliceColors: store.sliceColors || {},
      pieLegend: !!store.pieLegend,
      headerTextWidth: store.headerTextWidth || 100,
      footerTextWidth: store.footerTextWidth || 100,
      timelineRowGap: store.timelineRowGap || 0,
      clusterOrientation: store.clusterOrientation,
      donutCenterTitle: store.donutCenterTitle,
      donutCenterLabel: store.donutCenterLabel,
      donutCenterAuto: store.donutCenterAuto,
      donutHole: store.donutHole,
      pieLabelMode: store.pieLabelMode,
      pieLabelContent: store.pieLabelContent,
      pieLeaderLines: store.pieLeaderLines,
      pieLabelDistance: store.pieLabelDistance,
      barLabelMode: store.barLabelMode,
      stackedStroke: store.stackedStroke,
      stackedStrokeWidth: store.stackedStrokeWidth,
      stackedStrokeColor: store.stackedStrokeColor,
      stackedLegend: store.stackedLegend,
      axisMax: store.axisMax,
      hideZeroLabels: store.hideZeroLabels,
      numberFormat: store.numberFormat,
      valuePrefix: store.valuePrefix,
      valueSuffix: store.valueSuffix,
      autoSort: store.autoSort,
      iconShape: store.iconShape,
      iconShapes: store.iconShapes,
      iconSize: store.iconSize,
      iconLegendLabels: store.iconLegendLabels,
      iconColors: store.iconColors,
      iconShowLegend: store.iconShowLegend,
      iconLegendLayout: store.iconLegendLayout,
      sankeyNodeWidth: store.sankeyNodeWidth,
      sankeyNodePadding: store.sankeyNodePadding,
      sankeyLinkOpacity: store.sankeyLinkOpacity,
      sankeyLabelMode: store.sankeyLabelMode,
      sankeyNodeMode: store.sankeyNodeMode,
      // Key Figures options
      kfAutoCols: store.kfAutoCols,
      kfMaxCols: store.kfMaxCols,
      kfAutoWidth: store.kfAutoWidth,
      kfColWidth: store.kfColWidth,
      kfIconPosition: store.kfIconPosition,
      kfShowSeparators: store.kfShowSeparators,
      kfPadH: store.kfPadH,
      kfPadV: store.kfPadV,
      kfGap: store.kfGap,
      kfIconColor: store.kfIconColor,
      kfTextColor: store.kfTextColor,
      bodyCol: store.bodyCol
    };

    if (store.valueCols) cfg.valueCols = store.valueCols;
    if (store.colors) cfg.colors = store.colors;
    if (store.labelColor) cfg.labelColor = store.labelColor;
    if (store.textScale !== 100) cfg.textScale = store.textScale;
    if (store.labelScale !== 100) cfg.labelScale = store.labelScale;
    if (store.iconColType !== "none" && store.iconSelections.length) {
      cfg.iconColType = store.iconColType;
      cfg.iconSelections = store.iconSelections;
      if (store.rowIconColor) {   // null/auto is not persisted — explicit picks are
        cfg.rowIconColor = store.rowIconColor;
      }
    }
    if (store.sortCol != null) { cfg.sortCol = store.sortCol; cfg.sortDir = store.sortDir; }

    return JSON.stringify(cfg);
  };

  /**
   * Restore full chart state from a config JSON string.
   *
   * ┌─ MAINTAINER NOTE ──────────────────────────────────────────────────┐
   * │ When you add a new chart setting (a new field on `store`), wire it │
   * │ into BOTH `toConfig()` (above) and `loadFromConfig()` (below) so   │
   * │ the round-trip works for the manual UI. Then decide whether the    │
   * │ AI flow should also support it:                                    │
   * │                                                                    │
   * │   • Visual/layout default → no AI work needed. The setting flows   │
   * │     through both the manual UI and AI-imported charts via this     │
   * │     function and ChartBuilder reads it.                            │
   * │                                                                    │
   * │   • New optional config field the AI can OPTIONALLY produce →      │
   * │     add the field name to the `passthrough` list in                │
   * │     `ai-import.js`'s `expand()`. One line. The plugin will then    │
   * │     accept it from AI JSON; if the AI doesn't send it, defaults    │
   * │     apply. (The AI doesn't need to know about it.)                 │
   * │                                                                    │
   * │   • Field the AI should ACTIVELY choose values for → also add a    │
   * │     short mention to `ai-prompt-template.js` so Copilot knows when │
   * │     and how to set it.                                             │
   * │                                                                    │
   * │ See `CLAUDE.md` "Plugin-internal sync rules" for the full          │
   * │ checklist; the rule is also restated at                            │
   * │ `chart-registry.js`'s `register()` for the new-chart-type case.    │
   * └────────────────────────────────────────────────────────────────────┘
   */
  store.loadFromConfig = function (jsonStr) {
    try {
      var c = JSON.parse(jsonStr);
      if (!c.v) return { error: "Not a valid Humanitarian DataViz config." };

      store.chartType = c.chartType || "hbar";
      store.chartTitle = c.chartTitle || "";
      store.chartSubtitle = c.chartSubtitle || "";
      store.chartComments = c.chartComments || "";
      store.chartFooter = c.chartFooter || "";
      store.headers = c.headers || ["Label", "Value"];
      store.rows = c.rows || [];
      store.labelCol = c.labelCol || 0;
      store.valueCol = c.valueCol != null ? c.valueCol : 1;
      store.valueCols = c.valueCols || null;
      store.chartWidth = c.chartWidth || 500;
      store.chartHeight = c.chartHeight || 0;
      store.barThickness = c.barThickness || 0;
      store.barSpacing = c.barSpacing || 0;
      store.verticalPadding = c.verticalPadding || 0;
      store.colors = c.colors || null;
      store.labelColor = c.labelColor || null;
      store.textScale = c.textScale || 100;
      store.labelScale = c.labelScale || 100;
      store.style = c.style || "ocha";
      store.shade = !!c.shade;
      store.lineShowDots = c.lineShowDots !== false;
      store.lineDotSize = c.lineDotSize != null ? c.lineDotSize : 4;
      store.lineLabelPos = c.lineLabelPos || "auto";
      store.lineLabelBg = c.lineLabelBg || "none";
      store.lineValueLabels = c.lineValueLabels !== false;
      store.lineSeriesEndLabels = c.lineSeriesEndLabels !== false;
      store.lineLegend = !!c.lineLegend;
      store.lineShowYAxis = !!c.lineShowYAxis;
      store.lineHiddenLabels = Array.isArray(c.lineHiddenLabels) ? c.lineHiddenLabels.slice() : [];
      store.clusterLineColors = (c.clusterLineColors && typeof c.clusterLineColors === "object") ? c.clusterLineColors : {};
      store.clusterLineYAxis = c.clusterLineYAxis !== false;       // default ON
      store.clusterLineValueLabels = !!c.clusterLineValueLabels;   // default OFF
      store.clusterLineIndependentScale = !!c.clusterLineIndependentScale; // default OFF
      store.bubbleOrientation = c.bubbleOrientation || "horizontal";
      store.bubbleSeparation = c.bubbleSeparation || 0;
      store.timelineOrientation = c.timelineOrientation || "horizontal";
      store.timelineEventSpacing = c.timelineEventSpacing || 90;
      store.timelineCategoryColors = (c.timelineCategoryColors && typeof c.timelineCategoryColors === "object") ? c.timelineCategoryColors : {};
      store.timelineLegend = c.timelineLegend !== false;
      store.timelineCompactArcs = !!c.timelineCompactArcs;
      store.clusterDonutLegend = c.clusterDonutLegend !== false;
      store.clusterDonutCategoryColors = (c.clusterDonutCategoryColors && typeof c.clusterDonutCategoryColors === "object") ? c.clusterDonutCategoryColors : {};
      store.sliceColors = (c.sliceColors && typeof c.sliceColors === "object") ? c.sliceColors : {};
      store.pieLegend = !!c.pieLegend;
      store.headerTextWidth = (c.headerTextWidth && c.headerTextWidth > 0) ? c.headerTextWidth : 100;
      store.footerTextWidth = (c.footerTextWidth && c.footerTextWidth > 0) ? c.footerTextWidth : 100;
      store.timelineRowGap = (c.timelineRowGap && c.timelineRowGap > 0) ? c.timelineRowGap : 30;
      store.clusterOrientation = c.clusterOrientation || "horizontal";
      store.donutCenterTitle = c.donutCenterTitle || "";
      store.donutCenterLabel = c.donutCenterLabel || "";
      store.donutCenterAuto = c.donutCenterAuto !== false;
      store.donutHole = c.donutHole != null ? c.donutHole : 60;
      store.pieLabelMode = c.pieLabelMode || "auto";
      store.pieLabelContent = c.pieLabelContent || "label-pct";
      store.pieLeaderLines = c.pieLeaderLines !== false;
      store.pieLabelDistance = c.pieLabelDistance != null ? c.pieLabelDistance : 24;
      store.barLabelMode = c.barLabelMode || "outside";
      store.stackedStroke = !!c.stackedStroke;
      store.stackedStrokeWidth = c.stackedStrokeWidth != null ? c.stackedStrokeWidth : 2;
      store.stackedStrokeColor = c.stackedStrokeColor || "#FFFFFF";
      store.stackedLegend = !!c.stackedLegend;
      // axisMax: preserve null (auto); otherwise coerce to positive number
      store.axisMax = (c.axisMax != null && isFinite(c.axisMax) && c.axisMax > 0) ? Number(c.axisMax) : null;
      store.hideZeroLabels = !!c.hideZeroLabels;
      store.numberFormat = c.numberFormat || "auto";
      store.valuePrefix = c.valuePrefix || "";
      store.valueSuffix = c.valueSuffix || "";
      store.autoSort = c.autoSort !== false;
      store.iconShape = c.iconShape || "people";
      store.iconShapes = c.iconShapes || null;
      store.iconSize = c.iconSize || 20;
      store.iconLegendLabels = c.iconLegendLabels || null;
      store.iconColors = c.iconColors || null;
      store.iconShowLegend = c.iconShowLegend !== false;
      store.iconLegendLayout = c.iconLegendLayout || "horizontal";
      store.sankeyNodeWidth = c.sankeyNodeWidth || 20;
      store.sankeyNodePadding = c.sankeyNodePadding || 15;
      store.sankeyLinkOpacity = c.sankeyLinkOpacity != null ? c.sankeyLinkOpacity : 0.4;
      store.sankeyLabelMode = c.sankeyLabelMode || "both";
      store.sankeyNodeMode = c.sankeyNodeMode || "auto";
      // Key Figures options — restore from config
      store.kfAutoCols = c.kfAutoCols !== false;
      store.kfMaxCols = c.kfMaxCols || 3;
      store.kfAutoWidth = c.kfAutoWidth !== false;
      store.kfColWidth = c.kfColWidth || 150;
      store.kfIconPosition = c.kfIconPosition || "left";
      store.kfShowSeparators = c.kfShowSeparators !== false;
      store.kfPadH = c.kfPadH != null ? c.kfPadH : 12;
      store.kfPadV = c.kfPadV != null ? c.kfPadV : 10;
      store.kfGap = c.kfGap != null ? c.kfGap : 8;
      store.kfIconColor = c.kfIconColor || "#009EDB";
      store.kfTextColor = c.kfTextColor || null;
      store.bodyCol = c.bodyCol != null ? c.bodyCol : 2;
      store.iconColType = c.iconColType || "none";
      store.iconSelections = c.iconSelections || [];
      store.rowIconColor = c.rowIconColor || null;
      store.sortCol = c.sortCol != null ? c.sortCol : null;
      store.sortDir = c.sortDir || null;
      store.source = "config";

      // Mark this notify as a config load. panel.js's onChange hook
      // checks this flag and skips the premature chart re-render, which
      // would otherwise read stale UI controls and overwrite the freshly
      // loaded settings. The caller (panel.js) runs syncUIFromStore and
      // generateSVG itself, in the correct order, right after this returns.
      store._loading = true;
      try { notify(); } finally { store._loading = false; }

      return { ok: true };
    } catch (e) {
      return { error: "Failed to parse chart config: " + e.message };
    }
  };

  // ── Sample Data ──────────────────────────────────────

  store.loadSampleData = function (chartType) {
    if (chartType === "sankey" || chartType === "sankey-2") {
      store.headers = ["Source", "Target", "Value"];
      store.rows = [
        ["Mali", "Niger", 85000],
        ["Mali", "Mauritania", 62000],
        ["Burkina Faso", "Ghana", 74000],
        ["Burkina Faso", "Chad", 45000],
        ["Nigeria", "Cameroon", 38000],
        ["Nigeria", "Niger", 52000]
      ];
      store.labelCol = 0;
      store.valueCol = 2;
    } else if (chartType === "sankey-3") {
      // Multi-level format, INTERLEAVED: step and value columns alternate,
      // so each value sits between the two steps it connects (each link
      // carries its own value — step totals don't need to add up). A
      // repeated link (Funding→Health on both Health rows) takes its value
      // from the first row that states it. No repeated labels needed.
      store.headers = ["Source", "Value 1", "Intermediate", "Value 2", "Target"];
      store.rows = [
        ["Funding", 120, "Health", 70, "Sudan"],
        ["Funding", 120, "Health", 50, "Yemen"],
        ["Funding", 80, "Education", 45, "Sudan"],
        ["Funding", 80, "Education", 35, "Syria"],
        ["Funding", 60, "WASH", 35, "Yemen"],
        ["Funding", 60, "WASH", 25, "DR of the Congo"]
      ];
      store.labelCol = 0;
      store.valueCol = 1;
    } else if (chartType === "timeline") {
      store.headers = ["Date", "Label", "Description"];
      store.rows = [
        ["Feb 2023", "6.8M", "People in need identified"],
        ["May 2023", "$1.2B", "Flash Appeal launched"],
        ["Sep 2023", "3.4M", "Reached with assistance"],
        ["Jan 2024", "12", "Partners operational"],
        ["Apr 2024", "850K", "Children vaccinated"]
      ];
      store.labelCol = 1;
      store.valueCol = 1;
    } else if (chartType === "keyfigures") {
      store.headers = ["Key Figure", "Heading", "Body"];
      store.rows = [
        ["2.4M", "People in Need", "Across 14 governorates"],
        ["450K", "Health Facilities", "Damaged or destroyed"],
        ["1.2M", "Children", "Affected by conflict"],
        ["890K", "Without Water", "In critical areas"],
        ["3.1M", "Food Insecure", "Requiring assistance"],
        ["680K", "Shelters", "Damaged across regions"]
      ];
      store.labelCol = 1;
      store.valueCol = 0;
      store.bodyCol = 2;
    } else if (chartType === "cluster" || chartType === "stacked-bar" || chartType === "stacked-col") {
      // Multi-value sample — classic humanitarian funding comparison
      // (Required vs Received, US$M). Same shape works for stacked too.
      store.headers = ["Country", "Required (US$M)", "Received (US$M)"];
      store.rows = [
        ["Sudan", 195, 164],
        ["Ukraine", 151, 202],
        ["Bangladesh", 146, 89],
        ["DR Congo", 146, 44],
        ["Syria", 146, 99],
        ["Myanmar", 136, 36],
        ["Haiti", 122, 4],
        ["Nigeria", 122, 20]
      ];
      store.labelCol = 0;
      store.valueCol = 1;
      store.valueCols = [1, 2];
      store.source = "sample";
      notify();
      return { ok: true, rowCount: store.rows.length };
    } else if (chartType === "cluster-donut") {
      // Composition sample — funding by status per country. The two
      // columns sum to that country's total committed amount, so each
      // donut is a meaningful per-country slice (which is the cluster
      // donut's whole point — composition, not magnitude). Different
      // allocated/under-review mixes across countries show off the
      // per-donut normalisation.
      store.headers = ["Country", "Allocated (US$M)", "Under review (US$M)"];
      store.rows = [
        ["Sudan", 195, 50],
        ["Bangladesh", 146, 60],
        ["Nigeria", 99, 23],
        ["Myanmar", 126, 40],
        ["Chad", 30, 97],
        ["Mozambique", 22, 78],
        ["Uganda", 30, 73],
        ["Haiti", 12, 47]
      ];
      store.labelCol = 0;
      store.valueCol = 1;
      store.valueCols = [1, 2];
      store.source = "sample";
      notify();
      return { ok: true, rowCount: store.rows.length };
    } else if (chartType === "line" || chartType === "cluster-line") {
      // Multi-series time series (people in need, millions, by country).
      // Ordered years on the X axis; one column per country. Shows off
      // overlaid lines (line) and small multiples (cluster-line).
      store.headers = ["Year", "Sudan", "Chad", "CAR"];
      store.rows = [
        ["2019", 5.8, 3.2, 1.6],
        ["2020", 8.1, 4.0, 2.1],
        ["2021", 9.3, 4.6, 2.4],
        ["2022", 11.7, 5.1, 2.9],
        ["2023", 14.2, 6.0, 3.1],
        ["2024", 18.4, 6.9, 3.4]
      ];
      store.labelCol = 0;
      store.valueCol = 1;
      store.valueCols = [1, 2, 3];
      store.source = "sample";
      notify();
      return { ok: true, rowCount: store.rows.length };
    } else {
      store.headers = ["Country", "People (millions)"];
      store.rows = [
        ["Sudan", 24.8],
        ["Yemen", 18.2],
        ["Syria", 16.7],
        ["Afghanistan", 15.8],
        ["DR of the Congo", 9.8],
        ["Ethiopia", 8.4]
      ];
      store.labelCol = 0;
      store.valueCol = 1;
    }
    store.valueCols = null;
    store.sortCol = null;
    store.sortDir = null;
    store.source = "sample";
    notify();
    return { ok: true, rowCount: store.rows.length };
  };

  // ── Utilities ─────────────────────────────────────────

  store.hasData = function () {
    if (store.rows.length === 0) return false;
    // Check that at least one cell has actual content
    for (var r = 0; r < store.rows.length; r++) {
      for (var c = 0; c < store.rows[r].length; c++) {
        if (store.rows[r][c] != null && String(store.rows[r][c]).trim() !== "") return true;
      }
    }
    return false;
  };

  store.rowCount = function () {
    return store.rows.length;
  };

  return store;
})();
