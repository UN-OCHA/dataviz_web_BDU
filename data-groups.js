/* ══════════════════════════════════════════════
   Data-tab grouping
   ──────────────────────────────────────────────
   The data input and the grid stay at the top (always visible — they're
   the hero of the tab). The remaining sections are MOVED into two
   collapsible groups, same .dgroup language as the Design/Text tabs:

   • Columns      — label/value column pickers (single + multi) and the
                    "sort largest first" option.
   • Save & share — Copy / Save / Load (the JSON snapshot actions).

   Same approach as design-groups.js: relocate existing sections, never
   touch their ids or wiring. getElementById in panel.js keeps working.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  var ICON = {
    columns: "M144 480L144 224L296 224L296 496L160 496C151.2 496 144 488.8 144 480zM344 496L344 224L496 224L496 480C496 488.8 488.8 496 480 496L344 496zM160 96C124.7 96 96 124.7 96 160L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 160C544 124.7 515.3 96 480 96L160 96z",
    share:   "M496 160C496 133.5 474.5 112 448 112C421.5 112 400 133.5 400 160C400 186.5 421.5 208 448 208C474.5 208 496 186.5 496 160zM544 160C544 213 501 256 448 256C420.6 256 395.9 244.5 378.4 226.1L252.9 295.8C254.9 303.5 256 311.6 256 320C256 328.4 254.9 336.5 252.9 344.2L378.4 413.9C395.9 395.5 420.6 384 448 384C501 384 544 427 544 480C544 533 501 576 448 576C395 576 352 533 352 480C352 471.7 353.1 463.5 355.1 455.8L229.6 386.1C212.1 404.5 187.4 416 160 416C107 416 64 373 64 320C64 267 107 224 160 224C187.4 224 212.1 235.5 229.6 253.9L355.1 184.2C353.1 176.5 352 168.4 352 160C352 107 395 64 448 64C501 64 544 107 544 160zM208 320C208 293.5 186.5 272 160 272C133.5 272 112 293.5 112 320C112 346.5 133.5 368 160 368C186.5 368 208 346.5 208 320zM448 528C474.5 528 496 506.5 496 480C496 453.5 474.5 432 448 432C421.5 432 400 453.5 400 480C400 506.5 421.5 528 448 528z",
    chevron: "M303.5 473C312.9 482.4 328.1 482.4 337.4 473L537.4 273C546.8 263.6 546.8 248.4 537.4 239.1C528 229.8 512.8 229.7 503.5 239.1L320.5 422.1L137.5 239.1C128.1 229.7 112.9 229.7 103.6 239.1C94.3 248.5 94.2 263.7 103.6 273L303.6 473z"
  };

  function svg(path, size) {
    return '<svg viewBox="0 0 640 640" width="' + size + '" height="' + size +
           '" fill="currentColor" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  function buildGroup(container, title, iconPath, ids) {
    var found = [];
    for (var i = 0; i < ids.length; i++) {
      if (document.getElementById(ids[i])) found.push(ids[i]);
    }
    if (!found.length) return;

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
    for (var j = 0; j < found.length; j++) body.appendChild(document.getElementById(found[j]));
    wrapper.appendChild(head);
    wrapper.appendChild(body);
    container.appendChild(wrapper);
  }

  function init() {
    var panel = document.querySelector('.tab-panel[data-tab="data"]');
    if (!panel || panel.getAttribute("data-grouped") === "1") return;

    var container = document.createElement("div");
    container.id = "data-groups";
    panel.appendChild(container);   // groups sit below the import + grid

    buildGroup(container, "Columns", ICON.columns,
      ["col-selector-section", "multi-col-section", "auto-sort-option"]);
    buildGroup(container, "Save & share", ICON.share,
      ["chart-config-section"]);

    panel.setAttribute("data-grouped", "1");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
