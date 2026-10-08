/* ══════════════════════════════════════════════
   Chart-picker purpose filter
   ──────────────────────────────────────────────
   Multi-tag highlight for the chart-type grid. The tiles are grouped by
   visual family (in index.html); these chips let the user say "show me
   charts for Comparison / Trend / …". A chart can match several purposes
   (a column is comparison AND trend), so this is a HIGHLIGHT, not a hard
   filter — non-matching tiles dim but stay clickable.

   Purpose keys live in each tile's data-purpose (space-separated) and in
   each chip's data-purpose. Tailored to our 16 types — see AUDIT.md §10c.
   Purely visual: it never touches selection state or DataStore.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  function init() {
    var filterEl = document.getElementById("chart-purpose-filter");
    var sidebar  = document.getElementById("chart-sidebar");
    if (!filterEl || !sidebar) return;

    var chips     = filterEl.querySelectorAll(".chart-chip");
    var clearBtn  = document.getElementById("chart-filter-clear");
    var tiles     = sidebar.querySelectorAll(".sidebar-btn");

    function apply() {
      var active = [];
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].classList.contains("on")) {
          active.push(chips[i].getAttribute("data-purpose"));
        }
      }
      var filtering = active.length > 0;
      sidebar.classList.toggle("filtering", filtering);
      if (clearBtn) clearBtn.style.display = filtering ? "" : "none";

      for (var t = 0; t < tiles.length; t++) {
        var tilePurposes = (tiles[t].getAttribute("data-purpose") || "").split(/\s+/);
        var match = false;
        if (!filtering) {
          match = true;
        } else {
          for (var a = 0; a < active.length; a++) {
            if (tilePurposes.indexOf(active[a]) !== -1) { match = true; break; }
          }
        }
        tiles[t].classList.toggle("match", match);
      }
    }

    for (var c = 0; c < chips.length; c++) {
      chips[c].addEventListener("click", function () {
        this.classList.toggle("on");
        apply();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        for (var k = 0; k < chips.length; k++) chips[k].classList.remove("on");
        apply();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
