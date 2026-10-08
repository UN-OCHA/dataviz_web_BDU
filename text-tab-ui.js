/* ══════════════════════════════════════════════
   Text-tab enhancements
   ──────────────────────────────────────────────
   Two additive improvements, same spirit as design-groups.js (relocate &
   decorate; never alter the controls or their wiring):

   1. A live PREVIEW of the text block at the top of the tab — title,
      subtitle, comments and footer rendered at the weight they carry in
      the chart, updating as you type. It mirrors the output so the form
      reads as a hierarchy, not four identical boxes.
   2. The existing sections are MOVED into two collapsible groups reusing
      the Design tab's .dgroup styling — "Title & labels" and
      "Text styling" — for one consistent panel language.

   The preview only reads the textareas' values; it never writes to them
   or to the chart. The grouping only relocates the existing <section>s.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  var ICON = {
    heading: "M96 120C96 106.7 106.7 96 120 96L232 96C245.3 96 256 106.7 256 120C256 133.3 245.3 144 232 144L200 144L200 288L440 288L440 144L408 144C394.7 144 384 133.3 384 120C384 106.7 394.7 96 408 96L520 96C533.3 96 544 106.7 544 120C544 133.3 533.3 144 520 144L488 144L488 496L520 496C533.3 496 544 506.7 544 520C544 533.3 533.3 544 520 544L408 544C394.7 544 384 533.3 384 520C384 506.7 394.7 496 408 496L440 496L440 336L200 336L200 496L232 496C245.3 496 256 506.7 256 520C256 533.3 245.3 544 232 544L120 544C106.7 544 96 533.3 96 520C96 506.7 106.7 496 120 496L152 496L152 144L120 144C106.7 144 96 133.3 96 120z",
    sliders: "M88 136C74.7 136 64 146.7 64 160C64 173.3 74.7 184 88 184L179.7 184C189.9 216.5 220.2 240 256 240C291.8 240 322.1 216.5 332.3 184L552 184C565.3 184 576 173.3 576 160C576 146.7 565.3 136 552 136L332.3 136C322.1 103.5 291.8 80 256 80C220.2 80 189.9 103.5 179.7 136L88 136zM88 296C74.7 296 64 306.7 64 320C64 333.3 74.7 344 88 344L339.7 344C349.9 376.5 380.2 400 416 400C451.8 400 482.1 376.5 492.3 344L552 344C565.3 344 576 333.3 576 320C576 306.7 565.3 296 552 296L492.3 296C482.1 263.5 451.8 240 416 240C380.2 240 349.9 263.5 339.7 296L88 296zM88 456C74.7 456 64 466.7 64 480C64 493.3 74.7 504 88 504L147.7 504C157.9 536.5 188.2 560 224 560C259.8 560 290.1 536.5 300.3 504L552 504C565.3 504 576 493.3 576 480C576 466.7 565.3 456 552 456L300.3 456C290.1 423.5 259.8 400 224 400C188.2 400 157.9 423.5 147.7 456L88 456zM224 512C206.3 512 192 497.7 192 480C192 462.3 206.3 448 224 448C241.7 448 256 462.3 256 480C256 497.7 241.7 512 224 512zM416 352C398.3 352 384 337.7 384 320C384 302.3 398.3 288 416 288C433.7 288 448 302.3 448 320C448 337.7 433.7 352 416 352zM224 160C224 142.3 238.3 128 256 128C273.7 128 288 142.3 288 160C288 177.7 273.7 192 256 192C238.3 192 224 177.7 224 160z",
    chevron: "M303.5 473C312.9 482.4 328.1 482.4 337.4 473L537.4 273C546.8 263.6 546.8 248.4 537.4 239.1C528 229.8 512.8 229.7 503.5 239.1L320.5 422.1L137.5 239.1C128.1 229.7 112.9 229.7 103.6 239.1C94.3 248.5 94.2 263.7 103.6 273L303.6 473z"
  };

  function svg(path, size) {
    return '<svg viewBox="0 0 640 640" width="' + size + '" height="' + size +
           '" fill="currentColor" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  function buildGroup(container, title, iconPath, ids) {
    var wrapper = document.createElement("div");
    wrapper.className = "dgroup";
    var head = document.createElement("button");
    head.type = "button";
    head.className = "dgroup-head";
    head.innerHTML =
      '<span class="dgroup-icon">' + svg(iconPath, 15) + '</span>' +
      '<span class="dgroup-title">' + title + '</span>' +
      '<span class="dgroup-chev">' + svg(ICON.chevron, 12) + '</span>';
    var body = document.createElement("div");
    body.className = "dgroup-body";
    head.addEventListener("click", function () { wrapper.classList.toggle("collapsed"); });
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) body.appendChild(el);
    }
    wrapper.appendChild(head);
    wrapper.appendChild(body);
    container.appendChild(wrapper);
  }

  function init() {
    var panel = document.querySelector('.tab-panel[data-tab="text"]');
    if (!panel || panel.getAttribute("data-enhanced") === "1") return;

    // ── Live preview ──────────────────────────────
    var preview = document.createElement("div");
    preview.className = "text-preview";
    preview.innerHTML =
      '<div class="tp-title"></div>' +
      '<div class="tp-subtitle"></div>' +
      '<div class="tp-comments"></div>' +
      '<div class="tp-footer"></div>' +
      '<div class="tp-empty">Your title, subtitle and footer preview here as you type.</div>';

    var els = {
      title:    document.getElementById("chart-title"),
      subtitle: document.getElementById("chart-subtitle"),
      comments: document.getElementById("chart-comments"),
      footer:   document.getElementById("chart-footer")
    };
    var out = {
      title:    preview.querySelector(".tp-title"),
      subtitle: preview.querySelector(".tp-subtitle"),
      comments: preview.querySelector(".tp-comments"),
      footer:   preview.querySelector(".tp-footer"),
      empty:    preview.querySelector(".tp-empty")
    };

    function update() {
      var any = false;
      ["title", "subtitle", "comments", "footer"].forEach(function (k) {
        var v = els[k] ? els[k].value.trim() : "";
        out[k].textContent = v;
        out[k].style.display = v ? "" : "none";
        if (v) any = true;
      });
      out.empty.style.display = any ? "none" : "";
    }

    for (var k in els) {
      if (els[k]) els[k].addEventListener("input", update);
    }

    // Insert preview at the very top of the tab.
    panel.insertBefore(preview, panel.firstChild);

    // ── Groups ────────────────────────────────────
    var container = document.createElement("div");
    container.id = "text-groups";
    panel.appendChild(container);
    buildGroup(container, "Title & labels", ICON.heading, ["text-labels-section"]);
    buildGroup(container, "Text styling", ICON.sliders, ["text-scale-section", "text-width-section"]);

    panel.setAttribute("data-enhanced", "1");
    update();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
