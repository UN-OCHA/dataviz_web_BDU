/* ══════════════════════════════════════════════
   Compact rows
   ──────────────────────────────────────────────
   Turns single-control Design-tab sections from a stacked
   "label-on-its-own-line, control below" layout into a compact inline row:
   [ label ][ ——— control ——— ]. Uses the panel width as columns so the tab
   is shorter and easier to scan, while staying responsive.

   IMPORTANT: the flex row is an INNER wrapper, not the section itself.
   panel.js shows/hides these sections with `element.style.display =
   "block"|"none"`, which would override a flex on the section and break the
   layout (or, worse, fight the hide). By wrapping the label + control in an
   inner .section-row, the section keeps its own display free for JS, and
   the row is always flex.

   • SIMPLE  — whole section becomes one row (label + the single control).
   • HEAD    — only the label + one primary control go inline; anything after
               (e.g. the prefix/suffix inputs under Value format) stays full
               width below.

   Structural only: ids are untouched, so all wiring keeps working. Runs
   after design-groups.js / auto-pill.js.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  var SIMPLE = [
    "width-section",
    "height-section",
    "bar-thickness-section",
    "bar-spacing-section",
    "bubble-separation-section",
    "donut-hole-section",
    "label-scale-section",
    "bar-label-section",
    "chart-color-section",
    "label-color-section"
  ];

  // section id → CSS selector of the one control to inline next to the label.
  var HEAD = {
    "value-format-section": "#number-format"
  };

  function firstLabel(sec) {
    for (var i = 0; i < sec.children.length; i++) {
      var c = sec.children[i];
      if (c.classList && c.classList.contains("section-label")) return c;
    }
    return null;
  }

  function rowifySimple(sec) {
    var label = firstLabel(sec);
    if (!label) return;
    var row = document.createElement("div");
    row.className = "section-row";
    var ctl = document.createElement("div");
    ctl.className = "section-ctl";
    // Move everything after the label into the control column.
    var node = label.nextSibling;
    while (node) {
      var next = node.nextSibling;
      ctl.appendChild(node);
      node = next;
    }
    row.appendChild(label);
    row.appendChild(ctl);
    sec.appendChild(row);
  }

  function rowifyHead(sec, ctlSelector) {
    var label = firstLabel(sec);
    var ctlEl = sec.querySelector(ctlSelector);
    if (!label || !ctlEl) return;
    var anchor = label.nextSibling;           // first node that stays below
    var row = document.createElement("div");
    row.className = "section-row";
    var ctl = document.createElement("div");
    ctl.className = "section-ctl";
    ctl.appendChild(ctlEl);                    // only the primary control
    row.appendChild(label);
    row.appendChild(ctl);
    sec.insertBefore(row, anchor);             // row on top, rest stays below
  }

  function init() {
    var i, sec;
    for (i = 0; i < SIMPLE.length; i++) {
      sec = document.getElementById(SIMPLE[i]);
      if (sec && sec.getAttribute("data-row") !== "1") {
        rowifySimple(sec);
        sec.setAttribute("data-row", "1");
      }
    }
    for (var id in HEAD) {
      sec = document.getElementById(id);
      if (sec && sec.getAttribute("data-row") !== "1") {
        rowifyHead(sec, HEAD[id]);
        sec.setAttribute("data-row", "1");
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
