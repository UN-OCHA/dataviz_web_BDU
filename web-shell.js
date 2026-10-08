/**
 * Web shell — the parts of the Humanitarian DataViz Tool that exist only in
 * the web version. Everything else (data, chart types, design, text, AI
 * import, themes, save/open JSON) is the plugin's own code, unchanged.
 *
 *   - Layout: the plugin's panel on the left; on the right, where
 *     Illustrator's artboard would be, a live preview of the chart.
 *   - Export: Download SVG (live text, exactly what the plugin places) and
 *     Download PNG at 1×/2×/4× (fonts embedded so the text matches).
 *     (A Copy button was tried and removed, 8 Oct 2026: SVG code pastes as
 *     text in Word / PowerPoint. See README "Ideas for later".)
 *   - Location maps open in a preview window with a Download button.
 *   - Open a chart from a link: #chart=… / #d=… / #json=… (format in the
 *     web README) opens that chart ready to edit.
 *   - The panel can be resized by dragging its edge (width remembered in
 *     this browser).
 *   - Multi-chart AI import: the panel renders the charts and raises
 *     "ocha-batch-rendered"; they are downloaded here as one ZIP.
 *   - Phones get a "use a computer or tablet" message.
 *
 * Loaded after connector-web.js and before panel.js, so its listeners are in
 * place before the panel's first render. It talks to the panel only through
 * DOM events and the shared DataStore.
 */

/* global DataStore, ZipStore, WEB_ICONS */

(function () {
  "use strict";

  document.documentElement.setAttribute("data-shell", "web");

  function icon(name) {
    var paths = WEB_ICONS[name] || [];
    return '<svg viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">' +
      paths.map(function (d) { return '<path d="' + d + '"/>'; }).join("") + "</svg>";
  }

  // ── Phones ──────────────────────────────────────────────────
  // Computers and tablets only. The shorter screen side tells a phone from
  // a tablet regardless of rotation.
  function isPhone() {
    var s = Math.min(window.screen.width || 9999, window.screen.height || 9999);
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    return coarse && s < 600;
  }
  if (isPhone()) {
    var gate = document.createElement("div");
    gate.id = "web-phone-gate";
    gate.innerHTML =
      '<div class="gate-card">' + icon("computer") +
      "<h1>Open this on a computer or tablet</h1>" +
      "<p>The Humanitarian DataViz Tool needs a bigger screen. " +
      "Open this page on a computer or a tablet to make your charts.</p></div>";
    document.body.appendChild(gate);
  }

  // ── Preview side ────────────────────────────────────────────
  var aside = document.createElement("section");
  aside.id = "web-preview";
  aside.setAttribute("aria-label", "Chart preview");
  aside.innerHTML =
    '<div id="web-toolbar">' +
      '<div class="web-title">Humanitarian DataViz Tool <span>— web <span id="web-version"></span></span></div>' +
      '<span id="web-message" role="status" aria-live="polite"></span>' +
      '<div class="web-actions">' +
      '<a class="btn btn-secondary btn-sm" id="web-newtab" hidden target="_blank" rel="noopener" title="Open the tool in its own browser tab">' +
        icon("arrow-up-right-from-square") + "Open in new tab</a>" +
      '<button type="button" class="btn btn-secondary btn-sm" id="web-fullscreen" hidden title="Use the whole screen">' +
        icon("expand") + '<span class="fs-label">Full screen</span></button>' +
      '<button type="button" class="btn btn-primary btn-sm" id="web-dl-svg" disabled title="Download the chart as an SVG file with live, editable text">' +
        icon("file-svg") + "Download SVG</button>" +
      '<span class="web-png-group">' +
        '<button type="button" class="btn btn-secondary btn-sm" id="web-dl-png" disabled title="Download the chart as a PNG image">' +
          icon("file-image") + "Download PNG</button>" +
        '<select id="web-png-scale" aria-label="PNG size">' +
          '<option value="1">1×</option><option value="2" selected>2×</option><option value="4">4×</option>' +
        "</select>" +
      "</span>" +
      "</div>" +
    "</div>" +
    '<div id="web-stage">' +
      '<div id="web-empty"><strong>Your chart appears here</strong>' +
        "Add your data in the Data tab — or click <em>Load sample data</em> — " +
        "and pick a chart type. Then download it as SVG or PNG.</div>" +
      '<div id="web-artboard" hidden></div>' +
    "</div>" +
    '<div id="web-privacy">' + icon("lock") +
      "<span>Your data stays in this browser. Nothing you paste or upload is sent anywhere.</span></div>";
  document.body.appendChild(aside);

  var artboard = document.getElementById("web-artboard");
  var empty = document.getElementById("web-empty");
  var msgEl = document.getElementById("web-message");
  var btnSvg = document.getElementById("web-dl-svg");
  var btnPng = document.getElementById("web-dl-png");
  var pngScale = document.getElementById("web-png-scale");

  // The chart is drawn in its own shadow tree: the page's styles can't
  // reach into it, while the page's fonts (Roboto) still apply.
  var stage = artboard.attachShadow({ mode: "open" });
  var currentSvg = null;

  function stripXmlDecl(svg) { return String(svg).replace(/^\s*<\?xml[^>]*\?>\s*/, ""); }

  function showChart(svg) {
    currentSvg = svg || null;
    var has = !!currentSvg;
    btnSvg.disabled = btnPng.disabled = !has;
    empty.hidden = has;
    artboard.hidden = !has;
    stage.innerHTML = has
      ? "<style>:host{display:block} svg{display:block;max-width:100%;height:auto}</style>" + stripXmlDecl(currentSvg)
      : "";
  }

  document.addEventListener("ocha-chart-rendered", function (e) {
    showChart(e.detail ? e.detail.svg : null);
  });

  var msgTimer = null;
  function say(text, kind) {
    msgEl.textContent = text || "";
    msgEl.className = kind ? "is-" + kind : "";
    if (msgTimer) clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { say(""); }, kind === "error" ? 9000 : 5000);
  }

  // Same cleaning as the plugin's "Save" file names: the chart title,
  // without characters that file systems reject, at most 60 characters.
  function baseName(title) {
    var clean = String(title || "").trim().replace(/[\/\\:*?"<>|]+/g, "-").trim();
    if (!clean) clean = "chart";
    if (clean.length > 60) clean = clean.substring(0, 60).trim();
    return clean;
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  // Usage count (sent only once counts are switched on and the person has
  // signed up; see connector-web.js). Same style as the plugin's events.
  function count(event) {
    if (typeof window.sendAnalyticsPing === "function") window.sendAnalyticsPing(event);
  }

  // ── Inside an embed (e.g. the brand portal page) ────────────
  // Offer the tool in its own tab: more room, and its own browser storage.
  var inFrame = false;
  try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
  if (inFrame) {
    var nt = document.getElementById("web-newtab");
    nt.href = location.href.split("#")[0];
    nt.hidden = false;
    nt.addEventListener("click", function () { count("tool:newtab"); });
  }

  // ── Full screen ─────────────────────────────────────────────
  // Useful inside the brand-portal embed (the iframe allows full screen).
  // Hidden where the browser or the embedding page doesn't allow it.
  var btnFs = document.getElementById("web-fullscreen");
  function fsActive() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function fsSync() {
    btnFs.innerHTML = icon(fsActive() ? "compress" : "expand") +
      '<span class="fs-label">' + (fsActive() ? "Exit full screen" : "Full screen") + "</span>";
    btnFs.title = fsActive() ? "Back to the normal view" : "Use the whole screen";
  }
  if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
    btnFs.hidden = false;
    btnFs.addEventListener("click", function () {
      var root = document.documentElement;
      if (fsActive()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        var req = root.requestFullscreen || root.webkitRequestFullscreen;
        var p = req && req.call(root);
        if (p && p.catch) p.catch(function () { say("Full screen isn't allowed here.", "error"); });
        count("tool:fullscreen");
      }
    });
    document.addEventListener("fullscreenchange", fsSync);
    document.addEventListener("webkitfullscreenchange", fsSync);
  }

  // ── Download SVG: byte for byte what the plugin places ──────
  btnSvg.addEventListener("click", function () {
    if (!currentSvg) return;
    var name = baseName(DataStore.chartTitle) + ".svg";
    downloadBlob(new Blob([currentSvg], { type: "image/svg+xml" }), name);
    say("Downloaded " + name, "success");
    count("export:svg:" + (DataStore.chartType || "unknown"));
  });

  // ── Download PNG ────────────────────────────────────────────
  // An SVG drawn as an image can't use the page's fonts, so the fonts are
  // embedded into a copy of the SVG first (read once from fonts/fonts.css).
  var embeddedFontCss = null;

  function readBinary(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.onload = function () {
        if (xhr.status === 200 || (xhr.status === 0 && xhr.response)) resolve(xhr.response);
        else reject(new Error("HTTP " + xhr.status + " for " + url));
      };
      xhr.onerror = function () { reject(new Error("Couldn't read " + url)); };
      xhr.send();
    });
  }

  function toBase64(buf) {
    var bytes = new Uint8Array(buf), bin = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  function fontCss() {
    if (embeddedFontCss) return Promise.resolve(embeddedFontCss);
    return readBinary("fonts/fonts.css").then(function (buf) {
      var css = new TextDecoder("utf-8").decode(buf).replace(/\/\*[\s\S]*?\*\//g, "");
      var urls = [], re = /url\('([^']+)'\)/g, m;
      while ((m = re.exec(css)) !== null) urls.push(m[1]);
      return Promise.all(urls.map(function (u) {
        return readBinary("fonts/" + u).then(function (b) { return [u, toBase64(b)]; });
      })).then(function (pairs) {
        pairs.forEach(function (p) {
          css = css.split("url('" + p[0] + "')").join("url(data:font/woff;base64," + p[1] + ")");
        });
        embeddedFontCss = css;
        return css;
      });
    });
  }

  function svgDimensions(svg) {
    var open = (svg.match(/<svg\b[^>]*>/) || [""])[0];
    var w = parseFloat((open.match(/\bwidth="([\d.]+)/) || [])[1]);
    var h = parseFloat((open.match(/\bheight="([\d.]+)/) || [])[1]);
    if (!(w && h)) {
      var vb = (open.match(/viewBox="([^"]+)"/) || [])[1];
      if (vb) { var p = vb.split(/[\s,]+/).map(Number); w = p[2]; h = p[3]; }
    }
    return { w: w || 500, h: h || 300 };
  }

  function renderPng(svg, scale) {
    return fontCss().then(function (css) {
      var withFonts = stripXmlDecl(svg).replace(/(<svg\b[^>]*>)/, "$1<defs><style>" + css + "</style></defs>");
      var size = svgDimensions(svg);
      var url = URL.createObjectURL(new Blob([withFonts], { type: "image/svg+xml" }));
      var img = new Image();
      img.width = size.w;
      img.height = size.h;
      return new Promise(function (resolve, reject) {
        img.onload = function () { resolve(); };
        img.onerror = function () { reject(new Error("The chart couldn't be drawn as an image.")); };
        img.src = url;
      }).then(function () {
        return img.decode ? img.decode().catch(function () {}) : null;
      }).then(function () {
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(size.w * scale);
        canvas.height = Math.round(size.h * scale);
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);   // transparent background, like the SVG
        URL.revokeObjectURL(url);
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error("PNG export failed.")); }, "image/png");
        });
      });
    });
  }

  btnPng.addEventListener("click", function () {
    if (!currentSvg) return;
    var scale = parseInt(pngScale.value, 10) || 2;
    var name = baseName(DataStore.chartTitle) + (scale === 1 ? "" : "@" + scale + "x") + ".png";
    btnPng.disabled = true;
    say("Preparing PNG…");
    renderPng(currentSvg, scale).then(function (blob) {
      downloadBlob(blob, name);
      say("Downloaded " + name, "success");
      count("export:png:" + (DataStore.chartType || "unknown") + ":" + scale + "x");
    }, function (err) {
      say((err && err.message) || "PNG export failed.", "error");
    }).then(function () { btnPng.disabled = !currentSvg; });
  });

  // ── Open a chart from a link ────────────────────────────────
  // The chart's Save/Open JSON travels in the URL fragment (after #), so it
  // never reaches a server. Accepted (see ocha_dataviz_web/README.md):
  //   #chart=<base64url of the JSON, compressed with deflate-raw or gzip>
  //   #d=<same>          (the dashboard editor's style of link)
  //   #json=<the JSON, URL-encoded, not compressed>  (hand-made links)
  function base64urlBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function inflate(bytes, format) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  // gzip starts with 1F 8B; otherwise try deflate-raw; if neither, the
  // bytes are taken as plain text.
  function unpack(bytes) {
    if (typeof DecompressionStream === "undefined") return Promise.resolve(bytes);
    var isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    return inflate(bytes, isGzip ? "gzip" : "deflate-raw").catch(function () { return bytes; });
  }
  function chartFromHash(hash) {
    var m = /^#(chart|d|json)=(.+)$/.exec(hash || "");
    if (!m) return Promise.resolve(null);
    if (m[1] === "json") {
      try { return Promise.resolve(decodeURIComponent(m[2])); } catch (e) { return Promise.reject(e); }
    }
    return unpack(base64urlBytes(m[2])).then(function (b) { return new TextDecoder("utf-8").decode(b); });
  }
  // Two kinds of JSON can arrive:
  //   - a saved chart (Save / Load format, has "v") → opened like Load chart;
  //   - anything else — the AI import format ({chartType, title, headers,
  //     rows…}, an array of those, or {charts:[…]}), as written by an AI
  //     assistant without the connector → handed to the "Use AI" box, which
  //     validates it, shows any problem with "Copy fix prompt", and offers a
  //     multi-chart import as one ZIP.
  function isSavedChart(text) {
    try { var o = JSON.parse(text); return !!(o && typeof o === "object" && !Array.isArray(o) && o.v); }
    catch (e) { return false; }
  }
  function openInAiImport(text) {
    var btn = document.getElementById("btn-use-ai");
    var ta = document.getElementById("ai-import-textarea");
    var go = document.getElementById("ai-import-submit");
    if (!btn || !ta || !go) return false;
    btn.click();
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    go.click();
    return true;
  }
  function openFromHash(hash) {
    return chartFromHash(hash).then(function (json) {
      if (!json) return false;
      // Not even shaped like JSON (a damaged or truncated link): say so
      // plainly rather than showing a parser error.
      if (!/^\s*[\[{]/.test(json)) throw new Error("not JSON");
      if (isSavedChart(json)) {
        document.dispatchEvent(new CustomEvent("ocha-load-config", { detail: { json: json, label: "the link" } }));
      } else if (!openInAiImport(json)) {
        throw new Error("no AI import box");
      }
      count("tool:link");
      return true;
    }).catch(function () {
      // Any failure — undecodable, not JSON, no AI box — ends here.
      say("This link doesn't contain a readable chart.", "error");
      return false;
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    if (!/^#(chart|d|json)=/.test(location.hash)) return;
    var hash = location.hash;
    // Clear the link from the address bar first, so a reload never
    // re-imports it over the person's edits.
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* file:// */ }
    openFromHash(hash);
  });

  // Exposed for the automated checks (tests/shell/web-check.js).
  window.WebShell = { renderPng: renderPng, baseName: baseName, openFromHash: openFromHash };

  // ── Multi-chart AI import → one ZIP ─────────────────────────
  document.addEventListener("ocha-batch-rendered", function (e) {
    var charts = (e.detail && e.detail.charts) || [];
    if (!charts.length) return;
    var used = {};
    var files = charts.map(function (c, i) {
      var name = baseName(c.title || ("Chart " + (i + 1)));
      var key = name.toLowerCase(), n = 1;
      while (used[key]) { n++; key = (name + " (" + n + ")").toLowerCase(); }
      used[key] = true;
      return { name: (n > 1 ? name + " (" + n + ")" : name) + ".svg", text: c.svg };
    });
    downloadBlob(ZipStore.build(files), "humanitarian-dataviz-charts.zip");
    count("export:zip:" + files.length);
  });

  // ── Preview window for assets (location maps) ───────────────
  // The maps panel raises "ocha-asset-preview" instead of downloading
  // straight away, so people can see the map first.
  var modal = document.createElement("div");
  modal.id = "web-asset-modal";
  modal.className = "ai-import-modal";           // the panel's own modal look
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML =
    '<div class="ai-import-modal-inner web-asset-inner">' +
      '<div class="ai-import-modal-header">' +
        '<span class="ai-import-modal-title" id="web-asset-title"></span>' +
        '<button type="button" class="ai-import-modal-close" id="web-asset-close" title="Close">' + icon("xmark") + "</button>" +
      "</div>" +
      '<div class="web-asset-body"><img id="web-asset-img" alt=""><div id="web-asset-loading">Loading map…</div></div>' +
      '<div class="ai-import-modal-footer">' +
        '<span class="web-asset-source" id="web-asset-source"></span>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="web-asset-cancel">Close</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="web-asset-download">' + icon("download") + "Download SVG</button>" +
      "</div>" +
    "</div>";
  document.body.appendChild(modal);
  var assetImg = document.getElementById("web-asset-img");
  var assetLoading = document.getElementById("web-asset-loading");
  var assetCurrent = null;
  var lastFocus = null;

  function closeAsset() {
    modal.style.display = "none";
    assetImg.removeAttribute("src");
    assetCurrent = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener("ocha-asset-preview", function (e) {
    var d = e.detail || {};
    assetCurrent = d;
    lastFocus = document.activeElement;
    document.getElementById("web-asset-title").textContent = d.title || d.fileName;
    document.getElementById("web-asset-source").textContent = d.source || "";
    assetLoading.textContent = "Loading map…";
    assetLoading.hidden = false;
    assetImg.hidden = true;
    assetImg.onload = function () { assetLoading.hidden = true; assetImg.hidden = false; };
    assetImg.onerror = function () { assetLoading.textContent = "This map couldn't be shown."; };
    assetImg.alt = d.title || "";
    assetImg.src = encodeURI(d.path);
    modal.style.display = "flex";
    document.getElementById("web-asset-download").focus();
  });
  document.getElementById("web-asset-close").addEventListener("click", closeAsset);
  document.getElementById("web-asset-cancel").addEventListener("click", closeAsset);
  modal.addEventListener("click", function (e) { if (e.target === modal) closeAsset(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.style.display === "flex") closeAsset();
  });
  document.getElementById("web-asset-download").addEventListener("click", function () {
    var d = assetCurrent;
    if (!d) return;
    fetch(encodeURI(d.path)).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob();
    }).then(function (blob) {
      downloadBlob(new Blob([blob], { type: "image/svg+xml" }), d.fileName);
      if (d.analyticsEvent && typeof window.sendAnalyticsPing === "function") window.sendAnalyticsPing(d.analyticsEvent);
      closeAsset();
      say("Downloaded " + d.fileName, "success");
    }).catch(function () {
      say("Couldn't download " + d.fileName, "error");
    });
  });

  // ── Resizable panel ─────────────────────────────────────────
  // Drag the panel's right edge (or focus it and use ← →). Double-click
  // resets. The width is remembered in this browser only.
  var PANEL_KEY = "ocha-dataviz-web:panel-width";
  var PANEL_DEFAULT = 440, PANEL_MIN = 360, PREVIEW_MIN = 400;
  var resizer = document.createElement("div");
  resizer.id = "web-resizer";
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", "Resize the panel");
  resizer.tabIndex = 0;
  resizer.title = "Drag to resize · double-click to reset";
  document.body.insertBefore(resizer, aside);

  function maxPanel() { return Math.max(PANEL_MIN, Math.min(760, window.innerWidth - PREVIEW_MIN)); }
  function defaultPanel() { return Math.min(PANEL_DEFAULT, maxPanel()); }
  function setPanel(w, remember) {
    w = Math.round(Math.max(PANEL_MIN, Math.min(maxPanel(), w)));
    document.documentElement.style.setProperty("--web-panel-w", w + "px");
    resizer.setAttribute("aria-valuenow", String(w));
    if (remember) { try { localStorage.setItem(PANEL_KEY, String(w)); } catch (e) { /* storage off */ } }
    return w;
  }
  function savedPanel() {
    try { var v = parseInt(localStorage.getItem(PANEL_KEY), 10); return v > 0 ? v : null; } catch (e) { return null; }
  }
  setPanel(savedPanel() || defaultPanel(), false);
  window.addEventListener("resize", function () { setPanel(savedPanel() || defaultPanel(), false); });

  resizer.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    document.documentElement.classList.add("web-resizing");
    function move(ev) { setPanel(ev.clientX, false); }
    function up(ev) {
      setPanel(ev.clientX, true);
      document.documentElement.classList.remove("web-resizing");
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", up);
      resizer.removeEventListener("pointercancel", up);
    }
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up);
    resizer.addEventListener("pointercancel", up);
  });
  resizer.addEventListener("dblclick", function () {
    try { localStorage.removeItem(PANEL_KEY); } catch (e) { /* storage off */ }
    setPanel(defaultPanel(), false);
  });
  resizer.addEventListener("keydown", function (e) {
    var cur = parseInt(resizer.getAttribute("aria-valuenow"), 10) || defaultPanel();
    if (e.key === "ArrowLeft") { setPanel(cur - 16, true); e.preventDefault(); }
    if (e.key === "ArrowRight") { setPanel(cur + 16, true); e.preventDefault(); }
  });

  // ── Wording that only makes sense in Illustrator ────────────
  document.addEventListener("DOMContentLoaded", function () {
    var donate = document.querySelector(".menu-donate-text");
    if (donate) donate.textContent = "Do you like this free tool?";
    var v = document.getElementById("app-version");
    var wv = document.getElementById("web-version");
    var isBeta = document.documentElement.getAttribute("data-channel") === "beta";
    if (v && wv) wv.textContent = v.textContent + (isBeta ? " · beta" : "");
  });
})();
