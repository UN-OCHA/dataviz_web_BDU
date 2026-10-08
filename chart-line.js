/**
 * Line Chart Renderer (multi-series)
 *
 * Data shape: [{label, values: [v1, v2, ...]}] — one line per value
 * column, all sharing a single Y scale (so lines are directly
 * comparable without hand-tuning a common max). Single-column data
 * renders as one line, identical to the original single-series chart.
 *
 * Lines are capped at 6 to keep the chart readable (a warning fires
 * when more are supplied, mirroring the pie/donut slice cap).
 *
 * Options (all independent toggles, Design tab):
 *   • lineValueLabels   — print each point's value (default ON). Labels
 *                         are placed by a global pass that dodges EVERY
 *                         line and other labels; a dashed leader line
 *                         connects a label back to its point when it's
 *                         pushed away to clear an overlap.
 *   • lineSeriesEndLabels — print the series name at the end of each
 *                         line (default ON, multi-series only). Lets
 *                         the reader identify lines without a legend.
 *   • lineLegend        — series legend above the plot (default OFF,
 *                         multi-series only).
 *   • lineShowYAxis     — gridded Y axis with tick values on the left
 *                         (default OFF — flush-left, direct labelling).
 *   • lineHiddenLabels  — array of "row:series" keys whose VALUE LABEL
 *                         is suppressed. Lets the user pick exactly
 *                         which point labels appear (the Design-tab
 *                         value-label table writes here). The line/dot
 *                         still draws; only the number is hidden.
 *   • shade             — area fill under the line (single series only).
 *
 * Per-line colour comes from config.colors in series order (same
 * mechanism as cluster / stacked), so reordering the palette reassigns
 * line colours.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  var MAX_LINES = 6;

  // Number of value columns present across the data.
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

    var colors = config.colors || ["#009EDB"];
    var seriesNames = config.seriesNames || [];

    // ── Series count + cap ─────────────────────────────
    var sN = seriesCount(data);
    if (sN === 0) return null;
    if (sN > MAX_LINES) {
      R.pushWarning("line-series-cap", {
        count: sN - MAX_LINES,
        suggestion: "Line charts stay readable up to " + MAX_LINES +
          " lines. Showing the first " + MAX_LINES + " — combine series, or use small multiples."
      });
      sN = MAX_LINES;
    }
    var multi = sN > 1;

    // Per-value-label hide set: keys are "row:series" (row = data index,
    // series = value-column position). Lets the user show labels on just
    // the points that matter (endpoints, peaks) instead of every point.
    var hiddenLabels = {};
    var hiddenLabelList = config.lineHiddenLabels || [];
    for (var hl = 0; hl < hiddenLabelList.length; hl++) hiddenLabels[hiddenLabelList[hl]] = true;

    // ── Options ────────────────────────────────────────
    var showDots = config.lineShowDots !== false;
    var showValueLabels = config.lineValueLabels !== false;      // default ON
    var showLegend = !!config.lineLegend && multi;               // multi only
    var showEndLabels = (config.lineSeriesEndLabels !== false) && multi; // default ON, multi only
    var showYAxis = !!config.lineShowYAxis;
    var shade = !!config.shade && !multi;                        // area fill: single line only
    var labelPos = config.lineLabelPos || "auto";
    var labelBg = config.lineLabelBg || "none";

    var forceRotate = data.length > rs.labelRotateThreshold;
    var rotateLabels = forceRotate && (rs.breakpoint === "xs" || rs.breakpoint === "sm");

    // ── Header ─────────────────────────────────────────
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);

    // ── Optional legend (above plot, multi only) ───────
    var legend = { svg: [], height: 0 };
    if (showLegend) {
      var legendNames = [], legendColors = [];
      for (var ln0 = 0; ln0 < sN; ln0++) {
        legendNames.push(seriesNames[ln0] || ("Series " + (ln0 + 1)));
        legendColors.push(colors[ln0 % colors.length]);
      }
      legend = R.renderStackedLegend({
        x: 0, startY: plotTop,
        names: legendNames,
        colors: legendColors,
        rs: rs, style: st,
        maxWidth: svgW,
        hasSubtitle: !!config.subtitle
      });
      plotTop += legend.height;
    }

    // Point value labels can sit ABOVE the topmost point, which reaches the
    // top of the plot when a value hits the scale max — reserve that label
    // row between header/legend and plot so labels don't crowd the title.
    if (config.lineValueLabels !== false) {
      plotTop += rs.valueSize + 6;
    }

    // ── Data range (global across all series) ──
    var minVal = Infinity, maxVal = -Infinity;
    for (var i = 0; i < data.length; i++) {
      var vals = data[i].values || [];
      for (var k = 0; k < sN; k++) {
        var v = vals[k];
        if (v == null || isNaN(v)) continue;
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
    if (minVal === Infinity) { minVal = 0; maxVal = 1; }

    var scaleMin = minVal;
    var scale;
    if (config.axisMax != null && config.axisMax > 0) {
      scale = { min: scaleMin, max: config.axisMax, ticks: null, step: null };
    } else {
      scale = R.niceScale(scaleMin, maxVal, rs.maxTicks);
    }

    // ── Left margin for the Y axis (when shown) ────────
    var marginLeft = 0;
    var yTickLabels = [];
    if (showYAxis) {
      var ticks = scale.ticks;
      if (!ticks) {
        var derived = R.niceScale(scale.min, scale.max, rs.maxTicks);
        ticks = derived.ticks;
      }
      var maxTickW = 0;
      for (var t = 0; t < ticks.length; t++) {
        var tlabel = R.formatNumber(ticks[t], config.numFmt);
        yTickLabels.push({ value: ticks[t], text: tlabel });
        var tw = tlabel.length * rs.labelSize * R.LABEL_ADVANCE;
        if (tw > maxTickW) maxTickW = tw;
      }
      marginLeft = Math.ceil(maxTickW) + 8;
    }

    // ── Right margin for end-of-line labels (when shown) ──
    var marginRight = rs.marginRight;
    var endLabelPad = 6;
    if (showEndLabels) {
      var widestName = 0;
      for (var en = 0; en < sN; en++) {
        var nm = String(seriesNames[en] || ("Series " + (en + 1)));
        var nw = nm.length * rs.labelSize * R.LABEL_ADVANCE;
        if (nw > widestName) widestName = nw;
      }
      marginRight = Math.max(rs.marginRight, Math.ceil(widestName) + endLabelPad + 2);
    }

    var plotWidth = svgW - marginLeft - marginRight;

    // Pre-wrap horizontal x-axis labels so marginBottom can grow.
    var labelStep = data.length > 1 ? plotWidth / (data.length - 1) : plotWidth;
    var labelWraps = [];
    var maxLabelLines = 1;
    if (!rotateLabels) {
      var wrapMaxW = Math.max(40, labelStep - 4);
      for (var pw = 0; pw < data.length; pw++) {
        var lw = R.wrapToFit(String(data[pw].label || ""),
          rs.labelSize, wrapMaxW, 3, R.LABEL_ADVANCE);
        labelWraps.push(lw);
        if (lw.lines.length > maxLabelLines) maxLabelLines = lw.lines.length;
      }
    }
    var marginBottom = R.measureXAxisLabelBudget(data, rs, rotateLabels, maxLabelLines, !!config.footer);
    // Reserve footer space inside a fixed total height, floor the plot so a
    // too-small request can't invert the y-scale, and grow the canvas when
    // content can't fit the request (overflow gets clipped by Illustrator).
    var footerProbe = R.renderFooter({
      x: 0, startY: 0, footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    var footerBlockH = footerProbe.height + (config.footer ? rs.footerGap : 0);
    var plotHeight = config.height
      ? Math.max(40, config.height - plotTop - marginBottom - footerBlockH)
      : rs.defaultPlotHeight;

    var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight + marginBottom, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });

    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height)
      : (footerStartY + footer.height);

    var yScale = R.linearScale(scale.min, scale.max, plotHeight, 0);

    var dotRadius = (config.lineDotSize != null ? config.lineDotSize : 4);
    if (dotRadius < 1) dotRadius = 1;

    var leftInset = dotRadius;
    var rightInset = dotRadius;
    var usablePlotW = plotWidth - leftInset - rightInset;
    var xStep = data.length > 1 ? usablePlotW / (data.length - 1) : usablePlotW / 2;

    var strokeW = rs.strokeWidth;

    function pointX(idx) {
      return data.length > 1 ? leftInset + idx * xStep : plotWidth / 2;
    }

    // Build per-series point arrays (one per series). A missing value
    // breaks the line (point omitted) rather than dropping to 0.
    var seriesPoints = [];
    for (var sp = 0; sp < sN; sp++) {
      var pts = [];
      for (var p = 0; p < data.length; p++) {
        var raw = (data[p].values || [])[sp];
        if (raw == null || isNaN(raw)) { pts.push(null); continue; }
        pts.push({ x: pointX(p), y: yScale(raw), value: raw, idx: p });
      }
      seriesPoints.push(pts);
    }

    // ── Build SVG ──────────────────────────────────────
    var svg = [];
    svg.push(R.svgOpen(svgW, svgH));
    svg.push(R.svgBg(svgW, svgH));

    for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);
    for (var lgi = 0; lgi < legend.svg.length; lgi++) svg.push(legend.svg[lgi]);

    svg.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    var baselineGap = 12;
    var baselineY = plotHeight + baselineGap;

    // ── Y axis gridlines + tick labels (optional) ──────
    if (showYAxis && yTickLabels.length) {
      for (var yt = 0; yt < yTickLabels.length; yt++) {
        var tv = yTickLabels[yt].value;
        if (tv < scale.min - 0.0001 || tv > scale.max + 0.0001) continue;
        var gy = yScale(tv);
        svg.push('    <line x1="0" y1="' + gy.toFixed(1) + '" x2="' + plotWidth.toFixed(1) +
          '" y2="' + gy.toFixed(1) + '" stroke="' + st.gridColor +
          '" stroke-width="' + rs.gridStrokeWidth + '"/>');
        svg.push('    <text x="-6" y="' + (gy + rs.labelSize * 0.35).toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" fill="' + st.labelColor + '" text-anchor="end">' +
          R.escapeXml(yTickLabels[yt].text) + '</text>');
      }
    }

    // Collected for post-passes
    var allSegments = [];   // every visible line segment, for label-vs-line tests
    var labelReqs = [];     // value-label requests, placed globally after lines
    var endLabels = [];     // end-of-line series labels

    // ── Draw each visible series (lines, area, dots) ───
    for (var si = 0; si < sN; si++) {
      var pts2 = seriesPoints[si];
      var lineColor = colors[si % colors.length];

      var dParts = [];
      var areaSegs = [];
      var started = false;
      var lastReal = null;
      for (var a = 0; a < pts2.length; a++) {
        var pt = pts2[a];
        if (!pt) { started = false; continue; }
        lastReal = pt;
        dParts.push((started ? "L" : "M") + pt.x.toFixed(1) + "," + pt.y.toFixed(1));
        areaSegs.push(pt);
        // Record segment for the label-placement pass
        if (started && areaSegs.length >= 2) {
          allSegments.push({ p1: areaSegs[areaSegs.length - 2], p2: pt });
        }
        started = true;
      }

      if (shade && areaSegs.length > 1) {
        var areaPath = "M" + areaSegs[0].x.toFixed(1) + "," + plotHeight;
        for (var af = 0; af < areaSegs.length; af++) {
          areaPath += " L" + areaSegs[af].x.toFixed(1) + "," + areaSegs[af].y.toFixed(1);
        }
        areaPath += " L" + areaSegs[areaSegs.length - 1].x.toFixed(1) + "," + plotHeight + " Z";
        svg.push('    <path d="' + areaPath + '" fill="' + lineColor + '" fill-opacity="0.1"/>');
      }

      if (dParts.length) {
        svg.push('    <path d="' + dParts.join(" ") + '" fill="none" stroke="' + lineColor +
          '" stroke-width="' + strokeW + '" stroke-linejoin="round" stroke-linecap="round"/>');
      }

      if (showDots) {
        for (var dd = 0; dd < pts2.length; dd++) {
          if (!pts2[dd]) continue;
          svg.push('    <circle cx="' + pts2[dd].x.toFixed(1) + '" cy="' + pts2[dd].y.toFixed(1) +
            '" r="' + dotRadius + '" fill="#ffffff" stroke="' + lineColor +
            '" stroke-width="' + (strokeW * 0.8).toFixed(1) + '"/>');
        }
      }

      // Collect value-label requests (placed globally after all lines)
      if (showValueLabels) {
        for (var d = 0; d < pts2.length; d++) {
          var P = pts2[d];
          if (!P) continue;
          if (config.hideZeroLabels && P.value === 0) continue;
          // Per-value-label hide: key is "dataRow:series".
          if (hiddenLabels[d + ":" + si]) continue;
          var valText = R.formatNumber(P.value, config.numFmt);
          var estW = valText.length * rs.valueSize * 0.6;
          labelReqs.push({
            px: P.x, py: P.y, text: valText, estW: estW, halfW: estW / 2,
            color: (multi ? lineColor : st.valueColor)
          });
        }
      }

      if (showEndLabels && lastReal) {
        endLabels.push({
          y: lastReal.y,
          x: lastReal.x + dotRadius + endLabelPad,
          text: String(seriesNames[si] || ("Series " + (si + 1))),
          color: lineColor
        });
      }
    }

    // ── Global value-label placement (dodges all lines + labels) ──
    if (labelReqs.length) {
      svg.push.apply(svg, placeValueLabels(labelReqs, allSegments, {
        plotHeight: plotHeight, plotWidth: plotWidth,
        labelH: rs.valueSize, valueSize: rs.valueSize,
        fontValue: fonts.value, showDots: showDots, dotRadius: dotRadius,
        labelBg: labelBg, labelPos: labelPos, styleValueColor: st.valueColor
      }));
    }

    // ── End-of-line labels with simple anti-overlap ────
    if (endLabels.length) {
      endLabels.sort(function (a, b) { return a.y - b.y; });
      var minGap = Math.round(rs.labelSize * 1.15);
      for (var el = 1; el < endLabels.length; el++) {
        if (endLabels[el].y - endLabels[el - 1].y < minGap) {
          endLabels[el].y = endLabels[el - 1].y + minGap;
        }
      }
      for (var el2 = endLabels.length - 1; el2 >= 0; el2--) {
        if (endLabels[el2].y > plotHeight) endLabels[el2].y = plotHeight;
      }
      for (var el3 = 0; el3 < endLabels.length; el3++) {
        var EL = endLabels[el3];
        svg.push('    <text x="' + EL.x.toFixed(1) + '" y="' + (EL.y + rs.labelSize * 0.35).toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" font-weight="600" fill="' + EL.color + '" text-anchor="start">' +
          R.escapeXml(EL.text) + '</text>');
      }
    }

    // ── X-axis labels (shared) ─────────────────────────
    var lineH = Math.round(rs.labelSize * 1.2);
    for (var kx = 0; kx < data.length; kx++) {
      var lx = pointX(kx);
      var ly = baselineY + rs.labelSize + 4;
      var anchor = "middle";
      if (data.length > 2) {
        if (kx === 0) anchor = "start";
        else if (kx === data.length - 1) anchor = "end";
      }
      if (rotateLabels) {
        var rotMaxChars = rs.maxLabelChars * 2;
        var rotText = String(data[kx].label || "");
        var rotTruncated = rotText.length > rotMaxChars;
        if (rotTruncated) rotText = rotText.substring(0, rotMaxChars - 1) + "…";
        var rotColor = rotTruncated ? R.FADED_LABEL_COLOR : st.labelColor;
        if (rotTruncated) {
          R.pushWarning("label-truncated", { count: 1,
            suggestion: "Try a wider chart or shorter category labels" });
        }
        svg.push('    <text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" fill="' + rotColor + '" text-anchor="end" transform="rotate(-45,' + lx.toFixed(1) + ',' + ly.toFixed(1) + ')">' +
          R.escapeXml(rotText) + '</text>');
      } else {
        var wrap = labelWraps[kx];
        if (!wrap.fits) {
          R.pushWarning("label-truncated", { count: 1,
            suggestion: "Try a wider chart or shorter category labels" });
        }
        var wrapColor = wrap.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
        var wrapLines = wrap.lines.length ? wrap.lines : [""];
        for (var ln = 0; ln < wrapLines.length; ln++) {
          svg.push('    <text x="' + lx.toFixed(1) + '" y="' + (ly + ln * lineH).toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
            '" fill="' + wrapColor + '" text-anchor="' + anchor + '">' +
            R.escapeXml(wrapLines[ln]) + '</text>');
        }
      }
    }

    // Baseline (X axis)
    svg.push('    <line x1="0" y1="' + baselineY.toFixed(1) + '" x2="' + plotWidth +
      '" y2="' + baselineY.toFixed(1) + '" stroke="' + st.baselineColor + '" stroke-width="' + rs.gridStrokeWidth + '"/>');

    svg.push('  </g>');

    for (var fi = 0; fi < footer.svg.length; fi++) svg.push(footer.svg[fi]);

    svg.push('</svg>');
    return svg.join("\n");
  }

  // ── Value-label placement pass ───────────────────────
  // Places each value label so it dodges EVERY visible line segment and
  // every already-placed label, choosing the position closest to its
  // point. When a label has to move beyond its first slot to clear an
  // overlap, a thin leader line connects it back to the point so the
  // reader can still tell which point it belongs to.
  //
  // Returns an array of SVG strings (leaders first, then bg + text).
  function placeValueLabels(reqs, segments, opt) {
    var out = [];
    var labelH = opt.labelH;
    var safety = 3;
    var placed = [];                 // {x0,x1,y0,y1}
    var gapBase = (opt.showDots ? opt.dotRadius : 0) + (opt.labelBg !== "none" ? 7 : 4);
    // Fine steps so a label rises only as far as it needs to clear the
    // line, instead of jumping a whole label-height and floating.
    var step = Math.max(3, Math.round(labelH * 0.35));
    var maxSteps = 14;
    // Digits sit on the baseline and reach ~cap height up — they don't
    // fill the full line-height box. Use the real glyph extent for the
    // line-overlap test so the label can hug the line without the empty
    // space above the digits counting as a collision.
    var glyphH = labelH * 0.72;

    // Penalty of a candidate box [boxTop, boxBot] at center cx against
    // all line segments whose x-range overlaps the label.
    function lineOverlap(cx, halfW, boxTop, boxBot) {
      var pen = 0;
      for (var s = 0; s < segments.length; s++) {
        pen += segPenalty(segments[s].p1, segments[s].p2, cx, halfW, boxTop, boxBot);
      }
      return pen;
    }
    function labelOverlap(box) {
      var pen = 0;
      for (var i = 0; i < placed.length; i++) {
        var b = placed[i];
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) {
          var ow = Math.min(box.x1, b.x1) - Math.max(box.x0, b.x0);
          var oh = Math.min(box.y1, b.y1) - Math.max(box.y0, b.y0);
          pen += 60 + Math.max(0, ow) * 0.2 + Math.max(0, oh);
        }
      }
      return pen;
    }

    // Process left-to-right, top-to-bottom so neighbours settle in a
    // stable reading order (no RNG — must stay deterministic).
    reqs.sort(function (a, b) { return (a.px - b.px) || (a.py - b.py); });

    for (var r = 0; r < reqs.length; r++) {
      var req = reqs[r];
      var halfW = req.halfW;
      var cx = req.px;
      if (cx - halfW < 0) cx = halfW;
      if (cx + halfW > opt.plotWidth) cx = opt.plotWidth - halfW;

      // Candidate baselines: preferred above/below first, then expanding
      // in fine increments so the label settles just clear of the line.
      var cands = [];
      var forceAbove = (opt.labelPos === "above");
      var forceBelow = (opt.labelPos === "below");
      for (var k = 0; k <= maxSteps; k++) {
        if (!forceBelow) cands.push(req.py - gapBase - k * step);                 // above
        if (!forceAbove) cands.push(req.py + gapBase + labelH + k * step);         // below
      }

      var best = null;
      for (var c = 0; c < cands.length; c++) {
        var baseY = cands[c];
        var boxTop = baseY - labelH;          // full line-height box (for label-vs-label + placed)
        var boxBot = baseY;
        var glyphTop = baseY - glyphH;        // actual glyph extent (for line overlap)
        var pen = 0;
        if (boxTop < 0 || boxBot > opt.plotHeight - safety) pen += 1000;
        pen += lineOverlap(cx, halfW, glyphTop, boxBot);
        pen += labelOverlap({ x0: cx - halfW, x1: cx + halfW, y0: boxTop, y1: boxBot });
        // Prefer staying close to the point, with a slight bias upward.
        pen += Math.abs(baseY - (req.py - gapBase)) * 0.12;
        if (best === null || pen < best.pen) best = { baseY: baseY, boxTop: boxTop, boxBot: boxBot, pen: pen, cx: cx };
        if (pen === 0) break; // perfect slot — stop early
      }

      placed.push({ x0: best.cx - halfW, x1: best.cx + halfW, y0: best.boxTop, y1: best.boxBot });

      // Leader line ONLY when the label ends up genuinely far from its
      // point — i.e. it had to escape a crowded area, so the connection
      // isn't obvious. A label resting just above/below its point (the
      // normal case, even after a one-step nudge to dodge a near-miss)
      // reads as belonging to it, so it gets NO leader. We measure the
      // real pixel gap between the point and the label's nearest edge,
      // not merely "is this the first slot" — a one-step nudge on a
      // steep line shouldn't sprout a connector.
      var above = best.baseY <= req.py;
      var startOff = opt.showDots ? opt.dotRadius : 0;
      var nearEdge = above ? best.boxBot : best.boxTop; // label edge closest to the point
      var distFromPoint = Math.abs(nearEdge - req.py);
      // Only labels pushed well clear of their point (≈2 label-heights,
      // the kind of travel a real label-on-label collision causes) get a
      // connector. A label hugging a steep line a few pixels up does not.
      var LEADER_MIN = gapBase + labelH * 2;
      if (distFromPoint > LEADER_MIN) {
        var startY = req.py + (above ? -startOff : startOff);
        var endY = nearEdge;
        // Dashed so it reads as a connector, never mistaken for a data line.
        out.push('    <line x1="' + req.px.toFixed(1) + '" y1="' + startY.toFixed(1) +
          '" x2="' + best.cx.toFixed(1) + '" y2="' + endY.toFixed(1) +
          '" stroke="' + req.color + '" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.55"/>');
      }

      // Optional background plate
      var valColor;
      if (opt.labelBg === "black") valColor = "#ffffff";
      else if (opt.labelBg === "white") valColor = "#333333";
      else valColor = req.color;

      if (opt.labelBg !== "none") {
        var bgPadX = 3, bgPadY = 2;
        out.push('    <rect x="' + (best.cx - halfW - bgPadX).toFixed(1) + '" y="' + (best.boxTop - bgPadY).toFixed(1) +
          '" width="' + (req.estW + bgPadX * 2).toFixed(1) + '" height="' + (labelH + bgPadY * 2).toFixed(1) +
          '" fill="' + (opt.labelBg === "black" ? "#000000" : "#ffffff") +
          '" rx="2" opacity="0.85"/>');
      }

      out.push('    <text x="' + best.cx.toFixed(1) + '" y="' + best.baseY.toFixed(1) +
        '" font-family="' + opt.fontValue + '" font-size="' + opt.valueSize +
        '" fill="' + valColor + '" text-anchor="middle">' + R.escapeXml(req.text) + '</text>');
    }
    return out;
  }

  // How deep a line may cut into a value-label's box before we treat it
  // as a real collision and move the label. A steep line grazing the
  // corner of the (generously estimated) box isn't a visual problem and
  // shouldn't push the label off the line — keeping labels close to the
  // data is more important than a pixel-perfect gap.
  var OVERLAP_TOLERANCE = 1.5;

  // Overlap penalty between a label box and one line segment.
  function segPenalty(p1, p2, cx, halfW, boxTop, boxBot) {
    if (!p1 || !p2) return 0;
    var dx = p2.x - p1.x;
    if (Math.abs(dx) < 0.1) return 0;
    var left = Math.max(cx - halfW, Math.min(p1.x, p2.x));
    var right = Math.min(cx + halfW, Math.max(p1.x, p2.x));
    if (left >= right) return 0;
    var yL = p1.y + (p2.y - p1.y) * (left - p1.x) / dx;
    var yR = p1.y + (p2.y - p1.y) * (right - p1.x) / dx;
    var lineTop = Math.min(yL, yR);
    var lineBot = Math.max(yL, yR);
    var oTop = Math.max(lineTop, boxTop);
    var oBot = Math.min(lineBot, boxBot);
    var overlap = oBot - oTop;
    // Only a real cut-through (deeper than the grazing tolerance) counts.
    // Grazes and near-misses return 0 so the label can rest at its
    // closest slot, snug to the line.
    if (overlap > OVERLAP_TOLERANCE) return 10 + (overlap - OVERLAP_TOLERANCE);
    return 0;
  }

  R.register("line", "Line Chart", render);
})();
