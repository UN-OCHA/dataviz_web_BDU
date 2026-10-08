/* ══════════════════════════════════════════════
   Design-tab grouping
   ──────────────────────────────────────────────
   The Design tab is a long flat list of setting sections, most of which
   are shown/hidden per chart type by panel.js (it toggles each section's
   inline style.display by id). This module is PURELY a reorganiser:

   • On load it MOVES the existing section elements into five labelled,
     collapsible groups (Size & layout · Colour · Labels & values ·
     Legend · Chart-type options). It never changes a section's id,
     markup, or controls — so every getElementById(...) and every data
     round-trip in panel.js keeps working untouched.
   • A group whose sections are all hidden hides its own header too, so
     you never see an empty "Legend" heading. A MutationObserver watches
     the sections' style/class so this stays correct as the user switches
     chart types.

   Because it only relocates nodes and toggles wrapper visibility, it is
   safe to add/remove without affecting chart output. If a section id is
   ever renamed, update the GROUPS map below (unknown ids are skipped).
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  // FA Regular (svgs-full, 0 0 640 640) — one glyph per group.
  var ICON = {
    layout:  "M320 119.8L353.5 160L286.5 160L320 119.8zM293.8 76.3L232.2 150.2C226.9 156.5 224 164.5 224 172.8C224 192.3 239.8 208 259.2 208L296 208L296 296L208 296L208 259.2C208 239.7 192.2 224 172.8 224C164.6 224 156.6 226.9 150.2 232.2L76.3 293.8C68.5 300.2 64 309.9 64 320C64 330.1 68.5 339.8 76.3 346.2L150.2 407.8C156.5 413.1 164.5 416 172.8 416C192.3 416 208 400.2 208 380.8L208 344L296 344L296 432L259.2 432C239.7 432 224 447.8 224 467.2C224 475.4 226.9 483.4 232.2 489.8L293.8 563.7C300.3 571.5 309.9 576 320 576C330.1 576 339.8 571.5 346.2 563.7L407.8 489.8C413.1 483.5 416 475.5 416 467.2C416 447.7 400.2 432 380.8 432L344 432L344 344L432 344L432 380.8C432 400.3 447.8 416 467.2 416C475.4 416 483.4 413.1 489.8 407.8L563.7 346.2C571.5 339.7 576 330.1 576 320C576 309.9 571.5 300.2 563.7 293.8L489.8 232.2C483.5 226.9 475.5 224 467.2 224C447.7 224 432 239.8 432 259.2L432 296L344 296L344 208L380.8 208C400.3 208 416 192.2 416 172.8C416 164.6 413.1 156.6 407.8 150.2L346.2 76.3C339.8 68.5 330.1 64 320 64C309.9 64 300.2 68.5 293.8 76.3zM320 520.2L286.5 480L353.5 480L320 520.2zM520.2 320L480 353.5L480 286.5L520.2 320zM160 353.5L119.8 320L160 286.5L160 353.5z",
    colour:  "M528 322.2C528 324.9 527 327.4 523.8 330.2C520 333.3 513.7 336 506 336L408 336C355 336 312 379 312 432C312 438.8 312.7 445.4 314.1 451.8C317.4 467.5 324.3 482.9 328.5 492.4L328.5 492.4C329.2 494 329.9 495.4 330.4 496.7C335.4 508.2 336 512.1 336 513.8C336 519.1 334.1 523.3 332.2 525.6C331.3 526.7 330.6 527.2 330.2 527.4C329.9 527.6 329.4 527.7 328.6 527.8C325.7 527.9 322.9 528 320 528C205.1 528 112 434.9 112 320C112 205.1 205.1 112 320 112C434.9 112 528 205.1 528 320C528 320.7 528 321.4 528 322.2zM576 322.7C576 321.8 576 320.9 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320C64 461.4 178.6 576 320 576C323.5 576 327.1 575.9 330.6 575.8C362.4 574.5 384 545.7 384 513.8C384 499.3 377.9 485.5 371.9 471.8C367.6 462 363.2 452.1 361.1 441.9C360.4 438.7 360.1 435.4 360.1 432C360.1 405.5 381.6 384 408.1 384L506 384C542.5 384 575.7 359.2 576.1 322.7zM224 320C224 302.3 209.7 288 192 288C174.3 288 160 302.3 160 320C160 337.7 174.3 352 192 352C209.7 352 224 337.7 224 320zM224 256C241.7 256 256 241.7 256 224C256 206.3 241.7 192 224 192C206.3 192 192 206.3 192 224C192 241.7 206.3 256 224 256zM352 192C352 174.3 337.7 160 320 160C302.3 160 288 174.3 288 192C288 209.7 302.3 224 320 224C337.7 224 352 209.7 352 192zM416 256C433.7 256 448 241.7 448 224C448 206.3 433.7 192 416 192C398.3 192 384 206.3 384 224C384 241.7 398.3 256 416 256z",
    labels:  "M128.1 152C128.1 138.7 138.8 128 152.1 128L308.2 128C314.6 128 320.7 130.5 325.2 135L533.2 343C542.6 352.4 542.6 367.6 533.2 376.9L377.1 533.1C367.7 542.5 352.5 542.5 343.2 533.1L135.2 325.1C130.7 320.6 128.2 314.5 128.2 308.1L128.1 152zM152.1 80C112.3 80 80.1 112.2 80.1 152L80.1 308.1C80.1 327.2 87.7 345.5 101.2 359L309.2 567C337.3 595.1 382.9 595.1 411 567L567.1 410.9C595.2 382.8 595.2 337.2 567.1 309.1L359.1 101.1C345.6 87.6 327.3 80 308.2 80L152.1 80zM208.1 240C225.8 240 240.1 225.7 240.1 208C240.1 190.3 225.8 176 208.1 176C190.4 176 176.1 190.3 176.1 208C176.1 225.7 190.4 240 208.1 240z",
    legend:  "M128 176C119.2 176 112 183.2 112 192L112 448C112 456.8 119.2 464 128 464L512 464C520.8 464 528 456.8 528 448L528 192C528 183.2 520.8 176 512 176L128 176zM64 192C64 156.7 92.7 128 128 128L512 128C547.3 128 576 156.7 576 192L576 448C576 483.3 547.3 512 512 512L128 512C92.7 512 64 483.3 64 448L64 192zM224 384C224 401.7 209.7 416 192 416C174.3 416 160 401.7 160 384C160 366.3 174.3 352 192 352C209.7 352 224 366.3 224 384zM192 288C174.3 288 160 273.7 160 256C160 238.3 174.3 224 192 224C209.7 224 224 238.3 224 256C224 273.7 209.7 288 192 288zM296 232L456 232C469.3 232 480 242.7 480 256C480 269.3 469.3 280 456 280L296 280C282.7 280 272 269.3 272 256C272 242.7 282.7 232 296 232zM296 360L456 360C469.3 360 480 370.7 480 384C480 397.3 469.3 408 456 408L296 408C282.7 408 272 397.3 272 384C272 370.7 282.7 360 296 360z",
    options: "M88 136C74.7 136 64 146.7 64 160C64 173.3 74.7 184 88 184L179.7 184C189.9 216.5 220.2 240 256 240C291.8 240 322.1 216.5 332.3 184L552 184C565.3 184 576 173.3 576 160C576 146.7 565.3 136 552 136L332.3 136C322.1 103.5 291.8 80 256 80C220.2 80 189.9 103.5 179.7 136L88 136zM88 296C74.7 296 64 306.7 64 320C64 333.3 74.7 344 88 344L339.7 344C349.9 376.5 380.2 400 416 400C451.8 400 482.1 376.5 492.3 344L552 344C565.3 344 576 333.3 576 320C576 306.7 565.3 296 552 296L492.3 296C482.1 263.5 451.8 240 416 240C380.2 240 349.9 263.5 339.7 296L88 296zM88 456C74.7 456 64 466.7 64 480C64 493.3 74.7 504 88 504L147.7 504C157.9 536.5 188.2 560 224 560C259.8 560 290.1 536.5 300.3 504L552 504C565.3 504 576 493.3 576 480C576 466.7 565.3 456 552 456L300.3 456C290.1 423.5 259.8 400 224 400C188.2 400 157.9 423.5 147.7 456L88 456zM224 512C206.3 512 192 497.7 192 480C192 462.3 206.3 448 224 448C241.7 448 256 462.3 256 480C256 497.7 241.7 512 224 512zM416 352C398.3 352 384 337.7 384 320C384 302.3 398.3 288 416 288C433.7 288 448 302.3 448 320C448 337.7 433.7 352 416 352zM224 160C224 142.3 238.3 128 256 128C273.7 128 288 142.3 288 160C288 177.7 273.7 192 256 192C238.3 192 224 177.7 224 160z",
    chevron: "M303.5 473C312.9 482.4 328.1 482.4 337.4 473L537.4 273C546.8 263.6 546.8 248.4 537.4 239.1C528 229.8 512.8 229.7 503.5 239.1L320.5 422.1L137.5 239.1C128.1 229.7 112.9 229.7 103.6 239.1C94.3 248.5 94.2 263.7 103.6 273L303.6 473z"
  };

  // Each group: title, icon key, and the section ids it owns (in order).
  // Order here = order the controls appear inside the group.
  var GROUPS = [
    { key: "layout", title: "Size & layout", ids: [
      "width-section", "height-section",
      "bubble-orientation", "timeline-orientation", "cluster-orientation",
      "bar-thickness-section", "bar-spacing-section", "scale-section",
      "bubble-separation-section", "timeline-spacing-section", "donut-hole-section"
    ]},
    { key: "colour", title: "Colour", ids: [
      "chart-color-section", "stacked-colors-section", "slice-colors-section",
      "cluster-donut-categories-section", "label-color-section"
    ]},
    { key: "labels", title: "Labels & values", ids: [
      "value-format-section", "bar-label-section", "hide-zero-section",
      "pie-label-section", "donut-center-section", "icon-col-section",
      "timeline-categories-section", "label-scale-section"
    ]},
    { key: "legend", title: "Legend", ids: [
      "stacked-legend-section", "cluster-donut-legend-section",
      "icon-legend-section"
    ]},
    { key: "options", title: "Chart-type options", ids: [
      "line-options-section", "sankey-options-section",
      "keyfigures-options-section", "timeline-options-section",
      "stacked-stroke-section", "icon-series-section"
    ]}
  ];

  function svg(path, size) {
    return '<svg viewBox="0 0 640 640" width="' + size + '" height="' + size +
           '" fill="currentColor" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  var groupEls = [];        // { wrapper, sections:[el,...] }
  var refreshQueued = false;

  function isShown(el) {
    // panel.js hides sections via inline style.display:none.
    return el && el.style.display !== "none";
  }

  function refresh() {
    refreshQueued = false;
    for (var i = 0; i < groupEls.length; i++) {
      var g = groupEls[i];
      var anyShown = false;
      for (var s = 0; s < g.sections.length; s++) {
        if (isShown(g.sections[s])) { anyShown = true; break; }
      }
      g.wrapper.style.display = anyShown ? "" : "none";
    }
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    // Coalesce bursts of style changes from a chart-type switch.
    (window.requestAnimationFrame || window.setTimeout)(refresh, 0);
  }

  function init() {
    var panel = document.querySelector('.tab-panel[data-tab="design"]');
    if (!panel || panel.getAttribute("data-grouped") === "1") return;

    var container = document.createElement("div");
    container.id = "design-groups";

    // Insert the container where the design content currently begins, so it
    // keeps its place relative to anything outside the grouped sections.
    var firstSection = panel.querySelector('.section, .toggle-group');
    if (firstSection) {
      panel.insertBefore(container, firstSection);
    } else {
      panel.appendChild(container);
    }

    var observer = new MutationObserver(queueRefresh);

    for (var i = 0; i < GROUPS.length; i++) {
      var def = GROUPS[i];
      var wrapper = document.createElement("div");
      wrapper.className = "dgroup";
      wrapper.setAttribute("data-group", def.key);

      var head = document.createElement("button");
      head.type = "button";
      head.className = "dgroup-head";
      head.innerHTML =
        '<span class="dgroup-icon">' + svg(ICON[def.key], 15) + '</span>' +
        '<span class="dgroup-title">' + def.title + '</span>' +
        '<span class="dgroup-chev">' + svg(ICON.chevron, 12) + '</span>';

      var body = document.createElement("div");
      body.className = "dgroup-body";

      (function (w) {
        head.addEventListener("click", function () {
          w.classList.toggle("collapsed");
        });
      })(wrapper);

      var sections = [];
      for (var j = 0; j < def.ids.length; j++) {
        var el = document.getElementById(def.ids[j]);
        if (!el) continue;            // unknown / removed id — skip safely
        body.appendChild(el);         // MOVE into this group's body
        sections.push(el);
        observer.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
      }

      wrapper.appendChild(head);
      wrapper.appendChild(body);
      container.appendChild(wrapper);
      groupEls.push({ wrapper: wrapper, sections: sections });
    }

    panel.setAttribute("data-grouped", "1");
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
