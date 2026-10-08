/**
 * HttpUtils — Shared HTTP/HTTPS fetch utility for the panels.
 * Used by MapsPanel and IconsPanel to avoid duplicating network logic.
 *
 * Also provides centralized URL configuration for external services.
 */

/* exported HttpUtils */
/* global Connector */

var HttpUtils = (function () {
  "use strict";

  // ── Centralized URL configuration ─────────────────────
  var URLS = {
    RELIEFWEB_MAPS: "https://reliefweb.int/location-maps",
    GITHUB_ICONS_RAW: "https://raw.githubusercontent.com/UN-OCHA/humanitarian-icons-2026-BDU/main",
    get ICONS_METADATA() { return this.GITHUB_ICONS_RAW + "/metadata.json"; }
  };

  // ── Network access goes through the shell's Connector ───────
  // (Node http/https inside Illustrator; fetch in the web shell, where
  // sites without CORS headers — e.g. ReliefWeb — cannot be reached.)

  /**
   * Fetch a URL as UTF-8 text with redirect handling and timeout.
   * @param {string} url        - The URL to fetch
   * @param {function} callback - function(err, body)
   * @param {number} [timeout]  - Timeout in ms (default 30000)
   */
  function get(url, callback, timeout) {
    Connector.http.getText(url, callback, timeout);
  }

  /**
   * Fetch a URL as raw bytes (for binary/SVG downloads with progress).
   * @param {string} url        - The URL to fetch
   * @param {function} onProgress - function(receivedBytes, totalBytes) — may be null
   * @param {function} callback   - function(err, buffer)
   * @param {number} [timeout]    - Timeout in ms (default 30000)
   */
  function getBuffer(url, onProgress, callback, timeout) {
    Connector.http.getBuffer(url, onProgress, callback, timeout);
  }

  // ── Shared HTML/attr escape utilities ─────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&apos;");
  }

  return {
    URLS: URLS,
    get: get,
    getBuffer: getBuffer,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr
  };
})();
