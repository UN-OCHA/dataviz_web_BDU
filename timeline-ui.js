/**
 * TimelineUI — Design-tab UI for Timeline chart.
 *
 * Currently only exposes the per-row icon picker (one icon per event),
 * mirroring the keyfigures pattern. The orientation toggle lives in
 * design-controls-ui.js alongside the bubble orientation toggle.
 *
 * init(deps):
 *   store             – DataStore
 *   generate          – function() (re-render SVG)
 *   schedule          – function() (debounced re-render)
 *   openIconPicker    – function(rowIdx, mode) — pass mode="timeline"
 *   assetIconsDir     – string path for loading icon preview SVGs
 */

/* global SvgInlineUtils, Connector */

var TimelineUI = (function () {
  "use strict";

  var _store;
  var _generate;
  var _schedule;
  var _openIconPicker;
  var _assetIconsDir;

  var section;
  var iconRowList;

  // ── Init ───────────────────────────────────────────────

  function init(deps) {
    _store = deps.store;
    _generate = deps.generate;
    _schedule = deps.schedule;
    _openIconPicker = deps.openIconPicker;
    _assetIconsDir = deps.assetIconsDir || "";

    section = document.getElementById("timeline-options-section");
    iconRowList = document.getElementById("timeline-icon-rows");
  }

  // ── Show / Hide ────────────────────────────────────────

  function show() {
    if (section) section.style.display = "block";
    buildIconRows();
  }

  function hide() {
    if (section) section.style.display = "none";
  }

  // ── Per-row icon list ──────────────────────────────────

  function buildIconRows() {
    if (!iconRowList || !_store) return;
    iconRowList.innerHTML = "";

    // Two-column responsive grid — collapses to one column when the
    // panel is too narrow for two cells of the minmax min width
    // (150 px). Each row stays a flex layout for icon + label inside
    // its grid cell.
    iconRowList.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:3px 12px;";

    var data = _store.toTimelineData ? _store.toTimelineData() : [];
    if (!data.length) {
      var empty = document.createElement("div");
      // Empty-state message spans the full width regardless of grid columns.
      empty.style.cssText = "font-size:11px;color:var(--text-tertiary);padding:6px 0;grid-column:1 / -1;";
      empty.textContent = "Add rows in the Data tab to assign icons.";
      iconRowList.appendChild(empty);
      return;
    }

    for (var i = 0; i < data.length; i++) {
      var row = document.createElement("div");
      row.className = "tl-icon-row";
      row.style.cssText = "display:flex;align-items:center;gap:6px;padding:3px 0;min-width:0;";

      // Icon button
      var iconBtn = document.createElement("button");
      iconBtn.className = "tl-icon-btn";
      iconBtn.style.cssText = "width:24px;height:24px;border:1px solid var(--border-default);border-radius:4px;cursor:pointer;background:var(--bg-input);display:flex;align-items:center;justify-content:center;padding:2px;overflow:hidden;flex-shrink:0;";
      iconBtn.setAttribute("data-row", data[i]._srcRow);

      var srcRow = data[i]._srcRow;
      var ref = _store.iconSelections && _store.iconSelections[srcRow];
      if (ref) {
        var previewSvg = loadIconPreview(ref);
        if (previewSvg) {
          iconBtn.innerHTML = previewSvg;
        } else {
          iconBtn.textContent = "\u2713";
        }
      } else {
        iconBtn.textContent = "+";
        iconBtn.style.color = "var(--text-tertiary)";
        iconBtn.style.fontSize = "14px";
      }

      iconBtn.addEventListener("click", (function (idx) {
        return function () {
          if (_openIconPicker) _openIconPicker(idx, "timeline");
        };
      })(srcRow));
      row.appendChild(iconBtn);

      // Date only — keeps each cell narrow enough for the
      // two-column grid; ellipsises on overflow inside its cell.
      var labelEl = document.createElement("span");
      labelEl.style.cssText = "font-size:11px;color:var(--text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";
      labelEl.textContent = data[i].date || ("Row " + (i + 1));
      row.appendChild(labelEl);

      // Remove icon button (only if an icon is set)
      if (ref) {
        var removeBtn = document.createElement("button");
        removeBtn.textContent = "\u00d7";
        removeBtn.title = "Remove icon";
        removeBtn.style.cssText = "width:18px;height:18px;border:none;background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:0;flex-shrink:0;";
        removeBtn.addEventListener("click", (function (idx) {
          return function () {
            if (_store.iconSelections) _store.iconSelections[idx] = null;
            buildIconRows();
            if (_generate) _generate();
            if (_schedule) _schedule();
          };
        })(srcRow));
        row.appendChild(removeBtn);
      }

      iconRowList.appendChild(row);
    }
  }

  function loadIconPreview(ref) {
    if (!ref || !_assetIconsDir) return null;
    try {
      var fs = Connector.fs;
      var parts = ref.split("/");
      var iconFile;
      if (parts.length >= 2) {
        iconFile = fs.join(_assetIconsDir, parts[0], parts[1] + ".svg");
      } else {
        iconFile = fs.join(_assetIconsDir, ref + ".svg");
      }
      if (fs.exists(iconFile)) {
        var raw = fs.readText(iconFile);
        raw = raw.replace(/width="[^"]*"/, 'width="18"').replace(/height="[^"]*"/, 'height="18"');
        var color = _store.rowIconColor || "#009EDB";
        raw = raw.replace(/fill="[^"]*"/g, 'fill="' + color + '"');
        return raw;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ── Sync (no-op for now — no extra controls to read/write) ─

  function syncToUI() { buildIconRows(); }
  function syncFromUI() { /* nothing yet */ }

  // ── Public API ─────────────────────────────────────────

  return {
    init: init,
    show: show,
    hide: hide,
    syncToUI: syncToUI,
    syncFromUI: syncFromUI,
    buildIconRows: buildIconRows
  };
})();
