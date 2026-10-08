/**
 * Cluster (Grouped) Bar Chart Renderer
 *
 * Data shape: [{label, values: [v1, v2, ...]}] — same as the stacked
 * charts.
 *
 * Each category gets N bars side-by-side (one per series) instead of
 * stacked. One colour per series from the style palette; each bar
 * renders its own value label. Orientation is "horizontal" (default)
 * or "vertical", switched from the Design tab — a single chart type
 * with two layouts.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  // Gap between bars within the same category (as a fraction of bar size)
  var INNER_GAP_RATIO = 0.18;

  function render(title, data, config) {
    if (!data.length) return null;

    var orient = config.clusterOrientation || "horizontal";
    if (orient === "vertical") return renderVertical(title, data, config);
    return renderHorizontal(title, data, config);
  }

  // Count max number of series across all rows
  function seriesCount(data) {
    var n = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].values && data[i].values.length > n) n = data[i].values.length;
    }
    return n;
  }

  // Max absolute value across all cells (for the scale)
  function maxValue(data) {
    var m = 0;
    for (var i = 0; i < data.length; i++) {
      if (!data[i].values) continue;
      for (var j = 0; j < data[i].values.length; j++) {
        var v = Math.abs(data[i].values[j] || 0);
        if (v > m) m = v;
      }
    }
    return m || 1;
  }

  // ── Horizontal: category labels on the left, bars extend rightward ──
  function renderHorizontal(title, data, config) {
    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    var sN = seriesCount(data);
    if (sN === 0) return null;

    // Thinner default than single-bar charts — each category stacks N bars,
    // so the total visual height ends up similar to one regular bar.
    // User can override via the Design-tab bar thickness slider.
    var barThickness = config.barThickness || Math.max(6, Math.round(rs.barThickness * 0.55));
    var innerGap = Math.max(1, Math.round(barThickness * INNER_GAP_RATIO));
    // categoryGap = the gap between adjacent clusters. User can
    // override via the Bar Spacing slider (config.barSpacing); when
    // Auto, falls back to the responsive max(rs.barGap, 0.9 × barThickness).
    var categoryGap = (config.barSpacing && config.barSpacing > 0)
      ? config.barSpacing
      : Math.max(rs.barGap, Math.round(barThickness * 0.9));

    // Report resolved per-bar thickness / cluster gap for the Auto pills.
    R.reportResolved("barThickness", barThickness);
    R.reportResolved("barSpacing", categoryGap);

    // Flush-left composition (matches hbar / stacked-bar pattern):
    //   ┌── label column ──┬── bar zone ──┐
    //   x=0                              plotWidth
    // Longest label's left edge sits at x ≈ 0 (perceptually flush
    // with the title); shorter labels right-align inside the column.
    var marginLeft = 0;
    var marginRight = rs.marginRight;

    // Pre-wrap labels into up to 3 lines that fit the capped column.
    // Multi-line labels grow the categoryGap so adjacent rows' labels
    // don't overlap. Truncated labels render in faded grey + push a
    // warning so the panel surfaces a banner.
    var LABEL_LINE_H = Math.round(rs.labelSize * 1.2);
    var labelTargetW = Math.min(svgW * 0.35, 200);
    var wrappedLabels = [];
    var maxLineW = 0;
    var maxLines = 1;
    var truncCount = 0;
    for (var i = 0; i < data.length; i++) {
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

    var labelColW = Math.min(svgW * 0.35, maxLineW + 2);
    var labelToBarGap = 12;
    var barStartX = labelColW + labelToBarGap;

    // Header
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad, maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);

    // Optional legend — same helper as stacked-bar/col. Cluster bars
    // are multi-color per category, so a legend helps the reader map
    // each color to its series name.
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

    // Reserve room for the label column on the left and value labels
    // on the right; bars occupy what's left.
    var valueLabelBudget = Math.max(32, rs.valueSize * 4);
    var usablePlotW = Math.max(20, plotWidth - barStartX - valueLabelBudget);

    // Row height per category = sN bars + (sN-1) inner gaps. If
    // multi-line labels overhang above/below the cluster, grow the
    // gap between categories so labels don't touch the next cluster.
    var categoryH = sN * barThickness + (sN - 1) * innerGap;
    var labelBlockH = maxLines * LABEL_LINE_H;
    var labelOverhang = Math.max(0, (labelBlockH - categoryH) / 2);
    var effCategoryGap = categoryGap + labelOverhang * 2;
    var plotHeight = data.length * categoryH + (data.length - 1) * effCategoryGap;

    var maxVal = maxValue(data);
    // User-fixed scale anchor for cross-chart comparison.
    if (config.axisMax != null && config.axisMax > 0) maxVal = config.axisMax;
    var xScale = R.linearScale(0, maxVal, 0, usablePlotW);

    // Footer — gap added by computeFooterStart only when footer has text
    var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer, rs: rs, style: st, vPad: vPad, maxWidth: svgW, widthPercent: config.footerTextWidth
    });

    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height + rs.marginBottom)  // request, but never clip content
      : (footerStartY + footer.height + rs.marginBottom);

    var body = [];
    // Legend lines sit in absolute SVG coordinates, outside the
    // plot-area transform. Push them before the <g translate>.
    for (var li = 0; li < legend.svg.length; li++) body.push(legend.svg[li]);
    body.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    for (var j = 0; j < data.length; j++) {
      var catTop = j * (categoryH + effCategoryGap);

      // Multi-line category label, right-aligned at the end of the
      // label column, vertically centered on the cluster's middle.
      // Truncated labels render in faded grey.
      var lblWrap = wrappedLabels[j];
      var lblLines = lblWrap.lines.length ? lblWrap.lines : [""];
      var lblColor = lblWrap.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
      var blockH = lblLines.length * LABEL_LINE_H;
      var firstBaselineY = catTop + categoryH / 2 - blockH / 2 + rs.labelSize;
      for (var ln = 0; ln < lblLines.length; ln++) {
        body.push('    <text x="' + labelColW.toFixed(1) + '" y="' + (firstBaselineY + ln * LABEL_LINE_H).toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" fill="' + lblColor + '" text-anchor="end">' +
          R.escapeXml(lblLines[ln]) + '</text>');
      }

      // Draw each series bar — bars start at barStartX (right of label column).
      var values = data[j].values || [];
      for (var s = 0; s < sN; s++) {
        var v = Math.abs(values[s] || 0);
        var barW = xScale(v);
        var barY = catTop + s * (barThickness + innerGap);
        var color = config.colors[s % config.colors.length];

        var actualW = v === 0 ? 0 : Math.max(1, barW);

        if (actualW > 0) {
          body.push('    <rect x="' + barStartX.toFixed(1) + '" y="' + barY + '" width="' + actualW.toFixed(1) +
            '" height="' + barThickness + '" fill="' + color + '"/>');
        }

        // Per-bar value label — suppressed when v===0 and hideZeroLabels.
        if (!(config.hideZeroLabels && v === 0)) {
          var valText = R.formatNumber(v, config.numFmt);
          var valX = barStartX + actualW + 4;
          var valY = barY + barThickness / 2 + rs.valueSize * 0.35;
          body.push('    <text x="' + valX.toFixed(1) + '" y="' + valY.toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + rs.valueSize +
            '" fill="' + st.valueColor + '">' + R.escapeXml(valText) + '</text>');
        }
      }
    }

    body.push('  </g>');
    return R.wrapSVG(svgW, svgH, header, footer, body);
  }

  // ── Vertical: categories on bottom, bars rise from baseline ──
  function renderVertical(title, data, config) {
    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    var sN = seriesCount(data);
    if (sN === 0) return null;

    // Thinner default than single-bar charts — each category stacks N bars,
    // so the total visual height ends up similar to one regular bar.
    // User can override via the Design-tab bar thickness slider.
    var barThickness = config.barThickness || Math.max(6, Math.round(rs.barThickness * 0.55));
    var innerGap = Math.max(1, Math.round(barThickness * INNER_GAP_RATIO));
    // categoryGap = the gap between adjacent clusters. User can
    // override via the Bar Spacing slider (config.barSpacing); when
    // Auto, falls back to the responsive max(rs.barGap, 0.9 × barThickness).
    var categoryGap = (config.barSpacing && config.barSpacing > 0)
      ? config.barSpacing
      : Math.max(rs.barGap, Math.round(barThickness * 0.9));

    // Flush-left composition: first cluster's leftmost bar sits at x=0
    var marginLeft = 0;
    var marginRight = rs.marginRight;

    // Header
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad, maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);

    // Optional legend — same helper as horizontal. Sits above the plot.
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

    // Reserve space at top for value labels, bottom for category labels.
    var valueLabelBudget = rs.valueSize + 6;

    // Column width per category = sN bars + (sN-1) inner gaps.
    // Grow the gap between categories if the longest single word in
    // any label is wider than the cluster itself, so labels don't
    // overflow into adjacent clusters.
    var categoryW = sN * barThickness + (sN - 1) * innerGap;
    var widestWordW = 0;
    for (var ww = 0; ww < data.length; ww++) {
      var words = String(data[ww].label || "").split(/\s+/);
      for (var wi = 0; wi < words.length; wi++) {
        var wW = words[wi].length * rs.labelSize * R.LABEL_ADVANCE;
        if (wW > widestWordW) widestWordW = wW;
      }
    }
    var labelMinPitch = Math.ceil(widestWordW + 12);  // word + padding
    if (labelMinPitch > categoryW + categoryGap) {
      categoryGap = labelMinPitch - categoryW;  // grow the gap
    }
    // Left pad so the first cluster's centred label doesn't clip the
    // canvas left edge.
    if (widestWordW > categoryW) {
      marginLeft = Math.ceil((widestWordW - categoryW) / 2);
    }
    // Report resolved per-bar thickness / cluster gap for the Auto pills
    // (categoryGap is now final — it may have grown for wide labels above).
    R.reportResolved("barThickness", barThickness);
    R.reportResolved("barSpacing", categoryGap);
    var plotWidth = data.length * categoryW + (data.length - 1) * categoryGap;

    // Pre-wrap category labels to up to 3 lines fitting within the
    // wider of categoryW or labelMinPitch (= the row pitch we'll
    // actually use). Multi-line labels grow categoryLabelBudget so
    // the footer never overlaps the labels.
    var labelWrapMaxW = Math.max(40, labelMinPitch - 4);
    var labelWraps = [];
    var maxLabelLines = 1;
    for (var pw = 0; pw < data.length; pw++) {
      var lw = R.wrapToFit(String(data[pw].label || ""),
        rs.labelSize, labelWrapMaxW, 3, R.LABEL_ADVANCE);
      labelWraps.push(lw);
      if (lw.lines.length > maxLabelLines) maxLabelLines = lw.lines.length;
    }
    var categoryLabelBudget = R.measureXAxisLabelBudget(data, rs, false, maxLabelLines, !!config.footer);

    // Allow chart to grow beyond svg width if many categories — but warn via truncation instead
    var svgWUsed = Math.max(svgW, plotWidth + marginLeft + marginRight);

    // Plot height: fill the available height (defaults to rs.defaultPlotHeight)
    var plotHeight = config.height
      ? Math.max(80, config.height - plotTop - rs.marginBottom - categoryLabelBudget - valueLabelBudget)
      : rs.defaultPlotHeight;

    var maxVal = maxValue(data);
    // User-fixed scale anchor for cross-chart comparison.
    if (config.axisMax != null && config.axisMax > 0) maxVal = config.axisMax;
    var yScale = R.linearScale(0, maxVal, 0, plotHeight); // scaled to height (0 → plotHeight)

    var baseline = plotTop + valueLabelBudget + plotHeight;

    // Footer — gap added by computeFooterStart only when footer has text.
    // Plot bottom = baseline + categoryLabelBudget (the row of x-axis labels
    // sits below the baseline and must clear before the footer).
    var footerStartY = R.computeFooterStart(rs, baseline + categoryLabelBudget, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer, rs: rs, style: st, vPad: vPad, maxWidth: svgWUsed, widthPercent: config.footerTextWidth
    });

    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height + rs.marginBottom)  // request, but never clip content
      : (footerStartY + footer.height + rs.marginBottom);

    var body = [];
    // Legend lines are in absolute SVG coordinates, emit them first.
    for (var li = 0; li < legend.svg.length; li++) body.push(legend.svg[li]);
    body.push('  <g transform="translate(' + marginLeft + ',0)">');

    // No baseline line drawn — matches vbar (column chart) and
    // stacked-col, which let the bars themselves define the baseline
    // visually. Earlier versions drew a horizontal axis line here;
    // it was removed for consistency across the vertical chart family.

    for (var j = 0; j < data.length; j++) {
      var catLeft = j * (categoryW + categoryGap);

      // Category label — multi-line, centered under the cluster.
      // Truncated labels render in faded grey + emit a warning.
      var labelCX = catLeft + categoryW / 2;
      var labelY = baseline + rs.labelSize + 6;
      var lblWrap = labelWraps[j];
      if (!lblWrap.fits) {
        R.pushWarning("label-truncated", { count: 1,
          suggestion: "Try a wider chart or shorter category labels" });
      }
      var lblColor = lblWrap.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
      var lblLines = lblWrap.lines.length ? lblWrap.lines : [""];
      var lineH = Math.round(rs.labelSize * 1.2);
      for (var ln = 0; ln < lblLines.length; ln++) {
        body.push('    <text x="' + labelCX.toFixed(1) + '" y="' + (labelY + ln * lineH).toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" fill="' + lblColor + '" text-anchor="middle">' +
          R.escapeXml(lblLines[ln]) + '</text>');
      }

      var values = data[j].values || [];
      for (var s = 0; s < sN; s++) {
        var v = Math.abs(values[s] || 0);
        var barH = yScale(v);
        var barX = catLeft + s * (barThickness + innerGap);
        var barY = baseline - barH;
        var color = config.colors[s % config.colors.length];

        var actualH = v === 0 ? 0 : Math.max(1, barH);

        if (actualH > 0) {
          body.push('    <rect x="' + barX + '" y="' + barY.toFixed(1) +
            '" width="' + barThickness + '" height="' + actualH.toFixed(1) +
            '" fill="' + color + '"/>');
        }

        // Per-bar value label — suppressed when v===0 and hideZeroLabels.
        if (!(config.hideZeroLabels && v === 0)) {
          var valText = R.formatNumber(v, config.numFmt);
          var valCX = barX + barThickness / 2;
          var valY = barY - 4;
          body.push('    <text x="' + valCX.toFixed(1) + '" y="' + valY.toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + rs.valueSize +
            '" fill="' + st.valueColor + '" text-anchor="middle">' +
            R.escapeXml(valText) + '</text>');
        }
      }
    }

    body.push('  </g>');
    return R.wrapSVG(svgWUsed, svgH, header, footer, body);
  }

  R.register("cluster", "Cluster Bar", render);
})();
