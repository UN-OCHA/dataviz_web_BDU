/**
 * Data Table Renderer
 *
 * Renders a styled SVG data table directly from DataStore.headers and
 * DataStore.rows (no label/value abstraction). Alternating row
 * colours, brand-coloured header row, column widths sized to the
 * widest cell content with text wrapping inside cells. Optional
 * inline icon/flag in the first column.
 */

/* global ChartRegistry, DataStore */

(function () {
  "use strict";

  var R = ChartRegistry;

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    // Flush-left: table starts at x=0, aligned with title
    var marginLeft = 0;
    var marginRight = 10;

    // Header text block
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

    var tableTop = R.computePlotTop(rs, header);

    // Read full data from DataStore for table rendering
    var headers = DataStore.headers || ["Label", "Value"];
    var rows = DataStore.rows || [];

    if (!rows.length) return null;

    var colCount = headers.length;
    var tableWidth = svgW - marginLeft - marginRight;
    var dataColWidth = tableWidth / colCount;

    // Icon detection (picker-based: icon inside first cell)
    var hasIcons = config.iconColType && config.iconColType !== "none" && config.iconSvgMap;
    var iconSvgMap = hasIcons ? config.iconSvgMap : {};
    var iconSelections = (hasIcons && config.iconSelections) ? config.iconSelections : [];

    // Row dimensions
    var fontSize = rs.labelSize;
    var isFlags = config.iconColType === "flags";
    var iconNorm = hasIcons ? (isFlags ? 1.5 : 1.0) : false;
    var headerFontSize = Math.max(8, fontSize + 1);
    var rowHeight = Math.round(Math.max(20, fontSize * 2.2) * vPad);
    var headerRowH = Math.round(Math.max(24, headerFontSize * 2.4) * vPad);
    var cellPadX = 8;

    // Icon size proportional to font
    var iconH = hasIcons ? Math.round(fontSize * 1.3) : 0;
    var iconMarginR = 8; // margin right of icon before label text

    // Pre-compute fixed text offset for first column (max icon width across all rows)
    var fixedIconOffset = 0;
    if (hasIcons) {
      for (var fi = 0; fi < rows.length; fi++) {
        var fiRef = iconSelections[fi];
        if (fiRef && iconSvgMap[fiRef]) {
          var fiDims = R.getIconDims(iconSvgMap[fiRef], iconH, iconNorm);
          if (fiDims.w > fixedIconOffset) fixedIconOffset = fiDims.w;
        }
      }
      if (fixedIconOffset > 0) fixedIconOffset += iconMarginR;
    }

    // Pre-wrap every cell. Each cell wraps to up to 3 lines that fit
    // within the column's available width. Row height grows to match
    // the tallest wrapped cell in that row — same idea as Excel's
    // "Wrap Text" cell formatting. No more silent ellipsis truncation;
    // long text spills into additional lines and the row gets taller.
    var cellLineH = Math.round(fontSize * 1.25);
    var cellPadY = 6; // top + bottom padding inside each cell
    var minCellH = rowHeight; // single-line default
    var wrappedCells = [];   // [row][col] = wrapToFit result
    var rowHeights = [];
    var truncCount = 0;
    for (var rr = 0; rr < rows.length; rr++) {
      var rowWraps = [];
      var maxLines = 1;
      for (var ccr = 0; ccr < colCount; ccr++) {
        var cellVal = rows[rr][ccr];
        if (cellVal == null) cellVal = "";
        var cellAvailW = dataColWidth - cellPadX * 2 - (ccr === 0 ? fixedIconOffset : 0);
        var w = R.wrapToFit(String(cellVal), fontSize, cellAvailW, 3, R.LABEL_ADVANCE);
        rowWraps.push(w);
        if (!w.fits) truncCount++;
        if (w.lines.length > maxLines) maxLines = w.lines.length;
      }
      wrappedCells.push(rowWraps);
      rowHeights.push(Math.max(minCellH, maxLines * cellLineH + cellPadY * 2));
    }
    if (truncCount > 0) {
      R.pushWarning("label-truncated", { count: truncCount,
        suggestion: "Try a wider chart, fewer columns, or shorter cell text" });
    }

    // Table height = header row + sum of per-row heights (variable).
    var tableH = headerRowH;
    for (var rh = 0; rh < rowHeights.length; rh++) tableH += rowHeights[rh];

    // Footer — gap added by computeFooterStart only when footer has text
    var footerStartY = R.computeFooterStart(rs, tableTop + tableH, !!config.footer);
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
      ? Math.max(config.height, footerStartY + footer.height + rs.marginBottom)  // request, but never clip content
      : (footerStartY + footer.height + rs.marginBottom);

    var svg = [];
    svg.push(R.svgOpen(svgW, svgH));
    svg.push(R.svgBg(svgW, svgH));

    for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);

    // Table group
    svg.push('  <g transform="translate(' + marginLeft + ',' + tableTop + ')">');

    // Header row background
    svg.push('    <rect x="0" y="0" width="' + tableWidth + '" height="' + headerRowH +
      '" fill="' + (config.colors[0] || '#009EDB') + '"/>');

    // Header text
    for (var c = 0; c < colCount; c++) {
      var hx = c * dataColWidth + cellPadX;
      svg.push('    <text x="' + hx + '" y="' + (headerRowH / 2 + headerFontSize * 0.35) +
        '" font-family="' + fonts.heading + '" font-size="' + headerFontSize +
        '" font-weight="bold" fill="#ffffff">' + R.escapeXml(headers[c]) + '</text>');
    }

    // Data rows — per-row heights based on the tallest wrapped cell
    var ryAccum = headerRowH;
    for (var r = 0; r < rows.length; r++) {
      var ry = ryAccum;
      var thisRowH = rowHeights[r];
      ryAccum += thisRowH;
      var isOdd = r % 2 === 1;

      // Alternating row bg
      if (isOdd) {
        svg.push('    <rect x="0" y="' + ry + '" width="' + tableWidth +
          '" height="' + thisRowH + '" fill="#f5f5f5"/>');
      }

      // Row border
      svg.push('    <line x1="0" y1="' + (ry + thisRowH) + '" x2="' + tableWidth +
        '" y2="' + (ry + thisRowH) + '" stroke="' + st.gridColor + '" stroke-width="0.5"/>');

      // Icon inside first cell (left-aligned with margin)
      if (hasIcons && iconSelections[r]) {
        var icoRef = iconSelections[r];
        var resolved = iconSvgMap[icoRef];
        if (resolved) {
          var dims = R.getIconDims(resolved, iconH, iconNorm);
          var icoX = cellPadX;
          var icoY = ry + (thisRowH - dims.h) / 2;
          var icoColor = !isFlags ? (config.rowIconColor || "#009EDB") : null;
          svg.push('    ' + R.buildIconGroup(resolved, iconH, icoX, icoY, icoColor, iconNorm));
        }
      }

      // Cell values — multi-line wrapped, vertically centred in the row
      for (var cc = 0; cc < colCount; cc++) {
        var val = rows[r][cc];
        if (val == null) val = "";
        var cellX = cc * dataColWidth + cellPadX;
        if (cc === 0 && fixedIconOffset > 0) cellX += fixedIconOffset;
        var wrap = wrappedCells[r][cc];
        var lines = wrap.lines.length ? wrap.lines : [""];
        var cellColor = wrap.truncated ? R.FADED_LABEL_COLOR : st.valueColor;
        var blockH = (lines.length - 1) * cellLineH;
        // Vertical centre of cell, then offset upward by half blockH
        var firstBaselineY = ry + thisRowH / 2 - blockH / 2 + fontSize * 0.35;

        var isNum = (typeof val === "number" || (typeof val === "string" && !isNaN(Number(val)) && val !== ""));
        var textAnchor = isNum ? "end" : "start";
        var textX = isNum ? ((cc + 1) * dataColWidth - cellPadX) : cellX;

        for (var ln = 0; ln < lines.length; ln++) {
          svg.push('    <text x="' + textX + '" y="' + (firstBaselineY + ln * cellLineH).toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + fontSize +
            '" fill="' + cellColor + '" text-anchor="' + textAnchor + '">' +
            R.escapeXml(lines[ln]) + '</text>');
        }
      }
    }

    // Outer border
    svg.push('    <rect x="0" y="0" width="' + tableWidth + '" height="' + tableH +
      '" fill="none" stroke="' + st.gridColor + '" stroke-width="1"/>');

    // Column separators
    for (var cs = 1; cs < colCount; cs++) {
      var csx = cs * dataColWidth;
      svg.push('    <line x1="' + csx + '" y1="0" x2="' + csx + '" y2="' + tableH +
        '" stroke="' + st.gridColor + '" stroke-width="0.5"/>');
    }

    svg.push('  </g>');

    for (var fi = 0; fi < footer.svg.length; fi++) svg.push(footer.svg[fi]);

    svg.push('</svg>');
    return svg.join("\n");
  }

  R.register("table", "Data Table", render);
})();
