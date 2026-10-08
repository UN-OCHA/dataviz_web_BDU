/**
 * OCHA Humanitarian Chart Tool — Panel Logic
 *
 * Main orchestrator: wires modules together, handles data flow,
 * sync UI ↔ DataStore, generateSVG, and Illustrator integration
 * (place, edit, live update, selection polling).
 *
 * The version is read from APP_VERSION below; the canonical source
 * of truth for the plugin version is CSXS/manifest.xml.
 */

/* global Connector, DataStore, DataGrid, DataInput, ChartRegistry, SvgInlineUtils, IconsPanel, GridPanelUI, ColorPickersUI, IconFlagUI, SeriesLegendUI, DesignControlsUI, ChartBuilder, PanelCoordinator, MapMakerPanel, StatusUI, ThemeManager, VersionCheck, Analytics */

(function () {
  "use strict";

  var APP_VERSION = "2026.1.5";

  // Everything shell-specific (Illustrator vs web) goes through the global
  // Connector — see connector-illustrator.js. `csInterface` is its
  // Illustrator bridge (evalScript etc.); null in the web shell.
  var csInterface = Connector.illustrator;

  // Asset directories for inline icon/flag rendering
  var assetFlagsDir = Connector.paths.flags;
  var assetIconsDir = Connector.paths.icons;
  var hostScriptPath = Connector.paths.hostScript;

  // ── Re-load the ExtendScript host on every panel boot ────────
  //
  // CEP loads `host/index.jsx` ONCE per Illustrator session via the
  // manifest's <ScriptPath>. When we reload the panel during dev (or
  // when the user updates the plugin via Dropbox without restarting
  // Illustrator), any new host-side functions added since Illustrator
  // last started won't exist — calling them returns "EvalScript error."
  // and the user sees what looks like a silent hang.
  //
  // Forcing $.evalFile() here re-evaluates host/index.jsx in
  // ExtendScript's persistent global scope, redefining every function
  // with the latest source. Cheap (~ms), safe (it's the same script
  // CEP already loaded once), and saves Javier a full Illustrator
  // restart for every host edit.
  (function () {
    if (!hostScriptPath) return;
    try {
      // Use single quotes around the path arg because Windows paths
      // contain backslashes that double-escape weirdly in JS-string-in-
      // ExtendScript-source layering. Forward slashes survive both.
      var safe = hostScriptPath.replace(/\\/g, "/");
      csInterface.evalScript('$.evalFile("' + safe + '")');
    } catch (e) { /* host stays at whatever was last loaded */ }
  })();

  // ── Suppress Illustrator keyboard shortcuts while typing ──
  // Register interest in key events so they don't pass through to AI
  // when input fields (text inputs, textareas, contenteditable) have focus.

  var keyInterestRegistered = false;

  function suppressAIShortcuts() {
    if (keyInterestRegistered) return;
    try {
      // Register interest in all key events — this prevents them from
      // reaching the host app (Illustrator) while the panel has focus.
      var keyEventsOfInterest = [
        { keyCode: 0 } // all keys
      ];
      csInterface.registerKeyEventsInterest(JSON.stringify(keyEventsOfInterest));
      keyInterestRegistered = true;
    } catch (e) {
      // Fallback: older CEP versions may not support this
    }
  }

  function restoreAIShortcuts() {
    if (!keyInterestRegistered) return;
    try {
      csInterface.registerKeyEventsInterest("[]");
      keyInterestRegistered = false;
    } catch (e) {
      // ignore
    }
  }

  // Listen for focus/blur on any input-like element or the data grid
  document.addEventListener("focusin", function (e) {
    var tag = e.target.tagName;
    var editable = e.target.getAttribute("contenteditable") === "true";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || editable) {
      suppressAIShortcuts();
    }
  });

  document.addEventListener("focusout", function (e) {
    var tag = e.target.tagName;
    var editable = e.target.getAttribute("contenteditable") === "true";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || editable) {
      // Small delay to allow focus to transfer to another input
      setTimeout(function () {
        var active = document.activeElement;
        var activeTag = active ? active.tagName : "";
        var activeEditable = active ? active.getAttribute("contenteditable") === "true" : false;
        if (activeTag !== "INPUT" && activeTag !== "TEXTAREA" && activeTag !== "SELECT" && !activeEditable) {
          restoreAIShortcuts();
        }
      }, 100);
    }
  });

  // ── Design System — Material 3 (always on) ─────────
  document.documentElement.setAttribute("data-design", "material");

  // Theme → ThemeManager (loaded before panel.js, runs immediately)

  // ── State ──────────────────────────────────────────

  var lastSVG = null;
  var lastMapSVG = null;
  var editMode = false;
  var editConfigHash = "";

  // ── DOM References ────────────────────────────────────

  // Text fields
  var titleInput = document.getElementById("chart-title");
  var subtitleInput = document.getElementById("chart-subtitle");
  var commentsInput = document.getElementById("chart-comments");
  var footerInput = document.getElementById("chart-footer");

  // Width slider (stays here — used directly by width event handler)
  var widthSlider = document.getElementById("width-slider");
  var widthDisplay = document.getElementById("width-display");
  var bpDisplay = document.getElementById("bp-display");

  // Data section
  var btnUploadFile = document.getElementById("btn-upload-file");

  // Column selectors
  var colSelectorSection = document.getElementById("col-selector-section");
  var selLabelCol = document.getElementById("sel-label-col");
  var selValueCol = document.getElementById("sel-value-col");
  var multiColSection = document.getElementById("multi-col-section");
  var multiColList = document.getElementById("multi-col-list");
  var iconColSection = document.getElementById("icon-col-section");

  // Grid
  var gridContainer = document.getElementById("data-grid-container");

  // Buttons
  var btnPlace = document.getElementById("btn-place");

  // UI elements
  var editBanner = document.getElementById("edit-banner");
  var menuBtn = document.getElementById("menu-btn");
  var menuDropdown = document.getElementById("menu-dropdown");

  // Theme toggle (circle button in hamburger menu)
  var btnThemeToggle = document.getElementById("btn-theme-toggle");

  // Grid header icon (still needed for GridPanelUI.init)
  var btnGridHeader = document.getElementById("btn-grid-header");

  // Refresh button
  var btnRefresh = document.getElementById("btn-refresh");

  // Sample data button
  var btnSampleData = document.getElementById("btn-sample-data");

  // ── Chart types that need multi-value columns ──────
  var MULTI_VALUE_TYPES = {
    "stacked-bar": true,
    "stacked-col": true,
    "icon": true,
    "cluster": true,
    // Line is multi-value too: each selected value column becomes a
    // separate line. With a single value column it's just one line.
    "line": true,
    // Line small multiples: each selected value column becomes its own
    // mini line chart (panel).
    "cluster-line": true
  };

  // ── Chart types that support icon/flag columns ─────
  var ICON_COL_TYPES = {
    "hbar": true,
    "vbar": true,
    "stacked-bar": true,
    "stacked-col": true,
    "table": true,
    "keyfigures": true
  };

  // Status → StatusUI
  var showStatus  = StatusUI.show;
  var clearStatus = StatusUI.clear;

  // ── Breakpoint Helper (delegates to ChartRegistry) ────

  function getBreakpoint(w) {
    return ChartRegistry.getBreakpoint(w);
  }

  // ── Chart-specific option visibility ──────────────────

  function updateChartOptions() {
    var type = DataStore.chartType || "hbar";
    var isStacked = (type === "stacked-bar" || type === "stacked-col");

    // Chart-specific design controls (line, donut, sankey, bubble, pie labels,
    // bar labels, value format, bar thickness)
    DesignControlsUI.updateVisibility(type);

    // Sankey: hide generic sample button, show sankey-specific sample buttons
    if (type === "sankey") {
      if (btnSampleData) btnSampleData.style.display = "none";
      if (sankeySampleLinks) sankeySampleLinks.style.display = "inline";
    } else {
      if (btnSampleData) btnSampleData.style.display = "";
      if (sankeySampleLinks) sankeySampleLinks.style.display = "none";
    }

    // Key Figures options
    if (type === "keyfigures") { KeyFiguresUI.show(); } else { KeyFiguresUI.hide(); }

    // Timeline options (per-row icon picker list)
    if (type === "timeline") { TimelineUI.show(); } else { TimelineUI.hide(); }

    // Reparent label color/scale into legend section for icon charts, restore for others
    SeriesLegendUI.reparentLabelSections(type);

    // Icon chart legend + stacked chart series colors + stroke
    SeriesLegendUI.updateVisibility(type, isStacked);

    // Icon/Flag column selector: show for bar, column, stacked, and table types
    if (iconColSection) {
      var showIconCol = ICON_COL_TYPES[type] && DataStore.headers && DataStore.headers.length >= 1;
      iconColSection.style.display = showIconCol ? "block" : "none";
      if (showIconCol) {
        IconFlagUI.syncCheckboxes();
      }
    }

    // Single-value chart color picker (all non-multi-value types except table, text, sankey, timeline)
    // Timeline uses colors[0] for the line/dots; no per-series picker needed yet.
    var isSingleColor = !MULTI_VALUE_TYPES[type] && type !== "table" && type !== "sankey" && type !== "keyfigures" && type !== "timeline";
    ColorPickersUI.syncChartColorUI(isSingleColor);
  }

  // ── Sync UI → DataStore ─────────────────────────────────

  function syncStoreFromUI() {
    DataStore.chartTitle = titleInput.value.trim();
    DataStore.chartSubtitle = subtitleInput.value.trim();
    DataStore.chartComments = commentsInput.value.trim();
    DataStore.chartFooter = footerInput.value.trim();
    DataStore.chartWidth = parseInt(widthSlider.value, 10) || 500;
    // chartHeight is auto (0) by default. DesignControlsUI.syncFromUI
    // writes verticalPadding from the height slider; chartHeight stays
    // whatever was loaded from config (0 for new charts, a specific
    // value for re-opened charts saved with a manual height).

    // Design controls (height, bar thickness, shade, line, donut, pie, bar labels,
    // value format, auto-sort, text/label scale, sankey)
    DesignControlsUI.syncFromUI();

    // Stacked stroke + icon size
    SeriesLegendUI.syncFromUI();

    // Label color
    DataStore.labelColor = ColorPickersUI.readLabelColor();
  }

  function syncUIFromStore() {
    // Text fields
    titleInput.value = DataStore.chartTitle || "";
    subtitleInput.value = DataStore.chartSubtitle || "";
    commentsInput.value = DataStore.chartComments || "";
    footerInput.value = DataStore.chartFooter || "";

    // Chart type sidebar
    PanelCoordinator.setActiveSidebarButton(DataStore.chartType || "hbar");

    // Width slider
    var w = DataStore.chartWidth || 500;
    widthSlider.value = w;
    widthDisplay.textContent = w + "px";
    bpDisplay.textContent = getBreakpoint(w);

    // Design controls (height, bar thickness, shade, line, donut, sankey,
    // bubble, pie labels, bar labels, value format, auto-sort, text/label scale)
    DesignControlsUI.syncToUI();
    ColorPickersUI.syncLineLabelBgToUI();

    // Icon chart legend + stacked stroke
    SeriesLegendUI.syncToUI();

    // Key Figures + Timeline side panels — refresh icon picker lists
    // and any per-row UI from the loaded DataStore state.
    if (typeof KeyFiguresUI !== "undefined" && KeyFiguresUI.syncToUI) KeyFiguresUI.syncToUI();
    if (typeof TimelineUI !== "undefined" && TimelineUI.syncToUI) TimelineUI.syncToUI();

    // Label color swatch
    ColorPickersUI.syncLabelColorToUI();

    // Icon/Flag radio buttons
    IconFlagUI.syncCheckboxes();

    // Style radio + swatch palette sync
    var activeStyle = DataStore.style || "ocha";
    var styleRadios = document.querySelectorAll('input[name="style"]');
    for (var i = 0; i < styleRadios.length; i++) {
      styleRadios[i].checked = (styleRadios[i].value === activeStyle);
    }
    ColorPickersUI.onStyleChange(activeStyle);

    // Column selectors
    updateColumnSelectors();
    updateMultiColVisibility();
    updateChartOptions();

    updateHeaderChartIconVisibility();
  }

  // ── Sample Data ───────────────────────────────────────

  var sankeySampleLinks = document.getElementById("sankey-sample-links");

  function loadSankeyAndShow(type) {
    DataGrid.pushUndo();
    DataStore.loadSampleData(type);
    DataGrid.render(gridContainer);
    updateColumnSelectors();
    generateSVG();
    scheduleLiveUpdate();
    var levels = type === "sankey-3" ? "3" : "2";
    showStatus("Sample data for Sankey " + levels + "-level flow loaded.", "success");
    setTimeout(clearStatus, 8000);
  }

  if (btnSampleData) {
    btnSampleData.addEventListener("click", function () {
      DataGrid.pushUndo();
      var result = DataStore.loadSampleData(DataStore.chartType);
      if (result.ok) {
        syncUIFromStore();
        DataGrid.render(gridContainer);
        generateSVG();
        showStatus("Sample data loaded (" + result.rowCount + " rows).", "success");
        setTimeout(clearStatus, 8000);
      }
    });
  }

  var btnSankey2 = document.getElementById("btn-sankey-2");
  var btnSankey3 = document.getElementById("btn-sankey-3");
  if (btnSankey2) btnSankey2.addEventListener("click", function (e) { e.preventDefault(); loadSankeyAndShow("sankey-2"); });
  if (btnSankey3) btnSankey3.addEventListener("click", function (e) { e.preventDefault(); loadSankeyAndShow("sankey-3"); });

  // ── Hamburger Menu ─────────────────────────────────────

  menuBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    menuDropdown.classList.toggle("visible");
  });

  // Theme toggle button (circle in hamburger menu)
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener("click", function () {
      ThemeManager.toggle();
    });
  }

  // CEP external links — open in default browser (delegated for dynamic elements)
  document.addEventListener("click", function (e) {
    var el = e.target.closest(".cep-link");
    if (!el) return;
    e.preventDefault();
    var url = el.getAttribute("data-url");
    console.log("[cep-link] clicked, url:", url, "element:", el.id || el.textContent.trim().substring(0, 30));
    if (url) {
      Connector.openURL(url);
      if (url.indexOf("crisisrelief") !== -1) {
        sendAnalyticsPing("donate:click");
      }
    }
  });

  // Close menu when clicking outside
  document.addEventListener("click", function (e) {
    if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
      menuDropdown.classList.remove("visible");
    }
  });

  // Style radio buttons (built-in styles + custom colour themes all share
  // name="style"). Extracted so dynamically-added custom-theme radios reuse it.
  function applyStyleSelection(value) {
    DataStore.style = value;
    // Custom theme ids are user-defined (could contain an org name), so report a
    // generic "style:custom" rather than the id — keeps analytics clean + private.
    var isCustom = ChartRegistry.CUSTOM_THEMES && ChartRegistry.CUSTOM_THEMES[value];
    sendAnalyticsPing("style:" + (isCustom ? "custom" : value));
    // Reset colors so style palette is used
    DataStore.colors = null;
    DataStore.iconColors = null;
    var st = ChartRegistry.getStyle(value);
    DataStore.kfIconColor = (st.colors && st.colors[0]) || "#009EDB";
    ColorPickersUI.onStyleChange(value);
    IconsPanel.refreshColors();
    KeyFiguresUI.syncToUI();
    TimelineUI.syncToUI();
    updateChartOptions();
    if (DataStore.hasData()) {
      generateSVG();
      scheduleLiveUpdate();
    }
  }
  var styleRadios = document.querySelectorAll('input[name="style"]');
  for (var ri = 0; ri < styleRadios.length; ri++) {
    styleRadios[ri].addEventListener("change", function () {
      if (this.checked) applyStyleSelection(this.value);
    });
  }

  // Custom colour themes — user-defined palettes alongside the built-ins,
  // persisted outside the plugin folder so they survive auto-updates.
  if (typeof ThemesUI !== "undefined" && typeof ThemesStore !== "undefined") {
    ThemesUI.init({
      registry: ChartRegistry,
      store: ThemesStore,
      onApplyStyle: applyStyleSelection,
      getCurrentStyle: function () { return DataStore.style; },
      status: function (msg, type, persistent) { showStatus(msg, type || "success", false, !!persistent); }
    });
  }

  // ── Key Figures UI ──────────────────────────────────────
  KeyFiguresUI.init({
    store: DataStore,
    generate: generateSVG,
    schedule: scheduleLiveUpdate,
    openIconPicker: IconFlagUI.openPicker,
    getSwatches: function () { return ChartRegistry.getSwatches(DataStore.style || "ocha"); },
    assetIconsDir: assetIconsDir
  });

  // ── Timeline UI ─────────────────────────────────────────
  TimelineUI.init({
    store: DataStore,
    generate: generateSVG,
    schedule: scheduleLiveUpdate,
    openIconPicker: IconFlagUI.openPicker,
    assetIconsDir: assetIconsDir
  });

  // Refresh button — full panel reload
  if (btnRefresh) {
    btnRefresh.addEventListener("click", function () {
      // Re-sync everything from current DataStore state
      syncUIFromStore();
      updateChartOptions();
      updateColumnSelectors();
      updateMultiColVisibility();
  
      if (DataStore.hasData()) {
        DataGrid.render(gridContainer);
        generateSVG();
        scheduleLiveUpdate();
      }
      // Brief visual feedback — spin animation
      btnRefresh.classList.add("refreshing");
      setTimeout(function () { btnRefresh.classList.remove("refreshing"); }, 500);
    });
  }

  // ── Panel Coordinator (tabs, sidebar, header, panel toggles) ──
  PanelCoordinator.init({
    store:              DataStore,
    generate:           generateSVG,
    schedule:           scheduleLiveUpdate,
    updateColSelectors: updateColumnSelectors,
    updateMultiCol:     updateMultiColVisibility,
    updateChartOpts:    updateChartOptions,
    refreshGrid:        function () { DataGrid.render(gridContainer); },
    closePicker:        IconFlagUI.closePicker,
    setLastMapSVG:      function (svg) { lastMapSVG = svg; },
    assetFlagsDir:      assetFlagsDir
  });

  // ── Color Pickers UI ─────────────────────────────────
  ColorPickersUI.init({
    store:          DataStore,
    generate:       generateSVG,
    schedule:       scheduleLiveUpdate,
    clearIconCache: SvgInlineUtils.clearCache
  });

  // ── Icon/Flag Column UI ──────────────────────────────
  IconFlagUI.init({
    store:          DataStore,
    generate:       generateSVG,
    schedule:       scheduleLiveUpdate,
    clearIconCache: SvgInlineUtils.clearCache,
    getPreviewHtml: SvgInlineUtils.getPreviewHtml,
    resolveFlag:    SvgInlineUtils.resolveFlag,
    resolveIcon:    SvgInlineUtils.resolveIcon,
    assetFlagsDir:  assetFlagsDir,
    assetIconsDir:  assetIconsDir,
    syncIconColor:  ColorPickersUI.syncIconColor,
    buildLegendRows: SeriesLegendUI.buildLegendRows,
    buildKfIconRows: KeyFiguresUI.buildIconRows,
    buildTimelineIconRows: TimelineUI.buildIconRows
  });

  // ── Series Legend UI (icon chart legend + stacked series colors + stroke) ──
  SeriesLegendUI.init({
    store:              DataStore,
    generate:           generateSVG,
    schedule:           scheduleLiveUpdate,
    getIconPalette:     ColorPickersUI.getIconPalette,
    getSwatches:        ColorPickersUI.getSwatches,
    closeDropdown:      ColorPickersUI.closeDropdown,
    buildSeriesDropdown: ColorPickersUI.buildSeriesDropdown,
    openPicker:         IconFlagUI.openPicker,
    SHAPE_THUMBS:       IconFlagUI.SHAPE_THUMBS,
    assetIconsDir:      assetIconsDir,
    syncStrokeColor:    ColorPickersUI.syncStrokeColor
  });

  // ── Design Controls UI (chart-specific sliders and options) ──
  DesignControlsUI.init({
    store:          DataStore,
    generate:       generateSVG,
    schedule:       scheduleLiveUpdate,
    readLineLabelBg: ColorPickersUI.readLineLabelBg
  });

  // ── Grid Panel UI (Illustrator only — absent in the web shell) ──
  if (typeof GridPanelUI !== "undefined") GridPanelUI.init({
    csInterface:      csInterface,
    showStatus:       showStatus,
    clearStatus:      clearStatus,
    sendAnalytics:    sendAnalyticsPing,
    setMainUIVisible: PanelCoordinator.setMainUIVisible,
    setActiveHeaderBtn: PanelCoordinator.setActiveHeaderBtn,
    hideEditBanner:   function () { editBanner.classList.remove("visible"); },
    closeOtherPanels: function () {
      IconsPanel.close();
      FlagsPanel.close();
      MapsPanel.close();
      PanelCoordinator.closeMapMaker();
    },
    btnGridHeader:    btnGridHeader
  });

  // ── Chart Builder (config + render pipeline) ─────────
  ChartBuilder.init({
    store:          DataStore,
    showStatus:     showStatus,
    clearStatus:    clearStatus,
    onSankeyLoad:   function (type) {
      PanelCoordinator.setActiveTab("data");
      loadSankeyAndShow(type);
    },
    onKfLoad:       function () {
      DataGrid.pushUndo();
      PanelCoordinator.setActiveTab("data");
      DataStore.loadSampleData("keyfigures");
      DataGrid.render(gridContainer);
      updateColumnSelectors();
      generateSVG();
      scheduleLiveUpdate();
      showStatus("Sample key figures data loaded.", "success");
      setTimeout(clearStatus, 6000);
    },
    onTimelineLoad: function () {
      DataGrid.pushUndo();
      PanelCoordinator.setActiveTab("data");
      DataStore.loadSampleData("timeline");
      DataGrid.render(gridContainer);
      updateColumnSelectors();
      generateSVG();
      scheduleLiveUpdate();
      showStatus("Sample timeline data loaded.", "success");
      setTimeout(clearStatus, 6000);
    },
    getIconPalette: ColorPickersUI.getIconPalette,
    getSwatches:    ColorPickersUI.getSwatches,
    assetFlagsDir:  assetFlagsDir,
    assetIconsDir:  assetIconsDir
  });

  // ── AI import (Copilot / ChatGPT / etc. → JSON → chart) ──
  if (typeof AiImport !== "undefined") {
    AiImport.init({
      store:         DataStore,
      syncUI:        syncUIFromStore,
      generate:      generateSVG,
      showStatus:    showStatus,
      clearStatus:   clearStatus,
      pushUndo:      function () { DataGrid.pushUndo(); },
      renderGrid:    function () { DataGrid.render(gridContainer); },
      // Illustrator places the charts on artboards; the web shell gets
      // them rendered as SVGs instead (it downloads them as one ZIP).
      placeBatch:    csInterface ? placeBatch : renderBatchForShell,
      sendAnalytics: sendAnalyticsPing
    });

    // Two entry points to the same AI modal:
    //   - btn-use-ai       → Data tab (next to "Upload CSV")
    //   - btn-use-ai-chart → Chart Type tab (next to the section label)
    // Same button visual, same modal, same prompt — just two doors so
    // the AI helper is one click away from wherever the user is.
    var btnUseAi = document.getElementById("btn-use-ai");
    if (btnUseAi) btnUseAi.addEventListener("click", AiImport.openModal);
    var btnUseAiChart = document.getElementById("btn-use-ai-chart");
    if (btnUseAiChart) btnUseAiChart.addEventListener("click", AiImport.openModal);
  }

  // ── Batch progress bar (visible during AI batch placement) ──
  //
  // A thin overlay near the top of the panel that shows progress while
  // we place 2–10 charts in sequence. Hidden by default; only visible
  // during a placeBatch run. The DOM nodes are looked up lazily so we
  // don't fail if the panel is rendered without the overlay (defensive
  // — the elements ARE in the static HTML, but if a future refactor
  // removes them the batch flow shouldn't break).
  function _batchProgressEls() {
    return {
      overlay: document.getElementById("batch-progress-overlay"),
      label:   document.getElementById("batch-progress-label"),
      fill:    document.getElementById("batch-progress-fill"),
      count:   document.getElementById("batch-progress-count")
    };
  }
  function showBatchProgress(total) {
    var el = _batchProgressEls();
    if (!el.overlay) return;
    if (el.label) el.label.textContent = "Starting…";
    if (el.fill)  el.fill.style.width = "0%";
    if (el.count) el.count.textContent = "0 / " + total;
    el.overlay.style.display = "flex";
    // Clear the regular status line — the bar is now the source of truth
    // until the run finishes.
    if (clearStatus) clearStatus();
  }
  function updateBatchProgress(done, total, label) {
    var el = _batchProgressEls();
    if (!el.overlay) return;
    var pct = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
    if (el.fill)  el.fill.style.width = pct.toFixed(1) + "%";
    if (el.count) el.count.textContent = done + " / " + total;
    if (el.label) el.label.textContent = label || "";
  }
  function hideBatchProgress() {
    var el = _batchProgressEls();
    if (!el.overlay) return;
    el.overlay.style.display = "none";
  }

  // ── Batch pause-on-error modal ─────────────────────────────
  // Pauses the placement loop on a per-chart failure, asks the user
  // whether to skip the failed chart and continue or stop the whole
  // batch. Optionally surfaces a "Copy fix prompt" button when the
  // failure is plausibly AI-fixable. opts:
  //   message         — the human-readable error
  //   slotIdx, total  — for the "Chart N of M" label
  //   fixPrompt       — string to copy if user clicks "Copy fix prompt";
  //                     when null/empty, the button is hidden
  //   onContinue      — called when user clicks "Skip and continue"
  //   onStop          — called when user clicks "Stop batch"
  function showBatchPauseModal(opts) {
    var modal = document.getElementById("batch-pause-modal");
    var msgEl = document.getElementById("batch-pause-message");
    var progEl = document.getElementById("batch-pause-progress");
    var copyBtn = document.getElementById("batch-pause-copy-fix");
    var stopBtn = document.getElementById("batch-pause-stop");
    var contBtn = document.getElementById("batch-pause-continue");
    if (!modal || !msgEl || !stopBtn || !contBtn) {
      // DOM not present — fall back to immediate stop with no UI choice
      if (opts && opts.onStop) opts.onStop();
      return;
    }

    msgEl.textContent = opts.message || "An unspecified error happened.";
    if (progEl) {
      var slot = (opts.slotIdx != null) ? (opts.slotIdx + 1) : "?";
      var total = opts.total || "?";
      var remaining = (opts.total && opts.slotIdx != null)
        ? (opts.total - opts.slotIdx - 1)
        : "?";
      progEl.textContent = "Failed at chart " + slot + " of " + total +
        ". " + remaining + " chart" + (remaining === 1 ? "" : "s") + " remaining if you continue.";
    }

    // Show/hide the fix-prompt button based on whether one was provided
    var hasFixPrompt = !!(opts.fixPrompt && opts.fixPrompt.length > 0);
    if (copyBtn) {
      copyBtn.style.display = hasFixPrompt ? "" : "none";
    }

    // Wire buttons. Use property assignment (not addEventListener) so
    // we replace any previous handler from a prior pause — otherwise
    // a second pause in the same batch would trigger both handlers.
    function close() {
      modal.style.display = "none";
      stopBtn.onclick = null;
      contBtn.onclick = null;
      if (copyBtn) copyBtn.onclick = null;
    }
    stopBtn.onclick = function () {
      close();
      if (opts.onStop) opts.onStop();
    };
    contBtn.onclick = function () {
      close();
      if (opts.onContinue) opts.onContinue();
    };
    if (copyBtn && hasFixPrompt) {
      copyBtn.onclick = function () {
        // Use the same off-screen-textarea pattern used elsewhere in
        // the panel for clipboard access (CEP's older Chromium has
        // unreliable navigator.clipboard).
        try {
          var ta = document.createElement("textarea");
          ta.value = opts.fixPrompt;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          if (typeof sendAnalyticsPing === "function") sendAnalyticsPing("ai:fixprompt");
          showStatus("Fix prompt copied — paste into your AI to get corrected JSON.", "success");
          setTimeout(clearStatus, 6000);
        } catch (e) {
          showStatus("Couldn't copy fix prompt: " + e.message, "error");
        }
        // Don't close — user might still want to choose Stop or
        // Continue after copying.
      };
    }

    // Show the modal
    modal.style.display = "flex";
  }

  // ── Diagnostic logging for the batch flow ──
  //
  // Writes labelled progress messages to console.log so a developer
  // with Chrome DevTools attached at localhost:8088 sees the full
  // trace including timestamps. Useful for diagnosing future weird
  // behaviour without modifying code.
  //
  // BATCH_TRACE_STATUS = true ALSO routes every line to the panel's
  // status bar — handy during active debugging but noisy for normal
  // users (they'll see "[batch] xxx" messages flashing during every
  // batch). Default off; flip on when investigating a hang.
  //
  // The visible progress bar at the top of the panel handles
  // user-facing per-chart progress already, so end users don't need
  // the status-bar trace.
  var BATCH_TRACE = true;
  var BATCH_TRACE_STATUS = false;
  function batchLog(msg) {
    if (!BATCH_TRACE) return;
    try { console.log("[batch] " + msg); } catch (e) { /* CEP older chromium */ }
    if (BATCH_TRACE_STATUS) {
      try { showStatus(msg, "info"); } catch (e) { /* status bar broken */ }
    }
  }

  // ── Batch placement (AI import: place N charts on N new artboards) ──
  //
  // Called by AiImport when the user clicks "Place all N charts" in the
  // batch review pane. Treat this as a macro: for each expanded internal
  // config, load it into DataStore, render to SVG synchronously, write
  // to a temp file, and ask ExtendScript to create a new artboard +
  // place the chart there. Repeat sequentially (each evalScript hop
  // waits for the previous one's callback before starting the next).
  //
  // At the end, restore the DataStore snapshot so the user lands back on
  // whatever they had open before clicking Use AI, and jump the active
  // artboard to the first newly-created one so they immediately see
  // chart 1 of N.
  //
  // Error policy: if ANY chart fails (render or placement), abort the
  // whole batch and report which one. We do NOT roll back artboards
  // already created on the Illustrator side — the user can use Edit →
  // Undo to remove partial work if needed. (Wrapping every batch in a
  // single Illustrator undo group would be nicer; deferred.)
  // Grid-layout sizing constants. Tunable. The minimum cell size below
  // is what produces ~9 charts on A4 portrait, ~4 on A5, ~16 on A0 —
  // matching the user's spec. Charts may overlap into adjacent cells if
  // their natural rendered SVG is wider than the cell; that's
  // acceptable per the user's "save time, not pixel-perfect" framing.
  var GRID_MIN_CELL_W = 200;   // pt — narrowest cell that's still readable
  var GRID_MIN_CELL_H = 280;   // pt — keeps room for title + axis + values
  var GRID_CELL_PAD   = 16;    // pt — uniform padding inside each cell

  // Margin around the inside edge of each grid-page artboard. Charts
  // never sit flush against the artboard edge — leaves breathing room
  // and reflects OCHA's "1 cm minimum margin" print-layout guideline
  // (see the ocha-dataviz skill, section 1 — Layout). 32 pt ≈ 1.13 cm.
  var GRID_ARTBOARD_MARGIN = 32;

  // Chart types that render badly in a single grid cell (too many
  // columns, long descriptions, multiple stat blocks, or graph-style
  // layouts that need horizontal room for source/target nodes). Span
  // 2 cells horizontally to give them room. Keep this list short and
  // conservative — the more charts span 2, the fewer fit per page.
  var WIDE_CHART_TYPES = {
    "table": true,
    "timeline": true,
    "sankey": true
  };

  // ── Batch import without Illustrator (web shell) ──────
  // Renders each chart of a multi-chart AI import to SVG through the same
  // load → ChartBuilder.render path placeBatch uses, minus the artboards,
  // then hands the list to the shell with an "ocha-batch-rendered" event
  // (the web version zips and downloads them). A chart that can't be drawn
  // is skipped and counted. The user's own chart is restored afterwards.
  function renderBatchForShell(configsArray, opts, onDone) {
    if (typeof opts === "function" && onDone === undefined) { onDone = opts; opts = {}; }
    onDone = onDone || function () {};
    if (!configsArray || !configsArray.length) {
      onDone({ ok: false, error: "No charts in the batch." });
      return;
    }
    var snapshot;
    try {
      snapshot = DataStore.toConfig();
    } catch (e) {
      onDone({ ok: false, error: "Couldn't snapshot current state: " + e.message });
      return;
    }
    var total = configsArray.length, charts = [], skipped = [];
    showBatchProgress(total);
    for (var i = 0; i < total; i++) {
      var label = "Chart " + (i + 1);
      try {
        var loadResult = DataStore.loadFromConfig(configsArray[i]);
        if (loadResult && loadResult.error) throw new Error(loadResult.error);
        label = (DataStore.chartTitle && DataStore.chartTitle.trim()) || label;
        updateBatchProgress(i, total, "Rendering: " + label);
        // ChartBuilder directly, not generateSVG(): that would first sync
        // the store from the still-unrefreshed panel inputs.
        var svg = ChartBuilder.render();
        if (!svg) throw new Error("the data doesn't fit this chart type");
        charts.push({ title: label, svg: svg });
      } catch (e) {
        skipped.push(label + " (" + e.message + ")");
      }
    }
    // Restore DataStore + UI to the pre-batch state.
    try { DataStore.loadFromConfig(snapshot); } catch (e) { /* best effort */ }
    try { syncUIFromStore(); } catch (e) { /* best effort */ }
    try { DataGrid.render(gridContainer); } catch (e) { /* best effort */ }
    try { generateSVG(); } catch (e) { /* best effort */ }
    hideBatchProgress();
    if (!charts.length) {
      onDone({ ok: false, error: "None of the charts could be drawn: " + skipped.join("; ") });
      return;
    }
    document.dispatchEvent(new CustomEvent("ocha-batch-rendered", { detail: { charts: charts } }));
    onDone({ ok: true, count: charts.length, skipped: skipped.length, total: total, layoutMode: "zip" });
  }

  function placeBatch(configsArray, opts, onDone) {
    // Backward-compat: older callers passed (configs, onDone) without an
    // options object. Detect that shape and fix up the args.
    if (typeof opts === "function" && onDone === undefined) {
      onDone = opts;
      opts = {};
    }
    opts = opts || {};
    var layoutMode = (opts.layoutMode === "grid") ? "grid" : "single";

    batchLog("placeBatch called with " + (configsArray ? configsArray.length : "?") + " configs, layoutMode=" + layoutMode);
    if (!configsArray || !configsArray.length) {
      if (onDone) onDone({ ok: false, error: "No charts in the batch." });
      return;
    }
    // ChartBuilder is the only sanity check we can do JS-side. Illustrator's
    // `app` global lives in ExtendScript, not in the panel's JS context —
    // referencing it from here is a ReferenceError under strict mode and was
    // the original cause of the silent batch-stuck bug. Host availability
    // is checked through getBatchPreflight() below instead.
    if (typeof ChartBuilder === "undefined" || !ChartBuilder) {
      batchLog("FAIL: ChartBuilder not available");
      if (onDone) onDone({ ok: false, error: "Plugin not fully initialised — try reloading the panel." });
      return;
    }
    batchLog("calling getBatchPreflight() via evalScript");

    // Step 1 — preflight. Confirm the host is ready BEFORE we mutate
    // DataStore or write any temp files. If Illustrator has no open
    // document (or the document somehow has zero artboards), we abort
    // with a clear error instead of failing mid-loop on chart 1 with a
    // confusing "Chart 1 of N failed" message.
    csInterface.evalScript("getBatchPreflight()", function (preflightRaw) {
      var preflight;
      // CEP returns the literal string "EvalScript error." when the
      // host throws an unhandled exception (most commonly: function
      // not defined). That happens if host/index.jsx hasn't been
      // reloaded since a function was added — usually fixed by the
      // auto-reload at panel boot, but if for any reason that
      // didn't take, give the user a clear hint instead of cryptic JSON.
      var rawStr = String(preflightRaw || "").trim();
      if (rawStr === "EvalScript error." || /^EvalScript\s+error/i.test(rawStr)) {
        if (onDone) onDone({
          ok: false,
          error: "The plugin's helper script isn't loaded in this Illustrator session. Quit and re-open Illustrator to fix this — sorry for the friction. (After this fix, panel reloads alone will be enough.)",
          preflightFailed: true
        });
        return;
      }
      try {
        preflight = JSON.parse(rawStr || '{"error":"empty preflight response"}');
      } catch (e) {
        preflight = { error: rawStr || e.message };
      }
      if (preflight.error) {
        // Surface preflight errors with a dedicated flag so the
        // modal-side handler can keep the batch summary visible
        // (the user might just need to open a document and retry —
        // no need to make them re-paste the JSON).
        if (onDone) onDone({ ok: false, error: preflight.error, preflightFailed: true });
        return;
      }

      // Step 2 — snapshot the current chart so we can restore it at the
      // end. We use toConfig() (the same round-trip used by Illustrator's
      // .note property), so anything the user had open — including
      // partial edits — comes back exactly as it was.
      var snapshot;
      try {
        snapshot = DataStore.toConfig();
      } catch (e) {
        if (onDone) onDone({ ok: false, error: "Couldn't snapshot current state: " + e.message });
        return;
      }

      var sourceIdx = (typeof preflight.sourceArtboardIdx === "number" && preflight.sourceArtboardIdx >= 0)
        ? preflight.sourceArtboardIdx
        : 0;
      var firstNewArtboardIdx = null;
      var placedCount = 0;
      var skippedCount = 0;     // charts the user chose to skip after a failure
      var batchSize = configsArray.length;
      var maxCols = 0;          // set by the canvas-probe call below (single mode)
      var gridLayout = null;    // populated when layoutMode === "grid"

      // Build a fix-prompt for AI-fixable batch errors. The user can
      // paste it back to Copilot/ChatGPT to get a corrected single-chart
      // JSON, then re-import. Useful when a specific chart's data
      // doesn't validate or can't render, less useful for host-side
      // failures (canvas overflow, no document open, etc.).
      function buildBatchFixPrompt(slotIdx, errMessage, configJson) {
        return "I tried to import a multi-chart array into the OCHA " +
          "DataViz plugin but chart " + (slotIdx + 1) + " of " + batchSize +
          " failed with this error:\n\n  " + errMessage + "\n\n" +
          "Please fix this single chart and return ONLY the corrected " +
          "JSON object for it (no array, no other charts). Original " +
          "chart JSON was:\n\n" + (configJson || "(unavailable)");
      }

      // Show the visible progress bar at 0%. updateBatchProgress hides
      // the regular "Placing N charts…" status text — the bar speaks
      // for itself once it's visible.
      showBatchProgress(batchSize);
      updateBatchProgress(0, batchSize, "Calculating layout…");

      // Per-chart timeout. If ExtendScript ever fails to fire its
      // callback (rare but observed — large script strings, an
      // Illustrator dialog stealing focus, a host-side error swallowed
      // somewhere), this surfaces the hang as a clear error after 15
      // seconds instead of leaving the user staring at a stuck status.
      var PER_CHART_TIMEOUT_MS = 15000;

      // Step 3 — probe how many columns fit per row in the current
      // document. This determines whether we lay out as a single row
      // (small batches that fit) or wrap into multiple rows (large
      // batches that would otherwise overflow the canvas). The probe
      // is one-time, ~ms-scale, and runs before any per-chart work so
      // the layout is deterministic from the start.
      batchLog("calling probeMaxBatchCols(" + sourceIdx + "," + batchSize + ")");
      csInterface.evalScript("probeMaxBatchCols(" + sourceIdx + "," + batchSize + ")", function (probeRaw) {
        var probe;
        try {
          probe = JSON.parse(probeRaw || '{"error":"empty probe response"}');
        } catch (e) {
          probe = { error: probeRaw || e.message };
        }
        if (probe.error) {
          hideBatchProgress();
          if (onDone) onDone({ ok: false, error: "Layout probe failed: " + probe.error });
          return;
        }
        maxCols = probe.maxCols || 0;
        batchLog("probe returned maxCols=" + maxCols);

        // Cap maxCols to a sensible dashboard layout (4 cols by default).
        // The probe returns the canvas-fit max, which can be 20+ for
        // typical artboards on a normal canvas. A 14-chart batch would
        // then go into a SINGLE row spanning ~7700 pt to the right of
        // the source — putting the rightmost artboards near Illustrator's
        // canvas edge, where editing has been observed to behave erratically
        // (charts jumping to the right of the canvas on update).
        //
        // Wrapping into rows of 4 also produces a much more usable
        // dashboard layout: a 14-chart batch becomes 4×4 (= 16 cells,
        // 2 unused) instead of 14×1.
        var TARGET_BATCH_COLS = 4;
        if (maxCols > TARGET_BATCH_COLS) {
          maxCols = TARGET_BATCH_COLS;
          batchLog("capped maxCols to " + TARGET_BATCH_COLS + " for dashboard-friendly wrap");
        }

        // If even a single new artboard doesn't fit (source is at the
        // canvas edge), there's nothing we can do — abort with a clear
        // user-actionable error.
        if (maxCols < 1) {
          hideBatchProgress();
          if (onDone) onDone({
            ok: false,
            error: "There's no room to place new artboards next to your current one — the source artboard is right at the edge of Illustrator's canvas. Move your source artboard closer to the document origin and try again."
          });
          return;
        }

        // ── Layout-mode branch ─────────────────────────────
        // "single": one chart per artboard (existing behaviour)
        // "grid":   pack chartsPerArtboard charts onto each artboard,
        //           sized as cells, spawning new artboards as needed
        if (layoutMode === "grid") {
          // Source artboard dimensions came back in the preflight payload.
          var srcW = preflight.sourceWidth || 595;     // default ~A4 portrait width
          var srcH = preflight.sourceHeight || 842;
          // Usable area = artboard minus the margin on each side.
          // The cell grid only fills this inner rectangle.
          var usableW = Math.max(GRID_MIN_CELL_W, srcW - GRID_ARTBOARD_MARGIN * 2);
          var usableH = Math.max(GRID_MIN_CELL_H, srcH - GRID_ARTBOARD_MARGIN * 2);
          var cellsPerCol = Math.max(1, Math.floor(usableW / GRID_MIN_CELL_W));
          var cellsPerRow = Math.max(1, Math.floor(usableH / GRID_MIN_CELL_H));
          var cellsPerArtboard = cellsPerCol * cellsPerRow;
          // Cell stride = usable area ÷ cells. Each cell's chart is
          // padded inward by GRID_CELL_PAD on each side. Charts never
          // touch the artboard edges (margin) or each other (cell pad).
          var cellW = Math.floor(usableW / cellsPerCol);
          var cellH = Math.floor(usableH / cellsPerRow);
          var pagesNeeded = Math.ceil(batchSize / cellsPerArtboard);
          batchLog("grid layout: " + cellsPerCol + "×" + cellsPerRow +
                   " cells per artboard (" + cellsPerArtboard + " charts/page), " +
                   pagesNeeded + " page(s) for " + batchSize + " charts; " +
                   "margin=" + GRID_ARTBOARD_MARGIN + "pt, " +
                   "cellSize=" + cellW + "×" + cellH + "pt");

          // Stash grid-mode state on a closure-shared object so placeOne
          // can read it. Position is tracked incrementally — span=1
          // charts advance the cursor by 1 column, span=2 (table /
          // timeline) by 2. Wraps to next row when a chart wouldn't
          // fit, wraps to next page when no rows are left.
          gridLayout = {
            cellsPerCol: cellsPerCol,
            cellsPerRow: cellsPerRow,
            cellsPerArtboard: cellsPerArtboard,  // approximate (varies with span mix)
            cellW: cellW,
            cellH: cellH,
            srcW: srcW,
            srcH: srcH,
            // Position cursor — advanced after each successful placement.
            // (-1 page idx forces a new-page creation on the first chart.)
            currentPageIdx: -1,
            currentPageArtboardIdx: -1,
            currentRow: 0,
            currentCol: 0
          };
          placeOne(0);
          return;
        }

        // Single-mode (default): one chart per new artboard.
        var rows = Math.ceil(batchSize / maxCols);
        batchLog("layout: " + Math.min(maxCols, batchSize) + " cols × " + rows + " rows");

        // Step 4 — sequential placement loop. Each iteration computes
        // its own (row, col) from slotIdx using the probed maxCols.
        placeOne(0);
      });

      // The placement loop. Recursive instead of for-loop because each
      // evalScript callback must complete before the next chart starts
      // (otherwise ExtendScript races and the artboard order gets
      // shuffled). Branches at the top on the layout mode chosen by
      // the user — single (one per artboard) and grid (many per
      // artboard) take fundamentally different code paths from here on.
      function placeOne(slotIdx) {
        if (gridLayout) return placeOneGrid(slotIdx);
        return placeOneSingle(slotIdx);
      }

      // Single-artboard-per-chart loop (the original behaviour).
      function placeOneSingle(slotIdx) {
        if (slotIdx >= batchSize) {
          // ── All charts processed. Wrap up. ──────────────────
          // Jump to the first new artboard so the user lands on chart 1.
          updateBatchProgress(batchSize, batchSize, "Finishing…");
          var jumpScript = (firstNewArtboardIdx != null)
            ? ('setActiveArtboardByIndex(' + firstNewArtboardIdx + ')')
            : null;
          var finalize = function () {
            // Restore DataStore + UI to pre-batch state.
            try { DataStore.loadFromConfig(snapshot); } catch (e) { /* best effort */ }
            try { syncUIFromStore(); } catch (e) { /* best effort */ }
            try { DataGrid.render(gridContainer); } catch (e) { /* best effort */ }
            try { generateSVG(); } catch (e) { /* best effort */ }
            hideBatchProgress();
            if (onDone) onDone({
              ok: true,
              count: placedCount,
              skipped: skippedCount,
              total: batchSize
            });
          };
          if (jumpScript) {
            csInterface.evalScript(jumpScript, finalize);
          } else {
            finalize();
          }
          return;
        }

        // ── Per-chart step ─────────────────────────────────────
        // Convert linear slotIdx → (rowIdx, colIdx) using the probed
        // maxCols. Layout fills row 0 left-to-right, then row 1, etc.
        var rowIdx = Math.floor(slotIdx / maxCols);
        var colIdx = slotIdx % maxCols;
        var configJson = configsArray[slotIdx];

        // Load this chart into DataStore. The renderer reads from the
        // store; this is the ONLY mutation we're making to user state
        // until restore at the end.
        var loadResult;
        try {
          loadResult = DataStore.loadFromConfig(configJson);
        } catch (e) {
          return pauseOrAbort("Chart " + (slotIdx + 1) + " couldn't be loaded: " + e.message, slotIdx, configJson);
        }
        if (loadResult && loadResult.error) {
          return pauseOrAbort("Chart " + (slotIdx + 1) + " rejected: " + loadResult.error, slotIdx, configJson);
        }

        var chartLabel = (DataStore.chartTitle && DataStore.chartTitle.trim()) || ("Chart " + (slotIdx + 1));
        // Show progress for the chart we're about to render. We update
        // BEFORE the work so if anything throws, the user can see
        // exactly which chart caused it.
        updateBatchProgress(slotIdx, batchSize, "Rendering: " + chartLabel);

        // Render directly via ChartBuilder — we deliberately skip
        // generateSVG() here because that function calls syncStoreFromUI
        // first, which would overwrite our just-loaded data with stale
        // values from the still-unrefreshed panel inputs.
        var svg;
        try {
          svg = ChartBuilder.render();
        } catch (e) {
          return pauseOrAbort("Chart " + (slotIdx + 1) + " (\"" + chartLabel +
            "\") couldn't be rendered: " + e.message, slotIdx, configJson);
        }
        if (!svg) {
          return pauseOrAbort("Chart " + (slotIdx + 1) + " (\"" + chartLabel +
            "\") produced no SVG. The data may be invalid for this chart type — " +
            "open it on its own to see the specific error.", slotIdx, configJson);
        }

        // Write to a unique temp file per slot. Unique names are belt-
        // and-braces against any caching weirdness on the Illustrator
        // side that might re-read a stale file by path.
        var tmpFile;
        try {
          tmpFile = csInterface.writeTempFile("ocha_dataviz_batch_" + slotIdx + ".svg", svg);
        } catch (e) {
          // Disk write failures (out of disk space, permission denied,
          // /tmp unavailable) are NOT AI-fixable — pass null so the
          // pause modal hides the "Copy fix prompt" button.
          return pauseOrAbort("Couldn't write chart " + (slotIdx + 1) + " to disk: " + e.message, slotIdx, null);
        }

        updateBatchProgress(slotIdx, batchSize, "Placing: " + chartLabel);

        // Build the evalScript call. DataStore.toConfig() has just been
        // refreshed by loadFromConfig above, so it reflects this chart's
        // exact serialised state — that's what goes into the new
        // group's .note for round-trip editing.
        var perChartConfig = DataStore.toConfig();
        var safePath = tmpFile.replace(/\\/g, "/");
        var safeConfig = perChartConfig.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var safeName = (DataStore.chartTitle || ("Chart " + (slotIdx + 1)))
          .replace(/\\/g, "\\\\").replace(/"/g, '\\"');

        var script =
          'placeChartOnNewArtboard("' + safePath + '","' + safeConfig + '","' +
          safeName + '",' + sourceIdx + ',' + rowIdx + ',' + colIdx + ')';

        // Per-chart watchdog. The slotDone flag protects against the
        // (rare) race where the timeout AND the evalScript callback both
        // fire — without it we'd advance the loop twice for the same slot.
        var slotDone = false;
        var watchdog = setTimeout(function () {
          if (slotDone) return;
          slotDone = true;
          // Timeouts are typically host-side issues (Illustrator dialog,
          // silent script failure) — not AI-fixable. Pause for user
          // choice without offering a fix prompt.
          pauseOrAbort(
            "Chart " + (slotIdx + 1) + " (\"" + chartLabel + "\") timed out after " +
            (PER_CHART_TIMEOUT_MS / 1000) + " seconds. Illustrator may be busy " +
            "with a dialog, or the script silently failed. Try closing any " +
            "open dialogs and running the batch again.",
            slotIdx,
            null
          );
        }, PER_CHART_TIMEOUT_MS);

        csInterface.evalScript(script, function (rawResult) {
          if (slotDone) return;  // watchdog already fired
          slotDone = true;
          clearTimeout(watchdog);

          var parsed;
          try {
            parsed = JSON.parse(rawResult || '{"error":"empty response from Illustrator (the placement script may have failed silently)"}');
          } catch (e) {
            parsed = { error: rawResult || e.message };
          }
          if (parsed.error) {
            // Host-side errors (canvas overflow, no document, etc.) are
            // typically NOT AI-fixable — pass null for the fix prompt
            // so the modal hides the "Copy fix prompt" button.
            return pauseOrAbort("Chart " + (slotIdx + 1) + " (\"" + chartLabel +
              "\") placement failed: " + parsed.error, slotIdx, null);
          }
          placedCount++;
          if (firstNewArtboardIdx == null && typeof parsed.artboardIndex === "number") {
            firstNewArtboardIdx = parsed.artboardIndex;
          }
          updateBatchProgress(slotIdx + 1, batchSize, "Placed: " + chartLabel);
          // Move on to the next chart. Recursive — the call stack is
          // bounded by batchSize (max 10), well under any limit.
          placeOne(slotIdx + 1);
        });
      }

      // Grid-mode placement loop. Each chart sits in a cell on a shared
      // artboard. Cells are tracked incrementally so charts of different
      // spans (1 cell for normal, 2 cells for tables/timelines) lay out
      // correctly. New artboards are created only when the current page
      // can't fit the next chart. This is the "save time, less precise"
      // mode — overlap into adjacent cells is allowed.
      function placeOneGrid(slotIdx) {
        if (slotIdx >= batchSize) {
          // All charts processed — same wrap-up path as single mode.
          updateBatchProgress(batchSize, batchSize, "Finishing…");
          var jumpScript = (firstNewArtboardIdx != null)
            ? ('setActiveArtboardByIndex(' + firstNewArtboardIdx + ')')
            : null;
          var finalize = function () {
            try { DataStore.loadFromConfig(snapshot); } catch (e) { /* best effort */ }
            try { syncUIFromStore(); } catch (e) { /* best effort */ }
            try { DataGrid.render(gridContainer); } catch (e) { /* best effort */ }
            try { generateSVG(); } catch (e) { /* best effort */ }
            hideBatchProgress();
            if (onDone) onDone({
              ok: true,
              count: placedCount,
              skipped: skippedCount,
              total: batchSize,
              layoutMode: "grid"
            });
          };
          if (jumpScript) {
            csInterface.evalScript(jumpScript, finalize);
          } else {
            finalize();
          }
          return;
        }

        var configJson = configsArray[slotIdx];

        // Determine the chart's cell span (1 = normal, 2 = wide).
        // Read chartType from the JSON before loading into DataStore so
        // we know how many cells to reserve before render.
        var chartType = "hbar";
        try { chartType = JSON.parse(configJson).chartType || "hbar"; } catch (eP) { /* ignore */ }
        var span = WIDE_CHART_TYPES[chartType] ? 2 : 1;
        // If the chart is wider than the page can fit, fall back to
        // span=1 (the chart will look cramped but at least places).
        if (span > gridLayout.cellsPerCol) span = gridLayout.cellsPerCol;

        // ── Position resolution ───────────────────────────────
        // If the requested span doesn't fit on the current row, wrap
        // to the next row. If no rows are left on the current page,
        // wrap to a new page artboard.
        var needsRowWrap = (gridLayout.currentCol + span > gridLayout.cellsPerCol);
        if (needsRowWrap) {
          gridLayout.currentCol = 0;
          gridLayout.currentRow++;
        }
        var needsNewPage = (gridLayout.currentRow >= gridLayout.cellsPerRow) ||
                           (gridLayout.currentPageArtboardIdx === -1);
        if (needsNewPage) {
          gridLayout.currentRow = 0;
          gridLayout.currentCol = 0;
          gridLayout.currentPageIdx++;
        }

        var loadOk;
        try {
          loadOk = DataStore.loadFromConfig(configJson);
        } catch (e) {
          return pauseOrAbort("Chart " + (slotIdx + 1) + " couldn't be loaded: " + e.message, slotIdx, configJson);
        }
        if (loadOk && loadOk.error) {
          return pauseOrAbort("Chart " + (slotIdx + 1) + " rejected: " + loadOk.error, slotIdx, configJson);
        }

        var chartLabel = (DataStore.chartTitle && DataStore.chartTitle.trim()) || ("Chart " + (slotIdx + 1));
        updateBatchProgress(slotIdx, batchSize, "Rendering: " + chartLabel +
          (span > 1 ? " (wide)" : ""));

        // Override chartWidth/Height to the cell size (× span). The
        // renderer reads these from DataStore. Cache the original
        // values so we can restore them in the .note for round-trip.
        var origChartW = DataStore.chartWidth;
        var origChartH = DataStore.chartHeight;
        var spanCellW = gridLayout.cellW * span;          // total stride for span cells
        var renderW = spanCellW - GRID_CELL_PAD * 2;
        var renderH = gridLayout.cellH - GRID_CELL_PAD * 2;
        DataStore.chartWidth = renderW;
        DataStore.chartHeight = renderH;

        var svg;
        try {
          svg = ChartBuilder.render();
        } catch (eRender) {
          DataStore.chartWidth = origChartW;
          DataStore.chartHeight = origChartH;
          return pauseOrAbort("Chart " + (slotIdx + 1) + " (\"" + chartLabel +
            "\") couldn't be rendered: " + eRender.message, slotIdx, configJson);
        }
        // Restore canonical sizes before serializing the .note (so
        // click-to-edit re-opens at the user's original sizes, not
        // the grid cell size).
        DataStore.chartWidth = origChartW;
        DataStore.chartHeight = origChartH;
        if (!svg) {
          return pauseOrAbort("Chart " + (slotIdx + 1) + " (\"" + chartLabel +
            "\") produced no SVG. The data may be invalid for this chart type — " +
            "open it on its own to see the specific error.", slotIdx, configJson);
        }

        var tmpFile;
        try {
          tmpFile = csInterface.writeTempFile("ocha_dataviz_grid_" + slotIdx + ".svg", svg);
        } catch (eW) {
          return pauseOrAbort("Couldn't write chart " + (slotIdx + 1) + " to disk: " + eW.message, slotIdx, null);
        }

        var perChartConfig = DataStore.toConfig();
        var safePath = tmpFile.replace(/\\/g, "/");
        var safeConfig = perChartConfig.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var safeName = chartLabel.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

        // Capture the position now — placement happens after a couple
        // of evalScript hops. The position cursor advances ONLY after
        // a successful placement (so user-skipped charts don't leave
        // gaps that desynchronize the next chart's layout).
        var thisRow = gridLayout.currentRow;
        var thisCol = gridLayout.currentCol;
        var thisSpan = span;

        function placeIntoCell() {
          updateBatchProgress(slotIdx, batchSize, "Placing: " + chartLabel +
            (thisSpan > 1 ? " (wide)" : ""));

          var slotDone = false;
          var watchdog = setTimeout(function () {
            if (slotDone) return;
            slotDone = true;
            pauseOrAbort(
              "Chart " + (slotIdx + 1) + " (\"" + chartLabel + "\") timed out after 15 seconds.",
              slotIdx, null
            );
          }, 15000);

          // Get the active page artboard's rect, then compute cell
          // position in document coordinates and place.
          csInterface.evalScript("getArtboardRectByIndex(" + gridLayout.currentPageArtboardIdx + ")",
            function (rectRaw) {
              if (slotDone) return;
              var rect;
              try { rect = JSON.parse(rectRaw || '{"error":"empty"}'); } catch (e) { rect = { error: rectRaw }; }
              if (rect.error) {
                slotDone = true;
                clearTimeout(watchdog);
                return pauseOrAbort("Couldn't read artboard bounds for chart " + (slotIdx + 1) + ": " + rect.error, slotIdx, null);
              }
              // Cell origin = artboard origin + outer margin + cell stride
              // + inner cell padding. The margin keeps charts from
              // touching the artboard edges (OCHA's 1 cm minimum margin
              // best-practice).
              var cellLeft = rect.left + GRID_ARTBOARD_MARGIN + thisCol * gridLayout.cellW + GRID_CELL_PAD;
              var cellTop  = rect.top  - GRID_ARTBOARD_MARGIN - thisRow * gridLayout.cellH - GRID_CELL_PAD;
              var script =
                'placeChartAtCell("' + safePath + '","' + safeConfig + '","' +
                safeName + '",' + cellLeft + ',' + cellTop + ')';
              csInterface.evalScript(script, function (raw) {
                if (slotDone) return;
                slotDone = true;
                clearTimeout(watchdog);
                var parsed;
                try { parsed = JSON.parse(raw || '{"error":"empty"}'); } catch (e) { parsed = { error: raw }; }
                if (parsed.error) {
                  return pauseOrAbort("Chart " + (slotIdx + 1) + " (\"" + chartLabel +
                    "\") placement failed: " + parsed.error, slotIdx, null);
                }
                placedCount++;
                // Advance the cursor by the actual span used.
                gridLayout.currentCol += thisSpan;
                updateBatchProgress(slotIdx + 1, batchSize, "Placed: " + chartLabel);
                placeOne(slotIdx + 1);
              });
            });
        }

        if (needsNewPage) {
          // Create a new page artboard for this batch of cells. Use the
          // same canvas-wrap pattern as single-mode artboards (right of
          // source, wrap rows when canvas runs out).
          var pageRow = Math.floor(gridLayout.currentPageIdx / maxCols);
          var pageCol = gridLayout.currentPageIdx % maxCols;
          updateBatchProgress(slotIdx, batchSize, "Creating page " + (gridLayout.currentPageIdx + 1) + "…");
          var pageScript =
            'addEmptyBatchArtboard("Charts page ' + (gridLayout.currentPageIdx + 1) + '",' +
            sourceIdx + ',' + pageRow + ',' + pageCol + ')';
          csInterface.evalScript(pageScript, function (raw) {
            var parsed;
            try { parsed = JSON.parse(raw || '{"error":"empty"}'); } catch (e) { parsed = { error: raw }; }
            if (parsed.error) {
              return pauseOrAbort("Couldn't create grid page " + (gridLayout.currentPageIdx + 1) + ": " + parsed.error, slotIdx, null);
            }
            gridLayout.currentPageArtboardIdx = parsed.artboardIndex;
            if (firstNewArtboardIdx == null) firstNewArtboardIdx = parsed.artboardIndex;
            placeIntoCell();
          });
        } else {
          placeIntoCell();
        }
      }

      // pauseOrAbort — show the user a "Skip and continue / Stop batch"
      // dialog when a single chart fails. Replaces the old immediate
      // abortBatch behaviour for in-loop errors. Continue increments
      // skippedCount and recurses to the next slot; Stop calls
      // abortBatch as before (full rollback).
      //
      // configJsonForFix:
      //   * truthy  → AI-fixable error (chart's data invalid for its
      //               type, render error etc.) — surface the "Copy fix
      //               prompt" button with the chart JSON embedded so
      //               the user can paste back to Copilot.
      //   * null    → NON-AI-fixable error (canvas overflow, no
      //               document open, host timeout, disk write fail,
      //               etc.) — hide the button entirely. Pasting a JSON
      //               into Copilot wouldn't help because the failure
      //               isn't about the data.
      function pauseOrAbort(message, failedSlot, configJsonForFix) {
        batchLog("pauseOrAbort at slot " + failedSlot + ": " + message);
        var fixPrompt = configJsonForFix
          ? buildBatchFixPrompt(failedSlot, message, configJsonForFix)
          : null;
        showBatchPauseModal({
          message: message,
          slotIdx: failedSlot,
          total: batchSize,
          fixPrompt: fixPrompt,
          onContinue: function () {
            skippedCount++;
            placeOne(failedSlot + 1);
          },
          onStop: function () {
            abortBatch(message, failedSlot);
          }
        });
      }

      function abortBatch(message, failedSlot) {
        // Try to restore the user's pre-batch state so the panel doesn't
        // look like it lost their work.
        try { DataStore.loadFromConfig(snapshot); } catch (e) { /* ignore */ }
        try { syncUIFromStore(); } catch (e) { /* ignore */ }
        try { DataGrid.render(gridContainer); } catch (e) { /* ignore */ }
        try { generateSVG(); } catch (e) { /* ignore */ }
        hideBatchProgress();
        if (onDone) {
          onDone({
            ok: false,
            error: message,
            failedAt: failedSlot,
            placedCount: placedCount
          });
        }
      }

      // Loop is kicked off inside the probe callback above (after maxCols
      // is known). Don't start it here.
    });
  }

  // ── Edit Mode ──────────────────────────────────────────

  function enterEditMode() {
    // Only auto-switch to the Design tab on FIRST entry into edit mode
    // — i.e. when the user actually clicks a chart in Illustrator and
    // transitions from no-selection to selected. Subsequent poll ticks
    // (or re-selections of the same chart) should NOT steal the user's
    // active tab: if they're typing in Text or browsing Data, leave
    // them alone.
    var wasEditing = editMode;
    editMode = true;
    // Don't close Map Maker — user may want to place a map on top of an existing chart
    var mmVisible = mmPanelEl && mmPanelEl.style.display === "flex";
    if (!mmVisible && !wasEditing) {
      PanelCoordinator.closeAllPanels();
    }

    var bannerText = document.getElementById("edit-banner-text");
    if (bannerText) bannerText.textContent = "Editing selected chart";
    editBanner.classList.add("visible");
    if (!mmVisible && !wasEditing) PanelCoordinator.setActiveTab("design");
    // Keep place button visible — it works for both charts and maps
  }

  function exitEditMode(clearData) {
    editMode = false;
    editConfigHash = "";
    editingIsMap = false;
    // Resize watcher: baseline belongs to the chart we were editing.
    clearResizeNotice();
    placedSizeExpected = null;
    lastAdoptedSize = null;
    prevBoundsReading = null;
    adoptCooldownUntil = 0;
    editBanner.classList.remove("visible");
    btnPlace.style.display = "block";
    // Genuine deselect (no chart selected in Illustrator) → reset the panel
    // to a blank state so the next chart starts fresh. This runs ONLY from
    // the selection poll and ONLY when we were editing a chart, so it never
    // wipes a NEW chart you're building with nothing selected (editMode is
    // false then). Skipped on transient poll errors (clearData=false) so a
    // hiccup can't discard your work.
    if (clearData) {
      DataStore.clear();
      syncUIFromStore();
    }
  }

  // ── Column Selectors ──────────────────────────────────

  function updateColumnSelectors() {
    var type = DataStore.chartType || "hbar";

    // Table, Sankey, Key Figures, Timeline: hide column selectors (fixed columns)
    if (type === "table" || type === "sankey" || type === "keyfigures" || type === "timeline") {
      colSelectorSection.style.display = "none";
      return;
    }

    if (!DataStore.headers || DataStore.headers.length <= 2) {
      colSelectorSection.style.display = "none";
      return;
    }
    colSelectorSection.style.display = "block";

    // Hide value dropdown for stacked types (they use checkboxes instead)
    var valueWrap = colSelectorSection.querySelector(".col-value-wrap");
    if (valueWrap) {
      if (MULTI_VALUE_TYPES[type]) {
        valueWrap.classList.add("hidden");
      } else {
        valueWrap.classList.remove("hidden");
      }
    }

    // Rebuild <option> lists
    selLabelCol.innerHTML = "";
    selValueCol.innerHTML = "";
    for (var i = 0; i < DataStore.headers.length; i++) {
      var opt1 = document.createElement("option");
      opt1.value = i;
      opt1.textContent = DataStore.headers[i];
      selLabelCol.appendChild(opt1);

      var opt2 = document.createElement("option");
      opt2.value = i;
      opt2.textContent = DataStore.headers[i];
      selValueCol.appendChild(opt2);
    }
    selLabelCol.value = DataStore.labelCol;
    selValueCol.value = DataStore.valueCol;
  }

  function updateMultiColVisibility() {
    var type = DataStore.chartType || "hbar";
    if (MULTI_VALUE_TYPES[type] && DataStore.headers && DataStore.headers.length > 2) {
      multiColSection.style.display = "block";
      buildMultiColCheckboxes();
    } else {
      multiColSection.style.display = "none";
    }
  }

  function buildMultiColCheckboxes() {
    multiColList.innerHTML = "";
    // Default: all non-label columns checked when valueCols is null
    var allNonLabel = [];
    for (var k = 0; k < DataStore.headers.length; k++) {
      if (k !== DataStore.labelCol) allNonLabel.push(k);
    }
    var currentCols = DataStore.valueCols || allNonLabel;
    // Persist the default so chart renderers get the full set
    if (!DataStore.valueCols && allNonLabel.length > 0) {
      DataStore.setValueCols(allNonLabel);
    }
    for (var i = 0; i < DataStore.headers.length; i++) {
      if (i === DataStore.labelCol) continue; // skip label column

      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = i;
      cb.checked = currentCols.indexOf(i) !== -1;

      cb.addEventListener("change", function () {
        var checked = [];
        var cbs = multiColList.querySelectorAll("input[type=checkbox]:checked");
        for (var j = 0; j < cbs.length; j++) {
          checked.push(parseInt(cbs[j].value, 10));
        }
        DataStore.setValueCols(checked);
        if (DataStore.hasData()) {
          generateSVG();
          scheduleLiveUpdate();
        }
      });

      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + DataStore.headers[i]));
      multiColList.appendChild(label);
    }
  }

  // ── Header chart icon visibility ───────────────────────
  var headerChartIcon = document.getElementById("header-chart-icon");
  var mmPanelEl = document.getElementById("mapmaker-panel");

  function updateHeaderChartIconVisibility() {
    if (!headerChartIcon) return;
    if (DataStore.hasData() && DataStore.chartType) {
      headerChartIcon.classList.add("visible");
    } else {
      headerChartIcon.classList.remove("visible");
    }
  }

  // ── DataStore onChange → re-render grid ────────────────

  DataStore.onChange = function () {
    DataGrid.render(gridContainer);
    updateColumnSelectors();
    updateMultiColVisibility();
    updateHeaderChartIconVisibility();
    IconFlagUI.renderRowList();
    // Timeline per-row icon list must refresh when rows change
    if ((DataStore.chartType || "") === "timeline") {
      TimelineUI.buildIconRows();
    }

    // Skip the chart re-render during config load — the UI controls
    // haven't been updated yet, so generateSVG would call
    // syncStoreFromUI and clobber the freshly loaded settings with
    // stale UI defaults. panel.js's loadFromConfig caller runs
    // syncUIFromStore and generateSVG itself afterwards.
    if (DataStore._loading) return;
    // Regenerate chart (e.g. after row reorder)
    if (DataStore.hasData()) {
      generateSVG();
      scheduleLiveUpdate();
    } else {
      lastSVG = null;
    }
  };

  // ── DataStore onValueChange → chart-only update ────────
  // Called when a cell is edited (blur). No grid re-render.

  var cellUpdateTimer = null;
  DataStore.onValueChange = function () {
    if (cellUpdateTimer) clearTimeout(cellUpdateTimer);
    cellUpdateTimer = setTimeout(function () {
      if (DataStore.hasData()) {
        generateSVG();
        scheduleLiveUpdate();
      }
    }, 400);
  };

  // ── Text Field Sync ────────────────────────────────────

  titleInput.addEventListener("input", function () {
    DataStore.chartTitle = titleInput.value.trim();
  });

  subtitleInput.addEventListener("input", function () {
    DataStore.chartSubtitle = subtitleInput.value.trim();
  });

  commentsInput.addEventListener("input", function () {
    DataStore.chartComments = commentsInput.value.trim();
  });

  footerInput.addEventListener("input", function () {
    DataStore.chartFooter = footerInput.value.trim();
  });

  // Debounced live update for text changes
  var textUpdateTimer = null;
  function onTextFieldChange() {
    if (textUpdateTimer) clearTimeout(textUpdateTimer);
    textUpdateTimer = setTimeout(function () {
      if (DataStore.hasData()) {
        generateSVG();
        scheduleLiveUpdate();
      }
    }, 1000);
  }

  titleInput.addEventListener("input", onTextFieldChange);
  subtitleInput.addEventListener("input", onTextFieldChange);
  commentsInput.addEventListener("input", onTextFieldChange);
  footerInput.addEventListener("input", onTextFieldChange);

  // ── Upload File ───────────────────────────────────────

  btnUploadFile.addEventListener("click", function () {
    clearStatus();
    showStatus("Opening file dialog…", "info");
    DataInput.openFileDialog(function (result) {
      clearStatus();
      if (result.error) {
        showStatus(result.error, "error");
        setTimeout(clearStatus, 7000);
        return;
      }
      DataGrid.pushUndo();
      syncUIFromStore();
      var msg = result.rowCount + " rows loaded";
      if (result.fileName) msg += " from " + result.fileName;
      if (result.sheetName) msg += " (sheet: " + result.sheetName + ")";
      if (result.truncated) msg += " (truncated to 5,000)";
      showStatus(msg + ".", result.truncated ? "info" : "success");
      generateSVG();
      setTimeout(clearStatus, 7000);
    });
  });

  // ── Chart configuration: copy / save / load JSON ────
  //
  // The config produced by DataStore.toConfig() is the same JSON
  // that's already stored on the artboard for round-tripping. Exposing
  // it as a user-visible action makes it easy to:
  //   - share a chart with another user
  //   - debug an unexpected layout (paste the JSON to a colleague)
  //   - hand the JSON to the future online tool to recreate the chart
  //
  // Saved files use a .json extension and pretty-printed (2-space)
  // formatting so they're human-readable and diff-friendly.

  // Fields every chart needs regardless of type — data, header text,
  // canvas size, style, number formatting, the user's vertical
  // padding slider, etc. These always end up in the exported JSON.
  var CONFIG_UNIVERSAL = [
    "v", "chartType",
    "chartTitle", "chartSubtitle", "chartComments", "chartFooter",
    "headers", "rows", "labelCol", "valueCol", "valueCols",
    "chartWidth", "chartHeight",
    "verticalPadding", "style", "shade",
    "numberFormat", "valuePrefix", "valueSuffix",
    "autoSort", "sortCol", "sortDir",
    "textScale", "labelScale",
    "headerTextWidth", "footerTextWidth",
    "colors", "labelColor",
    "iconColType", "iconSelections", "rowIconColor"
  ];

  // Per-chart-type fields. The exported JSON includes these only
  // when chartType matches — donut tweaks don't show up in a
  // timeline export, etc. Keeps the snapshot focused on what's
  // actually rendering.
  var CONFIG_BY_TYPE = {
    "hbar":          ["barThickness", "barSpacing", "barLabelMode", "axisMax", "hideZeroLabels"],
    "vbar":          ["barThickness", "barSpacing", "barLabelMode", "axisMax", "hideZeroLabels"],
    "stacked-bar":   ["barThickness", "barSpacing", "barLabelMode", "stackedStroke", "stackedStrokeWidth", "stackedStrokeColor", "stackedLegend", "axisMax", "hideZeroLabels"],
    "stacked-col":   ["barThickness", "barSpacing", "barLabelMode", "stackedStroke", "stackedStrokeWidth", "stackedStrokeColor", "stackedLegend", "axisMax", "hideZeroLabels"],
    "cluster":       ["barThickness", "barSpacing", "barLabelMode", "clusterOrientation", "stackedLegend", "axisMax", "hideZeroLabels"],
    "cluster-donut": ["donutHole", "donutCenterAuto", "clusterDonutLegend", "clusterDonutCategoryColors", "pieLabelMode", "pieLabelContent", "pieLeaderLines", "pieLabelDistance"],
    "line":          ["lineShowDots", "lineDotSize", "lineLabelPos", "lineLabelBg"],
    "donut":         ["donutCenterTitle", "donutCenterLabel", "donutCenterAuto", "donutHole", "pieLabelMode", "pieLabelContent", "pieLeaderLines", "pieLabelDistance", "pieLegend", "sliceColors"],
    "pie":           ["pieLabelMode", "pieLabelContent", "pieLeaderLines", "pieLabelDistance", "pieLegend", "sliceColors"],
    "bubble":        ["bubbleOrientation", "bubbleSeparation"],
    "timeline":      ["timelineOrientation", "timelineEventSpacing", "timelineCategoryColors", "timelineLegend", "timelineCompactArcs", "timelineRowGap"],
    "icon":          ["iconShape", "iconShapes", "iconSize", "iconLegendLabels", "iconColors", "iconShowLegend", "iconLegendLayout"],
    "sankey":        ["sankeyNodeWidth", "sankeyNodePadding", "sankeyLinkOpacity", "sankeyLabelMode", "sankeyColorMode", "sankeySingleColor"],
    "keyfigures":    ["bodyCol", "kfAutoCols", "kfMaxCols", "kfAutoWidth", "kfColWidth", "kfIconPosition", "kfShowSeparators", "kfPadH", "kfPadV", "kfGap", "kfIconColor", "kfTextColor"],
    "table":         []
  };

  // Build a filtered config object containing only the fields that
  // matter for the current chart type. The full DataStore.toConfig()
  // is used as the source of truth; we just drop irrelevant keys.
  //
  // toConfig() returns a JSON STRING (not an object) because the
  // artboard-storage path expects a serialised payload — so we
  // parse it here before filtering. Forgetting that step is exactly
  // why the export was producing "{}" before this fix.
  function buildExportConfig() {
    var raw = DataStore.toConfig();
    var full = {};
    try { full = (typeof raw === "string") ? JSON.parse(raw) : (raw || {}); }
    catch (e) { full = {}; }
    var type = full.chartType || "hbar";
    var keep = CONFIG_UNIVERSAL.concat(CONFIG_BY_TYPE[type] || []);
    var keepSet = {};
    for (var i = 0; i < keep.length; i++) keepSet[keep[i]] = true;
    var clean = {};
    for (var k in full) {
      if (full.hasOwnProperty(k) && keepSet[k] && full[k] !== undefined) {
        clean[k] = full[k];
      }
    }
    return clean;
  }

  function buildConfigJsonString() {
    return JSON.stringify(buildExportConfig(), null, 2);
  }

  function safeChartFilename() {
    // Filename pattern: <chart title>.humanitariandataviz.json
    // The "humanitariandataviz" suffix flags the file's origin and
    // keeps it grouped in a downloads folder; the chart title makes
    // each export distinguishable. Falls back to a generic name when
    // the chart has no title yet.
    var rawTitle = (DataStore.chartTitle || "").toString().trim();
    // Strip path-unfriendly chars; cap length so it stays sensible.
    var clean = rawTitle.replace(/[\/\\:*?"<>|]+/g, "-").trim();
    if (!clean) clean = "chart";
    if (clean.length > 60) clean = clean.substring(0, 60).trim();
    return clean + ".humanitariandataviz.json";
  }

  var btnCopyConfig = document.getElementById("btn-copy-config");
  var btnSaveConfig = document.getElementById("btn-save-config");
  var btnLoadConfig = document.getElementById("btn-load-config");

  if (btnCopyConfig) {
    btnCopyConfig.addEventListener("click", function () {
      clearStatus();
      var json = buildConfigJsonString();

      // CEP context note: navigator.clipboard.writeText() typically
      // returns "permissions denied" inside an extension panel because
      // the document isn't a "secure context" by Chromium's reckoning.
      // The textarea + execCommand("copy") pattern works reliably
      // because it operates on the user's current selection from a
      // user-initiated event, which CEP allows. So that's primary;
      // navigator.clipboard is only the fallback for non-CEP runs.
      var copied = false;
      try {
        // Off-screen textarea trick. Important details for CEP:
        //   - position:fixed at (0,0) — visible to the layout engine
        //     so .select() works; opacity 0 hides it from the user.
        //   - width/height > 0 so the browser actually renders it
        //     (off-screen at -9999px sometimes gets culled in CEP).
        //   - contentEditable=false + readonly so the focus doesn't
        //     show a caret cursor flicker.
        //   - Restore previously focused element afterward.
        var prevFocus = document.activeElement;
        var ta = document.createElement("textarea");
        ta.value = json;
        ta.setAttribute("readonly", "");
        ta.style.cssText = [
          "position:fixed",
          "left:0",
          "top:0",
          "width:1px",
          "height:1px",
          "padding:0",
          "border:0",
          "outline:0",
          "opacity:0",
          "pointer-events:none",
          "z-index:-1"
        ].join(";");
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, json.length);
        copied = document.execCommand("copy");
        document.body.removeChild(ta);
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e2) {} }
      } catch (e) {
        copied = false;
      }

      if (copied) {
        showStatus("Chart configuration copied to clipboard (" + json.length + " chars).", "success");
        setTimeout(clearStatus, 5000);
        return;
      }

      // Last-resort: try navigator.clipboard.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(function () {
          showStatus("Chart configuration copied to clipboard (" + json.length + " chars).", "success");
          setTimeout(clearStatus, 5000);
        }).catch(function () {
          showStatus("Couldn't copy. Use Save… to write the JSON to a file instead.", "error");
          setTimeout(clearStatus, 9000);
        });
      } else {
        showStatus("Couldn't copy. Use Save… to write the JSON to a file instead.", "error");
        setTimeout(clearStatus, 9000);
      }
    });
  }

  if (btnSaveConfig) {
    btnSaveConfig.addEventListener("click", function () {
      clearStatus();
      var json = buildConfigJsonString();
      var filename = safeChartFilename();
      // Native save dialog in Illustrator; a browser download on the web.
      Connector.files.saveText({
        title: "Save chart configuration",
        extensions: ["json"],
        defaultName: filename,
        mime: "application/json",
        text: json
      }, function (err, res) {
        if (err) {
          showStatus("Couldn't save: " + err.message, "error");
          setTimeout(clearStatus, 7000);
          return;
        }
        if (!res) return;   // cancelled
        showStatus((res.method === "dialog" ? "Saved to " : "Downloaded ") + res.name + ".", "success");
        setTimeout(clearStatus, 7000);
      });
    });
  }

  // ── Load chart modal (paste JSON OR upload a file) ──────
  var loadModal       = document.getElementById("load-config-modal");
  var loadModalText   = document.getElementById("load-config-textarea");
  var loadModalUpload = document.getElementById("load-config-upload");
  var loadModalSubmit = document.getElementById("load-config-submit");
  var loadModalCancel = document.getElementById("load-config-cancel");
  var loadModalClose  = document.getElementById("load-config-close");
  var loadModalError  = document.getElementById("load-config-error");
  var loadModalErrorMsg = document.getElementById("load-config-error-msg");

  function showLoadError(msg) {
    if (loadModalError && loadModalErrorMsg) {
      loadModalErrorMsg.textContent = msg;
      loadModalError.style.display = "block";
    }
  }
  function clearLoadError() {
    if (loadModalError) loadModalError.style.display = "none";
  }
  function openLoadModal() {
    if (!loadModal) return;
    if (loadModalText) loadModalText.value = "";
    clearLoadError();
    loadModal.style.display = "flex";
    if (loadModalText) loadModalText.focus();
  }
  function closeLoadModal() {
    if (loadModal) loadModal.style.display = "none";
  }

  // Apply a JSON string as a chart config. Returns true on success.
  // Errors surface inline in the modal (so the user can fix the paste)
  // rather than the floating status bar.
  function applyConfigJson(jsonStr, label) {
    try {
      var ok = DataStore.loadFromConfig(jsonStr);
      // loadFromConfig answers { ok: true } or { error: "…" } — an object
      // either way, so test .error (a bare truthiness check took every
      // rejected paste for a success and said "Loaded chart").
      if (!ok || ok.error) throw new Error("That doesn't look like a chart configuration. Paste the JSON from another chart's Copy JSON / Save.");
      DataGrid.pushUndo();
      syncUIFromStore();
      updateChartOptions();
      generateSVG();
      closeLoadModal();
      showStatus("Loaded chart" + (label ? " from " + label : "") + ".", "success");
      setTimeout(clearStatus, 7000);
      return true;
    } catch (e) {
      showLoadError("Couldn't load: " + e.message);
      return false;
    }
  }

  // Upload-a-file path: the native dialog in Illustrator, the browser's
  // file picker on the web.
  function uploadConfigFile() {
    try {
      Connector.files.openText({ title: "Load chart configuration", extensions: ["json"] }, function (err, files) {
        if (err) { showLoadError("Couldn't open file: " + err.message); return; }
        if (!files || !files.length) return;   // cancelled
        var f = files[0];
        if (f.error) { showLoadError("Couldn't open file: " + f.error.message); return; }
        // Label as before: the last "/" segment of the native path.
        applyConfigJson(f.text, f.path ? f.path.split("/").pop() : f.name);
      });
    } catch (e) {
      showLoadError("Couldn't open file: " + e.message);
    }
  }

  if (btnLoadConfig) btnLoadConfig.addEventListener("click", function () { clearStatus(); openLoadModal(); });

  // A shell can hand over a chart to open (the web version does this for
  // "open a chart from a link"): same path as Load chart. If the JSON is
  // rejected, the Load window stays open showing it and the reason.
  document.addEventListener("ocha-load-config", function (e) {
    var d = e.detail || {};
    if (!d.json) return;
    clearStatus();
    openLoadModal();
    if (loadModalText) loadModalText.value = d.json;
    applyConfigJson(d.json, d.label || "");
  });
  if (loadModalUpload) loadModalUpload.addEventListener("click", uploadConfigFile);
  if (loadModalSubmit) loadModalSubmit.addEventListener("click", function () {
    var txt = loadModalText ? loadModalText.value.trim() : "";
    if (!txt) { showLoadError("Paste a chart's JSON, or use Upload."); return; }
    clearLoadError();
    applyConfigJson(txt, null);
  });
  if (loadModalCancel) loadModalCancel.addEventListener("click", closeLoadModal);
  if (loadModalClose) loadModalClose.addEventListener("click", closeLoadModal);
  if (loadModal) loadModal.addEventListener("click", function (e) { if (e.target === loadModal) closeLoadModal(); });
  if (loadModalText) loadModalText.addEventListener("input", clearLoadError);

  // ── Column Selector Events ──────────────────────────

  selLabelCol.addEventListener("change", function () {
    DataStore.setLabelCol(parseInt(selLabelCol.value, 10));
    if (DataStore.hasData()) {
      generateSVG();
      scheduleLiveUpdate();
    }
  });

  selValueCol.addEventListener("change", function () {
    DataStore.setValueCol(parseInt(selValueCol.value, 10));
    if (DataStore.hasData()) {
      generateSVG();
      scheduleLiveUpdate();
    }
  });

  // ── Width Slider ──────────────────────────────────────

  widthSlider.addEventListener("input", function () {
    var w = parseInt(widthSlider.value, 10);
    DataStore.chartWidth = w;
    widthDisplay.textContent = w + "px";
    bpDisplay.textContent = getBreakpoint(w);

    if (DataStore.hasData()) {
      generateSVG();
    }
  });

  widthSlider.addEventListener("change", function () {
    scheduleLiveUpdate();
  });

  // Height slider, bar thickness slider → DesignControlsUI

  // ── Live Update (edit mode) ──────────────────────────

  var liveUpdateTimer = null;

  function doLiveUpdate() {
    if (!editMode) return;
    if (!DataStore.hasData()) return;

    syncStoreFromUI();
    generateSVG();

    if (!lastSVG) return;

    var tmpFile;

    try {
      tmpFile = csInterface.writeTempFile("ocha_dataviz_temp.svg", lastSVG);
    } catch (e) {
      showStatus("Couldn't write the temporary SVG: " + e.message, "error");
      return;
    }

    var escapedPath = tmpFile.replace(/\\/g, "/");
    var configJSON = DataStore.toConfig();
    var escapedConfig = configJSON.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    // Identity guard: tell the host which chart this update is FOR (the
    // start of the config we loaded when editing began). If the user
    // clicked a different chart in the gap before the next selection poll,
    // the host refuses instead of converting that chart into this one.
    var expectedPrefix = editConfigHash || "";
    var escapedPrefix = expectedPrefix.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    var script = 'updateChart("' + escapedPath + '", "' + escapedConfig + '", "' + escapedPrefix + '")';

    liveUpdateInFlight = true;
    csInterface.evalScript(script, function (result) {
      if (result === "ok") {
        // This exact config string is now the chart's note — keep the hash
        // in step so (a) the next live update isn't rejected as stale and
        // (b) the next poll doesn't pointlessly reload what we just wrote.
        editConfigHash = configJSON.substring(0, 100);
        // Re-baseline the resize watcher by MEASURING the group we just
        // placed — never by assuming the render's canvas size. Illustrator
        // bounds include content that overhangs the canvas (labels, stroke
        // extents), so canvas-vs-bounds comparison has a permanent offset
        // that once fed an adopt→grow→re-render feedback loop (each cycle
        // adopted the overhang, widening the chart forever — crashed AI).
        // Measured-vs-measured is exactly stable. Stay "in flight" until
        // the measurement lands so the watcher can't read a stale state.
        csInterface.evalScript("getChartBounds()", function (res) {
          liveUpdateInFlight = false;
          try {
            var b = JSON.parse(res);
            placedSizeExpected = (b && b.chart) ? { w: b.width, h: b.height } : null;
          } catch (e) {
            placedSizeExpected = null;  // next poll re-baselines safely
          }
        });
        // Don't clobber a data/render warning with the success toast — the
        // warning is more important and was just set by surfaceChartWarnings.
        var sEl = document.getElementById("status");
        if (!(sEl && (sEl.className === "warn" || sEl.className === "data-warn"))) {
          showStatus("Chart updated.", "success");
          setTimeout(clearStatus, 8000);
        }
      } else if (result && result.indexOf("STALE") === 0) {
        // The selection moved to another chart before this update landed —
        // dropping it is the correct outcome (the next poll loads the newly
        // selected chart). No error toast: nothing went wrong for the user.
        liveUpdateInFlight = false;
      } else {
        liveUpdateInFlight = false;
        showStatus(result || "Couldn't update the chart.", "error");
      }
    });
  }

  function scheduleLiveUpdate() {
    if (liveUpdateTimer) clearTimeout(liveUpdateTimer);
    liveUpdateTimer = setTimeout(doLiveUpdate, 400);
  }

  // ── Generate SVG (delegates to ChartBuilder) ─────────

  function generateSVG() {
    syncStoreFromUI();
    lastSVG = ChartBuilder.render();
    surfaceChartWarnings();
    // Let the Auto-pill displays show the values the engine just resolved
    // (chart height, bar thickness, bar spacing) as "Auto · 240px". The
    // resolved values live on ChartRegistry.resolved, freshly set by the
    // render above; auto-resolved.js listens for this and rewrites the
    // displays. Presentation only — no effect on the chart. The SVG rides
    // along for the web shell's preview (null when there's nothing to draw).
    try { document.dispatchEvent(new CustomEvent("ocha-chart-rendered", { detail: { svg: lastSVG } })); } catch (e) {}
  }

  // Show a non-blocking warning banner when the renderer reported
  // overflow / overlap / truncation. Call after every chart render.
  // Banner clears itself on the next clean render (no warnings).
  function surfaceChartWarnings() {
    var warnings = (ChartBuilder.getWarnings && ChartBuilder.getWarnings()) || [];
    // Data-level warning: filled-in value cells that couldn't be read as
    // numbers (the parser handles %, currency, commas — these are the genuine
    // leftovers like "n/a"). Surface them instead of silently treating as 0.
    var dataBad = (DataStore.getValueWarnings && DataStore.getValueWarnings()) || 0;
    var statusEl = document.getElementById("status");
    if (!warnings.length && !dataBad) {
      // Clean render — clear a stale warning from a previous render, but leave
      // success / error / link messages untouched (only force-clear a warning).
      if (statusEl && (statusEl.className === "warn" || statusEl.className === "data-warn")) {
        clearStatus(true);
      }
      return;
    }
    // Aggregate by code, e.g. {"label-truncated": 3, "labels-overlap": 1}
    var counts = {};
    var firstSuggestion = null;
    for (var i = 0; i < warnings.length; i++) {
      var code = warnings[i].code;
      counts[code] = (counts[code] || 0) + 1;
      if (!firstSuggestion && warnings[i].info && warnings[i].info.suggestion) {
        firstSuggestion = warnings[i].info.suggestion;
      }
    }
    var parts = [];
    if (dataBad) {
      parts.push(dataBad + " value" + (dataBad > 1 ? "s" : "") +
        " not recognised as a number (treated as 0) — check the data");
    }
    if (counts["label-truncated"]) {
      parts.push(counts["label-truncated"] + " label" +
        (counts["label-truncated"] > 1 ? "s" : "") + " too long for this width");
    }
    if (counts["labels-overlap"]) {
      parts.push(counts["labels-overlap"] + " label" +
        (counts["labels-overlap"] > 1 ? "s" : "") + " overlapping");
    }
    if (counts["inside-pushed-out"]) {
      parts.push(counts["inside-pushed-out"] + " slice label moved outside");
    }
    if (counts["line-series-cap"]) {
      // info.count = how many series were dropped beyond the 6-line cap
      var dropped = warnings.filter(function (w) { return w.code === "line-series-cap"; })[0];
      var n = (dropped && dropped.info && dropped.info.count) || 0;
      parts.push(n + " extra line" + (n === 1 ? "" : "s") + " hidden (6 max)");
    }
    if (counts["panels-capped"]) {
      var dropP = warnings.filter(function (w) { return w.code === "panels-capped"; })[0];
      var np = (dropP && dropP.info && dropP.info.count) || 0;
      parts.push(np + " extra panel" + (np === 1 ? "" : "s") + " hidden (12 max)");
    }
    if (!parts.length) return; // unrecognised code(s) — silently ignore
    var msg = parts.join(" · ");
    if (firstSuggestion) msg += ". " + firstSuggestion;
    if (typeof showStatus === "function") {
      // Red "data-warn" when a value couldn't be read (matches the red row
      // highlight); yellow "warn" for layout-only issues. Persistent so it
      // isn't wiped by a stray "Chart updated." clear-timer; cleared explicitly
      // on the next clean render.
      showStatus(msg, dataBad ? "data-warn" : "warn", false, true);
    }
  }

  // ── Place in Illustrator ──────────────────────────────

  function doPlace() {
    clearStatus();

    var mmVisible = mmPanelEl && mmPanelEl.style.display === "flex";
    var svgToPlace;

    if (mmVisible) {
      // Placing a map
      svgToPlace = lastMapSVG;
      if (!svgToPlace) {
        showStatus("No map generated. Select a country first.", "error");
        return;
      }
    } else {
      // Placing a chart
      syncStoreFromUI();
      if (!lastSVG) {
        generateSVG();
        if (!lastSVG) {
          // Preserve any chart-specific status the builder just set
          // (e.g. Timeline / Sankey / Key Figures "Load sample data" link).
          var statusEl = document.getElementById("status");
          var hasHelpfulStatus = statusEl && (
            statusEl.querySelector("a") ||
            statusEl.dataset.persistent
          );
          if (!hasHelpfulStatus) {
            // If the grid has rows but none of the values could be read as
            // numbers, say so — otherwise "Load data first" is confusing when
            // the user clearly DID enter data (just in a format we couldn't
            // parse). The parser already handles %, currency and commas, so a
            // leftover here is genuinely non-numeric text.
            var badVals = (DataStore.getValueWarnings && DataStore.getValueWarnings()) || 0;
            if (badVals) {
              showStatus("None of the values could be read as numbers. Check the data — values should be numbers (e.g. 1200, 45, 3.5).", "error");
            } else {
              showStatus("No valid data. Load data first.", "error");
            }
          }
          return;
        }
      }
      svgToPlace = lastSVG;
    }

    // Block UI during map placement (maps can take time to load)
    var overlay = document.getElementById("placing-overlay");
    var overlayText = document.getElementById("placing-overlay-text");
    if (mmVisible && overlay) {
      if (overlayText) overlayText.textContent = "Placing map in artboard…";
      overlay.style.display = "flex";
    }

    var tmpFile;

    try {
      tmpFile = csInterface.writeTempFile("ocha_dataviz_temp.svg", svgToPlace);
    } catch (e) {
      showStatus("Couldn't write the temporary SVG: " + e.message, "error");
      if (overlay) overlay.style.display = "none";
      return;
    }

    var escapedPath = tmpFile.replace(/\\/g, "/");
    var configJSON;
    if (mmVisible) {
      var mapCountry = MapMakerPanel.getSelectedCountry();
      configJSON = JSON.stringify({ v: 1, type: "map", country: mapCountry ? mapCountry.name : "" });
    } else {
      configJSON = DataStore.toConfig();
    }
    var escapedConfig = configJSON.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    var script = 'placeChart("' + escapedPath + '", "' + escapedConfig + '")';

    csInterface.evalScript(script, function (result) {
      // Hide overlay
      if (overlay) overlay.style.display = "none";

      if (result === "ok") {
        // If Map Maker is open, keep it open — no tab switch needed
        var mmNow = mmPanelEl && mmPanelEl.style.display === "flex";
        if (!mmNow) {
          PanelCoordinator.setActiveTab("design");
          var placeTip = document.getElementById("place-tip");
          if (placeTip) {
            placeTip.style.display = "block";
            if (window._placeTipTimer) clearTimeout(window._placeTipTimer);
            window._placeTipTimer = setTimeout(function () { placeTip.style.display = "none"; }, 20000);
          }
        }
        showStatus(mmNow ? "Map placed." : "Chart placed.", "success");
        setTimeout(clearStatus, 6000);
        sendAnalyticsPing("place:" + (mmNow ? "map" : (DataStore.chartType || "unknown")));
      } else {
        var msg = (result || "Unknown error.").replace(/^ERROR:\s*/i, "");
        showStatus(msg, "error");
      }
    });
  }

  // ── Edit Selected Chart ───────────────────────────────

  function doEditSelected(configResult) {
    clearStatus();

    try {
      var parsed = JSON.parse(configResult);

      if (parsed.error || !parsed.v) return;

      var hash = configResult.substring(0, 100);
      if (hash === editConfigHash && editMode) return;

      // A DIFFERENT chart (or map) is about to load into the panel. Drop
      // everything still pending for the previous one: a queued live update
      // must not fire against the new selection (the host identity guard is
      // the backstop, this avoids even attempting it), and the resize
      // watcher's baseline belongs to the previous chart — keeping it would
      // make the watcher read the new chart's different size as a "drag"
      // and reflow it just for being clicked.
      if (liveUpdateTimer) { clearTimeout(liveUpdateTimer); liveUpdateTimer = null; }
      clearResizeNotice();
      placedSizeExpected = null;
      prevBoundsReading = null;
      lastAdoptedSize = null;

      // Check if this is a map (placed by Map Maker)
      if (parsed.type === "map") {
        editConfigHash = hash;
        editMode = true;
        editingIsMap = true;
        // Show banner at top — Map Maker stays open, Place button stays visible
        var bannerText = document.getElementById("edit-banner-text");
        if (bannerText) bannerText.textContent = "Editing selected map";
        editBanner.classList.add("visible");
        return;
      }

      var loadResult = DataStore.loadFromConfig(configResult);
      if (loadResult.error) return;

      editConfigHash = hash;
      editingIsMap = false;
      syncUIFromStore();
      enterEditMode();
      generateSVG();
      showStatus("Chart loaded for editing.", "info");
      setTimeout(clearStatus, 6000);
    } catch (e) {
      // not a valid config, ignore
    }
  }

  // ── Auto-Detect Selection ─────────────────────────────

  var selectionPollInterval = null;
  var pollBusy = false;

  function pollSelection() {
    if (pollBusy) return;
    pollBusy = true;

    csInterface.evalScript("getSelectedChartConfig()", function (result) {
      pollBusy = false;

      try {
        var parsed = JSON.parse(result);

        if (parsed.error || !parsed.v) {
          // Genuine "nothing selected / not a chart" → clear the panel.
          if (editMode) {
            exitEditMode(true);
          }
          return;
        }

        doEditSelected(result);
      } catch (e) {
        // Transient parse/host hiccup → just leave edit mode, keep the data.
        if (editMode) {
          exitEditMode(false);
        }
      }
    });
  }

  // ── Manual resize → settings (drag the chart, sliders follow) ──
  //
  // While a chart is being edited, the poll above also reads the placed
  // group's actual size. If it deviates from the size WE last placed
  // (placedSizeExpected), the user dragged it with the Selection tool —
  // so we write the dragged size into the chart settings and re-render:
  // a real responsive re-layout (text stays 12pt, strokes stay 1pt),
  // exactly as if they had moved the Width slider.
  //
  // Why compare against the last-placed size and not the config: batch-
  // placed charts intentionally sit at grid-cell size with their original
  // size in the note, and legacy charts may carry an old manual scale —
  // neither should trigger a reflow on mere selection. The baseline is
  // (re)established on edit entry and after every successful updateChart,
  // so only a drag DURING editing deviates from it.
  var placedSizeExpected = null;   // {w,h} MEASURED after our last place/update
  var lastAdoptedSize = null;      // last drag we adopted (undo-loop guard)
  var prevBoundsReading = null;    // previous poll's reading (stability check)
  var adoptCooldownUntil = 0;      // no adoptions before this timestamp
  var resizeCheckBusy = false;
  var resizeNoticeShown = false;   // spinner status visible for this gesture
  var liveUpdateInFlight = false;  // updateChart round-trip in progress
  var editingIsMap = false;        // edit mode holds a map, not a chart

  // Remove the resize spinner if it's the current status (e.g. a deviation
  // turned out to be a false alarm, or the user undid our reflow).
  function clearResizeNotice() {
    if (!resizeNoticeShown) return;
    resizeNoticeShown = false;
    var sEl = document.getElementById("status");
    if (sEl && sEl.className === "busy") clearStatus(true);
  }

  // Chart types whose renderer genuinely re-fits content to a forced height
  // (bars recalc thickness, plots stretch). Other types get width-only
  // adoption — their height is content-driven, forcing it would clip.
  var HEIGHT_ADAPTIVE_TYPES = { hbar: 1, vbar: 1, line: 1, "stacked-col": 1 };

  // The watcher runs on its own fast pulse (not the 1.5s selection poll) so
  // a drag reflows ~1s after release. The bounds query is a trivial host
  // call, and it only fires while a chart is actually being edited.
  setInterval(function () {
    if (editMode && !editingIsMap) checkPlacedResize();
  }, 450);

  function checkPlacedResize() {
    if (resizeCheckBusy || liveUpdateInFlight) return;
    if (Date.now() < adoptCooldownUntil) return;  // settle period after an adoption
    resizeCheckBusy = true;
    csInterface.evalScript("getChartBounds()", function (res) {
      resizeCheckBusy = false;
      if (!editMode || liveUpdateInFlight) return;
      var b;
      try { b = JSON.parse(res); } catch (e) { return; }
      if (!b || !b.chart || !b.width) return;

      if (!placedSizeExpected) {
        // First reading for this edit session — baseline only, never adopt.
        // A batch chart at cell size or a legacy scaled chart stays as-is
        // until the user actually drags it.
        placedSizeExpected = { w: b.width, h: b.height };
        prevBoundsReading = { w: b.width, h: b.height };
        return;
      }

      var dW = Math.abs(b.width - placedSizeExpected.w);
      var dH = Math.abs(b.height - placedSizeExpected.h);
      var prev = prevBoundsReading;
      prevBoundsReading = { w: b.width, h: b.height };
      if (dW <= 3 && dH <= 3) {
        // Back at the expected size — if we'd flagged a resize, it was a
        // false alarm (or the user undid their drag). Take the spinner down.
        clearResizeNotice();
        return;
      }

      // Stability: only adopt a size we've now seen on TWO consecutive polls.
      // A mid-gesture or transient reading differs from its successor, so it
      // never triggers; the user's settled drag does.
      if (!prev ||
          Math.abs(b.width - prev.w) > 3 ||
          Math.abs(b.height - prev.h) > 3) {
        // First deviating reading — likely the user just released a drag.
        // Acknowledge immediately (spinner) while we confirm on the next
        // tick; the early feedback is what tells them the plugin noticed.
        if (!resizeNoticeShown) {
          resizeNoticeShown = true;
          showStatus("Chart resized — updating…", "busy");
        }
        return;
      }

      // Undo guard: if the user undid our reflow, the group returns to the
      // dragged size we already adopted once — leave it alone this time so
      // Cmd+Z isn't fought by an adopt→reflow loop.
      if (lastAdoptedSize &&
          Math.abs(b.width - lastAdoptedSize.w) <= 3 &&
          Math.abs(b.height - lastAdoptedSize.h) <= 3) {
        clearResizeNotice();   // nothing will happen — don't leave it spinning
        return;
      }

      adoptPlacedSize(b.width, b.height);
    });
  }

  function adoptPlacedSize(w, h) {
    lastAdoptedSize = { w: w, h: h };
    // Cooldown: even if some comparison is ever wrong again, the worst case
    // is one reflow per 2s — the same rate as slider edits, not a runaway.
    adoptCooldownUntil = Date.now() + 2000;
    // Width: every chart re-lays-out to any width. Snap to the Width
    // slider's 10px step and clamp to its range so the control stays honest.
    var newW = Math.max(100, Math.min(1200, Math.round(w / 10) * 10));
    DataStore.chartWidth = newW;
    // Height: only where the renderer truly adapts content to it.
    if (HEIGHT_ADAPTIVE_TYPES[DataStore.chartType]) {
      DataStore.chartHeight = Math.max(80, Math.round(h));
    }
    syncUIFromStore();
    resizeNoticeShown = false;   // superseded by the reflow message below
    showStatus("Resized on artboard — reflowing at " + newW + " px…", "busy");
    sendAnalyticsPing("manual-resize:" + (DataStore.chartType || "unknown"));
    // Reflow immediately — the debounce exists to coalesce slider drags,
    // but an adoption is a single settled event; waiting just adds lag.
    if (liveUpdateTimer) clearTimeout(liveUpdateTimer);
    doLiveUpdate();
  }

  function startSelectionPolling() {
    if (selectionPollInterval) return;
    selectionPollInterval = setInterval(pollSelection, 1500);
  }

  // Illustrator only: watch the document selection for placed charts.
  if (csInterface) startSelectionPolling();

  // ── Event Listeners ───────────────────────────────────

  btnPlace.addEventListener("click", doPlace);

  // ── Init ──────────────────────────────────────────────
  // Always start clean — no cross-session data restoration.
  // Config round-trips via Illustrator groupItem.note (loadFromConfig) still work.
  DataGrid.render(gridContainer);
  updateChartOptions();

  // Init sankey color mode defaults
  DataStore.sankeyColorMode = "single";
  var initStyle = ChartRegistry.getStyle(DataStore.style || "ocha");
  DataStore.sankeySingleColor = (initStyle.colors && initStyle.colors[0]) || "#009EDB";
  ColorPickersUI.buildSankeySwatches();

  // Verify ExtendScript connection (Illustrator only)
  if (csInterface) csInterface.evalScript("ping()", function (result) {
    if (result === "pong") {
      showStatus("Connected to Illustrator.", "success");
      setTimeout(clearStatus, 8000);
    }
  });

  // ── Startup: version check + analytics ────────────────
  // Keep the About-menu version label in sync with APP_VERSION so the
  // hardcoded fallback in index.html can't drift between releases.
  var appVersionEl = document.getElementById("app-version");
  if (appVersionEl) appVersionEl.textContent = APP_VERSION;

  // Plugin update check — Illustrator only (the web version is always current).
  if (typeof VersionCheck !== "undefined") VersionCheck.run(APP_VERSION);
  Analytics.init(APP_VERSION);

  var sendAnalyticsPing = Analytics.ping;


  // ── "What's new" — show once per version, hide after menu is opened ──
  (function () {
    var wnSection = document.getElementById("whats-new-wrapper");
    if (!wnSection) return;
    var seenKey = "dataviz_whatsnew_seen";
    var alreadySeen = false;
    try { alreadySeen = localStorage.getItem(seenKey) === APP_VERSION; } catch (e) {}

    if (alreadySeen) {
      wnSection.style.display = "none";
    } else {
      wnSection.style.display = "";
      // Mark as seen when user opens the hamburger menu
      menuBtn.addEventListener("click", function markSeen() {
        try { localStorage.setItem(seenKey, APP_VERSION); } catch (e) {}
        menuBtn.removeEventListener("click", markSeen);
      });
    }
  })();

})();
