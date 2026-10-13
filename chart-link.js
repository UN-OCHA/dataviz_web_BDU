/* ══════════════════════════════════════════════
   Chart links
   ──────────────────────────────────────────────
   A chart link opens a chart in the web version of the Humanitarian
   DataViz Tool. The chart travels in the link's fragment (after "#"), so
   it never reaches any server:

     https://un-ocha.github.io/dataviz_web_BDU/#chart=<payload>

   payload = base64url (no padding) of the chart JSON (DataStore.toConfig
   — the same text as a saved chart file), compressed with raw deflate.
   Also read: #d=<same> (the dashboard editor's style), gzip instead of
   raw deflate (recognised by its first bytes 1F 8B), and #json=<the JSON,
   URL-encoded> for hand-made links. "&download=png|svg" may follow; see
   ocha_dataviz_web/README.md.

   Used by "Share chart" and "Load / Import" (panel.js) in both the
   plugin and the web version, and by the web version when it opens with a
   link (web-shell.js). Compression goes through Connector.codec.
   ══════════════════════════════════════════════ */

/* global Connector, HttpUtils */

var ChartLink = (function () {
  "use strict";

  var BASE = HttpUtils.URLS.WEB_VERSION;

  // Longest link we hand out. The chart sits in the fragment, which
  // browsers never send to a server, and browsers themselves accept links
  // of hundreds of thousands of characters. The limit comes from what the
  // link passes through on the way: Outlook and Teams "Safe Links" rewrite
  // a link into a query string on Microsoft's servers, and web servers
  // commonly refuse request lines over 8 KB (8,190 bytes in Apache,
  // 8 KB buffers in nginx). 6,000 keeps a clear margin below that for the
  // wrapping, and is far above a typical chart (a few hundred characters).
  var MAX_LENGTH = 6000;

  function utf8(text) { return new TextEncoder().encode(text); }
  function fromUtf8(bytes) { return new TextDecoder("utf-8").decode(bytes); }

  function toBase64url(bytes) {
    var bin = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64url(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** The chart link for a chart's JSON text. Promise of the full link. */
  function build(json) {
    return Connector.codec.deflateRaw(utf8(json)).then(function (bytes) {
      return BASE + "#chart=" + toBase64url(bytes);
    });
  }

  // "<kind>=<payload>&key=value…" → { main, opts }. Splitting on the first
  // "&" is safe: base64url never contains "&", and #json= is URL-encoded.
  function splitHash(hash) {
    var h = String(hash || ""), amp = h.indexOf("&"), opts = {};
    if (amp !== -1) {
      h.slice(amp + 1).split("&").forEach(function (kv) {
        var eq = kv.indexOf("=");
        if (eq > 0) opts[kv.slice(0, eq)] = kv.slice(eq + 1);
      });
      h = h.slice(0, amp);
    }
    return { main: h, opts: opts };
  }

  // The "#chart=…" part of a pasted link (or of location.hash), or null.
  function fragmentOf(text) {
    var t = String(text || "").trim();
    var i = t.indexOf("#");
    if (i === -1) return null;
    var frag = t.slice(i).replace(/\s+/g, "");      // mail apps can wrap long links
    return /^#(chart|d|json)=./.test(frag) ? frag : null;
  }

  /** True when the text is (or contains) a chart link. */
  function isLink(text) { return fragmentOf(text) !== null; }

  // Raw deflate unless the bytes start like gzip (1F 8B). Bytes that don't
  // decompress are taken as plain text.
  function unpack(bytes) {
    var isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    return Connector.codec.inflate(bytes, isGzip ? "gzip" : "deflate-raw").catch(function () { return bytes; });
  }

  /**
   * Read a chart link (a full link, or just its "#chart=…" part).
   * Promise of { json, opts } — opts are the "&key=value" options — or of
   * null when the text isn't a chart link. Rejects when it is one but
   * can't be decoded (damaged or cut short).
   */
  function read(text) {
    var frag = fragmentOf(text);
    if (!frag) return Promise.resolve(null);
    var parts = splitHash(frag);
    var m = /^#(chart|d|json)=(.+)$/.exec(parts.main);
    if (!m) return Promise.resolve(null);
    var json;
    if (m[1] === "json") {
      try { json = Promise.resolve(decodeURIComponent(m[2])); } catch (e) { return Promise.reject(e); }
    } else {
      try { json = unpack(fromBase64url(m[2])).then(fromUtf8); } catch (e) { return Promise.reject(e); }
    }
    return json.then(function (j) { return { json: j, opts: parts.opts }; });
  }

  return { BASE: BASE, MAX_LENGTH: MAX_LENGTH, build: build, read: read, isLink: isLink };
})();
