/**
 * Icon Chart Renderer (pictogram / isotype)
 *
 * Per-row model: each data row = one group of identical icons.
 * Row icon shape comes from config.rowIcons[rowIndex] (default: config.iconShape).
 * Row color comes from config.colors[rowIndex].
 * Value = number of icons to draw for that row.
 */

/* global ChartRegistry, IconLibrary, DataStore, Connector */

(function () {
  "use strict";

  var R = ChartRegistry;

  // ── Built-in icon paths ───────────────────────────────

  var BUILT_IN = {
    man: {
      viewBox: [0, 0, 26, 48],
      svg: '<path d="M13,10C5.46,10,0,15.05,0,22a2,2,0,0,0,4,0,7.4,7.4,0,0,1,5-7L5,34a.92.92,0,0,0,1,1H8V46a2,2,0,0,0,4,0V35h2V46a2,2,0,1,0,4,0V35h2a.92.92,0,0,0,1-1L17,15a7.53,7.53,0,0,1,5,7,2,2,0,0,0,4,0C26,15.05,20.53,10,13,10Z"/><circle cx="12.99" cy="4" r="4"/>'
    },
    woman: {
      viewBox: [0, 0, 26, 48],
      svg: '<path d="M12.99121,10C5.46387,10,0,15.04688,0,22a2,2,0,0,0,4,0,7.84807,7.84807,0,0,1,3.99121-7V46a2,2,0,0,0,4,0V31h2V46a2,2,0,1,0,4,0V14.9986A7.84744,7.84744,0,0,1,21.9873,22a2,2,0,0,0,4,0C25.9873,15.04688,20.52148,10,12.99121,10Z"/><circle cx="12.99121" cy="4" r="4"/>'
    }
  };

  BUILT_IN.people = {
    viewBox: [0, 0, 58, 48],
    svg: BUILT_IN.man.svg + '<g transform="translate(32,0)">' + BUILT_IN.woman.svg + '</g>'
  };

  // icons-cache folder for the full OCHA icon set ("" when unknown)
  var _iconsCacheDir = (typeof Connector !== "undefined" && Connector.paths.icons) || "";

  /**
   * Resolve icon shape to { viewBox: [x,y,w,h], svg: string }
   */
  function resolveIcon(shape) {
    if (BUILT_IN[shape]) return BUILT_IN[shape];
    if (shape === "dot") {
      return { viewBox: [0, 0, 20, 20], svg: '<circle cx="10" cy="10" r="9"/>' };
    }
    if (shape === "square") {
      return { viewBox: [0, 0, 20, 20], svg: '<rect width="20" height="20" rx="2"/>' };
    }
    // Curated IconLibrary
    if (typeof IconLibrary !== "undefined") {
      var libIcon = IconLibrary.get(shape);
      if (libIcon) {
        var vb = libIcon.viewBox.split(/\s+/).map(Number);
        return { viewBox: vb, svg: libIcon.svg };
      }
    }
    // Full OCHA icon set from icons-cache on disk
    if (_iconsCacheDir) {
      try {
        var svgContent = Connector.fs.readText(_iconsCacheDir + "/" + shape + ".svg");
        if (svgContent) {
          var vbMatch = svgContent.match(/viewBox="([^"]+)"/);
          var vbArr = vbMatch ? vbMatch[1].split(/[\s,]+/).map(Number) : [0, 0, 24, 24];
          var inner = svgContent.replace(/<\?xml[^>]*\?>/g, "")
            .replace(/<svg[^>]*>/, "").replace(/<\/svg>/, "").trim();
          return { viewBox: vbArr, svg: inner };
        }
      } catch (e) { /* file not found */ }
    }
    return { viewBox: [0, 0, 20, 20], svg: '<circle cx="10" cy="10" r="9"/>' };
  }

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    var iconSize = config.iconSize || 20;
    var defaultShape = config.iconShape || "people";
    var rowIcons = config.rowIcons || null; // per-row icon shapes
    // Flush-left: first icon's left edge at x=0
    var marginLeft = 0;
    var marginRight = rs.marginRight * 0.5;

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
    var plotWidth = svgW - marginLeft - marginRight;

    // Resolve per-row icons
    var rowCount = data.length;
    var resolvedIcons = [];
    for (var ri = 0; ri < rowCount; ri++) {
      var shape = (rowIcons && rowIcons[ri]) ? rowIcons[ri] : defaultShape;
      resolvedIcons.push(resolveIcon(shape));
    }

    // Cell sizing: use the widest icon across all rows
    var maxCellW = 0;
    for (var mw = 0; mw < resolvedIcons.length; mw++) {
      var sVbW = resolvedIcons[mw].viewBox[2] || 20;
      var sVbH = resolvedIcons[mw].viewBox[3] || 20;
      var sCellW = sVbW * (iconSize / sVbH);
      if (sCellW > maxCellW) maxCellW = sCellW;
    }
    var cellW = maxCellW;
    var cellH = iconSize;
    var gap = iconSize * 0.25 * vPad;
    var iconsPerRow = Math.max(1, Math.floor(plotWidth / (cellW + gap)));

    // Build flat icon array: [{color, rowIdx}]
    // Each data row has a single value (sum of values array)
    var icons = [];
    for (var d = 0; d < data.length; d++) {
      var rowVal = 0;
      if (data[d].values) {
        for (var v = 0; v < data[d].values.length; v++) {
          rowVal += Math.abs(data[d].values[v]);
        }
      } else if (data[d].value != null) {
        rowVal = Math.abs(data[d].value);
      }
      var count = Math.round(rowVal);
      var color = config.colors[d % config.colors.length];
      for (var c = 0; c < count; c++) {
        icons.push({ color: color, row: d });
      }
    }

    var totalIcons = icons.length;
    if (totalIcons === 0) return null;

    var gridRows = Math.ceil(totalIcons / iconsPerRow);
    var gridH = gridRows * (cellH + gap) - gap;

    // Legend below grid
    var showLegend = config.iconShowLegend !== false;
    var legendLayout = config.iconLegendLayout || "horizontal";
    var legendY = plotTop + gridH + Math.round(12 * vPad);
    var legendSvg = [];
    var legendH = 0;

    // Legend names: custom labels > row labels from data
    var legendNames = [];
    var customLabels = config.iconLegendLabels;
    for (var ln = 0; ln < data.length; ln++) {
      var defaultName = data[ln].label || ("Row " + (ln + 1));
      legendNames.push((customLabels && customLabels[ln]) ? customLabels[ln] : defaultName);
    }

    if (showLegend && legendNames.length > 0) {
      var swatchSize = rs.legendSwatchW || 10;
      var lgap = rs.legendGap || 5;
      var lFontSize = rs.legendSize || 9;

      function legendSwatch(sx, sy, rIdx, sSize) {
        var lColor = config.colors[rIdx % config.colors.length];
        var rIcon = resolvedIcons[rIdx % resolvedIcons.length];
        var rVbH = rIcon.viewBox[3] || 20;
        var rVbW = rIcon.viewBox[2] || 20;
        var lScale = sSize / rVbH;
        var lW = rVbW * lScale;
        var lXoff = (sSize - lW) / 2;
        return '<g transform="translate(' + (sx + lXoff).toFixed(1) + ',' + sy.toFixed(1) +
          ') scale(' + lScale.toFixed(4) + ')" fill="' + lColor + '">' + rIcon.svg + '</g>';
      }

      if (legendLayout === "vertical") {
        var lineH = swatchSize + lgap;
        for (var li = 0; li < legendNames.length; li++) {
          var ly = legendY + li * lineH;
          legendSvg.push('  ' + legendSwatch(marginLeft, ly, li, swatchSize));
          legendSvg.push('  <text x="' + (marginLeft + swatchSize + lgap) + '" y="' +
            (ly + swatchSize * 0.8) +
            '" font-family="' + fonts.label + '" font-size="' + lFontSize +
            '" fill="' + st.labelColor + '">' + R.escapeXml(legendNames[li]) + '</text>');
        }
        legendH = legendNames.length * lineH + Math.round(4 * vPad);
      } else {
        var lx = marginLeft;
        for (var li3 = 0; li3 < legendNames.length; li3++) {
          legendSvg.push('  ' + legendSwatch(lx, legendY, li3, swatchSize));
          legendSvg.push('  <text x="' + (lx + swatchSize + lgap) + '" y="' +
            (legendY + swatchSize * 0.8) +
            '" font-family="' + fonts.label + '" font-size="' + lFontSize +
            '" fill="' + st.labelColor + '">' + R.escapeXml(legendNames[li3]) + '</text>');
          // Legend text renders in fonts.label (Roboto Condensed)
          lx += swatchSize + lgap + legendNames[li3].length * lFontSize * R.LABEL_ADVANCE + lgap * 3;
        }
        legendH = swatchSize + Math.round(8 * vPad);
      }
    }

    // Footer — gap added by computeFooterStart only when footer has text.
    // Plot bottom = plotTop + gridH + legendH (the icon grid + optional legend).
    var footerStartY = R.computeFooterStart(rs, plotTop + gridH + legendH, !!config.footer);
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

    // ── Build SVG ────────────────────────────────────
    var svg = [];
    svg.push(R.svgOpen(svgW, svgH));
    svg.push(R.svgBg(svgW, svgH));

    for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);

    svg.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    for (var i = 0; i < totalIcons; i++) {
      var col = i % iconsPerRow;
      var row = Math.floor(i / iconsPerRow);
      var x = col * (cellW + gap);
      var y = row * (cellH + gap);

      var ic = icons[i];
      var rIcon = resolvedIcons[ic.row % resolvedIcons.length];
      var rVbH = rIcon.viewBox[3] || 20;
      var rVbW = rIcon.viewBox[2] || 20;
      var rScale = iconSize / rVbH;
      var rW = rVbW * rScale;
      var xOff = (cellW - rW) / 2;

      svg.push('    <g transform="translate(' + (x + xOff).toFixed(2) + ',' + y.toFixed(2) +
        ') scale(' + rScale.toFixed(4) + ')" fill="' + ic.color + '">' +
        rIcon.svg + '</g>');
    }

    svg.push('  </g>');

    for (var lsi = 0; lsi < legendSvg.length; lsi++) svg.push(legendSvg[lsi]);
    for (var fi = 0; fi < footer.svg.length; fi++) svg.push(footer.svg[fi]);

    svg.push('</svg>');
    return svg.join("\n");
  }

  R.register("icon", "Icon Chart", render);
})();
