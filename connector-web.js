/**
 * Connector — web implementation (Humanitarian DataViz Tool — web).
 *
 * Same interface as ocha_dataviz_plugin/client/connector-illustrator.js —
 * read the interface notes there; tests/shell/check-shared.js verifies both
 * connectors expose the same members. The web build serves the plugin's
 * client/ folder as the site, so every asset path below is relative to the
 * page (icons-cache/, flags/, maps-cache/ …), and loads this file in place of
 * connector-illustrator.js.
 *
 * Differences from Illustrator, by design:
 *   - fs is READ-ONLY: it reads the files published with the site. The chart
 *     engine reads icons and flags synchronously, so reads use synchronous
 *     same-site requests, cached after the first read. (Browsers discourage
 *     synchronous requests, but they remain supported; if that ever changes,
 *     the replacement is to preload the files a chart needs before it
 *     renders — the interface stays the same.)
 *     fs.list() answers from asset-index.json, written by the web build.
 *   - http uses fetch, so it can only reach sites that allow cross-site
 *     requests (ReliefWeb does not — the web build bundles the maps instead).
 *   - storage is the browser's localStorage.
 *   - files are the browser's file picker and downloads.
 *   - illustrator is null: nothing is placed in a document.
 *   - analytics: counts start at once, carry the region from the browser's
 *     time zone (no IP lookup), a random browser code and whether this
 *     browser has signed up, and land on their own tab ("Web usage").
 */

/* global BrowserFiles, WebGate */

var Connector = (function () {
  "use strict";

  var STORAGE_PREFIX = "ocha-dataviz:";

  var paths = {
    extension: ".",
    flags: "flags",
    icons: "icons-cache",
    mapsCache: "maps-cache",
    mapsCatalog: "maps-catalog.json",
    hostScript: "",
    userData: "",
    temp: ""
  };

  // ── Read-only same-site files ───────────────────────────────
  var textCache = {};       // path → text, or null when known missing

  function syncGet(p) {
    if (Object.prototype.hasOwnProperty.call(textCache, p)) return textCache[p];
    var text = null;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", encodeURI(p), false);
      xhr.send();
      if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) text = xhr.responseText;
    } catch (e) { text = null; }
    textCache[p] = text;
    return text;
  }

  var assetIndex = null;    // { "icons-cache": ["A.svg", ...], ... }
  function listing(dir) {
    if (!assetIndex) {
      try { assetIndex = JSON.parse(syncGet("asset-index.json") || "{}"); }
      catch (e) { assetIndex = {}; }
    }
    var key = String(dir).replace(/^\.\//, "").replace(/\/+$/, "");
    return assetIndex[key] ? assetIndex[key].slice() : null;
  }

  function readOnly() { return new Error("The web version can't write files."); }

  // Fetch many files in parallel ahead of time, so a long list of previews
  // (flags, icons) is drawn from memory instead of one blocking request per
  // file. Failures are left for the synchronous read to report.
  function preload(paths) {
    var todo = paths.filter(function (p) { return !Object.prototype.hasOwnProperty.call(textCache, p); });
    var i = 0;
    function next() {
      if (i >= todo.length) return Promise.resolve();
      var p = todo[i++];
      return fetch(encodeURI(p)).then(function (res) {
        return res.ok ? res.text() : null;
      }).then(function (text) {
        if (text !== null) textCache[p] = text;
      }, function () { /* leave it to readText */ }).then(next);
    }
    var lanes = [];
    for (var k = 0; k < Math.min(12, todo.length); k++) lanes.push(next());
    return Promise.all(lanes);
  }

  var fs = {
    writable: false,
    local: false,                                  // every read is a request to the site
    preload: preload,
    exists: function (p) {
      var slash = String(p).lastIndexOf("/");
      var list = slash > 0 ? listing(String(p).slice(0, slash)) : null;
      if (list) return list.indexOf(String(p).slice(slash + 1)) !== -1;
      if (listing(p)) return true;            // a known folder
      return syncGet(p) !== null;
    },
    readText: function (p) {
      var t = syncGet(p);
      if (t === null) {
        var e = new Error("ENOENT: no such file or directory, open '" + p + "'");
        e.code = "ENOENT";
        throw e;
      }
      return t;
    },
    writeText: function () { throw readOnly(); },
    list: function (dir) {
      var l = listing(dir);
      if (!l) {
        var e = new Error("ENOENT: no such file or directory, scandir '" + dir + "'");
        e.code = "ENOENT";
        throw e;
      }
      return l;
    },
    mkdirp: function () {},
    remove: function () { throw readOnly(); },
    join: function () {
      var parts = Array.prototype.join.call(arguments, "/").split("/"), out = [];
      for (var i = 0; i < parts.length; i++) {
        var s = parts[i];
        if (s === "..") out.pop();
        else if (s !== "." && (s !== "" || i === 0)) out.push(s);
      }
      return out.join("/") || ".";
    },
    basename: function (p) { return String(p).split("/").pop(); }
  };

  // ── Network via fetch ───────────────────────────────────────
  function withTimeout(timeout) {
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout || 30000) : null;
    return { signal: ctrl ? ctrl.signal : undefined, done: function () { if (timer) clearTimeout(timer); } };
  }

  // Bytes with the one method callers use on a Node Buffer.
  function bytesResult(u8) {
    return {
      bytes: u8,
      length: u8.length,
      toString: function () { return new TextDecoder("utf-8").decode(u8); }
    };
  }

  var http = {
    getText: function (url, callback, timeout) {
      var t = withTimeout(timeout);
      fetch(url, { signal: t.signal }).then(function (res) {
        if (res.status !== 200) { t.done(); callback("HTTP " + res.status); return null; }
        return res.text().then(function (body) { t.done(); callback(null, body); });
      }).catch(function (e) {
        t.done();
        callback(e && e.name === "AbortError" ? "Request timed out" : ((e && e.message) || "Network error"));
      });
    },

    getBuffer: function (url, onProgress, callback, timeout) {
      var t = withTimeout(timeout);
      fetch(url, { signal: t.signal }).then(function (res) {
        if (res.status !== 200) { t.done(); callback("HTTP " + res.status); return null; }
        var total = parseInt(res.headers.get("content-length") || "0", 10);
        if (!res.body || !res.body.getReader) {
          return res.arrayBuffer().then(function (ab) {
            t.done();
            if (onProgress) onProgress(ab.byteLength, total);
            callback(null, bytesResult(new Uint8Array(ab)));
          });
        }
        var reader = res.body.getReader(), chunks = [], received = 0;
        return (function pump() {
          return reader.read().then(function (r) {
            if (r.done) {
              t.done();
              var all = new Uint8Array(received), off = 0;
              for (var i = 0; i < chunks.length; i++) { all.set(chunks[i], off); off += chunks[i].length; }
              callback(null, bytesResult(all));
              return null;
            }
            chunks.push(r.value);
            received += r.value.length;
            if (onProgress) onProgress(received, total);
            return pump();
          });
        })();
      }).catch(function (e) {
        t.done();
        callback(e && e.name === "AbortError" ? "Download timed out" : ((e && e.message) || "Network error"));
      });
    }
  };

  // ── Usage counts ────────────────────────────────────────────
  // Switched on only once the usage sheet's script sends ch=web counts to
  // their own tab ("Web usage"). While false, the web version sends nothing:
  // counts would otherwise mix into the plugin's numbers.
  var WEB_COUNTS_ON = true;     // "Web usage" tab live since 8 Oct 2026

  // Region only, from the time zone the browser reports ("Europe/Madrid"
  // → "Europe"): no IP lookup, nothing more precise than a continent.
  function regionFromTimeZone() {
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { tz = ""; }
    var area = tz.split("/")[0];
    var map = { America: "Americas", Australia: "Oceania", Pacific: "Oceania", Asia: "Asia",
      Europe: "Europe", Africa: "Africa", Atlantic: "Atlantic", Indian: "Indian Ocean", Antarctica: "Antarctica" };
    return map[area] || "Unknown";
  }

  var analytics = {
    // Counts start at once for everyone (the sign-up only comes at the
    // first download), so the funnel — tried / signed up / downloaded — is
    // visible. Each count carries a random browser code, not personal data.
    whenReady: function (cb) {
      if (WEB_COUNTS_ON) cb();
    },
    // To the web version's own tab ("Web usage"), through the sign-up
    // service (see web-gate.js), with the anonymous user code.
    send: function (f) {
      if (typeof WebGate === "undefined") return;
      WebGate.sendUsage({ ch: "web", v: f.v, e: f.e, loc: f.loc, u: WebGate.userCode(),
        s: WebGate.isSignedUp() ? "yes" : "no" });
    },
    location: function (cb) { cb(regionFromTimeZone()); }
  };

  // ── App data in the browser's storage ───────────────────────
  var storage = {
    locationOf: function () { return null; },
    read: function (name) {
      try { return window.localStorage.getItem(STORAGE_PREFIX + name); }
      catch (e) { return null; }
    },
    write: function (name, text) {
      try { window.localStorage.setItem(STORAGE_PREFIX + name, text); return true; }
      catch (e) { return false; }
    }
  };

  return {
    id: "web",
    paths: paths,
    fs: fs,
    http: http,
    storage: storage,
    files: {
      openText: BrowserFiles.openText,
      // opts.signInFirst (asset downloads): ask the sign-up first; "Not now"
      // answers like a cancelled save dialog (cb(null, null)).
      saveText: function (opts, cb) {
        if (opts && opts.signInFirst && typeof WebGate !== "undefined") {
          WebGate.requireSignIn(function () { BrowserFiles.saveText(opts, cb); }, function () { cb(null, null); });
          return;
        }
        BrowserFiles.saveText(opts, cb);
      }
    },
    analytics: analytics,
    openURL: function (url) {
      try { window.open(url, "_blank", "noopener"); } catch (e) { /* popup blocked */ }
    },
    illustrator: null
  };
})();
