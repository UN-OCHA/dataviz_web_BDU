/**
 * Cluster Donut Chart Renderer
 *
 * A grid of small donut charts — one donut per row, all sharing the
 * same slice categories. Series headers (column names) drive the
 * shared legend at the top, with consistent colour per category
 * across every donut.
 *
 * Data shape: [{label, values: [v1, v2, ...]}]
 *   label   → name of this donut (e.g. "Bangladesh")
 *   values  → slice values aligned with config.seriesNames
 *
 * Layout:
 *   - Donuts pack horizontally from x=0 at a content-driven column
 *     width. When natural step would overflow the plot, wrap to the
 *     next row.
 *   - Each donut has its own auto-total in the centre (when
 *     donutCenterAuto is on, the default), and its row label sits
 *     beneath the donut.
 *   - Slice categories repeat across donuts with the same fill, so
 *     "Allocated" is always the same colour everywhere.
 *
 * Settings reused as-is from the single donut:
 *   - donutHole          uniform hole size for every donut
 *   - donutCenterAuto    on → each centre shows that donut's total;
 *                        off → centres stay blank
 *   - pieLabelContent    how slice labels render (when labelMode
 *                        isn't "none")
 *   - pieLabelMode       defaults to "none" since cluster donuts are
 *                        small; user can flip to inside/outside
 *
 * Settings ignored for this type:
 *   - donutCenterTitle / donutCenterLabel — would clone the same
 *     string into every centre, which doesn't make sense for a
 *     cluster.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  // Visual budget for one donut cell. Smaller donuts than a single
  // donut chart on purpose — the cluster needs room for direct
  // labelling on every donut (inside or outside slice labels) and
  // for the row-label below.
  //
  // When labels are off (legend mode) we let donuts breathe wider;
  // when labels go OUTSIDE we shrink them more so the radial
  // labels don't overlap neighbouring donuts. The renderer picks
  // between these at layout time based on the resolved labelMode.
  var IDEAL_DONUT_SIZE_NO_LABELS = 100;
  var IDEAL_DONUT_SIZE_INSIDE = 90;
  var IDEAL_DONUT_SIZE_OUTSIDE = 72;
  var MIN_DONUT_SIZE = 56;
  var DONUT_GAP_X_NO_LABELS = 16;
  var DONUT_GAP_X_OUTSIDE = 36;        // extra room for radial labels
  var DONUT_GAP_Y = 28;
  var LABEL_GAP = 6;

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;
    var n = data.length;

    // Number of slice categories (series). Take the max across rows
    // so partially-filled rows still get the right number of slots.
    var seriesCount = 0;
    for (var sc = 0; sc < n; sc++) {
      if (data[sc].values && data[sc].values.length > seriesCount) {
        seriesCount = data[sc].values.length;
      }
    }
    if (seriesCount === 0) return null;

    // Legend ↔ labels mutually exclusive. When the shared legend is
    // on (the default) the per-donut slice labels are suppressed —
    // they'd just duplicate what the chips already say.
    //
    // When the legend is OFF and labels are on, "auto" mode tries
    // inside first; slices too narrow for an inside label fall
    // back to an outside-radial position. "outside" forces every
    // slice outside.
    var showLegend = (config.clusterDonutLegend !== false);
    var rawLabelMode = config.pieLabelMode || "auto";
    var labelMode = showLegend ? "none" : rawLabelMode;
    var labelContent = config.pieLabelContent || "pct";

    // Flush-left: leftmost donut sits at x=0.
    var marginLeft = 0;
    var marginRight = rs.marginRight;

    // Header
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);
    var plotWidth = svgW - marginLeft - marginRight;

    // Shared legend at the top — one chip per series category. On by
    // default (colour ↔ category mapping needs a key when slices
    // aren't labelled with the category name); user can hide via the
    // "Show legend above chart" checkbox in the design panel.
    //
    // Legend chip colours mirror the same per-category resolution
    // the slices use below: override (if any) → primary brand
    // colour. So the legend always reflects what's actually drawn.
    var legend = { svg: [], height: 0 };
    if (showLegend) {
      var legendPrimary = (config.colors && config.colors[0]) || "#009EDB";
      var legendOverrides = (config.clusterDonutCategoryColors && typeof config.clusterDonutCategoryColors === "object")
        ? config.clusterDonutCategoryColors : {};
      var legendNames = config.seriesNames || [];
      var legendColors = [];
      for (var lc = 0; lc < legendNames.length; lc++) {
        legendColors.push(legendOverrides[legendNames[lc]] || legendPrimary);
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

    // Decide donut size and per-row count, with the IDEAL size and
    // horizontal gap chosen by what's going to live around each
    // donut: nothing (legend mode) → biggest; inside labels → mid;
    // outside / auto labels → smallest with extra gap so radial
    // text doesn't run into the next donut.
    //
    // Note we use rawLabelMode here (the user's choice) — if the
    // legend is on the donut still draws WITHOUT labels but the
    // sizing follows the no-labels budget so it doesn't shrink
    // unnecessarily.
    var IDEAL_DONUT_SIZE, DONUT_GAP_X;
    if (showLegend) {
      IDEAL_DONUT_SIZE = IDEAL_DONUT_SIZE_NO_LABELS;
      DONUT_GAP_X = DONUT_GAP_X_NO_LABELS;
    } else if (rawLabelMode === "outside" || rawLabelMode === "auto") {
      IDEAL_DONUT_SIZE = IDEAL_DONUT_SIZE_OUTSIDE;
      DONUT_GAP_X = DONUT_GAP_X_OUTSIDE;
    } else if (rawLabelMode === "inside") {
      IDEAL_DONUT_SIZE = IDEAL_DONUT_SIZE_INSIDE;
      DONUT_GAP_X = DONUT_GAP_X_NO_LABELS;
    } else {
      IDEAL_DONUT_SIZE = IDEAL_DONUT_SIZE_NO_LABELS;
      DONUT_GAP_X = DONUT_GAP_X_NO_LABELS;
    }

    // Scale the donut sizing with the chart width, like every other chart
    // scales through the breakpoint presets. The constants above were fixed
    // px regardless of width, so narrowing a chart didn't make it smaller —
    // fewer donuts fit per row, each cell got relatively wider, donuts held
    // (or even grew toward) their ideal, and rows stacked up: the chart got
    // TALLER as the user tried to shrink it. Scaling ideal+min with the
    // breakpoint lets a narrow chart genuinely be a small chart.
    var bpScale = { xs: 0.55, sm: 0.72, md: 1, lg: 1 }[R.getBreakpoint(svgW)] || 1;
    IDEAL_DONUT_SIZE = Math.round(IDEAL_DONUT_SIZE * bpScale);
    var minDonutSize = Math.round(MIN_DONUT_SIZE * bpScale);
    // Row gap scales too (28px between 40px donuts would dominate). The
    // horizontal gap for OUTSIDE labels stays unscaled — radial label text
    // needs absolute room, since the font barely shrinks across breakpoints.
    var donutGapY = Math.max(14, Math.round(DONUT_GAP_Y * bpScale));
    if (showLegend || rawLabelMode === "inside" || rawLabelMode === "none") {
      DONUT_GAP_X = Math.max(8, Math.round(DONUT_GAP_X * bpScale));
    }

    var donutSize = IDEAL_DONUT_SIZE;
    var perRow = Math.max(1, Math.floor((plotWidth + DONUT_GAP_X) / (donutSize + DONUT_GAP_X)));
    if (perRow > n) perRow = n;
    var cellW = (plotWidth + DONUT_GAP_X) / perRow;
    donutSize = Math.min(cellW - DONUT_GAP_X, IDEAL_DONUT_SIZE * 1.25);
    if (donutSize < minDonutSize) {
      // Plot is narrow — shrink further, and recompute perRow with
      // the smaller size in case more donuts could fit.
      donutSize = Math.max(minDonutSize, donutSize);
      perRow = Math.max(1, Math.floor((plotWidth + DONUT_GAP_X) / (donutSize + DONUT_GAP_X)));
      if (perRow > n) perRow = n;
      cellW = (plotWidth + DONUT_GAP_X) / perRow;
      donutSize = Math.min(cellW - DONUT_GAP_X, donutSize);
    }
    var rows = Math.ceil(n / perRow);

    var outerR = donutSize / 2;
    var innerR = outerR * ((config.donutHole || 60) / 100);

    // Pre-wrap each donut's row label to up to 2 lines.
    var labelLineH = Math.round(rs.labelSize * 1.2);
    var truncCount = 0;
    var wrappedLabels = [];
    var maxLabelLines = 1;
    for (var li = 0; li < n; li++) {
      var lblW = R.wrapToFit(String(data[li].label || ""), rs.labelSize, cellW - 8, 2, R.LABEL_ADVANCE);
      wrappedLabels.push(lblW);
      if (!lblW.fits) truncCount++;
      if (lblW.lines.length > maxLabelLines) maxLabelLines = lblW.lines.length;
    }
    if (truncCount > 0) {
      R.pushWarning("label-truncated", { count: truncCount,
        suggestion: "Try a wider chart, fewer donuts per row, or shorter row labels" });
    }

    var labelBlockH = maxLabelLines * labelLineH;
    var rowH = donutSize + LABEL_GAP + labelBlockH;
    var plotHeight = rows * rowH + (rows - 1) * donutGapY;

    // Footer — gap added by computeFooterStart only when footer has text.
    var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height)  // request, but never clip content
      : (footerStartY + footer.height);

    var centerAuto = (config.donutCenterAuto !== false);
    var centerTitleSize = Math.max(9, Math.round(donutSize * 0.13));
    var centerValueSize = Math.max(10, Math.round(donutSize * 0.15));

    var svg = [];
    svg.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    // Render each donut.
    for (var di = 0; di < n; di++) {
      var row = Math.floor(di / perRow);
      var col = di - row * perRow;
      var cx = col * cellW + outerR;
      var cy = row * (rowH + donutGapY) + outerR;

      var donut = data[di];
      var values = donut.values || [];
      var donutTotal = 0;
      for (var t = 0; t < values.length; t++) donutTotal += Math.abs(values[t] || 0);
      var totalForAngles = donutTotal || 1;

      // Slices. Default colour for every category is the active
      // style's primary (config.colors[0] — UN blue for OCHA, etc.).
      // If the user has set a per-category override via the design
      // panel (clusterDonutCategoryColors keyed by series name),
      // that wins. Categories that share the default look uniformly
      // brand-coloured; differentiated colours are an explicit
      // editorial choice.
      var primaryFill = (config.colors && config.colors[0]) || "#009EDB";
      var catOverrides = (config.clusterDonutCategoryColors && typeof config.clusterDonutCategoryColors === "object")
        ? config.clusterDonutCategoryColors : {};
      var startAngle = 0;
      var visibleSlices = 0;
      for (var s = 0; s < values.length; s++) {
        var absVal = Math.abs(values[s] || 0);
        if (absVal === 0) continue;
        visibleSlices++;
        var sliceAngle = (absVal / totalForAngles) * 360;
        var endAngle = startAngle + sliceAngle;
        var seriesName = (config.seriesNames && config.seriesNames[s]) || ("Series " + (s + 1));
        var fill = catOverrides[seriesName] || primaryFill;

        if (sliceAngle >= 359.99) {
          // Single non-zero slice → render as full ring (two halves).
          var dHalf1 = R.describeDonutArc(cx, cy, outerR, innerR, 0, 180);
          var dHalf2 = R.describeDonutArc(cx, cy, outerR, innerR, 180, 360);
          svg.push('    <path d="' + dHalf1 + ' ' + dHalf2 + '" fill="' + fill + '" stroke="none"/>');
        } else {
          var d = R.describeDonutArc(cx, cy, outerR, innerR, startAngle, endAngle);
          svg.push('    <path d="' + d + '" fill="' + fill +
            '" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>');
        }

        // Slice label placement.
        //   "none"     → no label (legend mode forces this).
        //   "inside"   → centred in the slice's mid-radius point if
        //                the slice is wide enough; otherwise hidden.
        //   "outside"  → just outside outerR at the slice mid-angle,
        //                anchor based on which half of the donut the
        //                slice sits in.
        //   "auto"     → inside if the slice can host it, else
        //                outside. Best of both for mixed slice sizes.
        if (labelMode !== "none" && sliceAngle > 1) {
          var pctI = Math.round((absVal / totalForAngles) * 100);
          var insideText = R.buildPieLabelText(
            seriesName,
            pctI, absVal, labelContent, rs, config.numFmt
          );
          var insideSize = Math.max(7, rs.labelSize - 2);
          var midAngleI = startAngle + sliceAngle / 2;
          var canFitInside = sliceAngle >= 22;
          var goInside = (labelMode === "inside") ||
                         (labelMode === "auto" && canFitInside);
          var goOutside = (labelMode === "outside") ||
                          (labelMode === "auto" && !canFitInside);

          if (goInside && canFitInside) {
            var midR = (outerR + innerR) / 2;
            var ptI = R.polarToCartesian(cx, cy, midR, midAngleI);
            svg.push('    <text x="' + ptI.x.toFixed(1) + '" y="' + (ptI.y + insideSize * 0.35).toFixed(1) +
              '" font-family="' + fonts.label + '" font-size="' + insideSize +
              '" fill="#ffffff" text-anchor="middle">' +
              R.escapeXml(insideText) + '</text>');
          } else if (goOutside) {
            // Place at outerR + small radial offset; choose anchor
            // by sign of the unit-x at the slice mid-angle so labels
            // on the right read left-to-right and labels on the
            // left right-align toward the donut.
            var radial = outerR + 4;
            var ptO = R.polarToCartesian(cx, cy, radial, midAngleI);
            var anchor = (ptO.x >= cx) ? "start" : "end";
            // Tiny extra horizontal shift so the text doesn't visually
            // touch the donut edge.
            var anchorDx = (anchor === "start") ? 1 : -1;
            svg.push('    <text x="' + (ptO.x + anchorDx).toFixed(1) + '" y="' + (ptO.y + insideSize * 0.35).toFixed(1) +
              '" font-family="' + fonts.label + '" font-size="' + insideSize +
              '" fill="' + st.labelColor + '" text-anchor="' + anchor + '">' +
              R.escapeXml(insideText) + '</text>');
          }
        }

        startAngle = endAngle;
      }

      // If every value was 0, draw a faint ring placeholder so the
      // user can see the donut exists (with no data).
      if (visibleSlices === 0) {
        var dEmpty = R.describeDonutArc(cx, cy, outerR, innerR, 0, 180) +
                   ' ' + R.describeDonutArc(cx, cy, outerR, innerR, 180, 360);
        svg.push('    <path d="' + dEmpty + '" fill="#e6e6e6" stroke="none"/>');
      }

      // Centre text (auto-total only — title/label customisations are
      // global and don't fit a per-donut cluster). Only shown when
      // donutCenterAuto !== false AND there's a real total.
      if (centerAuto && donutTotal > 0) {
        svg.push('    <text x="' + cx.toFixed(1) + '" y="' + (cy + centerValueSize * 0.35).toFixed(1) +
          '" font-family="' + fonts.value + '" font-weight="bold" font-size="' + centerValueSize +
          '" fill="' + st.valueColor + '" text-anchor="middle">' +
          R.escapeXml(R.formatNumber(donutTotal, config.numFmt)) + '</text>');
      }

      // Row label below the donut, multi-line, centred under the
      // donut. Bold so it reads as a heading for each donut (the
      // "Country" / first-column value of the data row).
      var lblData = wrappedLabels[di];
      var lblTopBaselineY = cy + outerR + LABEL_GAP + rs.labelSize;
      var lblColor = lblData.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
      for (var ll = 0; ll < lblData.lines.length; ll++) {
        var lY = lblTopBaselineY + ll * labelLineH;
        svg.push('    <text x="' + cx.toFixed(1) + '" y="' + lY.toFixed(1) +
          '" font-family="' + fonts.label + '" font-weight="700" font-size="' + rs.labelSize +
          '" fill="' + lblColor + '" text-anchor="middle">' +
          R.escapeXml(lblData.lines[ll]) + '</text>');
      }
    }

    svg.push('  </g>');

    // Concat the legend SVG (rendered above the donut grid).
    var body = legend.svg.concat(svg);
    return R.wrapSVG(svgW, svgH, header, footer, body);
  }

  R.register("cluster-donut", "Cluster Donut", render);
})();
