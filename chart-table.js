/**
 * Data Table Renderer — an "enhanced table" in the spirit of Datawrapper's
 * tables, kept deliberately small.
 *
 * Renders an SVG table directly from DataStore.headers and DataStore.rows
 * (no label/value abstraction). Optional inline icon/flag in the first
 * column.
 *
 * Two looks (config.tableStyle):
 *   • "classic" (default) — brand-coloured header band, alternating row
 *     colours, full grid. Equal column widths unless bars are on.
 *   • "minimal" — report look (HNRP "At a glance", cluster pages): no
 *     fills, dark header text with a rule under it, dotted row rules,
 *     compact padding, table runs the full chart width.
 *
 * Options (all off by default; a table that uses none of them renders
 * exactly as before):
 *   • tableBarCols        — column indexes drawn as value + small bar.
 *                           Bars are proportional within each column (or
 *                           within a column group, see tableColGroups) and
 *                           every bar column has the same bar length, so
 *                           columns compare fairly. Non-numeric cells
 *                           ("–", "—", empty, text) show no bar;
 *                           placeholder text made of X's ("X.X", "$X.XM")
 *                           shows a fixed-length placeholder bar.
 *   • tableBarLabel       — "above" (value over its bar, default) |
 *                           "beside" (value, then bar).
 *   • tableBarColors      — { colIndex: hex } colour per column.
 *   • tableBarColorBy     — "single" (default: every bar one colour) |
 *                           "column" | "row". A table saved with column
 *                           colours but no mode reads as "column".
 *   • tableBarColor       — the single colour; missing = style main colour.
 *   • tableRowColors      — { firstColumnLabel: hex } when colouring by row.
 *   • tableBarTrackCols   — bar columns with a light grey 100% track (a
 *                           column whose values are all ≤ 100 is scaled to
 *                           100 (percentages), otherwise to its maximum.
 *   • tableColAlign       — { colIndex: "left" | "center" | "right" };
 *                           missing = auto (numbers right, text left).
 *   • tableColBold        — column indexes in bold.
 *   • tableColWidths      — { colIndex: % of the table width }; missing =
 *                           automatic (fits the content).
 *   • tableRowBold        — first-column labels of rows in bold (a Total).
 *   • tableRowHighlight   — first-column labels of rows on a light tint of
 *                           the style colour.
 *   • tableColGroups      — { colIndex: "Group name" }; neighbouring
 *                           columns with the same name share one heading
 *                           above the column headers.
 *   • tableColItalic      — column indexes in italics (e.g. cluster names).
 *   • tableDividers       — column indexes AFTER which a vertical divider
 *                           separates column groups.
 *   • Data convention: a row whose cells are only "---" draws a
 *     horizontal separator line instead of a row.
 *
 * Bar-column numbers go through the Value Format settings (number format,
 * prefix, suffix), so 42 + suffix "%" shows "42%". Text cells ("5.1M",
 * "$1.2B") show exactly as typed and their bar length is read from the
 * text.
 */

/* global ChartRegistry, DataStore */

(function () {
  "use strict";

  var R = ChartRegistry;

  // Light grey of the 100% track (OCHA neutral grey ramp, step 6).
  var TRACK_COLOR = "#E6E6E6";
  // Minimal look: dotted row rules and the column-group divider.
  var MINIMAL_RULE_COLOR = "#BFBFBF";
  // Share of the flag size a humanitarian icon gets in a table row (see iconH)
  var TABLE_ICON_ROOM = 0.85;
  var DIVIDER_COLOR = "#999999";
  // Placeholder cells ("X.X", "$X.XM") draw a bar this share of the bar
  // zone, so a template shows the design before real figures arrive.
  var PLACEHOLDER_BAR_RATIO = 0.5;

  // ── Cell readers ───────────────────────────────────────

  function cellText(v) { return v == null ? "" : String(v); }

  function isSeparatorRow(row) {
    if (!row || !row.length) return false;
    var sawDash = false;
    for (var i = 0; i < row.length; i++) {
      var s = cellText(row[i]).trim();
      if (!s) continue;
      if (!/^-{3,}$/.test(s)) return false;
      sawDash = true;
    }
    return sawDash;
  }

  // Strip the decorations around a figure: currency, "US$", %, spaces.
  function stripDecor(s) {
    return String(s).replace(/US\$/gi, "").replace(/[\s $€£¥%]/g, "");
  }

  // Read a cell as a number for bar length. Accepts real numbers and text
  // such as "5.1M", "$1.2B", "978.6k", "1,234", "42%". Returns NaN for
  // anything else (dashes, empty, words, placeholders).
  function readNumber(v) {
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    var s = stripDecor(cellText(v).trim());
    if (!s) return NaN;
    var m = /^([-+]?[\d.,]+)(k|m|b|bn)?$/i.exec(s);
    if (!m) return NaN;
    // One number reader for the whole tool (thousands vs decimal commas).
    var base = DataStore.coerceNumber(m[1]);
    if (typeof base !== "number" || !isFinite(base)) return NaN;
    var unit = (m[2] || "").toLowerCase();
    if (unit === "k") base *= 1e3;
    else if (unit === "m") base *= 1e6;
    else if (unit === "b" || unit === "bn") base *= 1e9;
    return base;
  }

  // "X.X", "$X.XM", "XX%", "X,XXX" — figures still to be filled in.
  function isPlaceholder(v) {
    if (typeof v === "number") return false;
    var s = stripDecor(cellText(v).trim());
    if (!s) return false;
    s = s.replace(/(k|m|b|bn)$/i, "");
    return /^[xX][xX.,]*$/.test(s);
  }

  // Figure-like cell: numbers, figure text, placeholders and the
  // not-applicable dashes. Right-aligned by default in the content layout.
  function looksNumeric(v) {
    if (!isNaN(readNumber(v)) || isPlaceholder(v)) return true;
    return /^[-–—]$/.test(cellText(v).trim());
  }

  function textW(text, fontSize, advance) {
    return cellText(text).length * fontSize * advance;
  }

  // Widest single word — the narrowest a wrapping column can get.
  function longestWordW(text, fontSize, advance) {
    var words = cellText(text).split(/\s+/);
    var w = 0;
    for (var i = 0; i < words.length; i++) {
      var ww = words[i].length * fontSize * advance;
      if (ww > w) w = ww;
    }
    return w;
  }

  function indexSet(list, lo, hi) {
    var out = {};
    var src = Array.isArray(list) ? list : [];
    for (var i = 0; i < src.length; i++) {
      var n = parseInt(src[i], 10);
      if (n >= lo && n <= hi) out[n] = true;
    }
    return out;
  }

  function labelSet(list) {
    var out = {};
    var src = Array.isArray(list) ? list : [];
    for (var i = 0; i < src.length; i++) out[cellText(src[i]).trim()] = true;
    return out;
  }

  // "single" | "column" | "row". Missing mode with column colours set
  // (older saves, AI output) means "column".
  function colorMode(config) {
    var m = config.tableBarColorBy;
    if (m === "row" || m === "column" || m === "single") return m;
    var bc = objOrEmpty(config.tableBarColors);
    for (var k in bc) { if (bc.hasOwnProperty(k)) return "column"; }
    return "single";
  }

  function objOrEmpty(o) { return (o && typeof o === "object" && !Array.isArray(o)) ? o : {}; }

  // Normalise the table options from config (indexes outside the table
  // are ignored, the first column never gets a bar).
  function readOptions(config, colCount) {
    var barCols = indexSet(config.tableBarCols, 1, colCount - 1);
    var barList = [];
    for (var c = 1; c < colCount; c++) if (barCols[c]) barList.push(c);
    var align = {};
    var srcAlign = objOrEmpty(config.tableColAlign);
    for (var k in srcAlign) {
      if (!srcAlign.hasOwnProperty(k)) continue;
      var a = srcAlign[k];
      if (a === "left" || a === "center" || a === "right") align[parseInt(k, 10)] = a;
    }
    var rowBold = labelSet(config.tableRowBold);
    // Fixed column widths, as % of the table width (1–100); missing = auto
    var widths = {};
    var wsrc = objOrEmpty(config.tableColWidths);
    for (var wk in wsrc) {
      if (!wsrc.hasOwnProperty(wk)) continue;
      var wc = parseInt(wk, 10), wp = Number(wsrc[wk]);
      if (wc >= 0 && wc < colCount && isFinite(wp) && wp > 0) widths[wc] = Math.min(100, wp);
    }
    var groups = [];
    var gsrc = objOrEmpty(config.tableColGroups);
    for (var g = 0; g < colCount; g++) {
      var name = cellText(gsrc[g]).trim();
      var last = groups.length ? groups[groups.length - 1] : null;
      if (name && last && last.name === name && last.to === g - 1) last.to = g;
      else if (name) groups.push({ name: name, from: g, to: g });
    }
    return {
      minimal: config.tableStyle === "minimal",
      barCols: barCols,
      barList: barList,
      barAbove: config.tableBarLabel !== "beside",
      barColors: objOrEmpty(config.tableBarColors),
      colorByRow: config.tableBarColorBy === "row",
      colorBy: colorMode(config),
      barColor: /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(cellText(config.tableBarColor)) ? config.tableBarColor : null,
      rowColors: objOrEmpty(config.tableRowColors),
      track: indexSet(config.tableBarTrackCols, 1, colCount - 1),
      rowHighlight: labelSet(config.tableRowHighlight),
      colItalic: indexSet(config.tableColItalic, 0, colCount - 1),
      dividers: indexSet(config.tableDividers, 0, colCount - 2),
      align: align,
      colBold: indexSet(config.tableColBold, 0, colCount - 1),
      rowBold: rowBold,
      groups: groups,
      widths: widths
    };
  }

  function render(title, data, config) {
    if (!data.length) return null;

    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    // Read full data from DataStore for table rendering
    var headers = DataStore.headers || ["Label", "Value"];
    var rows = DataStore.rows || [];

    if (!rows.length) return null;

    var colCount = headers.length;
    var opt = readOptions(config, colCount);
    var minimal = opt.minimal;
    var hasBars = opt.barList.length > 0;
    var hasWidths = false;
    for (var hw0 in opt.widths) { if (opt.widths.hasOwnProperty(hw0)) { hasWidths = true; break; } }
    // Content-driven column widths when bars are on, a column width is
    // set, or in the minimal look; the classic table keeps equal columns.
    var contentLayout = minimal || hasBars || hasWidths;

    // Flush-left: table starts at x=0, aligned with title. The minimal
    // look also runs to the right edge (fits a page grid slot exactly).
    var marginLeft = 0;
    var marginRight = minimal ? 0 : 10;

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

    // Rows to draw: "---" rows become a separator before the next row.
    var items = [];
    var pendingSep = false;
    for (var ir = 0; ir < rows.length; ir++) {
      if (isSeparatorRow(rows[ir])) { pendingSep = items.length > 0; continue; }
      items.push({ r: ir, sepBefore: pendingSep, label: cellText(rows[ir][0]).trim() });
      pendingSep = false;
    }
    if (!items.length) return null;

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
    var headerFontSize = minimal ? fontSize : Math.max(8, fontSize + 1);
    var rowHeight = minimal ? Math.round(fontSize * 1.9 * vPad)
                            : Math.round(Math.max(20, fontSize * 2.2) * vPad);
    var headerRowH = Math.round(Math.max(24, headerFontSize * 2.4) * vPad);
    var cellPadX = minimal ? Math.max(2, Math.round(fontSize * 0.5)) : 8;
    // Left padding of the first column: none in the minimal look, so the
    // first icon / label sits flush with the title at x=0.
    var firstPadL = minimal ? 0 : cellPadX;
    // Header text: minimal uses bold Roboto Condensed, estimated with the
    // regular-Roboto advance (bold condensed is a touch narrower, so the
    // estimate errs on the safe side). The same estimate serves bold cells.
    var headerFont = minimal ? fonts.value : fonts.heading;
    var headerAdvance = minimal ? R.HEADING_ADVANCE : R.HEADING_BOLD_ADVANCE;
    var boldAdvance = R.HEADING_ADVANCE;

    // Icon size proportional to font. Humanitarian icons are 15 % smaller
    // than flags so each row keeps some air around its icon (Javier,
    // 22 Oct 2026); getIconDims then balances them by ink.
    var iconH = !hasIcons ? 0 : isFlags ? Math.round(fontSize * 1.3) : fontSize * 1.3 * TABLE_ICON_ROOM;
    var iconMarginR = minimal ? Math.max(4, Math.round(fontSize * 0.6)) : 8; // margin right of icon before label text

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

    // Classic table with equal columns: when the chart is so narrow that a
    // header or a single word no longer fits its column (Width slider or
    // a placed table dragged small), switch to the content-driven layout,
    // which wraps headers, sizes columns to their text and warns when
    // something still can't fit. At normal widths nothing changes.
    var classicFallback = false;
    if (!contentLayout) {
      var eqAvail = dataColWidth - cellPadX * 2;
      for (var fc = 0; fc < colCount && !contentLayout; fc++) {
        if (textW(headers[fc], headerFontSize, headerAdvance) > eqAvail) { contentLayout = true; break; }
        var cAvail = eqAvail - (fc === 0 ? fixedIconOffset : 0);
        for (var fr = 0; fr < items.length; fr++) {
          if (longestWordW(cellText(rows[items[fr].r][fc]), fontSize, advOf(items[fr], fc)) > cAvail) { contentLayout = true; break; }
        }
      }
      classicFallback = contentLayout;
    }

    function isBold(item, c) { return !!(opt.colBold[c] || opt.rowBold[item.label]); }
    function advOf(item, c) { return isBold(item, c) ? boldAdvance : R.LABEL_ADVANCE; }

    // ── Bar columns: display text, scale and value width per column ──
    var numFmt = config.numFmt || {};
    var barGapX = Math.max(2, Math.round(fontSize * 0.4));
    var barH = Math.max(3, Math.round(fontSize * 0.55));
    var barGapY = Math.max(1, Math.round(fontSize * 0.25));   // value → bar, "above" layout
    var barInfo = {};          // col → { max, valueW, zone }
    for (var bi = 0; bi < opt.barList.length; bi++) {
      var bc = opt.barList[bi];
      var bMax = 0;
      var bAllPct = true;
      for (var bk = 0; bk < items.length; bk++) {
        var bn = readNumber(rows[items[bk].r][bc]);
        if (!isNaN(bn)) {
          if (bn > bMax) bMax = bn;
          if (bn > 100) bAllPct = false;
        }
      }
      if (opt.track[bc] && bAllPct) bMax = 100;
      barInfo[bc] = { max: bMax, valueW: 0, zone: 0 };
    }
    // Bar columns under one column-group heading (e.g. "Age": children,
    // adult, elderly) share one scale, so their bars compare directly.
    for (var sg = 0; sg < opt.groups.length; sg++) {
      var gMax = 0;
      for (var sc = opt.groups[sg].from; sc <= opt.groups[sg].to; sc++) {
        if (barInfo[sc] && barInfo[sc].max > gMax) gMax = barInfo[sc].max;
      }
      for (var sc2 = opt.groups[sg].from; sc2 <= opt.groups[sg].to; sc2++) {
        if (barInfo[sc2]) barInfo[sc2].max = gMax;
      }
    }

    // Text shown in a cell. Bar-column numbers follow Value Format.
    function displayText(r, c) {
      var v = rows[r][c];
      if (opt.barCols[c] && typeof v === "number") return R.formatNumber(v, numFmt);
      return cellText(v);
    }

    for (var vb = 0; vb < opt.barList.length; vb++) {
      var vc = opt.barList[vb];
      for (var vk = 0; vk < items.length; vk++) {
        var vw = textW(displayText(items[vk].r, vc), fontSize, advOf(items[vk], vc));
        if (vw > barInfo[vc].valueW) barInfo[vc].valueW = vw;
      }
      barInfo[vc].valueW = Math.ceil(barInfo[vc].valueW);
    }

    // ── Column positions ──
    // Classic without bars: equal columns (unchanged since the first
    // version). Otherwise widths follow the content. Every bar column
    // gets the SAME bar zone width, so a full-length bar means the same
    // thing in each column (percentages compare fairly across columns).
    // Spare room lengthens the bars (or, without bars, the data columns);
    // a too-narrow chart squeezes the first column, then the bars, then
    // the other columns. A column with a set width (% of the table) keeps
    // it; its bars use whatever room that width leaves.
    var colLeft = [];
    var colW = [];
    var squeezed = false;
    if (!contentLayout) {
      for (var ec = 0; ec < colCount; ec++) { colLeft.push(ec * dataColWidth); colW.push(dataColWidth); }
    } else {
      var nat = [], mins = [], fixedBar = [], floorW = [];
      var threeLineW = function (text, adv, size) {
        size = size || fontSize;
        var full = textW(text, size, adv);
        var lo = longestWordW(text, size, adv), hi = Math.max(lo, full);
        if (R.wrapToFit(cellText(text), size, lo + 0.5, 3, adv).fits) return lo;
        for (var it3 = 0; it3 < 20; it3++) {
          var mid = (lo + hi) / 2;
          if (R.wrapToFit(cellText(text), size, mid, 3, adv).fits) hi = mid; else lo = mid;
        }
        return hi + 0.5;
      };
      for (var cc0 = 0; cc0 < colCount; cc0++) {
        var padL = cc0 === 0 ? firstPadL : cellPadX;
        // +1 px so the character-count wrap never breaks a line that fits
        var hdrWord = threeLineW(headers[cc0], headerAdvance, headerFontSize) + padL + cellPadX + 1;
        var widest = 0, widestWord = 0;
        for (var ck = 0; ck < items.length; ck++) {
          var tx = displayText(items[ck].r, cc0);
          var adv = advOf(items[ck], cc0);
          var tw = textW(tx, fontSize, adv);
          if (tw > widest) widest = tw;
          // Narrowest width at which this cell still fits in 3 lines (the
          // wrap limit), so squeezing never pushes text into "…" while
          // other columns still have room to give.
          var tww = opt.barCols[cc0] ? longestWordW(tx, fontSize, adv) : threeLineW(tx, adv);
          if (tww > widestWord) widestWord = tww;
        }
        var extraL = (cc0 === 0 ? fixedIconOffset : 0) + padL + cellPadX + 1;
        if (opt.barCols[cc0]) {
          // Beside: value zone + gap + bar. Above: the bar spans the cell
          // and the value only sets a minimum width.
          fixedBar.push(opt.barAbove ? padL + cellPadX : padL + barInfo[cc0].valueW + barGapX + cellPadX);
          floorW.push(Math.max(hdrWord, opt.barAbove ? barInfo[cc0].valueW + padL + cellPadX + 1 : 0));
        } else {
          fixedBar.push(0);
          floorW.push(hdrWord);
        }
        nat.push(Math.max(widest + extraL, hdrWord));
        mins.push(Math.max(widestWord + extraL, hdrWord));
      }
      var isFixed = function (c) { return opt.widths.hasOwnProperty(c); };
      // Bar columns whose width follows the shared bar zone
      var autoBars = [];
      for (var ab = 0; ab < opt.barList.length; ab++) if (!isFixed(opt.barList[ab])) autoBars.push(opt.barList[ab]);
      var isAutoBar = {};
      for (var ab2 = 0; ab2 < autoBars.length; ab2++) isAutoBar[autoBars[ab2]] = true;
      // Width of the auto bar columns for a given bar zone z.
      var barColsW = function (z) {
        var t = 0;
        for (var b = 0; b < autoBars.length; b++) {
          var bc2 = autoBars[b];
          t += Math.max(fixedBar[bc2] + z, floorW[bc2]);
        }
        return t;
      };
      // The bar zone that makes the bar columns exactly `room` wide.
      var solveZone = function (room) {
        var lo = 0, hi = room;
        for (var it = 0; it < 40; it++) {
          var mid = (lo + hi) / 2;
          if (barColsW(mid) > room) hi = mid; else lo = mid;
        }
        return lo;
      };
      var zoneNat = fontSize * 3, zoneMin = fontSize * 0.75;
      var w = [];
      for (var w0 = 0; w0 < colCount; w0++) {
        w.push(isFixed(w0) ? tableWidth * opt.widths[w0] / 100 : (isAutoBar[w0] ? 0 : nat[w0]));
      }
      var otherSum = function () {
        var t = 0;
        for (var o = 0; o < colCount; o++) if (!isAutoBar[o]) t += w[o];
        return t;
      };
      var zone = zoneNat;
      if (otherSum() + barColsW(zoneNat) <= tableWidth) {
        if (autoBars.length) {
          zone = solveZone(tableWidth - otherSum());
        } else {
          // No auto bars: spare room goes to the auto-width data columns
          // (none left → the table ends short of the full width)
          var takers = [];
          for (var t1 = 0; t1 < colCount; t1++) if ((t1 > 0 || colCount === 1) && !isFixed(t1)) takers.push(t1);
          var spare = tableWidth - otherSum();
          for (var t2 = 0; t2 < takers.length; t2++) w[takers[t2]] += spare / takers.length;
        }
      } else {
        var over = otherSum() + barColsW(zoneNat) - tableWidth;
        // 1. first column: wrap labels, down to 2 lines' worth
        var two0 = isFixed(0) ? w[0] : Math.max(mins[0], Math.min(w[0], (nat[0] + mins[0]) / 2));
        var give0 = Math.min(over, w[0] - two0);
        if (give0 > 0) { w[0] -= give0; over -= give0; }
        // 2. shorter bars, down to a minimum
        if (autoBars.length && over > 0.01) {
          var zoneFloorW = barColsW(zoneMin);
          var barRoom = Math.max(zoneFloorW, barColsW(zoneNat) - over);
          over -= barColsW(zoneNat) - barRoom;
          zone = barRoom > zoneFloorW ? solveZone(barRoom) : zoneMin;
        }
        // 3. text columns (first column included) down to the width where
        //    their text still fits in 3 lines, proportionally to their slack
        if (over > 0.01) {
          var slack = 0;
          for (var p1 = 0; p1 < colCount; p1++) if (!opt.barCols[p1] && !isFixed(p1)) slack += Math.max(0, w[p1] - mins[p1]);
          if (slack > 0) {
            var take = Math.min(over, slack);
            for (var p2 = 0; p2 < colCount; p2++) {
              if (!opt.barCols[p2] && !isFixed(p2)) w[p2] -= take * Math.max(0, w[p2] - mins[p2]) / slack;
            }
            over -= take;
          }
        }
        if (over > 0.01) squeezed = true;
      }
      for (var wb = 0; wb < opt.barList.length; wb++) {
        var bcw = opt.barList[wb];
        if (isFixed(bcw)) {
          barInfo[bcw].zone = Math.max(0, w[bcw] - fixedBar[bcw]);
        } else {
          w[bcw] = Math.max(fixedBar[bcw] + zone, floorW[bcw]);
          barInfo[bcw].zone = zone;
        }
      }
      // 4. still too wide — scale everything down (cells will crowd)
      if (squeezed) {
        var tot = 0;
        for (var s2 = 0; s2 < colCount; s2++) tot += w[s2];
        for (var s3 = 0; s3 < colCount; s3++) w[s3] = w[s3] * tableWidth / tot;
        // The value part of a bar column doesn't shrink, so each bar gets
        // what is left of its (scaled) column — never drawn past it.
        for (var wb2 = 0; wb2 < opt.barList.length; wb2++) {
          var sq = opt.barList[wb2];
          barInfo[sq].zone = Math.max(0, w[sq] - fixedBar[sq]);
        }
      }
      var accX = 0;
      for (var ax = 0; ax < colCount; ax++) { colLeft.push(accX); colW.push(w[ax]); accX += w[ax]; }
    }
    function colRight(c) { return contentLayout ? colLeft[c] + colW[c] : (c + 1) * dataColWidth; }
    function padLeftOf(c) { return c === 0 ? firstPadL : cellPadX; }

    // Horizontal alignment of a column's text: the user's choice, else
    // auto — numbers right (content layout: figure-like text too), text left.
    function autoRight(c) {
      if (c === 0) return false;
      for (var k = 0; k < items.length; k++) {
        var v = rows[items[k].r][c];
        if (cellText(v).trim() && !looksNumeric(v)) return false;
      }
      return true;
    }
    var colAutoRight = [];
    for (var ar = 0; ar < colCount; ar++) colAutoRight.push(contentLayout && !opt.barCols[ar] && autoRight(ar));
    // → { anchor, x } for a text block in column c
    function placeText(c, extraLeft, autoIsRight) {
      var a = opt.align[c];
      if (!a) a = autoIsRight ? "right" : "left";
      var left = colLeft[c] + padLeftOf(c) + (extraLeft || 0);
      var right = colRight(c) - cellPadX;
      if (a === "right") return { anchor: "end", x: right };
      if (a === "center") return { anchor: "middle", x: (left + right) / 2 };
      return { anchor: "start", x: left };
    }

    // ── Column group headings (above the column headers) ──
    var headerLineH = Math.round(headerFontSize * (minimal ? 1.15 : 1.2));
    var groupWraps = [];
    var groupRowH = 0;
    if (opt.groups.length) {
      var gLines = 1;
      for (var gi = 0; gi < opt.groups.length; gi++) {
        var grp = opt.groups[gi];
        var gw = colRight(grp.to) - colLeft[grp.from] - padLeftOf(grp.from) - cellPadX;
        var gWrap = R.wrapToFit(grp.name, headerFontSize, gw, 2, headerAdvance);
        groupWraps.push(gWrap);
        if (gWrap.lines.length > gLines) gLines = gWrap.lines.length;
      }
      groupRowH = gLines * headerLineH + Math.max(3, Math.round(fontSize * 0.5)) * 2;
    }

    // ── Header row: wraps to 3 lines in the content layout ──
    var headerWraps = [];
    var headerMaxLines = 1;
    var truncCount = 0;
    var hPadY = 6;
    if (contentLayout) {
      for (var hw = 0; hw < colCount; hw++) {
        var hWrap = R.wrapToFit(cellText(headers[hw]), headerFontSize, colW[hw] - padLeftOf(hw) - cellPadX, 3, headerAdvance);
        if (!hWrap.fits) truncCount++;
        headerWraps.push(hWrap);
        if (hWrap.lines.length > headerMaxLines) headerMaxLines = hWrap.lines.length;
      }
      if (minimal) hPadY = Math.max(2, Math.round(fontSize * 0.5 * vPad));
      var hNeed = headerMaxLines * headerLineH + hPadY * 2;
      if (minimal || hNeed > headerRowH) headerRowH = hNeed;
    }

    // Pre-wrap every cell. Each cell wraps to up to 3 lines that fit
    // within the column's available width. Row height grows to match
    // the tallest wrapped cell in that row — same idea as Excel's
    // "Wrap Text" cell formatting. No more silent ellipsis truncation;
    // long text spills into additional lines and the row gets taller.
    // Bar cells never wrap: their width is sized to the widest value.
    // Minimal look: tighter leading for wrapped labels, and the Height
    // slider also scales the cell padding so a table can fit a slot.
    var cellLineH = Math.round(fontSize * (minimal ? 1.15 : 1.25));
    var cellPadY = minimal ? Math.max(1, Math.round(fontSize * 0.35 * vPad)) : 6; // top + bottom padding inside each cell
    var minCellH = rowHeight; // single-line default
    if (hasBars && opt.barAbove) minCellH = Math.max(minCellH, cellLineH + barGapY + barH + cellPadY * 2);
    var wrappedCells = [];   // [item][col] = wrapToFit result
    var rowHeights = [];
    for (var rr = 0; rr < items.length; rr++) {
      var rowWraps = [];
      var maxLines = 1;
      for (var ccr = 0; ccr < colCount; ccr++) {
        var wr;
        if (opt.barCols[ccr]) {
          var bt = displayText(items[rr].r, ccr);
          wr = { lines: bt ? [bt] : [], fits: true, truncated: false };
        } else {
          var cellVal = rows[items[rr].r][ccr];
          if (cellVal == null) cellVal = "";
          var cellAvailW = contentLayout
            ? colW[ccr] - padLeftOf(ccr) - cellPadX - (ccr === 0 ? fixedIconOffset : 0)
            : dataColWidth - cellPadX * 2 - (ccr === 0 ? fixedIconOffset : 0);
          wr = R.wrapToFit(String(cellVal), fontSize, cellAvailW, 3, advOf(items[rr], ccr));
        }
        rowWraps.push(wr);
        if (!wr.fits) truncCount++;
        if (wr.lines.length > maxLines) maxLines = wr.lines.length;
      }
      wrappedCells.push(rowWraps);
      rowHeights.push(Math.max(minCellH, maxLines * cellLineH + cellPadY * 2));
    }
    if (truncCount > 0 || squeezed) {
      R.pushWarning("label-truncated", { count: truncCount || 1,
        suggestion: "Try a wider chart, fewer columns, or shorter cell text" });
    }

    // Separator rows add a small gap with a line in it.
    var sepGap = minimal ? Math.max(4, Math.round(fontSize * 0.8)) : 8;

    // Table height = header row + sum of per-row heights (variable).
    var tableH = headerRowH;
    for (var rh = 0; rh < rowHeights.length; rh++) {
      if (items[rh].sepBefore) tableH += sepGap;
      tableH += rowHeights[rh];
    }

    // Footer — gap added by computeFooterStart only when footer has text
    var footerStartY = R.computeFooterStart(rs, tableTop + groupRowH + tableH, !!config.footer);
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

    // Column group headings: name over its columns, a rule under it with
    // a small gap between neighbouring groups.
    if (opt.groups.length) {
      svg.push('  <g transform="translate(' + marginLeft + ',' + tableTop + ')">');
      for (var gd = 0; gd < opt.groups.length; gd++) {
        var gg = opt.groups[gd];
        var gLinesArr = groupWraps[gd].lines;
        var gx0 = colLeft[gg.from] + (gg.from === 0 ? 0 : cellPadX / 2);
        var gx1 = colRight(gg.to) - (gg.to === colCount - 1 ? 0 : cellPadX / 2);
        var gRuleY = groupRowH - Math.max(2, Math.round(fontSize * 0.3));
        var gFirstY = gRuleY - Math.max(2, Math.round(fontSize * 0.35)) - (gLinesArr.length - 1) * headerLineH;
        for (var gl = 0; gl < gLinesArr.length; gl++) {
          svg.push('    <text x="' + (colLeft[gg.from] + padLeftOf(gg.from)).toFixed(1) + '" y="' + (gFirstY + gl * headerLineH).toFixed(1) +
            '" font-family="' + headerFont + '" font-size="' + headerFontSize +
            '" font-weight="bold" fill="' + st.valueColor + '">' + R.escapeXml(gLinesArr[gl]) + '</text>');
        }
        svg.push('    <line x1="' + gx0.toFixed(1) + '" y1="' + gRuleY + '" x2="' + gx1.toFixed(1) + '" y2="' + gRuleY +
          '" stroke="' + st.baselineColor + '" stroke-width="0.75"/>');
      }
      svg.push('  </g>');
    }

    // Table group
    svg.push('  <g transform="translate(' + marginLeft + ',' + (tableTop + groupRowH) + ')">');

    // Default colours: shades of the style's ramp (blue for OCHA), handed
    // out in bar-column order (or row order when colouring by row).
    var shades = R.tableShades(config.sequentialRamp);
    var barOrder = {};
    for (var bo = 0; bo < opt.barList.length; bo++) barOrder[opt.barList[bo]] = bo;
    // Colour-by-row default: palette order by distinct first-column label
    // (rows with the same label share a colour; the Design tab lists one
    // swatch per distinct label in the same order).
    var rowLabelOrder = {};
    var nLabels = 0;
    for (var lo = 0; lo < items.length; lo++) {
      if (!rowLabelOrder.hasOwnProperty(items[lo].label)) rowLabelOrder[items[lo].label] = nLabels++;
    }
    // Colour of a cell's bar: the row's or the column's colour.
    function cellColor(item, c) {
      if (opt.colorBy === "single") return opt.barColor || shades[0];
      if (opt.colorByRow) {
        return opt.rowColors[item.label] || shades[rowLabelOrder[item.label] % shades.length];
      }
      return opt.barColors[c] || opt.barColors[String(c)] || shades[(barOrder[c] || 0) % shades.length];
    }

    // Header row
    if (!minimal) {
      // Header row background
      svg.push('    <rect x="0" y="0" width="' + tableWidth + '" height="' + headerRowH +
        '" fill="' + (config.colors[0] || '#009EDB') + '"/>');
    }

    // Header text
    for (var c = 0; c < colCount; c++) {
      if (!contentLayout && !opt.align[c]) {
        var hx = c * dataColWidth + cellPadX;
        svg.push('    <text x="' + hx + '" y="' + (headerRowH / 2 + headerFontSize * 0.35) +
          '" font-family="' + fonts.heading + '" font-size="' + headerFontSize +
          '" font-weight="bold" fill="#ffffff">' + R.escapeXml(headers[c]) + '</text>');
        continue;
      }
      var hLines = contentLayout ? (headerWraps[c].lines.length ? headerWraps[c].lines : [""]) : [cellText(headers[c])];
      // Bar columns: the header sits over the value (beside: value zone
      // start; above: follows the column alignment like the value does).
      // (A narrow classic table keeps its left-aligned headers, as at
      // normal widths, so nothing jumps while resizing.)
      var hPos = placeText(c, 0, colAutoRight[c] && !classicFallback);
      var hFill = (contentLayout && headerWraps[c].truncated) ? R.FADED_LABEL_COLOR : (minimal ? st.valueColor : "#ffffff");
      // Minimal: lines sit on the rule (bottom-aligned); classic: centred.
      var hFirstY = minimal
        ? headerRowH - hPadY - (hLines.length - 1) * headerLineH - headerFontSize * 0.25
        : headerRowH / 2 - (hLines.length - 1) * headerLineH / 2 + headerFontSize * 0.35;
      for (var hl = 0; hl < hLines.length; hl++) {
        svg.push('    <text x="' + hPos.x.toFixed(1) + '" y="' + (hFirstY + hl * headerLineH).toFixed(1) +
          '" font-family="' + headerFont + '" font-size="' + headerFontSize +
          '" font-weight="bold" fill="' + hFill + '"' + (hPos.anchor !== "start" ? ' text-anchor="' + hPos.anchor + '"' : '') + '>' +
          R.escapeXml(hLines[hl]) + '</text>');
      }
    }
    if (minimal) {
      svg.push('    <line x1="0" y1="' + headerRowH + '" x2="' + tableWidth + '" y2="' + headerRowH +
        '" stroke="' + st.baselineColor + '" stroke-width="0.75"/>');
    }

    // Data rows — per-row heights based on the tallest wrapped cell
    var ryAccum = headerRowH;
    for (var r = 0; r < items.length; r++) {
      var item = items[r];
      var srcR = item.r;
      if (item.sepBefore) {
        var sepY = ryAccum + sepGap / 2;
        svg.push('    <line x1="0" y1="' + sepY + '" x2="' + tableWidth + '" y2="' + sepY +
          '" stroke="' + st.baselineColor + '" stroke-width="' + (minimal ? 0.75 : 1) + '"/>');
        ryAccum += sepGap;
      }
      var ry = ryAccum;
      var thisRowH = rowHeights[r];
      ryAccum += thisRowH;
      var isOdd = r % 2 === 1;

      if (opt.rowHighlight[item.label]) {
        // Highlighted row: a light tint of the style colour, full width
        svg.push('    <rect x="0" y="' + ry + '" width="' + tableWidth +
          '" height="' + thisRowH + '" fill="' + R.tableHighlight(config.sequentialRamp) + '"/>');
      }
      if (!minimal) {
        // Alternating row bg
        if (isOdd && !opt.rowHighlight[item.label]) {
          svg.push('    <rect x="0" y="' + ry + '" width="' + tableWidth +
            '" height="' + thisRowH + '" fill="#f5f5f5"/>');
        }

        // Row border
        svg.push('    <line x1="0" y1="' + (ry + thisRowH) + '" x2="' + tableWidth +
          '" y2="' + (ry + thisRowH) + '" stroke="' + st.gridColor + '" stroke-width="0.5"/>');
      } else if (r > 0 && !item.sepBefore) {
        // Dotted rule between rows (none above the first row: the header
        // rule is there; none where a separator line already is)
        svg.push('    <line x1="0" y1="' + ry + '" x2="' + tableWidth + '" y2="' + ry +
          '" stroke="' + MINIMAL_RULE_COLOR + '" stroke-width="0.5" stroke-dasharray="1,1"/>');
      }

      // Icon inside first cell; humanitarian icons are centred in the icon column (as wide as the
      // widest icon): balanced icons differ in width, and left-aligning them
      // made the gap before each label uneven.
      if (hasIcons && iconSelections[srcR]) {
        var icoRef = iconSelections[srcR];
        var resolved = iconSvgMap[icoRef];
        if (resolved) {
          var dims = R.getIconDims(resolved, iconH, iconNorm);
          var icoX = firstPadL + (isFlags ? 0 : Math.max(0, (fixedIconOffset - iconMarginR - dims.w) / 2));
          var icoY = ry + (thisRowH - dims.h) / 2;
          var icoColor = !isFlags ? (config.rowIconColor || "#009EDB") : null;
          svg.push('    ' + R.buildIconGroup(resolved, iconH, icoX, icoY, icoColor, iconNorm));
        }
      }

      // Cell values — multi-line wrapped, vertically centred in the row
      for (var cc = 0; cc < colCount; cc++) {
        var val = rows[srcR][cc];
        if (val == null) val = "";
        var wrap = wrappedCells[r][cc];
        var lines = wrap.lines.length ? wrap.lines : [""];
        var bold = isBold(item, cc);
        var styleAttr = (bold ? '" font-weight="bold' : '') + (opt.colItalic[cc] ? '" font-style="italic' : '');
        var cellColorV = wrap.truncated ? R.FADED_LABEL_COLOR : st.valueColor;
        var blockH = (lines.length - 1) * cellLineH;
        // Vertical centre of cell, then offset upward by half blockH
        var firstBaselineY = ry + thisRowH / 2 - blockH / 2 + fontSize * 0.35;

        if (opt.barCols[cc]) {
          var info = barInfo[cc];
          var zoneW = Math.max(0, info.zone);
          var n = readNumber(val);
          var ratio = 0;
          if (!isNaN(n) && info.max > 0) ratio = Math.max(0, Math.min(1, n / info.max));
          else if (isPlaceholder(val)) ratio = PLACEHOLDER_BAR_RATIO;
          var hasValue = !isNaN(n) || isPlaceholder(val);
          var barX, barY, vX, vY, vAnchor;
          if (opt.barAbove) {
            // Value on top, bar under it, the pair centred in the row
            var blockTop = ry + (thisRowH - (cellLineH + barGapY + barH)) / 2;
            barX = colLeft[cc] + cellPadX;
            barY = blockTop + cellLineH + barGapY;
            vY = blockTop + cellLineH - fontSize * 0.25;
            var vPos = placeText(cc, 0, false);
            if (opt.align[cc] === "right") vPos.x = barX + zoneW;
            else if (opt.align[cc] === "center") vPos.x = barX + zoneW / 2;
            vX = vPos.x; vAnchor = vPos.anchor;
          } else {
            // Value (right-aligned in its zone), then the bar
            var valueRight = colLeft[cc] + cellPadX + info.valueW;
            barX = valueRight + barGapX;
            barY = ry + (thisRowH - barH) / 2;
            vX = valueRight; vY = firstBaselineY; vAnchor = "end";
          }
          if (opt.track[cc] && hasValue && zoneW > 0) {
            svg.push('    <rect x="' + barX.toFixed(1) + '" y="' + barY.toFixed(1) + '" width="' + zoneW.toFixed(1) +
              '" height="' + barH + '" fill="' + TRACK_COLOR + '"/>');
          }
          if (ratio > 0 && zoneW > 0) {
            svg.push('    <rect x="' + barX.toFixed(1) + '" y="' + barY.toFixed(1) + '" width="' + (zoneW * ratio).toFixed(1) +
              '" height="' + barH + '" fill="' + cellColor(item, cc) + '"/>');
          }
          if (lines[0]) {
            svg.push('    <text x="' + vX.toFixed(1) + '" y="' + vY.toFixed(1) +
              '" font-family="' + fonts.value + '" font-size="' + fontSize + styleAttr +
              '" fill="' + cellColorV + '" text-anchor="' + vAnchor + '">' + R.escapeXml(lines[0]) + '</text>');
          }
          continue;
        }

        var textX, textAnchor;
        if (!contentLayout && !opt.align[cc]) {
          var cellX = cc * dataColWidth + cellPadX;
          if (cc === 0 && fixedIconOffset > 0) cellX += fixedIconOffset;
          var isNum = (typeof val === "number" || (typeof val === "string" && !isNaN(Number(val)) && val !== ""));
          textAnchor = isNum ? "end" : "start";
          textX = isNum ? ((cc + 1) * dataColWidth - cellPadX) : cellX;
        } else {
          var pos = placeText(cc, cc === 0 ? fixedIconOffset : 0, colAutoRight[cc] || (!contentLayout && looksNumeric(val)));
          textAnchor = pos.anchor;
          textX = Number(pos.x.toFixed(1));
        }

        for (var ln = 0; ln < lines.length; ln++) {
          svg.push('    <text x="' + textX + '" y="' + (firstBaselineY + ln * cellLineH).toFixed(1) +
            '" font-family="' + fonts.value + '" font-size="' + fontSize + styleAttr +
            '" fill="' + cellColorV + '" text-anchor="' + textAnchor + '">' +
            R.escapeXml(lines[ln]) + '</text>');
        }
      }
    }

    if (!minimal) {
      // Outer border
      svg.push('    <rect x="0" y="0" width="' + tableWidth + '" height="' + tableH +
        '" fill="none" stroke="' + st.gridColor + '" stroke-width="1"/>');

      // Column separators (a group divider is drawn darker below)
      for (var cs = 1; cs < colCount; cs++) {
        if (opt.dividers[cs - 1]) continue;
        var csx = contentLayout ? Number(colLeft[cs].toFixed(1)) : cs * dataColWidth;
        svg.push('    <line x1="' + csx + '" y1="0" x2="' + csx + '" y2="' + tableH +
          '" stroke="' + st.gridColor + '" stroke-width="0.5"/>');
      }
    }

    // Column-group dividers
    for (var dv = 0; dv < colCount - 1; dv++) {
      if (!opt.dividers[dv]) continue;
      var dvx = contentLayout ? Number(colLeft[dv + 1].toFixed(1)) : (dv + 1) * dataColWidth;
      svg.push('    <line x1="' + dvx + '" y1="0" x2="' + dvx + '" y2="' + tableH +
        '" stroke="' + (minimal ? DIVIDER_COLOR : st.baselineColor) + '" stroke-width="' + (minimal ? 0.75 : 1) + '"/>');
    }

    svg.push('  </g>');

    for (var fi2 = 0; fi2 < footer.svg.length; fi2++) svg.push(footer.svg[fi2]);

    svg.push('</svg>');
    return svg.join("\n");
  }

  R.register("table", "Data Table", render);
})();
