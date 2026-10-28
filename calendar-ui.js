/**
 * CalendarUI — Design-tab controls for the Calendar/Planner chart
 * ("Calendar Options").
 *
 *   • Columns: Months · Quarters · Years · Custom (calendarAxis). The
 *     presets have their fields (language, style, first month or
 *     quarter, year, how many); below them a strip shaped like the top
 *     of the chart shows the columns and their headings as they print.
 *     With Custom the strip is the editor: type a label in each column,
 *     a heading above (the same text on neighbouring columns joins into
 *     one heading, the data table's group-title rule), + adds a column,
 *     × removes one (calendarColumns, calendarColumnGroups).
 *   • Background: picture buttons, Auto · Month lines · Month columns ·
 *     Row bands · None
 *   • Show: row names, category legend
 *   • Rows: per calendar row a Mark (Auto · Bar · Dot · Line) and a
 *     colour swatch (both stored by row name)
 *   • Category colours: one swatch per category (when the data has a
 *     Category column)
 *
 * Writes straight to DataStore (calendar* fields); the renderer is
 * chart-calendar.js, which also owns the reading rules
 * (ChartRegistry.calendar) used here for the column and row lists.
 * Colour of a mark, most specific first: the data's Color cell → row
 * colour → category colour → the chart colour (Colour group).
 *
 * init(deps):
 *   store         – DataStore
 *   generate      – function() (re-render SVG)
 *   schedule      – function() (debounced re-render)
 *   getSwatches   – function() → active style's swatch list
 *   colorDropdown – ColorPickersUI.buildSeriesDropdown
 */

/* global ChartRegistry */

var CalendarUI = (function () {
  "use strict";

  var _store, _generate, _schedule, _getSwatches, _colorDropdown;

  var section, kindGroup, fieldsWrap, langSel, styleSel, startSel, startLabel;
  var yearInput, yearLabel, countInput, countLabel, strip, stripHint, gridChoice;
  var rowNamesCheck, legendCheck, legendRow;
  var rowsGrid, catsGrid, catsBlock;
  // Separate timers, so typing in one place never cancels another's redraw.
  var axisTimer = null, textTimer = null;

  // Brand colours always offered, whatever the style (same list as Table Options).
  var BRAND_SWATCHES = [
    { hex: "#009EDB", name: "UN Blue" },
    { hex: "#F58220", name: "Orange" },
    { hex: "#ED1847", name: "Red" },
    { hex: "#4D4D4D", name: "Dark Grey" },
    { hex: "#999999", name: "Neutral Grey" },
    { hex: "#BFBFBF", name: "Light Grey" }
  ];

  function byId(id) { return document.getElementById(id); }
  function cal() { return (typeof ChartRegistry !== "undefined") ? ChartRegistry.calendar : null; }

  function init(deps) {
    _store = deps.store;
    _generate = deps.generate;
    _schedule = deps.schedule;
    _getSwatches = deps.getSwatches;
    _colorDropdown = deps.colorDropdown;

    section = byId("calendar-options-section");
    kindGroup = byId("calendar-kind");
    fieldsWrap = byId("calendar-axis-fields");
    langSel = byId("calendar-lang");
    styleSel = byId("calendar-style");
    startSel = byId("calendar-start");
    startLabel = byId("calendar-start-label");
    yearInput = byId("calendar-year");
    yearLabel = byId("calendar-year-label");
    countInput = byId("calendar-count");
    countLabel = byId("calendar-count-label");
    strip = byId("calendar-strip");
    stripHint = byId("calendar-strip-hint");
    gridChoice = byId("calendar-grid-choice");
    rowNamesCheck = byId("calendar-row-names");
    legendCheck = byId("calendar-legend");
    legendRow = byId("calendar-legend-row");
    rowsGrid = byId("calendar-rows-grid");
    catsGrid = byId("calendar-cats-grid");
    catsBlock = byId("calendar-cats-block");

    if (kindGroup) {
      var kindBtns = kindGroup.querySelectorAll(".toggle-btn");
      for (var k = 0; k < kindBtns.length; k++) {
        (function (btn) {
          btn.addEventListener("click", function () { pickKind(btn.getAttribute("data-kind")); });
        })(kindBtns[k]);
      }
    }
    if (langSel) langSel.addEventListener("change", function () { setAxis({ lang: langSel.value }); });
    if (styleSel) styleSel.addEventListener("change", function () { setAxis({ style: styleSel.value }); });
    if (startSel) startSel.addEventListener("change", function () { setAxis({ start: +startSel.value }); });
    if (yearInput) yearInput.addEventListener("input", function () {
      var v = yearInput.value.trim();
      if (v !== "" && !/^\d{4}$/.test(v)) return;       // wait for a full year
      if (v === "" && axis().kind === "years") return;   // Years always has one
      setAxisLater({ year: v === "" ? null : +v });
    });
    if (yearInput) yearInput.addEventListener("change", syncAxisFields);
    if (countInput) countInput.addEventListener("input", function () {
      var v = parseInt(countInput.value, 10);
      if (isFinite(v) && v >= 1) setAxisLater({ count: Math.min(v, maxColumns()) });
    });
    if (countInput) countInput.addEventListener("change", syncAxisFields);
    bindChoice(gridChoice, function (v) {
      _store.calendarGrid = (["cells", "columns", "bands", "none"].indexOf(v) !== -1) ? v : "auto";
      refresh();
    });
    bindCheck(rowNamesCheck, function (on) { _store.calendarRowLabels = on; });
    bindCheck(legendCheck, function (on) { _store.calendarLegend = on; });
  }

  function bindCheck(cb, set) {
    if (!cb) return;
    cb.addEventListener("change", function () { set(cb.checked); refresh(); });
  }

  // A row of picture buttons; one is active at a time.
  function bindChoice(wrap, onPick) {
    if (!wrap) return;
    var btns = wrap.querySelectorAll(".table-ui-card");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          setChoice(wrap, btn.getAttribute("data-value"));
          onPick(btn.getAttribute("data-value"));
        });
      })(btns[i]);
    }
  }

  function setChoice(wrap, value) {
    if (!wrap) return;
    var btns = wrap.querySelectorAll(".table-ui-card");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute("data-value") === value) btns[i].classList.add("active");
      else btns[i].classList.remove("active");
    }
  }

  function refresh() {
    if (_store.hasData && _store.hasData()) {
      if (_generate) _generate();
      if (_schedule) _schedule();
    }
  }

  // ── Show / Hide ────────────────────────────────────────

  function show() {
    if (section) section.style.display = "block";
    syncToUI();
  }

  function hide() {
    if (section) section.style.display = "none";
  }

  function syncToUI() {
    if (!_store) return;
    syncAxisFields();
    setChoice(gridChoice, _store.calendarGrid || "auto");
    if (rowNamesCheck) rowNamesCheck.checked = _store.calendarRowLabels !== false;
    if (legendCheck) legendCheck.checked = _store.calendarLegend !== false;
    build();
  }

  // ── Columns setting (Months · Quarters · Years · Custom) ──

  // Font Awesome Classic Regular (scrap/fa-regular/svgs-full/regular/):
  // xmark (remove a column, reset a colour) and plus (add a column).
  var ICON_XMARK = '<svg viewBox="0 0 640 640" width="8" height="8" aria-hidden="true"><path fill="currentColor" d="M135.5 169C126.1 159.6 126.1 144.4 135.5 135.1C144.9 125.8 160.1 125.7 169.4 135.1L320.4 286.1L471.4 135.1C480.8 125.7 496 125.7 505.3 135.1C514.6 144.5 514.7 159.7 505.3 169L354.3 320L505.3 471C514.7 480.4 514.7 495.6 505.3 504.9C495.9 514.2 480.7 514.3 471.4 504.9L320.4 353.9L169.4 504.9C160 514.3 144.8 514.3 135.5 504.9C126.2 495.5 126.1 480.3 135.5 471L286.5 320L135.5 169z"/></svg>';
  var ICON_PLUS = '<svg viewBox="0 0 640 640" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M344 120C344 106.7 333.3 96 320 96C306.7 96 296 106.7 296 120L296 296L120 296C106.7 296 96 306.7 96 320C96 333.3 106.7 344 120 344L296 344L296 520C296 533.3 306.7 544 320 544C333.3 544 344 533.3 344 520L344 344L520 344C533.3 344 544 333.3 544 320C544 306.7 533.3 296 520 296L344 296L344 120z"/></svg>';

  // Under the strip: what Start and End in the data can say.
  var STRIP_HINTS = {
    months: "Start and End in the data can be any month spelling or number (Mar, mars, 3), in any language. For other labels, choose Custom.",
    quarters: "Start and End in the data use the quarters (Q1 or T1, with a year when the columns have one: Q1 2027). For other labels, choose Custom.",
    years: "Start and End in the data use these years. For other labels, choose Custom.",
    custom: "Type each column as it should print; × removes one, + adds one. A heading typed over neighbouring columns with the same text joins into one; clear it to split them. Start and End in the data use these labels."
  };

  function maxColumns() { var C = cal(); return C ? C.MAX_COLUMNS : 60; }

  // The Columns setting, complete (ChartRegistry.calendar.axisOf).
  function axis() { return _store.calendarAxisNow(); }

  // Change some fields of the Columns setting; the store keeps it
  // complete, so a Months setting stays Months next to typed columns.
  function setAxis(patch) {
    var C = cal();
    if (!C) return;
    var ax = axis();
    for (var k in patch) if (patch.hasOwnProperty(k)) ax[k] = patch[k];
    _store.calendarAxis = C.axisOf({ calendarAxis: ax, calendarColumns: _store.calendarColumns });
    syncAxisFields();
    build();
    refresh();
  }

  // Typing in a number field: redraw after a pause, leave the field alone.
  function setAxisLater(patch) {
    var C = cal();
    if (!C) return;
    var ax = axis();
    for (var k in patch) if (patch.hasOwnProperty(k)) ax[k] = patch[k];
    _store.calendarAxis = C.axisOf({ calendarAxis: ax, calendarColumns: _store.calendarColumns });
    if (axisTimer) clearTimeout(axisTimer);
    axisTimer = setTimeout(function () { buildStrip(); refresh(); }, 350);
  }

  // Switching kind resets start and count to that kind's defaults.
  // Custom starts from the columns on screen unless columns were already
  // typed (those are kept: they took work).
  function pickKind(kind) {
    var C = cal();
    if (!C) return;
    var ax = axis();
    if (kind === ax.kind) return;
    if (kind === "custom" && !(_store.calendarColumns && _store.calendarColumns.length)) {
      var shown = C.axisLabels({ calendarAxis: ax, calendarColumns: [] });
      _store.calendarColumns = shown.labels.slice();
      _store.calendarColumnGroups = {};
      for (var g in shown.groups) if (shown.groups.hasOwnProperty(g)) _store.calendarColumnGroups[g] = shown.groups[g];
    }
    var patch = { kind: kind, start: 1, count: null };
    if (kind === "years" && ax.year == null) patch.year = new Date().getFullYear();
    if (ax.kind === "years" && kind !== "years") patch.year = null;
    setAxis(patch);
  }

  function fillSelect(sel, items, value) {
    if (!sel) return;
    sel.innerHTML = "";
    items.forEach(function (it) {
      var o = document.createElement("option");
      o.value = it.v;
      o.textContent = it.t;
      if (String(it.v) === String(value)) o.selected = true;
      sel.appendChild(o);
    });
  }

  // Kind buttons, the fields that kind uses, and their values.
  function syncAxisFields() {
    var C = cal();
    if (!C || !_store) return;
    var ax = axis();
    if (kindGroup) {
      var btns = kindGroup.querySelectorAll(".toggle-btn");
      for (var b = 0; b < btns.length; b++) {
        var on = btns[b].getAttribute("data-kind") === ax.kind;
        btns[b].classList.toggle("active", on);
        btns[b].setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    if (fieldsWrap) {
      fieldsWrap.style.display = ax.kind === "custom" ? "none" : "";
      var parts = fieldsWrap.querySelectorAll("[data-for]");
      for (var p = 0; p < parts.length; p++) {
        var kinds = parts[p].getAttribute("data-for").split(" ");
        parts[p].style.display = kinds.indexOf(ax.kind) !== -1 ? "" : "none";
      }
    }
    var names = C.MONTH_LABELS[ax.lang];
    if (langSel) langSel.value = ax.lang;
    fillSelect(styleSel, [
      { v: "short", t: names.short[0] },
      { v: "upper", t: names.short[0].toUpperCase() },
      { v: "full", t: names.full[0] }
    ], ax.style);
    if (ax.kind === "quarters") {
      var qp = C.QUARTER_PREFIX[ax.lang];
      fillSelect(startSel, [1, 2, 3, 4].map(function (q) { return { v: q, t: qp + q }; }), ax.start);
      if (startLabel) startLabel.textContent = "First quarter";
    } else {
      fillSelect(startSel, names.full.map(function (m, i) { return { v: i + 1, t: m }; }), ax.start);
      if (startLabel) startLabel.textContent = "First month";
    }
    if (countLabel) countLabel.textContent = ax.kind === "quarters" ? "Quarters" : (ax.kind === "years" ? "Years" : "Months");
    if (countInput && document.activeElement !== countInput) countInput.value = ax.count;
    // "Initial": more months or quarters run on into the next years.
    if (yearLabel) yearLabel.textContent = "Initial year";
    if (yearInput) {
      yearInput.placeholder = ax.kind === "years" ? "" : "None";
      yearInput.title = ax.kind === "years" ? "" :
        "Optional: the year of the first column, printed above its " +
        (ax.kind === "quarters" ? "quarters" : "months") +
        ". Add more and the next years follow on automatically.";
      if (document.activeElement !== yearInput) yearInput.value = ax.year != null ? ax.year : "";
    }
  }

  // ── The strip: the top of the chart, as it prints ─────

  // px; columns have a 2 px gap. Typed columns need room for a text box.
  var STRIP_CORNER = 40, STRIP_COL_MIN = 36, STRIP_COL_MIN_EDIT = 46, STRIP_ADD = 24;

  function stripCell(cls, col, span, row) {
    var d = document.createElement("div");
    d.className = "calendar-strip-cell " + cls;
    d.style.gridColumn = (col + 2) + " / span " + span;
    d.style.gridRow = String(row);
    return d;
  }

  // Custom columns: remove column idx, headings after it move left. The
  // last column stays (the strip would have nothing left to type in).
  function removeColumn(idx) {
    var labels = _store.calendarColumns || [];
    if (labels.length <= 1) return;
    labels.splice(idx, 1);
    var old = _store.calendarColumnGroups || {};
    var groups = {};
    for (var k in old) {
      if (!old.hasOwnProperty(k)) continue;
      var i = +k;
      if (i < idx) groups[i] = old[k];
      else if (i > idx) groups[i - 1] = old[k];
    }
    _store.calendarColumns = labels;
    _store.calendarColumnGroups = groups;
    build();
    refresh();
  }

  function addColumn() {
    if (!_store.calendarColumns) _store.calendarColumns = [];
    if (_store.calendarColumns.length >= maxColumns()) return;
    _store.calendarColumns.push("New");
    build();
    refresh();
    var inputs = strip ? strip.querySelectorAll("input.calendar-strip-label") : [];
    var last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  }

  // Headings over custom columns: typing in a joined heading sets all
  // the columns under it; the strip rejoins when the field is left.
  function headingInput(run) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "calendar-strip-heading";
    inp.size = 1;                         // no intrinsic width: the grid sizes it
    inp.value = run.text;
    inp.setAttribute("aria-label", run.from === run.to
      ? "Heading over column " + (run.from + 1)
      : "Heading over columns " + (run.from + 1) + " to " + (run.to + 1));
    inp.addEventListener("input", function () {
      if (!_store.calendarColumnGroups) _store.calendarColumnGroups = {};
      var t = inp.value.trim();
      for (var c = run.from; c <= run.to; c++) {
        if (t) _store.calendarColumnGroups[c] = t;
        else delete _store.calendarColumnGroups[c];
      }
      if (textTimer) clearTimeout(textTimer);
      textTimer = setTimeout(refresh, 300);
    });
    inp.addEventListener("change", function () { buildStrip(); });
    return inp;
  }

  function labelInput(idx, label) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "calendar-strip-label";
    inp.size = 1;
    inp.value = label;
    inp.title = label;
    inp.setAttribute("aria-label", "Column " + (idx + 1));
    inp.addEventListener("input", function () {
      var t = inp.value.trim();
      if (!t) return;                    // a column keeps its label until a new one is typed
      _store.calendarColumns[idx] = t;
      inp.title = t;
      if (textTimer) clearTimeout(textTimer);
      textTimer = setTimeout(refresh, 300);
    });
    // Left empty: back to its label (× removes a column). Only this box
    // changes, so a click on another × or + still lands where aimed.
    inp.addEventListener("change", function () {
      if (!inp.value.trim()) inp.value = _store.calendarColumns[idx];
    });
    return inp;
  }

  function buildStrip() {
    var C = cal();
    if (!strip || !C) return;
    var ax = axis();
    var custom = ax.kind === "custom";
    // Custom with no typed columns draws Jan … Dec: make those the typed
    // columns, so every box on the strip is a real column to edit.
    if (custom && !(_store.calendarColumns && _store.calendarColumns.length)) {
      _store.calendarColumns = C.columnsFor([]).labels.slice();
    }
    var cols = C.chartColumns({
      calendarAxis: ax,
      calendarColumns: _store.calendarColumns,
      calendarColumnGroups: _store.calendarColumnGroups
    });
    var n = cols.n;
    strip.innerHTML = "";
    strip.classList.toggle("is-editable", custom);
    // Corner = the row-name column; columns as on the chart; + at the end.
    // Fills the panel; scrolls sideways once the columns reach their
    // narrowest (STRIP_COL_MIN each).
    var colMin = custom ? STRIP_COL_MIN_EDIT : STRIP_COL_MIN;
    strip.style.gridTemplateColumns = STRIP_CORNER + "px repeat(" + n + ", minmax(" + colMin + "px, 1fr))" +
      (custom ? " " + STRIP_ADD + "px" : "");
    strip.style.minWidth = (STRIP_CORNER + n * (colMin + 2) + (custom ? STRIP_ADD + 2 : 0)) + "px";

    var corner = stripCell("is-corner", -1, 1, 1);
    corner.style.gridRow = "1 / span 2";
    strip.appendChild(corner);

    // Headings row: runs of the same text join; in Custom, each empty
    // column keeps a box to type in.
    var runs = C.groupRuns(cols.groups, n);
    var cells = [];
    var r = 0;
    for (var c = 0; c < n; c++) {
      if (r < runs.length && runs[r].from === c) { cells.push(runs[r]); c = runs[r].to; r++; }
      else cells.push({ text: "", from: c, to: c });
    }
    cells.forEach(function (run) {
      var cell = stripCell("is-heading" + (run.text ? " has-text" : ""), run.from, run.to - run.from + 1, 1);
      if (custom) cell.appendChild(headingInput(run));
      else cell.textContent = run.text;
      strip.appendChild(cell);
    });

    for (var i = 0; i < n; i++) {
      var cell = stripCell("is-label", i, 1, 2);
      if (custom) {
        cell.appendChild(labelInput(i, cols.labels[i]));
        var del = document.createElement("button");
        del.type = "button";
        del.className = "calendar-strip-remove";
        del.innerHTML = ICON_XMARK;
        if (n <= 1) del.disabled = true;
        del.title = "Remove this column";
        del.setAttribute("aria-label", "Remove column " + (i + 1) + " (" + cols.labels[i] + ")");
        (function (idx) {
          del.addEventListener("click", function () { removeColumn(idx); });
        })(i);
        cell.appendChild(del);
      } else {
        cell.textContent = cols.labels[i];
      }
      strip.appendChild(cell);
    }

    if (custom) {
      var add = document.createElement("button");
      add.type = "button";
      add.className = "calendar-strip-add";
      add.innerHTML = ICON_PLUS;
      add.title = n >= maxColumns() ? "No more columns (" + maxColumns() + " at most)" : "Add a column";
      add.setAttribute("aria-label", "Add a column");
      add.disabled = n >= maxColumns();
      add.style.gridColumn = String(n + 2);
      add.style.gridRow = "1 / span 2";
      add.addEventListener("click", addColumn);
      strip.appendChild(add);
    }

    if (stripHint) stripHint.textContent = STRIP_HINTS[ax.kind];
  }

  // ── Row and category colours ───────────────────────────

  function swatchList() {
    var seen = {};
    var out = [];
    var add = function (s) {
      var k = String(s.hex).toUpperCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(s);
    };
    var base = _getSwatches ? (_getSwatches() || []) : [];
    for (var i = 0; i < base.length; i++) add(base[i]);
    for (var j = 0; j < BRAND_SWATCHES.length; j++) add(BRAND_SWATCHES[j]);
    return out;
  }

  // The colours the renderer falls back to, so each swatch shows what's drawn.
  function styleColors() {
    var st = ChartRegistry.getStyle(_store.style || "ocha");
    return (st && st.colors && st.colors.length) ? st.colors : ["#009EDB"];
  }
  function baseColor() {
    return (_store.colors && _store.colors[0]) || styleColors()[0];
  }

  function makeSwatch(hex, title, onPick) {
    var sw = document.createElement("button");
    sw.type = "button";
    sw.className = "table-ui-swatch";
    sw.style.background = hex;
    sw.title = title;
    sw.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!_colorDropdown) return;
      _colorDropdown(sw, hex, function (newHex) {
        hex = newHex;
        sw.style.background = newHex;
        onPick(newHex);
      }, swatchList());
    });
    return sw;
  }

  function makeReset(title, onReset) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "calendar-ui-reset";
    b.innerHTML = ICON_XMARK;
    b.title = title;
    b.addEventListener("click", function (ev) { ev.stopPropagation(); onReset(); });
    return b;
  }

  var MARK_OPTIONS = [
    { v: "", t: "Auto" }, { v: "bar", t: "Bar" }, { v: "dot", t: "Dot" }, { v: "line", t: "Line" }
  ];

  // Mark of a row: Auto = a bar when a line has an End, a dot when not
  // (the renderer's ChartRegistry.calendar.markType decides per line).
  function makeMarkSelect(name) {
    var sel = document.createElement("select");
    sel.className = "calendar-ui-mark";
    sel.title = "Mark for " + (name || "(no name)") +
      ": Auto = bar with an End, dot without · Line = spans as a line, single months as dots";
    var cur = (_store.calendarRowMarks && _store.calendarRowMarks[name]) || "";
    MARK_OPTIONS.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.v;
      opt.textContent = o.t;
      if (o.v === cur) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
      if (!_store.calendarRowMarks) _store.calendarRowMarks = {};
      if (sel.value) _store.calendarRowMarks[name] = sel.value;
      else delete _store.calendarRowMarks[name];
      refresh();
    });
    return sel;
  }

  // withMark: add the per-row Mark column (rows list only).
  function colorTable(firstHead, items, current, fallback, store, label, withMark) {
    var table = document.createElement("table");
    var head = document.createElement("tr");
    (withMark ? [firstHead, "Mark", "Color", ""] : [firstHead, "Color", ""]).forEach(function (t) {
      var th = document.createElement("th");
      th.textContent = t;
      head.appendChild(th);
    });
    table.appendChild(head);
    items.forEach(function (name) {
      var tr = document.createElement("tr");
      var nameCell = document.createElement("td");
      nameCell.className = "cat";
      nameCell.textContent = name || "(no name)";
      nameCell.title = nameCell.textContent;
      tr.appendChild(nameCell);
      if (withMark) {
        var markCell = document.createElement("td");
        markCell.appendChild(makeMarkSelect(name));
        tr.appendChild(markCell);
      }
      var own = current[name];
      var swCell = document.createElement("td");
      swCell.appendChild(makeSwatch(own || fallback(name), label + " " + (name || "(no name)"), function (hex) {
        var map = store();
        map[name] = hex;
        build();
        refresh();
      }));
      tr.appendChild(swCell);
      var resetCell = document.createElement("td");
      if (own) {
        resetCell.appendChild(makeReset("Back to the automatic colour", function () {
          delete store()[name];
          build();
          refresh();
        }));
      }
      tr.appendChild(resetCell);
      table.appendChild(tr);
    });
    return table;
  }

  function build() {
    if (!_store) return;
    syncAxisFields();   // also after an undo that brings back other columns
    buildStrip();
    var C = cal();
    var data = (C && _store.toCalendarData) ? _store.toCalendarData() : [];

    // Categories in order of first appearance (the renderer's order)
    var cats = [];
    var rowCat = {};
    data.forEach(function (row) {
      row.marks.forEach(function (mk) {
        if (mk.category && cats.indexOf(mk.category) === -1) cats.push(mk.category);
        if (mk.category && !rowCat.hasOwnProperty(row.name)) rowCat[row.name] = mk.category;
      });
    });
    var catMap = _store.calendarCategoryColors || {};
    var pal = styleColors();
    function catColor(c) {
      return catMap[c] || pal[cats.indexOf(c) % pal.length];
    }

    if (rowsGrid) {
      rowsGrid.innerHTML = "";
      var names = [];
      data.forEach(function (row) { if (names.indexOf(row.name) === -1) names.push(row.name); });
      if (!names.length) {
        var empty = document.createElement("div");
        empty.className = "table-ui-empty";
        empty.textContent = "Add lines in the Data tab to set each row’s mark and colour.";
        rowsGrid.appendChild(empty);
      } else {
        rowsGrid.appendChild(colorTable("Row", names, _store.calendarRowColors || {},
          function (name) { return rowCat.hasOwnProperty(name) ? catColor(rowCat[name]) : baseColor(); },
          function () {
            if (!_store.calendarRowColors) _store.calendarRowColors = {};
            return _store.calendarRowColors;
          }, "Color for", true));
      }
    }

    if (catsBlock) catsBlock.style.display = cats.length ? "" : "none";
    if (legendRow) legendRow.style.display = cats.length ? "" : "none";
    if (catsGrid) {
      catsGrid.innerHTML = "";
      if (cats.length) {
        catsGrid.appendChild(colorTable("Category", cats, catMap, catColor, function () {
          if (!_store.calendarCategoryColors) _store.calendarCategoryColors = {};
          return _store.calendarCategoryColors;
        }, "Color for category"));
      }
    }
  }

  return {
    init: init,
    show: show,
    hide: hide,
    syncToUI: syncToUI,
    build: build
  };
})();
