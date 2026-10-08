/**
 * DataInput — File upload handler for Humanitarian DataViz Tool.
 * Loads a CSV file chosen through the shell's file dialog (the native
 * dialog inside Illustrator, the browser's picker on the web).
 */

/* global DataStore, Connector */

var DataInput = (function () {
  "use strict";

  var input = {};

  /**
   * Open a file dialog and load the selected CSV file.
   * @param {function} [onDone] - callback({ok, error, rowCount, fileName})
   */
  input.openFileDialog = function (onDone) {
    onDone = onDone || function () {};

    try {
      Connector.files.openText({ title: "Select CSV File", extensions: ["csv"] }, function (err, files) {
        if (err) { onDone({ error: "File dialog error: " + err.message }); return; }
        if (!files || !files.length) { onDone({ error: "No file selected." }); return; }
        var f = files[0];
        if (f.error) { onDone({ error: "Failed to read file: " + f.error.message }); return; }
        onDone(input.loadText(f.text, f.name));
      });
    } catch (e) {
      onDone({ error: "File dialog error: " + e.message });
    }
  };

  /**
   * Parse CSV text into the DataStore.
   */
  input.loadText = function (content, fileName) {
    try {
      var result = DataStore.loadFromCSVString(content);
      result.fileName = fileName;
      return result;
    } catch (e) {
      return { error: "Failed to read file: " + e.message };
    }
  };

  return input;
})();
