/**
 * TableUI — Design-tab controls for the Data Table chart ("Table Options").
 *
 *   • Look: two picture buttons, Classic (header band, grid) or Minimal
 *     (rules only, report look)
 *   • Columns grid laid out like the table: one grid column per table
 *     column (wrapping into blocks, never scrolling), one row per setting — Bars, 100% (grey track up to 100),
 *     Color, Width % (empty = automatic), Text align (three picture buttons), Bold, Italic, Group title (a
 *     title over neighbouring columns with the same text), Vertical line
 *   • Rows grid, one line per distinct row label: B (bold), Highlight
 *     (light tint), Color (when colouring by row)
 *   • Bars: two picture buttons, value above (default) or beside the bar
 *   • Colors: single color (default, with its swatch), by column or by row
 *
 * Writes straight to DataStore (table* fields); the renderer is
 * chart-table.js. Column settings are stored by column index —
 * DataStore.removeColumn / moveColumn keep them on the right columns.
 * Row settings are stored by the row's first-column label.
 *
 * init(deps):
 *   store         – DataStore
 *   generate      – function() (re-render SVG)
 *   schedule      – function() (debounced re-render)
 *   getSwatches   – function() → active style's swatch list
 *   colorDropdown – ColorPickersUI.buildSeriesDropdown
 */

/* global ChartRegistry */

var TableUI = (function () {
  "use strict";

  var _store, _generate, _schedule, _getSwatches, _colorDropdown;

  var section, styleChoice, barLabelChoice, colsGrid, rowsGrid, barOptions;
  var colorBySelect;
  var headingTimer = null;

  // Brand colours always offered, whatever the style: UN Blue, HNRP
  // orange, OCHA red and the neutral greys (OCHA colour palette).
  var BRAND_SWATCHES = [
    { hex: "#009EDB", name: "UN Blue" },
    { hex: "#F58220", name: "Orange" },
    { hex: "#ED1847", name: "Red" },
    { hex: "#4D4D4D", name: "Dark Grey" },
    { hex: "#999999", name: "Neutral Grey" },
    { hex: "#BFBFBF", name: "Light Grey" }
  ];

  // Three lines, drawn left / centred / right — the text-alignment pictures.
  var ALIGN_ICONS = {
    left:   '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 2h10M1 6h6M1 10h8" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    center: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 2h10M3 6h6M2 10h8" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    right:  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 2h10M5 6h6M3 10h8" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>'
  };

  function byId(id) { return document.getElementById(id); }

  function init(deps) {
    _store = deps.store;
    _generate = deps.generate;
    _schedule = deps.schedule;
    _getSwatches = deps.getSwatches;
    _colorDropdown = deps.colorDropdown;

    section = byId("table-options-section");
    styleChoice = byId("table-style-choice");
    barLabelChoice = byId("table-bar-label-choice");
    colsGrid = byId("table-cols-grid");
    rowsGrid = byId("table-rows-grid");
    watchWidth();
    barOptions = byId("table-bar-options");
    colorBySelect = byId("table-bar-color-by");

    bindChoice(styleChoice, function (v) {
      _store.tableStyle = v === "minimal" ? "minimal" : "classic";
      refresh();
    });
    bindChoice(barLabelChoice, function (v) {
      _store.tableBarLabel = v === "beside" ? "beside" : "above";
      refresh();
    });
    if (colorBySelect) colorBySelect.addEventListener("change", function () {
      var v = colorBySelect.value;
      _store.tableBarColorBy = (v === "row" || v === "column") ? v : "single";
      build();
      refresh();
    });
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
      var on = btns[i].getAttribute("data-value") === value;
      if (on) btns[i].classList.add("active"); else btns[i].classList.remove("active");
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
    setChoice(styleChoice, _store.tableStyle === "minimal" ? "minimal" : "classic");
    setChoice(barLabelChoice, _store.tableBarLabel === "beside" ? "beside" : "above");
    if (colorBySelect) colorBySelect.value = colorMode();
    build();
  }

  // ── Helpers ────────────────────────────────────────────

  function colorMode() {
    var m = _store.tableBarColorBy;
    return (m === "row" || m === "column") ? m : "single";
  }

  // The single bar colour: the user's pick, else the style's main shade.
  function singleColor() {
    return _store.tableBarColor || palette()[0];
  }

  // Swatch beside the Colors dropdown, shown in "Single color" mode.
  function buildSingleSwatch() {
    var holder = byId("table-single-color");
    if (!holder) return;
    holder.innerHTML = "";
    if (colorMode() !== "single") return;
    holder.appendChild(makeSwatch(singleColor(), "Bar color", function (hex) {
      _store.tableBarColor = hex;
      build();
      refresh();
    }));
  }

  // Default shades — the same list the renderer uses (ChartRegistry.tableShades).
  function palette() {
    return ChartRegistry.tableShades(ChartRegistry.getSequentialRamp(_store.style || "ocha"));
  }

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

  function isSeparatorRow(row) {
    var saw = false;
    for (var i = 0; i < (row || []).length; i++) {
      var s = row[i] == null ? "" : String(row[i]).trim();
      if (!s) continue;
      if (!/^-{3,}$/.test(s)) return false;
      saw = true;
    }
    return saw;
  }

  function toggleInList(list, value, on, numeric) {
    list = (list || []).slice();
    var pos = list.indexOf(value);
    if (on && pos === -1) list.push(value);
    if (!on && pos !== -1) list.splice(pos, 1);
    if (numeric) list.sort(function (a, b) { return a - b; });
    return list;
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

  function makeCheck(checked, title, onChange) {
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checked;
    cb.title = title;
    cb.addEventListener("change", function () { onChange(cb.checked); });
    return cb;
  }

  // "B" / "I" toggles, like the Bold / Italic buttons on the text fields.
  function makeBold(active, title, onToggle, italic) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "table-ui-b" + (italic ? " table-ui-i" : "") + (active ? " active" : "");
    b.textContent = italic ? "I" : "B";
    b.title = title;
    b.addEventListener("click", function () {
      var on = !b.classList.contains("active");
      if (on) b.classList.add("active"); else b.classList.remove("active");
      onToggle(on);
    });
    return b;
  }

  // Left / centre / right picture buttons. None active = automatic
  // (numbers right, text left); clicking the active one goes back to that.
  function makeAlign(current, onPick) {
    var wrap = document.createElement("span");
    wrap.className = "table-ui-align";
    var keys = ["left", "center", "right"];
    var btns = [];
    for (var i = 0; i < keys.length; i++) {
      (function (key) {
        var b = document.createElement("button");
        b.type = "button";
        b.innerHTML = ALIGN_ICONS[key];
        b.title = "Align " + key + (key === "center" ? "" : "") + " (click again for automatic)";
        if (current === key) b.className = "active";
        b.addEventListener("click", function () {
          var on = !b.classList.contains("active");
          for (var k = 0; k < btns.length; k++) btns[k].classList.remove("active");
          if (on) b.classList.add("active");
          onPick(on ? key : "");
        });
        btns.push(b);
        wrap.appendChild(b);
      })(keys[i]);
    }
    return wrap;
  }

  function td(child, cls) {
    var cell = document.createElement("td");
    if (cls) cell.className = cls;
    if (child) cell.appendChild(child);
    return cell;
  }

  function headRow(labels) {
    var tr = document.createElement("tr");
    for (var i = 0; i < labels.length; i++) {
      var th = document.createElement("th");
      th.textContent = labels[i];
      if (i === 0) th.className = "cat";
      tr.appendChild(th);
    }
    return tr;
  }

  // ── Columns + rows grids ───────────────────────────────

  // How many table columns fit across the panel (setting-name column
  // 58 px + 52 px per table column; see .table-ui-transposed in styles.css).
  var lastPerBlock = 0;
  function columnsPerBlock() {
    var w = (colsGrid && colsGrid.clientWidth) || 300;
    return Math.max(1, Math.floor((w - 60) / 53));
  }

  // Re-wrap the grid when the panel width changes how many columns fit.
  function watchWidth() {
    if (!colsGrid || typeof ResizeObserver === "undefined") return;
    var pending = null;
    new ResizeObserver(function () {
      if (pending) return;
      pending = setTimeout(function () {
        pending = null;
        if (section && section.style.display !== "none" && colsGrid.clientWidth > 0 &&
            columnsPerBlock() !== lastPerBlock) build();
      }, 150);
    }).observe(colsGrid);
  }

  function build() {
    if (!_store || !colsGrid) return;
    var headers = _store.headers || [];
    var barCols = _store.tableBarCols || [];
    var byRow = colorMode() === "row";
    var pal = palette();

    colsGrid.innerHTML = "";
    if (rowsGrid) rowsGrid.innerHTML = "";
    if (headers.length < 2) {
      colsGrid.innerHTML = '<div class="table-ui-empty">Add data in the Data tab to set up columns.</div>';
      if (barOptions) barOptions.style.display = "none";
      return;
    }

    // Laid out like the table itself: one grid column per table column
    // (named in the top row), one row per setting. No scrolling: when the
    // table has more columns than fit across the panel, the grid continues
    // in another block below, with the setting names repeated.
    var sortedBars = barCols.slice().sort(function (x, y) { return x - y; });
    var perBlock = columnsPerBlock();
    lastPerBlock = perBlock;
    var blocks = [];
    for (var b0 = 0; b0 < headers.length; b0 += perBlock) {
      var cols = [];
      for (var b1 = b0; b1 < Math.min(headers.length, b0 + perBlock); b1++) cols.push(b1);
      var tbl = document.createElement("table");
      tbl.className = "table-ui-transposed";
      var headTr = document.createElement("tr");
      var corner = document.createElement("th");
      corner.className = "rowhead";
      headTr.appendChild(corner);
      for (var hc = 0; hc < cols.length; hc++) {
        var th = document.createElement("th");
        var nm = colName(cols[hc]);
        th.textContent = nm;
        th.title = nm;
        headTr.appendChild(th);
      }
      tbl.appendChild(headTr);
      blocks.push({ cols: cols, table: tbl });
    }

    function colName(c) {
      return (headers[c] != null && String(headers[c]) !== "") ? String(headers[c]) : ("Column " + (c + 1));
    }

    function settingRow(label, hint, makeCell) {
      for (var bi = 0; bi < blocks.length; bi++) {
        var tr = document.createElement("tr");
        var lab = document.createElement("th");
        lab.className = "rowhead";
        lab.textContent = label;
        if (hint) lab.title = hint;
        tr.appendChild(lab);
        for (var ci = 0; ci < blocks[bi].cols.length; ci++) {
          var col = blocks[bi].cols[ci];
          tr.appendChild(td(makeCell(col, colName(col))));
        }
        blocks[bi].table.appendChild(tr);
      }
    }

    settingRow("Bars", "Show the column as value + bar", function (col) {
      if (col === 0) return null;
      return makeCheck(barCols.indexOf(col) !== -1, "Show this column as value + bar", function (on) {
        _store.tableBarCols = toggleInList(_store.tableBarCols, col, on, true);
        build();
        refresh();
      });
    });
    settingRow("100%", "Grey track up to 100 behind the bars (for percentages)", function (col) {
      if (barCols.indexOf(col) === -1) return null;
      return makeCheck((_store.tableBarTrackCols || []).indexOf(col) !== -1, "100% stacked bar: grey track up to 100", function (on) {
        _store.tableBarTrackCols = toggleInList(_store.tableBarTrackCols, col, on, true);
        refresh();
      });
    });
    if (!byRow) {
      // Bar columns. Single-color mode shows the one colour on every bar
      // column; picking another colour for one column switches the table
      // to "One color per column", the other columns keeping the single
      // colour. Per-column default: shades in bar-column order.
      var single = colorMode() === "single";
      settingRow("Color", "Bar color", function (col, name) {
        var isBar = barCols.indexOf(col) !== -1;
        if (!isBar) return null;
        var k = sortedBars.indexOf(col);
        var cur = single ? singleColor()
          : ((_store.tableBarColors && _store.tableBarColors[col]) || pal[k % pal.length]);
        return makeSwatch(cur, "Color for " + name, function (hex) {
          if (!_store.tableBarColors) _store.tableBarColors = {};
          if (colorMode() === "single") {
            if (hex.toUpperCase() === String(singleColor()).toUpperCase()) return;
            var keep = singleColor();
            var bars = _store.tableBarCols || [];
            for (var i = 0; i < bars.length; i++) _store.tableBarColors[bars[i]] = keep;
            _store.tableBarColorBy = "column";
            if (colorBySelect) colorBySelect.value = "column";
          }
          _store.tableBarColors[col] = hex;
          build();
          refresh();
        });
      });
    }
    settingRow("Width %", "Column width as % of the table width; empty = automatic", function (col) {
      var wi = document.createElement("input");
      wi.type = "text";
      wi.inputMode = "decimal";
      var curW = _store.tableColWidths && _store.tableColWidths[col];
      wi.value = curW ? String(curW) : "";
      wi.placeholder = "auto";
      wi.title = "Width of this column as % of the table width. Leave empty for automatic.";
      wi.addEventListener("input", function () {
        if (!_store.tableColWidths) _store.tableColWidths = {};
        var v = Number(String(wi.value).replace(",", ".").replace("%", "").trim());
        if (wi.value.trim() !== "" && isFinite(v) && v > 0) _store.tableColWidths[col] = Math.min(100, v);
        else delete _store.tableColWidths[col];
        if (headingTimer) clearTimeout(headingTimer);
        headingTimer = setTimeout(refresh, 300);
      });
      return wi;
    });
    settingRow("Text align", "Left, centre or right; none selected = automatic (numbers right, text left)", function (col) {
      return makeAlign((_store.tableColAlign && _store.tableColAlign[col]) || "", function (v) {
        if (!_store.tableColAlign) _store.tableColAlign = {};
        if (v) _store.tableColAlign[col] = v;
        else delete _store.tableColAlign[col];
        refresh();
      });
    });
    settingRow("Bold", "Bold column", function (col) {
      return makeBold((_store.tableColBold || []).indexOf(col) !== -1, "Bold column", function (on) {
        _store.tableColBold = toggleInList(_store.tableColBold, col, on, true);
        refresh();
      });
    });
    settingRow("Italic", "Italic column", function (col) {
      return makeBold((_store.tableColItalic || []).indexOf(col) !== -1, "Italic column", function (on) {
        _store.tableColItalic = toggleInList(_store.tableColItalic, col, on, true);
        refresh();
      }, true);
    });
    settingRow("Group title", "A title above this column. Neighbouring columns with the same group title share it (and one bar scale).", function (col) {
      var gt = document.createElement("input");
      gt.type = "text";
      gt.value = (_store.tableColGroups && _store.tableColGroups[col]) || "";
      gt.placeholder = "none";
      gt.title = "Group title above this column. Neighbouring columns with the same group title share it.";
      gt.addEventListener("input", function () {
        if (!_store.tableColGroups) _store.tableColGroups = {};
        var v = gt.value.trim();
        if (v) _store.tableColGroups[col] = v;
        else delete _store.tableColGroups[col];
        if (headingTimer) clearTimeout(headingTimer);
        headingTimer = setTimeout(refresh, 300);
      });
      return gt;
    });
    settingRow("Vertical line", "Vertical line after the column", function (col) {
      if (col >= headers.length - 1) return null;
      return makeCheck((_store.tableDividers || []).indexOf(col) !== -1, "Vertical line after this column", function (on) {
        _store.tableDividers = toggleInList(_store.tableDividers, col, on, true);
        refresh();
      });
    });
    for (var bk = 0; bk < blocks.length; bk++) colsGrid.appendChild(blocks[bk].table);

    if (barOptions) barOptions.style.display = barCols.length ? "block" : "none";
    buildSingleSwatch();
    buildRows(byRow, pal);
  }

  // One line per distinct first-column label, in row order — the renderer
  // assigns default row colours in the same order.
  function buildRows(byRow, pal) {
    if (!rowsGrid) return;
    var rows = _store.rows || [];
    var labels = [];
    var seen = {};
    for (var r = 0; r < rows.length; r++) {
      if (isSeparatorRow(rows[r])) continue;
      var lbl = rows[r] && rows[r][0] != null ? String(rows[r][0]).trim() : "";
      if (seen.hasOwnProperty(lbl)) continue;
      seen[lbl] = true;
      labels.push(lbl);
    }
    if (!labels.length) return;

    var table = document.createElement("table");
    table.appendChild(headRow(["Row", "B", "Highlight", byRow ? "Color" : ""]));
    for (var i = 0; i < labels.length; i++) {
      (function (lbl, idx) {
        var tr = document.createElement("tr");
        var nameCell = td(null, "cat");
        nameCell.textContent = lbl || "(empty)";
        nameCell.title = nameCell.textContent;
        tr.appendChild(nameCell);
        tr.appendChild(td(makeBold((_store.tableRowBold || []).indexOf(lbl) !== -1, "Bold row", function (on) {
          _store.tableRowBold = toggleInList(_store.tableRowBold, lbl, on, false);
          refresh();
        })));
        tr.appendChild(td(makeCheck((_store.tableRowHighlight || []).indexOf(lbl) !== -1, "Highlight this row with a light tint", function (on) {
          _store.tableRowHighlight = toggleInList(_store.tableRowHighlight, lbl, on, false);
          refresh();
        })));
        var colorCell = null;
        if (byRow) {
          var cur = (_store.tableRowColors && _store.tableRowColors[lbl]) || pal[idx % pal.length];
          colorCell = makeSwatch(cur, "Color for " + (lbl || "(empty)"), function (hex) {
            if (!_store.tableRowColors) _store.tableRowColors = {};
            _store.tableRowColors[lbl] = hex;
            refresh();
          });
        }
        tr.appendChild(td(colorCell));
        table.appendChild(tr);
      })(labels[i], i);
    }
    rowsGrid.appendChild(table);
  }

  return {
    init: init,
    show: show,
    hide: hide,
    syncToUI: syncToUI,
    build: build
  };
})();
