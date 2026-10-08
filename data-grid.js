/**
 * DataGrid — Editable HTML table component for Humanitarian DataViz Tool.
 * Renders DataStore.headers/rows as an interactive table.
 *
 * v12: Spreadsheet-like multi-cell selection with copy/paste.
 * Click to select, Shift+click to extend, drag to select range.
 * Double-click or Enter/F2 to edit a cell.
 * Ctrl/Cmd+C copies selection as TSV, Ctrl/Cmd+V pastes into grid.
 *
 * Event delegation — all handlers attached once on the container,
 * no per-element listeners, no leaks across re-renders.
 * Cached DOM queries for drag operations to avoid layout thrashing.
 */

/* global DataStore, PanelUtils */

var DataGrid = (function () {
  "use strict";

  var containerEl = null;
  var delegated = false; // true once delegated listeners are attached

  var grid = {};

  // ── Drag state ─────────────────────────────────────
  var dragRowIndex = -1;
  var dragColIndex = -1;
  var _cachedTbodyRows = null;
  var _cachedThs = null;

  // ── Selection state ────────────────────────────────
  // Selection mode: click = select, dblclick = edit
  var selAnchor = null;   // {row, col} start of selection
  var selEnd = null;       // {row, col} end of selection
  var isSelecting = false; // true during mouse-drag selection
  var editingCell = null;  // DOM element being edited, null = selection mode

  // ── Undo/Redo stack ────────────────────────────────
  var undoStack = [];  // snapshots of {headers, rows}
  var redoStack = [];
  var MAX_UNDO = 50;

  function snapshot() {
    return {
      headers: DataStore.headers.slice(),
      rows: DataStore.rows.map(function (r) { return r.slice(); }),
      labelCol: DataStore.labelCol,
      valueCol: DataStore.valueCol
    };
  }

  /** Call before any data-changing action to save current state */
  grid.pushUndo = function () {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = []; // new action clears redo
  };

  function restoreSnapshot(snap) {
    DataStore.headers = snap.headers;
    DataStore.rows = snap.rows;
    DataStore.labelCol = snap.labelCol;
    DataStore.valueCol = snap.valueCol;
    if (typeof DataStore.onChange === "function") DataStore.onChange();
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
  }

  // ── Render ─────────────────────────────────────────

  grid.render = function (el) {
    containerEl = el;
    if (!containerEl) return;

    // If no rows, seed empty starter rows for manual entry
    if (DataStore.rows.length === 0) {
      if (!DataStore.headers || DataStore.headers.length === 0) {
        DataStore.headers = ["Label", "Value"];
        DataStore.labelCol = 0;
        DataStore.valueCol = 1;
      }
      var cols = DataStore.headers.length;
      var emptyRow = function () { var r = []; for (var i = 0; i < cols; i++) r.push(""); return r; };
      DataStore.rows = [emptyRow(), emptyRow(), emptyRow()];
    }

    var html = [];

    // Clear-all toolbar: sits at the top-right, directly above the table —
    // close to the data and out of the way of the add-row bar below.
    html.push(
      '<div class="grid-toolbar">' +
      '<button id="btn-clear-data" class="btn-small btn-danger" title="Clear all data">' +
      '<svg viewBox="0 0 640 640" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M262.2 48C248.9 48 236.9 56.3 232.2 68.8L216 112L120 112C106.7 112 96 122.7 96 136C96 149.3 106.7 160 120 160L520 160C533.3 160 544 149.3 544 136C544 122.7 533.3 112 520 112L424 112L407.8 68.8C403.1 56.3 391.2 48 377.8 48L262.2 48zM128 208L128 512C128 547.3 156.7 576 192 576L448 576C483.3 576 512 547.3 512 512L512 208L464 208L464 512C464 520.8 456.8 528 448 528L192 528C183.2 528 176 520.8 176 512L176 208L128 208zM288 280C288 266.7 277.3 256 264 256C250.7 256 240 266.7 240 280L240 456C240 469.3 250.7 480 264 480C277.3 480 288 469.3 288 456L288 280zM400 280C400 266.7 389.3 256 376 256C362.7 256 352 266.7 352 280L352 456C352 469.3 362.7 480 376 480C389.3 480 400 469.3 400 456L400 280z"/></svg>Clear</button>' +
      '</div>'
    );
    // Wrapper: table + add-col button on far right
    html.push('<div class="grid-table-wrapper">');
    // Hidden textarea captures keyboard input when grid has selection (like Google Sheets)
    html.push('<textarea id="grid-key-sink" style="position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0;"></textarea>');
    html.push('<div class="grid-scroll">');
    html.push('<table id="data-table">');

    // Material 3 icons (inline SVG, 12px)
    var icoSort = '<svg width="12" height="12" viewBox="0 0 640 640" fill="currentColor"><path d="M320 118.6L198.6 240L441.4 240L320 118.6zM160 288C147.1 288 135.4 280.2 130.4 268.2C125.4 256.2 128.2 242.5 137.4 233.4L297.4 73.4C309.9 60.9 330.2 60.9 342.7 73.4L502.7 233.4C511.9 242.6 514.6 256.3 509.6 268.3C504.6 280.3 492.9 288 480 288L160 288zM320 521.4L441.4 400L198.6 400L320 521.4zM160 352L480 352C492.9 352 504.6 359.8 509.6 371.8C514.6 383.8 511.8 397.5 502.7 406.7L342.7 566.7C330.2 579.2 309.9 579.2 297.4 566.7L137.4 406.7C128.2 397.5 125.5 383.8 130.5 371.8C135.5 359.8 147.1 352 160 352z"/></svg>';
    var icoSortAsc = '<svg width="12" height="12" viewBox="0 0 640 640" fill="currentColor"><path d="M177 103C167.6 93.6 152.4 93.6 143.1 103L39 207C29.6 216.4 29.6 231.6 39 240.9C48.4 250.2 63.6 250.3 72.9 240.9L135.9 177.9L135.9 520C135.9 533.3 146.6 544 159.9 544C173.2 544 183.9 533.3 183.9 520L183.9 177.9L246.9 240.9C256.3 250.3 271.5 250.3 280.8 240.9C290.1 231.5 290.2 216.3 280.8 207L177 103zM344 544L392 544C405.3 544 416 533.3 416 520C416 506.7 405.3 496 392 496L344 496C330.7 496 320 506.7 320 520C320 533.3 330.7 544 344 544zM344 416L456 416C469.3 416 480 405.3 480 392C480 378.7 469.3 368 456 368L344 368C330.7 368 320 378.7 320 392C320 405.3 330.7 416 344 416zM344 288L520 288C533.3 288 544 277.3 544 264C544 250.7 533.3 240 520 240L344 240C330.7 240 320 250.7 320 264C320 277.3 330.7 288 344 288zM344 160L584 160C597.3 160 608 149.3 608 136C608 122.7 597.3 112 584 112L344 112C330.7 112 320 122.7 320 136C320 149.3 330.7 160 344 160z"/></svg>';
    var icoSortDesc = '<svg width="12" height="12" viewBox="0 0 640 640" fill="currentColor"><path d="M281 433L177 537C167.6 546.4 152.4 546.4 143.1 537L39 433C29.6 423.6 29.6 408.4 39 399.1C48.4 389.8 63.6 389.7 72.9 399.1L135.9 462.1L135.9 120C135.9 106.7 146.6 96 159.9 96C173.2 96 183.9 106.7 183.9 120L183.9 462.1L246.9 399.1C256.3 389.7 271.5 389.7 280.8 399.1C290.1 408.5 290.2 423.7 280.8 433zM344 544C330.7 544 320 533.3 320 520C320 506.7 330.7 496 344 496L392 496C405.3 496 416 506.7 416 520C416 533.3 405.3 544 392 544L344 544zM344 416C330.7 416 320 405.3 320 392C320 378.7 330.7 368 344 368L456 368C469.3 368 480 378.7 480 392C480 405.3 469.3 416 456 416L344 416zM344 288C330.7 288 320 277.3 320 264C320 250.7 330.7 240 344 240L520 240C533.3 240 544 250.7 544 264C544 277.3 533.3 288 520 288L344 288zM344 160C330.7 160 320 149.3 320 136C320 122.7 330.7 112 344 112L584 112C597.3 112 608 122.7 608 136C608 149.3 597.3 160 584 160L344 160z"/></svg>';
    var icoClose = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

    // ── Header row (sort + delete buttons inside each th, aligned per column)
    html.push('<thead><tr>');
    html.push('<th class="drag-handle-col"></th>');

    for (var h = 0; h < DataStore.headers.length; h++) {
      html.push('<th data-col="' + h + '" draggable="true">');
      // Action buttons row (sort + delete)
      html.push('<div class="th-actions">');
      var sIco = DataStore.sortCol === h
        ? (DataStore.sortDir === "desc" ? icoSortDesc : icoSortAsc)
        : icoSort;
      html.push('<button class="btn-col-sort" data-col="' + h + '" title="Sort">' + sIco + '</button>');
      if (DataStore.headers.length > 1) {
        html.push('<button class="btn-delete-col" data-col="' + h + '" title="Delete column">' + icoClose + '</button>');
      }
      html.push('</div>');
      // Header text
      html.push('<span class="col-drag-grip" title="Drag to reorder">⠿</span>');
      html.push(
        '<span class="header-text" data-col="' + h +
        '">' + escapeHtml(String(DataStore.headers[h])) + '</span>'
      );
      html.push('</th>');
    }

    html.push('<th class="row-action-col"></th>');
    html.push("</tr></thead>");

    // ── Data rows (cells NOT contenteditable by default — edit mode toggles it)
    html.push("<tbody>");
    for (var r = 0; r < DataStore.rows.length; r++) {
      // Tint the whole row red when one of its value cells was filled in but
      // can't be read as a number (e.g. "n/a") — points straight at the cell
      // to fix, alongside the warning banner.
      var rowBad = DataStore.rowHasBadValue && DataStore.rowHasBadValue(r);
      html.push('<tr data-row="' + r + '"' + (rowBad ? ' class="row-bad-value"' : '') + '>');
      html.push('<td class="drag-handle-col" draggable="true"><span class="row-grip">&#x2022;</span></td>');

      for (var c = 0; c < DataStore.headers.length; c++) {
        var val = DataStore.rows[r][c];
        if (val == null) val = "";
        html.push(
          '<td data-row="' + r + '" data-col="' + c + '">' +
          escapeHtml(String(val)) +
          "</td>"
        );
      }

      html.push(
        '<td class="row-action-col"><button class="btn-delete-row" data-row="' +
        r + '" title="Delete row">&times;</button></td>'
      );
      html.push("</tr>");
    }
    html.push("</tbody>");
    html.push("</table>");
    html.push("</div>"); // grid-scroll

    html.push('<button class="btn-add-col-inline" title="Add column">+</button>');
    html.push('</div>'); // grid-table-wrapper

    html.push(
      '<div class="grid-add-row-bar">' +
      '<button class="btn-add-row-inline" title="Add row">+</button>' +
      '</div>'
    );

    // Right-click context menu
    html.push(
      '<div id="grid-context-menu" class="grid-ctx-menu" style="display:none;">' +
      '<button data-action="cut">Cut</button>' +
      '<button data-action="copy">Copy</button>' +
      '<button data-action="paste">Paste</button>' +
      '<hr>' +
      '<button data-action="delete">Clear cells</button>' +
      '</div>'
    );

    containerEl.innerHTML = html.join("");

    // Reset selection on re-render
    selAnchor = null;
    selEnd = null;
    editingCell = null;

    // Attach delegated listeners ONCE — they survive re-renders
    if (!delegated) {
      attachDelegatedListeners();
      delegated = true;
    }

    updateColumnSelectors();
    updateRowCount();
  };

  // ══════════════════════════════════════════════════════
  //  SELECTION HELPERS
  // ══════════════════════════════════════════════════════

  function getCell(row, col) {
    if (!containerEl) return null;
    if (row === -1) {
      // Header row — return the th element
      return containerEl.querySelector('th[data-col="' + col + '"]');
    }
    return containerEl.querySelector('td[data-row="' + row + '"][data-col="' + col + '"]');
  }

  function getCellCoords(el) {
    if (!el) return null;
    // Data cell
    if (el.hasAttribute("data-row")) {
      return {
        row: parseInt(el.getAttribute("data-row"), 10),
        col: parseInt(el.getAttribute("data-col"), 10)
      };
    }
    // Header th or header-text span
    var th = el.closest ? el.closest("th[data-col]") : null;
    if (th) {
      return { row: -1, col: parseInt(th.getAttribute("data-col"), 10) };
    }
    return null;
  }

  function getSelectionRect() {
    if (!selAnchor || !selEnd) return null;
    return {
      r1: Math.min(selAnchor.row, selEnd.row),
      c1: Math.min(selAnchor.col, selEnd.col),
      r2: Math.max(selAnchor.row, selEnd.row),
      c2: Math.max(selAnchor.col, selEnd.col)
    };
  }

  function clearSelectionClasses() {
    if (!containerEl) return;
    var cells = containerEl.querySelectorAll(".cell-selected, .sel-anchor");
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove("cell-selected", "sel-anchor");
    }
  }

  function paintSelection() {
    clearSelectionClasses();
    var rect = getSelectionRect();
    if (!rect) return;
    for (var r = rect.r1; r <= rect.r2; r++) {
      for (var c = rect.c1; c <= rect.c2; c++) {
        var cell = getCell(r, c);
        if (cell) cell.classList.add("cell-selected");
      }
    }
    // Highlight anchor cell with stronger border
    if (selAnchor) {
      var anchor = getCell(selAnchor.row, selAnchor.col);
      if (anchor) anchor.classList.add("sel-anchor");
    }
  }

  function selectCell(row, col) {
    selAnchor = { row: row, col: col };
    selEnd = { row: row, col: col };
    paintSelection();
    // Focus hidden textarea so keyboard events are captured by the panel
    var sink = document.getElementById("grid-key-sink");
    if (sink) { sink.value = ""; sink.focus(); }
  }

  function clearSelection() {
    clearSelectionClasses();
    selAnchor = null;
    selEnd = null;
  }

  // ── Edit mode ──────────────────────────────────────

  function enterEditMode(td) {
    if (!td || !td.hasAttribute("data-row")) return;
    editingCell = td;
    td.setAttribute("contenteditable", "true");
    td.focus();
    selectAllInCell(td);
  }

  function exitEditMode(commit) {
    if (!editingCell) return;
    var td = editingCell;
    editingCell = null;
    if (commit !== false) {
      grid.pushUndo();
      var row = parseInt(td.getAttribute("data-row"), 10);
      var col = parseInt(td.getAttribute("data-col"), 10);
      DataStore.updateCell(row, col, td.textContent.trim());
      // Update the row's red highlight in place (a single-cell edit does a
      // chart-only update, not a full grid re-render, so toggle it here).
      var tr = td.parentNode;
      if (tr && tr.classList && DataStore.rowHasBadValue) {
        tr.classList.toggle("row-bad-value", DataStore.rowHasBadValue(row));
      }
    }
    td.setAttribute("contenteditable", "false");
    td.blur();
    // Re-select the cell in selection mode
    var coords = getCellCoords(td);
    if (coords) selectCell(coords.row, coords.col);
  }

  // ══════════════════════════════════════════════════════
  //  DELEGATED EVENT LISTENERS (attached once)
  // ══════════════════════════════════════════════════════

  function attachDelegatedListeners() {

    // ── Mousedown — start selection or edit ───────────
    containerEl.addEventListener("mousedown", function (e) {
      var target = e.target;

      // Hide context menu on any click
      hideContextMenu();

      // Ignore clicks on buttons, grips, and action columns
      if (target.tagName === "BUTTON" || target.classList.contains("row-grip") ||
          target.classList.contains("col-drag-grip") ||
          target.closest(".drag-handle-col") || target.closest(".row-action-col")) {
        return;
      }

      // Header click — enter header edit mode immediately. Used to
      // require a double-click which wasn't discoverable; users hit a
      // header, nothing happened, and they reached for the section
      // panel. Single-click is the Sheets-like behaviour everyone
      // expects.
      //
      // We accept clicks anywhere on the th (not just on the text span)
      // so the user doesn't have to pixel-target the text itself —
      // clicking on padding inside the th still puts the cursor in.
      // Buttons and the col-drag-grip are excluded above so reorder /
      // sort / delete are unaffected.
      var clickedTh = target.closest ? target.closest("th[data-col]") : null;
      if (clickedTh) {
        var hSpan = clickedTh.querySelector(".header-text");
        if (hSpan) {
          e.preventDefault();
          // Commit any other in-flight edit (different header or data cell)
          if (editingCell) exitEditMode(true);
          var prevHdr = containerEl.querySelector('.header-text[contenteditable="true"]');
          if (prevHdr && prevHdr !== hSpan) prevHdr.blur();
          // Paint the header as the current selection right away so
          // the user sees an immediate visual response (matches data
          // cells). We do this BEFORE focusing the span — paintSelection
          // doesn't touch focus. Avoid calling selectCell() because
          // that would steal focus to grid-key-sink, breaking edit mode.
          var hCol = parseInt(clickedTh.getAttribute("data-col"), 10);
          if (!isNaN(hCol)) {
            selAnchor = { row: -1, col: hCol };
            selEnd    = { row: -1, col: hCol };
            paintSelection();
          }
          if (hSpan.getAttribute("contenteditable") !== "true") {
            hSpan.setAttribute("contenteditable", "true");
          }
          hSpan.focus();
          // selectAllInCell runs from the existing focus-delegation handler,
          // so the existing text is highlighted — typing replaces it the
          // way data cells do.
          return;
        }
      }

      // Find the data cell or header cell
      var td = target.closest ? (target.closest("td[data-row]") || target.closest("th[data-col]")) : null;
      if (!td) return;

      var coords = getCellCoords(td);
      if (!coords) return;

      // If currently editing a different cell, commit and exit edit mode
      if (editingCell && editingCell !== td) {
        exitEditMode(true);
      }

      // If clicking the cell being edited, let contenteditable handle it
      if (editingCell === td) return;

      // Shift+click: extend selection
      if (e.shiftKey && selAnchor) {
        e.preventDefault();
        selEnd = { row: coords.row, col: coords.col };
        paintSelection();
        return;
      }

      // Normal click: start new selection
      e.preventDefault();
      selectCell(coords.row, coords.col);
      isSelecting = true;
    });

    // ── Mouseover — extend selection during drag ─────
    containerEl.addEventListener("mouseover", function (e) {
      if (!isSelecting || !selAnchor) return;
      var td = e.target.closest ? (e.target.closest("td[data-row]") || e.target.closest("th[data-col]")) : null;
      if (!td) return;
      var coords = getCellCoords(td);
      if (!coords) return;
      selEnd = { row: coords.row, col: coords.col };
      paintSelection();
    });

    // ── Mouseup — end drag selection ─────────────────
    document.addEventListener("mouseup", function () {
      isSelecting = false;
    });

    // ── Dismiss context menu on any document click ───
    document.addEventListener("mousedown", function (e) {
      var menu = document.getElementById("grid-context-menu");
      if (menu && menu.style.display === "block" && !menu.contains(e.target)) {
        hideContextMenu();
      }
    });

    // ── Double-click — enter edit mode ────────────────
    containerEl.addEventListener("dblclick", function (e) {
      var td = e.target.closest ? e.target.closest("td[data-row]") : null;
      if (td) { enterEditMode(td); return; }
      // Header double-click — edit header text
      var th = e.target.closest ? e.target.closest("th[data-col]") : null;
      if (th) {
        var span = th.querySelector(".header-text");
        if (span) { span.focus(); selectAllInCell(span); }
      }
    });

    // ── Click delegation (buttons, sort, shift+click) ─
    containerEl.addEventListener("click", function (e) {
      var target = e.target;

      // Shift+click on data cell — extend selection
      if (e.shiftKey && selAnchor) {
        var shiftTd = target.closest ? target.closest("td[data-row]") : null;
        if (shiftTd) {
          var sc = getCellCoords(shiftTd);
          if (sc) {
            selEnd = { row: sc.row, col: sc.col };
            paintSelection();
          }
          return;
        }
      }

      // Delete row
      var delRowBtn = target.closest(".btn-delete-row");
      if (delRowBtn) {
        grid.pushUndo();
        var row = parseInt(delRowBtn.getAttribute("data-row"), 10);
        if (!isNaN(row)) DataStore.removeRow(row);
        return;
      }

      // Delete column (in action bar — may click on SVG inside button)
      var delColBtn = target.closest(".btn-delete-col");
      if (delColBtn) {
        e.stopPropagation();
        var col = parseInt(delColBtn.getAttribute("data-col"), 10);
        if (!isNaN(col) && DataStore.headers.length > 1) {
          // Confirm — deleting a column wipes a whole series of values.
          var colName = DataStore.headers[col] || ("column " + (col + 1));
          if (window.confirm('Delete the "' + colName + '" column and all its values?')) {
            grid.pushUndo();
            DataStore.removeColumn(col);
          }
        }
        return;
      }

      // Add column
      if (target.classList.contains("btn-add-col-inline")) {
        grid.pushUndo();
        DataStore.addColumn();
        return;
      }

      // Add row
      if (target.classList.contains("btn-add-row-inline")) {
        grid.pushUndo();
        DataStore.addRow();
        return;
      }

      // Clear data (closest, so clicking the trash icon inside counts too)
      if (target.closest("#btn-clear-data")) {
        grid.pushUndo();
        DataStore.clear();
        return;
      }

      // Column sort — via sort button in action bar (may click on SVG inside button)
      var sortBtn = target.closest(".btn-col-sort");
      if (sortBtn) {
        grid.pushUndo();
        var sortCol = parseInt(sortBtn.getAttribute("data-col"), 10);
        if (!isNaN(sortCol)) {
          var dir = "asc";
          if (DataStore.sortCol === sortCol && DataStore.sortDir === "asc") dir = "desc";
          DataStore.sortByColumn(sortCol, dir);
        }
        return;
      }
    });

    // ── Blur delegation (header editing) ─────────────
    containerEl.addEventListener("blur", function (e) {
      var target = e.target;

      // Data cell blur — handled by exitEditMode, but catch any stragglers
      if (target.tagName === "TD" && target.hasAttribute("data-row") && target === editingCell) {
        exitEditMode(true);
        return;
      }

      // Header blur — commit edit and disable contenteditable
      if (target.classList.contains("header-text")) {
        var hCol = parseInt(target.getAttribute("data-col"), 10);
        DataStore.updateHeader(hCol, target.textContent.trim());
        target.removeAttribute("contenteditable");
        updateColumnSelectors();
        // Re-select the header cell
        selectCell(-1, hCol);
      }
    }, true);

    // ── Focus delegation (select-all on header focus) ─
    containerEl.addEventListener("focus", function (e) {
      var target = e.target;
      if (target.classList.contains("header-text")) {
        setTimeout(function () { selectAllInCell(target); }, 0);
      }
    }, true);

    // ── Keydown — on document so it fires from the hidden textarea
    document.addEventListener("keydown", function (e) {
      // Only handle when grid area is active (has selection or editing)
      if (!selAnchor && !editingCell) return;
      // Don't intercept keys when a non-grid input is focused
      var ae = document.activeElement;
      var isGridSink = ae && ae.id === "grid-key-sink";
      if (ae && !isGridSink) {
        if (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT") return;
      }
      if (ae && ae.getAttribute("contenteditable") === "true" && ae !== editingCell && !ae.classList.contains("header-text")) return;

      // Undo/Redo — Cmd+Z / Ctrl+Z and Cmd+Shift+Z / Ctrl+Shift+Z
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (editingCell) exitEditMode(true);
        if (e.shiftKey) { redo(); } else { undo(); }
        return;
      }

      var target = e.target;

      // Header keydown — editing header text
      if (target.classList.contains("header-text") && target.getAttribute("contenteditable") === "true") {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          target.blur(); // triggers blur handler → commit + remove contenteditable
        }
        if (e.key === "Tab") {
          e.preventDefault();
          target.blur();
          var hCol = parseInt(target.getAttribute("data-col"), 10);
          var nextCol = e.shiftKey ? hCol - 1 : hCol + 1;
          if (nextCol >= 0 && nextCol < DataStore.headers.length) {
            selectCell(-1, nextCol);
          }
        }
        return;
      }

      // ── Edit mode keydown ──────────────────────────
      if (editingCell) {
        if (e.key === "Escape") {
          e.preventDefault();
          exitEditMode(false); // discard
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          exitEditMode(true);
          var coords = getCellCoords(editingCell || target);
          if (!coords && selAnchor) coords = selAnchor;
          if (coords) {
            var nc = e.shiftKey ? coords.col - 1 : coords.col + 1;
            var nr = coords.row;
            if (nc < 0) { nc = DataStore.headers.length - 1; nr--; }
            if (nc >= DataStore.headers.length) { nc = 0; nr++; }
            if (nr >= 0 && nr < DataStore.rows.length) {
              selectCell(nr, nc);
              enterEditMode(getCell(nr, nc));
            }
          }
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          exitEditMode(true);
          if (selAnchor && selAnchor.row + 1 < DataStore.rows.length) {
            selectCell(selAnchor.row + 1, selAnchor.col);
          }
          return;
        }
        // Let other keys work normally in edit mode (typing, arrows inside text)
        return;
      }

      // ── Selection mode keydown ─────────────────────
      if (!selAnchor) return;

      var r = selAnchor.row;
      var c = selAnchor.col;

      // Arrow keys — move or extend selection
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        var dr = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        var dc = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;

        // Row clamp uses -1 so arrow-keying off the top row lands on
        // the header row (row -1 is the header convention used here,
        // matching Tab navigation below). Columns clamp at 0 because
        // there's no virtual column above col 0.
        if (e.shiftKey) {
          // Extend selection
          var end = selEnd || selAnchor;
          var newR = Math.max(-1, Math.min(DataStore.rows.length - 1, end.row + dr));
          var newC = Math.max(0, Math.min(DataStore.headers.length - 1, end.col + dc));
          selEnd = { row: newR, col: newC };
          paintSelection();
        } else {
          // Move selection
          var mr = Math.max(-1, Math.min(DataStore.rows.length - 1, r + dr));
          var mc = Math.max(0, Math.min(DataStore.headers.length - 1, c + dc));
          selectCell(mr, mc);
        }
        return;
      }

      // Enter or F2 — enter edit mode
      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        if (r === -1) {
          // Header edit — focus the header-text span
          var th = getCell(-1, c);
          if (th) {
            var span = th.querySelector(".header-text");
            if (span) { span.setAttribute("contenteditable", "true"); span.focus(); selectAllInCell(span); }
          }
        } else {
          var cell = getCell(r, c);
          if (cell) enterEditMode(cell);
        }
        return;
      }

      // Tab — move selection
      if (e.key === "Tab") {
        e.preventDefault();
        var tc = e.shiftKey ? c - 1 : c + 1;
        var tr2 = r;
        if (tc < 0) { tc = DataStore.headers.length - 1; tr2--; }
        if (tc >= DataStore.headers.length) { tc = 0; tr2++; }
        if (tr2 >= -1 && tr2 < DataStore.rows.length) {
          selectCell(tr2, tc);
        }
        return;
      }

      // Delete/Backspace — clear selected cells
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        grid.pushUndo();
        var rect = getSelectionRect();
        if (rect) {
          for (var dr2 = rect.r1; dr2 <= rect.r2; dr2++) {
            for (var dc2 = rect.c1; dc2 <= rect.c2; dc2++) {
              DataStore.updateCell(dr2, dc2, "");
              var cl = getCell(dr2, dc2);
              if (cl) cl.textContent = "";
            }
          }
          if (typeof DataStore.onValueChange === "function") DataStore.onValueChange();
        }
        return;
      }

      // Escape — clear selection
      if (e.key === "Escape") {
        clearSelection();
        return;
      }

      // Printable character — start editing.
      //
      // Symmetry with data cells: typing while a header cell is
      // selected should drop the cursor in and let the typed char
      // become the new header text. Without this special-case,
      // getCell(-1, c) returns the <th> (which contains buttons and
      // the drag grip), `textContent = ""` wipes the whole thing,
      // and enterEditMode early-outs because th has no data-row —
      // so typing did nothing and silently destroyed the header
      // chrome on the way.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (r === -1) {
          var hth = getCell(-1, c);
          var hspan = hth ? hth.querySelector(".header-text") : null;
          if (hspan) {
            hspan.setAttribute("contenteditable", "true");
            hspan.textContent = ""; // clear so the typed char replaces it
            hspan.focus();
            // Don't preventDefault — the character goes into the
            // now-focused span on the keypress that follows.
          }
          return;
        }
        var editCell = getCell(r, c);
        if (editCell) {
          editCell.textContent = ""; // clear cell, will be replaced by typed char
          enterEditMode(editCell);
          // Don't prevent default — let the character be typed
        }
      }
    });

    // ── Copy — on document so it fires from grid-key-sink
    document.addEventListener("copy", function (e) {
      if (editingCell) return; // let browser handle copy in edit mode
      var rect = getSelectionRect();
      if (!rect) return;

      e.preventDefault();
      var lines = [];
      for (var r = rect.r1; r <= rect.r2; r++) {
        var row = [];
        for (var c = rect.c1; c <= rect.c2; c++) {
          var val;
          if (r === -1) {
            val = DataStore.headers[c] || "";
          } else {
            val = DataStore.rows[r] ? DataStore.rows[r][c] : "";
          }
          if (val == null) val = "";
          row.push(String(val));
        }
        lines.push(row.join("\t"));
      }
      var tsv = lines.join("\n");
      e.clipboardData.setData("text/plain", tsv);
    });

    // ── Cut (Cmd+X) — copy then clear selected cells ──
    document.addEventListener("cut", function (e) {
      if (editingCell) return;
      var rect = getSelectionRect();
      if (!rect) return;
      grid.pushUndo();

      e.preventDefault();
      // Copy to clipboard
      var lines = [];
      for (var r = rect.r1; r <= rect.r2; r++) {
        var row = [];
        for (var c = rect.c1; c <= rect.c2; c++) {
          var val;
          if (r === -1) {
            val = DataStore.headers[c] || "";
          } else {
            val = DataStore.rows[r] ? DataStore.rows[r][c] : "";
          }
          if (val == null) val = "";
          row.push(String(val));
        }
        lines.push(row.join("\t"));
      }
      e.clipboardData.setData("text/plain", lines.join("\n"));

      // Clear the cells (not headers)
      for (var r2 = Math.max(0, rect.r1); r2 <= rect.r2; r2++) {
        for (var c2 = rect.c1; c2 <= rect.c2; c2++) {
          DataStore.updateCell(r2, c2, "");
          var cl = getCell(r2, c2);
          if (cl) cl.textContent = "";
        }
      }
      if (typeof DataStore.onValueChange === "function") DataStore.onValueChange();
    });

    // ── Right-click context menu ─────────────────────
    containerEl.addEventListener("contextmenu", function (e) {
      var td = e.target.closest ? (e.target.closest("td[data-row]") || e.target.closest("th[data-col]")) : null;
      if (!td) return;

      e.preventDefault();
      // If right-clicking outside current selection, select the clicked cell
      var coords = getCellCoords(td);
      if (coords) {
        var rect = getSelectionRect();
        if (!rect || coords.row < rect.r1 || coords.row > rect.r2 || coords.col < rect.c1 || coords.col > rect.c2) {
          selectCell(coords.row, coords.col);
        }
      }
      showContextMenu(e.clientX, e.clientY);
    });

    // ── Paste — on document so it fires from grid-scroll focus
    document.addEventListener("paste", function (e) {
      // Only handle when grid area is active
      if (!selAnchor && !editingCell) return;
      // If editing a cell, paste into that cell only
      if (editingCell) {
        e.preventDefault();
        var clipboard = e.clipboardData || window.clipboardData;
        var plain = clipboard.getData("text/plain") || "";
        // Check if it's multi-cell data
        var hasMulti = plain.indexOf("\t") !== -1 || plain.split("\n").length > 2;
        if (!hasMulti) {
          // Single value — insert into editing cell
          document.execCommand("insertText", false, plain.trim());
          return;
        }
        // Multi-cell paste while editing — exit edit and paste from anchor
        exitEditMode(true);
        // Fall through to multi-cell paste below
        pasteMultiCell(plain);
        return;
      }

      // Selection mode paste
      if (!selAnchor) {
        // No selection — try loading as full dataset (legacy behavior)
        e.preventDefault();
        var cb = e.clipboardData || window.clipboardData;
        var text = cb.getData("text/plain") || "";
        var htmlData = cb.getData("text/html") || "";
        var hasMultiCell = text.indexOf("\t") !== -1 || text.split("\n").length > 2;
        if (hasMultiCell || (htmlData && DataStore.parseHtmlTable(htmlData))) {
          var parsed = htmlData ? (DataStore.parseHtmlTable(htmlData) || text) : text;
          DataStore.loadFromCSVString(parsed);
        }
        return;
      }

      e.preventDefault();
      var cb2 = e.clipboardData || window.clipboardData;
      var plainText = cb2.getData("text/plain") || "";
      pasteMultiCell(plainText);
    });

    // ── Drag delegation (unchanged) ──────────────────

    containerEl.addEventListener("dragstart", function (e) {
      var target = e.target;

      // Row drag — handle cell
      if (target.tagName === "TD" && target.classList.contains("drag-handle-col")) {
        var tr2 = target.parentElement;
        dragRowIndex = parseInt(tr2.getAttribute("data-row"), 10);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragRowIndex));
        _cachedTbodyRows = containerEl.querySelectorAll("tbody tr[data-row]");
        setTimeout(function () { tr2.classList.add("dragging"); }, 0);
        return;
      }

      // Column drag — <th> header
      var th = target.closest ? target.closest("th[data-col]") : null;
      if (th && target.getAttribute("contenteditable") !== "true" &&
          !target.classList.contains("header-text")) {
        dragColIndex = parseInt(th.getAttribute("data-col"), 10);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragColIndex));
        _cachedThs = containerEl.querySelectorAll("th[draggable]");
        var allCells = containerEl.querySelectorAll('[data-col="' + dragColIndex + '"]');
        setTimeout(function () {
          th.classList.add("col-dragging");
          for (var i = 0; i < allCells.length; i++) allCells[i].classList.add("col-dragging");
        }, 0);
        return;
      }

      // If dragstart fires on header text, cancel it
      if (target.classList.contains("header-text") || target.getAttribute("contenteditable") === "true") {
        e.preventDefault();
      }
    });

    containerEl.addEventListener("dragover", function (e) {
      if (dragRowIndex >= 0) {
        var tr = e.target.closest ? e.target.closest("tr[data-row]") : null;
        if (!tr) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (_cachedTbodyRows) {
          for (var i = 0; i < _cachedTbodyRows.length; i++) {
            _cachedTbodyRows[i].classList.remove("drag-over-above", "drag-over-below");
          }
        }
        var rect = tr.getBoundingClientRect();
        tr.classList.add(e.clientY < rect.top + rect.height / 2 ? "drag-over-above" : "drag-over-below");
        return;
      }

      if (dragColIndex >= 0) {
        var th = e.target.closest ? e.target.closest("th[data-col]") : null;
        if (!th) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (_cachedThs) {
          for (var j = 0; j < _cachedThs.length; j++) {
            _cachedThs[j].classList.remove("drag-over-left", "drag-over-right");
          }
        }
        var thRect = th.getBoundingClientRect();
        th.classList.add(e.clientX < thRect.left + thRect.width / 2 ? "drag-over-left" : "drag-over-right");
      }
    });

    containerEl.addEventListener("dragleave", function (e) {
      var target = e.target;
      if (target.tagName === "TR") target.classList.remove("drag-over-above", "drag-over-below");
      if (target.tagName === "TH") target.classList.remove("drag-over-left", "drag-over-right");
    });

    containerEl.addEventListener("drop", function (e) {
      e.preventDefault();
      if (dragRowIndex >= 0) {
        var tr = e.target.closest ? e.target.closest("tr[data-row]") : null;
        if (tr) {
          var toRow = parseInt(tr.getAttribute("data-row"), 10);
          if (!isNaN(toRow) && toRow !== dragRowIndex) DataStore.moveRow(dragRowIndex, toRow);
        }
        dragRowIndex = -1;
        _cachedTbodyRows = null;
        return;
      }
      if (dragColIndex >= 0) {
        var th = e.target.closest ? e.target.closest("th[data-col]") : null;
        if (th) {
          var toCol = parseInt(th.getAttribute("data-col"), 10);
          if (!isNaN(toCol) && toCol !== dragColIndex) DataStore.moveColumn(dragColIndex, toCol);
        }
        dragColIndex = -1;
        _cachedThs = null;
      }
    });

    containerEl.addEventListener("dragend", function () {
      if (_cachedTbodyRows) {
        for (var i = 0; i < _cachedTbodyRows.length; i++) {
          _cachedTbodyRows[i].classList.remove("dragging", "drag-over-above", "drag-over-below");
        }
      } else {
        var rows = containerEl.querySelectorAll("tbody tr");
        for (var ri = 0; ri < rows.length; ri++) {
          rows[ri].classList.remove("dragging", "drag-over-above", "drag-over-below");
        }
      }
      if (_cachedThs) {
        for (var j = 0; j < _cachedThs.length; j++) {
          _cachedThs[j].classList.remove("col-dragging", "drag-over-left", "drag-over-right");
        }
      }
      var dragCells = containerEl.querySelectorAll(".col-dragging");
      for (var k = 0; k < dragCells.length; k++) dragCells[k].classList.remove("col-dragging");
      dragRowIndex = -1;
      dragColIndex = -1;
      _cachedTbodyRows = null;
      _cachedThs = null;
    });
  }

  // ── Multi-cell paste helper ────────────────────────

  function pasteMultiCell(text) {
    if (!selAnchor) return;
    grid.pushUndo();
    var lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    // Remove trailing empty line (common with clipboard)
    if (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();

    var startR = selAnchor.row; // -1 = header row
    var startC = selAnchor.col;

    for (var i = 0; i < lines.length; i++) {
      var r = startR + i;
      var cols = lines[i].split("\t");

      if (r === -1) {
        // Paste into header row
        for (var j2 = 0; j2 < cols.length; j2++) {
          var hc = startC + j2;
          if (hc < DataStore.headers.length) {
            DataStore.headers[hc] = cols[j2].trim();
          }
        }
        continue;
      }

      // Add data rows if needed
      while (r >= DataStore.rows.length) {
        var empty = [];
        for (var x = 0; x < DataStore.headers.length; x++) empty.push("");
        DataStore.rows.push(empty);
      }
      for (var j = 0; j < cols.length; j++) {
        var c = startC + j;
        if (c < DataStore.headers.length) {
          // Use the shared parser so a pasted block reads numbers the same
          // way as typing/CSV load (handles %, currency, thousands and
          // decimal commas — no more silent "1,5 → 15" or "45% → dropped").
          DataStore.rows[r][c] = DataStore.coerceNumber(cols[j].trim());
        }
      }
    }

    // Trigger full re-render
    if (typeof DataStore.onChange === "function") DataStore.onChange();
  }

  // ── Context menu helpers ────────────────────────────

  function showContextMenu(x, y) {
    var menu = document.getElementById("grid-context-menu");
    if (!menu) return;
    // Position relative to container
    var cRect = containerEl.getBoundingClientRect();
    menu.style.left = (x - cRect.left) + "px";
    menu.style.top = (y - cRect.top) + "px";
    menu.style.display = "block";

    // Wire up buttons (re-attach each time for simplicity)
    var btns = menu.querySelectorAll("button[data-action]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = function () {
        var action = this.getAttribute("data-action");
        hideContextMenu();
        if (action === "copy") doCopy();
        if (action === "cut") doCut();
        if (action === "paste") doPaste();
        if (action === "delete") doDelete();
      };
    }
  }

  function hideContextMenu() {
    var menu = document.getElementById("grid-context-menu");
    if (menu) menu.style.display = "none";
  }

  // Programmatic copy (for context menu — uses execCommand since we can't use clipboard API)
  function doCopy() {
    var sink = document.getElementById("grid-key-sink");
    if (!sink) return;
    var rect = getSelectionRect();
    if (!rect) return;
    var lines = [];
    for (var r = rect.r1; r <= rect.r2; r++) {
      var row = [];
      for (var c = rect.c1; c <= rect.c2; c++) {
        var val = r === -1 ? (DataStore.headers[c] || "") : (DataStore.rows[r] ? DataStore.rows[r][c] : "");
        if (val == null) val = "";
        row.push(String(val));
      }
      lines.push(row.join("\t"));
    }
    sink.value = lines.join("\n");
    sink.select();
    document.execCommand("copy");
    sink.value = "";
  }

  function doCut() {
    doCopy();
    doDelete();
  }

  function doPaste() {
    var sink = document.getElementById("grid-key-sink");
    if (sink) { sink.value = ""; sink.focus(); }
    // Trigger paste via execCommand — the paste event handler will pick it up
    document.execCommand("paste");
  }

  function doDelete() {
    var rect = getSelectionRect();
    if (!rect) return;
    grid.pushUndo();
    for (var r = Math.max(0, rect.r1); r <= rect.r2; r++) {
      for (var c = rect.c1; c <= rect.c2; c++) {
        DataStore.updateCell(r, c, "");
        var cl = getCell(r, c);
        if (cl) cl.textContent = "";
      }
    }
    if (typeof DataStore.onValueChange === "function") DataStore.onValueChange();
  }

  // ── Helpers ────────────────────────────────────────

  function selectAllInCell(cell) {
    var range = document.createRange();
    range.selectNodeContents(cell);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function updateColumnSelectors() {
    var labelSel = document.getElementById("sel-label-col");
    var valueSel = document.getElementById("sel-value-col");
    if (!labelSel || !valueSel) return;

    var html = "";
    for (var i = 0; i < DataStore.headers.length; i++) {
      html += '<option value="' + i + '">' + escapeHtml(String(DataStore.headers[i])) + "</option>";
    }

    labelSel.innerHTML = html;
    valueSel.innerHTML = html;
    labelSel.value = DataStore.labelCol;
    valueSel.value = DataStore.valueCol;
  }

  function updateRowCount() {
    var el = document.getElementById("row-count");
    if (el) {
      var count = DataStore.rowCount();
      el.textContent = count + " row" + (count !== 1 ? "s" : "") +
        " \u00B7 " + DataStore.headers.length + " col" + (DataStore.headers.length !== 1 ? "s" : "");
    }
  }

  var escapeHtml = PanelUtils.escapeHtml;

  return grid;
})();
