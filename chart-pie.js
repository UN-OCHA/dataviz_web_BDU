/**
 * Pie Chart Renderer
 *
 * Each slice's angle encodes a share of the total. Labels can be
 * rendered inside the slice, outside with leader lines, or
 * auto-placed (inside when the slice is wide enough, otherwise out).
 * Leader lines and label content (label / value / pct) are all
 * configurable from the Design tab.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;
  var PIE_DEFAULT = "#009EDB";

  // Test whether a point sits inside a pie/donut slice's wedge:
  // distance from chart centre is within [innerR, outerR] AND the
  // SVG-angle (CW from 12 o'clock) is between startAngle and endAngle.
  // Used to verify a label's bounding-box corners stay inside the
  // slice — pie-circle horizontal alone misses the slanted radial
  // sides of small slices.
  function pointInSlice(px, py, cx, cy, outerR, innerR, startAngle, endAngle) {
    var dx = px - cx;
    var dy = py - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > outerR) return false;
    if (innerR > 0 && dist < innerR) return false;
    // SVG angle: 0° = 12 o'clock, increasing CW. atan2(dx, -dy) maps
    // 12 → 0, 3 → π/2, 6 → π, 9 → -π/2 (then we mod 360).
    var angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    return angle >= startAngle && angle <= endAngle;
  }

  function render(title, data, config) {
    if (!data.length) return null;

    data = R.mergeSlices(data);
    // Sort largest-first when auto-sort is on; preserve table order otherwise
    if (config.autoSort !== false) {
      data.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
    }

    var pieColor = (config.colors && config.colors[0]) || PIE_DEFAULT;
    // Legend and direct labels are mutually exclusive — see donut.
    var labelMode = config.pieLegend ? "none" : (config.pieLabelMode || "auto");
    var labelContent = config.pieLabelContent || "label-pct";
    var showLeaders = config.pieLeaderLines !== false;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    var header = R.renderHeader({
      x: 0, startY: 6,
      title: title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);

    // Optional legend strip (default off — pie prefers direct
    // labelling). When on, one chip per slice using the same
    // per-slice colour resolution the slices themselves use.
    var pieSliceOverrides = (config.sliceColors && typeof config.sliceColors === "object")
      ? config.sliceColors : {};
    var pieLegend = { svg: [], height: 0 };
    if (config.pieLegend) {
      var pieLegendNames = [];
      var pieLegendColors = [];
      for (var pli = 0; pli < data.length; pli++) {
        pieLegendNames.push(String(data[pli].label || ""));
        pieLegendColors.push(pieSliceOverrides[data[pli].label] || pieColor);
      }
      pieLegend = R.renderStackedLegend({
        x: 0, startY: plotTop,
        names: pieLegendNames,
        colors: pieLegendColors,
        rs: rs, style: st,
        maxWidth: svgW,
        hasSubtitle: !!config.subtitle
      });
      plotTop += pieLegend.height;
    }
    var labelMargin = (labelMode === "inside" || labelMode === "none") ? Math.min(svgW * 0.08, 30) : Math.min(svgW * 0.22, 90);
    var chartArea = svgW - labelMargin * 2;
    // Diameter is capped by the breakpoint's default plot height — the
    // same vertical budget bar/line charts use — so a pie sits at the
    // same visual scale as the other chart types at any breakpoint.
    // Labels (font size, leader distance, etc.) are unaffected — only
    // the slice shrinks. The hard 80 px floor keeps pies legible at xs.
    var maxDiameter = Math.max(80, rs.defaultPlotHeight);
    var radius = Math.min(chartArea, maxDiameter) / 2 - 10;
    // Flush-left composition: tentative cx pulled toward the left.
    // The left-extent guard below refines it so the leftmost visible
    // label or the pie's left edge sits at x=0.
    var cx = labelMargin + radius + 10;
    var cy = plotTop + radius + 10;

    var total = 0;
    for (var i = 0; i < data.length; i++) total += Math.abs(data[i].value);
    if (total === 0) total = 1;

    var labelSize = Math.max(7, rs.labelSize - 1);
    // User-configurable gap between the chart and the inner edge of
    // each outside label. Side-based alignment: left-aligned on the
    // right of the chart, right-aligned on the left — so the inner
    // edge sits at the same radius on both sides.
    var labelDist = (config.pieLabelDistance != null ? config.pieLabelDistance : 24);
    if (labelDist < 8) labelDist = 8;
    var labelInnerRadius = radius + labelDist;
    var leaderR = radius + Math.max(6, Math.round(labelDist * 0.4));

    var svg = [];
    // Start at 0° — polarToCartesian already subtracts 90° internally,
    // so 0° maps to 12 o'clock (top center).
    var startAngle = 0;
    var sliceMids = [];

    for (var j = 0; j < data.length; j++) {
      var absVal = Math.abs(data[j].value);
      var sliceAngle = (absVal / total) * 360;
      var endAngle = startAngle + sliceAngle;
      var midAngle = startAngle + sliceAngle / 2;
      var pct = Math.round((absVal / total) * 100);
      sliceMids.push({
        midAngle: midAngle, pct: pct, label: data[j].label, absVal: absVal,
        sliceAngle: sliceAngle, startAngle: startAngle, endAngle: endAngle
      });
      startAngle = endAngle;
    }

    // Determine which labels go inside vs outside
    var outsideItems = [];
    var insideItems = [];
    var pushedOutsideCount = 0;

    if (labelMode !== "none") {
      var insideMidR = radius * 0.65;
      for (var k = 0; k < sliceMids.length; k++) {
        var sm = sliceMids[k];
        if (sm.pct < 1) continue;

        var placeInside = false;
        if (labelMode === "inside") {
          placeInside = true;
        } else if (labelMode === "auto") {
          // Inside if slice angle > 25 degrees. Lower threshold than
          // before (was 40) so more medium slices keep their labels
          // inside; the per-slice geometric fit-check below catches
          // cases where the label still wouldn't fit.
          placeInside = sm.sliceAngle > 25;
        }
        // labelMode === "outside" → placeInside stays false

        // Verify the label actually fits inside the slice. The label
        // is rendered HORIZONTALLY at the slice's midRadius point, so
        // we need to check whether every corner of the wrapped block's
        // bounding box sits inside the slice's wedge — not just inside
        // the pie circle. Slices on the side of the pie have plenty
        // of pie-circle horizontal room but their slanted radial
        // boundaries cut into the label's box; a horizontal-chord
        // check alone passes labels that visually break out of their
        // wedge (the "UN pooled funds" 14% slice did exactly this).
        //
        // Approach: wrap against a generous initial width (the pie's
        // horizontal chord), then test all 4 corners of the wrapped
        // block. If any corner is outside the slice → push outside.
        if (placeInside) {
          var sliceText = R.buildPieLabelText(sm.label, sm.pct, sm.absVal, labelContent, rs, config.numFmt);
          var midAngleRad = (sm.midAngle - 90) * Math.PI / 180;
          var dxAtMid = insideMidR * Math.cos(midAngleRad);
          var dyAtMid = insideMidR * Math.sin(midAngleRad);
          var horizAtY = Math.sqrt(Math.max(0, radius * radius - dyAtMid * dyAtMid));
          var horizFit = 2 * Math.max(0, horizAtY - Math.abs(dxAtMid));
          var insideMaxW = Math.max(20, horizFit - 8);
          // 2 lines is the OCHA-preferred default for inside labels.
          var insideWrap = R.wrapToFit(sliceText, labelSize, insideMaxW, 2, R.LABEL_ADVANCE);
          var widestLine = 0;
          for (var wl = 0; wl < insideWrap.lines.length; wl++) {
            var w = insideWrap.lines[wl].length * labelSize * R.LABEL_ADVANCE;
            if (w > widestLine) widestLine = w;
          }

          // Compute the wrapped block's bounding box centred on inPt.
          var insideLineH = Math.round(labelSize * 1.15);
          var blockH = (insideWrap.lines.length - 1) * insideLineH + labelSize * 1.25;
          var inPtX = (cx + dxAtMid);
          var inPtY = (cy + dyAtMid);
          var blockL = inPtX - widestLine / 2;
          var blockR = inPtX + widestLine / 2;
          var blockT = inPtY - blockH / 2;
          var blockB = inPtY + blockH / 2;

          var allCornersInSlice = insideWrap.fits && widestLine <= insideMaxW + 2 &&
            pointInSlice(blockL, blockT, cx, cy, radius, 0, sm.startAngle, sm.endAngle) &&
            pointInSlice(blockR, blockT, cx, cy, radius, 0, sm.startAngle, sm.endAngle) &&
            pointInSlice(blockL, blockB, cx, cy, radius, 0, sm.startAngle, sm.endAngle) &&
            pointInSlice(blockR, blockB, cx, cy, radius, 0, sm.startAngle, sm.endAngle);

          if (allCornersInSlice) {
            sm._insideLines = insideWrap.lines;
            insideItems.push(sm);
          } else {
            // Doesn't fit — push outside instead.
            pushedOutsideCount++;
            placeInside = false;
          }
        }

        if (!placeInside) {
          var leaderPt = R.polarToCartesian(cx, cy, leaderR, sm.midAngle);
          var isRight = (sm.midAngle >= 0 && sm.midAngle < 180);
          outsideItems.push({
            midAngle: sm.midAngle, pct: sm.pct, label: sm.label, absVal: sm.absVal,
            y: leaderPt.y, origY: leaderPt.y,
            leaderPtX: leaderPt.x, leaderPtY: leaderPt.y,
            isRight: isRight
          });
        }
      }
    }

    if (pushedOutsideCount > 0) {
      R.pushWarning("inside-pushed-out", {
        count: pushedOutsideCount,
        suggestion: "Some slices were too narrow for inside labels"
      });
    }

    // Pre-wrap each outside label so we know its final height before
    // resolving overlaps. Side labels' inner edge is at labelInnerRadius
    // by anchor. Top/bottom labels get pushed outward by halfH so
    // their inner edge matches that same radius.
    var lineGap = labelSize * 1.15;
    var maxLines = 1;
    for (var oli = 0; oli < outsideItems.length; oli++) {
      var oi = outsideItems[oli];
      var ma0 = oi.midAngle;
      var isMiddle0 = (ma0 < 15) || (ma0 > 345) || (ma0 > 165 && ma0 < 195);
      var labelPt = R.polarToCartesian(cx, cy, labelInnerRadius, oi.midAngle);
      oi.textX = labelPt.x;
      oi.y = labelPt.y;
      oi.origY = labelPt.y;
      var availW;
      if (isMiddle0) {
        availW = 2 * Math.min(oi.textX - 4, svgW - oi.textX - 4);
      } else {
        availW = oi.isRight ? (svgW - oi.textX - 4) : (oi.textX - 4);
      }
      if (availW < 40) availW = 40;
      oi.lines = R.buildPieLabelLines(oi.label, oi.pct, oi.absVal, labelContent, labelSize, availW, 2, config.numFmt);
      if (oi.lines.length > maxLines) maxLines = oi.lines.length;

      if (isMiddle0) {
        var halfH = ((oi.lines.length - 1) * lineGap + labelSize) / 2;
        if (oi.y < cy) {
          oi.y -= halfH;
        } else {
          oi.y += halfH;
        }
        oi.origY = oi.y;
      }
    }

    // Overlap gap = tallest label block + small padding.
    var overlapGap = Math.max(labelSize + 4, maxLines * lineGap + 4);
    R.resolveOverlaps(outsideItems, overlapGap);

    // Left-extent guard. Flush-left: pin the leftmost visible pixel
    // (pie left edge or leftmost label tip) to x=0. Mirrors the donut
    // implementation — see chart-donut.js for the full rationale.
    var minLabelX = cx - radius;
    for (var lxi = 0; lxi < outsideItems.length; lxi++) {
      var lxItem = outsideItems[lxi];
      var lxLines = lxItem.lines || [];
      var widestLineW = 0;
      for (var lxl = 0; lxl < lxLines.length; lxl++) {
        var lxw = lxLines[lxl].length * labelSize * R.LABEL_ADVANCE;
        if (lxw > widestLineW) widestLineW = lxw;
      }
      var lxMa = lxItem.midAngle;
      var lxIsMiddle = (lxMa < 15) || (lxMa > 345) || (lxMa > 165 && lxMa < 195);
      var lxLeft;
      if (lxIsMiddle) {
        lxLeft = lxItem.textX - widestLineW / 2;
      } else if (lxItem.isRight) {
        lxLeft = lxItem.textX;
      } else {
        lxLeft = lxItem.textX - widestLineW;
      }
      if (lxLeft < minLabelX) minLabelX = lxLeft;
    }
    var leftShift = -minLabelX;
    if (cx + leftShift < radius) leftShift = radius - cx;
    if (leftShift !== 0) {
      cx += leftShift;
      for (var lsh = 0; lsh < outsideItems.length; lsh++) {
        outsideItems[lsh].textX += leftShift;
        outsideItems[lsh].leaderPtX += leftShift;
      }
    }

    // Top-extent guard. Outside labels — especially those near 12
    // o'clock that are middle-anchored and pushed up by halfH — can
    // extend ABOVE the pie and overlap the header. Measure the topmost
    // label's cap-top explicitly and shift the entire chart down by the
    // deficit if it would cross above the plot.
    //
    // resolveOverlaps only ever moves labels DOWN, so the topmost
    // label's y is fixed once pre-wrap completes — safe to measure
    // here and shift everything by the deficit.
    var minCapTop = cy - radius; // chart's own top edge as the floor
    for (var ti = 0; ti < outsideItems.length; ti++) {
      var tItem = outsideItems[ti];
      var tLines = tItem.lines || [];
      var tTotalH = (tLines.length - 1) * lineGap;
      // First line baseline = item.y + 0.35 × labelSize - totalH/2
      // Cap top of that first line = baseline - 0.8 × labelSize
      var capTop = tItem.y + labelSize * 0.35 - tTotalH / 2 - labelSize * 0.8;
      if (capTop < minCapTop) minCapTop = capTop;
    }
    var topShift = plotTop - minCapTop;
    if (topShift > 0) {
      cy += topShift;
      for (var sh = 0; sh < outsideItems.length; sh++) {
        outsideItems[sh].y += topShift;
        outsideItems[sh].origY += topShift;
        outsideItems[sh].leaderPtY += topShift;
      }
    }

    // Calculate max label extent
    var maxLabelY = cy + radius + 20;
    for (var li = 0; li < outsideItems.length; li++) {
      var nL = outsideItems[li].lines ? outsideItems[li].lines.length : 1;
      var bot = outsideItems[li].y + (nL - 1) * lineGap + labelSize;
      if (bot > maxLabelY) maxLabelY = bot;
    }

    // Pie's "plot bottom" is maxLabelY (outside labels can extend below
    // the pie itself). computeFooterStart adds rs.footerGap when the
    // footer has content, otherwise no gap.
    var footerStartY = R.computeFooterStart(rs, maxLabelY, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });

    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height + rs.marginBottom)  // request, but never clip content
      : (footerStartY + footer.height + rs.marginBottom);

    svg.push(R.svgOpen(svgW, svgH));
    svg.push(R.svgBg(svgW, svgH));
    for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);
    // Optional legend, between header and ring.
    for (var plsi = 0; plsi < pieLegend.svg.length; plsi++) svg.push(pieLegend.svg[plsi]);

    // Draw slices. Per-slice colour override (sliceColors keyed by
    // label) wins over the chart's primary colour; default keeps the
    // existing all-same-colour OCHA pie style.
    function pieColorForSlice(label) {
      return pieSliceOverrides[label] || pieColor;
    }
    for (var s = 0; s < sliceMids.length; s++) {
      var sl = sliceMids[s];
      var slFill = pieColorForSlice(sl.label);
      if (data.length === 1 || sl.sliceAngle >= 359.99) {
        svg.push('  <circle cx="' + cx + '" cy="' + cy + '" r="' + radius +
          '" fill="' + slFill + '" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>');
      } else {
        var sStart = R.polarToCartesian(cx, cy, radius, sl.endAngle);
        var sEnd = R.polarToCartesian(cx, cy, radius, sl.startAngle);
        var largeArc = sl.sliceAngle > 180 ? 1 : 0;
        var d = [
          "M", cx, cy,
          "L", sStart.x.toFixed(2), sStart.y.toFixed(2),
          "A", radius, radius, 0, largeArc, 0, sEnd.x.toFixed(2), sEnd.y.toFixed(2),
          "Z"
        ].join(" ");
        svg.push('  <path d="' + d + '" fill="' + slFill + '" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>');
      }
    }

    // Inside labels — multi-line wrapped, LEFT-aligned within their
    // text block. The block is positioned so it's centred on the
    // slice's midRadius point geometrically, but each line starts at
    // the same x (a typical paragraph look) instead of being
    // independently centred per-line.
    var insideLineH = Math.round(labelSize * 1.15);
    for (var ins = 0; ins < insideItems.length; ins++) {
      var inItem = insideItems[ins];
      var inPt = R.polarToCartesian(cx, cy, radius * 0.65, inItem.midAngle);
      var insideLines = inItem._insideLines && inItem._insideLines.length
        ? inItem._insideLines
        : [R.buildPieLabelText(inItem.label, inItem.pct, inItem.absVal, labelContent, rs, config.numFmt)];
      // Find the longest line so the block can sit centred on inPt
      // while every line shares the same starting x (left-aligned).
      var maxLineW = 0;
      for (var mlw = 0; mlw < insideLines.length; mlw++) {
        var lw = insideLines[mlw].length * labelSize * R.LABEL_ADVANCE;
        if (lw > maxLineW) maxLineW = lw;
      }
      var blockX = inPt.x - maxLineW / 2;
      var insideBlockH = (insideLines.length - 1) * insideLineH;
      var insideFirstY = inPt.y - insideBlockH / 2 + labelSize * 0.35;
      for (var iln = 0; iln < insideLines.length; iln++) {
        svg.push('  <text x="' + blockX.toFixed(1) + '" y="' + (insideFirstY + iln * insideLineH).toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + labelSize +
          '" fill="#ffffff" text-anchor="start" font-weight="bold">' +
          R.escapeXml(insideLines[iln]) + '</text>');
      }
    }

    // Outside labels (multi-line capable).
    // Labels arrange RADIALLY around the chart at labelInnerRadius.
    // Anchor depends on slice position:
    //   Near 12 o'clock or 6 o'clock → middle
    //   Right half → start (text flows right)
    //   Left half  → end   (text flows left)
    for (var m = 0; m < outsideItems.length; m++) {
      var item = outsideItems[m];
      var lines = item.lines || R.buildPieLabelLines(item.label, item.pct, item.absVal, labelContent, labelSize, svgW * 0.2, 2, config.numFmt);

      var textX = item.textX != null ? item.textX : cx + (item.isRight ? labelInnerRadius : -labelInnerRadius);
      var ma = item.midAngle;
      var near12 = (ma < 15) || (ma > 345);
      var near6  = (ma > 165 && ma < 195);
      var anchor = (near12 || near6) ? "middle" : (item.isRight ? "start" : "end");

      if (showLeaders) {
        var edgePt = R.polarToCartesian(cx, cy, radius + 2, item.midAngle);
        // Padded bounding box around the label so the leader line
        // stops BEFORE the text block instead of piercing it.
        var padX = 4, padY = 3;
        var blockHalfH = ((lines.length - 1) * lineGap + labelSize) / 2 + padY;
        var endX, endY;
        if (anchor === "middle") {
          endX = textX;
          endY = (item.origY < cy) ? (item.y + blockHalfH) : (item.y - blockHalfH);
        } else {
          endX = item.isRight ? (textX - padX) : (textX + padX);
          endY = item.y;
        }
        svg.push('  <line x1="' + edgePt.x.toFixed(1) + '" y1="' + edgePt.y.toFixed(1) +
          '" x2="' + endX.toFixed(1) + '" y2="' + endY.toFixed(1) +
          '" stroke="#999999" stroke-width="1" opacity="0.5"/>');
      }

      var totalH = (lines.length - 1) * lineGap;
      var firstY = item.y + labelSize * 0.35 - totalH / 2;

      svg.push('  <text font-family="' + fonts.label + '" font-size="' + labelSize +
        '" fill="' + st.labelColor + '" text-anchor="' + anchor + '">');
      for (var ln = 0; ln < lines.length; ln++) {
        var lineY = firstY + ln * lineGap;
        svg.push('    <tspan x="' + textX.toFixed(1) + '" y="' + lineY.toFixed(1) + '">' +
          R.escapeXml(lines[ln]) + '</tspan>');
      }
      svg.push('  </text>');
    }

    for (var fi = 0; fi < footer.svg.length; fi++) svg.push(footer.svg[fi]);
    svg.push('</svg>');
    return svg.join("\n");
  }

  R.register("pie", "Pie Chart", render);
})();
