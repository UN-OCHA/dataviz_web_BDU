/**
 * GeoProjection — Lightweight Mercator projection + GeoJSON-to-SVG utilities.
 *
 * Pure ES5, no dependencies. Designed for the OCHA DataViz Tool CEP plugin.
 *
 * Public API:
 *   GeoProjection.mercator(bbox, width, height, padding)  → projector
 *   GeoProjection.featureToPath(feature, projector)        → SVG path d
 *   GeoProjection.centroid(feature, projector)              → [x, y]
 *   GeoProjection.bbox(geojson)                             → [minLon, minLat, maxLon, maxLat]
 *   GeoProjection.filterByAdmin(geojson, level)             → GeoJSON FeatureCollection
 */

/* exported GeoProjection */

var GeoProjection = (function () {
  "use strict";

  var PI  = Math.PI;
  var RAD = PI / 180;

  var api = {};

  // ── Mercator helpers ───────────────────────────────────

  function mercY(lat) {
    var latR = lat * RAD;
    return Math.log(Math.tan(PI / 4 + latR / 2));
  }

  // ── Bounding box ───────────────────────────────────────

  /**
   * Compute bounding box of a GeoJSON FeatureCollection or single Feature.
   * Returns [minLon, minLat, maxLon, maxLat].
   */
  api.bbox = function (geojson) {
    var minX =  Infinity, minY =  Infinity;
    var maxX = -Infinity, maxY = -Infinity;

    function scan(coords) {
      for (var i = 0; i < coords.length; i++) {
        if (typeof coords[i][0] === "number") {
          var lon = coords[i][0], lat = coords[i][1];
          if (lon < minX) minX = lon;
          if (lon > maxX) maxX = lon;
          if (lat < minY) minY = lat;
          if (lat > maxY) maxY = lat;
        } else {
          scan(coords[i]);
        }
      }
    }

    var features = geojson.features || [geojson];
    for (var f = 0; f < features.length; f++) {
      var geom = features[f].geometry || features[f];
      if (geom && geom.coordinates) scan(geom.coordinates);
    }
    return [minX, minY, maxX, maxY];
  };

  // ── Projector factory ──────────────────────────────────

  /**
   * Create a Mercator projector fitted to a bounding box.
   *
   * @param {number[]} bbox   [minLon, minLat, maxLon, maxLat]
   * @param {number}   width  SVG viewport width
   * @param {number}   height SVG viewport height
   * @param {number}   [pad]  Padding in px (default 10)
   * @returns {{ project: function(lon,lat):[x,y] }}
   */
  api.mercator = function (bbox, width, height, pad) {
    pad = (pad !== undefined) ? pad : 10;

    var minLon = bbox[0], minLat = bbox[1];
    var maxLon = bbox[2], maxLat = bbox[3];

    // Project all bounds into Mercator space (both X and Y in same units)
    var pMinY = mercY(minLat);
    var pMaxY = mercY(maxLat);
    // In Mercator, X is scaled by cos(center latitude) to match Y units
    var centerLat = (minLat + maxLat) / 2;
    var cosLat = Math.cos(centerLat * RAD);

    var pMinX = minLon * RAD * cosLat;
    var pMaxX = maxLon * RAD * cosLat;

    var geoW = pMaxX - pMinX;
    var geoH = pMaxY - pMinY;

    // Fit to viewport preserving aspect ratio
    var drawW = width  - pad * 2;
    var drawH = height - pad * 2;

    var scaleX = drawW / geoW;
    var scaleY = drawH / geoH;
    var scale  = Math.min(scaleX, scaleY);

    // Center offset
    var offX = pad + (drawW - geoW * scale) / 2;
    var offY = pad + (drawH - geoH * scale) / 2;

    return {
      project: function (lon, lat) {
        var x = (lon * RAD * cosLat - pMinX) * scale + offX;
        var y = (pMaxY - mercY(lat)) * scale + offY;
        return [x, y];
      }
    };
  };

  // ── GeoJSON → SVG path ─────────────────────────────────

  function ringToPath(ring, projector, cmd) {
    var d = "";
    for (var i = 0; i < ring.length; i++) {
      var pt = projector.project(ring[i][0], ring[i][1]);
      d += (i === 0 ? cmd : "L") + pt[0].toFixed(1) + "," + pt[1].toFixed(1);
    }
    d += "Z";
    return d;
  }

  /**
   * Convert a GeoJSON Feature (Polygon/MultiPolygon) to an SVG path `d` string.
   */
  api.featureToPath = function (feature, projector) {
    var geom = feature.geometry;
    if (!geom) return "";

    var d = "";
    if (geom.type === "Polygon") {
      for (var r = 0; r < geom.coordinates.length; r++) {
        d += ringToPath(geom.coordinates[r], projector, "M");
      }
    } else if (geom.type === "MultiPolygon") {
      for (var p = 0; p < geom.coordinates.length; p++) {
        for (var r2 = 0; r2 < geom.coordinates[p].length; r2++) {
          d += ringToPath(geom.coordinates[p][r2], projector, "M");
        }
      }
    }
    return d;
  };

  /**
   * Convert a GeoJSON line Feature (LineString/MultiLineString) to SVG path `d`.
   * Unlike polygon paths, line paths are NOT closed (no Z).
   */
  api.lineFeatureToPath = function (feature, projector) {
    var geom = feature.geometry;
    if (!geom) return "";

    var d = "";
    function lineToD(coords) {
      for (var i = 0; i < coords.length; i++) {
        var pt = projector.project(coords[i][0], coords[i][1]);
        // Always start each sub-line with M (MoveTo)
        d += (i === 0 ? "M" : "L") + pt[0].toFixed(1) + "," + pt[1].toFixed(1);
      }
    }

    if (geom.type === "LineString") {
      lineToD(geom.coordinates);
    } else if (geom.type === "MultiLineString") {
      for (var ml = 0; ml < geom.coordinates.length; ml++) {
        // Each sub-line must start with its own M command
        var subCoords = geom.coordinates[ml];
        for (var si = 0; si < subCoords.length; si++) {
          var pt = projector.project(subCoords[si][0], subCoords[si][1]);
          d += (si === 0 ? "M" : "L") + pt[0].toFixed(1) + "," + pt[1].toFixed(1);
        }
      }
    }
    return d;
  };

  // ── Centroid ───────────────────────────────────────────

  /**
   * Compute the projected visual centroid of a GeoJSON Feature.
   * Uses simple average of projected ring points (weighted by ring length).
   */
  api.centroid = function (feature, projector) {
    var geom = feature.geometry;
    if (!geom) return [0, 0];

    var sumX = 0, sumY = 0, count = 0;

    function scanRing(ring) {
      for (var i = 0; i < ring.length; i++) {
        var pt = projector.project(ring[i][0], ring[i][1]);
        sumX += pt[0];
        sumY += pt[1];
        count++;
      }
    }

    if (geom.type === "Polygon") {
      scanRing(geom.coordinates[0]); // outer ring only
    } else if (geom.type === "MultiPolygon") {
      // Use the largest polygon (most points) for centroid
      var largest = geom.coordinates[0];
      for (var p = 1; p < geom.coordinates.length; p++) {
        if (geom.coordinates[p][0].length > largest[0].length) {
          largest = geom.coordinates[p];
        }
      }
      scanRing(largest[0]);
    }

    return count > 0 ? [sumX / count, sumY / count] : [0, 0];
  };

  // ── GeoJSON filtering ─────────────────────────────────

  /**
   * Detect the admin level of a feature from its properties.
   * COD GeoJSON uses field names like ADM0_PCODE, ADM1_PCODE, etc.
   * The highest admin level with a P-code present is the feature's level.
   */
  api.detectAdminLevel = function (props) {
    if (!props) return -1;
    for (var l = 4; l >= 0; l--) {
      var key = "ADM" + l + "_PCODE";
      if (props[key] || props[key.toLowerCase()]) return l;
    }
    // Fallback: check for adminLevel or admin_level property
    if (props.adminLevel !== undefined) return parseInt(props.adminLevel, 10);
    if (props.admin_level !== undefined) return parseInt(props.admin_level, 10);
    return -1;
  };

  /**
   * Filter a GeoJSON FeatureCollection to features of a specific admin level.
   * COD files often bundle multiple levels; this separates them.
   *
   * If the file has features at only one level, returns all features.
   */
  api.filterByAdmin = function (geojson, level) {
    if (!geojson || !geojson.features) return { type: "FeatureCollection", features: [] };

    var out = [];
    for (var i = 0; i < geojson.features.length; i++) {
      var f = geojson.features[i];
      var fl = api.detectAdminLevel(f.properties);
      if (fl === level) out.push(f);
    }

    // If nothing matched, maybe the file is level-specific — return all
    if (out.length === 0 && geojson.features.length > 0) {
      return geojson;
    }

    return { type: "FeatureCollection", features: out };
  };

  // ── Region name extraction ─────────────────────────────

  /**
   * Get the name and P-code of a feature at a given admin level.
   * Tries common COD field naming patterns.
   */
  api.getRegionInfo = function (props, level) {
    if (!props) return { name: "", pcode: "" };

    var nameKeys = [
      "ADM" + level + "_EN",
      "ADM" + level + "_NAME",
      "adm" + level + "_en",
      "adm" + level + "_name",
      "admin" + level + "Name",
      "NAME_" + level,
      "Governor_1",   // BDU Yemen admin1 English name
      "State_En",     // BDU Sudan admin1 English name
      "Terr_Name",    // BDU world country name
      "name"
    ];
    var pcodeKeys = [
      "ADM" + level + "_PCODE",
      "adm" + level + "_pcode",
      "admin" + level + "Pcode",
      "PCODE"
    ];

    var name = "", pcode = "";
    for (var n = 0; n < nameKeys.length; n++) {
      if (props[nameKeys[n]]) { name = props[nameKeys[n]]; break; }
    }
    for (var p = 0; p < pcodeKeys.length; p++) {
      if (props[pcodeKeys[p]]) { pcode = props[pcodeKeys[p]]; break; }
    }

    return { name: name, pcode: pcode };
  };

  // ── Fuzzy name matching ────────────────────────────────

  /**
   * Normalize a string for fuzzy matching: lowercase, strip diacritics,
   * remove punctuation and extra whitespace.
   */
  api.normalizeName = function (str) {
    if (!str) return "";
    var s = String(str).toLowerCase();
    // Strip common diacritics (covers most humanitarian context languages)
    s = s.replace(/[\u0300-\u036f]/g, ""); // combining diacritical marks
    s = s.replace(/[àáâãäå]/g, "a").replace(/[èéêë]/g, "e")
         .replace(/[ìíîï]/g, "i").replace(/[òóôõö]/g, "o")
         .replace(/[ùúûü]/g, "u").replace(/[ñ]/g, "n")
         .replace(/[ç]/g, "c").replace(/[ÿý]/g, "y")
         .replace(/['\u2018\u2019\u02BC]/g, ""); // smart quotes, apostrophes
    s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    return s;
  };

  return api;
})();
