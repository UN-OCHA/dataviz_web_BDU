/**
 * Panel Coordinator — manages tab switching, sidebar chart type selection,
 * header button state, and panel open/close coordination.
 *
 * init(deps) dependencies:
 *   store              – DataStore
 *   generate           – generateSVG function
 *   schedule           – scheduleLiveUpdate function
 *   updateColSelectors – updateColumnSelectors function
 *   updateMultiCol     – updateMultiColVisibility function
 *   updateChartOpts    – updateChartOptions function
 *   closePicker        – IconFlagUI.closePicker function
 *   setLastSVG         – function(svg) to store last SVG for Map Maker
 *   assetFlagsDir      – string path to flags directory
 */

/* global IconsPanel, FlagsPanel, MapsPanel, GridPanelUI, MapMakerPanel */

var PanelCoordinator = (function () {
  "use strict";

  // ── Dependencies (set by init) ─────────────────────────

  var _store;
  var _generate;
  var _schedule;
  var _updateColSelectors;
  var _updateMultiCol;
  var _updateChartOpts;
  var _refreshGrid;
  var _closePicker;

  // ── DOM refs ───────────────────────────────────────────

  var tabBtns, tabPanels;
  var sidebarButtons, headerChartIcon;
  var tabBar, panelBody, bottomBar;
  var headerBtns;
  var mmPanelEl;
  var btnIconsHeader, btnFlagsHeader, btnMapsHeader;

  // ── Tab switching ──────────────────────────────────────

  function setActiveTab(tabName) {
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].classList.toggle("active", tabBtns[i].getAttribute("data-tab") === tabName);
    }
    for (var j = 0; j < tabPanels.length; j++) {
      tabPanels[j].classList.toggle("active", tabPanels[j].getAttribute("data-tab") === tabName);
    }
  }

  // ── Sidebar chart type ─────────────────────────────────

  function setActiveSidebarButton(chartType) {
    for (var i = 0; i < sidebarButtons.length; i++) {
      var btn = sidebarButtons[i];
      if (btn.getAttribute("data-chart") === chartType) {
        btn.classList.add("active");
        var svg = btn.querySelector("svg");
        var label = btn.querySelector(".sidebar-btn-label");
        if (svg && headerChartIcon) {
          headerChartIcon.innerHTML = "";
          headerChartIcon.appendChild(svg.cloneNode(true));
          headerChartIcon.title = label ? label.textContent : chartType;
        }
      } else {
        btn.classList.remove("active");
      }
    }
  }

  // ── Main UI visibility ─────────────────────────────────

  function setMainUIVisible(show) {
    var display = show ? "" : "none";
    if (tabBar) tabBar.style.display = display;
    if (panelBody) panelBody.style.display = display;
    if (show) {
      if (bottomBar) bottomBar.style.display = "";
    } else {
      // Bottom bar stays visible for Map Maker (Place button works for maps too)
      var mmVisible = mmPanelEl && mmPanelEl.style.display === "flex";
      if (!mmVisible && bottomBar) bottomBar.style.display = "none";
    }
  }

  // ── Header button highlight ────────────────────────────

  function setActiveHeaderBtn(activeBtn) {
    for (var h = 0; h < headerBtns.length; h++) {
      if (headerBtns[h]) headerBtns[h].classList.remove("active");
    }
    if (activeBtn) activeBtn.classList.add("active");
  }

  // ── Close helpers ──────────────────────────────────────

  // Guides and Map Maker are Illustrator-only panels: their scripts are not
  // loaded in the web shell, so every call to them is guarded.
  function closeGuides() {
    if (typeof GridPanelUI !== "undefined") GridPanelUI.close();
  }

  function closeMapMaker() {
    if (mmPanelEl) mmPanelEl.style.display = "none";
    setMainUIVisible(true);
    setActiveHeaderBtn(null);
  }

  /** Close every tool panel, picker, and restore main UI. */
  function closeAllPanels() {
    IconsPanel.close();
    FlagsPanel.close();
    MapsPanel.close();
    closeMapMaker();
    closeGuides();
    if (_closePicker) _closePicker();
    setMainUIVisible(true);
    setActiveHeaderBtn(null);
  }

  // ── Event binding ──────────────────────────────────────

  function bindEvents() {
    // Tab buttons
    for (var ti = 0; ti < tabBtns.length; ti++) {
      tabBtns[ti].addEventListener("click", function () {
        setActiveTab(this.getAttribute("data-tab"));
      });
    }

    // Sidebar chart type buttons
    for (var si = 0; si < sidebarButtons.length; si++) {
      sidebarButtons[si].addEventListener("click", (function (btn) {
        return function () {
          var prevType = _store.chartType;
          var chartType = btn.getAttribute("data-chart");
          _store.chartType = chartType;

          // Reset per-row/per-column colors & shapes when switching icon ↔ other
          var wasIcon = (prevType === "icon");
          var isIcon = (chartType === "icon");
          if (wasIcon !== isIcon) {
            _store.iconColors = null;
            _store.iconShapes = null;
          }

          // Line + timeline preserve data order by default; others sort descending
          var ORDERED = { line: true, timeline: true };
          if (ORDERED[chartType] && !ORDERED[prevType]) {
            _store.autoSort = false;
          } else if (ORDERED[prevType] && !ORDERED[chartType]) {
            _store.autoSort = true;
          }

          // Timeline has a locked schema: Date / Label / Description.
          // On entering timeline mode, rewrite the headers and pad/trim rows to 3 cols.
          if (chartType === "timeline" && prevType !== "timeline") {
            _store.headers = ["Date", "Label", "Description"];
            for (var ri = 0; ri < _store.rows.length; ri++) {
              var row = _store.rows[ri] || [];
              // Ensure 3 cells (pad with empty strings, drop extras)
              if (row.length < 3) {
                while (row.length < 3) row.push("");
              } else if (row.length > 3) {
                row = row.slice(0, 3);
              }
              _store.rows[ri] = row;
            }
            _store.labelCol = 0;
            _store.valueCol = 1;
            _store.valueCols = null;
            if (typeof _refreshGrid === "function") _refreshGrid();
          }

          setActiveSidebarButton(chartType);
          _updateColSelectors();
          _updateMultiCol();
          _updateChartOpts();

          // Chart types with a "Load sample data" empty-state link should
          // always generate so the link surfaces even when the grid is empty.
          var OFFERS_SAMPLE = { sankey: true, keyfigures: true, timeline: true };
          if (_store.hasData() || OFFERS_SAMPLE[chartType]) {
            _generate();
            _schedule();
          }
        };
      })(sidebarButtons[si]));
    }

    // Header chart icon → shortcut to Chart tab
    if (headerChartIcon) {
      headerChartIcon.addEventListener("click", function () {
        closeAllPanels();
        setActiveTab("chart");
      });
    }

    // Click header bar background → go home (Data tab)
    var headerBar = document.getElementById("header");
    if (headerBar) {
      headerBar.addEventListener("click", function (evt) {
        var target = evt.target;
        if (target !== headerBar && !target.classList.contains("header-spacer")) return;
        closeAllPanels();
        setActiveTab("data");
      });
    }

    // Close buttons (X) on each panel
    var closeBtnIds = ["btn-icons-close", "btn-flags-close", "btn-maps-close", "btn-grid-close", "btn-mapmaker-close"];
    for (var ci = 0; ci < closeBtnIds.length; ci++) {
      var closeBtn = document.getElementById(closeBtnIds[ci]);
      if (closeBtn) {
        closeBtn.addEventListener("click", function () { setActiveHeaderBtn(null); });
      }
    }

    // "Back to Charts" buttons
    var backBtns = document.querySelectorAll(".panel-back-btn");
    for (var bbi = 0; bbi < backBtns.length; bbi++) {
      backBtns[bbi].addEventListener("click", function () {
        closeAllPanels();
      });
    }
  }

  // ── Panel header button handlers ───────────────────────

  function bindPanelButtons() {
    // Icons
    if (btnIconsHeader) {
      btnIconsHeader.addEventListener("click", function () {
        MapsPanel.close();
        FlagsPanel.close();
        closeMapMaker();
        closeGuides();
        IconsPanel.toggle();
        setActiveHeaderBtn(tabBar && tabBar.style.display === "none" ? btnIconsHeader : null);
      });
    }

    // Flags
    if (btnFlagsHeader) {
      btnFlagsHeader.addEventListener("click", function () {
        IconsPanel.close();
        MapsPanel.close();
        closeMapMaker();
        closeGuides();
        FlagsPanel.toggle();
        setActiveHeaderBtn(tabBar && tabBar.style.display === "none" ? btnFlagsHeader : null);
      });
    }

    // Maps
    if (btnMapsHeader) {
      btnMapsHeader.addEventListener("click", function () {
        IconsPanel.close();
        FlagsPanel.close();
        closeMapMaker();
        closeGuides();
        MapsPanel.toggle();
        setActiveHeaderBtn(tabBar && tabBar.style.display === "none" ? btnMapsHeader : null);
      });
    }
  }

  // ── Map Maker panel ────────────────────────────────────

  function initMapMaker(assetFlagsDir, setLastMapSVG) {
    var mmPanel = document.getElementById("mapmaker-panel");
    var mmBtn = document.getElementById("btn-mapmaker-header");
    var mmClose = document.getElementById("btn-mapmaker-close");
    if (!mmPanel || !mmBtn) return;

    function openMapMaker() {
      IconsPanel.close();
      FlagsPanel.close();
      MapsPanel.close();
      closeGuides();
      mmPanel.style.display = "flex";
      setMainUIVisible(false);
      setActiveHeaderBtn(mmBtn);
      try { MapMakerPanel.open(); } catch (e) { console.error("MapMaker open:", e); }
    }

    mmBtn.addEventListener("click", function () {
      var isVisible = mmPanel.style.display === "flex";
      if (isVisible) {
        closeMapMaker();
      } else {
        openMapMaker();
      }
    });

    if (mmClose) {
      mmClose.addEventListener("click", function () {
        closeMapMaker();
      });
    }

    if (typeof MapMakerPanel !== "undefined") try {
      var mmExtPath = assetFlagsDir ? assetFlagsDir.replace(/\/client\/flags$/, "") : "";
      MapMakerPanel.init(mmExtPath, function (svg) { setLastMapSVG(svg); });
    } catch (e) {
      console.error("MapMakerPanel init error:", e);
    }
  }

  // ── Init ───────────────────────────────────────────────

  function init(deps) {
    _store              = deps.store;
    _generate           = deps.generate;
    _schedule           = deps.schedule;
    _updateColSelectors = deps.updateColSelectors;
    _updateMultiCol     = deps.updateMultiCol;
    _updateChartOpts    = deps.updateChartOpts;
    _refreshGrid        = deps.refreshGrid;
    _closePicker        = deps.closePicker;

    // DOM refs
    tabBtns          = document.querySelectorAll(".tab-btn");
    tabPanels        = document.querySelectorAll(".tab-panel");
    sidebarButtons   = document.querySelectorAll("#chart-sidebar .sidebar-btn");
    headerChartIcon  = document.getElementById("header-chart-icon");
    tabBar           = document.getElementById("tab-bar");
    panelBody        = document.getElementById("panel-body");
    bottomBar        = document.getElementById("bottom-bar");
    mmPanelEl        = document.getElementById("mapmaker-panel");
    btnIconsHeader   = document.getElementById("btn-icons-header");
    btnFlagsHeader   = document.getElementById("btn-flags-header");
    btnMapsHeader    = document.getElementById("btn-maps-header");

    headerBtns = [
      btnIconsHeader,
      btnFlagsHeader,
      document.getElementById("btn-maps-header"),
      document.getElementById("btn-grid-header"),
      document.getElementById("btn-mapmaker-header")
    ];

    // Init panels
    IconsPanel.init();
    FlagsPanel.init();
    MapsPanel.init();

    // Bind all event handlers
    bindEvents();
    bindPanelButtons();

    // Map Maker
    initMapMaker(deps.assetFlagsDir, deps.setLastMapSVG);
  }

  // ── Public API ─────────────────────────────────────────

  return {
    init:                   init,
    setActiveTab:           setActiveTab,
    setActiveSidebarButton: setActiveSidebarButton,
    setMainUIVisible:       setMainUIVisible,
    setActiveHeaderBtn:     setActiveHeaderBtn,
    closeAllPanels:         closeAllPanels,
    closeMapMaker:          closeMapMaker
  };

})();
