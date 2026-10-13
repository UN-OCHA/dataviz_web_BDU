/**
 * Guided help for first-time users — web version only.
 *
 *   - Help button in the toolbar → a Help window (same window as the rest of
 *     the panel) with: Make your first chart · Quick tour of the screen ·
 *     Save & share: how it works.
 *   - First visit: the page dims and a welcome card sits in the centre,
 *     “New here? Make your first chart in 1 minute”, with Start / No thanks
 *     (Esc or a click on the dimmed page = No thanks). It is the kit
 *     coachmark's intro variant. Shown once per browser; not shown when the
 *     page was opened from a chart link (that person came to see a specific
 *     chart, which the card would cover — Help is still there).
 *   - The guides run on the OCHA App Kit's coachmark component
 *     (vendor/cd-coachmark.js + vendor/ocha-app-kit.css, synced from the kit
 *     by app-kit/sync.py — never edit those copies). Colours follow the
 *     panel's light/dark theme through the component's hooks (web-shell.css).
 *   - Usage counts: guide:<id>:start, guide:<id>:done, guide:<id>:skip:<step>.
 *
 * Every step's target is a stable id or class in the panel; the web check
 * (tests/shell/web-check.js, "guides") walks both guides so a later UI
 * change can't silently break one.
 */

/* global CdCoachmark, DataStore, WEB_ICONS */

var WebGuides = (function () {
  "use strict";

  var CARD_KEY = "ocha-dataviz-web:first-visit";

  function $(id) { return document.getElementById(id); }
  function icon(name) {
    var paths = (window.WEB_ICONS && WEB_ICONS[name]) || [];
    return '<svg viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">' +
      paths.map(function (d) { return '<path d="' + d + '"/>'; }).join("") + "</svg>";
  }
  function count(event) {
    if (typeof window.sendAnalyticsPing === "function") window.sendAnalyticsPing(event);
  }
  function remember(value) { try { localStorage.setItem(CARD_KEY, value); } catch (e) { /* storage off */ } }
  function remembered() { try { return localStorage.getItem(CARD_KEY); } catch (e) { return null; } }

  // ── Getting the panel ready for a step ──────────────────────
  function showTab(name) {
    var b = document.querySelector('.tab-btn[data-tab="' + name + '"]');
    if (b && !b.classList.contains("active")) b.click();
  }
  function saveShareGroup() {
    var sec = $("chart-config-section");
    return sec && sec.closest(".dgroup");
  }
  function openSaveShare() {
    showTab("data");
    var g = saveShareGroup();
    if (g) g.classList.remove("collapsed");
  }
  function hasData() {
    return !!(DataStore.rows && DataStore.rows.some(function (r) {
      return r && r.some(function (c) { return String(c == null ? "" : c).trim() !== ""; });
    }));
  }
  // Pause until the layout has settled after switching tabs / loading data.
  function settle() { return new Promise(function (r) { setTimeout(r, 120); }); }

  // ── The guides ──────────────────────────────────────────────
  var GUIDES = {
    "first-chart": {
      title: "Make your first chart",
      steps: [
        { target: "#data-grid-container", title: "Your data",
          onEnter: function () {
            showTab("data");
            var had = hasData();
            if (!had) { var s = $("btn-sample-data"); if (s) s.click(); }
            this.text = had
              ? "<p>This is your data. You can type over it, paste from Excel, or upload a CSV file.</p>"
              : "<p>We’ve put in some sample data so you can try. Later, type over it, paste from Excel, or upload a CSV file.</p>";
            return settle();
          } },
        { target: "#chart-sidebar", title: "Pick a chart type",
          text: "<p>Click a chart type to see your data drawn that way. Try <strong>Horizontal Bar</strong>.</p>",
          advanceOn: { selector: ".sidebar-btn[data-chart]", event: "click" },
          onEnter: function () { showTab("chart"); return settle(); } },
        { target: function () { var t = $("chart-title"); return t && (t.closest(".m3-field") || t); },
          title: "Give it a title",
          text: "<p>Type a title for your chart. The preview changes as you type. Click <strong>Next</strong> when you’re done.</p>",
          advanceOn: { selector: "#chart-title", event: "change" },
          onEnter: function () { showTab("text"); return settle(); } },
        { target: "#web-downloads", title: "Download it",
          text: "<p>When it looks right, download it here. <strong>SVG</strong> stays sharp at any size and can be edited in Illustrator. <strong>PNG</strong> is a picture for slides and documents.</p>" },
        { target: saveShareGroup, title: "Keep it or share it",
          text: "<p><strong>Share chart</strong> makes a link to send in Teams or an email. <strong>Save</strong> keeps the chart as a file. <strong>Load / Import</strong> brings a chart back.</p>",
          onEnter: function () { openSaveShare(); return settle(); } }
      ]
    },
    tour: {
      title: "Quick tour of the screen",
      steps: [
        { target: "#data-grid-container", title: "Your data",
          text: "<p>Your data goes here: type it, paste it from Excel, or upload a CSV file. <strong>Use AI</strong> helps you turn a table or a document into a chart.</p>",
          onEnter: function () { showTab("data"); return settle(); } },
        { target: "#chart-sidebar", title: "Chart types",
          text: "<p>Pick how to show your data. The buttons above the list suggest charts for comparisons, trends and more.</p>",
          onEnter: function () { showTab("chart"); return settle(); } },
        { target: "#tab-bar", title: "Fine-tune",
          text: "<p><strong>Design</strong> changes the look: size, colours, labels and legend. <strong>Text</strong> changes the words: title, subtitle, comments and source.</p>" },
        { target: function () { var o = $("web-output"); return o && !o.hidden ? o : $("web-empty"); },
          title: "Your chart",
          text: "<p>Your chart appears here, exactly as it will download, and changes as you edit. The Download buttons are right below it.</p>" },
        { target: saveShareGroup, title: "Keep it or share it",
          text: "<p><strong>Share chart</strong> makes a link to send in Teams or an email. <strong>Save</strong> keeps the chart as a file. <strong>Load / Import</strong> brings a chart back.</p>",
          onEnter: function () { openSaveShare(); return settle(); } },
        { target: "#web-help", title: "Help",
          text: "<p>Come back here any time for these guides, and for how Save &amp; share works.</p>" }
      ]
    }
  };

  function start(id) {
    var g = GUIDES[id];
    if (!g || typeof CdCoachmark === "undefined") return null;
    closeHelp();
    if (id === "first-chart") remember("started");
    count("guide:" + id + ":start");
    return CdCoachmark.start({
      steps: g.steps,
      labels: { next: "Next", back: "Back", done: "Done", skip: "Skip the guide",
        close: "Close the guide", count: "Step {n} of {total}" },
      buttonClass: "btn btn-primary btn-sm",
      secondaryButtonClass: "btn btn-secondary btn-sm",
      onEnd: function (reason, index) {
        count("guide:" + id + ":" + (reason === "done" ? "done" : "skip:" + (index + 1)));
      }
    });
  }

  // ── Help button + window ────────────────────────────────────
  var help = null;
  function closeHelp() { if (help) help.style.display = "none"; }
  function buildHelp() {
    help = document.createElement("div");
    help.id = "web-help-modal";
    help.className = "ai-import-modal";              // the panel's own window
    help.setAttribute("role", "dialog");
    help.setAttribute("aria-modal", "true");
    help.setAttribute("aria-labelledby", "web-help-title");
    help.style.display = "none";
    function row(iconName, title, text, btnId, btnLabel) {
      return '<div class="ai-import-step">' +
        '<div class="ai-import-step-num">' + icon(iconName) + "</div>" +
        '<div class="ai-import-step-content">' +
          '<div class="ai-import-step-title">' + title + "</div>" +
          '<div class="ai-import-step-desc">' + text + "</div>" +
          '<button type="button" class="btn btn-secondary btn-sm" id="' + btnId + '">' + btnLabel + "</button>" +
        "</div></div>";
    }
    help.innerHTML =
      '<div class="ai-import-modal-inner">' +
        '<div class="ai-import-modal-header">' +
          '<span class="ai-import-modal-title" id="web-help-title">' +
            icon("circle-question").replace("<svg ", '<svg class="ai-import-header-icon" ') + "Help</span>" +
          '<button type="button" class="ai-import-modal-close" id="web-help-close" title="Close">' + icon("xmark") + "</button>" +
        "</div>" +
        '<div class="ai-import-modal-body steps-with-actions">' +
          row("chart-simple", "Make your first chart", "A hands-on guide: you make a chart from sample data, in about a minute.", "web-help-first", "Start") +
          row("compass", "Quick tour of the screen", "Where everything is, in six short steps.", "web-help-tour", "Start") +
          row("circle-info", "Save &amp; share: how it works", "What Share chart, Save and Load / Import are for.", "web-help-saveshare", "Open") +
        "</div>" +
        '<div class="ai-import-modal-footer">' +
          '<button type="button" class="btn btn-secondary btn-sm" id="web-help-ok">Close</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(help);
    var lastFocus = null;
    function close() { closeHelp(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    $("web-help-close").addEventListener("click", close);
    $("web-help-ok").addEventListener("click", close);
    help.addEventListener("click", function (e) { if (e.target === help) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && help.style.display === "flex") close(); });
    $("web-help-first").addEventListener("click", function () { start("first-chart"); });
    $("web-help-tour").addEventListener("click", function () { start("tour"); });
    $("web-help-saveshare").addEventListener("click", function () {
      closeHelp();
      var b = $("btn-save-share-help");
      if (b) b.click();
    });
    return function open() {
      lastFocus = document.activeElement;
      help.style.display = "flex";
      $("web-help-first").focus();
      count("tool:help");
    };
  }

  // ── First-visit welcome ─────────────────────────────────────
  function showWelcome() {
    if (typeof CdCoachmark === "undefined") return;
    count("guide:welcome:shown");
    CdCoachmark.start({
      variant: "intro", modal: true, closeOnScrim: true, showCount: false,
      steps: [{ title: "New here?", text: "<p>Make your first chart in 1 minute.</p>" }],
      actions: [{ label: "Start", value: "start", primary: true }, { label: "No thanks", value: "no" }],
      labels: { close: "Close" },
      buttonClass: "btn btn-primary btn-sm",
      secondaryButtonClass: "btn btn-secondary btn-sm",
      onEnd: function (reason) {
        if (reason === "start") { start("first-chart"); return; }
        remember("dismissed");
        count("guide:welcome:dismissed");
      }
    });
  }

  // ── Wire up ─────────────────────────────────────────────────
  var openedFromLink = /^#(chart|d|json)=/.test(location.hash);   // read before web-shell clears it
  document.addEventListener("DOMContentLoaded", function () {
    var actions = document.querySelector("#web-toolbar .web-actions");
    if (actions) {
      var openHelp = buildHelp();
      var b = document.createElement("button");
      b.type = "button";
      b.id = "web-help";
      b.className = "btn btn-secondary btn-sm";
      b.setAttribute("aria-haspopup", "dialog");
      b.title = "Guides and help";
      b.innerHTML = icon("circle-question") + "Help";
      b.addEventListener("click", openHelp);
      actions.insertBefore(b, actions.firstChild);
    }
    // After the panel's first render, so the welcome dims a finished page.
    if (!remembered() && !openedFromLink && !document.getElementById("web-phone-gate")) setTimeout(showWelcome, 400);
  });

  return { start: start, guides: GUIDES, welcome: showWelcome };
})();
