/**
 * ThemesStore — persistence + import/export for user-defined custom COLOR
 * themes.
 *
 * Themes are kept in the shell's app storage (Connector.storage): inside
 * Illustrator that is a JSON file in the CEP USER_DATA folder, which lives
 * OUTSIDE the plugin folder — so themes survive the auto-updater (which
 * replaces the plugin folder on every release) and reinstalls. On the web it
 * is the browser's storage, and themes can be exported / imported as JSON
 * files so they survive clearing it. panel.js loads them at startup and
 * registers each into ChartRegistry.CUSTOM_THEMES.
 *
 * Theme shape (also the import/export JSON for a single theme):
 *   { id, name, colors:[hex...], ramp?:[hex...],
 *     swatches?:[{hex,name}], iconPalette?:[hex...] }
 * Store: "ocha-dataviz-themes.json"  ->  { "themes": [ ... ] }
 *
 * Everything is guarded so the module also loads cleanly with no Connector
 * (e.g. a plain `node --check`) — it just becomes a set of no-ops returning
 * empty results.
 */
/* global Connector */

var ThemesStore = (function () {
  "use strict";

  var STORE_NAME = "ocha-dataviz-themes.json";

  function _connector() {
    return (typeof Connector !== "undefined") ? Connector : null;
  }

  function _resolveStorePath() {
    var c = _connector();
    return c ? c.storage.locationOf(STORE_NAME) : null;
  }

  function loadAll() {
    var c = _connector();
    if (!c) return [];
    try {
      var raw = c.storage.read(STORE_NAME);
      if (raw == null) return [];
      var obj = JSON.parse(raw);
      return (obj && obj.themes) ? obj.themes : [];
    } catch (e) { return []; }
  }

  function saveAll(themes) {
    var c = _connector();
    if (!c) return false;
    return c.storage.write(STORE_NAME, JSON.stringify({ themes: themes || [] }, null, 2));
  }

  function addOrUpdate(theme) {
    var all = loadAll(), i = -1;
    for (var k = 0; k < all.length; k++) { if (all[k].id === theme.id) { i = k; break; } }
    if (i >= 0) all[i] = theme; else all.push(theme);
    saveAll(all);
    return all;
  }

  function remove(id) {
    var all = loadAll().filter(function (t) { return t.id !== id; });
    saveAll(all);
    return all;
  }

  // Open a file picker; read + parse the chosen JSON file(s); calls
  // cb(array of theme objects) — accepts a bare theme or a { themes:[...] }
  // bundle. Unreadable or invalid files are skipped.
  function importThemes(cb) {
    var c = _connector();
    if (!c) { cb([]); return; }
    c.files.openText({ title: "Import colour theme(s)", extensions: ["json"], multiple: true }, function (err, files) {
      var out = [];
      if (err || !files) { cb(out); return; }
      for (var i = 0; i < files.length; i++) {
        if (files[i].error) continue;
        try {
          var obj = JSON.parse(files[i].text);
          var list = (obj && obj.themes) ? obj.themes : [obj];
          for (var j = 0; j < list.length; j++) {
            if (list[j] && list[j].colors && list[j].colors.length) out.push(list[j]);
          }
        } catch (e) { /* skip bad file */ }
      }
      cb(out);
    });
  }

  // Save one theme to a JSON file. Calls cb(where) — the written path (or
  // the downloaded file's name on the web) on success, false otherwise.
  function exportTheme(theme, cb) {
    var c = _connector();
    if (!c) { cb(false); return; }
    var safe = String(theme.name || theme.id || "theme").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
    c.files.saveText({
      title: "Export colour theme",
      extensions: ["json"],
      defaultName: safe + ".json",
      forceExtension: "json",
      mime: "application/json",
      text: JSON.stringify(theme, null, 2)
    }, function (err, res) {
      cb((!err && res) ? (res.path || res.name) : false);
    });
  }

  return {
    loadAll: loadAll,
    saveAll: saveAll,
    addOrUpdate: addOrUpdate,
    remove: remove,
    importThemes: importThemes,
    exportTheme: exportTheme,
    storePath: _resolveStorePath
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = ThemesStore; }
