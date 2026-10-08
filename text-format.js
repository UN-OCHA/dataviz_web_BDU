/* ══════════════════════════════════════════════
   Text formatting — bold / italic for header & footer fields
   ──────────────────────────────────────────────
   Subtitle, Comments and Footer accept a tiny markdown subset: **bold** and
   *italic* (rendered as real bold/italic text runs in the chart — see
   chart-registry.js parseInline/wrapStyled). This module adds the editing
   affordances:

   - a small [B] [I] toolbar in each field's top-right corner
   - Cmd/Ctrl+B and Cmd/Ctrl+I keyboard shortcuts inside those fields

   Both do the same thing: wrap the selection in ** / * (or unwrap it if it's
   already wrapped — a toggle), then fire 'input' so the chart re-renders and
   DataStore picks up the change. The markers live in the field's plain text;
   no new state, no DataStore changes. Title is excluded on purpose (already
   bold).
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  var FIELDS = ["chart-subtitle", "chart-comments", "chart-footer"];

  function setSelection(ta, start, end) {
    try { ta.setSelectionRange(start, end); } catch (e) {}
  }

  // Wrap / unwrap the current selection with `marker` (** or *).
  function toggle(ta, marker) {
    var v = ta.value;
    var s = ta.selectionStart, e = ta.selectionEnd;
    var m = marker.length;
    var sel = v.slice(s, e);

    // Already wrapped inside the selection: **text** → text
    if (sel.length >= 2 * m && sel.slice(0, m) === marker && sel.slice(-m) === marker) {
      var inner = sel.slice(m, -m);
      ta.value = v.slice(0, s) + inner + v.slice(e);
      setSelection(ta, s, s + inner.length);
    }
    // Markers sit just OUTSIDE the selection: **<sel>** → <sel>
    else if (v.slice(s - m, s) === marker && v.slice(e, e + m) === marker) {
      ta.value = v.slice(0, s - m) + sel + v.slice(e + m);
      setSelection(ta, s - m, e - m);
    }
    // Otherwise wrap it.
    else {
      ta.value = v.slice(0, s) + marker + sel + marker + v.slice(e);
      if (s === e) setSelection(ta, s + m, s + m);       // empty → cursor between markers
      else setSelection(ta, s + m, e + m);                // keep the words selected
    }

    // Re-render + DataStore sync run off the field's existing 'input' wiring.
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function makeButton(label, italicStyle, title, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "text-fmt-btn";
    b.textContent = label;
    b.title = title;
    if (italicStyle) {
      // Serif italic "I" — the classic editor convention (a sans italic I is
      // just a slanted bar and reads poorly at 11px).
      b.style.fontStyle = "italic";
      b.style.fontFamily = 'Georgia, "Times New Roman", serif';
    } else {
      b.style.fontWeight = "700";
    }
    // Keep focus (and the selection) in the textarea when the button is
    // pressed — preventDefault on mousedown stops the button stealing focus.
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
    return b;
  }

  function enhance(id) {
    var ta = document.getElementById(id);
    if (!ta || ta.getAttribute("data-fmt") === "1") return;
    var field = ta.parentNode;          // the .m3-field wrapper
    if (!field) return;

    var bar = document.createElement("div");
    bar.className = "text-fmt-bar";
    bar.appendChild(makeButton("B", false, "Bold (Cmd/Ctrl+B)", function () { toggle(ta, "**"); }));
    bar.appendChild(makeButton("I", true, "Italic (Cmd/Ctrl+I)", function () { toggle(ta, "*"); }));
    field.appendChild(bar);

    ta.addEventListener("keydown", function (e) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      var k = (e.key || "").toLowerCase();
      if (k === "b") { e.preventDefault(); toggle(ta, "**"); }
      else if (k === "i") { e.preventDefault(); toggle(ta, "*"); }
    });

    ta.setAttribute("data-fmt", "1");
  }

  function init() {
    for (var i = 0; i < FIELDS.length; i++) enhance(FIELDS[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
