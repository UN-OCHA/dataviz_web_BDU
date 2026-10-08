/**
 * Cluster Line Chart Renderer — small multiples
 *
 * A grid of small line charts, ONE PANEL PER VALUE COLUMN (series).
 * Same principle as the cluster bar / cluster donut, but each series
 * becomes its own mini line chart instead of sharing one plot. Useful
 * when overlaid lines would be a spaghetti — separate the trends into
 * a faceted grid that's still comparable.
 *
 * Data shape: [{label, values: [v1, v2, ...]}]   (same as line/cluster)
 *   label        → the shared X-axis category (year, quarter…) IN ORDER
 *   values[s]    → series s's value at that category
 *   panels        = number of value columns (series)
 *
 * Design rules:
 *   • Each panel carries a small bold HEADING = its column header
 *     (config.seriesNames[s]), TOP-LEFT aligned, with clear space
 *     above (from the chart's text block) and below (before the plot)
 *     so it never collides with the chart or its own line.
 *   • All panels share ONE Y scale, so the mini charts are directly
 *     comparable (the whole point of small multiples).
 *   • Panels align on a grid using the X AXIS as the reference: the
 *     heading band, the plot band and the x-label band each have a
 *     FIXED height (the max needed across all panels), so a heading
 *     that wraps to two lines in one panel never pushes that panel's
 *     plot out of alignment with its neighbours.
 *
 * Reused line settings:
 *   lineValueLabels (default ON) — value printed above each point
 *   lineShowDots    (default OFF) — dots are off by default
 *   lineShowYAxis   — when on, EVERY panel gets its own gridded Y axis
 *   shade, lineDotSize, colors (each panel takes its series colour)
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  var MAX_PANELS = 12;          // beyond this the panels get too small to read
  var IDEAL_PANEL_W = 150;      // target panel width before wrapping to a new row
  var PANEL_GAP_X = 20;
  var PANEL_GAP_Y = 24;
  var GRID_TOP_PAD = 6;         // breathing room between the title block and the first heading
  var HEADING_GAP = 9;          // heading band → plot (keeps the heading clear of the line)
  var XAXIS_GAP = 4;            // plot → x-label band

  function seriesCount(data) {
    var n = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].values && data[i].values.length > n) n = data[i].values.length;
    }
    return n;
  }

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    // Panels = value columns. Cap so they stay readable.
    var nP = seriesCount(data);
    if (nP === 0) return null;
    if (nP > MAX_PANELS) {
      R.pushWarning("panels-capped", {
        count: nP - MAX_PANELS,
        suggestion: "Small multiples stay readable up to " + MAX_PANELS +
          " panels. Showing the first " + MAX_PANELS + " — drop or combine columns."
      });
      nP = MAX_PANELS;
    }

    // Small multiples are a SINGLE colour by default (the style
    // primary), so the grid reads as one coherent set distinguished by
    // its headings — not a rainbow. Per-panel overrides live in
    // config.clusterLineColors, keyed by column header.
    var primaryColor = (config.colors && config.colors[0]) || "#009EDB";
    var panelOverrides = (config.clusterLineColors && typeof config.clusterLineColors === "object")
      ? config.clusterLineColors : {};
    var seriesNames = config.seriesNames || [];
    var showDots = !!config.lineShowDots;                       // OFF by default
    // Small multiples have their OWN label/axis defaults (distinct from
    // the single line chart): Y axis ON, value labels OFF — the axis
    // carries magnitude, keeping the little panels uncluttered.
    var showValueLabels = !!config.clusterLineValueLabels;       // OFF by default
    var showYAxis = (config.clusterLineYAxis !== false);         // ON by default
    var shade = !!config.shade;
    var dotRadius = (config.lineDotSize != null ? config.lineDotSize : 4);
    if (dotRadius < 1) dotRadius = 1;
    var strokeW = rs.strokeWidth;
    var lineH = Math.round(rs.labelSize * 1.2);

    // Flush-left: leftmost panel sits at x=0.
    var marginLeft = 0;
    var marginRight = rs.marginRight;

    // ── Header (chart-level, independent of panel headings) ──
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    // Extra pad so the first row of panel headings clears the chart's
    // own title / subtitle / comments block (the Text-tab content).
    var plotTop = R.computePlotTop(rs, header) + GRID_TOP_PAD;
    var plotWidth = svgW - marginLeft - marginRight;

    // ── Grid sizing ────────────────────────────────────
    var perRow = Math.max(1, Math.floor((plotWidth + PANEL_GAP_X) / (IDEAL_PANEL_W + PANEL_GAP_X)));
    if (perRow > nP) perRow = nP;
    var cellW = (plotWidth + PANEL_GAP_X) / perRow - PANEL_GAP_X;
    var rows = Math.ceil(nP / perRow);

    // ── Y scale ─────────────────────────────────────────
    // Default: ONE shared scale across all panels so the trends are
    // directly comparable. With "independent scale" on, each panel gets
    // its own min/max so a small-magnitude series still shows its shape
    // (trend-reading, not magnitude comparison).
    var independent = !!config.clusterLineIndependentScale;

    function rangeForSeries(p) {            // nice scale for one column
      var mn = Infinity, mx = -Infinity;
      for (var r = 0; r < data.length; r++) {
        var v = (data[r].values || [])[p];
        if (v == null || isNaN(v)) continue;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mn === Infinity) { mn = 0; mx = 1; }
      return R.niceScale(mn, mx, Math.min(rs.maxTicks, 5));
    }

    // Shared scale (also the per-panel scale when not independent).
    var sMin = Infinity, sMax = -Infinity;
    for (var r0 = 0; r0 < data.length; r0++) {
      var vals0 = data[r0].values || [];
      for (var s0 = 0; s0 < nP; s0++) {
        var v0 = vals0[s0];
        if (v0 == null || isNaN(v0)) continue;
        if (v0 < sMin) sMin = v0;
        if (v0 > sMax) sMax = v0;
      }
    }
    if (sMin === Infinity) { sMin = 0; sMax = 1; }
    var sharedScale;
    if (!independent && config.axisMax != null && config.axisMax > 0) sharedScale = { min: sMin, max: config.axisMax, ticks: null };
    else sharedScale = R.niceScale(sMin, sMax, Math.min(rs.maxTicks, 5));

    // One scale per panel.
    var panelScales = [];
    for (var ps = 0; ps < nP; ps++) {
      panelScales.push(independent ? rangeForSeries(ps) : sharedScale);
    }

    // Y-axis tick labels (per panel) + a uniform left gutter (widest
    // tick label across all panels, so panels stay the same width).
    var panelTicks = [];
    var yGutter = 0;
    if (showYAxis) {
      var maxTickW = 0;
      for (var pt = 0; pt < nP; pt++) {
        var tks = panelScales[pt].ticks || R.niceScale(panelScales[pt].min, panelScales[pt].max, Math.min(rs.maxTicks, 5)).ticks;
        var arr = [];
        for (var t = 0; t < tks.length; t++) {
          var tl = R.formatNumber(tks[t], config.numFmt);
          arr.push({ value: tks[t], text: tl });
          var tw = tl.length * rs.labelSize * R.LABEL_ADVANCE;
          if (tw > maxTickW) maxTickW = tw;
        }
        panelTicks.push(arr);
      }
      yGutter = Math.ceil(maxTickW) + 6;
    }

    // Plot horizontal geometry inside each cell.
    var insetX = Math.max(showDots ? dotRadius : 0, 3);
    var plotLeft = yGutter;                         // 0 when no Y axis
    var innerW = Math.max(20, cellW - plotLeft - insetX * 2);

    function pointX(idx) {
      if (data.length <= 1) return plotLeft + innerW / 2 + insetX;
      return plotLeft + insetX + idx * (innerW / (data.length - 1));
    }

    // ── Heading band (fixed height across ALL panels) ──
    // Wrap each column header to the panel width; reserve the max line
    // count so every panel's plot starts at the same y.
    var headingWraps = [];
    var maxHeadingLines = 1;
    var headingTrunc = 0;
    for (var hp = 0; hp < nP; hp++) {
      var nm = String(seriesNames[hp] || ("Series " + (hp + 1)));
      var w = R.wrapToFit(nm, rs.labelSize, cellW - 2, 2, R.LABEL_ADVANCE);
      headingWraps.push(w);
      if (!w.fits) headingTrunc++;
      if (w.lines.length > maxHeadingLines) maxHeadingLines = w.lines.length;
    }
    if (headingTrunc > 0) {
      R.pushWarning("label-truncated", { count: headingTrunc,
        suggestion: "Try a wider chart, fewer panels per row, or shorter column headers" });
    }
    var headingBandH = maxHeadingLines * lineH;

    // ── X-label band (fixed height) ──
    var catLabels = [];
    var widestCat = 0;
    for (var c = 0; c < data.length; c++) {
      var cl = String(data[c].label || "");
      catLabels.push(cl);
      var clw = cl.length * rs.labelSize * R.LABEL_ADVANCE;
      if (clw > widestCat) widestCat = clw;
    }
    var showAllCats = data.length <= 1 || (data.length * (widestCat + 6) <= innerW);
    var xLabelBandH = lineH;

    // ── Panel plot height (aspect-driven, clamped) ──
    var plotH = Math.round(cellW * 0.6);
    if (plotH < 56) plotH = 56;
    if (plotH > 130) plotH = 130;

    var cellH = headingBandH + HEADING_GAP + plotH + XAXIS_GAP + xLabelBandH;
    var gridH = rows * cellH + (rows - 1) * PANEL_GAP_Y;

    // ── Footer ──
    var footerStartY = R.computeFooterStart(rs, plotTop + gridH, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height)  // request, but never clip content
      : (footerStartY + footer.height);

    // ── Build panels ───────────────────────────────────
    var body = [];
    body.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    var valueSize = Math.max(8, rs.valueSize - 1);

    for (var p = 0; p < nP; p++) {
      var row = Math.floor(p / perRow);
      var col = p - row * perRow;
      var cellX = col * (cellW + PANEL_GAP_X);
      var cellY = row * (cellH + PANEL_GAP_Y);
      var panelName = String(seriesNames[p] || ("Series " + (p + 1)));
      var color = panelOverrides[panelName] || primaryColor;

      body.push('    <g transform="translate(' + cellX.toFixed(1) + ',' + cellY.toFixed(1) + ')">');

      // Heading — TOP-LEFT aligned, bold. Truncated → faded.
      var hw = headingWraps[p];
      var hColor = hw.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
      var hLines = hw.lines.length ? hw.lines : [""];
      for (var hl = 0; hl < hLines.length; hl++) {
        body.push('      <text x="0" y="' + (hl * lineH + rs.labelSize).toFixed(1) +
          '" font-family="' + fonts.label + '" font-weight="700" font-size="' + rs.labelSize +
          '" fill="' + hColor + '" text-anchor="start">' + R.escapeXml(hLines[hl]) + '</text>');
      }

      var plotY = headingBandH + HEADING_GAP;
      var axisY = plotY + plotH;

      // This panel's scale (shared, or its own when independent).
      var sc = panelScales[p];
      var yScale = R.linearScale(sc.min, sc.max, plotH, 0);

      // Y axis (per panel) — gridlines + tick labels in the left gutter.
      var pticks = panelTicks[p] || [];
      if (showYAxis && pticks.length) {
        for (var yt = 0; yt < pticks.length; yt++) {
          var tv = pticks[yt].value;
          if (tv < sc.min - 0.0001 || tv > sc.max + 0.0001) continue;
          var gy = plotY + yScale(tv);
          body.push('      <line x1="' + plotLeft.toFixed(1) + '" y1="' + gy.toFixed(1) +
            '" x2="' + cellW.toFixed(1) + '" y2="' + gy.toFixed(1) +
            '" stroke="' + st.gridColor + '" stroke-width="' + rs.gridStrokeWidth + '"/>');
          body.push('      <text x="' + (plotLeft - 4).toFixed(1) + '" y="' + (gy + rs.labelSize * 0.35).toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
            '" fill="' + st.labelColor + '" text-anchor="end">' + R.escapeXml(pticks[yt].text) + '</text>');
        }
      }

      // Points (gaps break the line).
      var pts = [];
      for (var d = 0; d < data.length; d++) {
        var raw = (data[d].values || [])[p];
        if (raw == null || isNaN(raw)) { pts.push(null); continue; }
        pts.push({ x: pointX(d), y: plotY + yScale(raw), value: raw });
      }

      // Area fill (optional).
      var realPts = [];
      for (var rp = 0; rp < pts.length; rp++) { if (pts[rp]) realPts.push(pts[rp]); }
      if (shade && realPts.length > 1) {
        var area = "M" + realPts[0].x.toFixed(1) + "," + axisY.toFixed(1);
        for (var a = 0; a < realPts.length; a++) area += " L" + realPts[a].x.toFixed(1) + "," + realPts[a].y.toFixed(1);
        area += " L" + realPts[realPts.length - 1].x.toFixed(1) + "," + axisY.toFixed(1) + " Z";
        body.push('      <path d="' + area + '" fill="' + color + '" fill-opacity="0.1"/>');
      }

      // Line.
      var dParts = [];
      var started = false;
      for (var l = 0; l < pts.length; l++) {
        if (!pts[l]) { started = false; continue; }
        dParts.push((started ? "L" : "M") + pts[l].x.toFixed(1) + "," + pts[l].y.toFixed(1));
        started = true;
      }
      if (dParts.length) {
        body.push('      <path d="' + dParts.join(" ") + '" fill="none" stroke="' + color +
          '" stroke-width="' + strokeW + '" stroke-linejoin="round" stroke-linecap="round"/>');
      }

      // Dots (optional, off by default).
      if (showDots) {
        for (var dd = 0; dd < pts.length; dd++) {
          if (!pts[dd]) continue;
          body.push('      <circle cx="' + pts[dd].x.toFixed(1) + '" cy="' + pts[dd].y.toFixed(1) +
            '" r="' + dotRadius + '" fill="#ffffff" stroke="' + color +
            '" stroke-width="' + (strokeW * 0.8).toFixed(1) + '"/>');
        }
      }

      // Value labels (on by default) — above each point, flipping below
      // when the point sits too near the panel top.
      if (showValueLabels) {
        for (var vl = 0; vl < pts.length; vl++) {
          var Pp = pts[vl];
          if (!Pp) continue;
          if (config.hideZeroLabels && Pp.value === 0) continue;
          var vtext = R.formatNumber(Pp.value, config.numFmt);
          var gap = (showDots ? dotRadius : 0) + 3;
          var above = (Pp.y - gap - valueSize) >= plotY;
          var vy = above ? (Pp.y - gap) : (Pp.y + gap + valueSize);
          // Clamp x so the label doesn't spill past the panel edges.
          var vx = Pp.x;
          var halfW = (vtext.length * valueSize * 0.6) / 2;
          if (vx - halfW < plotLeft) vx = plotLeft + halfW;
          if (vx + halfW > cellW) vx = cellW - halfW;
          body.push('      <text x="' + vx.toFixed(1) + '" y="' + vy.toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + valueSize +
            '" fill="' + st.valueColor + '" text-anchor="middle">' + R.escapeXml(vtext) + '</text>');
        }
      }

      // Baseline (x axis) — the shared alignment reference.
      body.push('      <line x1="' + plotLeft.toFixed(1) + '" y1="' + axisY.toFixed(1) + '" x2="' + cellW.toFixed(1) +
        '" y2="' + axisY.toFixed(1) + '" stroke="' + st.baselineColor + '" stroke-width="' + rs.gridStrokeWidth + '"/>');

      // X-axis labels (small). All when they fit, else first + last.
      var labelY = axisY + XAXIS_GAP + rs.labelSize;
      if (showAllCats) {
        for (var xc = 0; xc < data.length; xc++) {
          var anchor = "middle";
          if (data.length > 1) { if (xc === 0) anchor = "start"; else if (xc === data.length - 1) anchor = "end"; }
          body.push('      <text x="' + pointX(xc).toFixed(1) + '" y="' + labelY.toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
            '" fill="' + st.labelColor + '" text-anchor="' + anchor + '">' + R.escapeXml(catLabels[xc]) + '</text>');
        }
      } else if (data.length >= 2) {
        body.push('      <text x="' + pointX(0).toFixed(1) + '" y="' + labelY.toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" fill="' + st.labelColor + '" text-anchor="start">' + R.escapeXml(catLabels[0]) + '</text>');
        body.push('      <text x="' + pointX(data.length - 1).toFixed(1) + '" y="' + labelY.toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" fill="' + st.labelColor + '" text-anchor="end">' + R.escapeXml(catLabels[data.length - 1]) + '</text>');
      }

      body.push('    </g>');
    }

    body.push('  </g>');

    return R.wrapSVG(svgW, svgH, header, footer, body);
  }

  R.register("cluster-line", "Cluster Line", render);
})();
