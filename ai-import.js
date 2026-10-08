/**
 * AiImport — paste JSON (single chart OR an array of charts) generated
 * by an LLM, validate it, expand the simplified AI-facing schema to
 * the internal DataStore config, and either:
 *   - render the single chart (Phase A flow); OR
 *   - preview the batch + offer "Place all N charts" (Phase B flow).
 *
 * Phase B scope: 14 chart types (hbar, vbar, stacked-bar, stacked-col,
 * cluster, line, donut, pie, bubble, timeline, keyfigures, icon,
 * sankey, table). Map remains deferred — geo-matching against admin
 * boundaries is not something the AI can do from prose.
 *
 * Public API:
 *   AiImport.init(deps)
 *     deps: { store, syncUI, generate, showStatus, clearStatus,
 *             pushUndo, renderGrid, placeBatch }
 *   AiImport.copyPrompt()       — copies AI_PROMPT_TEMPLATE to clipboard
 *   AiImport.openModal()        — shows the paste modal
 *   AiImport.closeModal()       — hides the paste modal
 */

/* global DataStore, AI_PROMPT_TEMPLATE, Connector */

var AiImport = (function () {
  "use strict";

  var _store;
  var _syncUI;
  var _generate;
  var _showStatus;
  var _clearStatus;
  var _pushUndo;
  var _renderGrid;
  var _placeBatch;        // function(expandedConfigs[]) — batch-place N charts
  var _sendAnalytics;     // function(eventName) — optional usage telemetry

  // Web shell (no Illustrator): a multi-chart import is downloaded as one
  // ZIP of SVGs instead of being placed on artboards, so the batch wording
  // and the artboard-layout choice change accordingly.
  var ON_WEB = (typeof Connector !== "undefined" && !Connector.illustrator);

  // Internal helper. Fires a usage-tracking ping if either the
  // injected dep or the panel's global hook is available; silent no-op
  // otherwise. Swallows all errors so analytics can never break the
  // user-facing flow.
  function track(eventName) {
    try {
      if (typeof _sendAnalytics === "function") {
        _sendAnalytics(eventName);
      } else if (typeof window !== "undefined" && typeof window.sendAnalyticsPing === "function") {
        window.sendAnalyticsPing(eventName);
      }
    } catch (e) { /* silent */ }
  }

  // DOM refs (resolved in init)
  var modalEl, textareaEl, importBtn, cancelBtn, closeBtn,
      errorBlockEl, errorMsgEl, copyFixBtn, tryAgainBtn,
      batchSummaryEl;

  var lastOriginalJson = "";       // stashed for the "Copy fix prompt" flow
  var lastAiFixPrompt = "";
  var lastBatchConfigs = null;     // expanded internal configs when the paste was an array

  // ─── Supported schema ─────────────────────────────────
  //
  // SUPPORTED_TYPES must mirror the chart-type tile grid in the panel
  // UI (see the Chart Type picker in `index.html`). When a new chart
  // type is added to the plugin via `ChartRegistry.register(id, ...)`,
  // it MUST be added to this list, otherwise the AI feature will
  // reject Copilot's output for that type. See the maintainer note
  // at the top of `chart-registry.js` for the full add-a-chart-type
  // checklist.
  var SUPPORTED_TYPES = [
    "hbar", "vbar",
    "stacked-bar", "stacked-col",
    "cluster", "line", "cluster-line",
    "donut", "pie", "cluster-donut",
    "bubble", "timeline", "keyfigures",
    "icon", "sankey", "table"
  ];
  var SUPPORTED_STYLES = ["ocha", "hnrp", "flash", "gho"];

  // Chart types where `valueCols` (multi-value) applies — the AI can
  // give multiple value columns and the plugin sums/groups them per
  // row. Single-value charts (hbar, vbar, line, donut, pie, icon) use
  // a single value column.
  var MULTI_VALUE_TYPES = {
    "stacked-bar": true,
    "stacked-col": true,
    "cluster": true,
    "cluster-donut": true,
    "bubble": true,
    // Line: each value column becomes a separate line on a shared
    // scale. Single-column data still renders as one line.
    "line": true,
    // Line small multiples: each value column becomes its own mini
    // line chart (panel) on a shared scale.
    "cluster-line": true
  };

  // Chart types with a custom data shape (not label + values). The
  // validator handles these specially rather than enforcing the
  // generic numeric-columns rule.
  //   - timeline:   headers include "Date" + at least one of "Label" / "Description"
  //   - keyfigures: fixed positional cols ["Figure", "Heading", "Body"];
  //                 col 0 may be a string like "2.3M" or "45%"
  //   - sankey:     fixed positional cols ["Source", "Target", "Value"];
  //                 cols 0+1 are strings, col 2 is numeric
  //   - table:      arbitrary mixed text/numeric columns; values pass
  //                 through verbatim (no coercion)
  var SPECIAL_SCHEMA_TYPES = {
    "timeline": true,
    "keyfigures": true,
    "sankey": true,
    "table": true
  };

  // ─── Helpers ──────────────────────────────────────────

  function isString(x) { return typeof x === "string"; }
  function isArray(x) { return Array.isArray(x); }
  function isPlainObject(x) {
    return x && typeof x === "object" && !Array.isArray(x);
  }
  function isFiniteNumber(x) { return typeof x === "number" && isFinite(x); }

  // Normalise picker-label / casing variants to the canonical chartType
  // string used by SUPPORTED_TYPES. Returns the canonical id, or null
  // if the input doesn't resemble any known type.
  //
  // Examples:
  //   "Timeline"          → "timeline"
  //   "Stacked Column"    → "stacked-col"
  //   "Sankey / Alluvial" → "sankey"
  //   "doughnut"          → "donut"
  function normalizeType(input) {
    if (!input) return null;
    var raw = String(input).toLowerCase();
    var lower = raw.replace(/[\s_/]+/g, "-");
    // 1. Exact match on a supported type after normalization. This must
    //    come before the substring loop, otherwise "timeline" matches
    //    "line" first (because "timeline".indexOf("line") !== -1).
    if (SUPPORTED_TYPES.indexOf(lower) !== -1) return lower;
    // 2. Alias table (covers "doughnut", "alluvial", "kpi", etc.)
    var aliases = ALIAS_TABLE;
    if (aliases[lower]) return aliases[lower];
    // 3. Substring fallback (last resort — handles "icon-chart" etc.)
    for (var i = 0; i < SUPPORTED_TYPES.length; i++) {
      if (SUPPORTED_TYPES[i].indexOf(lower) !== -1 || lower.indexOf(SUPPORTED_TYPES[i]) !== -1) {
        return SUPPORTED_TYPES[i];
      }
    }
    return null;
  }

  // Backwards-compat wrapper. suggestType is used in error messages
  // when validation fails — same lookup, same return shape.
  function suggestType(bad) {
    return normalizeType(bad);
  }

  // Alias table — pulled out as a module constant so normalizeType
  // can reuse it. Order doesn't matter; first hit wins.
  var ALIAS_TABLE = (function () {
    return {
      "bar": "hbar",
      "barchart": "hbar",
      "bar-chart": "hbar",
      "horizontal-bar": "hbar",
      "horizontal_bar": "hbar",
      "column": "vbar",
      "columns": "vbar",
      "column-chart": "vbar",
      "vertical-bar": "vbar",
      "stacked": "stacked-bar",
      "stackedbar": "stacked-bar",
      "stacked_bar": "stacked-bar",
      "stacked-column": "stacked-col",
      "stackedcol": "stacked-col",
      "stacked_col": "stacked-col",
      "grouped": "cluster",
      "grouped-bar": "cluster",
      "groupedbar": "cluster",
      "cluster-bar": "cluster",
      "clustered": "cluster",
      "linechart": "line",
      "line-chart": "line",
      "time-series": "line",
      "timeseries": "line",
      "cluster line": "cluster-line",
      "clusterline": "cluster-line",
      "small-multiples": "cluster-line",
      "small-multiple": "cluster-line",
      "smallmultiples": "cluster-line",
      "small-multiples-line": "cluster-line",
      "line-small-multiples": "cluster-line",
      "line-multiples": "cluster-line",
      "multiple-line-charts": "cluster-line",
      "multiple-lines": "cluster-line",
      "faceted-line": "cluster-line",
      "line-grid": "cluster-line",
      "sparklines": "cluster-line",
      "panel-chart": "cluster-line",
      "trellis": "cluster-line",
      "doughnut": "donut",
      "ring": "donut",
      "donut-chart": "donut",
      "donut-cluster": "cluster-donut",
      "donuts": "cluster-donut",
      "multiple-donuts": "cluster-donut",
      "multi-donut": "cluster-donut",
      "donut-grid": "cluster-donut",
      "donut-small-multiples": "cluster-donut",
      "small-multiples-donut": "cluster-donut",
      "cluster-doughnut": "cluster-donut",
      "doughnut-cluster": "cluster-donut",
      "piechart": "pie",
      "pie-chart": "pie",
      "bubble-chart": "bubble",
      "scatter": "bubble",
      "event": "timeline",
      "events": "timeline",
      "time-line": "timeline",
      "kpi": "keyfigures",
      "kpis": "keyfigures",
      "key-figures": "keyfigures",
      "key-figure": "keyfigures",
      "headline": "keyfigures",
      "headline-number": "keyfigures",
      "headline-numbers": "keyfigures",
      "big-number": "keyfigures",
      "big-numbers": "keyfigures",
      "pictogram": "icon",
      "pictograph": "icon",
      "isotype": "icon",
      "icons": "icon",
      "people": "icon",
      "alluvial": "sankey",
      "flow": "sankey",
      "flow-chart": "sankey",
      "flowchart": "sankey",
      "sankey-diagram": "sankey",
      "datatable": "table",
      "data-table": "table",
      "tabular": "table"
    };
  })();

  // ─── Validation ───────────────────────────────────────
  // Returns { ok: true, parsed } OR
  //         { ok: false, error: { human, aiPrompt } }

  // Auto-repair common artefacts some LLM UIs add to their output so
  // pasting "just works". Currently handles:
  //   1. Markdown fences: ```json ... ``` or ``` ... ```
  //   2. Leading "JSON" / "Here is the JSON:" blurbs before the object
  //   3. Copilot-style backslash-escaped brackets: \[ and \] (Microsoft
  //      Copilot's web UI escapes square brackets as if they were
  //      markdown, which breaks JSON.parse.)
  //   4. Curly/smart quotes accidentally introduced by rich-text paste.
  function autoRepair(text) {
    if (!text) return text;
    var t = String(text).trim();
    // Strip code fences
    t = t.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");

    // Remove Copilot's markdown-escape backslashes before [ and ].
    // Safe because \[ and \] aren't valid JSON escape sequences
    // anywhere (inside or outside strings), so stripping them can't
    // corrupt otherwise-valid JSON. Done BEFORE preface trim so the
    // first "[" of an array isn't hidden behind a backslash.
    t = t.replace(/\\([\[\]])/g, "$1");

    // Strip leading preface (text before the first "{" or "[") and any
    // trailing tail (text after the matching last "}" or "]"). Honour
    // both top-level shapes — an object {...} for a single chart, or
    // an array [...] for a multi-chart batch. The original logic only
    // looked for "{", which silently removed the outer array brackets
    // of a batch paste and left the parser with comma-separated
    // objects (the `Unexpected token ,` failure mode).
    var firstOpen = t.search(/[{\[]/);
    if (firstOpen > 0) {
      t = t.substring(firstOpen);
    }
    var lastObj = t.lastIndexOf("}");
    var lastArr = t.lastIndexOf("]");
    var lastClose = lastObj > lastArr ? lastObj : lastArr;
    if (lastClose > 0 && lastClose < t.length - 1) {
      t = t.substring(0, lastClose + 1);
    }

    // Normalise smart quotes to plain quotes (only common offenders)
    t = t
      .replace(/[\u201C\u201D]/g, '"')   // curly double quotes
      .replace(/[\u2018\u2019]/g, "'");  // curly single quotes (strings)
    return t;
  }

  // Parse + auto-repair. Returns { ok, parsed } or the err shape.
  function parseInput(jsonText) {
    try {
      return { ok: true, parsed: JSON.parse(jsonText) };
    } catch (e1) {
      var repaired = autoRepair(jsonText);
      if (repaired !== jsonText) {
        try {
          return { ok: true, parsed: JSON.parse(repaired) };
        } catch (e2) {
          return err(
            'Invalid JSON: ' + e2.message,
            "The JSON you generated couldn't be parsed: \"" + e2.message +
            "\". Fix the syntax and return ONLY the valid JSON object. " +
            "Do not escape [ or ] with backslashes. Do not wrap the " +
            "JSON in ``` code fences.",
            jsonText
          );
        }
      }
      return err(
        'Invalid JSON: ' + e1.message,
        "The JSON you generated couldn't be parsed: \"" + e1.message +
        "\". Fix the syntax and return ONLY the valid JSON object.",
        jsonText
      );
    }
  }

  // Resolve top-level input into a flat list of chart objects.
  // Accepted top-level shapes:
  //   - single object          → one-chart flow
  //   - array of objects       → batch flow
  //   - { charts: [...] }      → batch flow (some LLMs wrap in this)
  //   - { chart: {...} }       → single-chart flow (LLM wrapped)
  function normalizeToChartList(parsed, origText) {
    if (isArray(parsed)) {
      if (parsed.length === 0) {
        return err(
          "The JSON array is empty. Include at least one chart object.",
          "Return an array with at least one chart object matching the schema.",
          origText
        );
      }
      return { ok: true, isBatch: parsed.length > 1, charts: parsed };
    }
    if (isPlainObject(parsed)) {
      // Wrapped batch: { charts: [...] } or { chart: {...} }
      if (isArray(parsed.charts)) {
        if (parsed.charts.length === 0) {
          return err(
            'The "charts" array is empty. Include at least one chart.',
            'The "charts" array must contain at least one chart object.',
            origText
          );
        }
        return { ok: true, isBatch: parsed.charts.length > 1, charts: parsed.charts };
      }
      if (isPlainObject(parsed.chart)) {
        return { ok: true, isBatch: false, charts: [parsed.chart] };
      }
      return { ok: true, isBatch: false, charts: [parsed] };
    }
    return err(
      "Expected a JSON object or an array of charts at the top level, got " + typeof parsed + ".",
      "The response must be either a single JSON object (one chart) or an " +
      "array of objects (multiple charts). Return ONLY the valid JSON.",
      origText
    );
  }

  // Validate one chart object. `prefix` is included in error messages
  // when this chart is part of a batch (e.g. "Chart 2 of 5: ...").
  function validateOneChart(obj, prefix, origText) {
    prefix = prefix || "";

    if (!isPlainObject(obj)) {
      return err(
        prefix + "Expected a JSON object, got " + (isArray(obj) ? "array" : typeof obj) + ".",
        "Every chart in the response must be an object with chartType, " +
        "headers, rows. Return ONLY the corrected JSON.",
        origText
      );
    }

    // chartType
    if (!obj.chartType || !isString(obj.chartType)) {
      return err(
        prefix + 'Missing "chartType" field. Supported types: ' + SUPPORTED_TYPES.join(", ") + ".",
        'Add a "chartType" field to this chart. Supported values: ' +
        SUPPORTED_TYPES.map(function (t) { return '"' + t + '"'; }).join(", ") +
        ". Return ONLY the corrected JSON.",
        origText
      );
    }
    if (SUPPORTED_TYPES.indexOf(obj.chartType) === -1) {
      // Try to recover from picker-label / casing variants:
      // "Timeline" → "timeline", "Stacked Column" → "stacked-col",
      // "Sankey / Alluvial" → "sankey", "doughnut" → "donut", etc.
      // If we can identify the intended type, normalize in-place and
      // proceed instead of bouncing back an error to the user.
      var canonical = normalizeType(obj.chartType);
      if (canonical && SUPPORTED_TYPES.indexOf(canonical) !== -1) {
        obj.chartType = canonical;
      } else {
        var humanHint = canonical
          ? ' Did you mean "' + canonical + '"?'
          : " Supported types: " + SUPPORTED_TYPES.join(", ") + ".";
        return err(
          prefix + '"' + obj.chartType + '" isn\'t a supported chartType.' + humanHint,
          'Change "chartType" to one of: ' +
          SUPPORTED_TYPES.map(function (t) { return '"' + t + '"'; }).join(", ") +
          ". Return ONLY the corrected JSON.",
          origText
        );
      }
    }

    // headers
    if (!isArray(obj.headers) || obj.headers.length === 0) {
      return err(
        prefix + 'Missing or empty "headers" array.',
        'Every chart needs a non-empty "headers" array of column names. ' +
        "Return ONLY the corrected JSON.",
        origText
      );
    }
    for (var h = 0; h < obj.headers.length; h++) {
      if (!isString(obj.headers[h])) {
        return err(
          prefix + "Header at column " + (h + 1) + " must be a string.",
          "All entries in \"headers\" must be strings. Return ONLY the corrected JSON.",
          origText
        );
      }
    }

    // rows
    if (!isArray(obj.rows)) {
      return err(
        prefix + 'Missing "rows" array.',
        'Every chart needs a "rows" array where each row is itself an array ' +
        'with ' + obj.headers.length + ' values matching the headers. ' +
        "Return ONLY the corrected JSON.",
        origText
      );
    }
    if (obj.rows.length === 0) {
      return err(
        prefix + "No rows in the data. At least one row is required.",
        "Add at least one row matching the headers. Return ONLY the corrected JSON.",
        origText
      );
    }

    var expectedCols = obj.headers.length;
    for (var r = 0; r < obj.rows.length; r++) {
      var row = obj.rows[r];
      if (!isArray(row)) {
        return err(
          prefix + "Row " + (r + 1) + " should be an array.",
          "Every row must be an array of " + expectedCols + " values. Fix row " +
          (r + 1) + ". Return ONLY the corrected JSON.",
          origText
        );
      }
      if (row.length !== expectedCols) {
        return err(
          prefix + "Row " + (r + 1) + " has " + row.length + " columns but \"headers\" expects " + expectedCols + ".",
          "Every row must have exactly " + expectedCols + " values matching the headers " +
          "(" + obj.headers.join(", ") + "). Fix row " + (r + 1) +
          " and return ONLY the corrected JSON.",
          origText
        );
      }
    }

    // Special-schema types (timeline, keyfigures) use header-name or
    // positional semantics — no generic numeric-column enforcement.
    if (SPECIAL_SCHEMA_TYPES[obj.chartType]) {
      var specialErr = validateSpecialSchema(obj, prefix, origText);
      if (specialErr) return specialErr;
    } else {
      // Generic numeric-column enforcement (bar / line / pie / etc.)
      var labelCol = obj.labelCol != null ? obj.labelCol : 0;
      if (!isFiniteNumber(labelCol) || labelCol < 0 || labelCol >= expectedCols) {
        return err(
          prefix + "\"labelCol\" (" + labelCol + ") is out of range for " + expectedCols + " columns.",
          'The "labelCol" index must be 0..' + (expectedCols - 1) +
          ". Remove it to let the plugin default to 0. Return ONLY the corrected JSON.",
          origText
        );
      }
      for (var rr = 0; rr < obj.rows.length; rr++) {
        for (var cc = 0; cc < expectedCols; cc++) {
          if (cc === labelCol) continue;
          var val = obj.rows[rr][cc];
          if (typeof val === "number") continue;
          if (typeof val === "string" && val.trim() !== "" && isFinite(Number(val.replace(/,/g, "")))) continue;
          if (val === null || val === "" || val === undefined) continue;
          return err(
            prefix + 'Column "' + obj.headers[cc] + '" expects a number, but row ' +
            (rr + 1) + " has " + JSON.stringify(val) + ".",
            'Column "' + obj.headers[cc] + '" must contain numbers only. ' +
            "Replace non-numeric values with 0 or remove those rows. " +
            "Return ONLY the corrected JSON.",
            origText
          );
        }
      }
    }

    // Style
    if (obj.style != null) {
      if (!isString(obj.style) || SUPPORTED_STYLES.indexOf(obj.style) === -1) {
        return err(
          prefix + '"' + obj.style + '" isn\'t a valid style. Use one of: ' + SUPPORTED_STYLES.join(", ") + ".",
          'Change "style" to one of: "ocha" (UN blue, default), "hnrp", ' +
          '"flash", "gho". Return ONLY the corrected JSON.',
          origText
        );
      }
    }

    return { ok: true, parsed: obj };
  }

  // Validate timeline / keyfigures specific schema. Return null on OK,
  // or an err shape on failure.
  function validateSpecialSchema(obj, prefix, origText) {
    var lowered = obj.headers.map(function (h) { return String(h || "").toLowerCase().trim(); });

    if (obj.chartType === "timeline") {
      var hasDate = lowered.indexOf("date") !== -1;
      var hasLabel = lowered.indexOf("label") !== -1;
      var hasDesc = lowered.indexOf("description") !== -1;
      if (!hasDate) {
        return err(
          prefix + 'Timeline needs a "Date" column in headers.',
          'For a timeline, include a column named "Date". Also include at ' +
          'least one of "Label" or "Description". Example headers: ' +
          '["Date", "Label", "Description"]. Return ONLY the corrected JSON.',
          origText
        );
      }
      if (!hasLabel && !hasDesc) {
        return err(
          prefix + 'Timeline needs at least one of "Label" or "Description" in headers.',
          'For a timeline, include a "Date" column plus at least one of ' +
          '"Label" or "Description". Return ONLY the corrected JSON.',
          origText
        );
      }
      return null;
    }

    if (obj.chartType === "keyfigures") {
      if (obj.headers.length < 2) {
        return err(
          prefix + 'Key Figures needs at least 2 columns (Figure + Heading; Body optional).',
          'For Key Figures, provide columns like ["Figure", "Heading", "Body"]. ' +
          '"Figure" is the headline number (e.g. "2.3M", "45%"), "Heading" is a ' +
          'short label, "Body" is optional extra context. Return ONLY the corrected JSON.',
          origText
        );
      }
      return null;
    }

    if (obj.chartType === "sankey") {
      // 3 columns = classic edge list (Source, Target, Value).
      // 5+ columns (odd) = multi-level flow, INTERLEAVED: step and value
      // columns alternate so each value sits between the two steps it
      // connects (steps at even indexes 0,2,4…, values at odd indexes).
      // Each link carries its own value; step totals don't need to add up.
      // This mirrors DataStore.toSankeyData. NEVER chain levels by
      // repeating a label in Source and Target — repeated labels render as
      // two separate nodes under the default "Respect columns" mode.
      var nCols = obj.headers.length;
      var sankeyFormatHint =
        'For a 2-level Sankey provide ["Source", "Target", "Value"] (one flow per row). ' +
        'For a multi-level Sankey ALTERNATE step and value columns so each value sits between ' +
        'the two steps it connects, e.g. ["Source", "Value 1", "Intermediate", "Value 2", "Target"] ' +
        'where each row is one complete path: ["Funding", 120, "Health", 70, "Sudan"] means ' +
        'Funding→Health = 120 and Health→Sudan = 70. Return ONLY the corrected JSON.';
      if (nCols < 3 || (nCols > 3 && nCols % 2 === 0)) {
        return err(
          prefix + 'Sankey needs 3 columns (2-level) or an odd column count for multi-level ' +
          '(alternating step and value columns); got ' + nCols + '.',
          sankeyFormatHint,
          origText
        );
      }
      var interleavedS = (nCols > 3);
      var stageCount = interleavedS ? (nCols + 1) / 2 : 2;
      var stepIdx = function (s) { return interleavedS ? s * 2 : s; };
      for (var sr = 0; sr < obj.rows.length; sr++) {
        var rowS = obj.rows[sr];
        // A row needs at least two non-empty step cells to form a link.
        var filledStages = 0;
        for (var sc2 = 0; sc2 < stageCount; sc2++) {
          var stCell = rowS[stepIdx(sc2)];
          if (stCell != null && String(stCell).trim() !== "") filledStages++;
        }
        if (filledStages < 2) {
          return err(
            prefix + 'Sankey row ' + (sr + 1) + ' needs at least a source and a target step.',
            "Every Sankey row must name at least two steps of the flow. " + sankeyFormatHint,
            origText
          );
        }
        // Every value cell must be numeric (or empty for an unused step).
        var hasNumericValue = false;
        for (var vcIdx = (interleavedS ? 1 : 2); vcIdx < nCols; vcIdx += (interleavedS ? 2 : 1)) {
          var valCell = rowS[vcIdx];
          if (typeof valCell === "number") { hasNumericValue = true; continue; }
          if (valCell === null || valCell === "" || valCell === undefined) continue;
          if (typeof valCell === "string" && valCell.trim() !== "" &&
              isFinite(Number(valCell.replace(/,/g, "")))) { hasNumericValue = true; continue; }
          return err(
            prefix + 'Sankey row ' + (sr + 1) + ', column ' + (vcIdx + 1) +
            ': value must be a number, got ' + JSON.stringify(valCell) + ".",
            "Sankey value columns must contain positive numbers (the size of each flow step). " +
            sankeyFormatHint,
            origText
          );
        }
        if (!hasNumericValue) {
          return err(
            prefix + 'Sankey row ' + (sr + 1) + ' has no numeric value.',
            "Every Sankey row needs at least one numeric value for its flow. " + sankeyFormatHint,
            origText
          );
        }
      }
      return null;
    }

    if (obj.chartType === "table") {
      // Tables accept any column structure — no extra checks. The
      // generic header/rows length validation already happened.
      return null;
    }

    return null;
  }

  // Top-level validate — returns { ok, isBatch, charts } or err shape.
  function validate(jsonText) {
    var p = parseInput(jsonText);
    if (!p.ok) return p;

    var n = normalizeToChartList(p.parsed, jsonText);
    if (!n.ok) return n;

    var validated = [];
    for (var i = 0; i < n.charts.length; i++) {
      var prefix = n.isBatch
        ? ("Chart " + (i + 1) + " of " + n.charts.length + ": ")
        : "";
      var res = validateOneChart(n.charts[i], prefix, jsonText);
      if (!res.ok) return res;
      validated.push(res.parsed);
    }

    return { ok: true, isBatch: n.isBatch, charts: validated };
  }

  // Build a structured error object. `orig` is the user's original JSON
  // text, so the AI fix-prompt can include it so whichever LLM they
  // paste into has full context for producing a fix.
  function err(human, aiInstruction, orig) {
    var fixPrompt =
      "I tried to import JSON into the OCHA DataViz plugin but it rejected it with this error:\n\n" +
      "  " + human + "\n\n" +
      aiInstruction + "\n\nOriginal JSON was:\n\n" + orig;
    return {
      ok: false,
      error: { human: human, aiPrompt: fixPrompt }
    };
  }

  // ─── Expand simplified schema → internal config ───────
  // Produces a JSON string that DataStore.loadFromConfig accepts.

  function expand(parsed) {
    var headers = parsed.headers.slice();
    var labelCol = parsed.labelCol != null ? parsed.labelCol : 0;
    var chartType = parsed.chartType;
    var isSpecial = !!SPECIAL_SCHEMA_TYPES[chartType];

    // Row cleanup. Three paths:
    //   - Generic (bar / line / pie / donut / bubble / cluster / stacked /
    //     icon): coerce non-label cells to numbers so the renderer doesn't
    //     have to worry about it.
    //   - Sankey: cols 0+1 stringified (source/target labels), col 2
    //     coerced to number (flow magnitude).
    //   - Other special (timeline / keyfigures / table): keep cells as-is.
    //     Timeline is all-text. Key Figures col 0 may be a string like
    //     "2.3M" or a real number — toKeyFiguresData parses either. Tables
    //     pass through verbatim. Forcing numeric coercion would destroy
    //     strings like "Date" → 0.
    var coerceNumber = function (val) {
      if (typeof val === "number") return val;
      if (val == null || val === "") return 0;
      if (typeof val === "string") {
        var n = Number(val.replace(/,/g, ""));
        return isFinite(n) ? n : 0;
      }
      return 0;
    };
    var cleanRows = parsed.rows.map(function (row) {
      if (chartType === "sankey") {
        // 3 columns: Source, Target + value in the last column.
        // 5+ (odd), interleaved: steps at even indexes, values at odd —
        // mirror DataStore.toSankeyData's split.
        var sankeyN = parsed.headers.length;
        return row.map(function (cell, ci) {
          var isValueCol = (sankeyN === 3) ? (ci === 2) : (ci % 2 === 1);
          if (isValueCol) return coerceNumber(cell);
          return cell == null ? "" : String(cell);
        });
      }
      return row.map(function (val, idx) {
        if (isSpecial) {
          if (val == null) return "";
          // Numbers stay numbers; strings stay strings — no coercion.
          return (typeof val === "number") ? val : String(val);
        }
        if (idx === labelCol) return val == null ? "" : String(val);
        return coerceNumber(val);
      });
    });

    // Infer valueCol / valueCols when omitted.
    var valueCol = parsed.valueCol;
    var valueCols = parsed.valueCols;
    if (isSpecial) {
      // Timeline / Key Figures / Sankey / Table use header-name or
      // fixed positional lookup at render time — labelCol / valueCol
      // aren't consulted by the chart code itself, but loadFromConfig
      // persists them, so set safe defaults. Sankey's first value column
      // is col 2 (classic 3-col) or col 1 (interleaved multi-level).
      if (chartType === "sankey") {
        if (valueCol == null) valueCol = (headers.length === 3) ? 2 : 1;
      } else if (valueCol == null) {
        valueCol = headers.length > 1 ? 1 : 0;
      }
      valueCols = null;
    } else if (MULTI_VALUE_TYPES[chartType]) {
      if (!isArray(valueCols) || !valueCols.length) {
        valueCols = [];
        for (var vc = 0; vc < headers.length; vc++) {
          if (vc !== labelCol) valueCols.push(vc);
        }
      }
      // valueCol still needs to be something sane for fallback code paths
      if (valueCol == null) valueCol = valueCols[0];
    } else {
      if (valueCol == null) {
        valueCol = labelCol === 0 ? (headers.length > 1 ? 1 : 0) : 0;
      }
      valueCols = null;
    }

    // Build the internal config shape. loadFromConfig defaults
    // everything we omit — so we only set the fields we know about.
    var cfg = {
      v: 1,
      chartType: chartType,
      chartTitle: parsed.title || "",
      chartSubtitle: parsed.subtitle || "",
      chartComments: parsed.comments || "",
      chartFooter: parsed.footer || "",
      // Inherit the theme the user currently has selected (a built-in OR a
      // custom theme) when the AI didn't name one. The AI is gated to the 4
      // built-in styles, so custom brand themes reach AI-imported charts ONLY
      // through this inheritance: pick a theme in the panel, then import, and
      // the whole batch renders in it. The prompt template tells Copilot to
      // OMIT "style" unless the user explicitly asks for a product look — keep
      // these two in sync. Reverting this to "ocha" silently forces every
      // AI-imported chart back to OCHA blue regardless of the selected theme.
      style: parsed.style || (_store && _store.style) || "ocha",
      headers: headers,
      rows: cleanRows,
      labelCol: labelCol,
      valueCol: valueCol,
      valueCols: valueCols
    };

    // Pass through any optional internal-schema fields the LLM provided
    // verbatim. Safe because loadFromConfig re-validates/coerces each.
    //
    // MAINTAINER NOTE: when a new tweakable chart setting is added to
    // DataStore (anywhere `store.X = c.X` appears in `loadFromConfig`),
    // and you want the AI flow to be able to set it from imported JSON,
    // add the field name here. One line. Without this entry, even if
    // Copilot sends `"newField": value` the plugin will silently drop it.
    // If the field should also be ACTIVELY chosen by the AI (not just
    // accepted when present), add a short mention to
    // `ai-prompt-template.js`. See `CLAUDE.md` "Plugin-internal sync
    // rules" for the full checklist.
    var passthrough = [
      "chartWidth", "chartHeight",
      "axisMax", "hideZeroLabels", "autoSort",
      "barLabelMode",
      "stackedLegend", "stackedStroke", "stackedStrokeWidth", "stackedStrokeColor",
      "shade", "lineShowDots", "lineDotSize", "lineLabelPos", "lineLabelBg",
      "lineValueLabels", "lineSeriesEndLabels", "lineLegend", "lineShowYAxis", "lineHiddenLabels",
      "numberFormat", "valuePrefix", "valueSuffix",
      "colors",
      // Text wrap-zone widths (% of chart width; default 100 = full width)
      "headerTextWidth", "footerTextWidth",
      // Per-type orientation / layout toggles
      "bubbleOrientation", "bubbleSeparation",
      "timelineOrientation", "timelineEventSpacing", "timelineCategoryColors",
      "clusterOrientation",
      // Donut / pie tweaks
      "donutHole", "donutCenterTitle", "donutCenterLabel", "donutCenterAuto", "clusterDonutLegend", "clusterDonutCategoryColors", "sliceColors", "pieLegend",
      "pieLabelMode", "pieLabelContent", "pieLeaderLines", "pieLabelDistance",
      // Key Figures: bodyCol is positional (defaults to 2)
      "bodyCol",
      // Icon chart: shape (built-in: man/woman/people/dot/square),
      // size, legend display, optional per-row icon overrides
      "iconShape", "iconSize", "iconShowLegend", "iconLegendLayout",
      "iconLegendLabels", "rowIcons",
      // Row icons/flags decoration on bar-family charts (hbar/vbar/
      // stacked-bar/stacked-col/table/keyfigures). Per-row refs come in
      // rowIconRefs, handled below into iconSelections.
      "iconColType",
      // Sankey: node/link styling + same-label handling
      "sankeyNodeWidth", "sankeyNodePadding", "sankeyLinkOpacity", "sankeyLabelMode", "sankeyNodeMode"
    ];
    for (var p = 0; p < passthrough.length; p++) {
      var k = passthrough[p];
      if (parsed[k] != null) cfg[k] = parsed[k];
    }

    // Friendly alias: `legend: true` → `stackedLegend: true` (the
    // internal field name is stacked-specific but users think "legend").
    if (parsed.legend != null && cfg.stackedLegend == null) {
      cfg.stackedLegend = !!parsed.legend;
    }
    // Friendly alias: `width` / `height` → internal names
    if (parsed.width != null && cfg.chartWidth == null) cfg.chartWidth = parsed.width;
    if (parsed.height != null && cfg.chartHeight == null) cfg.chartHeight = parsed.height;

    // Row icons / flags on bar-family charts. iconColType arrives via the
    // passthrough; the per-row references arrive in rowIconRefs (parallel to
    // rows) and become iconSelections (which loadFromConfig persists and
    // toChartData reads). For flags, default to each row's label (usually the
    // country name) when no refs are given — resolveFlag matches name or code.
    if (cfg.iconColType === "flags" || cfg.iconColType === "icons") {
      var iconRefs = isArray(parsed.rowIconRefs) ? parsed.rowIconRefs.slice() : [];
      if (cfg.iconColType === "flags" && !iconRefs.length) {
        iconRefs = cleanRows.map(function (r) { return r[labelCol]; });
      }
      if (iconRefs.length) {
        cfg.iconSelections = iconRefs.map(function (v) {
          return (v == null || v === "") ? null : String(v);
        });
      }
    }

    return JSON.stringify(cfg);
  }

  // ─── Main import ──────────────────────────────────────

  // Soft cap on batch size. The user-facing rule is communicated to the
  // AI via the prompt template ("up to 20 charts per array"); this is
  // the validator-side enforcement in case the AI ignores the cap.
  // Bumped from 10 to 20 (2026-04-25) after a 10-chart stress test
  // placed in ~1 second on Javier's machine. If the horizontal row
  // ever becomes unwieldy for big batches, the next move is a grid
  // layout in `placeChartOnNewArtboard` (host/index.jsx) — compute
  // row + column from slotIdx instead of just column.
  var MAX_BATCH = 20;

  function doImport(jsonText) {
    lastOriginalJson = jsonText;
    var v = validate(jsonText);
    if (!v.ok) return v;

    // ── Batch flow ────────────────────────────────────────
    // Validator already accepts arrays / { charts: [...] } / wrapped
    // single objects. For batch we expand each chart up front (so any
    // per-chart error surfaces here, not mid-placement), stash the
    // expanded configs in module state, and return a summary the
    // modal can use to render the "Found N charts" review pane.
    if (v.isBatch) {
      if (v.charts.length > MAX_BATCH) {
        return err(
          "This paste contains " + v.charts.length + " charts. The plugin places at most " +
          MAX_BATCH + " in one batch. Split into smaller pastes.",
          "Return a JSON ARRAY with at most " + MAX_BATCH + " chart objects, " +
          "prioritising the most important ones. The user can run a second batch " +
          "for the rest.",
          jsonText
        );
      }

      var summary = [];
      var expandedConfigs = [];
      for (var bi = 0; bi < v.charts.length; bi++) {
        var bChart = v.charts[bi];
        try {
          var bInternal = expand(bChart);
          expandedConfigs.push(bInternal);
          summary.push({
            index: bi,
            chartType: bChart.chartType,
            title: (bChart.title && String(bChart.title).trim()) || ("Chart " + (bi + 1)),
            rowCount: bChart.rows.length
          });
        } catch (e) {
          return err(
            "Chart " + (bi + 1) + " of " + v.charts.length + " couldn't be processed: " + e.message,
            "Re-check chart " + (bi + 1) + " in the array. Return ONLY the corrected " +
            "JSON ARRAY with all " + v.charts.length + " charts (only chart " + (bi + 1) +
            " needs fixing).",
            jsonText
          );
        }
      }
      lastBatchConfigs = expandedConfigs;
      return {
        ok: true,
        isBatch: true,
        count: summary.length,
        summary: summary
      };
    }

    // ── Single-chart flow (original) ──────────────────────
    lastBatchConfigs = null;  // clear any stale batch state from prior paste

    var single = v.charts[0];
    var internalJson;
    try {
      internalJson = expand(single);
    } catch (e) {
      return err(
        "Couldn't expand the AI JSON to the internal config: " + e.message,
        "Return a simpler JSON matching the schema exactly — no extra fields.",
        jsonText
      );
    }

    var loadResult = _store.loadFromConfig(internalJson);
    if (loadResult.error) {
      return err(
        loadResult.error,
        "The config loader rejected the imported JSON. " +
        "Regenerate it matching the schema exactly. Return ONLY the corrected JSON.",
        jsonText
      );
    }

    // Mirror the CSV-import post-load pattern (panel.js:764+)
    if (_pushUndo) _pushUndo();
    if (_syncUI) _syncUI();
    if (_renderGrid) _renderGrid();
    if (_generate) _generate();

    track("ai:place:single");
    return {
      ok: true,
      isBatch: false,
      chartType: single.chartType,
      rowCount: single.rows.length
    };
  }

  // ─── Clipboard ────────────────────────────────────────

  function copyToClipboard(text) {
    // CEP reality check: navigator.clipboard.writeText() returns a
    // Promise and silently fails in older Chromium embedded in
    // Illustrator. The rest of the plugin uses the synchronous
    // execCommand("copy") path (see data-grid.js doCopy). Mirror that.
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      // Place off-screen but inside the document (execCommand requires
      // the element to be in the DOM and selectable).
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.width = "1px";
      ta.style.height = "1px";
      ta.style.padding = "0";
      ta.style.border = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      // Preserve the caller's current focused element so we can restore
      // it after the copy operation.
      var previous = document.activeElement;
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (previous && typeof previous.focus === "function") {
        try { previous.focus(); } catch (e) { /* ignore */ }
      }
      return ok;
    } catch (e) {
      return false;
    }
  }

  function copyPrompt() {
    var tmpl = (typeof AI_PROMPT_TEMPLATE !== "undefined") ? AI_PROMPT_TEMPLATE : "";
    if (!tmpl) {
      if (_showStatus) _showStatus("AI prompt template is missing.", "error");
      return;
    }
    var ok = copyToClipboard(tmpl);
    if (ok) track("ai:copy_prompt");
    if (_showStatus) {
      if (ok) {
        _showStatus("AI prompt copied. Paste it into your AI (Copilot, ChatGPT, Claude, Gemini) as a FIRST message, then send your data, screenshot, document, or description. The AI will help you in the process and return the JSON code to paste below.", "success");
        if (_clearStatus) setTimeout(_clearStatus, 12000);
      } else {
        _showStatus("Couldn't copy to clipboard. Try again or copy the prompt from ai-prompt-template.js manually.", "error");
        if (_clearStatus) setTimeout(_clearStatus, 6000);
      }
    }
  }

  // ─── Modal controller ─────────────────────────────────

  function openModal() {
    if (!modalEl) return;
    hideError();
    exitBatchMode();    // ensure a fresh paste mode every time the modal opens
    if (textareaEl) {
      textareaEl.value = "";
      setTimeout(function () { textareaEl.focus(); }, 0);
    }
    modalEl.style.display = "flex";
    track("ai:open");
  }

  function closeModal() {
    if (modalEl) modalEl.style.display = "none";
    hideError();
    exitBatchMode();
  }

  function showError(error) {
    if (!errorBlockEl || !errorMsgEl) return;
    errorMsgEl.textContent = error.human;
    lastAiFixPrompt = error.aiPrompt || "";
    errorBlockEl.style.display = "block";
  }

  function hideError() {
    if (errorBlockEl) errorBlockEl.style.display = "none";
    lastAiFixPrompt = "";
  }

  function onImportClick() {
    // The footer submit button is repurposed in batch-review mode — when
    // the modal is showing the "Found N charts" summary, the same button
    // becomes "Place all N charts" and routes to the batch handler.
    if (modalEl && modalEl.classList.contains("ai-import-batch-mode")) {
      onPlaceBatchClick();
      return;
    }

    var text = textareaEl ? textareaEl.value : "";
    if (!text || !text.trim()) {
      showError({
        human: "Paste some JSON first, then click Import.",
        aiPrompt: ""
      });
      return;
    }
    var result = doImport(text.trim());
    if (!result.ok) {
      showError(result.error);
      return;
    }

    // Batch detected → swap the modal into review mode (textarea hidden,
    // summary list shown, footer button relabeled to "Place all").
    if (result.isBatch) {
      enterBatchMode(result);
      return;
    }

    // Single-chart success — close modal, toast the outcome
    closeModal();
    if (_showStatus) {
      _showStatus(
        "Imported " + result.rowCount + " rows (" + result.chartType + ") from AI.",
        "success"
      );
      if (_clearStatus) setTimeout(_clearStatus, 7000);
    }
  }

  // ─── Batch review mode ────────────────────────────────
  // Friendly chart-type labels used in the summary list (matches the
  // picker tile labels the user sees in the panel).
  var TYPE_LABELS = {
    "hbar":         "Horizontal Bar",
    "vbar":         "Column",
    "stacked-bar":  "Stacked Bar",
    "stacked-col":  "Stacked Column",
    "cluster":      "Cluster Bar",
    "line":         "Line Chart",
    "donut":        "Donut Chart",
    "pie":          "Pie Chart",
    "bubble":       "Bubble Chart",
    "icon":         "Icon Chart",
    "table":        "Data Table",
    "sankey":       "Sankey / Alluvial",
    "keyfigures":   "Key Figures",
    "timeline":     "Timeline"
  };

  // Currently-selected layout mode for the batch flow.
  // "single" → one chart per new artboard (default; canonical for
  //            multi-page deliverables).
  // "grid"   → many charts per new artboard, packed in a grid (a quick
  //            way to lay out a one-pager). Pixel-perfection isn't
  //            promised — overlap is acceptable as the trade-off for
  //            speed.
  var lastLayoutMode = "single";

  // Look up the sidebar-button SVG for a given chartType and return a
  // cloned, scoped HTML snippet. Reuses the existing icons that live in
  // index.html's chart-type sidebar so the batch summary list always
  // shows the same iconography the user already recognises from the
  // panel — no duplicated asset, no separate maintenance.
  // Returns "" when no matching sidebar button is found.
  function chartIconHtml(chartType) {
    if (!chartType) return "";
    var sidebarBtn = document.querySelector('.sidebar-btn[data-chart="' + chartType + '"]');
    if (!sidebarBtn) return "";
    var svg = sidebarBtn.querySelector("svg");
    if (!svg) return "";
    // Clone, then set our scoping class so the row CSS can size and
    // colour the icon independently of the sidebar styling.
    var clone = svg.cloneNode(true);
    clone.setAttribute("class",
      (clone.getAttribute("class") || "") + " ai-import-batch-row-icon");
    // Strip width/height attrs if any so CSS can size deterministically.
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    // Wrap in a temporary container to get the outerHTML reliably.
    var wrap = document.createElement("div");
    wrap.appendChild(clone);
    return wrap.innerHTML;
  }

  function enterBatchMode(result) {
    if (!modalEl) return;
    hideError();
    modalEl.classList.add("ai-import-batch-mode");

    // Reset to the safe default each time the modal opens. Sticky-mode
    // would be confusing — the user should consciously pick "grid" when
    // they want it, not inherit it from a previous batch.
    lastLayoutMode = "single";

    // Populate the summary list. Each row is a <label> wrapping a
    // checkbox so clicking anywhere on the row toggles selection
    // (native HTML behaviour, no JS click-target gymnastics needed).
    // The cloned sidebar icon next to each title gives a quick visual
    // cue of the chart type matching the panel's chart-type picker.
    if (batchSummaryEl) {
      var rowsHtml = "";
      for (var i = 0; i < result.summary.length; i++) {
        var s = result.summary[i];
        var typeLabel = TYPE_LABELS[s.chartType] || s.chartType;
        var iconHtml = chartIconHtml(s.chartType);
        rowsHtml +=
          '<li class="ai-import-batch-row-li">' +
            '<label class="ai-import-batch-row" data-slot="' + i + '">' +
              '<input type="checkbox" class="ai-import-batch-row-cb" ' +
                     'data-slot="' + i + '" checked>' +
              '<span class="ai-import-batch-row-num">' + (i + 1) + '.</span>' +
              '<span class="ai-import-batch-row-iconwrap">' + iconHtml + '</span>' +
              '<span class="ai-import-batch-row-title">' + escapeHtml(s.title) + '</span>' +
              '<span class="ai-import-batch-row-type">' + escapeHtml(typeLabel) + '</span>' +
            '</label>' +
          '</li>';
      }
      // Layout: header (with bulk-action toolbar) → list → back link →
      // (push to bottom) → hint → toggle. Toggle sits right above the
      // modal footer's Place button so the decision the toggle controls
      // is adjacent to the action.
      batchSummaryEl.innerHTML =
        '<div class="ai-import-batch-header">' +
          '<span class="ai-import-batch-header-text">Found ' + result.count + ' charts in this paste</span>' +
          '<span class="ai-import-batch-bulk">' +
            '<button type="button" class="btn-link ai-import-batch-bulk-btn" data-bulk="all">Select all</button>' +
            '<span class="ai-import-batch-bulk-sep">·</span>' +
            '<button type="button" class="btn-link ai-import-batch-bulk-btn" data-bulk="none">None</button>' +
          '</span>' +
        '</div>' +
        '<ol class="ai-import-batch-list">' + rowsHtml + '</ol>' +
        '<button type="button" class="btn-link ai-import-batch-back">' +
          '\u2190 Back to paste' +
        '</button>' +
        '<div class="ai-import-batch-bottom">' +
          '<div class="ai-import-batch-hint" id="ai-import-batch-hint-text">' +
            (ON_WEB
              ? 'The selected charts are downloaded together as one ZIP of SVG files.'
              : 'Each chart goes on its own new artboard, in a row to the right of your current one. ' +
                'Best for multi-page deliverables.') +
          '</div>' +
          (ON_WEB ? '' :
          '<div class="ai-import-batch-toggle" role="radiogroup" aria-label="Layout mode">' +
            '<button type="button" class="ai-import-batch-toggle-btn is-active" ' +
                    'data-layout="single" role="radio" aria-checked="true">' +
              'One per artboard' +
            '</button>' +
            '<button type="button" class="ai-import-batch-toggle-btn" ' +
                    'data-layout="grid" role="radio" aria-checked="false">' +
              'Grid (fewer artboards)' +
            '</button>' +
          '</div>') +
        '</div>';
      // Use "flex" to match the CSS rule (flex-direction: column).
      // Setting "block" here would override the flex layout.
      batchSummaryEl.style.display = "flex";

      // Helper: count the currently-checked rows.
      function countSelected() {
        var checks = batchSummaryEl.querySelectorAll(".ai-import-batch-row-cb");
        var n = 0;
        for (var c = 0; c < checks.length; c++) {
          if (checks[c].checked) n++;
        }
        return n;
      }

      // Refresh the footer submit button label based on (a) current
      // layout mode and (b) number of selected charts. Disable the
      // button when nothing is selected.
      function updatePlaceButtonLabel() {
        if (!importBtn) return;
        var n = countSelected();
        var total = result.count;
        if (n === 0) {
          importBtn.textContent = "Select at least one chart";
          importBtn.disabled = true;
          return;
        }
        importBtn.disabled = false;
        var allSelected = (n === total);
        if (ON_WEB) {
          importBtn.textContent = allSelected
            ? "Download all " + total + " as ZIP"
            : "Download " + n + " as ZIP";
        } else if (lastLayoutMode === "grid") {
          importBtn.textContent = allSelected
            ? "Place all " + total + " in a grid"
            : "Place " + n + " in a grid";
        } else {
          importBtn.textContent = allSelected
            ? "Place all " + total + " charts"
            : "Place " + n + " selected";
        }
      }

      // Wire the layout-mode toggle. Clicking either button updates the
      // active state, the hint text, and the footer submit-button label.
      var toggleBtns = batchSummaryEl.querySelectorAll(".ai-import-batch-toggle-btn");
      var hintEl = batchSummaryEl.querySelector("#ai-import-batch-hint-text");
      function selectLayout(mode) {
        lastLayoutMode = mode;
        for (var b = 0; b < toggleBtns.length; b++) {
          var btn = toggleBtns[b];
          var isActive = btn.getAttribute("data-layout") === mode;
          btn.classList.toggle("is-active", isActive);
          btn.setAttribute("aria-checked", isActive ? "true" : "false");
        }
        if (hintEl) {
          hintEl.textContent = (mode === "grid")
            ? "Charts will be packed into a grid on as few new artboards as fit. Cell size is auto-calculated from your artboard. Quick layout for one-pagers — small overlaps are possible."
            : "Each chart goes on its own new artboard, in a row to the right of your current one. Best for multi-page deliverables.";
        }
        updatePlaceButtonLabel();
      }
      for (var t = 0; t < toggleBtns.length; t++) {
        toggleBtns[t].addEventListener("click", (function (mode) {
          return function () { selectLayout(mode); };
        })(toggleBtns[t].getAttribute("data-layout")));
      }

      // Wire per-row checkboxes — every change refreshes the place
      // button's label & enabled state.
      var rowCheckboxes = batchSummaryEl.querySelectorAll(".ai-import-batch-row-cb");
      for (var r = 0; r < rowCheckboxes.length; r++) {
        rowCheckboxes[r].addEventListener("change", updatePlaceButtonLabel);
      }

      // Wire the bulk-action buttons (Select all / None).
      var bulkBtns = batchSummaryEl.querySelectorAll(".ai-import-batch-bulk-btn");
      for (var bi = 0; bi < bulkBtns.length; bi++) {
        bulkBtns[bi].addEventListener("click", (function (mode) {
          return function (e) {
            e.preventDefault();
            var checked = (mode === "all");
            var checks = batchSummaryEl.querySelectorAll(".ai-import-batch-row-cb");
            for (var c = 0; c < checks.length; c++) {
              checks[c].checked = checked;
            }
            updatePlaceButtonLabel();
          };
        })(bulkBtns[bi].getAttribute("data-bulk")));
      }

      // Wire the back link
      var backBtn = batchSummaryEl.querySelector(".ai-import-batch-back");
      if (backBtn) backBtn.addEventListener("click", exitBatchMode);

      // Initial label sync (all-selected on enter)
      updatePlaceButtonLabel();
    }
  }

  function exitBatchMode() {
    if (!modalEl) return;
    modalEl.classList.remove("ai-import-batch-mode");
    if (batchSummaryEl) {
      batchSummaryEl.style.display = "none";
      batchSummaryEl.innerHTML = "";
    }
    if (importBtn) importBtn.textContent = "Import chart";
  }

  function onPlaceBatchClick() {
    if (!_placeBatch) {
      showError({
        human: "Batch placement isn't wired up in this build. Reload the panel.",
        aiPrompt: ""
      });
      return;
    }
    if (!lastBatchConfigs || !lastBatchConfigs.length) {
      showError({
        human: "No batch ready to place. Paste the JSON array again.",
        aiPrompt: ""
      });
      return;
    }

    // We deliberately DO NOT close the modal until placement is either
    // confirmed in flight or rejected upfront. Reasoning:
    //   - The host first runs a preflight check (is there an open
    //     document with at least one artboard?). If that fails we want
    //     to keep the modal + batch summary visible so the user can
    //     open a document and click Place again without re-pasting.
    //   - On success the modal is closed before the toast fires so the
    //     user gets a clean view of the new artboards.
    // Filter to whatever rows the user has checked. Default state is
    // all-checked (set in enterBatchMode), so users who don't touch
    // the checkboxes get the same "place all" behaviour as before.
    var configs = [];
    if (batchSummaryEl) {
      var checks = batchSummaryEl.querySelectorAll(".ai-import-batch-row-cb");
      for (var c = 0; c < checks.length; c++) {
        if (checks[c].checked) {
          var slot = parseInt(checks[c].getAttribute("data-slot"), 10);
          if (!isNaN(slot) && slot >= 0 && slot < lastBatchConfigs.length) {
            configs.push(lastBatchConfigs[slot]);
          }
        }
      }
    }
    if (!configs.length) {
      // The button's disabled state should normally prevent this, but
      // surface a clear error if it ever fires (programmatic call,
      // weird DOM state, etc.).
      showError({
        human: "No charts selected. Tick at least one row, or click 'Select all'.",
        aiPrompt: ""
      });
      return;
    }
    var layoutMode = lastLayoutMode || "single";
    if (_showStatus) {
      var verb = ON_WEB ? "Preparing " + configs.length + " charts…" : (layoutMode === "grid")
        ? "Placing " + configs.length + " charts in a grid…"
        : "Placing " + configs.length + " charts in new artboards…";
      _showStatus(verb, "info");
    }
    // Pass the chosen layout mode through to panel.js's placeBatch as
    // an options object. Backward compat: panel.js's placeBatch
    // historically took (configs, onDone) — adding an opts arg between
    // them changes the signature, so we use (configs, opts, onDone).
    _placeBatch(configs, { layoutMode: layoutMode }, function (result) {
      if (result && result.preflightFailed) {
        // Modal stays open — surface the host error inline so the user
        // can fix it and retry the same batch. Force-clear the
        // "Placing N charts…" status (passing true to bypass any
        // persistence flag that might keep info-style status messages
        // around).
        if (_clearStatus) {
          try { _clearStatus(true); } catch (e) { _clearStatus(); }
        }
        showError({
          human: result.error || "Couldn't start the batch.",
          aiPrompt: ""
        });
        return;
      }

      // Placement was attempted (success or mid-batch failure). Close
      // the modal and report via status toast.
      closeModal();
      exitBatchMode();
      if (result && result.ok) {
        // Telemetry: completed batch placement, with mode + chart count
        // appended so the analytics sheet can break down single vs grid
        // and how big the batches users actually run are.
        var modeTag = ON_WEB ? "zip" : (result.layoutMode === "grid") ? "grid" : "single";
        track("ai:place:batch:" + modeTag + ":" + result.count);
      }
      if (!_showStatus) return;
      if (result && result.ok) {
        var skipped = result.skipped || 0;
        var total = result.total || result.count;
        var isGrid = result.layoutMode === "grid";
        var summary;
        if (ON_WEB) {
          summary = "Downloaded " + result.count + " chart" + (result.count === 1 ? "" : "s") +
            " as a ZIP of SVG files" + (skipped > 0 ? " (" + skipped + " of " + total +
            " couldn't be drawn and were left out)." : ".");
        } else if (skipped > 0) {
          summary = "Placed " + result.count + " of " + total + " charts (" +
            skipped + " skipped). Placed charts are editable individually.";
        } else if (isGrid) {
          summary = "Placed " + result.count + " charts in a grid. " +
            "Each cell is an individually editable chart group.";
        } else {
          summary = "Placed " + result.count + " charts in new artboards. " +
            "Each is editable individually.";
        }
        _showStatus(summary, "success");
        if (_clearStatus) setTimeout(_clearStatus, 9000);
      } else {
        var msg = (result && result.error) || "Batch placement failed.";
        _showStatus(msg, "error");
      }
    });
  }

  // Tiny HTML-escape for safely rendering chart titles into the summary
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function onCopyFixClick() {
    if (!lastAiFixPrompt) return;
    var ok = copyToClipboard(lastAiFixPrompt);
    if (ok) track("ai:fixprompt");
    if (_showStatus) {
      if (ok) {
        _showStatus("Fix prompt copied — paste into your AI to get corrected JSON.", "success");
        if (_clearStatus) setTimeout(_clearStatus, 7000);
      } else {
        _showStatus("Couldn't copy fix prompt.", "error");
        if (_clearStatus) setTimeout(_clearStatus, 5000);
      }
    }
  }

  function onTryAgainClick() {
    if (textareaEl) {
      textareaEl.value = "";
      textareaEl.focus();
    }
    hideError();
  }

  // ─── Init ─────────────────────────────────────────────

  function init(deps) {
    _store = deps.store || DataStore;
    _syncUI = deps.syncUI;
    _generate = deps.generate;
    _showStatus = deps.showStatus;
    _clearStatus = deps.clearStatus;
    _pushUndo = deps.pushUndo;
    _renderGrid = deps.renderGrid;
    _placeBatch = deps.placeBatch;  // function(configsArray, onDone)
    _sendAnalytics = deps.sendAnalytics;  // function(eventName) — optional

    modalEl        = document.getElementById("ai-import-modal");
    textareaEl     = document.getElementById("ai-import-textarea");
    importBtn      = document.getElementById("ai-import-submit");
    cancelBtn      = document.getElementById("ai-import-cancel");
    closeBtn       = document.getElementById("ai-import-close");
    errorBlockEl   = document.getElementById("ai-import-error");
    errorMsgEl     = document.getElementById("ai-import-error-msg");
    copyFixBtn     = document.getElementById("ai-import-copy-fix");
    tryAgainBtn    = document.getElementById("ai-import-try-again");
    batchSummaryEl = document.getElementById("ai-import-batch-summary");
    var copyPromptBtn = document.getElementById("ai-import-copy-prompt");

    if (importBtn) importBtn.addEventListener("click", onImportClick);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (copyFixBtn) copyFixBtn.addEventListener("click", onCopyFixClick);
    if (tryAgainBtn) tryAgainBtn.addEventListener("click", onTryAgainClick);
    if (copyPromptBtn) copyPromptBtn.addEventListener("click", copyPrompt);

    // ESC to close, Ctrl/Cmd+Enter to submit
    if (textareaEl) {
      textareaEl.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          onImportClick();
        }
      });
    }
    // Backdrop click closes the modal (click on the modal element itself
    // but not inside its content)
    if (modalEl) {
      modalEl.addEventListener("click", function (e) {
        if (e.target === modalEl) closeModal();
      });
    }
  }

  // ─── Public API ───────────────────────────────────────

  return {
    init: init,
    copyPrompt: copyPrompt,
    openModal: openModal,
    closeModal: closeModal,
    // Exposed for testability
    _validate: validate,
    _expand: expand,
    _doImport: doImport
  };
})();
