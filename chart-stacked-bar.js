/**
 * Stacked Horizontal Bar Chart Renderer
 *
 * Data shape: [{label, values: [v1, v2, ...]}]
 *
 * Each row → one bar split into N segments (one per series). Category
 * labels wrap to up to 3 lines and are right-aligned at the right
 * edge of a label column whose width auto-fits the longest wrapped
 * line, so that line's LEFT edge sits flush at x ≈ 0.
 *
 * Inside-segment values are drawn when they fit. Consecutive segments
 * that don't fit are merged into a single callout above the bar with
 * a colour-dot per value, joined by a short bracket leader. The row
 * total prints at the end of the bar.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    var barThickness = config.barThickness || rs.barThickness;
    // User-configurable bar spacing (vertical gap between stacked rows).
    // The render still grows this further when multi-line labels would
    // overhang, so the user value is a floor on the gap.
    var barGap = (config.barSpacing && config.barSpacing > 0) ? config.barSpacing : rs.barGap;

    // Report resolved thickness/spacing for the Auto pills. Stacked rows keep
    // a constant thickness; barGap is the base inter-row gap (the render may
    // grow it further for multi-line labels, but this is the chosen floor).
    R.reportResolved("barThickness", barThickness);
    R.reportResolved("barSpacing", barGap);

    // Flush-left composition: no left margin.
    var marginLeft = 0;
    var marginRight = rs.marginRight;

    // Icon column (flags/icons between label and bar)
    var hasIcons = config.iconColType && config.iconColType !== "none";
    var isFlags = config.iconColType === "flags";
    var iconNorm = hasIcons ? (isFlags ? 1.5 : 1.0) : false;
    var iconH = isFlags
      ? Math.round(rs.labelSize * 1.1)
      : Math.round(rs.labelSize * 1.3);
    var iconGap = 6;
    var iconMaxW = hasIcons ? R.maxIconWidth(data, iconH, iconNorm) : 0;

    // Number of series
    var seriesCount = 0;
    for (var sc = 0; sc < data.length; sc++) {
      if (data[sc].values && data[sc].values.length > seriesCount) {
        seriesCount = data[sc].values.length;
      }
    }
    if (seriesCount === 0) return null;

    // Header
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);

    // Optional legend above the plot
    var legend = { svg: [], height: 0 };
    if (config.stackedLegend && config.seriesNames && config.seriesNames.length) {
      legend = R.renderStackedLegend({
        x: 0, startY: plotTop,
        names: config.seriesNames,
        colors: config.colors,
        rs: rs, style: st,
        maxWidth: svgW,
        hasSubtitle: !!config.subtitle
      });
      plotTop += legend.height;
    }

    var plotWidth = svgW - marginLeft - marginRight;

    // ─── Category labels: wrap to up to 2 lines ────────────
    // Labels are right-aligned within a column; the column's width is
    // the max rendered line width across all labels.
    var LABEL_LINE_H = Math.round(rs.labelSize * 1.2);
    // Cap label column at ~28% of plotWidth to leave room for bars.
    var labelTargetW = Math.min(plotWidth * 0.28, 170);
    var wrappedLabels = [];
    var maxLineW = 0;
    var maxLines = 1;
    var truncCount = 0;
    for (var i = 0; i < data.length; i++) {
      // Wrap each category label into up to 3 lines. Truncated labels
      // (more than 3 lines after wrap) are rendered in faded grey so
      // the user can see at a glance which ones overflowed.
      var wrap = R.wrapToFit(String(data[i].label || ""),
        rs.labelSize, labelTargetW, 3, R.LABEL_ADVANCE);
      wrappedLabels.push(wrap);
      if (!wrap.fits) truncCount++;
      if (wrap.lines.length > maxLines) maxLines = wrap.lines.length;
      for (var l = 0; l < wrap.lines.length; l++) {
        var lw = wrap.lines[l].length * rs.labelSize * R.LABEL_ADVANCE;
        if (lw > maxLineW) maxLineW = lw;
      }
    }
    if (truncCount > 0) {
      R.pushWarning("label-truncated", {
        count: truncCount,
        suggestion: "Try a wider chart or shorter category labels"
      });
    }
    // Column width = exactly what the longest wrapped line needs, plus
    // a 2-px glyph-bearing safety margin. No minimum floor: short
    // labels collapse the column so the longest one always sits at
    // x ≈ 2 (perceptually flush with the title), regardless of dataset.
    var labelColW = maxLineW + 2;
    var labelBlockH = maxLines * LABEL_LINE_H;

    // If wrapped labels extend beyond barThickness, inflate the row gap.
    // The actual gap used between rows is `betweenBarH` further down,
    // which combines this overhang with the callout strip and the
    // user-set bar spacing.
    var labelOverhang = Math.max(0, (labelBlockH - barThickness) / 2);

    // Bar starts after label column + gap + optional icon slot
    var labelToBarGap = 12;
    var iconSlotW = iconMaxW > 0 ? (iconMaxW + iconGap) : 0;
    var barStartX = labelColW + labelToBarGap + iconSlotW;

    // Reserve room on the right for row totals
    var totalReserve = 40;
    var barsZoneW = plotWidth - barStartX - totalReserve;
    if (barsZoneW < 40) barsZoneW = 40;

    // Row totals for scale
    var maxTotal = 0;
    for (var mt = 0; mt < data.length; mt++) {
      if (!data[mt].values) continue;
      var rowTotal = 0;
      for (var mv = 0; mv < data[mt].values.length; mv++) {
        rowTotal += Math.abs(data[mt].values[mv]);
      }
      if (rowTotal > maxTotal) maxTotal = rowTotal;
    }
    if (maxTotal === 0) maxTotal = 1;
    if (config.axisMax != null && config.axisMax > 0) maxTotal = config.axisMax;
    var xScale = R.linearScale(0, maxTotal, 0, barsZoneW);

    // ─── Segment labels: inside if fits, else cluster callout ──
    var insideFont = Math.max(7, rs.valueSize - 1);
    var CALLOUT_FONT = Math.max(5, insideFont - 3);
    var INSIDE_FIT_PAD = 4;
    var CALLOUT_BASE_GAP = 5;

    var lblModeForLayout = config.barLabelMode || "outside";
    var labelsOn = lblModeForLayout !== "none" && lblModeForLayout !== "total";

    function fitsInside(segW, valText) {
      // Inside-segment values render in fonts.value (Roboto Condensed)
      var textW = valText.length * insideFont * R.LABEL_ADVANCE;
      return segW >= textW + INSIDE_FIT_PAD;
    }

    // When a row has exactly one non-zero segment AND the row total is
    // also being printed at the end of the bar, the segment label would
    // just duplicate the total. Skip the segment label (and any
    // callout) in that case — keep only the total.
    function redundantSegLabel(row) {
      if (lblModeForLayout !== "outside") return false;
      var vals = row.values || [];
      var nz = 0;
      var total = 0;
      for (var k = 0; k < vals.length; k++) {
        var v = Math.abs(vals[k]);
        total += v;
        if (v > 0) nz++;
      }
      if (nz !== 1) return false;
      // If hideZeroLabels is on and the total is 0, the total won't
      // print either — so the segment label isn't redundant.
      if (config.hideZeroLabels && total === 0) return false;
      return true;
    }

    // Build per-bar clusters of consecutive small segments. Each
    // cluster becomes ONE callout — values printed in order, each
    // preceded by a tiny dot colored to match its segment so the
    // reader can map dot → stack segment at a glance.
    var barClusters = [];
    var anyCallouts = false;
    for (var j = 0; j < data.length; j++) {
      var vals = data[j].values || [];
      var clusters = [];
      var skipThisRow = redundantSegLabel(data[j]);
      if (labelsOn && !skipThisRow) {
        var current = null;
        var xOffPre = 0;
        for (var s = 0; s < vals.length; s++) {
          var sv = Math.abs(vals[s]);
          if (sv === 0) continue;
          var sw = xScale(sv);
          var vt = R.formatNumber(sv, config.numFmt);
          var segColorPre = config.colors[s % config.colors.length];
          if (fitsInside(sw, vt)) {
            if (current) { clusters.push(current); current = null; }
          } else {
            if (!current) current = { startX: barStartX + xOffPre, items: [] };
            current.items.push({
              text: vt,
              color: segColorPre,
              cx: barStartX + xOffPre + sw / 2
            });
            current.endX = barStartX + xOffPre + sw;
          }
          xOffPre += sw;
        }
        if (current) clusters.push(current);
        for (var c = 0; c < clusters.length; c++) {
          clusters[c].cx = (clusters[c].startX + clusters[c].endX) / 2;
        }
        if (clusters.length > 0) anyCallouts = true;
      }
      barClusters.push(clusters);
    }

    // Reserve a compact strip above each bar for callouts when needed.
    var calloutSpace = anyCallouts ? (CALLOUT_FONT + CALLOUT_BASE_GAP + 2) : 0;

    // Bar row vertical layout. The space BETWEEN bars is shared by:
    //   - the upper bar's label overhang (if the wrapped label is
    //     taller than the bar)
    //   - the lower bar's callout strip (+ its label overhang)
    //   - a minimum "bar gap" for visual breathing room
    // One number covers all three (no double-counting).
    var betweenBarH = Math.max(calloutSpace, labelOverhang, barGap);
    var topPadding    = Math.max(calloutSpace, labelOverhang);  // above bar 0
    var bottomPadding = labelOverhang;                           // below last bar
    var plotHeight = topPadding +
                     data.length * barThickness +
                     (data.length - 1) * betweenBarH +
                     bottomPadding;

    // Footer — gap added by computeFooterStart only when footer has text
    var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });

    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height + rs.marginBottom)  // request, but never clip content
      : (footerStartY + footer.height + rs.marginBottom);

    var svg = [];
    svg.push(R.svgOpen(svgW, svgH));
    svg.push(R.svgBg(svgW, svgH));
    for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);
    for (var li = 0; li < legend.svg.length; li++) svg.push(legend.svg[li]);

    svg.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    for (var j2 = 0; j2 < data.length; j2++) {
      // Bar top = topPadding above bar 0, plus (barThickness + betweenBarH)
      // for each subsequent bar.
      var y = topPadding + j2 * (barThickness + betweenBarH);

      // Category label — multi-line, right-aligned at x = labelColW,
      // vertically centered against the bar. Truncated labels render
      // in faded grey to flag the overflow.
      var lblWrap = wrappedLabels[j2];
      var lines = lblWrap.lines;
      var lblColor = lblWrap.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
      var actualBlockH = lines.length * LABEL_LINE_H;
      var labelBlockTopY = y + (barThickness - actualBlockH) / 2;
      var lineBaseY = labelBlockTopY + rs.labelSize;
      for (var ln = 0; ln < lines.length; ln++) {
        svg.push('    <text x="' + labelColW.toFixed(1) + '" y="' + lineBaseY.toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" fill="' + lblColor + '" text-anchor="end">' +
          R.escapeXml(lines[ln]) + '</text>');
        lineBaseY += LABEL_LINE_H;
      }

      // Icon between label column and bar
      if (iconMaxW > 0 && data[j2]._iconSvg) {
        var dims = R.getIconDims(data[j2]._iconSvg, iconH, iconNorm);
        var icoX = labelColW + labelToBarGap + (iconMaxW - dims.w) / 2;
        var icoY = y + (barThickness - dims.h) / 2;
        var icoColor = !isFlags ? (config.rowIconColor || "#009EDB") : null;
        svg.push('    ' + R.buildIconGroup(data[j2]._iconSvg, iconH, icoX, icoY, icoColor, iconNorm));
      }

      // Stroke config
      var hasStroke = config.stackedStroke;
      var strokeAttr = hasStroke
        ? ' stroke="' + (config.stackedStrokeColor || "#FFFFFF") + '" stroke-width="' + (config.stackedStrokeWidth || 1) + '"'
        : '';

      // Stacked segments
      var xOff = 0;
      for (var s2 = 0; s2 < data[j2].values.length; s2++) {
        var segVal = Math.abs(data[j2].values[s2]);
        if (segVal === 0) continue;
        var segW = xScale(segVal);
        var segColor = config.colors[s2 % config.colors.length];
        var actualW = Math.max(1, segW);
        var rectX = barStartX + xOff;

        svg.push('    <rect x="' + rectX.toFixed(1) + '" y="' + y +
          '" width="' + actualW.toFixed(1) + '" height="' + barThickness +
          '" fill="' + segColor + '"' + strokeAttr + '/>');

        // Inside label if it fits; skipped when this row has only one
        // non-zero segment and the total at the end would duplicate it.
        if (labelsOn && !redundantSegLabel(data[j2])) {
          var valText = R.formatNumber(segVal, config.numFmt);
          if (fitsInside(segW, valText)) {
            var txtColor = config.labelColor ? st.valueColor : R.contrastText(segColor);
            svg.push('    <text x="' + (rectX + segW / 2).toFixed(1) + '" y="' +
              (y + barThickness / 2 + insideFont * 0.35).toFixed(1) +
              '" font-family="' + fonts.value + '" font-size="' + insideFont +
              '" fill="' + txtColor + '" text-anchor="middle">' + valText + '</text>');
          }
        }

        xOff += segW;
      }

      // Cluster callouts above the bar.
      //
      // Two or more consecutive small segments → one dots-strip:
      //   [• value • value …] centred on the cluster, dots coloured
      //   to match each segment. The leader is a short bracket: a
      //   horizontal line spanning the cluster width at the bottom,
      //   joined to a vertical stem rising to the dots-strip. Leaves
      //   a small gap between the bracket and the bar (not touching).
      // One small segment → simple vertical leader + centred value.
      //   Still not touching the bar.
      var myClusters = barClusters[j2] || [];
      var DOT_R = 1.5;
      var DOT_GAP = 1;      // dot → text  (tight)
      var PAIR_GAP = 3;     // (text end) → (next dot)
      var LEADER_BAR_GAP = 2;   // gap between leader bottom and bar top
      for (var mc = 0; mc < myClusters.length; mc++) {
        var cl = myClusters[mc];
        var coBaseY = y - CALLOUT_BASE_GAP;
        var items = cl.items;
        // Where the leader bottoms out — not touching the bar.
        var leaderBottomY = y - LEADER_BAR_GAP;

        if (items.length >= 2) {
          // Bracket leader: horizontal span across cluster + vertical stem
          svg.push('    <line x1="' + cl.startX.toFixed(1) + '" y1="' + leaderBottomY.toFixed(1) +
            '" x2="' + cl.endX.toFixed(1) + '" y2="' + leaderBottomY.toFixed(1) +
            '" stroke="#8A8A8A" stroke-width="0.5" opacity="0.6"/>');
          svg.push('    <line x1="' + cl.cx.toFixed(1) + '" y1="' + (coBaseY + 1).toFixed(1) +
            '" x2="' + cl.cx.toFixed(1) + '" y2="' + leaderBottomY.toFixed(1) +
            '" stroke="#8A8A8A" stroke-width="0.5" opacity="0.6"/>');

          // Dots-strip (centred on cluster cx)
          var totalW = 0;
          var pairWidths = [];
          for (var it = 0; it < items.length; it++) {
            // Callout text uses fonts.value (Roboto Condensed)
            var textW = items[it].text.length * CALLOUT_FONT * R.LABEL_ADVANCE;
            var pairW = DOT_R * 2 + DOT_GAP + textW;
            pairWidths.push(pairW);
            totalW += pairW;
          }
          totalW += Math.max(0, items.length - 1) * PAIR_GAP;
          var cursorX = cl.cx - totalW / 2;
          var dotCy = coBaseY - CALLOUT_FONT * 0.32;
          for (var it2 = 0; it2 < items.length; it2++) {
            var dotCx = cursorX + DOT_R;
            svg.push('    <circle cx="' + dotCx.toFixed(1) + '" cy="' + dotCy.toFixed(1) +
              '" r="' + DOT_R + '" fill="' + items[it2].color + '"/>');
            var textX = cursorX + DOT_R * 2 + DOT_GAP;
            svg.push('    <text x="' + textX.toFixed(1) + '" y="' + coBaseY.toFixed(1) +
              '" font-family="' + fonts.value + '" font-size="' + CALLOUT_FONT +
              '" fill="' + st.valueColor + '" text-anchor="start">' +
              R.escapeXml(items[it2].text) + '</text>');
            cursorX += pairWidths[it2] + PAIR_GAP;
          }
        } else {
          // Single segment — simple vertical leader with a small gap
          // above the bar (still not touching).
          var item = items[0];
          svg.push('    <line x1="' + item.cx.toFixed(1) + '" y1="' + (coBaseY + 1).toFixed(1) +
            '" x2="' + item.cx.toFixed(1) + '" y2="' + leaderBottomY.toFixed(1) +
            '" stroke="#8A8A8A" stroke-width="0.5" opacity="0.6"/>');
          svg.push('    <text x="' + item.cx.toFixed(1) + '" y="' + coBaseY.toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + CALLOUT_FONT +
            '" fill="' + st.valueColor + '" text-anchor="middle">' +
            R.escapeXml(item.text) + '</text>');
        }
      }

      // Row total at end of bar
      var lblMode2 = config.barLabelMode || "outside";
      if (lblMode2 === "outside" || lblMode2 === "total") {
        var rowTot = 0;
        for (var rv = 0; rv < data[j2].values.length; rv++) rowTot += Math.abs(data[j2].values[rv]);
        if (!(config.hideZeroLabels && rowTot === 0)) {
          svg.push('    <text x="' + (barStartX + xOff + 6).toFixed(1) + '" y="' +
            (y + barThickness / 2 + rs.valueSize * 0.35).toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + rs.valueSize +
            '" fill="' + st.valueColor + '">' + R.formatNumber(rowTot, config.numFmt) + '</text>');
        }
      }
    }

    svg.push('  </g>');
    for (var fi = 0; fi < footer.svg.length; fi++) svg.push(footer.svg[fi]);
    svg.push('</svg>');
    return svg.join("\n");
  }

  R.register("stacked-bar", "Stacked Bar", render);
})();
