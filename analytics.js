/**
 * Analytics — Silent usage tracking via Google Apps Script.
 *
 * Fetches approximate location on startup, then sends fire-and-forget
 * pings with version, event name, and location.
 *
 * Call: Analytics.init(appVersion) on startup.
 * Then:  Analytics.ping(eventName) for each tracked action.
 *
 * Also exposed as window.sendAnalyticsPing for use by other panels
 * (icons, flags, maps) that don't import this module directly.
 *
 * When counts may start, where the location comes from, and any extra
 * fields are the shell's call (Connector.analytics): the plugin starts at
 * once and looks up an approximate city/country; the web version starts
 * after sign-up, sends only a region from the browser's time zone plus an
 * anonymous user code, and its counts land on their own tab.
 */

/* global Connector */

var Analytics = (function () {
  "use strict";

  var ENDPOINT = "https://script.google.com/macros/s/AKfycbx2I49l5B3V0Q51xyggJBWGd30rJBFSVVeCR5rVaNrjkoBbpdoWKJKOMG8Ba7MLvslA/exec";

  var _version = "";
  var _location = "unknown";
  var _platform = "other";
  var _enabled = false;
  var _shell = null;

  // Detect host OS from navigator.platform. Returns "win", "mac",
  // "linux", or "other". Used both to tag each ping and to let Javier
  // see the Mac vs Windows breakdown in the analytics sheet.
  function detectPlatform() {
    try {
      var p = (navigator.platform || "").toLowerCase();
      if (p.indexOf("win") >= 0) return "win";
      if (p.indexOf("mac") >= 0) return "mac";
      if (p.indexOf("linux") >= 0) return "linux";
    } catch (e) {}
    return "other";
  }

  function init(appVersion) {
    _version = appVersion || "";
    _platform = detectPlatform();
    var shell = (typeof Connector !== "undefined") ? Connector.analytics : null;
    if (!shell) return;
    shell.whenReady(function () { _shell = shell; _enabled = true; start(); });
  }

  function start() {
    var shell = _shell;

    // Fetch approximate location once, then fire the startup ping.
    // The ping waits for the geo lookup to finish (or time out) so it
    // lands with a real location value — not "unknown".
    var startupPinged = false;
    function firePending() {
      if (startupPinged) return;
      startupPinged = true;
      ping("open:" + _platform);
    }

    try {
      shell.location(function (loc) {
        if (loc) _location = loc;
        firePending();
      });
    } catch (e) {
      firePending();
    }

    // Safety net: fire the startup ping no later than 6 seconds, even
    // if the xhr never triggers any callback (firewalls, offline, etc.).
    setTimeout(firePending, 6000);
  }

  function ping(event) {
    if (!ENDPOINT || !_enabled) return;
    try {
      var xhr = new XMLHttpRequest();
      var params = "?v=" + encodeURIComponent(_version) +
                   "&e=" + encodeURIComponent(event || "open") +
                   "&loc=" + encodeURIComponent(_location) +
                   (_shell && _shell.params ? _shell.params() : "");
      xhr.open("GET", ENDPOINT + params, true);
      xhr.timeout = 5000;
      xhr.onerror = function () {};
      xhr.send();
    } catch (e) { /* silent */ }
  }

  // Expose globally so other panels (icons, flags, maps) can call it
  window.sendAnalyticsPing = ping;

  return {
    init: init,
    ping: ping
  };
})();
