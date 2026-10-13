/**
 * Web shell — the parts of the Humanitarian DataViz Tool that exist only in
 * the web version. Everything else (data, chart types, design, text, AI
 * import, themes, save/open JSON) is the plugin's own code, unchanged.
 *
 *   - Layout: the plugin's panel on the left; on the right, where
 *     Illustrator's artboard would be, a live preview of the chart.
 *   - Export: right below the chart, Download SVG (live text, exactly what
 *     the plugin places) and Download PNG at 1×/2×/4× (fonts embedded so
 *     the text matches).
 *     (A Copy button was tried and removed, 8 Oct 2026: SVG code pastes as
 *     text in Word / PowerPoint. See README "Ideas for later".)
 *   - Location maps, icons and flags open in a download window first
 *     (icons and flags: SVG or PNG; icons in a brand colour).
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

/* global DataStore, ZipStore, WEB_ICONS, WebGate, ChartLink */

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
      "</div>" +
    "</div>" +
    '<div id="web-stage">' +
      '<div id="web-empty"><strong>Your chart appears here</strong>' +
        "Add your data in the Data tab — or click <em>Load sample data</em> — " +
        "and pick a chart type. Then download it as SVG or PNG.</div>" +
      // The chart, with its downloads right below it (one place only).
      '<div id="web-output" hidden>' +
        '<div id="web-artboard"></div>' +
        '<div id="web-downloads" role="group" aria-label="Download the chart">' +
          '<div class="web-dl">' +
            '<button type="button" class="btn btn-primary btn-sm" id="web-dl-svg" disabled aria-describedby="web-dl-svg-desc">' +
              icon("file-svg") + "Download SVG</button>" +
            '<span class="web-dl-desc" id="web-dl-svg-desc">Vector: sharp at any size. Editable in Illustrator.</span>' +
          "</div>" +
          '<div class="web-dl">' +
            '<span class="web-png-group">' +
              '<button type="button" class="btn btn-secondary btn-sm" id="web-dl-png" disabled aria-describedby="web-dl-png-desc">' +
                icon("file-image") + "Download PNG</button>" +
              '<select id="web-png-scale" aria-label="PNG size">' +
                '<option value="1">1×</option><option value="2" selected>2×</option><option value="4">4×</option>' +
              "</select>" +
            "</span>" +
            '<span class="web-dl-desc" id="web-dl-png-desc">Image</span>' +
          "</div>" +
        "</div>" +
      "</div>" +
    "</div>" +
    '<div id="web-privacy">' + icon("lock") +
      "<span>Your data stays in this browser. Nothing you paste or upload is sent anywhere.</span></div>";
  document.body.appendChild(aside);

  var artboard = document.getElementById("web-artboard");
  var output = document.getElementById("web-output");
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
    output.hidden = !has;
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
  // Downloads ask for the sign-up first (once per browser): web-gate.js.
  function signInThen(go) { WebGate.requireSignIn(go); }

  btnSvg.addEventListener("click", function () {
    if (!currentSvg) return;
    var svg = currentSvg, type = DataStore.chartType || "unknown";
    var name = baseName(DataStore.chartTitle) + ".svg";
    signInThen(function () {
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), name);
      say("Downloaded " + name, "success");
      count("export:svg:" + type);
    });
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

  // Draw SVG text (shown at w × h) onto a transparent outW × outH canvas
  // and return it as a PNG. Shared by the chart and the asset downloads.
  function svgToPng(svgText, w, h, outW, outH) {
    var url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    var img = new Image();
    img.width = w;
    img.height = h;
    return new Promise(function (resolve, reject) {
      img.onload = function () { resolve(); };
      img.onerror = function () { reject(new Error("This couldn't be drawn as an image.")); };
      img.src = url;
    }).then(function () {
      return img.decode ? img.decode().catch(function () {}) : null;
    }).then(function () {
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(outW);
      canvas.height = Math.round(outH);
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);   // transparent background, like the SVG
      URL.revokeObjectURL(url);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error("PNG export failed.")); }, "image/png");
      });
    });
  }

  function renderPng(svg, scale) {
    return fontCss().then(function (css) {
      var withFonts = stripXmlDecl(svg).replace(/(<svg\b[^>]*>)/, "$1<defs><style>" + css + "</style></defs>");
      var size = svgDimensions(svg);
      return svgToPng(withFonts, size.w, size.h, size.w * scale, size.h * scale);
    });
  }

  // An icon, flag or map as a PNG whose longer side is `longSide` pixels.
  // The SVG is given that pixel size before drawing, so it is drawn sharp
  // rather than enlarged from its small natural size.
  function assetPng(svg, longSide) {
    var text = stripXmlDecl(svg);
    var size = svgDimensions(text);
    var k = longSide / Math.max(size.w, size.h);
    var w = Math.max(1, Math.round(size.w * k)), h = Math.max(1, Math.round(size.h * k));
    var open = (text.match(/<svg\b[^>]*>/) || [""])[0];
    var sized = open.replace(/\s(width|height)="[^"]*"/g, "");
    if (!/\sviewBox=/.test(sized)) sized = sized.replace(/^<svg/, '<svg viewBox="0 0 ' + size.w + " " + size.h + '"');
    sized = sized.replace(/^<svg/, '<svg width="' + w + '" height="' + h + '"');
    return svgToPng(text.replace(open, sized), w, h, w, h);
  }

  btnPng.addEventListener("click", function () {
    if (!currentSvg) return;
    signInThen(downloadPng);
  });
  function downloadPng() {
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
  }

  // ── Open a chart from a link ────────────────────────────────
  // The chart travels in the URL fragment (after #), so it never reaches a
  // server. The link format and its decoding are shared with the plugin
  // (client/chart-link.js: #chart=, #d=, #json=, "&download=…" options);
  // Share chart (plugin and web) makes these links.
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
  // Option "&download=png" / "&download=svg": once the chart is loaded, run
  // exactly what that button does (PNG at the chosen size, 2× by default;
  // the usual sign-up rule applies). Used by the charts connector, whose
  // previews can't save files themselves. Unknown values are ignored; the
  // tab stays on the chart afterwards.
  function autoDownload(kind) {
    var btn = kind === "png" ? btnPng : kind === "svg" ? btnSvg : null;
    if (!btn) return;
    // Let the chart render first (the Load path renders synchronously; an
    // AI-import chart a moment later).
    var tries = 0;
    (function go() {
      if (currentSvg && !btn.disabled) { count("tool:link-download:" + kind); btn.click(); return; }
      if (++tries < 40) setTimeout(go, 100);
    })();
  }
  function openFromHash(hash) {
    var opts = {};
    return ChartLink.read(hash).then(function (r) {
      if (!r) return false;
      var json = r.json;
      opts = r.opts;
      // Not even shaped like JSON (a damaged or truncated link): say so
      // plainly rather than showing a parser error.
      if (!/^\s*[\[{]/.test(json)) throw new Error("not JSON");
      if (isSavedChart(json)) {
        document.dispatchEvent(new CustomEvent("ocha-load-config", { detail: { json: json, label: "the link" } }));
      } else if (!openInAiImport(json)) {
        throw new Error("no AI import box");
      }
      count("tool:link");
      // A multi-chart import waits in the Use AI box for a click; no auto-download.
      if (opts.download && document.getElementById("ai-import-modal").style.display !== "flex") autoDownload(opts.download);
      return true;
    }).catch(function () {
      // Any failure — undecodable, not JSON, no AI box — ends here.
      say("This link doesn't contain a readable chart.", "error");
      return false;
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    if (!/^#(chart|d|json)=/.test(location.hash)) return;   // "&download=…" may follow
    var hash = location.hash;
    // Clear the link from the address bar first, so a reload never
    // re-imports it over the person's edits.
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* file:// */ }
    openFromHash(hash);
  });

  // Exposed for the automated checks (tests/shell/web-check.js).
  window.WebShell = { renderPng: renderPng, assetPng: assetPng, baseName: baseName, openFromHash: openFromHash };

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
    signInThen(function () {
      downloadBlob(ZipStore.build(files), "humanitarian-dataviz-charts.zip");
      count("export:zip:" + files.length);
    });
  });

  // ── Download window for assets (maps, icons, flags) ─────────
  // The maps, icons and flags panels raise "ocha-asset-preview" instead of
  // downloading straight away, so people see the asset and pick options:
  //   maps   SVG only, exactly as ReliefWeb publishes it (no options)
  //   icons  SVG or PNG, in a brand colour
  //   flags  SVG or PNG, official colours (never altered)
  // The last choices are remembered per asset type, and the Download button
  // has focus, so a second download is click + Enter.
  var PNG_SIZES = [                 // longer side, in pixels
    { id: "small", label: "Small", px: 256 },
    { id: "medium", label: "Medium", px: 512 },
    { id: "large", label: "Large", px: 1024 }
  ];
  var ASSET_KEY = "ocha-dataviz-web:asset-options";
  var KIND_OPTIONS = { icon: { formats: true, colour: true }, flag: { formats: true } };

  function savedAssetOptions() {
    try { return JSON.parse(localStorage.getItem(ASSET_KEY)) || {}; } catch (e) { return {}; }
  }
  function rememberAssetOptions(kind, o) {
    var all = savedAssetOptions();
    all[kind] = o;
    try { localStorage.setItem(ASSET_KEY, JSON.stringify(all)); } catch (e) { /* storage off */ }
  }

  // Icon colours: brand colours only, read from the plugin's own swatch
  // lists and styles (chart-registry.js), never retyped here. OCHA blue
  // first (the default), then the selected style's main colour (HNRP
  // orange, Flash Appeal red, GHO yellow; none extra for OCHA), white for dark
  // backgrounds, dark grey, then the active custom theme's icon colours.
  function brandSwatch(name) {
    var R = window.ChartRegistry || {};
    var lists = [R.OCHA_SWATCHES, R.HNRP_SWATCHES, R.FLASH_SWATCHES, R.GHO_SWATCHES];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; lists[i] && j < lists[i].length; j++) {
        if (lists[i][j].name === name) return lists[i][j].hex;
      }
    }
    return null;
  }
  function iconColours() {
    var out = [], seen = {};
    function add(hex, name, slug) {
      if (!hex || seen[hex.toUpperCase()]) return;
      seen[hex.toUpperCase()] = 1;
      out.push({ hex: hex.toUpperCase(), name: name, slug: slug });
    }
    add(brandSwatch("UN Blue"), "OCHA blue", "");
    var R = window.ChartRegistry || {};
    var styleId = typeof DataStore !== "undefined" ? DataStore.style : null;
    var style = styleId && R.STYLES && R.STYLES[styleId];
    if (style && style.colors && style.colors[0]) {
      var main = style.colors[0].toUpperCase(), named = null;
      (R.getSwatches(styleId) || []).forEach(function (sw) { if (!named && sw.hex.toUpperCase() === main) named = sw.name; });
      add(main, style.name + (named ? " " + named.toLowerCase() : ""), styleId);
    }
    add(brandSwatch("White"), "White", "white");
    add(brandSwatch("Dark Grey"), "Dark grey", "dark-grey");
    var theme = R.CUSTOM_THEMES && typeof DataStore !== "undefined" && R.CUSTOM_THEMES[DataStore.style];
    if (theme) {
      (theme.iconPalette || theme.colors || []).forEach(function (hex) {
        add(hex, theme.name + " " + hex.toUpperCase(), hex.replace("#", "").toUpperCase());
      });
    }
    return out;
  }

  var modal = document.createElement("div");
  modal.id = "web-asset-modal";
  modal.className = "ai-import-modal";           // the panel's own modal look
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "web-asset-title");
  modal.innerHTML =
    '<div class="ai-import-modal-inner web-asset-inner">' +
      '<div class="ai-import-modal-header">' +
        '<span class="ai-import-modal-title" id="web-asset-title"></span>' +
        '<button type="button" class="ai-import-modal-close" id="web-asset-close" title="Close">' + icon("xmark") + "</button>" +
      "</div>" +
      '<div class="web-asset-body" id="web-asset-body"><img id="web-asset-img" alt=""><div id="web-asset-loading">Loading…</div></div>' +
      '<div class="web-asset-options" id="web-asset-options">' +
        '<div class="web-asset-row" id="web-asset-format-row">' +
          '<span class="web-asset-label" id="web-asset-format-label">Format</span>' +
          '<div class="ai-import-batch-toggle" role="radiogroup" aria-labelledby="web-asset-format-label">' +
            '<button type="button" class="ai-import-batch-toggle-btn" role="radio" data-format="svg">SVG</button>' +
            '<button type="button" class="ai-import-batch-toggle-btn" role="radio" data-format="png">PNG</button>' +
          "</div>" +
        "</div>" +
        '<div class="web-asset-row" id="web-asset-size-row">' +
          '<span class="web-asset-label" id="web-asset-size-label">Size</span>' +
          '<div class="ai-import-batch-toggle" role="radiogroup" aria-labelledby="web-asset-size-label">' +
            PNG_SIZES.map(function (z) {
              return '<button type="button" class="ai-import-batch-toggle-btn" role="radio" data-size="' + z.id + '">' +
                z.label + " · " + z.px + " px</button>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="web-asset-row" id="web-asset-colour-row">' +
          '<span class="web-asset-label" id="web-asset-colour-label">Colour</span>' +
          '<div class="web-asset-swatches" id="web-asset-swatches" role="radiogroup" aria-labelledby="web-asset-colour-label"></div>' +
          '<span class="web-asset-colour-name" id="web-asset-colour-name"></span>' +
        "</div>" +
      "</div>" +
      '<div class="ai-import-modal-footer">' +
        '<span class="web-asset-source" id="web-asset-source"></span>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="web-asset-cancel">Close</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="web-asset-download"></button>' +
      "</div>" +
    "</div>";
  document.body.appendChild(modal);
  function $a(id) { return document.getElementById(id); }
  function attr(t) { return String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
  var assetImg = $a("web-asset-img");
  var assetLoading = $a("web-asset-loading");
  var assetBody = $a("web-asset-body");
  var assetDl = $a("web-asset-download");
  var assetCurrent = null;      // the event detail
  var assetOpts = null;         // { format, size, colour } for this asset
  var assetBlobUrl = null;
  var lastFocus = null;

  function sizeById(id) {
    for (var i = 0; i < PNG_SIZES.length; i++) if (PNG_SIZES[i].id === id) return PNG_SIZES[i];
    return PNG_SIZES[1];
  }
  function colourByHex(hex) {
    var all = iconColours();
    for (var i = 0; i < all.length; i++) if (all[i].hex === String(hex || "").toUpperCase()) return all[i];
    return all[0];
  }

  // The SVG text for the current asset in the current colour (icons), or
  // null when the file is downloaded as published (flags, maps).
  function assetText() {
    var d = assetCurrent;
    if (d.recolor) return d.recolor(colourByHex(assetOpts.colour).hex);
    return d.text != null ? d.text : null;
  }

  function showAssetImage() {
    var d = assetCurrent, text = assetText();
    if (assetBlobUrl) { URL.revokeObjectURL(assetBlobUrl); assetBlobUrl = null; }
    assetLoading.hidden = false;
    assetImg.hidden = true;
    assetImg.onload = function () { assetLoading.hidden = true; assetImg.hidden = false; };
    assetImg.onerror = function () { assetLoading.textContent = "This couldn't be shown."; };
    if (text != null) {
      assetBlobUrl = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
      assetImg.src = assetBlobUrl;
    } else {
      assetImg.src = encodeURI(d.path);
    }
  }

  function syncAssetOptions() {
    var d = assetCurrent, o = assetOpts, k = KIND_OPTIONS[d.kind] || {};
    $a("web-asset-options").hidden = !k.formats;
    $a("web-asset-size-row").hidden = !k.formats || o.format !== "png";
    $a("web-asset-colour-row").hidden = !k.colour;
    modal.querySelectorAll("[data-format]").forEach(function (b) {
      var on = b.getAttribute("data-format") === o.format;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", String(on));
    });
    modal.querySelectorAll("[data-size]").forEach(function (b) {
      var on = b.getAttribute("data-size") === o.size;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", String(on));
    });
    if (k.colour) {
      var cur = colourByHex(o.colour);
      $a("web-asset-swatches").innerHTML = iconColours().map(function (c) {
        var on = c.hex === cur.hex;
        return '<button type="button" class="icons-color-swatch' + (on ? " active" : "") + '" role="radio" aria-checked="' + on +
          '" data-colour="' + c.hex + '" title="' + attr(c.name) + '" aria-label="' + attr(c.name) + '" style="background:' + c.hex + '"></button>';
      }).join("");
      $a("web-asset-colour-name").textContent = cur.name;
      // A white icon is shown on dark grey, so it can be seen.
      var white = brandSwatch("White"), grey = brandSwatch("Dark Grey");
      assetBody.style.background = (white && cur.hex === white.toUpperCase() && grey) ? grey : "";
    } else {
      assetBody.style.background = "";
    }
    assetDl.innerHTML = icon("download") + "Download " + (k.formats && o.format === "png" ? "PNG" : "SVG");
  }

  // Option clicks (mouse) hand focus back to Download, so Enter downloads.
  modal.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-format],[data-size],[data-colour]");
    if (!b || !assetCurrent) return;
    if (b.hasAttribute("data-format")) assetOpts.format = b.getAttribute("data-format");
    if (b.hasAttribute("data-size")) assetOpts.size = b.getAttribute("data-size");
    var recolour = b.hasAttribute("data-colour");
    if (recolour) assetOpts.colour = b.getAttribute("data-colour");
    syncAssetOptions();
    if (recolour) showAssetImage();
    if (e.detail > 0) assetDl.focus();
  });

  function closeAsset() {
    modal.style.display = "none";
    assetImg.removeAttribute("src");
    if (assetBlobUrl) { URL.revokeObjectURL(assetBlobUrl); assetBlobUrl = null; }
    assetCurrent = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener("ocha-asset-preview", function (e) {
    var d = e.detail || {};
    d.kind = d.kind || "map";
    assetCurrent = d;
    var saved = savedAssetOptions()[d.kind] || {};
    assetOpts = {
      format: saved.format === "png" ? "png" : "svg",
      size: sizeById(saved.size).id,
      colour: colourByHex(saved.colour).hex
    };
    lastFocus = document.activeElement;
    $a("web-asset-title").textContent = d.title || d.fileName;
    $a("web-asset-source").textContent = d.source || "";
    modal.querySelector(".web-asset-inner").classList.toggle("is-compact", d.kind !== "map");
    assetLoading.textContent = "Loading…";
    assetImg.alt = d.title || "";
    syncAssetOptions();
    showAssetImage();
    modal.style.display = "flex";
    assetDl.focus();
  });
  $a("web-asset-close").addEventListener("click", closeAsset);
  $a("web-asset-cancel").addEventListener("click", closeAsset);
  modal.addEventListener("click", function (e) { if (e.target === modal) closeAsset(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.style.display === "flex") closeAsset();
  });
  assetDl.addEventListener("click", function () {
    var d = assetCurrent;
    if (!d) return;
    var o = { format: assetOpts.format, size: assetOpts.size, colour: assetOpts.colour };
    if (KIND_OPTIONS[d.kind]) rememberAssetOptions(d.kind, o);
    signInThen(function () { downloadAsset(d, o); });
  });

  // The file name: the asset's own name, plus the colour (icons other than
  // OCHA blue) and the pixel size (PNG).
  function assetFileName(d, o) {
    var base = String(d.fileName).replace(/\.svg$/i, "");
    if (d.recolor) {
      var slug = colourByHex(o.colour).slug;
      if (slug) base += "-" + slug;
    }
    if (o.format === "png" && KIND_OPTIONS[d.kind]) return base + "-" + sizeById(o.size).px + "px.png";
    return base + ".svg";
  }

  function downloadAsset(d, o) {
    var name = assetFileName(d, o);
    var asPng = o.format === "png" && !!KIND_OPTIONS[d.kind];
    var text = d.recolor ? d.recolor(colourByHex(o.colour).hex) : d.text;
    // Flags and maps download as published: the file's own bytes for SVG.
    var source = text != null
      ? Promise.resolve(asPng ? text : new Blob([text], { type: "image/svg+xml" }))
      : fetch(encodeURI(d.path)).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return asPng ? r.text() : r.blob().then(function (b) { return new Blob([b], { type: "image/svg+xml" }); });
        });
    if (asPng) say("Preparing PNG…");
    source.then(function (x) {
      return asPng ? assetPng(x, sizeById(o.size).px) : x;
    }).then(function (blob) {
      downloadBlob(blob, name);
      if (d.analyticsEvent) count(d.analyticsEvent);
      closeAsset();
      say("Downloaded " + name, "success");
    }).catch(function () {
      say("Couldn't download " + name, "error");
    });
  }

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
    // Save & share (index.html carries the plugin's wording). On the web
    // the link opens right here, Save as file is a download, Load / Import
    // uploads, and the page doesn't keep the chart, so a link or a file is
    // how you come back to it. Each claim matches what the web code does.
    var WEB_TEXT = {
      "share-chart-intro": "Paste this link in Teams or an email: whoever clicks it sees the chart and can edit " +
        "it in their browser.",
      "save-chart-file-desc": "Downloads the chart as a small file. Keep it, or send it as an attachment; open " +
        "it again with <strong>Load / Import</strong>, in the web version or the plugin for Illustrator.",
      "save-share-help-share": "Makes a link that opens this chart in the web version. Paste it in Teams or an " +
        "email: whoever clicks it sees the chart and can edit it in their browser. A very big chart doesn’t fit " +
        "in a link: save a file instead.",
      "save-share-help-save": "<strong>Save as file (.json)</strong> downloads the chart as a small file: keep it, or send it as " +
        "an attachment. <strong>Copy JSON code</strong> copies the same chart as text, for an AI assistant or for someone to " +
        "paste into Load / Import; in Teams or an email it shows as code, not as a chart.",
      "save-share-help-load": "Brings a chart back exactly as it was: upload a chart file, or paste a chart link " +
        "or JSON code.",
      "save-share-help-note": "This page doesn’t keep your chart when you close or reload it: keep a link or a " +
        "file to come back to it. Links, chart files and JSON code open in both the web version and the plugin " +
        "for Illustrator. A chart file isn’t the SVG or PNG picture: it holds the chart’s data and settings, for " +
        "editing it again."
    };
    // Fixed strings written here (never user input), so innerHTML is safe
    // and keeps the bold names the plugin's wording has too.
    Object.keys(WEB_TEXT).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = WEB_TEXT[id];
    });
    var shareWin = document.getElementById("share-chart-modal");
    if (shareWin) shareWin.setAttribute("data-done", "Link copied. Paste it in Teams or an email: it opens this chart in the web version.");
    var v = document.getElementById("app-version");
    var wv = document.getElementById("web-version");
    var isBeta = document.documentElement.getAttribute("data-channel") === "beta";
    if (v && wv) wv.textContent = v.textContent + (isBeta ? " · beta" : "");
  });
})();
