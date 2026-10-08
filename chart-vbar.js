/**
 * Vertical Bar Chart Renderer
 *
 * Each row → one column whose height encodes its value. Category
 * labels sit below the columns and wrap to 3 lines (rotating to -45°
 * when even wrapped labels would overlap). Optional inline icon or
 * flag above each column.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    // marginLeft starts at 0 (flush-left). It may grow below if the
    // longest x-axis label is wider than its column — we need a small
    // left pad so the FIRST column's centred label doesn't clip the
    // canvas left edge. The leftmost visible element (the label) still
    // sits at x ≈ 0 — just the COLUMN moves a little to the right.
    var marginRight = rs.marginRight;
    var marginLeft = 0;

    // Icon column
    var hasIcons = config.iconColType && config.iconColType !== "none";
    var isFlags = config.iconColType === "flags";
    var iconNorm = hasIcons ? (isFlags ? 1.5 : 1.0) : false;
    var iconSize = Math.min(rs.labelSize * 1.2, 18);
    var iconGap = 4;
    // Area normalization: max height varies due to different aspect ratios
    var iconMaxH = hasIcons ? R.maxIconHeight(data, iconSize, iconNorm) : 0;

    var rotateLabels = data.length > rs.labelRotateThreshold;

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
      maxWidth: svgW,
      widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);

    // Value labels sit ABOVE the columns (baseline at column top − 4), so a
    // column reaching the top of the plot pushes its label INTO the header
    // gap — the title/subtitle ended up nearly touching the tallest column's
    // value. Reserve that label row between header and plot, like
    // cluster-vertical already does.
    if ((config.barLabelMode || "outside") === "outside") {
      plotTop += rs.valueSize + 6;
    }

    // Plot area
    var plotWidth = svgW - marginLeft - marginRight;

    // Pre-compute step (the column-to-column distance) so we can
    // pre-wrap x-axis labels against it BEFORE we know marginBottom —
    // the margin needs to grow when labels wrap to multiple lines.
    //
    // Step grows in two situations:
    //   - The bar+gap default is wider than the longest single word
    //     across all labels (typical case)
    //   - A label has a single word wider than bar+gap (e.g. month
    //     names, long region names): step expands to the widest word
    //     + small padding so labels don't overflow into neighbours
    //
    // If even at minStep the chart is too wide, we fall back to a
    // stretched layout (and labels will likely tilt or fade).
    var prewrapBarW = config.barThickness && config.barThickness > 0
      ? config.barThickness
      : rs.barThickness;

    // Find the widest single word — this is the minimum step needed
    // to render labels horizontally without word-level overflow.
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
    // when > 0. Applied as the inter-column gap; the step still grows
    // beyond it if a wider step is needed to fit labels.
    var effBarGap = (config.barSpacing && config.barSpacing > 0) ? config.barSpacing : rs.barGap;
    var idealStep = prewrapBarW + effBarGap;
    var minStepForLabels = Math.ceil(widestWordW + 12);
    var prewrapStep = Math.max(idealStep, minStepForLabels);
    // Left pad — shift the plot right so the FIRST column's centred
    // label doesn't extend past the canvas left edge. Without this,
    // a 36-px label centred on a 24-px-wide column at x=0 would clip
    // its first 6 px. The leftmost VISIBLE pixel (the label's left
    // edge) still ends up at x=0 — just the column is slightly inset.
    if (!rotateLabels && widestWordW > prewrapBarW) {
      marginLeft = Math.ceil((widestWordW - prewrapBarW) / 2);
      plotWidth = svgW - marginLeft - marginRight;
    }
    // Cap step at the plot width: if even the min-step layout overflows,
    // stretch evenly across plotWidth (labels may still wrap or fade).
    if (data.length > 1) {
      var stretchStep = (plotWidth - prewrapBarW) / (data.length - 1);
      if (prewrapStep > stretchStep) prewrapStep = stretchStep;
    }

    // Pre-wrap each label into up to 3 lines that fit within step.
    // Stash for the render loop and capture the max line count so
    // marginBottom reserves enough vertical room.
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
    // Plus the icon row when icons are configured.
    var marginBottom = R.measureXAxisLabelBudget(data, rs, rotateLabels, maxLabelLines, !!config.footer);
    if (iconMaxH > 0) {
      marginBottom += iconMaxH + iconGap;
    }

    // A fixed total height must reserve room for the footer BEFORE sizing the
    // plot — and the plot is floored so a too-small request can never invert
    // the y-scale (negative plotHeight drew columns above the canvas). The
    // canvas then grows past the request when content can't fit: Illustrator
    // clips imports to the viewBox, so overflow = silently missing content.
    var footerProbe = R.renderFooter({
      x: 0, startY: 0, footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    var footerBlockH = footerProbe.height + (config.footer ? rs.footerGap : 0);
    var plotHeight = config.height
      ? Math.max(40, config.height - plotTop - marginBottom - footerBlockH)
      : rs.defaultPlotHeight;

    // Footer — plot bottom = chart baseline + the label/icon row (marginBottom).
    // computeFooterStart adds the breakpoint gap only when footer has text.
    var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight + marginBottom, !!config.footer);
    var footer = R.renderFooter({
      x: 0,
      startY: footerStartY,
      footer: config.footer,
      rs: rs,
      style: st,
      vPad: vPad,
      maxWidth: svgW,
      widthPercent: config.footerTextWidth
    });

    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height)
      : (footerStartY + footer.height);

    // Data range
    var maxVal = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].value > maxVal) maxVal = data[i].value;
    }
    if (maxVal === 0) maxVal = 1;

    // User-fixed scale anchor takes precedence over nice-rounded auto max.
    // Skips niceScale so two comparison charts match their typed number exactly.
    var scale;
    if (config.axisMax != null && config.axisMax > 0) {
      scale = { min: 0, max: config.axisMax };
    } else {
      scale = R.niceScale(0, maxVal, rs.maxTicks);
    }
    var yScale = R.linearScale(0, scale.max, plotHeight, 0);

    var barColor = config.colors[0];

    var svg = [];
    svg.push(R.svgOpen(svgW, svgH));
    svg.push(R.svgBg(svgW, svgH));

    for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);

    svg.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    // No gridlines — direct labelling provides values

    // Content-driven horizontal layout.
    //
    // Each column is rs.barThickness wide (or the user's override) with
    // rs.barGap between columns, packed from x=0. The right side of the
    // canvas stays empty when there are few columns — same composition
    // rule as the rest of the chart engine (leftmost element at x=0,
    // unused space on the right). When the data has too many columns
    // to fit at the natural step, we fall back to stretching across
    // plotWidth and capping bar width so columns don't overlap.
    var barW = config.barThickness && config.barThickness > 0
      ? config.barThickness
      : rs.barThickness;
    // Use the prewrap-time step computed above — it already accounts
    // for both the barW + barGap minimum AND the widest-word minimum
    // (so labels never overflow into adjacent columns), capped by the
    // plot width fallback. If it produced a step narrower than the
    // bar itself (extreme density), shrink barW to keep columns from
    // overlapping.
    var step = prewrapStep;
    if (data.length > 1 && step < barW + 2) {
      barW = Math.max(2, step - 2);
    }

    // Report resolved thickness/spacing for the Auto pills. For vertical
    // columns "thickness" is the column width; "spacing" is the gap between
    // columns (step minus the column itself).
    R.reportResolved("barThickness", barW);
    R.reportResolved("barSpacing", Math.max(0, step - barW));

    // Bars
    for (var j = 0; j < data.length; j++) {
      var x = j * step;
      var val = data[j].value;
      var barH = plotHeight - yScale(val);
      var y = plotHeight - barH;

      // Zero value → no bar. Keep the x-axis label, keep the "0" value
      // label above the baseline, but skip the rect so the reader
      // doesn't see a misleading 1px sliver at the baseline.
      if (val !== 0) {
        svg.push('    <rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
          '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, barH).toFixed(1) +
          '" fill="' + barColor + '"/>');
      }

      // Value label — suppressed when value is 0 and user ticked
      // "Hide 0 value labels" in the Design tab.
      var lblMode = config.barLabelMode || "outside";
      var hideThisLabel = config.hideZeroLabels && val === 0;
      if (!hideThisLabel) {
        if (lblMode === "outside") {
          svg.push('    <text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + rs.valueSize +
            '" fill="' + st.valueColor + '" text-anchor="middle">' + R.formatNumber(val, config.numFmt) + '</text>');
        } else if (lblMode === "inside") {
          var insY = Math.min(y + barH - 4, plotHeight - 4);
          svg.push('    <text x="' + (x + barW / 2).toFixed(1) + '" y="' + insY.toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + rs.valueSize +
            '" fill="' + (config.labelColor || "#ffffff") + '" text-anchor="middle">' + R.formatNumber(val, config.numFmt) + '</text>');
        }
      }

      // Icon above label (between bar and label) — centered on bar width
      var labelX = x + barW / 2;
      var iconBottomY = plotHeight + iconGap;
      if (iconMaxH > 0 && data[j]._iconSvg) {
        var dims = R.getIconDims(data[j]._iconSvg, iconSize, iconNorm);
        var icoX = labelX - dims.w / 2;
        var icoY = iconBottomY;
        var icoColor = !isFlags ? (config.rowIconColor || "#009EDB") : null;
        svg.push('    ' + R.buildIconGroup(data[j]._iconSvg, iconSize, icoX, icoY, icoColor, iconNorm));
      }

      // X-axis label (at very bottom, below icon).
      // Two render modes:
      //   - Rotated (when rs.labelRotateThreshold is exceeded): single
      //     line at -45°. Long labels get the last chars chopped + "…"
      //     and rendered in faded grey.
      //   - Horizontal: wrapped to up to 3 lines that fit within the
      //     column's step width. Same fade/warn behaviour on overflow.
      var labelY = iconMaxH > 0
        ? (iconBottomY + iconMaxH + iconGap + rs.labelSize)
        : (plotHeight + rs.labelSize + 4);

      if (rotateLabels) {
        // Rotated: single-line, truncate with ellipsis only if extremely
        // long. We allow a generous max because the rotated label has
        // room along the diagonal.
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
        // Horizontal: use the pre-wrapped lines (from the labelWraps
        // pass above) so marginBottom already reflects the line count.
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

  R.register("vbar", "Vertical Bar", render);
})();
