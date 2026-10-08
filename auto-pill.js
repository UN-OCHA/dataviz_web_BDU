/* ══════════════════════════════════════════════
   Auto pill
   ──────────────────────────────────────────────
   Replaces the "Auto" checkbox on slider controls (Height, Bar thickness,
   Bar spacing, Bubble spacing) with a single pill button that sits inline
   at the left of the slider row:  [Auto] [——slider——] [value]

   The checkbox stays in the DOM as the source of truth — design-controls-ui
   reads .checked, greys the slider (.auto-active) and shows "Auto" in the
   value field. The pill just flips that checkbox and fires a 'change'
   event, so every existing handler runs exactly as if the box was clicked.
   It also mirrors the checkbox back into the pill, so programmatic updates
   (loading a saved chart, switching chart type) keep the pill in sync.

   Presentation only: no data, no chart logic. To add another auto-slider,
   add its { checkbox, row } here.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  // checkbox id  →  the .slider-row it belongs to (the pill goes inside it).
  var SPECS = [
    { cb: "height-auto",            row: "#height-section .slider-row" },
    { cb: "bar-thickness-auto",     row: "#bar-thickness-section .slider-row" },
    { cb: "bar-spacing-auto",       row: "#bar-spacing-section .slider-row" },
    { cb: "bubble-separation-auto", row: "#bubble-separation-section .slider-row" }
  ];

  function enhance(spec) {
    var cb  = document.getElementById(spec.cb);
    var row = document.querySelector(spec.row);
    if (!cb || !row || cb.getAttribute("data-pill") === "1") return;

    // Hide the original control (checkbox + its label/wrapper) but keep it
    // in the DOM and functional. Standard controls wrap it in .auto-check;
    // bubble spacing wraps it in an inline .toggle-label inside the row.
    var original = cb.closest(".auto-check") || cb.closest(".toggle-label") || cb.parentNode;
    if (original && original !== row) {
      original.style.display = "none";
    } else {
      cb.style.display = "none";
    }

    var slider = row.querySelector('input[type="range"]');

    var pill = document.createElement("button");
    pill.type = "button";
    pill.className = "auto-pill";
    pill.textContent = "Auto";
    pill.title = "Let the tool choose this automatically";

    function setOn(isAuto) {
      pill.classList.toggle("on", isAuto);
      pill.setAttribute("aria-pressed", isAuto ? "true" : "false");
    }

    pill.addEventListener("click", function () {
      cb.checked = !cb.checked;
      // Replicate a user toggle so design-controls-ui regenerates + greys
      // the slider + updates the value display.
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      setOn(cb.checked);
    });

    // Programmatic updates (loading a chart, switching chart type) set
    // checkbox.checked WITHOUT firing 'change', but design-controls-ui always
    // mirrors the auto state onto the slider's .auto-active class — so watch
    // that to keep the pill correct in every case.
    if (slider) {
      new MutationObserver(function () {
        setOn(slider.classList.contains("auto-active"));
      }).observe(slider, { attributes: true, attributeFilter: ["class"] });
    }
    // Belt-and-braces for any path that does dispatch 'change'.
    cb.addEventListener("change", function () { setOn(cb.checked); });

    row.insertBefore(pill, row.firstChild);
    cb.setAttribute("data-pill", "1");
    setOn(cb.checked);
  }

  // ── Reset-style sliders ───────────────────────────────
  // Some sliders have no auto-checkbox — just a "reset to default" ↺ button
  // (header/footer text width, default 100% = full width). "Reset to default"
  // IS "Auto", so we drop the ↺ and give them the same Auto pill. There's no
  // boolean in the store: the auto state is simply "value === default".
  var RESET_SPECS = [
    { slider: "header-text-width-slider", display: "header-text-width-display", reset: "header-text-width-reset", def: 100 },
    { slider: "footer-text-width-slider", display: "footer-text-width-display", reset: "footer-text-width-reset", def: 100 }
  ];

  function enhanceReset(spec) {
    var slider  = document.getElementById(spec.slider);
    var display = document.getElementById(spec.display);
    var resetBtn = document.getElementById(spec.reset);
    var row = slider && slider.parentNode;
    if (!slider || !row || slider.getAttribute("data-pill") === "1") return;

    if (resetBtn) resetBtn.style.display = "none";  // the pill replaces it

    var pill = document.createElement("button");
    pill.type = "button";
    pill.className = "auto-pill";
    pill.textContent = "Auto";
    pill.title = "Use the full default width";

    function atDefault() {
      return (parseInt(slider.value, 10) || spec.def) === spec.def;
    }

    var obs = null;
    function writeDisplay(text) {
      if (!display) return;
      if (obs) obs.disconnect();              // don't observe our own write
      display.textContent = text;
      if (obs) obs.observe(display, { childList: true, characterData: true, subtree: true });
    }
    function setOn(auto) {
      pill.classList.toggle("on", auto);
      pill.setAttribute("aria-pressed", auto ? "true" : "false");
      slider.classList.toggle("auto-active", auto);
      writeDisplay(auto ? "Auto" : ((parseInt(slider.value, 10) || spec.def) + "%"));
    }

    pill.addEventListener("click", function () {
      if (pill.classList.contains("on")) {
        setOn(false);                          // switch to custom (value kept)
      } else {
        // back to default — reuse the existing reset handler so the store
        // updates and the chart re-renders, then show it as Auto.
        if (resetBtn) resetBtn.click();
        else { slider.value = spec.def; slider.dispatchEvent(new Event("input", { bubbles: true })); }
        setOn(true);
      }
    });

    // The display text is the truthful signal: design-controls-ui rewrites it
    // on drag and on chart load. Re-derive the pill from the value whenever it
    // changes from outside (guarded so our own writes don't loop).
    if (display) {
      obs = new MutationObserver(function () { setOn(atDefault()); });
      obs.observe(display, { childList: true, characterData: true, subtree: true });
    }

    row.insertBefore(pill, row.firstChild);
    slider.setAttribute("data-pill", "1");
    setOn(atDefault());
  }

  // ── Text-field auto (Scale / Maximum value) ───────────
  // A text input whose empty state IS "Auto" (axis auto-scales). Same Auto
  // pill: on = auto (input cleared, read-only, dimmed); off = type a value.
  // No store boolean — auto state is "the field is empty".
  var TEXT_AUTO_SPECS = [
    { input: "axis-max-input", reset: "axis-max-reset" }
  ];

  function enhanceTextAuto(spec) {
    var input = document.getElementById(spec.input);
    if (!input || input.getAttribute("data-pill") === "1") return;
    var resetBtn = document.getElementById(spec.reset);
    var row = input.parentNode;
    var section = input.closest(".section");
    if (resetBtn) resetBtn.style.display = "none";

    var pill = document.createElement("button");
    pill.type = "button";
    pill.className = "auto-pill";
    pill.textContent = "Auto";
    pill.title = "Auto-scale (no fixed maximum)";

    function setOn(auto) {
      pill.classList.toggle("on", auto);
      pill.setAttribute("aria-pressed", auto ? "true" : "false");
      input.readOnly = auto;
      input.classList.toggle("is-auto", auto);
    }
    function refresh() { setOn(!String(input.value || "").trim()); }

    pill.addEventListener("click", function () {
      if (pill.classList.contains("on")) {
        setOn(false);          // switch to manual
        input.focus();
      } else {
        input.value = "";      // back to auto: clear via the existing reset
        if (resetBtn) resetBtn.click();   // sets store + re-renders
        setOn(true);
      }
    });
    // Clicking/focusing the field turns Auto off so the user can type
    // straight away (read-only inputs still receive focus).
    input.addEventListener("focus", function () {
      if (pill.classList.contains("on")) setOn(false);
    });
    input.addEventListener("input", refresh);
    input.addEventListener("blur", refresh);
    // design-controls-ui rewrites input.value on chart switch/load without
    // firing events; re-derive when the section's visibility/class changes.
    if (section) {
      new MutationObserver(refresh).observe(section, { attributes: true, attributeFilter: ["style", "class"] });
    }

    row.insertBefore(pill, input);
    input.setAttribute("data-pill", "1");
    refresh();
  }

  function init() {
    for (var i = 0; i < SPECS.length; i++) enhance(SPECS[i]);
    for (var r = 0; r < RESET_SPECS.length; r++) enhanceReset(RESET_SPECS[r]);
    for (var t = 0; t < TEXT_AUTO_SPECS.length; t++) enhanceTextAuto(TEXT_AUTO_SPECS[t]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
