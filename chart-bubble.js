/**
 * Bubble Chart Renderer
 *
 * Each row → one bubble whose area encodes the value. Labels sit
 * centered above each bubble (or stacked beside, in vertical layout).
 * The Separation slider on the Design tab controls overlap:
 * negative = overlap (multiply blend), zero = touching, positive =
 * extra spacing.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    var orientation = config.bubbleOrientation || "horizontal";
    var isHorizontal = orientation === "horizontal";
    var separation = config.bubbleSeparation || 0;
    var isOverlap = separation < 0;

    // Flush-left: first bubble's center sits at firstR (its own
    // radius), so its LEFT edge lands at x=0 inside the plot group,
    // aligned with the title. Right margin keeps existing breathing room.
    var marginRight = rs.marginRight + 10;
    var marginLeft = 0;

    // Header
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);

    // Normalize data
    var bubbles = [];
    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      var sizeVal;
      if (d.values && d.values.length) {
        sizeVal = Math.abs(d.values[0]) || 0;
      } else {
        sizeVal = Math.abs(d.value) || 0;
      }
      bubbles.push({ label: d.label, size: sizeVal });
    }

    // Size range
    var sMin = Infinity, sMax = -Infinity;
    for (var r = 0; r < bubbles.length; r++) {
      if (bubbles[r].size < sMin) sMin = bubbles[r].size;
      if (bubbles[r].size > sMax) sMax = bubbles[r].size;
    }
    if (sMax === 0) sMax = 1;

    // User-fixed scale anchor for cross-chart comparison.
    // Anchoring sMin to 0 (instead of the data min) means identical
    // values across two charts produce identical bubble sizes —
    // bubble area is directly proportional to value/axisMax.
    if (config.axisMax != null && config.axisMax > 0) {
      sMin = 0;
      sMax = config.axisMax;
    }

    var plotWidth = svgW - marginLeft - marginRight;
    var maxR, minR;

    if (isHorizontal) {
      maxR = Math.min(40, plotWidth / (bubbles.length * 2.5 + 1));
      minR = Math.max(6, maxR * 0.25);
    } else {
      maxR = Math.min(40, plotWidth / 4);
      minR = Math.max(6, maxR * 0.25);
    }

    function bubbleR(size) {
      // Zero value → no bubble. The row keeps its slot on the axis and
      // its "0" value label + category label, but the circle itself
      // is skipped in the render loop (see bRad > 0 checks below).
      if (size === 0) return 0;
      if (sMax === sMin) return (maxR + minR) / 2;
      var t = (size - sMin) / (sMax - sMin);
      var area = minR * minR + t * (maxR * maxR - minR * minR);
      return Math.sqrt(area);
    }

    var radii = [];
    for (var br = 0; br < bubbles.length; br++) {
      radii.push(bubbleR(bubbles[br].size));
    }

    var bubbleColor = config.colors ? config.colors[0] : "#009EDB";

    // Separation factor — controls horizontal step between bubbles.
    // Baseline 1.2 gives a small visible gap between bubble edges by
    // default (factor 1.0 was edge-to-edge with just the barGap, which
    // looked too tight on most datasets). The slider adjusts FROM this
    // baseline: positive values push bubbles further apart, negative
    // values pull them together (negative enough = overlap).
    //   factor < 1.0  = bubbles overlap (slider < -20)
    //   factor = 1.0  = edge-to-edge (slider = -20)
    //   factor = 1.2  = default with breathing room (slider = 0, "Auto")
    //   factor > 1.2  = extra spread
    var spacingFactor = 1.2 + (separation / 100);

    if (isHorizontal) {
      // Determine if labels need tilting: when small or many labels
      var avgLabelLen = 0;
      for (var al = 0; al < bubbles.length; al++) avgLabelLen += bubbles[al].label.length;
      avgLabelLen = bubbles.length > 0 ? avgLabelLen / bubbles.length : 0;

      var spacing = bubbles.length > 1 ? plotWidth / (bubbles.length - 1) : 0;
      var tiltLabels = false;

      // Tilt when spacing is tight relative to label character width.
      // Labels render in fonts.label (Roboto Condensed).
      if (bubbles.length > 1) {
        var approxLabelWidth = avgLabelLen * rs.labelSize * R.LABEL_ADVANCE;
        if (spacing < approxLabelWidth + 4) {
          tiltLabels = true;
        }
      }
      // Also tilt at small breakpoints with 3+ items
      if ((rs.breakpoint === "xs" || rs.breakpoint === "sm") && bubbles.length >= 3) {
        tiltLabels = true;
      }

      // Vertical layout below the bubble row depends on whether labels
      // are tilted (single line, wide rotated extent) or wrapped
      // (up to 3 horizontal lines stacked). For wrap mode we don't
      // know the wrap result yet because spacing depends on plotWidth
      // — but we can still upper-bound at 3 lines and trim later.
      var lineH = Math.round(rs.labelSize * 1.2);
      var labelBottomExtra;
      if (tiltLabels) {
        var labelExtent = R.measureLabelExtentBelowAnchor(
          bubbles.map(function (b) { return { label: b.label }; }),
          rs, true
        );
        labelBottomExtra = rs.labelSize + 6 + labelExtent + 8;
      } else {
        // Reserve up to 3 lines of label below the bubble. Wraps
        // shorter than 3 lines just leave a bit more bottom whitespace
        // — acceptable trade-off for not having to two-pass-layout.
        labelBottomExtra = 3 * lineH + 14;
      }
      var plotHeight = maxR * 2 + labelBottomExtra + rs.valueSize + 8;
      var axisY = maxR + rs.valueSize + 8;

      // Inset first/last bubbles by their radii so circles don't extend past margins
      var firstR = radii[0] || 0;
      var lastR = radii[bubbles.length - 1] || 0;

      // First bubble center: at least firstR (so the bubble itself
      // sits flush with x=0 on its left edge) AND at least the
      // first label's leftward reach (so the centered/tilted label
      // doesn't clip the canvas left edge). Tilted labels rotate
      // around the bubble center, so their leftmost tip extends
      // labelWidth × sin(45°) ≈ 0.707 × labelWidth left of center;
      // straight (centered) labels extend labelWidth/2 left of center.
      var firstLabelW = bubbles[0].label.length * rs.labelSize * R.LABEL_ADVANCE;
      var firstLabelLeftReach = tiltLabels ? (firstLabelW * 0.707) : (firstLabelW / 2);
      var startX = bubbles.length > 1
        ? Math.max(firstR, firstLabelLeftReach)
        : plotWidth / 2;

      // Content-driven spacing: bubbles sit at a step of
      //   (2 × averageRadius + barGap) × spacingFactor
      // packed from startX. Right side stays empty when there are few
      // bubbles. The separation slider still works — spacingFactor < 1
      // overlaps bubbles, > 1 spreads them. When the natural step
      // produces content wider than plotWidth, fall back to stretching
      // bubbles across the available width (old behaviour).
      var avgR = (firstR + lastR) / 2;
      var idealSpacing = (2 * avgR + rs.barGap) * spacingFactor;
      var effectiveSpacing;
      if (bubbles.length <= 1) {
        effectiveSpacing = 0;
      } else {
        var contentNaturalW = startX + (bubbles.length - 1) * idealSpacing + lastR;
        if (contentNaturalW <= plotWidth) {
          effectiveSpacing = idealSpacing; // pack tight, right empty
        } else {
          // Too many bubbles for the canvas — stretch.
          var usableWidth = plotWidth - startX - lastR;
          var totalSpread = usableWidth * spacingFactor;
          effectiveSpacing = totalSpread / (bubbles.length - 1);
        }
      }

      var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight, !!config.footer);
      var footer = R.renderFooter({
        x: 0, startY: footerStartY,
        footer: config.footer, rs: rs, style: st, vPad: vPad,
        maxWidth: svgW, widthPercent: config.footerTextWidth
      });
      var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height)  // request, but never clip content
      : (footerStartY + footer.height);

      var svg = [];
      svg.push(R.svgOpen(svgW, svgH));
      svg.push(R.svgBg(svgW, svgH));
      for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);

      svg.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

      for (var b = 0; b < bubbles.length; b++) {
        var bx = bubbles.length > 1 ? startX + b * effectiveSpacing : startX;
        var by = axisY;
        var bRad = radii[b];

        var circleStyle = isOverlap
          ? ' style="mix-blend-mode:multiply" fill-opacity="0.7"'
          : ' fill-opacity="0.8"';
        // Skip the circle element entirely when the value is zero —
        // the row keeps its slot on the axis but no bubble is drawn.
        if (bRad > 0) {
          svg.push('    <circle cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) +
            '" r="' + bRad.toFixed(1) + '" fill="' + bubbleColor + '" stroke="none"' + circleStyle + '/>');
        }

        // Value above — always centered. Suppressed when size===0 and
        // the user ticked "Hide 0 value labels".
        if (!(config.hideZeroLabels && bubbles[b].size === 0)) {
          svg.push('    <text x="' + bx.toFixed(1) + '" y="' + (by - bRad - 4).toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + rs.valueSize +
            '" fill="' + st.valueColor + '" text-anchor="middle" font-weight="bold">' +
            R.formatNumber(bubbles[b].size, config.numFmt) + '</text>');
        }

        // Label below: tilted or wrapped (3-line max), always centered.
        // Tilt mode: single line at -45°. If still extremely long, the
        //   tail gets ellipsised + faded.
        // Wrap mode: up to 3 lines at horizontal, fitting the bubble
        //   step width. Truncated → faded grey + warning.
        var labelY = by + bRad + rs.labelSize + 6;
        var lineH = Math.round(rs.labelSize * 1.2);

        if (tiltLabels) {
          var rotMaxChars = rs.maxLabelChars * 2;
          var rotText = String(bubbles[b].label || "");
          var rotTruncated = rotText.length > rotMaxChars;
          if (rotTruncated) rotText = rotText.substring(0, rotMaxChars - 1) + "…";
          var rotColor = rotTruncated ? R.FADED_LABEL_COLOR : st.labelColor;
          if (rotTruncated) {
            R.pushWarning("label-truncated", { count: 1,
              suggestion: "Try a wider chart or shorter bubble labels" });
          }
          svg.push('    <text x="' + bx.toFixed(1) + '" y="' + labelY.toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
            '" fill="' + rotColor + '" text-anchor="end"' +
            ' transform="rotate(-45,' + bx.toFixed(1) + ',' + labelY.toFixed(1) + ')">' +
            R.escapeXml(rotText) + '</text>');
        } else {
          // Wrap to up to 3 lines fitting within the bubble step width.
          var wrapMaxW = Math.max(40, effectiveSpacing - 4);
          var wrap = R.wrapToFit(String(bubbles[b].label || ""),
            rs.labelSize, wrapMaxW, 3, R.LABEL_ADVANCE);
          if (!wrap.fits) {
            R.pushWarning("label-truncated", { count: 1,
              suggestion: "Try a wider chart or shorter bubble labels" });
          }
          var wrapColor = wrap.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
          var wrapLines = wrap.lines.length ? wrap.lines : [""];
          for (var ln = 0; ln < wrapLines.length; ln++) {
            svg.push('    <text x="' + bx.toFixed(1) + '" y="' + (labelY + ln * lineH).toFixed(1) +
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

    } else {
      // Vertical layout
      var vSpacingBase = bubbles.length > 1 ? Math.max(maxR * 2.5, 50) : 0;
      var vSpacing = vSpacingBase * spacingFactor;
      var plotHeightV = (bubbles.length - 1) * vSpacing + maxR * 2 + 20;
      // Left-align: bubble center at maxR so left edge touches the title margin
      var lineX = maxR;

      var footerStartYv = R.computeFooterStart(rs, plotTop + plotHeightV, !!config.footer);
      var footerV = R.renderFooter({
        x: 0, startY: footerStartYv,
        footer: config.footer, rs: rs, style: st, vPad: vPad,
        maxWidth: svgW, widthPercent: config.footerTextWidth
      });
      var svgHv = config.height
      ? Math.max(config.height, footerStartYv + footerV.height)  // request, but never clip content
      : (footerStartYv + footerV.height);

      var svgV = [];
      svgV.push(R.svgOpen(svgW, svgHv));
      svgV.push(R.svgBg(svgW, svgHv));
      for (var hiv = 0; hiv < header.svg.length; hiv++) svgV.push(header.svg[hiv]);

      svgV.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

      var vStartY = maxR + 10;

      for (var bv = 0; bv < bubbles.length; bv++) {
        var bvy = vStartY + bv * vSpacing;
        var bvx = lineX;
        var bvRad = radii[bv];

        var vCircleStyle = isOverlap
          ? ' style="mix-blend-mode:multiply" fill-opacity="0.7"'
          : ' fill-opacity="0.8"';
        if (bvRad > 0) {
          svgV.push('    <circle cx="' + bvx.toFixed(1) + '" cy="' + bvy.toFixed(1) +
            '" r="' + bvRad.toFixed(1) + '" fill="' + bubbleColor + '" stroke="none"' + vCircleStyle + '/>');
        }

        // Value: inside if big, else above. Suppressed when size===0
        // and the user ticked "Hide 0 value labels".
        if (!(config.hideZeroLabels && bubbles[bv].size === 0)) {
          if (bvRad > 16) {
            svgV.push('    <text x="' + bvx.toFixed(1) + '" y="' + (bvy + rs.valueSize * 0.35).toFixed(1) +
              '" font-family="' + fonts.value + '" font-size="' + rs.valueSize +
              '" fill="#ffffff" text-anchor="middle" font-weight="bold">' +
              R.formatNumber(bubbles[bv].size, config.numFmt) + '</text>');
          } else {
            svgV.push('    <text x="' + bvx.toFixed(1) + '" y="' + (bvy - bvRad - 4).toFixed(1) +
              '" font-family="' + fonts.value + '" font-size="' + rs.valueSize +
              '" fill="' + st.valueColor + '" text-anchor="middle" font-weight="bold">' +
              R.formatNumber(bubbles[bv].size, config.numFmt) + '</text>');
          }
        }

        // Label right of bubble
        svgV.push('    <text x="' + (bvx + bvRad + 8).toFixed(1) + '" y="' + (bvy + rs.labelSize * 0.35).toFixed(1) +
          '" font-family="' + fonts.label + '" font-size="' + rs.labelSize +
          '" fill="' + st.labelColor + '" text-anchor="start">' +
          R.escapeXml(R.truncate(bubbles[bv].label, rs.maxLabelChars)) + '</text>');
      }

      svgV.push('  </g>');
      for (var fiv = 0; fiv < footerV.svg.length; fiv++) svgV.push(footerV.svg[fiv]);
      svgV.push('</svg>');
      return svgV.join("\n");
    }
  }

  R.register("bubble", "Bubble Chart", render);
})();
