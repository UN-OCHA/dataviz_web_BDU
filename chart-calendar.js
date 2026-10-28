/**
 * Calendar / Planner Renderer ("calendar")
 *
 * A grid of columns along the top (months by default), one row per
 * item, marks in the columns. For seasonal calendars (floods, harvest,
 * wet seasons) and planning timelines (the HPC programme cycle).
 *
 * Columns (Design tab, calendarAxis.kind):
 *   months   – lang (en / fr / es), style (short Jan · upper JAN · full
 *              January), start month, count, optional year of the first
 *              month: the year then shows above its months and changes
 *              where they cross into the next year.
 *   quarters – Q1 … Q4 (T1 … T4 in French and Spanish), start quarter,
 *              count, optional year above, as for months.
 *   years    – count years from `year`.
 *   custom   – the labels typed by the user (calendarColumns) with
 *              optional group headings above them (calendarColumnGroups,
 *              same rule as the table's group titles: the same text on
 *              neighbouring columns = one heading over them).
 * No calendarAxis: custom when calendarColumns has labels (charts saved
 * before the presets), else Jan … Dec. chartColumns(config) turns any of
 * these into the columns the chart draws.
 *
 * Data: one line per mark (read by ChartRegistry.calendar.read):
 *
 *   Concept/Event | Start | End | Label | Category | Color
 *
 *   Only Start is required. Lines with the same name share one row.
 *   Start / End match a column label (case, accents and dots ignored).
 *   When the labels are months, any month spelling matches too ("mars",
 *   "March", "3" all find "Mar" or "Mars"), a label used twice (Jan … Dec,
 *   Jan) gets the mark in both places, and a span whose End comes before
 *   its Start wraps round the year (Dec–Apr = Jan–Apr + Dec).
 *
 * Mark per row, Design tab (calendarRowMarks): Auto (a bar when the line
 * has an End, a dot when not) · Bar · Dot (a dot in every column of a
 * span) · Line (a span = a thin line, a single column = a dot: the HPC
 * "plan drafted Oct–Dec, published Dec" row needs no extra column).
 *
 * Colours, most specific first: the mark's Color cell → the row's colour
 * (Design tab) → its category's colour → the style's main colour.
 *
 * Background (Design tab, "auto" by default): bars → white cells with
 * thin column lines; dots only → alternating grey columns.
 *
 * Layout follows the CLAUDE.md add-a-chart-type rules: R.computePlotTop /
 * R.computeFooterStart, flush-left (row labels, else the grid, at x = 0),
 * columns stretch to the full width (a time axis, like line charts),
 * R.wrapToFit for row names, column labels, group headings and bar
 * labels, red + "label-truncated" when they don't fit; rows and the
 * header grow to fit wrapped text.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  // ── Constants ───────────────────────────────────────────

  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Most columns the chart draws (5 years of months); more are dropped with a warning.
  var MAX_COLUMNS = 60;
  // Month labels per language and style. French and Spanish follow their
  // usual abbreviations (janv., févr. … / ene., feb. …), capitalised
  // because each one starts a label.
  var MONTH_LABELS = {
    en: {
      short: MONTH_NAMES,
      full: ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"]
    },
    fr: {
      short: ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin",
        "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."],
      full: ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
        "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
    },
    es: {
      short: ["Ene.", "Feb.", "Mar.", "Abr.", "May.", "Jun.",
        "Jul.", "Ago.", "Sept.", "Oct.", "Nov.", "Dic."],
      full: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
    }
  };
  // Quarter prefix per language: Q1 (quarter), T1 (trimestre).
  var QUARTER_PREFIX = { en: "Q", fr: "T", es: "T" };
  var AXIS_KINDS = { months: 1, quarters: 1, years: 1, custom: 1 };
  var AXIS_STYLES = { short: 1, upper: 1, full: 1 };
  // Light grey of the month columns and row bands (OCHA neutral grey ramp).
  var SHADE_COLOR = "#F2F2F2";
  // Dotted row rules — same grey as the minimal data table's rules.
  var RULE_COLOR = "#BFBFBF";

  // Month words, without accents, in English, French and Spanish, so a
  // pasted calendar reads in the languages OCHA publishes most.
  var MONTH_WORDS = {
    jan: 0, january: 0, janv: 0, janvier: 0, ene: 0, enero: 0,
    feb: 1, febr: 1, february: 1, fev: 1, fevr: 1, fevrier: 1, febrero: 1,
    mar: 2, march: 2, mars: 2, marzo: 2,
    apr: 3, april: 3, avr: 3, avril: 3, abr: 3, abril: 3,
    may: 4, mai: 4, mayo: 4,
    jun: 5, june: 5, juin: 5, junio: 5,
    jul: 6, july: 6, juil: 6, juillet: 6, julio: 6,
    aug: 7, august: 7, aout: 7, ago: 7, agosto: 7,
    sep: 8, sept: 8, september: 8, septembre: 8, septiembre: 8, setiembre: 8,
    oct: 9, october: 9, octobre: 9, octubre: 9,
    nov: 10, november: 10, novembre: 10, noviembre: 10,
    dec: 11, december: 11, decembre: 11, dic: 11, diciembre: 11
  };

  // Column names recognised in the data (lower case). First match wins.
  var COLUMN_NAMES = {
    row: ["row", "rows", "item", "activity", "task", "name", "event", "process", "phase",
      "concept", "concept/event", "concept / event", "event/concept"],
    start: ["start", "start month", "start date", "from", "begin", "starts", "month", "date"],
    end: ["end", "end month", "end date", "to", "until", "finish", "ends"],
    label: ["label", "bar label", "text"],
    category: ["category", "group", "theme"],
    color: ["color", "colour"]
  };

  // ── Reading the data ────────────────────────────────────

  function plain(s) {
    s = String(s == null ? "" : s).toLowerCase().trim();
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s;
  }

  function validMonth(n) { return isFinite(n) && n >= 1 && n <= 12 && Math.floor(n) === n; }

  /**
   * One month cell → { m: 0–11, y: year | null }, or null when it can't be
   * read. Accepts month names and abbreviations (EN / FR / ES), numbers
   * 1–12, and a year anywhere ("Mar 2027", "2027-03", "03/2027",
   * "15/03/2027", "Mar '27").
   */
  function parseMonth(v) {
    if (v == null) return null;
    if (typeof v === "number") return validMonth(v) ? { m: v - 1, y: null } : null;
    var s = String(v).trim();
    if (!s) return null;
    var mt;
    if ((mt = /^(\d{4})[-\/.](\d{1,2})(?:[-\/.]\d{1,2})?$/.exec(s))) {
      return validMonth(+mt[2]) ? { m: +mt[2] - 1, y: +mt[1] } : null;
    }
    if ((mt = /^(\d{1,2})[-\/.](\d{4})$/.exec(s))) {
      return validMonth(+mt[1]) ? { m: +mt[1] - 1, y: +mt[2] } : null;
    }
    if ((mt = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(s))) {
      // Day first (UN usage); month first only when the first number can't be a month.
      var a = +mt[1], b = +mt[2];
      var mon = validMonth(b) ? b : (validMonth(a) ? a : 0);
      return mon ? { m: mon - 1, y: +mt[3] } : null;
    }
    if (/^\d{1,2}$/.test(s)) return validMonth(+s) ? { m: +s - 1, y: null } : null;

    var p = plain(s);
    var words = p.split(/[\s,\-\/.]+/);
    var m = -1, y = null;
    for (var i = 0; i < words.length; i++) {
      var w = words[i].replace(/'/g, "");
      if (m === -1 && MONTH_WORDS.hasOwnProperty(w)) { m = MONTH_WORDS[w]; continue; }
      if (y == null && /^\d{4}$/.test(w)) y = +w;
    }
    if (m === -1) return null;
    if (y == null && (mt = /'(\d{2})\b/.exec(p))) y = 2000 + (+mt[1]);
    return { m: m, y: y };
  }

  /**
   * One quarter cell → { q: 0–3, y: year | null }, or null. Accepts "Q1",
   * "T1" (trimestre), "Q 1", with a year anywhere ("Q1 2027", "2027-Q1").
   */
  function parseQuarter(v) {
    if (v == null) return null;
    var p = plain(v);
    var mt = /(?:^|[^a-z])[qt]\s*([1-4])(?![0-9])/.exec(p);
    if (!mt) return null;
    var my = /(?:^|[^0-9])(\d{4})(?![0-9])/.exec(p);
    return { q: +mt[1] - 1, y: my ? +my[1] : null };
  }

  function findCol(headers, names) {
    for (var i = 0; i < headers.length; i++) {
      var h = plain(headers[i]).replace(/\s+/g, " ");
      if (names.indexOf(h) !== -1) return i;
    }
    return -1;
  }

  function columnsOf(headers) {
    headers = headers || [];
    var cols = {};
    for (var k in COLUMN_NAMES) {
      if (COLUMN_NAMES.hasOwnProperty(k)) cols[k] = findCol(headers, COLUMN_NAMES[k]);
    }
    return cols;
  }

  function cell(row, idx) {
    if (idx < 0 || !row) return "";
    var v = row[idx];
    return v == null ? "" : (typeof v === "number" ? v : String(v).trim());
  }

  function hexOf(v) {
    var s = String(v == null ? "" : v).trim();
    if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return null;
    s = s.replace("#", "");
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return "#" + s.toUpperCase();
  }

  /**
   * The grid → rows of marks, in data order:
   *   [{ name, iconRef, srcRows: [i…], marks: [{ start, end, label,
   *      category, color, srcRow }] }]
   * start / end are the cells as typed (end null when empty); which
   * column they fall in depends on the chart's column labels (placeMark).
   * The array also carries `noStart` (filled-in lines without a Start)
   * and `columns` (which data column holds what; -1 = absent).
   * Returns [] when there is no Start column.
   */
  function read(headers, rows, iconSelections) {
    var out = [];
    var cols = columnsOf(headers);
    out.columns = cols;
    out.noStart = 0;
    if (cols.start === -1) return out;
    var byName = {};
    rows = rows || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || [];
      var name = String(cell(row, cols.row));
      var label = String(cell(row, cols.label));
      var startV = cell(row, cols.start);
      var endV = cell(row, cols.end);
      var blank = true;
      for (var c = 0; c < row.length; c++) {
        if (row[c] != null && String(row[c]).trim() !== "") { blank = false; break; }
      }
      if (blank) continue;
      if (startV === "") { out.noStart++; continue; }

      var mark = {
        start: startV, end: endV === "" ? null : endV, label: label,
        category: String(cell(row, cols.category)),
        color: hexOf(cell(row, cols.color)),
        srcRow: i
      };
      // Unnamed lines each get a row of their own.
      var key = name ? "n:" + name : "i:" + i;
      var target = byName[key];
      if (!target) {
        target = { name: name, iconRef: null, srcRows: [], marks: [] };
        byName[key] = target;
        out.push(target);
      }
      target.srcRows.push(i);
      target.marks.push(mark);
      if (!target.iconRef && iconSelections && iconSelections[i]) target.iconRef = iconSelections[i];
    }
    return out;
  }

  // ── Columns and where a mark falls ──────────────────────

  // Label comparison: case, accents, dots and extra spaces ignored
  // ("Janv." = "janv", "Q 1" = "q 1").
  function normLabel(v) {
    return plain(v).replace(/\./g, "").replace(/\s+/g, " ").trim();
  }

  function intIn(v, lo, hi) {
    var n = typeof v === "number" ? v : parseInt(v, 10);
    return (isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi) ? n : null;
  }

  function hasLabels(list) {
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] != null && String(list[i]).trim() !== "") return true;
    }
    return false;
  }

  /**
   * The Columns setting, complete and checked:
   * { kind, lang, style, start, count, year }. Without calendarAxis:
   * custom when calendarColumns has labels, else Jan … Dec.
   */
  function axisOf(config) {
    config = config || {};
    var a = (config.calendarAxis && typeof config.calendarAxis === "object") ? config.calendarAxis : {};
    var kind = AXIS_KINDS[a.kind] ? a.kind : (hasLabels(config.calendarColumns) ? "custom" : "months");
    var lang = MONTH_LABELS[a.lang] ? a.lang : "en";
    var style = AXIS_STYLES[a.style] ? a.style : "short";
    var perYear = kind === "quarters" ? 4 : 12;
    var year = intIn(a.year, 1900, 2200);
    if (kind === "years" && year == null) year = new Date().getFullYear();
    var count = intIn(a.count, 1, MAX_COLUMNS);
    if (count == null) count = kind === "quarters" ? 4 : (kind === "years" ? 4 : 12);
    return {
      kind: kind, lang: lang, style: style,
      start: intIn(a.start, 1, perYear) || 1,
      count: count, year: year
    };
  }

  /**
   * The Columns setting as saved: only the fields its kind uses
   * (months: lang, style, start, count, year · quarters: lang, start,
   * count, year · years: year, count · custom: the typed labels live in
   * calendarColumns). null for the default, Jan … Dec in English.
   */
  function compactAxis(ax) {
    if (!ax) return null;
    var out = { kind: ax.kind };
    if (ax.kind === "months" || ax.kind === "quarters") {
      out.lang = ax.lang;
      if (ax.kind === "months") out.style = ax.style;
      out.start = ax.start;
      out.count = ax.count;
      if (ax.year != null) out.year = ax.year;
      if (ax.kind === "months" && ax.lang === "en" && ax.style === "short" &&
          ax.start === 1 && ax.count === 12 && ax.year == null) return null;
    } else if (ax.kind === "years") {
      out.year = ax.year;
      out.count = ax.count;
    }
    return out;
  }

  /**
   * The labels the Columns setting prints, with their group headings
   * ({ colIndex: text }) and, for month and quarter columns with a year,
   * the year of each column (null when none).
   */
  function axisLabels(config) {
    var ax = axisOf(config);
    var labels = [], groups = {}, years = [];
    if (ax.kind === "custom") {
      var typed = Array.isArray(config.calendarColumns) ? config.calendarColumns : [];
      for (var t = 0; t < typed.length; t++) {
        var lt = typed[t] == null ? "" : String(typed[t]).trim();
        if (lt) labels.push(lt);
      }
      var g = objOrEmpty(config.calendarColumnGroups);
      for (var k in g) if (g.hasOwnProperty(k)) groups[k] = g[k];
      return { axis: ax, labels: labels, groups: groups, years: null };
    }
    if (ax.kind === "years") {
      for (var y = 0; y < ax.count; y++) labels.push(String(ax.year + y));
      return { axis: ax, labels: labels, groups: groups, years: null };
    }
    var perYear = ax.kind === "quarters" ? 4 : 12;
    var names = ax.kind === "quarters" ? null
      : MONTH_LABELS[ax.lang][ax.style === "full" ? "full" : "short"];
    for (var i = 0; i < ax.count; i++) {
      var idx = (ax.start - 1 + i) % perYear;
      var label = names ? names[idx] : QUARTER_PREFIX[ax.lang] + (idx + 1);
      if (ax.style === "upper") label = label.toUpperCase();
      labels.push(label);
      var yr = ax.year != null ? ax.year + Math.floor((ax.start - 1 + i) / perYear) : null;
      years.push(yr);
      if (yr != null) groups[i] = String(yr);
    }
    return { axis: ax, labels: labels, groups: groups, years: years };
  }

  /**
   * The chart's columns from its config (Columns setting): columnsFor()
   * plus `axis` and `groups`.
   */
  function chartColumns(config) {
    var al = axisLabels(config || {});
    var cols = columnsFor(al.labels, al.years);
    cols.axis = al.axis;
    cols.groups = al.groups;
    return cols;
  }

  /**
   * Columns from a list of labels (empty = Jan … Dec):
   * { labels, n, norm[], months[] / quarters[] (parsed month / quarter or
   * null), cyclic (every label is a month, or every label a quarter, so
   * spans may wrap round the year), capped }. years[i], when given, is
   * the year of column i (month and quarter presets with a year).
   */
  function columnsFor(labels, years) {
    var list = [];
    if (Array.isArray(labels)) {
      for (var i = 0; i < labels.length; i++) {
        var t = labels[i] == null ? "" : String(labels[i]).trim();
        if (t) list.push(t);
      }
    }
    if (!list.length) list = MONTH_NAMES.slice();
    var capped = list.length > MAX_COLUMNS;
    if (capped) list = list.slice(0, MAX_COLUMNS);
    var norm = [], months = [], quarters = [], allMonths = true, allQuarters = true;
    for (var j = 0; j < list.length; j++) {
      norm.push(normLabel(list[j]));
      var yj = (years && years[j] != null) ? years[j] : null;
      var pm = parseMonth(list[j]);
      if (pm && yj != null) pm.y = yj;
      months.push(pm);
      if (!pm) allMonths = false;
      var pq = pm ? null : parseQuarter(list[j]);
      if (pq && yj != null) pq.y = yj;
      quarters.push(pq);
      if (!pq) allQuarters = false;
    }
    return { labels: list, n: list.length, norm: norm, months: months, quarters: quarters,
      cyclic: allMonths || allQuarters, capped: capped };
  }

  /**
   * Columns a Start / End cell points at: the columns with that exact
   * label; else, when it reads as a month (or a quarter), the columns
   * that are the same month (quarter), and the same year when both carry
   * one. So "mars", "March" and "3" find "Mar" or "Mars", and "T1" finds
   * "Q1". [] = none.
   */
  function matchCols(value, cols) {
    var out = [];
    if (value == null || String(value).trim() === "") return out;
    var key = normLabel(value);
    for (var i = 0; i < cols.n; i++) if (cols.norm[i] === key) out.push(i);
    if (out.length) return out;
    var pv = parseMonth(value);
    if (pv) {
      for (var j = 0; j < cols.n; j++) {
        var pl = cols.months[j];
        if (pl && pl.m === pv.m && (pv.y == null || pl.y == null || pl.y === pv.y)) out.push(j);
      }
      return out;
    }
    var qv = parseQuarter(value);
    if (qv && cols.quarters) {
      for (var q = 0; q < cols.n; q++) {
        var ql = cols.quarters[q];
        if (ql && ql.q === qv.q && (qv.y == null || ql.y == null || ql.y === qv.y)) out.push(q);
      }
    }
    return out;
  }

  /**
   * Where a mark falls: a list of [first, last] column indexes (inclusive),
   * or null when its Start or End matches no column. With month columns a
   * span whose End comes before its Start wraps round the year, and a
   * season already running when the chart starts shows from column 0.
   */
  function placeMark(mark, cols) {
    var S = matchCols(mark.start, cols);
    if (!S.length) return null;
    if (mark.end == null) return S.map(function (s) { return [s, s]; });
    var E = matchCols(mark.end, cols);
    if (!E.length) return null;
    var out = [], seen = {};
    function push(a, b) {
      var k = a + ":" + b;
      if (!seen[k]) { seen[k] = true; out.push([a, b]); }
    }
    if (cols.cyclic && E[0] < S[0]) push(0, E[0]);
    for (var i = 0; i < S.length; i++) {
      var s = S[i], e = null, before = null;
      for (var j = 0; j < E.length; j++) {
        if (E[j] >= s) { e = E[j]; break; }
        before = E[j];
      }
      if (e != null) push(s, e);
      else if (cols.cyclic) push(s, cols.n - 1);
      else push(before, s);          // End typed before Start: take the span the other way
    }
    return out;
  }

  /** The mark one placed span draws, from its row's Mark setting ("" = auto). */
  function markType(mark, rowMark, span) {
    if (rowMark === "bar" || rowMark === "dot") return rowMark;
    if (rowMark === "line") return span[1] > span[0] ? "line" : "dot";
    return mark.end != null ? "bar" : "dot";
  }

  // Neighbouring columns with the same group text → one heading:
  // [{ text, from, to }] (column groups, as in the data table).
  function groupRuns(groups, n) {
    var out = [];
    for (var c = 0; c < n; c++) {
      var t = groups[c] == null ? "" : String(groups[c]).trim();
      if (!t) continue;
      var last = out[out.length - 1];
      if (last && last.text === t && last.to === c - 1) last.to = c;
      else out.push({ text: t, from: c, to: c });
    }
    return out;
  }

  // ── Options ─────────────────────────────────────────────

  function objOrEmpty(o) { return (o && typeof o === "object" && !Array.isArray(o)) ? o : {}; }

  var ROW_MARKS = { bar: 1, dot: 1, line: 1 };

  function readOptions(config) {
    var grid = config.calendarGrid;
    return {
      grid: (grid === "cells" || grid === "columns" || grid === "bands" || grid === "none") ? grid : "auto",
      rowLabels: config.calendarRowLabels !== false,
      legend: config.calendarLegend !== false,
      rowColors: objOrEmpty(config.calendarRowColors),
      rowMarks: objOrEmpty(config.calendarRowMarks),
      categoryColors: objOrEmpty(config.calendarCategoryColors)
    };
  }

  // Categories in order of first appearance, each with its colour.
  function categoriesOf(data, opt, palette) {
    var names = [], colors = {};
    for (var r = 0; r < data.length; r++) {
      for (var k = 0; k < data[r].marks.length; k++) {
        var c = data[r].marks[k].category;
        if (!c || colors.hasOwnProperty(c)) continue;
        colors[c] = hexOf(opt.categoryColors[c]) || palette[names.length % palette.length];
        names.push(c);
      }
    }
    return { names: names, colors: colors };
  }

  /**
   * Wrap a bar label to its bar (up to 3 lines). wrapToFit can't break a
   * single long word, so any line still wider than the bar is shortened
   * with "…" and the label counts as truncated. No room at all → no text.
   */
  function fitInBar(text, size, room) {
    var w = R.wrapToFit(text, size, room, 3, R.LABEL_ADVANCE);
    var charW = size * R.LABEL_ADVANCE;
    var maxChars = Math.floor(room / charW);
    if (maxChars < 2) return { lines: [], fits: false, truncated: true };
    var lines = [];
    var cut = w.truncated;
    for (var i = 0; i < w.lines.length; i++) {
      var ln = w.lines[i];
      if (ln.length * charW > room) { ln = ln.substring(0, maxChars - 1) + "\u2026"; cut = true; }
      lines.push(ln);
    }
    return { lines: lines, fits: !cut, truncated: cut };
  }

  // ── Render ──────────────────────────────────────────────

  function render(title, data, config) {
    if (!data || !data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;
    var opt = readOptions(config);
    var cols = chartColumns(config);
    var n = cols.n;
    if (cols.capped) R.pushWarning("calendar-columns-capped", { count: MAX_COLUMNS });

    // Colours
    var baseColor = (config.colors && config.colors[0]) || (st.colors && st.colors[0]) || "#009EDB";
    var palette = (st.colors && st.colors.length) ? st.colors : [baseColor];
    var cats = categoriesOf(data, opt, palette);
    function markColor(row, mk) {
      return mk.color ||
        hexOf(opt.rowColors[row.name]) ||
        (mk.category ? cats.colors[mk.category] : null) ||
        baseColor;
    }

    // Where each mark falls, and what it draws (its row's Mark setting)
    var hasBars = false;
    var unmatched = data.noStart || 0;
    var placedByRow = [];
    for (var hb = 0; hb < data.length; hb++) {
      var rm = opt.rowMarks[data[hb].name];
      rm = ROW_MARKS[rm] ? rm : "";
      var placedRow = [];
      for (var hk = 0; hk < data[hb].marks.length; hk++) {
        var mk0 = data[hb].marks[hk];
        var sp = placeMark(mk0, cols);
        if (!sp) { unmatched++; continue; }
        for (var si = 0; si < sp.length; si++) {
          var mt = markType(mk0, rm, sp[si]);
          if (mt === "bar") hasBars = true;
          placedRow.push({ mark: mk0, type: mt, i0: sp[si][0], i1: sp[si][1],
            color: markColor(data[hb], mk0), wrap: null });
        }
      }
      placedByRow.push(placedRow);
    }
    if (unmatched) {
      R.pushWarning("calendar-no-column", {
        count: unmatched,
        suggestion: "Start and End must match a column (Design tab → Calendar Options → Columns)"
      });
    }
    var grid = opt.grid === "auto" ? (hasBars ? "cells" : "columns") : opt.grid;

    var fontSize = rs.labelSize;
    var lineH = Math.round(fontSize * 1.2);
    var barFont = rs.valueSize;
    var barLineH = Math.round(barFont * 1.2);

    // ── Row label column (flush left) ──
    var hasIcons = !!config.iconColType && config.iconColType !== "none";
    var isFlags = config.iconColType === "flags";
    var iconNorm = hasIcons ? (isFlags ? 1.5 : 1.0) : false;
    var iconH = isFlags ? Math.round(fontSize * 1.3) : fontSize * 1.3 * 0.85;
    var iconMaxW = hasIcons ? R.maxIconWidth(data, iconH, iconNorm) : 0;
    var iconGap = Math.max(4, Math.round(fontSize * 0.6));
    var iconSlot = iconMaxW > 0 ? iconMaxW + iconGap : 0;

    var showNames = false;
    if (opt.rowLabels) {
      for (var sn = 0; sn < data.length; sn++) if (data[sn].name) { showNames = true; break; }
    }
    var truncCount = 0;
    var labelWraps = [];
    var labelColW = 0;
    var labelCap = Math.max(40, svgW * 0.28 - iconSlot);
    for (var li = 0; li < data.length; li++) {
      var wrap = showNames
        ? R.wrapToFit(data[li].name, fontSize, labelCap, 3, R.LABEL_ADVANCE)
        : { lines: [], fits: true, truncated: false };
      if (wrap.truncated) truncCount++;
      labelWraps.push(wrap);
      for (var ll = 0; ll < wrap.lines.length; ll++) {
        var lw = R.measureTextWidth(wrap.lines[ll], fontSize, R.LABEL_ADVANCE);
        if (lw > labelColW) labelColW = lw;
      }
    }
    if (labelColW > 0) labelColW = Math.min(labelCap, labelColW + 2);
    var leftW = iconSlot + labelColW;
    var gridX = leftW > 0 ? leftW + Math.max(8, Math.round(fontSize * 0.9)) : 0;
    var gridW = Math.max(n, svgW - gridX);
    var colW = gridW / n;
    function colX(i) { return gridX + i * colW; }

    // ── Header (title block, legend, month row) ──
    var header = R.renderHeader({
      x: 0, startY: 6, title: title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad, maxWidth: svgW, widthPercent: config.headerTextWidth
    });
    var y = R.computePlotTop(rs, header);
    var legend = null;
    if (opt.legend && cats.names.length) {
      legend = R.renderStackedLegend({
        x: 0, startY: y, names: cats.names,
        colors: cats.names.map(function (c) { return cats.colors[c]; }),
        rs: rs, style: st, maxWidth: svgW, hasSubtitle: !!config.subtitle
      });
      y += legend.height;
    }

    // Column labels (bold, centred, wrapped to 2 lines) and the optional
    // group headings above them (bold, left, with a rule under each group).
    var headLineH = Math.round(fontSize * 1.15);
    var headPad = Math.max(3, Math.round(fontSize * 0.5 * vPad));
    var colWraps = [], colLines = 1;
    for (var cw = 0; cw < n; cw++) {
      var cwr = R.wrapToFit(cols.labels[cw], fontSize, Math.max(1, colW - 4), 2, R.HEADING_ADVANCE);
      if (cwr.truncated) truncCount++;
      colWraps.push(cwr);
      if (cwr.lines.length > colLines) colLines = cwr.lines.length;
    }
    var runs = groupRuns(cols.groups, n);
    var groupWraps = [], groupLines = 0;
    for (var gw = 0; gw < runs.length; gw++) {
      var gwr = R.wrapToFit(runs[gw].text, fontSize, Math.max(1, (runs[gw].to - runs[gw].from + 1) * colW - 4), 2, R.HEADING_ADVANCE);
      if (gwr.truncated) truncCount++;
      groupWraps.push(gwr);
      if (gwr.lines.length > groupLines) groupLines = gwr.lines.length;
    }
    var groupRowH = runs.length ? groupLines * headLineH + Math.max(3, Math.round(fontSize * 0.5)) * 2 : 0;
    var monthRowH = fontSize + (colLines - 1) * headLineH + headPad * 2;
    var groupTop = y;
    var monthTop = y + groupRowH;
    var gridTop = monthTop + monthRowH;

    // ── Rows: heights grow to fit wrapped row labels and bar labels ──
    var baseRowH = config.barThickness || rs.barThickness;
    var rowGap = grid === "bands" ? Math.max(2, Math.round(baseRowH * 0.1)) : 0;
    var barInset = grid === "bands" ? 0 : Math.max(1, Math.round(baseRowH * 0.14));
    var barPadX = Math.max(3, Math.round(barFont * 0.45));
    var rowsLaid = [];
    for (var ri = 0; ri < data.length; ri++) {
      var row = data[ri];
      var marks = placedByRow[ri];
      var need = Math.max(baseRowH, labelWraps[ri].lines.length * lineH + 4,
        row._iconSvg ? iconH + 4 : 0);
      for (var mi = 0; mi < marks.length; mi++) {
        var placed = marks[mi];
        if (placed.type === "bar" && placed.mark.label) {
          var room = (placed.i1 - placed.i0 + 1) * colW - barPadX * 2;
          var bw = fitInBar(placed.mark.label, barFont, Math.max(1, room));
          if (bw.truncated) truncCount++;
          placed.wrap = bw;
          need = Math.max(need, bw.lines.length * barLineH + Math.round(barFont * 0.6) + barInset * 2);
        }
      }
      rowsLaid.push({ row: row, marks: marks, h: Math.ceil(need), labelWrap: labelWraps[ri] });
    }
    if (truncCount) {
      R.pushWarning("label-truncated", {
        count: truncCount,
        suggestion: "Try a wider chart, fewer columns or shorter labels"
      });
    }

    // Footer height first, so a fixed total height can reserve room for it.
    var footerProbe = R.renderFooter({
      x: 0, startY: 0, footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    var footerBlockH = footerProbe.height + (config.footer ? rs.footerGap : 0);

    var rowsH = 0;
    for (var rh = 0; rh < rowsLaid.length; rh++) rowsH += rowsLaid[rh].h;
    rowsH += rowGap * (rowsLaid.length - 1);
    // Fixed height: rows share the room (never below what their text needs);
    // marks keep their natural size, so extra room never fattens the bars.
    var markH = baseRowH - barInset * 2;
    if (config.height) {
      var availH = config.height - gridTop - footerBlockH - rs.marginBottom;
      var spare = availH - rowsH;
      if (spare > 0) {
        var add = spare / rowsLaid.length;
        for (var ra = 0; ra < rowsLaid.length; ra++) rowsLaid[ra].h += add;
        rowsH = availH;
      }
    }
    R.reportResolved("barThickness", baseRowH);

    var gridBottom = gridTop + rowsH;
    var footerStartY = R.computeFooterStart(rs, gridBottom, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY, footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    var naturalH = footerStartY + footer.height + rs.marginBottom;
    var svgH = config.height ? Math.max(config.height, naturalH) : naturalH;

    // ── Draw ──
    var svg = [];
    svg.push(R.svgOpen(svgW, svgH));
    svg.push(R.svgBg(svgW, svgH));
    for (var h = 0; h < header.svg.length; h++) svg.push(header.svg[h]);
    if (legend) for (var lg = 0; lg < legend.svg.length; lg++) svg.push(legend.svg[lg]);

    var tops = [];
    var yy = gridTop;
    for (var t = 0; t < rowsLaid.length; t++) { tops.push(yy); yy += rowsLaid[t].h + rowGap; }

    // Background
    svg.push('  <g class="calendar-grid">');
    if (grid === "columns") {
      for (var gc = 0; gc < n; gc += 2) {
        svg.push('    <rect x="' + colX(gc).toFixed(1) + '" y="' + monthTop.toFixed(1) + '" width="' + colW.toFixed(1) +
          '" height="' + (gridBottom - monthTop).toFixed(1) + '" fill="' + SHADE_COLOR + '"/>');
      }
    } else if (grid === "bands") {
      for (var gb = 0; gb < rowsLaid.length; gb++) {
        svg.push('    <rect x="' + gridX.toFixed(1) + '" y="' + tops[gb].toFixed(1) + '" width="' + gridW.toFixed(1) +
          '" height="' + rowsLaid[gb].h.toFixed(1) + '" fill="' + SHADE_COLOR + '"/>');
      }
    } else if (grid === "cells") {
      // From the first month's left edge (the line between the row names
      // and the first month); none at x = 0 when there are no row names.
      for (var gv = gridX > 0 ? 0 : 1; gv < n; gv++) {
        svg.push('    <line x1="' + colX(gv).toFixed(1) + '" y1="' + gridTop.toFixed(1) + '" x2="' + colX(gv).toFixed(1) +
          '" y2="' + gridBottom.toFixed(1) + '" stroke="' + st.gridColor + '" stroke-width="0.5"/>');
      }
    }
    if (grid === "cells" || grid === "columns") {
      for (var gr = 1; gr < rowsLaid.length; gr++) {
        svg.push('    <line x1="0" y1="' + tops[gr].toFixed(1) + '" x2="' + svgW + '" y2="' + tops[gr].toFixed(1) +
          '" stroke="' + RULE_COLOR + '" stroke-width="0.5" stroke-dasharray="1,1"/>');
      }
      svg.push('    <line x1="0" y1="' + gridBottom.toFixed(1) + '" x2="' + svgW + '" y2="' + gridBottom.toFixed(1) +
        '" stroke="' + st.baselineColor + '" stroke-width="0.75"/>');
    }
    // Rule under the month names, across the full width (like the minimal table)
    svg.push('    <line x1="0" y1="' + gridTop.toFixed(1) + '" x2="' + svgW + '" y2="' + gridTop.toFixed(1) +
      '" stroke="' + st.baselineColor + '" stroke-width="0.75"/>');
    svg.push('  </g>');

    // Group headings and column labels
    svg.push('  <g class="calendar-columns">');
    for (var gd = 0; gd < runs.length; gd++) {
      var G = runs[gd];
      var gLines = groupWraps[gd].lines;
      var gColor = groupWraps[gd].truncated ? R.FADED_LABEL_COLOR : st.valueColor;
      var gRuleY = groupTop + groupRowH - Math.max(2, Math.round(fontSize * 0.3));
      var gFirstY = gRuleY - Math.max(2, Math.round(fontSize * 0.35)) - (gLines.length - 1) * headLineH;
      for (var gl = 0; gl < gLines.length; gl++) {
        svg.push('    <text x="' + (colX(G.from) + 2).toFixed(1) + '" y="' + (gFirstY + gl * headLineH).toFixed(1) +
          '" font-family="' + fonts.value + '" font-size="' + fontSize + '" font-weight="bold" fill="' + gColor + '">' +
          R.escapeXml(gLines[gl]) + '</text>');
      }
      // Small gap between neighbouring groups; flush at the chart's right edge
      var gx0 = colX(G.from) + (G.from === 0 && gridX === 0 ? 0 : 2);
      var gx1 = colX(G.to + 1) - (G.to === n - 1 ? 0 : 2);
      svg.push('    <line x1="' + gx0.toFixed(1) + '" y1="' + gRuleY + '" x2="' + gx1.toFixed(1) + '" y2="' + gRuleY +
        '" stroke="' + st.baselineColor + '" stroke-width="0.75"/>');
    }
    for (var mc = 0; mc < n; mc++) {
      var cLines = colWraps[mc].lines;
      var cColor = colWraps[mc].truncated ? R.FADED_LABEL_COLOR : st.valueColor;
      var cFirstY = monthTop + headPad + fontSize * 0.85 + (colLines - cLines.length) * headLineH;
      for (var cl = 0; cl < cLines.length; cl++) {
        svg.push('    <text x="' + (colX(mc) + colW / 2).toFixed(1) + '" y="' + (cFirstY + cl * headLineH).toFixed(1) +
          '" font-family="' + fonts.value + '" font-size="' + fontSize + '" font-weight="bold" fill="' + cColor +
          '" text-anchor="middle">' + R.escapeXml(cLines[cl]) + '</text>');
      }
    }
    svg.push('  </g>');

    // Rows: icon, name, marks
    for (var dr = 0; dr < rowsLaid.length; dr++) {
      var L = rowsLaid[dr];
      var top = tops[dr];
      var cy = top + L.h / 2;
      svg.push('  <g class="calendar-row">');
      if (iconSlot && L.row._iconSvg) {
        var dims = R.getIconDims(L.row._iconSvg, iconH, iconNorm);
        var icoColor = !isFlags ? (config.rowIconColor || baseColor) : null;
        svg.push('    ' + R.buildIconGroup(L.row._iconSvg, iconH, (iconMaxW - dims.w) / 2, cy - dims.h / 2, icoColor, iconNorm));
      }
      var lines = L.labelWrap.lines;
      if (lines.length) {
        var lblColor = L.labelWrap.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
        var firstY = cy - (lines.length * lineH) / 2 + fontSize * 0.95;
        for (var ln = 0; ln < lines.length; ln++) {
          svg.push('    <text x="' + iconSlot.toFixed(1) + '" y="' + (firstY + ln * lineH).toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + fontSize + '" fill="' + lblColor + '">' +
            R.escapeXml(lines[ln]) + '</text>');
        }
      }
      // Bars first, then lines, then dots on top
      var order = ["bar", "line", "dot"];
      for (var oi = 0; oi < order.length; oi++) {
        for (var pm = 0; pm < L.marks.length; pm++) {
          var P = L.marks[pm];
          if (P.type !== order[oi]) continue;
          if (P.type === "bar") drawBar(svg, P, colX(P.i0), (P.i1 - P.i0 + 1) * colW, cy, markH);
          else if (P.type === "line") drawLine(svg, P, cy);
          else drawDots(svg, P, cy);
        }
      }
      svg.push('  </g>');
    }

    function drawBar(out, P, x, w, cyy, hgt) {
      var x0 = x + 0.5, w0 = Math.max(1, w - 1);
      var bh = P.wrap ? Math.max(hgt, P.wrap.lines.length * barLineH + Math.round(barFont * 0.6)) : hgt;
      out.push('    <rect x="' + x0.toFixed(1) + '" y="' + (cyy - bh / 2).toFixed(1) + '" width="' + w0.toFixed(1) +
        '" height="' + bh.toFixed(1) + '" fill="' + P.color + '"/>');
      if (!P.wrap || !P.wrap.lines.length) return;
      var txtColor = P.wrap.truncated ? R.FADED_LABEL_COLOR : R.contrastText(P.color);
      var fy = cyy - (P.wrap.lines.length * barLineH) / 2 + barFont * 0.95;
      // A cut label is red, as everywhere in the tool; inside a coloured bar
      // red can vanish (on a red or orange bar), so it sits on a white badge.
      if (P.wrap.truncated) {
        var badgeW = 0;
        for (var bw0 = 0; bw0 < P.wrap.lines.length; bw0++) {
          badgeW = Math.max(badgeW, R.measureTextWidth(P.wrap.lines[bw0], barFont, R.LABEL_ADVANCE));
        }
        out.push('    <rect x="' + (x0 + barPadX - 2).toFixed(1) + '" y="' + (cyy - (P.wrap.lines.length * barLineH) / 2 - 1).toFixed(1) +
          '" width="' + (badgeW + 4).toFixed(1) + '" height="' + (P.wrap.lines.length * barLineH + 2).toFixed(1) +
          '" rx="2" fill="#FFFFFF" fill-opacity="0.85"/>');
      }
      for (var bl = 0; bl < P.wrap.lines.length; bl++) {
        out.push('    <text x="' + (x0 + barPadX).toFixed(1) + '" y="' + (fy + bl * barLineH).toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + barFont + '" fill="' + txtColor + '">' +
          R.escapeXml(P.wrap.lines[bl]) + '</text>');
      }
    }

    // Small dots, as on the HPC cycle slide: about a quarter of the row height across.
    function dotRadius() { return Math.max(2, Math.min(baseRowH * 0.13, colW * 0.3)); }

    function drawDots(out, P, cyy) {
      var r = dotRadius();
      for (var i = P.i0; i <= P.i1; i++) {
        out.push('    <circle cx="' + (colX(i) + colW / 2).toFixed(1) + '" cy="' + cyy.toFixed(1) +
          '" r="' + r.toFixed(1) + '" fill="' + P.color + '"/>');
      }
    }

    function drawLine(out, P, cyy) {
      // Middle of the first column to the middle of the last.
      var x1 = P.i0 === P.i1 ? colX(P.i0) + 1 : colX(P.i0) + colW / 2;
      var x2 = P.i0 === P.i1 ? colX(P.i1 + 1) - 1 : colX(P.i1) + colW / 2;
      var sw = Math.max(1.25, Math.round(dotRadius() * 0.5 * 10) / 10);
      out.push('    <line x1="' + x1.toFixed(1) + '" y1="' + cyy.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + cyy.toFixed(1) +
        '" stroke="' + P.color + '" stroke-width="' + sw + '"/>');
    }

    for (var fi = 0; fi < footer.svg.length; fi++) svg.push(footer.svg[fi]);
    svg.push('</svg>');
    return svg.join("\n");
  }

  R.register("calendar", "Calendar/Planner", render);

  // Shared with DataStore (reading the grid), the panel (Design-tab lists)
  // and the AI import (checking that Start / End match a column).
  R.calendar = {
    MONTH_NAMES: MONTH_NAMES,
    MONTH_LABELS: MONTH_LABELS,
    QUARTER_PREFIX: QUARTER_PREFIX,
    MAX_COLUMNS: MAX_COLUMNS,
    parseMonth: parseMonth,
    columnsOf: columnsOf,
    axisOf: axisOf,
    compactAxis: compactAxis,
    axisLabels: axisLabels,
    chartColumns: chartColumns,
    columnsFor: columnsFor,
    groupRuns: groupRuns,
    matchCols: matchCols,
    placeMark: placeMark,
    read: read
  };
})();
