/**
 * IconsPanel — Humanitarian Icons gallery & placement.
 * Downloads all ~389 icons (~400KB) from GitHub on first use,
 * stores them in icons-cache/ alongside metadata.
 * Organized by family with search and filter chips.
 *
 * Architecture:
 *   - metadata.json fetched from GitHub, cached locally
 *   - All SVGs bulk-downloaded on first use or update (~400KB)
 *   - Subsequent uses read from cache (no network needed)
 *   - ExtendScript placeIcon() places SVG on active artboard
 */

/* global Connector, PanelUtils */

var IconsPanel = (function () {
  "use strict";

  // File access through the shell's Connector (disk in Illustrator)
  var _fs = (typeof Connector !== "undefined") ? Connector.fs : null;

  var GITHUB_RAW = HttpUtils.URLS.GITHUB_ICONS_RAW;
  var METADATA_URL = HttpUtils.URLS.ICONS_METADATA;

  var metadata = null;       // Parsed metadata.json {meta, families, icons}
  var iconList = [];         // Array of {key, name, family} sorted by name
  var families = [];         // Array of family names from metadata
  var activeFamilies = [];   // Empty = All; array of selected family names
  var activeColor = "#009EDB"; // Default UN Blue; updated from style swatches
  var colorBarEl = null;
  var panelEl = null;
  var listEl = null;
  var searchEl = null;
  var familyBar = null;
  var statusEl = null;
  var progressEl = null;
  var progressBar = null;
  var progressText = null;
  var isOpen = false;
  var csInterface = null;
  var cacheDir = "";         // Full native path to icons-cache/
  var metaCachePath = "";    // Full path to cached metadata.json

  // ── Initialization ─────────────────────────────────────

  function init() {
    panelEl = document.getElementById("icons-panel");
    listEl = document.getElementById("icons-list");
    searchEl = document.getElementById("icons-search");
    familyBar = document.getElementById("icons-family-bar");
    statusEl = document.getElementById("icons-status");
    progressEl = document.getElementById("icons-progress");
    progressBar = document.getElementById("icons-progress-bar");
    progressText = document.getElementById("icons-progress-text");

    if (!panelEl) return;

    // Illustrator bridge (null in the web shell, where nothing is placed)
    csInterface = Connector.illustrator;

    // Resolve cache directory
    if (Connector.paths.icons) {
      cacheDir = Connector.paths.icons;
      metaCachePath = cacheDir + "/metadata.json";
    }

    // Color swatch bar
    colorBarEl = document.getElementById("icons-color-bar");

    // Load cached metadata (or fetch if first run)
    loadMetadata();

    // Event listeners
    if (searchEl) {
      searchEl.addEventListener("input", renderList);
    }

    // Family filter bar — multi-select
    if (familyBar) {
      familyBar.addEventListener("click", function (evt) {
        var chip = evt.target.closest(".icons-family-chip");
        if (!chip) return;
        var family = chip.getAttribute("data-family") || "";

        if (!family) {
          // "All" chip — toggle all on/off
          var allActive = activeFamilies.length === families.length || activeFamilies.length === 0;
          activeFamilies = allActive ? [] : families.slice();
        } else {
          var idx = activeFamilies.indexOf(family);
          if (idx !== -1) {
            activeFamilies.splice(idx, 1);
          } else {
            activeFamilies.push(family);
          }
        }
        syncFamilyUI();
        renderList();
      });
    }

    // Family expand/collapse toggle
    var familyWrap = document.getElementById("icons-family-wrap");
    var familyToggle = document.getElementById("icons-family-toggle");
    if (familyToggle && familyWrap) {
      familyToggle.addEventListener("click", function () {
        familyWrap.classList.toggle("expanded");
      });
    }

    // Close button
    var closeBtn = document.getElementById("btn-icons-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", close);
    }

    // Update button
    var updateBtn = document.getElementById("btn-icons-update");
    if (updateBtn) {
      updateBtn.addEventListener("click", function () { updateAll(true); });
    }
  }

  // ── Metadata loading ────────────────────────────────────

  function loadMetadata() {
    var fs;
    fs = _fs;

    // Try cached file first
    if (fs && metaCachePath) {
      try {
        if (fs.exists(metaCachePath)) {
          var raw = fs.readText(metaCachePath);
          metadata = JSON.parse(raw);
          buildIconList();
          buildFamilyChips();
          renderList();
          setStatus(iconList.length + " icons · v" + (metadata.meta.version || "?") + " · " + (metadata.meta.last_updated || ""));
          return;
        }
      } catch (e) {
        // Fall through to fetch
      }
    }

    // No cache — fetch from GitHub
    fetchMetadata(function (err) {
      if (err) {
        setStatus("Could not load icons: " + err, true);
      }
    });
  }

  function fetchMetadata(callback) {
    showProgress("Fetching icon metadata…", -1);

    httpsGet(METADATA_URL, function (err, body) {
      if (err) {
        hideProgress();
        callback(err);
        return;
      }
      try {
        metadata = JSON.parse(body);
      } catch (e) {
        hideProgress();
        callback("Invalid metadata: " + e.message);
        return;
      }

      // Save to cache
      saveMetadata();
      buildIconList();
      buildFamilyChips();
      renderList();
      hideProgress();
      setStatus(iconList.length + " icons · v" + (metadata.meta.version || "?"));
      callback(null);
    });
  }

  function saveMetadata() {
    var fs;
    fs = _fs;
    if (!fs) return;
    try {
      fs.mkdirp(cacheDir);
      fs.writeText(metaCachePath, JSON.stringify(metadata, null, 2));
    } catch (e) {
      // Best-effort
    }
  }

  function buildIconList() {
    iconList = [];
    families = metadata.families || [];
    var icons = metadata.icons || {};
    var keys = Object.keys(icons);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var icon = icons[key];
      iconList.push({
        key: key,
        name: icon.name || key.replace(/-/g, " "),
        family: icon.family || "Other"
      });
    }
    // Sort alphabetically by name
    iconList.sort(function (a, b) {
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
  }

  // ── Family filter chips ──────────────────────────────────

  function buildFamilyChips() {
    if (!familyBar) return;
    var html = '<label class="icons-family-chip active" data-family="">' +
      '<svg class="icons-check" viewBox="0 0 18 18"><path d="M3.5 9l3.5 3.5L14.5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<span>All</span></label>';
    for (var i = 0; i < families.length; i++) {
      html += '<label class="icons-family-chip" data-family="' + escapeAttr(families[i]) + '">' +
        '<svg class="icons-check" viewBox="0 0 18 18"><path d="M3.5 9l3.5 3.5L14.5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<span>' + escapeHtml(families[i]) + '</span></label>';
    }
    familyBar.innerHTML = html;
  }

  function syncFamilyUI() {
    if (!familyBar) return;
    var allActive = activeFamilies.length === families.length || activeFamilies.length === 0;
    var chips = familyBar.querySelectorAll(".icons-family-chip");
    for (var i = 0; i < chips.length; i++) {
      var f = chips[i].getAttribute("data-family") || "";
      if (!f) {
        chips[i].classList.toggle("active", allActive);
      } else {
        chips[i].classList.toggle("active", activeFamilies.indexOf(f) !== -1);
      }
    }
  }

  // ── Color swatches ──────────────────────────────────────

  // The active chart style's MAIN colour (OCHA blue, HNRP orange, Flash red,
  // GHO gold) — the first entry of the style palette, which is also present in
  // the swatch ramp so the bar highlights it. Icon previews default to this so
  // they follow the selected theme.
  function styleMainColor() {
    var style = (typeof DataStore !== "undefined" && DataStore.style) ? DataStore.style : "ocha";
    if (typeof ChartRegistry !== "undefined" && ChartRegistry.getStyle) {
      var st = ChartRegistry.getStyle(style);
      if (st && st.colors && st.colors[0]) return st.colors[0];
    }
    return "#009EDB";
  }

  function buildColorSwatches() {
    if (!colorBarEl) return;
    var style = (typeof DataStore !== "undefined" && DataStore.style) ? DataStore.style : "ocha";
    var swatches = (typeof ChartRegistry !== "undefined") ? ChartRegistry.getSwatches(style) : [
      { hex: "#009EDB", name: "UN Blue" }
    ];

    var html = '<span class="icons-color-label">Color</span>';
    for (var i = 0; i < swatches.length; i++) {
      var sw = swatches[i];
      var isActive = sw.hex.toUpperCase() === activeColor.toUpperCase();
      html += '<button class="icons-color-swatch' + (isActive ? ' active' : '') +
        '" data-color="' + sw.hex +
        '" title="' + escapeAttr(sw.name) +
        '" style="background:' + sw.hex + ';"></button>';
    }
    colorBarEl.innerHTML = html;

    // Click handler (delegated)
    colorBarEl.onclick = function (evt) {
      var swatch = evt.target.closest(".icons-color-swatch");
      if (!swatch) return;
      activeColor = swatch.getAttribute("data-color") || "#009EDB";
      syncColorUI();
      tintPreviews();
    };
  }

  function syncColorUI() {
    if (!colorBarEl) return;
    var swatches = colorBarEl.querySelectorAll(".icons-color-swatch");
    for (var i = 0; i < swatches.length; i++) {
      var c = swatches[i].getAttribute("data-color") || "";
      swatches[i].classList.toggle("active", c.toUpperCase() === activeColor.toUpperCase());
    }
  }

  /** Apply selected color tint to all visible SVG previews via CSS filter */
  function tintPreviews() {
    if (!listEl) return;
    var previews = listEl.querySelectorAll(".icons-item-preview svg");
    for (var i = 0; i < previews.length; i++) {
      // Replace fill in inline SVG style elements
      var styles = previews[i].querySelectorAll("style");
      for (var s = 0; s < styles.length; s++) {
        styles[s].textContent = styles[s].textContent.replace(/#[0-9a-fA-F]{6}/g, activeColor);
      }
      // Also replace direct fill attributes
      var filled = previews[i].querySelectorAll("[fill]");
      for (var f = 0; f < filled.length; f++) {
        var val = filled[f].getAttribute("fill");
        if (val && val !== "none" && val !== "currentColor") {
          filled[f].setAttribute("fill", activeColor);
        }
      }
      // And class-based fills via style
      var classed = previews[i].querySelectorAll("[class]");
      for (var c = 0; c < classed.length; c++) {
        classed[c].style.fill = activeColor;
      }
    }
  }

  /**
   * Recolor an SVG file: replace the default OCHA blue fill with the active color.
   * Writes a temp file and returns its path.
   */
  // Replace the default OCHA blue fill (style blocks and attributes) with
  // the active colour. Pure text in, text out — shared by both shells.
  function recolorSvgText(svg) {
    return svg.replace(/#009[eE][dD][bB]/g, activeColor);
  }

  function recolorSvg(originalPath) {
    if (activeColor.toUpperCase() === "#009EDB") return originalPath; // default, no change
    try {
      var fs = _fs;
      var svg = fs.readText(originalPath);
      svg = recolorSvgText(svg);
      var tempPath = cacheDir + "/_temp_recolored_" + Date.now() + ".svg";
      fs.writeText(tempPath, svg);
      // Clean up old temp files (keep only this one)
      try {
        var entries = fs.list(cacheDir);
        for (var ti = 0; ti < entries.length; ti++) {
          if (entries[ti].indexOf("_temp_recolored_") === 0 && entries[ti] !== tempPath.split("/").pop()) {
            fs.remove(cacheDir + "/" + entries[ti]);
          }
        }
      } catch (cleanErr) { /* ignore cleanup errors */ }
      return tempPath;
    } catch (e) {
      return originalPath; // fallback to original
    }
  }

  // ── Rendering ──────────────────────────────────────────

  // ── Recent icons (localStorage) ─────────────────────────
  // Humanitarian work reuses the same handful of icons constantly, so the
  // most-recently-placed ones get pinned in a "Recent" row at the top.
  var RECENT_KEY = "ocha_dataviz_recent_icons";
  var RECENT_MAX = 8;
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
  }
  function pushRecent(key) {
    try {
      var arr = getRecent().filter(function (k) { return k !== key; });
      arr.unshift(key);
      if (arr.length > RECENT_MAX) arr = arr.slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  function recentGroupHtml() {
    var recents = getRecent();
    if (!recents.length) return "";
    var items = [];
    for (var r = 0; r < recents.length; r++) {
      for (var ri = 0; ri < iconList.length; ri++) {
        if (iconList[ri].key === recents[r]) { items.push(iconList[ri]); break; }
      }
    }
    if (!items.length) return "";
    var h = '<div class="icons-family-group icons-recent-group">';
    h += '<div class="icons-family-label">Recent</div><div class="icons-grid">';
    for (var i = 0; i < items.length; i++) {
      var ic = items[i], cached = isCached(ic.key);
      // No per-item preview id here (the main grid owns those ids) to avoid
      // duplicate-id collisions; recents are cached, so they render inline.
      h += '<button class="icons-item' + (cached ? "" : " icons-item-uncached") + '" data-key="' + escapeAttr(ic.key) + '" title="' + escapeAttr(ic.name) + '">';
      h += '<div class="icons-item-preview">' + (cached ? getSvgInline(ic.key) : '<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="none"/></svg>') + '</div>';
      h += '<span class="icons-item-name">' + escapeHtml(ic.name) + '</span></button>';
    }
    h += '</div></div>';
    return h;
  }

  var previewsReady = false;

  function renderList() {
    if (!listEl) return;
    // Web: draw the list only once the panel is open and the icon files
    // have arrived (see PanelUtils.whenFolderReady). Illustrator: as before.
    if (!Connector.fs.local) {
      if (!isOpen) return;
      if (!previewsReady) {
        listEl.innerHTML = '<div class="icons-empty">Loading icons…</div>';
        PanelUtils.whenFolderReady(cacheDir, function () { previewsReady = true; renderList(); });
        return;
      }
    }
    var query = (searchEl ? searchEl.value : "").toLowerCase().trim();

    // Group by family
    var grouped = {};
    var familyOrder = [];

    for (var i = 0; i < iconList.length; i++) {
      var icon = iconList[i];

      // Family filter — skip if not in active set (unless all selected)
      var allSelected = activeFamilies.length === 0 || activeFamilies.length === families.length;
      if (!allSelected && activeFamilies.indexOf(icon.family) === -1) continue;

      // Search filter
      if (query) {
        var nameMatch = icon.name.toLowerCase().indexOf(query) !== -1;
        var keyMatch = icon.key.toLowerCase().indexOf(query) !== -1;
        if (!nameMatch && !keyMatch) continue;
      }

      if (!grouped[icon.family]) {
        grouped[icon.family] = [];
        familyOrder.push(icon.family);
      }
      grouped[icon.family].push(icon);
    }

    if (familyOrder.length === 0) {
      listEl.innerHTML = '<div class="icons-empty">No icons found</div>';
      return;
    }

    // Sort families to match metadata order
    familyOrder.sort(function (a, b) {
      var ia = families.indexOf(a);
      var ib = families.indexOf(b);
      if (ia === -1) ia = 999;
      if (ib === -1) ib = 999;
      return ia - ib;
    });

    var html = "";
    for (var f = 0; f < familyOrder.length; f++) {
      var family = familyOrder[f];
      var icons = grouped[family];
      html += '<div class="icons-family-group">';
      html += '<div class="icons-family-label">' + escapeHtml(family) + ' <span class="icons-family-count">' + icons.length + '</span></div>';
      html += '<div class="icons-grid">';
      for (var j = 0; j < icons.length; j++) {
        var ic = icons[j];
        var svgCached = isCached(ic.key);
        html += '<button class="icons-item' + (svgCached ? "" : " icons-item-uncached") + '" data-key="' + escapeAttr(ic.key) + '" title="' + escapeAttr(ic.name) + '">';
        html += '<div class="icons-item-preview" id="icon-preview-' + escapeAttr(ic.key) + '">';
        if (svgCached) {
          html += getSvgInline(ic.key);
        } else {
          // Placeholder — will show after download
          html += '<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="none"/></svg>';
        }
        html += '</div>';
        html += '<span class="icons-item-name">' + escapeHtml(ic.name) + '</span>';
        html += '</button>';
      }
      html += '</div></div>';
    }
    // Pin recently-used icons at the top (only when not searching).
    listEl.innerHTML = (query ? "" : recentGroupHtml()) + html;

    // Attach click handlers
    var buttons = listEl.querySelectorAll(".icons-item");
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].addEventListener("click", onIconClick);
    }

    // Apply active color tint to previews
    if (activeColor.toUpperCase() !== "#009EDB") {
      tintPreviews();
    }
  }

  // ── Icon click / placement ──────────────────────────────

  function onIconClick(evt) {
    var btn = evt.currentTarget;
    var key = btn.getAttribute("data-key");
    if (!key) return;

    // Find icon info
    var icon = null;
    for (var i = 0; i < iconList.length; i++) {
      if (iconList[i].key === key) { icon = iconList[i]; break; }
    }
    if (!icon) return;

    btn.classList.add("icons-item-loading");
    setStatus((csInterface ? "Placing " : "Preparing ") + icon.name + "…");

    ensureCached(key, function (err, svgPath) {
      btn.classList.remove("icons-item-loading");
      if (err) {
        setStatus(err, true);
        return;
      }

      // Update preview if it was a placeholder
      var preview = document.getElementById("icon-preview-" + key);
      if (preview) {
        preview.innerHTML = getSvgInline(key);
      }
      btn.classList.remove("icons-item-uncached");

      if (!csInterface) {
        // Web shell: download the icon, in the colour picked in the panel.
        var text;
        try { text = recolorSvgText(_fs.readText(svgPath)); } catch (e) { text = null; }
        PanelUtils.downloadSvgAsset(svgPath, key + ".svg", text, function (dlErr) {
          if (dlErr) { setStatus(dlErr, true); return; }
          setStatus(icon.name + " downloaded");
          pushRecent(key);
          if (typeof sendAnalyticsPing === "function") sendAnalyticsPing("tool:icons");
        });
        return;
      }

      // Recolor SVG if a non-default color is selected
      var placePath = recolorSvg(svgPath);
      placeIcon(placePath, icon.name, function (placeErr) {
        if (placeErr) {
          setStatus((placeErr || "").replace(/^ERROR:\s*/i, ""), true);
        } else {
          setStatus(icon.name + " placed");
          pushRecent(key);   // remember for the Recent row (next render)
        }
      });
    });
  }

  function placeIcon(svgPath, iconName, callback) {
    if (!csInterface) {
      callback("Not running in Illustrator.");
      return;
    }
    var escapedPath = svgPath.replace(/\\/g, "/").replace(/'/g, "\\'");
    var escapedName = (iconName || "").replace(/'/g, "\\'");
    var script = "placeIcon('" + escapedPath + "', '" + escapedName + "')";
    csInterface.evalScript(script, function (result) {
      if (result && result.indexOf("ERROR") === 0) {
        callback(result);
      } else {
        callback(null);
        if (typeof sendAnalyticsPing === "function") sendAnalyticsPing("tool:icons");
      }
    });
  }

  // ── SVG cache ──────────────────────────────────────────

  function ensureCacheDir() {
    var fs = _fs;
    try {
      fs.mkdirp(cacheDir);
    } catch (e) { /* already exists */ }
  }

  function svgPath(key) {
    return cacheDir + "/" + key + ".svg";
  }

  function isCached(key) {
    try {
      var fs = _fs;
      return fs.exists(svgPath(key));
    } catch (e) {
      return false;
    }
  }

  function getSvgInline(key) {
    try {
      var fs = _fs;
      var content = fs.readText(svgPath(key));
      return content;
    } catch (e) {
      return '<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="none"/></svg>';
    }
  }

  function ensureCached(key, callback) {
    var path = svgPath(key);
    try {
      var fs = _fs;
      if (fs.exists(path)) {
        callback(null, path);
        return;
      }
    } catch (e) { /* continue to download */ }

    // Download single icon
    var url = GITHUB_RAW + "/svg/" + encodeURIComponent(key) + ".svg";
    ensureCacheDir();

    httpsGet(url, function (err, body) {
      if (err) {
        callback("Download failed: " + err);
        return;
      }
      try {
        var fs = _fs;
        fs.writeText(path, body);
        callback(null, path);
      } catch (e) {
        callback("Save failed: " + e.message);
      }
    });
  }

  // ── Bulk download all icons ────────────────────────────

  function downloadAll(callback) {
    if (!metadata || !metadata.icons) {
      callback("No metadata loaded.");
      return;
    }
    ensureCacheDir();
    var fs = _fs;
    var keys = Object.keys(metadata.icons);

    // Filter to uncached only
    var toDownload = [];
    for (var i = 0; i < keys.length; i++) {
      if (!fs.exists(svgPath(keys[i]))) {
        toDownload.push(keys[i]);
      }
    }

    if (toDownload.length === 0) {
      callback(null, 0);
      return;
    }

    var done = 0;
    var errors = 0;
    var total = toDownload.length;
    // Download in batches of 10 concurrent
    var concurrency = 10;
    var index = 0;

    function next() {
      if (index >= total) {
        if (done + errors >= total) {
          callback(null, done);
        }
        return;
      }
      var key = toDownload[index++];
      var url = GITHUB_RAW + "/svg/" + encodeURIComponent(key) + ".svg";
      var dest = svgPath(key);

      httpsGet(url, function (err, body) {
        if (!err) {
          try {
            fs.writeText(dest, body);
            done++;
          } catch (e) {
            errors++;
          }
        } else {
          errors++;
        }

        var pct = Math.round(((done + errors) / total) * 100);
        showProgress("Downloading icons… " + (done + errors) + "/" + total, pct);

        if (done + errors >= total) {
          hideProgress();
          renderList(); // refresh previews
          callback(null, done);
        } else {
          next();
        }
      });
    }

    showProgress("Downloading icons… 0/" + total, 0);
    for (var c = 0; c < Math.min(concurrency, total); c++) {
      next();
    }
  }

  // ── Auto-check for new icons on GitHub ──────────────────

  function checkForUpdates() {
    if (!metadata || !metadata.meta) return;
    var localVersion = metadata.meta.last_updated || "";

    // Fetch remote metadata silently to compare versions
    httpsGet(METADATA_URL, function (err, body) {
      if (err) return; // silent — don't bother user if offline
      try {
        var remote = JSON.parse(body);
        var remoteVersion = remote.meta && remote.meta.last_updated || "";
        if (remoteVersion && remoteVersion !== localVersion) {
          // Show badge on Update button
          var updateBtn = document.getElementById("btn-icons-update");
          if (updateBtn) {
            updateBtn.classList.add("icons-update-available");
            updateBtn.title = "New icons available (updated " + remoteVersion + ")";
          }
        }
      } catch (e) { /* silent */ }
    });
  }

  // ── Update (re-fetch metadata + all SVGs) ───────────────

  function updateAll(userTriggered) {
    var updateBtn = document.getElementById("btn-icons-update");
    if (updateBtn) {
      updateBtn.disabled = true;
      updateBtn.classList.add("icons-update-loading");
    }

    // Clear SVG cache
    clearCache();

    fetchMetadata(function (err) {
      if (err) {
        setStatus("Update failed: " + err, true);
        if (updateBtn) { updateBtn.disabled = false; updateBtn.classList.remove("icons-update-loading"); }
        return;
      }

      // Bulk download all SVGs
      downloadAll(function (dlErr, count) {
        if (updateBtn) { updateBtn.disabled = false; updateBtn.classList.remove("icons-update-loading"); }
        if (dlErr) {
          setStatus("Update failed: " + dlErr, true);
        } else {
          setStatus("Updated: " + iconList.length + " icons (" + (count || 0) + " downloaded)");
          // Clear "new icons available" badge
          if (updateBtn) updateBtn.classList.remove("icons-update-available");
        }
      });
    });
  }

  function clearCache() {
    var fs;
    fs = _fs;
    if (!fs) return;
    try {
      if (fs.exists(cacheDir)) {
        var files = fs.list(cacheDir);
        for (var i = 0; i < files.length; i++) {
          try { fs.remove(cacheDir + "/" + files[i]); } catch (e) { /* skip */ }
        }
      }
    } catch (e) { /* best-effort */ }
  }

  // ── Panel visibility ───────────────────────────────────

  function open() {
    if (!panelEl) return;
    panelEl.classList.add("icons-panel-visible");
    isOpen = true;
    setMainUIVisible(false);

    if (searchEl) {
      searchEl.value = "";
      searchEl.focus();
    }
    activeFamilies = [];
    activeColor = styleMainColor(); // follow the selected chart style's main colour
    syncFamilyUI();
    buildColorSwatches();
    // Collapse family chips to single row
    var familyWrap = document.getElementById("icons-family-wrap");
    if (familyWrap) familyWrap.classList.remove("expanded");
    setStatus("");
    renderList();

    // The web version ships the icon set with each release and can't write
    // a cache, so the GitHub update check and auto-download are plugin-only.
    if (!_fs || !_fs.writable) return;

    // Check if newer icons are available on GitHub
    checkForUpdates();

    // If icons not yet downloaded, auto-download all
    if (metadata && !allCached()) {
      downloadAll(function (err, count) {
        if (!err && count > 0) {
          setStatus(iconList.length + " icons ready");
        }
      });
    }
  }

  function allCached() {
    try {
      var fs = _fs;
      var keys = Object.keys(metadata.icons || {});
      for (var i = 0; i < keys.length; i++) {
        if (!fs.exists(svgPath(keys[i]))) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function close() {
    if (!panelEl) return;
    panelEl.classList.remove("icons-panel-visible");
    isOpen = false;
    setMainUIVisible(true);
  }

  function toggle() {
    if (isOpen) close(); else open();
  }

  function setMainUIVisible(show) {
    var display = show ? "" : "none";
    var tabBar = document.getElementById("tab-bar");
    var panelBody = document.getElementById("panel-body");
    var bottomBar = document.getElementById("bottom-bar");
    if (tabBar) tabBar.style.display = display;
    if (panelBody) panelBody.style.display = display;
    if (bottomBar) bottomBar.style.display = display;
  }

  // ── Utilities ──────────────────────────────────────────

  function setStatus(msg, isError) {
    if (!statusEl) return;
    if (!msg) { statusEl.textContent = ""; statusEl.className = "panel-status"; return; }
    // Leading icon (check / exclamation) to match the main status banner.
    var icon = (typeof StatusUI !== "undefined") ? StatusUI.iconFor(isError ? "error" : "success") : "";
    var text = (typeof StatusUI !== "undefined") ? StatusUI.escape(msg) : msg;
    statusEl.innerHTML = icon + '<span class="panel-status-text">' + text + '</span>';
    statusEl.className = "panel-status" + (isError ? " panel-status--error" : "");
  }

  function showProgress(label, pct) {
    if (!progressEl) return;
    progressEl.style.display = "";
    if (progressText) progressText.textContent = label || "Downloading…";
    if (progressBar) {
      if (pct < 0) {
        progressBar.style.width = "100%";
        progressBar.classList.add("icons-progress-indeterminate");
      } else {
        progressBar.classList.remove("icons-progress-indeterminate");
        progressBar.style.width = Math.min(100, pct) + "%";
      }
    }
  }

  function hideProgress() {
    if (!progressEl) return;
    progressEl.style.display = "none";
    if (progressBar) {
      progressBar.style.width = "0%";
      progressBar.classList.remove("icons-progress-indeterminate");
    }
  }

  /** Simple HTTPS GET helper (follows one redirect) */
  // Delegate to shared HttpUtils
  var httpsGet = HttpUtils.get;
  var escapeHtml = HttpUtils.escapeHtml;
  var escapeAttr = HttpUtils.escapeAttr;

  // ── Public API ─────────────────────────────────────────

  /** Rebuild color swatches from the current style (call when style changes).
   *  The style change also moves the active colour to the new theme's main
   *  colour, so the icon previews follow the selected theme. */
  function refreshColors() {
    activeColor = styleMainColor();
    buildColorSwatches();
    if (isOpen) tintPreviews();
  }

  return {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    refreshColors: refreshColors,
    getIconList: function () { return iconList; }
  };
})();
