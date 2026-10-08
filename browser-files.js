/**
 * BrowserFiles — open / save text files with plain browser APIs (a hidden
 * file input, a Blob download). The web shell's Connector uses these as its
 * file dialogs; the Illustrator Connector falls back to them only when CEP
 * has no native dialog. Same callback contract as Connector.files.
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

  return { openText: openText, saveText: saveText };
})();
