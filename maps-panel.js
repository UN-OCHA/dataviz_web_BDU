/**
 * MapsPanel — Location map browser & placement for Humanitarian DataViz Tool.
 * Loads maps-catalog.json, provides search/filter UI, fetches SVGs
 * from ReliefWeb on demand, caches locally, and places via ExtendScript.
 *
 * Architecture:
 *   - Catalog (maps-catalog.json) ships with the plugin (~15KB, 215 entries)
 *   - SVGs are fetched from reliefweb.int on first use, cached in maps-cache/
 *   - Subsequent uses read from cache (no network needed)
 *   - ExtendScript placeMap() centers the SVG on the active artboard
 */

/* global Connector, PanelUtils */

var MapsPanel = (function () {
  "use strict";

  var catalog = [];        // Array of {name, code, url, region, note?}
  var panelEl = null;      // The slide-down panel element
  var listEl = null;       // The scrollable results container
  var searchEl = null;     // Search input
  var regionBar = null;    // Region button bar
  var ALL_REGIONS = ["Africa", "Asia", "Central and South America", "Europe", "Middle East", "North America", "Pacific"];
  var activeRegions = [];  // Array of active region names; empty or all = show everything
  var statusEl = null;     // Status message element
  var progressEl = null;   // Progress bar container
  var progressBar = null;  // Progress bar fill element
  var progressText = null; // Progress label text
  var isOpen = false;
  var csInterface = null;
  var cacheDir = "";       // Full native path to maps-cache/

  // ── Initialization ─────────────────────────────────────

  function init() {
    panelEl = document.getElementById("maps-panel");
    listEl = document.getElementById("maps-list");
    searchEl = document.getElementById("maps-search");
    regionBar = document.getElementById("maps-region-bar");
    statusEl = document.getElementById("maps-status");
    progressEl = document.getElementById("maps-progress");
    progressBar = document.getElementById("maps-progress-bar");
    progressText = document.getElementById("maps-progress-text");

    if (!panelEl) return;

    // Illustrator bridge for ExtendScript calls (null in the web shell)
    csInterface = Connector.illustrator;

    // Cache directory for downloaded maps
    cacheDir = Connector.paths.mapsCache;

    // Load catalog
    loadCatalog();

    // Default: neutral "All" (empty = show everything; only the All chip is
    // marked, not every region — a checkmark on all chips is meaningless).
    activeRegions = [];

    // Event listeners
    searchEl.addEventListener("input", renderList);

    // Region button bar — multi-select toggle
    if (regionBar) {
      var regionBtns = regionBar.querySelectorAll(".maps-region-chip");
      for (var i = 0; i < regionBtns.length; i++) {
        regionBtns[i].addEventListener("click", function (evt) {
          var btn = evt.currentTarget;
          var region = btn.getAttribute("data-region") || "";

          if (!region) {
            // "All" → clear to the neutral show-everything state.
            activeRegions = [];
          } else {
            // Individual region toggle
            var idx = activeRegions.indexOf(region);
            if (idx !== -1) {
              activeRegions.splice(idx, 1);
            } else {
              activeRegions.push(region);
            }
          }
          syncRegionUI();
          renderList();
        });
      }
    }

    // Close button
    var closeBtn = document.getElementById("btn-maps-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", close);
    }

    // Source link — open in default browser
    var sourceLink = document.getElementById("maps-source-link");
    if (sourceLink) {
      sourceLink.addEventListener("click", function (e) {
        e.preventDefault();
        Connector.openURL("https://reliefweb.int/location-maps");
      });
    }

    // Update catalog button
    var updateBtn = document.getElementById("btn-maps-update");
    if (updateBtn) {
      updateBtn.addEventListener("click", updateCatalog);
    }
  }

  // ── Catalog ────────────────────────────────────────────

  function loadCatalog() {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "maps-catalog.json", true);
    xhr.onload = function () {
      if (xhr.status === 200 || xhr.status === 0) { // status 0 for file:// protocol
        try {
          catalog = JSON.parse(xhr.responseText);
          renderList();
        } catch (e) {
          setStatus("Error parsing catalog: " + e.message, true);
        }
      }
    };
    xhr.onerror = function () {
      setStatus("Could not load maps catalog.", true);
    };
    xhr.send();
  }



  // ── Update Catalog (re-scrape ReliefWeb) ────────────────

  // Region lookup by ISO code (best-effort, same as shipped catalog)
  // Short aliases for region names
  var CSA = "Central and South America", NA = "North America", ME = "Middle East", PA = "Pacific";
  var REGION_MAP = {
    "afg":"Asia","alb":"Europe","dza":"Africa","and":"Europe","ago":"Africa",
    "aia":CSA,"atg":CSA,"arg":CSA,"arm":"Asia","aus":PA,
    "aut":"Europe","aze":"Asia","bhs":CSA,"bhr":ME,"bgd":"Asia",
    "brb":CSA,"blr":"Europe","bel":"Europe","blz":CSA,"ben":"Africa",
    "btn":"Asia","bol":CSA,"bes":CSA,"bih":"Europe","bwa":"Africa",
    "bra":CSA,"vgb":CSA,"brn":"Asia","bgr":"Europe","bfa":"Africa",
    "bdi":"Africa","khm":"Asia","cmr":"Africa","can":NA,"cpv":"Africa",
    "caf":"Africa","tcd":"Africa","chl":CSA,"chn":"Asia","col":CSA,
    "com":"Africa","cog":"Africa","cok":PA,"cri":CSA,"civ":"Africa",
    "hrv":"Europe","cub":CSA,"cuw":CSA,"cyp":"Europe","cze":"Europe",
    "prk":"Asia","cod":"Africa","dnk":"Europe","dji":"Africa","dma":CSA,
    "dom":CSA,"ecu":CSA,"egy":ME,"slv":CSA,
    "gnq":"Africa","eri":"Africa","est":"Europe","swz":"Africa","eth":"Africa",
    "fji":PA,"fin":"Europe","fra":"Europe","pyf":PA,"gab":"Africa",
    "gmb":"Africa","geo":"Asia","deu":"Europe","gha":"Africa","grc":"Europe",
    "grd":CSA,"gum":PA,"glp":CSA,"gtm":CSA,"gin":"Africa",
    "gnb":"Africa","guy":CSA,"hti":CSA,"hnd":CSA,"hun":"Europe",
    "isl":"Europe","ind":"Asia","idn":"Asia","irn":ME,"irq":ME,
    "irl":"Europe","isr":ME,"ita":"Europe","jam":CSA,"jpn":"Asia",
    "jor":ME,"kaz":"Asia","ken":"Africa","kir":PA,"kwt":ME,
    "kgz":"Asia","lao":"Asia","lva":"Europe","lbn":ME,"lso":"Africa",
    "lbr":"Africa","lby":"Africa","lie":"Europe","ltu":"Europe","lux":"Europe",
    "mdg":"Africa","mwi":"Africa","mys":"Asia","mdv":"Asia","mli":"Africa",
    "mlt":"Europe","mhl":PA,"mtq":CSA,"mrt":"Africa","mus":"Africa",
    "mex":CSA,"fsm":PA,"mda":"Europe","mng":"Asia","mne":"Europe",
    "msr":CSA,"mar":"Africa","moz":"Africa","mmr":"Asia","nam":"Africa",
    "nru":PA,"npl":"Asia","nld":"Europe","nzl":PA,"nic":CSA,
    "ner":"Africa","nga":"Africa","niu":PA,"mnp":PA,"nor":"Europe",
    "pse":ME,"omn":ME,"pak":"Asia","plw":PA,
    "pan":CSA,"png":PA,"pry":CSA,"per":CSA,"phl":"Asia",
    "pol":"Europe","prt":"Europe","pri":CSA,"qat":ME,"kor":"Asia",
    "reu":"Africa","rou":"Europe","rus":"Europe","rwa":"Africa","blm":CSA,
    "kna":CSA,"lca":CSA,"vct":CSA,"wsm":PA,"smr":"Europe",
    "stp":"Africa","sau":ME,"sen":"Africa","srb":"Europe","syc":"Africa",
    "sle":"Africa","sgp":"Asia","sxm":CSA,"svk":"Europe","svn":"Europe",
    "slb":PA,"som":"Africa","zaf":"Africa","ssd":"Africa","esp":"Europe",
    "lka":"Asia","sdn":"Africa","sur":CSA,"swe":"Europe","che":"Europe",
    "syr":ME,"tjk":"Asia","tha":"Asia","mkd":"Europe","tls":"Asia",
    "tgo":"Africa","ton":PA,"tto":CSA,"tun":"Africa","tur":ME,
    "tkm":"Asia","tca":CSA,"tuv":PA,"uga":"Africa","ukr":"Europe",
    "are":ME,"gbr":"Europe","tza":"Africa","usa":NA,"vir":CSA,
    "ury":CSA,"uzb":"Asia","vut":PA,"ven":CSA,"vnm":"Asia",
    "esh":"Africa","yem":ME,"zmb":"Africa","zwe":"Africa"
  };

  function updateCatalog() {
    if (!csInterface) {
      setStatus("Update requires Illustrator CEP environment.", true);
      return;
    }

    var updateBtn = document.getElementById("btn-maps-update");
    if (updateBtn) {
      updateBtn.disabled = true;
      updateBtn.classList.add("maps-update-loading");
    }
    showProgress("Fetching catalog from ReliefWeb…", -1);

    HttpUtils.get(HttpUtils.URLS.RELIEFWEB_MAPS, function (err, body) {
      if (err) { updateFail(err, updateBtn); return; }
      parseCatalogFromHtml(body, updateBtn);
    });
  }

  function parseCatalogFromHtml(html, updateBtn) {
    // Pattern: <a href="/node/...">Name: Location Map</a> ... <a href="SVG_URL">SVG</a>
    // We extract (1) country name from the first <a> and (2) the SVG URL
    var entryRegex = /<li><a[^>]*>([^<]+?)(?::?\s*Location Map)?<\/a>[^]*?<a href="([^"]+\.svg[^"]*)"[^>]*>SVG<\/a>/g;
    var match;
    var newCatalog = [];
    var seen = {};

    while ((match = entryRegex.exec(html)) !== null) {
      var name = match[1].replace(/:?\s*$/, "").trim();
      var svgUrl = match[2].replace(/\?time=[\d.]+/, ""); // Strip cache-busting param

      // Extract ISO code from SVG filename
      var filenameMatch = svgUrl.match(/\/([^/]+)\.svg$/i);
      var code = "";
      if (filenameMatch) {
        code = filenameMatch[1].replace(/_[Oo][Cc][Hh][Aa]$/i, "").toLowerCase();
      }

      // Skip duplicates
      if (seen[svgUrl]) continue;
      seen[svgUrl] = true;

      // Determine region
      var region = REGION_MAP[code] || "Other";

      // Check for regional maps
      if (/caribbean|sahel|central.america|pacific|horn.of.africa|lake.chad/i.test(name)) {
        region = "Region";
      }

      newCatalog.push({
        name: name,
        code: code || name.toLowerCase().replace(/\s+/g, "-"),
        url: svgUrl,
        region: region
      });
    }

    if (newCatalog.length === 0) {
      updateFail("Could not parse any maps from ReliefWeb page.", updateBtn);
      return;
    }

    // Save new catalog to disk
    var fs = Connector.fs;
    var catalogPath = Connector.paths.mapsCatalog;
    try {
      fs.writeText(catalogPath, JSON.stringify(newCatalog, null, 2));
    } catch (e) {
      updateFail("Could not save catalog: " + e.message, updateBtn);
      return;
    }

    // Clear the SVG cache so updated maps get re-downloaded
    clearCache();

    // Reload catalog in memory
    catalog = newCatalog;
    renderList();

    hideProgress();
    setStatus("Updated: " + newCatalog.length + " maps");
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.classList.remove("maps-update-loading");
    }
  }

  function clearCache() {
    var fs = Connector.fs;
    try {
      if (fs.exists(cacheDir)) {
        var files = fs.list(cacheDir);
        for (var i = 0; i < files.length; i++) {
          try { fs.remove(cacheDir + "/" + files[i]); } catch (e) { /* skip */ }
        }
      }
    } catch (e) {
      // Cache clear is best-effort
    }
  }

  function updateFail(msg, updateBtn) {
    hideProgress();
    setStatus("Update failed: " + msg, true);
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.classList.remove("maps-update-loading");
    }
  }

  // ── Region sync ───────────────────────────────────────

  /** Sync region chips to match activeRegions array */
  function syncRegionUI() {
    // "All" is the neutral state: highlighted only when no specific region
    // is chosen (so the checkmark means something on the individual chips).
    var allActive = activeRegions.length === 0;

    // Region filter chips
    if (regionBar) {
      var btns = regionBar.querySelectorAll(".maps-region-chip");
      for (var i = 0; i < btns.length; i++) {
        var r = btns[i].getAttribute("data-region") || "";
        if (!r) {
          // "All" button — active when all regions are selected
          btns[i].classList.toggle("active", allActive);
        } else {
          btns[i].classList.toggle("active", activeRegions.indexOf(r) !== -1);
        }
      }
    }

  }

  // ── Rendering ──────────────────────────────────────────

  // ── Recent maps (localStorage) ──────────────────────────
  var RECENT_KEY = "ocha_dataviz_recent_maps";
  var RECENT_MAX = 6;
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
  }
  function pushRecent(code) {
    try {
      var arr = getRecent().filter(function (k) { return k !== code; });
      arr.unshift(code);
      if (arr.length > RECENT_MAX) arr = arr.slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  function recentHtml() {
    var recents = getRecent();
    if (!recents.length) return "";
    var items = [];
    for (var r = 0; r < recents.length; r++) {
      for (var ci = 0; ci < catalog.length; ci++) {
        if (catalog[ci].code === recents[r]) { items.push(catalog[ci]); break; }
      }
    }
    if (!items.length) return "";
    var h = '<div class="maps-recent"><div class="maps-recent-label">Recent</div><div class="maps-recent-list">';
    for (var i = 0; i < items.length; i++) {
      var e = items[i];
      h += '<button class="maps-item" data-code="' + e.code + '" title="' + escapeAttr(e.name) + ' (' + e.region + ')">' +
        '<span class="maps-item-name">' + escapeHtml(e.name) + '</span>' +
        '<span class="maps-item-region">' + e.region + '</span></button>';
    }
    h += '</div></div>';
    return h;
  }

  function renderList() {
    var query = (searchEl.value || "").toLowerCase().trim();
    var allSelected = activeRegions.length === 0 || activeRegions.length === ALL_REGIONS.length;

    var filtered = [];
    for (var i = 0; i < catalog.length; i++) {
      var entry = catalog[i];

      // Region filter — skip if not in active set (unless all selected)
      if (!allSelected && activeRegions.indexOf(entry.region) === -1) continue;

      // Search filter — match name or code
      if (query) {
        var nameMatch = entry.name.toLowerCase().indexOf(query) !== -1;
        var codeMatch = entry.code.toLowerCase().indexOf(query) !== -1;
        if (!nameMatch && !codeMatch) continue;
      }

      filtered.push(entry);
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="maps-empty">No maps found</div>';
      return;
    }

    var html = "";
    for (var j = 0; j < filtered.length; j++) {
      var e = filtered[j];
      html += '<button class="maps-item" data-code="' + e.code + '" title="' +
        escapeAttr(e.name) + ' (' + e.region + ')">' +
        '<span class="maps-item-name">' + escapeHtml(e.name) + '</span>' +
        '<span class="maps-item-region">' + e.region + '</span>' +
        '</button>';
    }
    listEl.innerHTML = (query ? "" : recentHtml()) + html;

    // Attach click handlers
    var buttons = listEl.querySelectorAll(".maps-item");
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].addEventListener("click", onMapClick);
    }
  }

  // ── Map selection & placement ──────────────────────────

  function onMapClick(evt) {
    var btn = evt.currentTarget;
    var code = btn.getAttribute("data-code");

    // Find catalog entry
    var entry = null;
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i].code === code) { entry = catalog[i]; break; }
    }
    if (!entry) return;

    // Disable button while loading
    btn.classList.add("maps-item-loading");
    showProgress((csInterface ? "Downloading " : "Preparing ") + entry.name + "…", 0);

    fetchAndPlace(entry, function (err, outcome) {
      btn.classList.remove("maps-item-loading");
      hideProgress();
      if (err) {
        setStatus((err || "").replace(/^ERROR:\s*/i, ""), true);
      } else if (outcome === "preview") {
        setStatus("");                  // web: the preview window takes over
        pushRecent(code);
      } else {
        setStatus(entry.name + (csInterface ? " placed" : " downloaded"));
        pushRecent(code);
        // Keep panel open so user can place another map
      }
    });
  }

  // ── Fetch + Cache + Place ──────────────────────────────

  function fetchAndPlace(entry, callback) {
    if (!csInterface) {
      // Web shell: ReliefWeb can't be reached from a web page (no cross-site
      // access), so the web version ships the maps it offers. Download the
      // bundled copy, exactly as published by ReliefWeb.
      var webPath = cacheDir + "/" + entry.code + "_ocha.svg";
      if (!Connector.fs.exists(webPath)) {
        callback("This map isn't included in the web version yet. It's available on ReliefWeb.");
        return;
      }
      // Show the map first: the web page opens a preview window with a
      // Download button (web-shell.js listens for this event).
      document.dispatchEvent(new CustomEvent("ocha-asset-preview", { detail: {
        title: entry.name + " — location map",
        path: webPath,
        fileName: entry.code + "_ocha.svg",
        source: "Source: ReliefWeb / OCHA",
        analyticsEvent: "tool:maps"
      } }));
      callback(null, "preview");
      return;
    }

    // Determine cache file path
    var filename = entry.code + "_ocha.svg";
    var cachePath = cacheDir + "/" + filename;

    // Check if cached
    var fs = Connector.fs;

    // Ensure cache dir exists
    fs.mkdirp(cacheDir);

    if (fs.exists(cachePath)) {
      // Cache hit — place directly
      placeFromCache(cachePath, entry.name, callback);
      return;
    }

    // Cache miss — download from ReliefWeb via shared utility
    var mapName = entry.name;
    HttpUtils.getBuffer(entry.url, function (received, total) {
      if (total > 0) {
        var pct = Math.min(100, Math.round((received / total) * 100));
        showProgress("Downloading " + mapName + " — " + pct + "%", pct);
      } else {
        var kb = (received / 1024).toFixed(0);
        showProgress("Downloading " + mapName + " — " + kb + " KB", -1);
      }
    }, function (err, buffer) {
      if (err) {
        hideProgress();
        callback("Download failed: " + err);
        return;
      }
      showProgress("Fixing text & placing on artboard…", 100);
      try {
        // Fix Illustrator SVG text fragmentation before caching
        var svgStr = buffer.toString("utf8");
        svgStr = fixSvgText(svgStr);
        fs.writeText(cachePath, svgStr);
        placeFromCache(cachePath, mapName, callback);
      } catch (e) {
        hideProgress();
        callback("Failed to save: " + e.message);
      }
    });
  }

  /**
   * Fix Illustrator SVG export issue: text split into multiple <tspan>
   * fragments with per-character letter-spacing classes and absolute x offsets.
   * Merges sibling <tspan>s that share the same y into a single <tspan>,
   * keeping only the first x position. This makes the title and city labels
   * render correctly when placed in Illustrator via createFromFile().
   */
  function fixSvgText(svgString) {
    // Match each <text ...>...</text> block (single-line or multiline)
    return svgString.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, function (textBlock) {
      // Group consecutive <tspan> elements by their y value
      // Pattern: <tspan class="..." x="..." y="...">chars</tspan>
      // We merge tspans on the same line (same y) into one
      return textBlock.replace(
        /(<tspan[^>]*\bx="([^"]*)"[^>]*\by="([^"]*)"[^>]*>)([\s\S]*?)(<\/tspan>)(\s*(?:<tspan[^>]*\by="\3"[^>]*>[\s\S]*?<\/tspan>\s*)*)/g,
        function (match, openTag, firstX, yVal, firstText, closeTag, rest) {
          if (!rest.trim()) return match; // nothing to merge

          // Extract text from remaining tspans with the same y
          var moreText = rest.replace(/<tspan[^>]*>([\s\S]*?)<\/tspan>/g, function (_, t) {
            return t;
          });

          // Build a clean single tspan with just x and y
          return '<tspan x="' + firstX + '" y="' + yVal + '">' + firstText + moreText + closeTag;
        }
      );
    });
  }

  function placeFromCache(cachePath, mapName, callback) {
    showProgress("Placing " + mapName + " on artboard…", 100);

    // Convert to native OS path for ExtendScript
    var nativePath = cachePath.replace(/\\/g, "/");

    // Escape for ExtendScript string
    var escapedPath = nativePath.replace(/'/g, "\\'");
    var escapedName = (mapName || "").replace(/'/g, "\\'");

    var script = "placeMap('" + escapedPath + "', '" + escapedName + "')";
    csInterface.evalScript(script, function (result) {
      if (result && result.indexOf("ERROR") === 0) {
        callback(result);
      } else {
        callback(null); // success
        if (typeof sendAnalyticsPing === "function") sendAnalyticsPing("tool:maps");
      }
    });
  }

  // ── Panel visibility ───────────────────────────────────

  function open() {
    if (!panelEl) return;
    panelEl.classList.add("maps-panel-visible");
    isOpen = true;

    // Hide main UI (same pattern as grid panel)
    setMainUIVisible(false);

    // Focus search
    if (searchEl) {
      searchEl.value = "";
      searchEl.focus();
    }
    // Reset region filter — neutral "All" (show everything)
    activeRegions = [];
    syncRegionUI();
    setStatus("");
    renderList();
  }

  function close() {
    if (!panelEl) return;
    panelEl.classList.remove("maps-panel-visible");
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

  /**
   * Show the progress bar.
   * @param {string} label - Text to display above the bar
   * @param {number} pct   - 0–100 for determinate, -1 for indeterminate
   */
  function showProgress(label, pct) {
    if (!progressEl) return;
    progressEl.style.display = "";
    if (progressText) progressText.textContent = label || "Downloading…";
    if (progressBar) {
      if (pct < 0) {
        // Indeterminate — animate full width with pulse
        progressBar.style.width = "100%";
        progressBar.classList.add("maps-progress-indeterminate");
      } else {
        progressBar.classList.remove("maps-progress-indeterminate");
        progressBar.style.width = Math.min(100, pct) + "%";
      }
    }
  }

  function hideProgress() {
    if (!progressEl) return;
    progressEl.style.display = "none";
    if (progressBar) {
      progressBar.style.width = "0%";
      progressBar.classList.remove("maps-progress-indeterminate");
    }
  }

  // Delegate to shared HttpUtils
  var escapeHtml = HttpUtils.escapeHtml;
  var escapeAttr = HttpUtils.escapeAttr;

  // ── Public API ─────────────────────────────────────────

  return {
    init: init,
    open: open,
    close: close,
    toggle: toggle
  };
})();
