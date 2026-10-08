/**
 * Map Chart Renderer — v1
 *
 * Renders choropleth and bubble maps from GeoJSON features.
 * Registered with ChartRegistry; uses shared header/footer/fonts/styles.
 *
 * Config expects:
 *   config.geoFeatures     — array of { feature, path, centroid, name, pcode, value }
 *   config.adminOutline     — SVG path d for admin 0 outline (or null)
 *   config.mapType          — "choropleth" or "bubble"
 *   config.showLabels       — boolean
 *   config.numClasses       — 3-7 (choropleth bins)
 *   config.colorRamp        — array of hex colors (sequential, light→dark)
 *   config.bubbleMaxRadius  — max bubble radius in px
 *   config.bubbleColor      — hex color for bubbles
 *   config.neutralFill      — fill for regions with no data
 */

/* global ChartRegistry, GeoProjection */

(function () {
  "use strict";

  var R = ChartRegistry;

  // ── Quantize classification ────────────────────────────

  /**
   * Classify values into equal-interval bins.
   * Returns { breaks: [], colors: [], classify: fn(value) → colorIndex }
   */
  function quantize(values, numClasses, ramp) {
    if (!values.length) return { breaks: [], colors: ramp.slice(0, numClasses), classify: function () { return 0; } };

    var min = Infinity, max = -Infinity;
    for (var i = 0; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    if (min === max) max = min + 1;

    var step = (max - min) / numClasses;
    var breaks = [];
    for (var b = 0; b <= numClasses; b++) {
      breaks.push(min + b * step);
    }

    // Sample colors from ramp
    var colors = [];
    for (var c = 0; c < numClasses; c++) {
      var idx = Math.round(c * (ramp.length - 1) / (numClasses - 1));
      colors.push(ramp[Math.min(idx, ramp.length - 1)]);
    }

    return {
      breaks: breaks,
      colors: colors,
      classify: function (val) {
        for (var j = numClasses - 1; j >= 0; j--) {
          if (val >= breaks[j]) return j;
        }
        return 0;
      }
    };
  }

  // ── Legend renderers ───────────────────────────────────

  function renderChoroplethLegend(x, y, width, classInfo, fonts, st, numFmt) {
    var svg = [];
    var boxH = 10;
    var boxW = Math.min(30, Math.floor((width - 20) / classInfo.colors.length));
    var labelSize = 8;

    for (var i = 0; i < classInfo.colors.length; i++) {
      var bx = x + i * boxW;
      svg.push('    <rect x="' + bx + '" y="' + y + '" width="' + boxW +
        '" height="' + boxH + '" fill="' + classInfo.colors[i] + '"/>');
    }

    // Tick labels at breaks
    for (var t = 0; t <= classInfo.colors.length; t++) {
      var tx = x + t * boxW;
      var val = classInfo.breaks[t];
      if (val !== undefined) {
        svg.push('    <text x="' + tx + '" y="' + (y + boxH + labelSize + 2) +
          '" font-family="' + fonts.label + '" font-size="' + labelSize +
          '" fill="' + st.labelColor + '" text-anchor="middle">' +
          R.formatNumber(val, numFmt) + '</text>');
      }
    }

    return { svg: svg, height: boxH + labelSize + 8 };
  }

  function renderBubbleLegend(x, y, maxR, maxVal, bubbleColor, fonts, st, numFmt) {
    var svg = [];
    var sizes = [1, 0.5, 0.25]; // relative sizes
    var labelSize = 8;
    var cx = x + maxR + 4;
    var baseline = y + maxR * 2 + 4;

    for (var i = 0; i < sizes.length; i++) {
      var r = Math.max(2, maxR * Math.sqrt(sizes[i]));
      var val = maxVal * sizes[i];
      var cy = baseline - r;

      svg.push('    <circle cx="' + cx + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) +
        '" fill="none" stroke="' + st.labelColor + '" stroke-width="0.5"/>');
      svg.push('    <line x1="' + (cx + r).toFixed(1) + '" y1="' + cy.toFixed(1) +
        '" x2="' + (cx + maxR + 20).toFixed(1) + '" y2="' + cy.toFixed(1) +
        '" stroke="' + st.labelColor + '" stroke-width="0.3"/>');
      svg.push('    <text x="' + (cx + maxR + 24).toFixed(1) + '" y="' + (cy + labelSize * 0.35).toFixed(1) +
        '" font-family="' + fonts.label + '" font-size="' + labelSize +
        '" fill="' + st.labelColor + '">' + R.formatNumber(val, numFmt) + '</text>');
    }

    return { svg: svg, height: maxR * 2 + 12 };
  }

  // ── Main renderer ──────────────────────────────────────

  function render(title, data, config) {
    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    var geoFeatures = config.geoFeatures || [];
    var mapType     = config.mapType || "choropleth";
    var showLabels  = config.showLabels !== false;
    var numClasses  = config.numClasses || 5;
    var ramp        = config.colorRamp || ["#E3EDF6", "#C5DFEF", "#64BDEA", "#009EDB", "#0074B7", "#004987", "#002E6E"];
    var neutralFill = config.neutralFill || "#E6E6E6";
    var bubbleMaxR  = config.bubbleMaxRadius || 20;
    var bubbleColor = config.bubbleColor || (config.colors && config.colors[0]) || "#009EDB";

    // Flush-left: map's left clip edge at x=0, aligned with title
    var marginLeft  = 0;
    var marginRight = 10;

    // ── Header
    var header = R.renderHeader({
      x: 0,
      startY: 6,
      title: title,
      subtitle: config.subtitle,
      comments: config.comments,
      rs: rs,
      style: st,
      vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var mapTop = R.computePlotTop(rs, header);

    // ── Map dimensions (fit into available width)
    var mapW = svgW - marginLeft - marginRight;
    var mapH = Math.round(mapW * 0.85); // default aspect, will be overridden if height set

    if (config.height) {
      // Reserve space for header, legend, footer, disclaimer
      mapH = config.height - mapTop - 80; // rough estimate
      if (mapH < 100) mapH = 100;
    }

    // ── Collect values for classification
    var values = [];
    for (var vi = 0; vi < geoFeatures.length; vi++) {
      if (geoFeatures[vi].value !== null && geoFeatures[vi].value !== undefined && !isNaN(geoFeatures[vi].value)) {
        values.push(geoFeatures[vi].value);
      }
    }

    var classInfo = quantize(values, numClasses, ramp);

    // ── Find max value for bubble scaling
    var maxVal = 0;
    for (var mv = 0; mv < values.length; mv++) {
      if (values[mv] > maxVal) maxVal = values[mv];
    }
    if (maxVal === 0) maxVal = 1;

    // ── Stroke scaling (relative to A4 landscape = 842pt)
    var sf = mapW / 842;
    function sw(ref) { return Math.round(ref * sf * 4) / 4 || 0.25; }
    function dash(ref) { var d = Math.round(ref * sf * 4) / 4 || 0.5; return d + " " + d; }

    // ── Build SVG body
    var body = [];

    // Clip rect
    var clipId = "mc" + Math.round(Math.random() * 99999);
    body.push('  <defs><clipPath id="' + clipId + '"><rect x="0" y="0" width="' + mapW + '" height="' + mapH + '"/></clipPath></defs>');
    body.push('  <g transform="translate(' + marginLeft + ',' + mapTop + ')" clip-path="url(#' + clipId + ')">');

    // 1. Ocean background
    body.push('    <rect x="0" y="0" width="' + mapW + '" height="' + mapH + '" fill="#E1E8F6"/>');

    // 2. Surrounding country fills (no stroke)
    var sPaths = config.surroundingPaths || [];
    for (var si = 0; si < sPaths.length; si++) {
      if (sPaths[si]) body.push('    <path d="' + sPaths[si] + '" fill="#E6E7E8" stroke="none"/>');
    }

    // 3. Featured country region fills (white or choropleth, no stroke)
    for (var fi = 0; fi < geoFeatures.length; fi++) {
      var gf = geoFeatures[fi];
      if (!gf.path) continue;
      var fill = "#FFFFFF";
      if (mapType === "choropleth" && gf.value !== null && gf.value !== undefined && !isNaN(gf.value)) {
        fill = classInfo.colors[classInfo.classify(gf.value)];
      }
      body.push('    <path d="' + gf.path + '" fill="' + fill + '" stroke="none"/>');
    }

    // 4. Admin 1 boundary lines (dashed)
    var a1Lines = config.admin1LinePaths || [];
    for (var a1i = 0; a1i < a1Lines.length; a1i++) {
      if (!a1Lines[a1i]) continue;
      body.push('    <path d="' + a1Lines[a1i] + '" fill="none"' +
        ' stroke="#C7C8CA" stroke-width="' + sw(0.8) + '" stroke-dasharray="' + dash(2.4) + '"' +
        ' stroke-linejoin="round" stroke-linecap="butt"/>');
    }

    // 5. International boundary lines (solid)
    var wLines = config.worldLinePaths || [];
    for (var wli = 0; wli < wLines.length; wli++) {
      if (!wLines[wli]) continue;
      body.push('    <path d="' + wLines[wli] + '" fill="none" stroke="#737373" stroke-width="' + sw(1.3) + '" stroke-linejoin="round" stroke-linecap="butt"/>');
    }

    // 6. Coastlines
    var cPaths = config.coastlinePaths || [];
    for (var ci = 0; ci < cPaths.length; ci++) {
      if (!cPaths[ci]) continue;
      body.push('    <path d="' + cPaths[ci] + '" fill="none" stroke="#64BEEB" stroke-width="' + sw(0.5) + '" stroke-linejoin="round" stroke-linecap="butt"/>');
    }

    // 7. Bubbles
    if (mapType === "bubble") {
      var sorted = geoFeatures.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
      for (var bi = 0; bi < sorted.length; bi++) {
        var bf = sorted[bi];
        if (!bf.centroid || bf.value === null || bf.value === undefined || isNaN(bf.value)) continue;
        var r = Math.max(2, bubbleMaxR * Math.sqrt(bf.value / maxVal));
        body.push('    <circle cx="' + bf.centroid[0].toFixed(1) + '" cy="' + bf.centroid[1].toFixed(1) +
          '" r="' + r.toFixed(1) + '" fill="' + bubbleColor + '" fill-opacity="0.7" stroke="#FFFFFF" stroke-width="0.5"/>');
      }
    }

    body.push('  </g>');

    // ── Legend (only show when there's data to classify)
    var legendY = mapTop + mapH + 10;
    var legend = { svg: [], height: 0 };
    if (values.length > 0) {
      if (mapType === "choropleth") {
        legend = renderChoroplethLegend(marginLeft, legendY, mapW, classInfo, fonts, st, config.numFmt);
      } else {
        legend = renderBubbleLegend(marginLeft, legendY, bubbleMaxR, maxVal, bubbleColor, fonts, st, config.numFmt);
      }
      for (var lgi = 0; lgi < legend.svg.length; lgi++) body.push(legend.svg[lgi]);
    }

    // ── UN Disclaimer
    var disclaimerY = legendY + legend.height + 6;
    var disclaimerSize = 7;
    body.push('  <text x="' + marginLeft + '" y="' + disclaimerY +
      '" font-family="' + fonts.label + '" font-size="' + disclaimerSize +
      '" fill="#A7A9AC" font-style="italic">The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations.</text>');

    // ── Footer — gap added by computeFooterStart only when footer has text.
    // Plot bottom = disclaimerY (UN disclaimer is the last element above the footer).
    var footerStartY = R.computeFooterStart(rs, disclaimerY, !!config.footer);
    var footer = R.renderFooter({
      x: 0,
      startY: footerStartY,
      footer: config.footer,
      rs: rs,
      style: st,
      vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    for (var fti = 0; fti < footer.svg.length; fti++) body.push(footer.svg[fti]);

    // ── Final SVG height
    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height + rs.marginBottom)  // request, but never clip content
      : (footerStartY + footer.height + rs.marginBottom);

    return R.wrapSVG(svgW, svgH, header, { svg: [], height: 0 }, body);
  }

  R.register("map", "Map", render);
})();
