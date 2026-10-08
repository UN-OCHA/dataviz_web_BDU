/**
 * Donut Chart Renderer
 *
 * Like the pie chart, but with a configurable centre hole. The hole
 * can host a centre title and label (e.g. a total). Labels can be
 * rendered inside each slice's ring, outside with leader lines, or
 * auto-placed (inside when the slice is wide enough, otherwise out);
 * leader lines and label content (label / value / pct) are all
 * configurable from the Design tab.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;
  var DONUT_DEFAULT = "#009EDB";

  // Test whether a point sits inside a donut slice's wedge — same
  // logic as chart-pie.js but with the inner-radius hole carved out.
  function pointInSlice(px, py, cx, cy, outerR, innerR, startAngle, endAngle) {
    var dx = px - cx;
    var dy = py - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > outerR) return false;
    if (innerR > 0 && dist < innerR) return false;
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

    var donutColor = (config.colors && config.colors[0]) || DONUT_DEFAULT;
    // Legend and direct labels are mutually exclusive — when the
    // user opts into the legend strip the slice labels are
    // suppressed (they'd just duplicate what the chips already say).
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

    // Optional legend strip (default off — donut prefers direct
    // labelling). When on, one chip per slice using the same
    // per-slice colour resolution the slices themselves use, so the
    // legend chips always reflect what's actually drawn.
    var donutSliceOverrides = (config.sliceColors && typeof config.sliceColors === "object")
      ? config.sliceColors : {};
    var donutLegend = { svg: [], height: 0 };
    if (config.pieLegend) {
      var donutLegendNames = [];
      var donutLegendColors = [];
      for (var dli = 0; dli < data.length; dli++) {
        donutLegendNames.push(String(data[dli].label || ""));
        donutLegendColors.push(donutSliceOverrides[data[dli].label] || donutColor);
      }
      donutLegend = R.renderStackedLegend({
        x: 0, startY: plotTop,
        names: donutLegendNames,
        colors: donutLegendColors,
        rs: rs, style: st,
        maxWidth: svgW,
        hasSubtitle: !!config.subtitle
      });
      plotTop += donutLegend.height;
    }

    var labelMargin = (labelMode === "inside" || labelMode === "none") ? Math.min(svgW * 0.08, 30) : Math.min(svgW * 0.22, 90);
    var chartArea = svgW - labelMargin * 2;
    // Diameter is capped by the breakpoint's default plot height — the
    // same vertical budget bar/line charts use — so a pie/donut sits at
    // the same visual scale as the other chart types at any breakpoint.
    // Labels (font size, leader distance, etc.) are unaffected — only
    // the ring shrinks. The hard 80 px floor keeps pies legible at xs.
    var maxDiameter = Math.max(80, rs.defaultPlotHeight);
    var outerR = Math.min(chartArea, maxDiameter) / 2 - 10;
    var innerR = outerR * ((config.donutHole || 60) / 100);
    // Flush-left composition: tentative cx pulled toward the left of
    // the canvas so the donut + its left-side labels occupy [0, ~2*outerR + labelMargin*2].
    // After labels are wrapped and overlaps resolved, the left-extent
    // guard below shifts cx to put the leftmost visible label at x=0.
    var cx = labelMargin + outerR + 10;
    var cy = plotTop + outerR + 10;

    var total = 0;
    for (var i = 0; i < data.length; i++) total += Math.abs(data[i].value);
    if (total === 0) total = 1;

    var labelSize = Math.max(7, rs.labelSize - 1);
    // User-configurable gap between the chart ring and the inner edge
    // of each outside label. Labels use side-based alignment: left-
    // aligned on the right, right-aligned on the left — so the inner
    // edge (closest to the chart) sits at the same radius on both sides.
    var labelDist = (config.pieLabelDistance != null ? config.pieLabelDistance : 24);
    if (labelDist < 8) labelDist = 8;
    var labelInnerRadius = outerR + labelDist;
    var leaderRadius = outerR + Math.max(6, Math.round(labelDist * 0.4));

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

    // Determine inside vs outside labels
    var outsideItems = [];
    var insideItems = [];
    var pushedOutsideCount = 0;

    if (labelMode !== "none") {
      var midR = (outerR + innerR) / 2;
      for (var k = 0; k < sliceMids.length; k++) {
        var sm = sliceMids[k];
        if (sm.pct < 1) continue;

        var placeInside = false;
        if (labelMode === "inside") {
          placeInside = true;
        }
        // labelMode === "auto" or "outside" → always outside for donut.
        // The donut ring is too narrow for inside labels to fit reliably,
        // so "auto" degrades to "outside" here. Users who want inside
        // (e.g. a very thick ring with 2–3 huge slices) must pick it
        // explicitly from the dropdown.

        // Same corner-inside-slice check as chart-pie.js but bounded
        // by both outerR and innerR (donut hole). Wraps to 2 lines
        // against the donut ring's horizontal chord, then verifies
        // every corner of the wrapped block lies inside the slice's
        // wedge — slanted radial sides included.
        if (placeInside) {
          var sliceText = R.buildPieLabelText(sm.label, sm.pct, sm.absVal, labelContent, rs, config.numFmt);
          var midAngleRad = (sm.midAngle - 90) * Math.PI / 180;
          var dxAtMid = midR * Math.cos(midAngleRad);
          var dyAtMid = midR * Math.sin(midAngleRad);
          var horizOuterAtY = Math.sqrt(Math.max(0, outerR * outerR - dyAtMid * dyAtMid));
          var horizFit = 2 * Math.max(0, horizOuterAtY - Math.abs(dxAtMid));
          var insideMaxW = Math.max(20, horizFit - 8);
          var insideWrap = R.wrapToFit(sliceText, labelSize, insideMaxW, 2, R.LABEL_ADVANCE);
          var widestLine = 0;
          for (var wl = 0; wl < insideWrap.lines.length; wl++) {
            var w = insideWrap.lines[wl].length * labelSize * R.LABEL_ADVANCE;
            if (w > widestLine) widestLine = w;
          }

          var insideLineH = Math.round(labelSize * 1.15);
          var blockH = (insideWrap.lines.length - 1) * insideLineH + labelSize * 1.25;
          var inPtX = (cx + dxAtMid);
          var inPtY = (cy + dyAtMid);
          var blockL = inPtX - widestLine / 2;
          var blockR = inPtX + widestLine / 2;
          var blockT = inPtY - blockH / 2;
          var blockB = inPtY + blockH / 2;

          var allCornersInSlice = insideWrap.fits && widestLine <= insideMaxW + 2 &&
            pointInSlice(blockL, blockT, cx, cy, outerR, innerR, sm.startAngle, sm.endAngle) &&
            pointInSlice(blockR, blockT, cx, cy, outerR, innerR, sm.startAngle, sm.endAngle) &&
            pointInSlice(blockL, blockB, cx, cy, outerR, innerR, sm.startAngle, sm.endAngle) &&
            pointInSlice(blockR, blockB, cx, cy, outerR, innerR, sm.startAngle, sm.endAngle);

          if (allCornersInSlice) {
            sm._insideLines = insideWrap.lines;
            insideItems.push(sm);
          } else {
            pushedOutsideCount++;
            placeInside = false;
          }
        }

        if (!placeInside) {
          var leaderPt = R.polarToCartesian(cx, cy, leaderRadius, sm.midAngle);
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

    // Pre-wrap each outside label so we know its final height (single
    // or multi-line) before resolving overlaps. Cap at 2 lines; longer
    // names get ellipsised on the last line by buildPieLabelLines.
    //
    // Each label's position is the radial projection at
    // labelInnerRadius so labels arrange around the chart. Side labels
    // (start/end anchored) naturally have their inner edge at that
    // radius. Top/bottom labels (middle anchored) need to be pushed
    // OUTWARD by halfH so their inner edge also sits at
    // labelInnerRadius — otherwise their center would be there and the
    // inner edge would be halfH closer to the chart. Pushing outward
    // gives every label's inner edge the same clearance from the ring.
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
      // Available width: middle-anchored labels center on textX, so their
      // budget is twice the distance to the nearer canvas edge; side
      // labels extend outward from the inner edge.
      var availW;
      if (isMiddle0) {
        availW = 2 * Math.min(oi.textX - 4, svgW - oi.textX - 4);
      } else {
        availW = oi.isRight ? (svgW - oi.textX - 4) : (oi.textX - 4);
      }
      if (availW < 40) availW = 40;
      oi.lines = R.buildPieLabelLines(oi.label, oi.pct, oi.absVal, labelContent, labelSize, availW, 2, config.numFmt);
      if (oi.lines.length > maxLines) maxLines = oi.lines.length;

      // Push top/bottom labels outward by halfH so the near edge of
      // their text block lines up with the side labels' inner edge.
      if (isMiddle0) {
        var halfH = ((oi.lines.length - 1) * lineGap + labelSize) / 2;
        if (oi.y < cy) {
          oi.y -= halfH;       // top label → push up (further from chart)
        } else {
          oi.y += halfH;       // bottom label → push down
        }
        oi.origY = oi.y;       // keep overlap resolver in sync
      }
    }

    // Overlap gap = tallest label block + small padding.
    var overlapGap = Math.max(labelSize + 4, maxLines * lineGap + 4);
    R.resolveOverlaps(outsideItems, overlapGap);

    // Left-extent guard. The chart is flush-left: the leftmost VISIBLE
    // pixel (either the donut ring's left edge or the leftmost label
    // tip — whichever sits further left) is pinned to x=0. We compute
    // it after pre-wrap so multi-line label widths are accurate, then
    // shift cx and every label's x position by the deficit.
    //
    // The shift is clamped so the donut ring itself never crosses x=0
    // (i.e. cx stays ≥ outerR). With short labels this means the
    // donut's left edge is at x=0 and labels are inset; with long
    // labels the leftmost label tip is at x=0 and the donut sits to
    // the right of it.
    var minLabelX = cx - outerR;
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
        lxLeft = lxItem.textX; // anchor=start → text extends right
      } else {
        lxLeft = lxItem.textX - widestLineW; // anchor=end → text extends left
      }
      if (lxLeft < minLabelX) minLabelX = lxLeft;
    }
    var leftShift = -minLabelX;
    // Clamp so cx never drops below outerR (donut ring stays on canvas)
    if (cx + leftShift < outerR) leftShift = outerR - cx;
    if (leftShift !== 0) {
      cx += leftShift;
      for (var lsh = 0; lsh < outsideItems.length; lsh++) {
        outsideItems[lsh].textX += leftShift;
        outsideItems[lsh].leaderPtX += leftShift;
      }
    }

    // Top-extent guard. Outside labels — especially those near 12
    // o'clock that are middle-anchored and pushed up by halfH — can
    // extend ABOVE the donut and overlap the header. Measure the topmost
    // label's cap-top explicitly and shift the entire chart down by the
    // deficit if it would cross above the plot.
    //
    // resolveOverlaps only ever moves labels DOWN, so the topmost
    // label's y is fixed once pre-wrap completes — safe to measure
    // here and shift everything by the deficit.
    var minCapTop = cy - outerR; // chart's own top edge as the floor
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

    var maxLabelY = cy + outerR + 20;
    for (var li = 0; li < outsideItems.length; li++) {
      var nL = outsideItems[li].lines ? outsideItems[li].lines.length : 1;
      var bot = outsideItems[li].y + (nL - 1) * lineGap + labelSize;
      if (bot > maxLabelY) maxLabelY = bot;
    }

    // Donut's "plot bottom" is maxLabelY (outside labels can extend
    // below the donut itself). computeFooterStart adds rs.footerGap
    // when the footer has content, otherwise no gap.
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
    // Optional legend strip — emitted between header and donut so it
    // sits at the top of the canvas above the slice ring.
    for (var dlsi = 0; dlsi < donutLegend.svg.length; dlsi++) svg.push(donutLegend.svg[dlsi]);

    // Draw slices.
    //
    // The donut hole is left TRANSPARENT — no white fill is drawn over
    // it. describeDonutArc already produces ring-shaped paths with a
    // real hole (an outer arc, an inward line, an inner arc going the
    // opposite direction, then close), so when the chart sits on a
    // non-white artboard the hole shows the artboard colour through.
    //
    // The single-slice (full 360°) case can't use a single donut-arc
    // path because a 360° arc is degenerate, so we draw it as two
    // 180° halves combined into one continuous ring path. Stroke is
    // omitted on the full ring — there are no slice dividers to render.
    //
    // Per-slice colour override: the user can pick a colour per slice
    // from the design panel; the override is keyed by slice label so
    // it survives row reorder and re-sort. Default (no override) is
    // the chart's primary colour, same as before — donuts stay
    // uniformly brand-coloured unless the user opts into emphasis.
    var sliceOverrides = (config.sliceColors && typeof config.sliceColors === "object")
      ? config.sliceColors : {};
    function colorForSlice(label) {
      return sliceOverrides[label] || donutColor;
    }
    for (var s = 0; s < sliceMids.length; s++) {
      var sl = sliceMids[s];
      var slFill = colorForSlice(sl.label);
      if (data.length === 1 || sl.sliceAngle >= 359.99) {
        var dHalf1 = R.describeDonutArc(cx, cy, outerR, innerR, 0, 180);
        var dHalf2 = R.describeDonutArc(cx, cy, outerR, innerR, 180, 360);
        svg.push('  <path d="' + dHalf1 + ' ' + dHalf2 + '" fill="' + slFill + '" stroke="none"/>');
      } else {
        var d = R.describeDonutArc(cx, cy, outerR, innerR, sl.startAngle, sl.endAngle);
        svg.push('  <path d="' + d + '" fill="' + slFill + '" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>');
      }
    }

    // Center text. Behaviour:
    //   - If the user typed anything into Heading or Label, render that.
    //   - Otherwise, fall back to the "Total / formatted total" auto
    //     default ONLY when donutCenterAuto !== false (default true).
    //     Unchecking the Auto box leaves the hole blank.
    var centerTitle = config.donutCenterTitle || "";
    var centerLabel = config.donutCenterLabel || "";
    var centerAuto = (config.donutCenterAuto !== false);

    if (centerTitle || centerLabel) {
      var cTitleSize = Math.max(10, rs.labelSize + 3);
      var cLabelSize = Math.max(9, rs.labelSize + 1);

      if (centerTitle && centerLabel) {
        svg.push('  <text x="' + cx + '" y="' + (cy - 4) +
          '" font-family="' + fonts.heading + '" font-size="' + cTitleSize +
          '" font-weight="bold" fill="' + st.valueColor + '" text-anchor="middle">' +
          R.escapeXml(centerTitle) + '</text>');
        svg.push('  <text x="' + cx + '" y="' + (cy + cLabelSize + 2) +
          '" font-family="' + fonts.value + '" font-size="' + cLabelSize +
          '" fill="' + st.labelColor + '" text-anchor="middle">' +
          R.escapeXml(centerLabel) + '</text>');
      } else if (centerTitle) {
        svg.push('  <text x="' + cx + '" y="' + (cy + cTitleSize * 0.35) +
          '" font-family="' + fonts.heading + '" font-size="' + cTitleSize +
          '" font-weight="bold" fill="' + st.valueColor + '" text-anchor="middle">' +
          R.escapeXml(centerTitle) + '</text>');
      } else {
        svg.push('  <text x="' + cx + '" y="' + (cy + cLabelSize * 0.35) +
          '" font-family="' + fonts.value + '" font-size="' + cLabelSize +
          '" fill="' + st.labelColor + '" text-anchor="middle">' +
          R.escapeXml(centerLabel) + '</text>');
      }
    } else if (centerAuto) {
      var defTitleSize = Math.max(10, rs.labelSize + 3);
      var defValueSize = Math.max(9, rs.labelSize + 1);
      svg.push('  <text x="' + cx + '" y="' + (cy - 4) +
        '" font-family="' + fonts.heading + '" font-size="' + defTitleSize +
        '" font-weight="bold" fill="' + st.valueColor + '" text-anchor="middle">Total</text>');
      svg.push('  <text x="' + cx + '" y="' + (cy + defValueSize + 2) +
        '" font-family="' + fonts.value + '" font-size="' + defValueSize +
        '" fill="' + st.labelColor + '" text-anchor="middle">' + R.formatNumber(total, config.numFmt) + '</text>');
    }

    // Inside labels (placed between inner and outer radius). Multi-line,
    // LEFT-aligned within their text block — the block sits centred on
    // the slice's midRadius point geometrically, but each line shares
    // the same starting x for a paragraph look.
    var insideLineH = Math.round(labelSize * 1.15);
    for (var ins = 0; ins < insideItems.length; ins++) {
      var inItem = insideItems[ins];
      var midR2 = (outerR + innerR) / 2;
      var inPt = R.polarToCartesian(cx, cy, midR2, inItem.midAngle);
      var insideLines = inItem._insideLines && inItem._insideLines.length
        ? inItem._insideLines
        : [R.buildPieLabelText(inItem.label, inItem.pct, inItem.absVal, labelContent, rs, config.numFmt)];
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

    // Outside labels with optional leader lines (multi-line capable).
    // Labels arrange RADIALLY around the chart at labelInnerRadius.
    // Anchor depends on which quadrant the slice lives in:
    //   Top (near 12 o'clock) or bottom (near 6 o'clock) → middle
    //   Right half → start (text flows right)
    //   Left half  → end   (text flows left)
    for (var m = 0; m < outsideItems.length; m++) {
      var item = outsideItems[m];
      var lines = item.lines || R.buildPieLabelLines(item.label, item.pct, item.absVal, labelContent, labelSize, svgW * 0.2, 2, config.numFmt);

      var textX = item.textX != null ? item.textX : cx + (item.isRight ? labelInnerRadius : -labelInnerRadius);
      // Angle in degrees from 12 o'clock clockwise (polarToCartesian convention).
      var ma = item.midAngle;
      var near12 = (ma < 15) || (ma > 345);
      var near6  = (ma > 165 && ma < 195);
      var anchor = (near12 || near6) ? "middle" : (item.isRight ? "start" : "end");

      if (showLeaders) {
        var edgePt = R.polarToCartesian(cx, cy, outerR + 2, item.midAngle);
        // Compute a padded bounding box around the label text block so
        // the leader line stops BEFORE the text instead of going into
        // it. 4px padding around; height accounts for multi-line wrap.
        var padX = 4, padY = 3;
        var blockHalfH = ((lines.length - 1) * lineGap + labelSize) / 2 + padY;
        var endX, endY;
        if (anchor === "middle") {
          endX = textX;
          // Label is above the slice → leader ends just below the block's
          // bottom edge; below the slice → ends just above the block top.
          endY = (item.origY < cy) ? (item.y + blockHalfH) : (item.y - blockHalfH);
        } else {
          endX = item.isRight ? (textX - padX) : (textX + padX);
          endY = item.y;
        }
        // Single diagonal segment from the slice edge to the padded
        // stop point — no corner, no overlap with text.
        svg.push('  <line x1="' + edgePt.x.toFixed(1) + '" y1="' + edgePt.y.toFixed(1) +
          '" x2="' + endX.toFixed(1) + '" y2="' + endY.toFixed(1) +
          '" stroke="#999999" stroke-width="1" opacity="0.5"/>');
      }

      // Vertically center the multi-line block around item.y.
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

  R.register("donut", "Donut Chart", render);
})();
