/**
 * BrowserFiles — open / save text files with plain browser APIs (a hidden
 * file input, a Blob download). The web shell's Connector uses these as its
 * file dialogs; the Illustrator Connector falls back to them only when CEP
 * has no native dialog. Same callback contract as Connector.files.
 * Also the plain-browser parts of Connector.codec (compression streams)
 * and Connector.clipboard (copy through a selection), shared by both
 * connectors.
 */

/* exported BrowserFiles */

var BrowserFiles = (function () {
  "use strict";

  /**
   * Let the user pick file(s) and read them as text.
   * opts: { extensions:[..], multiple }
   * cb(err, [{ path:null, name, text } | { path:null, name, error }])
   * cb(null, []) when nothing was chosen.
   */
  function openText(opts, cb) {
    opts = opts || {};
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = (opts.extensions || []).map(function (e) { return "." + e; }).join(",");
    fileInput.multiple = !!opts.multiple;
    fileInput.style.display = "none";

    function cleanup() {
      if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
    }

    fileInput.addEventListener("change", function () {
      var list = fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
      cleanup();
      if (!list.length) { cb(null, []); return; }
      var out = new Array(list.length);
      var pending = list.length;
      list.forEach(function (file, i) {
        var reader = new FileReader();
        reader.onload = function () {
          out[i] = { path: null, name: file.name, text: String(reader.result || "") };
          if (--pending === 0) cb(null, out);
        };
        reader.onerror = function () {
          out[i] = { path: null, name: file.name, error: new Error("Couldn't read " + file.name) };
          if (--pending === 0) cb(null, out);
        };
        reader.readAsText(file);
      });
    });

    // Clean up the orphaned input if the user cancels the dialog
    window.addEventListener("focus", function onFocus() {
      window.removeEventListener("focus", onFocus);
      setTimeout(cleanup, 300);
    }, { once: true });

    document.body.appendChild(fileInput);
    fileInput.click();
  }

  /**
   * Hand a text file to the browser as a download.
   * opts: { defaultName, text, mime }
   * cb(err, { method: "download", path: null, name })
   */
  function saveText(opts, cb) {
    opts = opts || {};
    try {
      var blob = new Blob([opts.text], { type: opts.mime || "application/octet-stream" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = opts.defaultName || "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke on the next tick: some browsers start the download
      // asynchronously and fail if the URL is already gone.
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      cb(null, { method: "download", path: null, name: a.download });
    } catch (e) {
      cb(e);
    }
  }

  /**
   * Compress / decompress bytes with the browser's streams
   * (CompressionStream; Chrome 80+, Safari 16.4+, Firefox 113+).
   * format: "deflate-raw" | "gzip". Returns a Promise of a Uint8Array;
   * rejects when the browser has no such stream.
   */
  function streamThrough(bytes, Stream, format) {
    if (typeof Stream === "undefined") return Promise.reject(new Error("no " + format + " support"));
    // Always a promise, never a throw: an unsupported format makes the
    // constructor throw, and a throw here once left the Share chart window
    // stuck on “Making the link…” (Illustrator's Chrome 99, Oct 2026).
    try {
      var out = new Blob([bytes]).stream().pipeThrough(new Stream(format));
      return new Response(out).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    } catch (e) { return Promise.reject(e); }
  }
  // Which formats this browser's streams really handle. Having
  // CompressionStream is not enough: "deflate-raw" only arrived in Chrome
  // 103, and Illustrator's panel ran Chrome 99 (gzip/deflate only) in Oct 2026.
  var formatCache = {};
  function supportsFormat(format) {
    if (!(format in formatCache)) {
      try {
        new CompressionStream(format); new DecompressionStream(format);   // eslint-disable-line no-new
        formatCache[format] = true;
      } catch (e) { formatCache[format] = false; }
    }
    return formatCache[format];
  }
  function compress(bytes, format) {
    return streamThrough(bytes, typeof CompressionStream === "undefined" ? undefined : CompressionStream, format);
  }
  function decompress(bytes, format) {
    return streamThrough(bytes, typeof DecompressionStream === "undefined" ? undefined : DecompressionStream, format);
  }
  var hasStreams = typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

  /**
   * Copy text to the clipboard through a hidden text box and the "copy"
   * command, synchronously. Must run inside the click that asked for it.
   * This is the method that works inside Illustrator's panels, where
   * navigator.clipboard is refused (a panel isn't a "secure context").
   * Details that matter in CEP: the box is fixed at (0,0) with a real size
   * (boxes far off-screen can be skipped), invisible, read-only, and the
   * previous focus is given back afterwards. Returns true when copied.
   */
  function copyBySelection(text) {
    var prevFocus = document.activeElement;
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;" +
      "outline:0;opacity:0;pointer-events:none;z-index:-1";
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e2) { /* gone */ } }
    return ok;
  }

  return {
    openText: openText, saveText: saveText,
    compress: compress, decompress: decompress, hasStreams: hasStreams,
    supportsFormat: function (format) { return hasStreams && supportsFormat(format); },
    copyBySelection: copyBySelection
  };
})();
