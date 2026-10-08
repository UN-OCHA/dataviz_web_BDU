/**
 * Stacked Vertical Column Chart Renderer
 *
 * Data shape: [{label, values: [v1, v2, ...]}]
 *
 * Each column is split into N segments (one per series, coloured from
 * the style palette). Category labels sit below each column and wrap
 * to 3 lines if needed (rotating to -45° when even wrapped labels
 * would overlap). Optional inline icon or flag in the label slot.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    // Columns are flush-left on the composition (matches title/legend).
    // marginLeft starts at 0; the pre-scan below adds right-side space
    // for callouts only — the leftmost column's callouts always go
    // right so nothing overflows the composition on the left.
    var marginRight = rs.marginRight;
    var marginLeft = 0;

    // Icon column
    var hasIcons = config.iconColType && config.iconColType !== "none";
    var isFlags = config.iconColType === "flags";
    var iconNorm = hasIcons ? (isFlags ? 1.5 : 1.0) : false;
    var iconSize = Math.min(rs.labelSize * 1.2, 18);
    var iconGap = 4;
    var iconMaxH = hasIcons ? R.maxIconHeight(data, iconSize, iconNorm) : 0;

    var rotateLabels = data.length > rs.labelRotateThreshold;

    // Pre-wrap x-axis labels (horizontal mode only) so marginBottom
    // can grow vertically to fit multi-line labels. Step is content-
    // driven (colW + barGap) so we can predict it without knowing
    // marginBottom — same trick used in chart-vbar.js.
    var prewrapColW = config.barThickness && config.barThickness > 0
      ? config.barThickness
      : rs.barThickness;
    var prewrapPlotWidth = svgW - marginLeft - marginRight;

    // Step grows to accommodate the widest single word in any label
    // (so month names like "September" or "February" don't overflow
    // into adjacent columns). Same logic as chart-vbar.js.
    var widestWordW = 0;
    if (!rotateLabels) {
      for (var ww = 0; ww < data.length; ww++) {
        var words = String(data[ww].label || "").split(/\s+/);
        for (var wi = 0; wi < words.length; wi++) {
          var wW = words[wi].length * rs.labelSize * R.LABEL_ADVANCE;
          if (wW > widestWordW) widestWordW = wW;
        }
      }
    }
    // User-configurable bar spacing — overrides the responsive default
    // when > 0. The label-driven step minimum can still grow it further.
    var effBarGap = (config.barSpacing && config.barSpacing > 0) ? config.barSpacing : rs.barGap;
    var idealStep = prewrapColW + effBarGap;
    var minStepForLabels = Math.ceil(widestWordW + 12);
    var prewrapStep = Math.max(idealStep, minStepForLabels);
    // Left pad so the first column's centred label doesn't clip the
    // canvas. Same logic as chart-vbar.js.
    if (!rotateLabels && widestWordW > prewrapColW) {
      marginLeft = Math.ceil((widestWordW - prewrapColW) / 2);
      prewrapPlotWidth = svgW - marginLeft - marginRight;
    }
    if (data.length > 1) {
      var stretchStep = (prewrapPlotWidth - prewrapColW) / (data.length - 1);
      if (prewrapStep > stretchStep) prewrapStep = stretchStep;
    }

    var labelWraps = [];
    var maxLabelLines = 1;
    if (!rotateLabels) {
      var wrapMaxW = Math.max(40, prewrapStep - 4);
      for (var pw = 0; pw < data.length; pw++) {
        var lw = R.wrapToFit(String(data[pw].label || ""),
          rs.labelSize, wrapMaxW, 3, R.LABEL_ADVANCE);
        labelWraps.push(lw);
        if (lw.lines.length > maxLabelLines) maxLabelLines = lw.lines.length;
      }
    }

    // Content-aware bottom margin: rotated → single-line extent;
    // horizontal → reserves room for the actual wrapped line count.
    var marginBottom = R.measureXAxisLabelBudget(data, rs, rotateLabels, maxLabelLines, !!config.footer);
    if (iconMaxH > 0) {
      marginBottom += iconMaxH + iconGap;
    }

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

    var plotTop = R.computePlotTop(rs, header);

    // Optional legend above the plot (same helper as stacked-bar)
    var legend = { svg: [], height: 0 };
    if (config.stackedLegend && config.seriesNames && config.seriesNames.length) {
      legend = R.renderStackedLegend({
        x: 0,
        startY: plotTop,
        names: config.seriesNames,
        colors: config.colors,
        rs: rs, style: st,
        maxWidth: svgW,
        hasSubtitle: !!config.subtitle
      });
      plotTop += legend.height;
    }

    // Column totals (and tier-3 callouts) draw ABOVE the columns, so a
    // column reaching the top of the plot pushes its total into the header
    // gap. Reserve that label row between header/legend and plot, like
    // cluster-vertical already does.
    if ((config.barLabelMode || "outside") !== "none") {
      plotTop += rs.valueSize + 6;
    }

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

    // Max row total for scale
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

    // User-fixed scale anchor takes precedence over nice-rounded auto max.
    var scale;
    if (config.axisMax != null && config.axisMax > 0) {
      scale = { min: 0, max: config.axisMax };
    } else {
      scale = R.niceScale(0, maxTotal, rs.maxTicks);
    }
    var yScale = R.linearScale(0, scale.max, plotHeight, 0);

    // ─── Segment-label layout ──────────────────────────────
    // Single threshold: inside if it fits comfortably, else a side
    // callout. Side alternates right/left within a column (edge-safe:
    // leftmost column always right, rightmost always left).
    //
    // Callouts on the same side that are vertically close get packed
    // into 2 rows with alternating SHORT / LONG leader lines — the
    // longer one sits farther out so the text doesn't overlap the
    // shorter-leader callout next to it.
    var insideFontV = Math.max(6, rs.valueSize - 1);
    var CALLOUT_FONT_V = Math.max(5, insideFontV - 3);
    var INSIDE_FIT_H = insideFontV + 4;
    var CALLOUT_LEADER_SHORT = 4;
    var CALLOUT_LEADER_LONG = 14;
    var CALLOUT_SIDE_W_1 = 30;   // reserved side margin, single row
    var CALLOUT_SIDE_W_2 = 50;   // reserved side margin, two rows

    var lblModeV = config.barLabelMode || "outside";
    var labelsOnV = lblModeV !== "none" && lblModeV !== "total";

    var anyCalloutsV = false;
    if (labelsOnV) {
      for (var psv = 0; psv < data.length && !anyCalloutsV; psv++) {
        var vv = data[psv].values || [];
        for (var pvv = 0; pvv < vv.length; pvv++) {
          var vvv = Math.abs(vv[pvv]);
          if (vvv === 0) continue;
          if ((plotHeight - yScale(vvv)) < INSIDE_FIT_H) { anyCalloutsV = true; break; }
        }
      }
    }
    // Pre-pack tier-3 callouts per column: assign each a side (right/
    // left, edge-safe alternation) and a row (0 short leader / 1 long
    // leader) based on vertical overlap on that side.
    var columnCallouts = [];  // [{segIdx: {side, row, yCenter, value}}] per column
    var anyTwoRowsV = false;
    if (labelsOnV) {
      var textHalfH = CALLOUT_FONT_V * 0.6 + 2;
      function packSide(list) {
        list.sort(function (a, b) { return a.yCenter - b.yCenter; });
        var packed = [[], []];
        for (var c = 0; c < list.length; c++) {
          var cc = list[c];
          var placed = false;
          for (var r = 0; r < packed.length; r++) {
            var last = packed[r][packed[r].length - 1];
            if (!last || (cc.yCenter - textHalfH) > (last.yCenter + textHalfH)) {
              cc.row = r;
              packed[r].push(cc);
              placed = true;
              break;
            }
          }
          if (!placed) { cc.row = 1; packed[1].push(cc); }
          if (cc.row === 1) anyTwoRowsV = true;
        }
      }
      for (var jp = 0; jp < data.length; jp++) {
        var valsP = data[jp].values || [];
        var yRunning = 0;
        var rightSide = [];
        var leftSide = [];
        var altCount = 0;
        var coMap = {};
        for (var sp = 0; sp < valsP.length; sp++) {
          var svp = Math.abs(valsP[sp]);
          if (svp === 0) continue;
          var segHp = plotHeight - yScale(svp);
          if (segHp < INSIDE_FIT_H) {
            var side;
            if (jp === 0) side = "right";
            else if (jp === data.length - 1) side = "left";
            else side = (altCount % 2 === 0) ? "right" : "left";
            altCount++;
            var rec = {
              segIdx: sp,
              side: side,
              yCenter: plotHeight - yRunning - segHp / 2
            };
            if (side === "right") rightSide.push(rec);
            else leftSide.push(rec);
            coMap[sp] = rec;
          }
          yRunning += segHp;
        }
        packSide(rightSide);
        packSide(leftSide);
        columnCallouts.push(coMap);
      }
    } else {
      for (var jp2 = 0; jp2 < data.length; jp2++) columnCallouts.push({});
    }

    // ─── Callout-aware horizontal sizing ──────────────────
    // Two things to size from the actual callout texts:
    //   1. The right margin reserved for the rightmost column's right
    //      callouts (used to be a fixed 30/50 px slot — but a value
    //      like "1.05M" at 7 pt is already wider than that).
    //   2. The minimum gap BETWEEN adjacent columns when callouts on
    //      facing sides could collide (right callout of column N
    //      extending into the gap, left callout of column N+1
    //      extending back). barGap defaults are 5–12 px depending on
    //      breakpoint, which isn't enough.
    var calloutRightExtent = [];
    var calloutLeftExtent = [];
    var maxLastRightExtent = 0;
    if (labelsOnV) {
      for (var ce = 0; ce < data.length; ce++) {
        var ceMap = columnCallouts[ce] || {};
        var ceVals = data[ce].values || [];
        var rExt = 0;
        var lExt = 0;
        for (var ces = 0; ces < ceVals.length; ces++) {
          var ceRec = ceMap[ces];
          if (!ceRec) continue;
          var ceLeader = ceRec.row === 0 ? CALLOUT_LEADER_SHORT : CALLOUT_LEADER_LONG;
          // Callout text uses fonts.value (Roboto Condensed)
          var ceText = R.formatNumber(Math.abs(ceVals[ces]), config.numFmt);
          var ceTextW = ceText.length * CALLOUT_FONT_V * R.LABEL_ADVANCE;
          var ceExtent = ceLeader + ceTextW + 4; // 2px text gap + 2px end pad
          if (ceRec.side === "right" && ceExtent > rExt) rExt = ceExtent;
          else if (ceRec.side === "left" && ceExtent > lExt) lExt = ceExtent;
        }
        calloutRightExtent.push(rExt);
        calloutLeftExtent.push(lExt);
      }
      // Right callouts on the LAST column extend into the right margin.
      maxLastRightExtent = calloutRightExtent[data.length - 1] || 0;
    } else {
      for (var ce0 = 0; ce0 < data.length; ce0++) {
        calloutRightExtent.push(0);
        calloutLeftExtent.push(0);
      }
    }

    // (1) Reserve right margin for the last column's right callouts,
    //     using the actual measured extent (with the static 30/50
    //     fallback as a floor for visual breathing room).
    var CALLOUT_SIDE_W = anyTwoRowsV ? CALLOUT_SIDE_W_2 : CALLOUT_SIDE_W_1;
    if (maxLastRightExtent > CALLOUT_SIDE_W) CALLOUT_SIDE_W = Math.ceil(maxLastRightExtent);
    if (anyCalloutsV) {
      marginRight += CALLOUT_SIDE_W;
    }

    var plotWidth = svgW - marginLeft - marginRight;

    // (2) Minimum column-to-column gap to keep facing callouts clear.
    //     For each adjacent pair (N, N+1): right extent of N + left
    //     extent of N+1 must fit between their bar edges.
    var minStepForCallouts = 0;
    if (labelsOnV) {
      for (var pa = 0; pa < data.length - 1; pa++) {
        var pairGap = calloutRightExtent[pa] + calloutLeftExtent[pa + 1];
        if (pairGap > minStepForCallouts) minStepForCallouts = pairGap;
      }
    }

    // Footer — gap added by computeFooterStart only when footer has text.
    // Plot bottom = plotTop + plotHeight + marginBottom (the row of x-axis
    // labels and optional icons sit in marginBottom and must clear).
    var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight + marginBottom, !!config.footer);
    var footer = R.renderFooter({
      x: 0,
      startY: footerStartY,
      footer: config.footer,
      rs: rs,
      style: st,
      vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });

    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height)
      : (footerStartY + footer.height);

    var svg = [];
    svg.push(R.svgOpen(svgW, svgH));
    svg.push(R.svgBg(svgW, svgH));

    for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);
    for (var li = 0; li < legend.svg.length; li++) svg.push(legend.svg[li]);

    svg.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    // No gridlines — direct labelling provides values

    // Content-driven horizontal layout — same rule as chart-vbar.js.
    // Columns are rs.barThickness wide (or the user's override) at fixed
    // step (colW + barGap), packed from x=0. The right side of the canvas
    // stays empty when there are few columns. With many columns, fall
    // back to stretching across plotWidth, capping colW so columns
    // don't overlap.
    var colW = config.barThickness && config.barThickness > 0
      ? config.barThickness
      : rs.barThickness;
    // Reuse the prewrap-time step (already accounts for the widest
    // label-word minimum) — keeps prewrap and render in agreement.
    var step = prewrapStep;

    // If facing-side callouts would collide across the gap, widen the
    // step. We cap at the chart's stretch limit so columns never run
    // off the canvas; if that cap is still too tight, we accept some
    // overlap (the chart simply doesn't have horizontal room for both
    // the callouts AND the column count). Better than silently
    // overlapping in cases where there IS room, which is the common
    // case (few columns, plenty of empty canvas to the right).
    if (minStepForCallouts > 0) {
      var requiredStep = colW + minStepForCallouts;
      if (requiredStep > step) {
        var stretchCap = data.length > 1
          ? (plotWidth - colW) / (data.length - 1)
          : Infinity;
        step = Math.min(requiredStep, stretchCap);
      }
    }

    if (data.length > 1 && step < colW + 2) {
      colW = Math.max(2, step - 2);
    }

    // Report resolved column width / gap for the Auto pills.
    R.reportResolved("barThickness", colW);
    R.reportResolved("barSpacing", Math.max(0, step - colW));

    // Stroke config
    var hasStroke = config.stackedStroke;
    var strokeAttr = hasStroke
      ? ' stroke="' + (config.stackedStrokeColor || "#FFFFFF") + '" stroke-width="' + (config.stackedStrokeWidth || 1) + '"'
      : '';

    // Columns
    for (var j = 0; j < data.length; j++) {
      var x = j * step;
      var yOff = plotHeight; // start from bottom

      // Tier-3 callouts for this column — side + row come from the
      // pre-pack pass above (edge-safe alternation + 2-row packing).
      var pendingV = [];
      var coMapV = columnCallouts[j] || {};

      for (var s = 0; s < data[j].values.length; s++) {
        var segVal = Math.abs(data[j].values[s]);
        if (segVal === 0) continue;
        var segH = plotHeight - yScale(segVal);
        var segColor = config.colors[s % config.colors.length];

        yOff -= segH;

        var actualH = Math.max(1, segH);

        svg.push('    <rect x="' + x.toFixed(1) + '" y="' + yOff.toFixed(1) +
          '" width="' + colW.toFixed(1) + '" height="' + actualH.toFixed(1) +
          '" fill="' + segColor + '"' + strokeAttr + '/>');

        // Value label: inside if it fits, else a side callout.
        var lblMode = config.barLabelMode || "outside";
        if (lblMode !== "none" && lblMode !== "total") {
          var valTextV = R.formatNumber(segVal, config.numFmt);
          if (segH >= INSIDE_FIT_H) {
            var txtColor = config.labelColor ? st.valueColor : R.contrastText(segColor);
            svg.push('    <text x="' + (x + colW / 2).toFixed(1) + '" y="' +
              (yOff + segH / 2 + insideFontV * 0.35).toFixed(1) +
              '" font-family="' + fonts.value + '" font-size="' + insideFontV +
              '" fill="' + txtColor + '" text-anchor="middle">' + valTextV + '</text>');
          } else {
            // Side callout — side + row were assigned in the pre-pack pass
            var rec = coMapV[s];
            pendingV.push({
              cy: yOff + segH / 2,
              text: valTextV,
              side: rec ? rec.side : "right",
              row: rec ? rec.row : 0
            });
          }
        }
      }

      // Emit pending tier-3 callouts — short or long leader based on row
      for (var pcv = 0; pcv < pendingV.length; pcv++) {
        var cov = pendingV[pcv];
        var leaderLen = cov.row === 0 ? CALLOUT_LEADER_SHORT : CALLOUT_LEADER_LONG;
        var leaderX1, leaderX2, textX, anchor;
        if (cov.side === "right") {
          leaderX1 = x + colW;
          leaderX2 = leaderX1 + leaderLen;
          textX = leaderX2 + 2;
          anchor = "start";
        } else {
          leaderX1 = x;
          leaderX2 = leaderX1 - leaderLen;
          textX = leaderX2 - 2;
          anchor = "end";
        }
        svg.push('    <line x1="' + leaderX1.toFixed(1) + '" y1="' + cov.cy.toFixed(1) +
          '" x2="' + leaderX2.toFixed(1) + '" y2="' + cov.cy.toFixed(1) +
          '" stroke="#8A8A8A" stroke-width="0.5" opacity="0.6"/>');
        svg.push('    <text x="' + textX.toFixed(1) + '" y="' + (cov.cy + 3).toFixed(1) +
          '" font-family="' + fonts.value + '" font-size="' + CALLOUT_FONT_V +
          '" fill="' + st.valueColor + '" text-anchor="' + anchor + '">' + cov.text + '</text>');
      }

      // Total above column — suppressed when total is 0 and the user
      // ticked "Hide 0 value labels".
      var lblMode2 = config.barLabelMode || "outside";
      if (lblMode2 === "outside" || lblMode2 === "total") {
        var rowTot = 0;
        for (var rv = 0; rv < data[j].values.length; rv++) rowTot += Math.abs(data[j].values[rv]);
        if (!(config.hideZeroLabels && rowTot === 0)) {
          svg.push('    <text x="' + (x + colW / 2).toFixed(1) + '" y="' + (yOff - 4).toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + rs.valueSize +
            '" fill="' + st.valueColor + '" text-anchor="middle">' + R.formatNumber(rowTot, config.numFmt) + '</text>');
        }
      }

      // Icon above label (between column and label)
      var labelX = x + colW / 2;
      var iconBottomY = plotHeight + iconGap;
      if (iconMaxH > 0 && data[j]._iconSvg) {
        var dims = R.getIconDims(data[j]._iconSvg, iconSize, iconNorm);
        var icoX = labelX - dims.w / 2;
        var icoY = iconBottomY;
        var icoColor = !isFlags ? (config.rowIconColor || "#009EDB") : null;
        svg.push('    ' + R.buildIconGroup(data[j]._iconSvg, iconSize, icoX, icoY, icoColor, iconNorm));
      }

      // X-axis label (at very bottom, below icon).
      // Rotated mode: single line, fade if extremely long.
      // Horizontal mode: pre-wrapped multi-line, fade if truncated.
      var labelY = iconMaxH > 0
        ? (iconBottomY + iconMaxH + iconGap + rs.labelSize)
        : (plotHeight + rs.labelSize + 4);

      if (rotateLabels) {
        var rotMaxChars = rs.maxLabelChars * 2;
        var rotText = String(data[j].label || "");
        var rotTruncated = rotText.length > rotMaxChars;
        if (rotTruncated) rotText = rotText.substring(0, rotMaxChars - 1) + "…";
        var rotColor = rotTruncated ? R.FADED_LABEL_COLOR : st.labelColor;
        if (rotTruncated) {
          R.pushWarning("label-truncated", { count: 1,
            suggestion: "Try a wider chart or shorter category labels" });
        }
        svg.push('    <text x="' + labelX.toFixed(1) + '" y="' + labelY.toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" fill="' + rotColor + '" text-anchor="end" transform="rotate(-45,' + labelX.toFixed(1) + ',' + labelY.toFixed(1) + ')">' +
          R.escapeXml(rotText) + '</text>');
      } else {
        var wrap = labelWraps[j];
        if (!wrap.fits) {
          R.pushWarning("label-truncated", { count: 1,
            suggestion: "Try a wider chart or shorter category labels" });
        }
        var wrapColor = wrap.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
        var wrapLines = wrap.lines.length ? wrap.lines : [""];
        var lineH = Math.round(rs.labelSize * 1.2);
        for (var ln = 0; ln < wrapLines.length; ln++) {
          svg.push('    <text x="' + labelX.toFixed(1) + '" y="' + (labelY + ln * lineH).toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
            '" fill="' + wrapColor + '" text-anchor="middle">' +
            R.escapeXml(wrapLines[ln]) + '</text>');
        }
      }
    }

    svg.push('  </g>');

    for (var fi = 0; fi < footer.svg.length; fi++) svg.push(footer.svg[fi]);

    svg.push('</svg>');
    return svg.join("\n");
  }

  R.register("stacked-col", "Stacked Column", render);
})();
