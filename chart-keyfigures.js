/**
 * Key Figures Chart Renderer
 *
 * Renders a responsive grid of key figure units, each showing:
 *   icon | key figure (large number)
 *        | heading (medium text)
 *        | body (small text)
 *
 * Auto-flow layout adapts columns to width (like CSS flexbox).
 * Icons can be placed left or right of the text.
 * Vertical separator lines between columns (toggleable).
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    var iconPos       = config.iconPosition || "left";
    var showSeps      = config.showSeparators !== false;
    var padH          = config.unitPaddingH != null ? config.unitPaddingH : 12;
    var padV          = config.unitPaddingV != null ? config.unitPaddingV : 10;
    var unitGap       = config.unitGap != null ? config.unitGap : 8;
    var textColor     = config.textColor || "#000000";
    var iconColor     = config.iconColor || (config.colors && config.colors[0]) || "#009EDB";

    // Flush-left: first cell sits at x=0 (no centering, no gutter)
    var marginLeft  = 0;
    var marginRight = rs.marginRight || 10;

    // ── Font sizes (scaled from responsive settings)
    var figureSize  = Math.round(rs.titleSize * 1.4);   // large bold number
    var headingSize = Math.round(rs.labelSize * 1.0);    // medium heading
    var bodySize    = Math.round(rs.labelSize * 0.85);   // small body

    // ── Icon dimensions
    var hasIcons = false;
    for (var ic = 0; ic < data.length; ic++) {
      if (data[ic]._iconSvg) { hasIcons = true; break; }
    }
    var isFlags = config.iconColType === "flags";
    var iconH   = Math.min(Math.round(figureSize * 1.1), 40);
    var iconW   = isFlags ? Math.round(iconH * 1.5) : iconH;
    var iconGap = hasIcons ? (isFlags ? 10 : 8) : 0;
    var iconColW = hasIcons ? (iconW + iconGap) : 0;

    // ── Header
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

    var gridTop = R.computePlotTop(rs, header);

    // ── Auto-layout grid (Figma-style: content-first sizing)
    var availW = svgW - marginLeft - marginRight;
    var sepW = showSeps ? 1 : 0;

    var headLineH = Math.round(headingSize * 1.15);
    var bodyLineH = Math.round(bodySize * 1.4);

    // Unit width: distribute available space evenly across columns
    // Determine columns — auto (responsive) or user-set
    var numCols;
    if (config.kfAutoCols !== false) {
      if (availW <= 200)      numCols = 1;
      else if (availW <= 400) numCols = 2;
      else if (availW <= 600) numCols = 3;
      else                    numCols = Math.min(4, data.length);
    } else {
      numCols = config.kfMaxCols || 3;
    }
    if (numCols > data.length) numCols = data.length;
    if (numCols < 1) numCols = 1;

    // Cell width — content-driven (Auto) or fixed (Manual).
    //
    // Auto mode (default): each cell is just wide enough to fit its
    // widest content (the figure, in practice — headings and body
    // wrap). The minimum is 120 px so cells don't collapse for tiny
    // single-character figures. Cells pack from x=0; the right side
    // of the canvas stays empty when there are few cells. With many
    // cells, the natural width is capped to fit the canvas.
    //
    // Manual mode (kfAutoWidth=false): user picks cellW directly via
    // the slider; the renderer respects it verbatim.
    var totalGapSpace = (numCols - 1) * (unitGap + sepW);
    var cellW;
    if (config.kfAutoWidth !== false) {
      // Find the widest figure across all cells (figures use
      // fonts.heading bold; the heading and body wrap within cellW).
      var maxFigW = 0;
      for (var fi = 0; fi < data.length; fi++) {
        var fStr = typeof data[fi].value === "number"
          ? R.formatNumber(data[fi].value, config.numFmt)
          : String(data[fi].value || "");
        var w = fStr.length * figureSize * R.HEADING_BOLD_ADVANCE;
        if (w > maxFigW) maxFigW = w;
      }
      var idealCellW = Math.max(120, Math.ceil(maxFigW + padH * 2 + iconColW));
      // Cap at canvas-fit so cells never overflow when there are many
      var stretchCellW = Math.floor((availW - totalGapSpace) / numCols);
      cellW = Math.min(idealCellW, stretchCellW);
    } else {
      cellW = config.kfColWidth || 150;
    }

    // Flush-left: first cell at x=0, no centering offset.
    var gridOffsetX = 0;

    var numRows = Math.ceil(data.length / numCols);

    // Text area width (within a cell, excluding icon and padding)
    var textAreaW = cellW - padH * 2 - iconColW;

    // Step 4: Calculate uniform cell height from tallest content
    // All text wraps within textAreaW — find tallest unit
    var figLineH2 = Math.round(figureSize * 1.15);
    var maxContentH = 0;
    for (var hi2 = 0; hi2 < data.length; hi2++) {
      var h = 0;
      // Key figure (may wrap)
      var figStr = typeof data[hi2].value === "number" ? R.formatNumber(data[hi2].value, config.numFmt) : String(data[hi2].value || "");
      // Figure: bold Roboto regular (fonts.heading)
      var fLines = R.wrapText ? R.wrapText(figStr, figureSize, textAreaW, R.HEADING_BOLD_ADVANCE).length : 1;
      h += figureSize + (fLines - 1) * figLineH2;
      // Gap + heading
      h += Math.round(headingSize * 0.4);
      // Heading: Roboto Condensed (fonts.label)
      var hLines = R.wrapText ? R.wrapText(data[hi2].label || "", headingSize, textAreaW, R.LABEL_ADVANCE).length : 1;
      h += hLines * headLineH;
      // Gap + body
      if (data[hi2].body) {
        h += Math.round(bodySize * 0.3);
        // Body: Roboto Condensed (fonts.label)
        var bLines = R.wrapText ? R.wrapText(data[hi2].body, bodySize, textAreaW, R.LABEL_ADVANCE).length : 1;
        h += bLines * bodyLineH;
      }
      if (h > maxContentH) maxContentH = h;
    }

    var cellH = maxContentH + padV * 2;

    // Ensure icon fits vertically
    if (hasIcons && cellH < iconH + padV * 2) {
      cellH = iconH + padV * 2;
    }

    // ── Build SVG body
    // Shift the grid LEFT by padH so the first cell's text content
    // (which is inset by padH inside its cell) lines up with x=0,
    // perceptually flush with the title.
    var body = [];
    body.push('  <g transform="translate(' + (marginLeft + gridOffsetX - padH) + ',' + gridTop + ')">');

    for (var i = 0; i < data.length; i++) {
      var col = i % numCols;
      var row = Math.floor(i / numCols);

      var cellX = col * (cellW + unitGap + sepW); // each col = cell + gap + sep line
      var cellY = row * (cellH + unitGap);

      var d = data[i];
      var figText = typeof d.value === "number" ? R.formatNumber(d.value, config.numFmt) : String(d.value || "");
      var headText = d.label || "";
      var bodyText = d.body || "";

      body.push('    <g transform="translate(' + cellX + ',' + cellY + ')">');

      // ── Determine text and icon X positions
      var textX, icoX;
      var hasThisIcon = hasIcons && d._iconSvg;
      var wrapW = hasThisIcon ? textAreaW : (cellW - padH * 2);

      // Layout: icon and text sit side by side within the card
      // The icon column takes a fixed width, text fills the rest
      // Right mode mirrors the order but keeps the same spacing
      if (hasThisIcon) {
        if (iconPos === "right") {
          textX = padH;
          icoX = cellW - padH - iconW; // flush with right padding
          // Constrain text wrap width so text doesn't overlap icon
          wrapW = cellW - padH * 2 - iconColW;
        } else {
          icoX = padH;
          textX = padH + iconColW;
        }
      } else {
        textX = padH;
      }

      // ── Render text block
      var figLineH = Math.round(figureSize * 1.15);
      var ty = padV;

      // Key figure (large, bold, wrapped)
      var figWrapped = R.wrapText ? R.wrapText(figText, figureSize, wrapW, R.HEADING_BOLD_ADVANCE) : [figText];
      for (var fwi = 0; fwi < figWrapped.length; fwi++) {
        ty += (fwi === 0) ? figureSize : figLineH;
        body.push('      <text x="' + textX + '" y="' + ty +
          '" font-family="' + fonts.heading + '" font-size="' + figureSize +
          '" font-weight="bold" fill="' + textColor + '">' +
          R.escapeXml(figWrapped[fwi]) + '</text>');
      }

      // Heading (wrapped)
      ty += Math.round(headingSize * 0.4);
      var headWrapped = R.wrapText ? R.wrapText(headText, headingSize, wrapW, R.LABEL_ADVANCE) : [headText];
      for (var hwi = 0; hwi < headWrapped.length; hwi++) {
        ty += headLineH;
        body.push('      <text x="' + textX + '" y="' + ty +
          '" font-family="' + fonts.label + '" font-size="' + headingSize +
          '" font-weight="600" fill="' + textColor + '">' +
          R.escapeXml(headWrapped[hwi]) + '</text>');
      }

      // Body (wrapped)
      if (bodyText) {
        ty += Math.round(bodySize * 0.3);
        var bodyWrapped = R.wrapText ? R.wrapText(bodyText, bodySize, wrapW, R.LABEL_ADVANCE) : [bodyText];
        for (var bwi = 0; bwi < bodyWrapped.length; bwi++) {
          ty += bodyLineH;
          body.push('      <text x="' + textX + '" y="' + ty +
            '" font-family="' + fonts.label + '" font-size="' + bodySize +
            '" fill="' + textColor + '" opacity="0.7">' +
            R.escapeXml(bodyWrapped[bwi]) + '</text>');
        }
      }

      // ── Icon (vertically centered in cell)
      if (hasThisIcon) {
        var icoY = padV;
        var icoColor = isFlags ? null : (d._iconColor || iconColor);
        body.push('      ' + R.buildIconGroup(d._iconSvg, iconH, icoX, icoY, icoColor, isFlags ? 1.5 : 1.0));
      }

      body.push('    </g>');

      // Vertical separator (exactly centered between this cell's right edge and next cell's left edge)
      if (showSeps && col < numCols - 1) {
        var nextCellX = (col + 1) * (cellW + unitGap + sepW);
        var sepX = (cellX + cellW + nextCellX) / 2;
        body.push('    <line x1="' + sepX.toFixed(1) + '" y1="' + cellY +
          '" x2="' + sepX.toFixed(1) + '" y2="' + (cellY + cellH) +
          '" stroke="#C7C8CA" stroke-width="0.5"/>');
      }
    }

    body.push('  </g>');

    // ── Footer (gap added by computeFooterStart only when footer has text)
    var gridH = numRows * cellH + (numRows - 1) * unitGap;
    var footerStartY = R.computeFooterStart(rs, gridTop + gridH, !!config.footer);
    var footer = R.renderFooter({
      x: 0,
      startY: footerStartY,
      footer: config.footer,
      rs: rs,
      style: st,
      vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });

    for (var fi = 0; fi < footer.svg.length; fi++) body.push(footer.svg[fi]);

    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height + rs.marginBottom)  // request, but never clip content
      : (footerStartY + footer.height + rs.marginBottom);

    return R.wrapSVG(svgW, svgH, header, { svg: [], height: 0 }, body);
  }

  R.register("keyfigures", "Key Figures", render);
})();
