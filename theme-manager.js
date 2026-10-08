/**
 * ThemeManager — Dark/light theme toggle with system preference support.
 *
 * Saves preference to localStorage. Falls back to system preference
 * (prefers-color-scheme) when no manual choice has been made.
 * Runs immediately on load — no init() call needed.
 */

/* global */

var ThemeManager = (function () {
  "use strict";

  var STORAGE_KEY = "ocha_dataviz_theme";

  function init() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    } else {
      var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
    }
  }

  function toggle() {
    var current = document.documentElement.getAttribute("data-theme") || "dark";
    var next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
  }

  // Initialize immediately
  init();

  // Listen for system theme changes (only if user hasn't manually set one)
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
      var saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch (ex) {}
      if (!saved) {
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      }
    });
  }

  return {
    toggle: toggle
  };
})();
