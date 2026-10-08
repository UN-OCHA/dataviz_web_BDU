/* ══════════════════════════════════════════════
   Auto presentation: resolved values + centered thumb
   ──────────────────────────────────────────────
   Two presentation-only improvements to the "Auto" sliders (Height, Bar
   thickness, Bar spacing). No data, no chart logic — nothing here changes how
   a chart is drawn.

   1) Show the resolved value behind "Auto"
      When a slider is on Auto the user only sees the word "Auto" and can't tell
      what the tool picked. The chart engine records what it resolved during
      each render into ChartRegistry.resolved ({ height, barThickness,
      barSpacing }) — svgOpen() records the height for every chart type; the bar
      renderers report their thickness/spacing (see chart-registry.js). After
      every render the panel fires "ocha-chart-rendered"; we read those values
      and show e.g. "Auto · 240px".
      The Height slider is special: its manual value is a *relative* nudge
      (verticalPadding, e.g. "+20"), not a pixel height. To match the other
      sliders we override its display with the real resolved height in pixels
      in BOTH states — "Auto · 240px" on Auto, "240px" when adjusted.

   2) Center the thumb while on Auto
      design-controls-ui parks each Auto slider at a fixed spot (often an
      extreme — e.g. bar spacing sits at the far left). That leaves no room to
      drag in one direction. While a slider is on Auto we move the thumb to the
      middle of its track, purely visually, so the first drag has room both
      ways. The displayed number stays truthful ("Auto · 12px") even though the
      thumb sits centered — the thumb is just a starting point for editing.

   The truthful "is this on Auto" signal is the slider's .auto-active class
   (set by design-controls-ui), not the display text — so we derive from the
   class and never double-append.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  // display id  →  slider id, resolved-value key, and whether to override the
  // MANUAL (non-Auto) display too. Height overrides manual because its raw
  // value is a relative nudge, not pixels.
  var SPECS = [
    { display: "height-display",        slider: "height-slider",        key: "height",       overrideManual: true },
    { display: "bar-thickness-display", slider: "bar-thickness-slider", key: "barThickness", overrideManual: false },
    { display: "bar-spacing-display",   slider: "bar-spacing-slider",   key: "barSpacing",   overrideManual: false }
    // Bubble separation is a relative factor, not a px the user reasons about,
    // so it keeps a plain "Auto" with no resolved-value suffix. Its thumb is
    // centered too (handled below by id).
  ];

  // Sliders whose thumb should sit centered while on Auto (covers the SPECS
  // sliders plus bubble separation, which has no resolved value to display).
  var CENTER_SLIDERS = [
    "height-slider", "bar-thickness-slider", "bar-spacing-slider", "bubble-separation-slider"
  ];

  function resolved() {
    return (window.ChartRegistry && window.ChartRegistry.resolved) || null;
  }

  // Move an Auto slider's thumb to the middle of its track (visual only — does
  // not fire 'input', so it never re-renders or turns Auto off on its own).
  function centerIfAuto(slider) {
    if (!slider || !slider.classList.contains("auto-active")) return;
    var min = parseFloat(slider.min);
    var max = parseFloat(slider.max);
    if (!isFinite(min) || !isFinite(max)) return;
    var mid = (min + max) / 2;
    var step = parseFloat(slider.step) || 1;
    mid = Math.round(mid / step) * step;   // snap to the slider's step
    if (String(slider.value) !== String(mid)) slider.value = mid;
  }

  function setDisplay(display, want) {
    if (display.textContent === want) return;   // no-op guards the observer loop
    var obs = display._autoResolvedObs;
    if (obs) obs.disconnect();
    display.textContent = want;
    if (obs) obs.observe(display, { childList: true, characterData: true, subtree: true });
  }

  function applyOne(spec) {
    var display = document.getElementById(spec.display);
    var slider = document.getElementById(spec.slider);
    if (!display || !slider) return;

    var r = resolved();
    var val = r ? r[spec.key] : null;
    var hasVal = (val != null && isFinite(val));
    var isAuto = slider.classList.contains("auto-active");

    if (isAuto) {
      centerIfAuto(slider);
      setDisplay(display, hasVal ? ("Auto · " + Math.round(val) + "px") : "Auto");
    } else if (spec.overrideManual && hasVal) {
      // Height: show the real pixel height instead of the relative "+20".
      setDisplay(display, Math.round(val) + "px");
    }
    // Non-Auto bar sliders: design-controls-ui owns the display ("28px"). Leave.
  }

  function applyAll() {
    for (var i = 0; i < SPECS.length; i++) applyOne(SPECS[i]);
    // Center any Auto slider that isn't covered by a SPEC (bubble separation).
    for (var j = 0; j < CENTER_SLIDERS.length; j++) {
      centerIfAuto(document.getElementById(CENTER_SLIDERS[j]));
    }
  }

  function init() {
    // Re-derive whenever design-controls-ui rewrites a display (e.g. resets it
    // to a bare "Auto" / "+20" on slider drag or chart-type switch).
    for (var i = 0; i < SPECS.length; i++) {
      (function (spec) {
        var display = document.getElementById(spec.display);
        if (!display) return;
        var obs = new MutationObserver(function () { applyOne(spec); });
        display._autoResolvedObs = obs;
        obs.observe(display, { childList: true, characterData: true, subtree: true });
      })(SPECS[i]);
    }
    // Fresh resolved values land after each render — re-augment + re-center then.
    document.addEventListener("ocha-chart-rendered", applyAll);
    applyAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
