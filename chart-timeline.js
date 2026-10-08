/**
 * Timeline Chart Renderer
 *
 * Renders a sequence of events along a line. Each event has:
 *   - date (free text, e.g. "Jan 2024", "2024-01-15", "Q1 2024")
 *   - label (key figure or headline, e.g. "2.3M")
 *   - text (description)
 *   - iconRef (optional) → resolved by ChartBuilder to _iconSvg
 *
 * Orientation:
 *   - horizontal: events left to right on one line, auto-folds into
 *     an S-shape when the row would be too cramped at the chart's
 *     width.
 *   - vertical: events top to bottom on a vertical line. Icon + date
 *     sit on the left of the dot; label + description on the right.
 *
 * S-shape arc-adjacent treatment:
 *   The default placement is icon → desc → label above the line; date
 *   below. In the S-shape layout, events that sit immediately next to
 *   a corner arc can collide with the curve. We target only those
 *   arc-adjacent events with two special treatments:
 *
 *     - "narrow"  → wrap budget shrinks to 40 px so text stacks taller
 *                   and stays clear of the arc curve. Default order
 *                   otherwise.
 *     - "below"   → all text (icon + date + label + description) stacks
 *                   below the dot. Above the line stays empty.
 *
 *   The pattern repeats every 3 rows:
 *     row 0, 3, 6 … last input  → "narrow"  (source of down-arc)
 *     row 1, 4, 7 … last input  → "below"   (source of down-arc)
 *     row 2, 5, 8 … first input → "below"   (destination of up-arc)
 *
 *   The single-row horizontal layout has no arcs, so every event uses
 *   the default placement.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  // Default minimum column width per event (in SVG units). When an event's
  // block would be narrower than this, the horizontal timeline auto-folds
  // into a serpentine S-shape with the appropriate number of rows.
  // User-overridable via `config.timelineEventSpacing` (a px slider).
  //
  // Reduced from 90 → 70 in 2026.0.31: 41-event timelines on A4 were
  // ballooning to 7+ rows because events were forced wide. 70 packs
  // ~8 events per row at A4 width while still leaving room for short
  // labels (country names, etc.). Long-label timelines can crank the
  // slider back up.
  var DEFAULT_EVENT_SPACING = 70;

  // Wrap budget for arc-adjacent "narrow" events. Forces date / label /
  // description into multi-line stacks so they don't fight the arc.
  var NARROW_TEXT_WIDTH = 40;

  // ── Shared helpers ──────────────────────────────────────

  function computeFonts(rs) {
    // Sizing convention (2026.0.31): description gets the full label
    // size, dates step DOWN to ~0.85× and render in bold. Dates are
    // metadata — the bold + smaller treatment makes them look like
    // a tag/timestamp rather than competing with the description as
    // the headline text.
    return {
      dateSize:  Math.max(8, Math.round(rs.labelSize * 0.85)),
      labelSize: Math.round(rs.valueSize * 1.4),
      descSize:  rs.labelSize
    };
  }

  function dotRadius(svgW) {
    if (svgW >= 600) return 6;
    if (svgW >= 400) return 5;
    return 4;
  }

  function hasAnyIcon(data) {
    for (var i = 0; i < data.length; i++) {
      if (data[i]._iconSvg) return true;
    }
    return false;
  }

  // Pick a sensible vertical clearance from the timeline line for a
  // text block of size `fontSize`. The line has a stroke that thickens
  // visually with bigger text — without enough gap, descenders on
  // labels (commas, "g", "y") visibly graze it. Scales with font size
  // so big-headline timelines still breathe; floors at the original
  // 6/10 px so small charts don't feel airy.
  function lineGapAbove(fontSize, strokeW) {
    return Math.max(10, Math.round(fontSize * 0.6) + Math.round(strokeW || 1));
  }
  function lineGapBelow(fontSize, strokeW) {
    return Math.max(6, Math.round(fontSize * 0.4) + Math.round(strokeW || 1));
  }

  // Wrap a date string at a given pixel width with a hard line cap.
  // When the cap kicks in, ellipsise the last visible line and flag
  // the result as truncated so the renderer can apply the red +
  // underline error treatment. Returns { lines, truncated }.
  function wrapDate(date, fontSize, maxW, maxLines) {
    if (!date) return { lines: [], truncated: false };
    maxLines = maxLines || 3;
    var raw = R.wrapText(String(date), fontSize, maxW, R.LABEL_ADVANCE);
    if (raw.length <= maxLines) return { lines: raw, truncated: false };
    var lines = raw.slice(0, maxLines);
    var last = String(lines[lines.length - 1] || "").replace(/\s+$/, "");
    lines[lines.length - 1] = last + "…";
    return { lines: lines, truncated: true };
  }

  // Wrap a description string with a hard line cap. Same idea as
  // wrapDate, just exposed under its own name so each renderer's
  // intent reads clearly. Returns { lines, truncated }.
  function wrapDescription(text, fontSize, maxW, maxLines) {
    if (!text) return { lines: [], truncated: false };
    maxLines = maxLines || 2;
    var raw = R.wrapText(String(text), fontSize, maxW, R.LABEL_ADVANCE);
    if (raw.length <= maxLines) return { lines: raw, truncated: false };
    var lines = raw.slice(0, maxLines);
    var last = String(lines[lines.length - 1] || "").replace(/\s+$/, "");
    lines[lines.length - 1] = last + "…";
    return { lines: lines, truncated: true };
  }

  // Single-line date truncation (used in default event mode where
  // dates render on one line below the dot). Returns the same
  // shape as wrapDate so the renderer can treat both cases uniformly.
  function shortDate(date, maxLen) {
    if (!date) return { lines: [], truncated: false };
    var raw = String(date);
    var truncd = R.truncate(raw, maxLen);
    return { lines: [truncd], truncated: truncd !== raw };
  }

  // Compute a content-driven event spacing — the smallest column
  // width that lets every event's label and description fit inside
  // `targetLines` lines, plus the date in one line. Floors at
  // `minColW` (the user's slider value) and caps at `maxColW` so a
  // single very long entry doesn't blow up everything.
  //
  // The width is approximated from char count, so wrap breaks at
  // word boundaries can shift the actual rendered width by a line.
  // That's fine — wrapToFit / wrapText still run after this and
  // truncate gracefully when the approximation undershoots.
  function computeContentSpacing(data, fonts, minColW, maxColW, targetLines) {
    var advance = R.LABEL_ADVANCE;
    var pad = 12; // slack for word boundaries + a bit of breathing room
    var maxNeeded = minColW;
    for (var i = 0; i < data.length; i++) {
      var ev = data[i];
      var labelChars = ev.label ? String(ev.label).length : 0;
      var descChars  = ev.text  ? String(ev.text).length  : 0;
      var dateChars  = ev.date  ? String(ev.date).length  : 0;

      var labelW = labelChars > 0
        ? Math.ceil((labelChars * advance * fonts.labelSize) / Math.max(1, targetLines)) + pad
        : 0;
      var descW = descChars > 0
        ? Math.ceil((descChars * advance * fonts.descSize) / Math.max(1, targetLines)) + pad
        : 0;
      var dateW = dateChars > 0
        ? Math.ceil(dateChars * advance * fonts.dateSize) + pad
        : 0;

      var need = Math.max(labelW, descW, dateW);
      if (need > maxNeeded) maxNeeded = Math.min(need, maxColW);
    }
    return maxNeeded;
  }

  // Build the category → colour map for an event list. Returns null
  // when the data has no Category column (no events have a category
  // field). Otherwise returns:
  //   {
  //     ordered: ["Africa", "Asia", ...],          // unique cats, in order of first appearance
  //     map:     { "Africa": "#009EDB", ... }      // resolved colour per category
  //   }
  // Default colours come from the active style's ICON palette
  // (a brand-coherent ramp — OCHA blue, HNRP orange, etc.) rather
  // than the secondary palette, so timeline categories stay on-brand
  // regardless of how many of them there are. The line colour
  // (config.colors[0], the brand primary) is filtered out of the
  // pool so each category dot is visually distinct from the line.
  // User overrides via config.timelineCategoryColors take precedence.
  function resolveCategoryColors(data, config) {
    var seen = {};
    var ordered = [];
    for (var i = 0; i < data.length; i++) {
      var c = data[i] && data[i].category;
      if (c && !seen[c]) { seen[c] = true; ordered.push(c); }
    }
    if (!ordered.length) return null;

    var lineColor = ((config.colors && config.colors[0]) || "#009EDB").toLowerCase();
    var sourcePalette = (config.iconPalette && config.iconPalette.length)
      ? config.iconPalette
      : (config.colors && config.colors.length ? config.colors : ["#009EDB"]);

    // Filter out the line colour so categories never collide with
    // the line itself. If everything filters out, fall back to the
    // raw palette so we still produce something.
    var palette = [];
    for (var p = 0; p < sourcePalette.length; p++) {
      if (String(sourcePalette[p]).toLowerCase() !== lineColor) {
        palette.push(sourcePalette[p]);
      }
    }
    if (!palette.length) palette = sourcePalette;

    var override = (config.timelineCategoryColors && typeof config.timelineCategoryColors === "object")
      ? config.timelineCategoryColors : {};
    var map = {};
    for (var j = 0; j < ordered.length; j++) {
      var name = ordered[j];
      var manual = override[name];
      var auto = palette[j % palette.length];
      map[name] = manual || auto;
    }
    return { ordered: ordered, map: map };
  }

  // ── Event-block geometry ────────────────────────────────
  //
  // Each event has an `aboveH` (vertical space needed above the line)
  // and `belowH` (space below the line). These are computed up-front
  // from the wrapped lines + role, so the row block height can be set
  // to fit the tallest event in the chart.

  function computeBlockSizes(ev, descLines, dateLines, sizes) {
    var f = sizes.f, lineHDate = sizes.lineHDate, lineHDesc = sizes.lineHDesc;
    var labelLineH = sizes.labelLineH, iconH = sizes.iconH;
    var anyIcon = sizes.anyIcon, hasIcon = anyIcon && ev._iconSvg;
    var iconGap = sizes.iconGap, dateGap = sizes.dateGap;
    var labelGap = sizes.labelGap, descGap = sizes.descGap;
    var descLineGap = sizes.descLineGap;

    var labelLines = ev._labelLines || [];
    var allBelow = (ev._arcRole === "below");

    var labelBlockH = labelLines.length
      ? f.labelSize + (labelLines.length - 1) * labelLineH
      : 0;
    var descBlockH = descLines.length
      ? f.descSize + (descLines.length - 1) * lineHDesc
      : 0;
    var dateBlockH = dateLines.length
      ? f.dateSize + (dateLines.length - 1) * lineHDate
      : 0;

    if (allBelow) {
      var below = dateGap;
      if (hasIcon) below += iconH + iconGap;
      if (dateLines.length) below += dateBlockH;
      if (labelLines.length) below += descGap + labelBlockH;
      if (descLines.length) below += descGap + descBlockH;
      return { above: 0, below: below + 4 };
    }

    // Above the line:
    //   - With label: labelGap + label block (+ descGap + desc block).
    //   - Without label but with desc: desc hugs the line at desc-sized
    //     clearance (descLineGap), so we don't reserve empty space for
    //     a missing label.
    //   - Otherwise: just the icon clearance (or zero).
    var above;
    if (labelLines.length > 0) {
      above = labelGap + labelBlockH;
      if (descLines.length) above += descGap + descBlockH;
    } else if (descLines.length > 0) {
      above = descLineGap + descBlockH;
    } else {
      above = 0;
    }
    if (hasIcon) above += iconGap + iconH;
    var belowDefault = dateLines.length ? (dateGap + dateBlockH + 4) : 0;
    return { above: above, below: belowDefault };
  }

  // Draw one event block centered on (cx, lineY).
  //
  // Three modes — picked from `ev._arcRole`:
  //   null      → default: icon → desc → label above; date below.
  //   "narrow"  → same default order, just narrower wraps (already
  //               applied at pre-wrap time). Date may span 2+ lines.
  //   "below"   → above-line stays empty; everything stacks under the
  //               dot in the order icon → date → label → description.
  //
  // Description and date lines come from ev._dateLines / argument.
  function drawHorizontalEvent(body, ev, descLines, cx, lineY, style) {
    var f = style.f, fonts = style.fonts, st = style.st;
    var iconH = style.iconH, iconGap = style.iconGap, dateGap = style.dateGap;
    var labelGap = style.labelGap, descGap = style.descGap;
    var lineHDesc = style.lineHDesc, lineHDate = style.lineHDate;
    var labelLineH = style.labelLineH || (f.labelSize * 1.15);
    var iconColor = style.iconColor, lineColor = style.lineColor;
    var strokeW = style.strokeW, dotR = style.dotR, anyIcon = style.anyIcon;

    var labelLines = ev._labelLines || [];
    var dateLines = ev._dateLines || [];
    var allBelow = (ev._arcRole === "below");

    // Truncation-driven error treatment: any column (label, desc,
    // date) that got cut renders in red and underlined so the user
    // can spot it instantly. Keeps the existing R.FADED_LABEL_COLOR
    // (now red) constant; just adds text-decoration here.
    var lblColor = ev._labelTruncated ? R.FADED_LABEL_COLOR : st.valueColor;
    var lblDeco = ev._labelTruncated ? ' text-decoration="underline"' : '';
    var descColor = ev._descTruncated ? R.FADED_LABEL_COLOR : st.labelColor;
    var descDeco = ev._descTruncated ? ' text-decoration="underline"' : '';
    var dateColor = ev._dateTruncated ? R.FADED_LABEL_COLOR : st.labelColor;
    var dateDeco = ev._dateTruncated ? ' text-decoration="underline"' : '';

    // ── Above the line (only when not all-below) ──
    if (!allBelow) {
      var hasLabel = labelLines.length > 0;
      var hasDesc = descLines && descLines.length > 0;
      var descLineGap = style.descLineGap || labelGap;

      // Label sits closest to the line at labelGap. Without a label,
      // the description takes that role and uses its own (smaller)
      // line clearance — so no empty space for a missing label.
      var labelBlockH = hasLabel ? (labelLines.length - 1) * labelLineH : 0;
      var labelBottomBaselineY = lineY - labelGap;

      if (hasLabel) {
        for (var ll = 0; ll < labelLines.length; ll++) {
          var lineIdxFromBottom = labelLines.length - 1 - ll;
          var lblY = labelBottomBaselineY - lineIdxFromBottom * labelLineH;
          body.push('    <text x="' + cx.toFixed(1) + '" y="' + lblY.toFixed(1) +
            '" font-family="' + fonts.value + '" font-weight="700" font-size="' + f.labelSize +
            '" fill="' + lblColor + '"' + lblDeco + ' text-anchor="middle">' +
            R.escapeXml(labelLines[ll]) + '</text>');
        }
      }

      // Description sits above the label, OR — when there's no label
      // — directly above the line at desc-sized clearance.
      var descTopVisualY = null;
      if (hasDesc) {
        var descBottomBaselineY;
        if (hasLabel) {
          descBottomBaselineY = labelBottomBaselineY - labelBlockH - f.labelSize - descGap;
        } else {
          descBottomBaselineY = lineY - descLineGap;
        }
        for (var dl = 0; dl < descLines.length; dl++) {
          var lineIdxFromBottom2 = descLines.length - 1 - dl;
          var dy = descBottomBaselineY - lineIdxFromBottom2 * lineHDesc;
          body.push('    <text x="' + cx.toFixed(1) + '" y="' + dy.toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + f.descSize +
            '" fill="' + descColor + '"' + descDeco + ' text-anchor="middle">' +
            R.escapeXml(descLines[dl]) + '</text>');
        }
        descTopVisualY = descBottomBaselineY - (descLines.length - 1) * lineHDesc - f.descSize;
      }

      // Icon at the top of the above-line stack
      if (anyIcon && ev._iconSvg) {
        var contentTopY;
        if (hasDesc) {
          contentTopY = descTopVisualY;
        } else if (hasLabel) {
          contentTopY = labelBottomBaselineY - labelBlockH - f.labelSize;
        } else {
          contentTopY = lineY;
        }
        var dims = R.getIconDims(ev._iconSvg, iconH, 1.0);
        var icoX = cx - dims.w / 2;
        var icoY = contentTopY - iconGap - iconH;
        body.push('    ' + R.buildIconGroup(ev._iconSvg, iconH, icoX, icoY, iconColor, 1.0));
      }
    }

    // ── Dot on the line ──
    // Default fill is white (the punched-out look). When the event
    // has a category, the renderer pre-computes a category colour
    // and stores it on the event as `_dotFill` — used here so dots
    // are colour-coded by category. Stroke stays the line colour
    // for visual consistency with the rest of the timeline.
    var dotFill = ev._dotFill || "#ffffff";
    body.push('    <circle cx="' + cx.toFixed(1) + '" cy="' + lineY.toFixed(1) +
      '" r="' + dotR + '" fill="' + dotFill + '" stroke="' + lineColor +
      '" stroke-width="' + (strokeW * 0.9).toFixed(1) + '"/>');

    // ── Below the line ──
    if (allBelow) {
      // Stack: icon → date → label → desc, every element below the dot.
      var yCursor = lineY + dateGap;

      if (anyIcon && ev._iconSvg) {
        var dimsB = R.getIconDims(ev._iconSvg, iconH, 1.0);
        var icoXB = cx - dimsB.w / 2;
        body.push('    ' + R.buildIconGroup(ev._iconSvg, iconH, icoXB, yCursor, iconColor, 1.0));
        yCursor += iconH + iconGap;
      }

      if (dateLines.length) {
        for (var dt = 0; dt < dateLines.length; dt++) {
          var dyB = yCursor + f.dateSize + dt * lineHDate;
          body.push('    <text x="' + cx.toFixed(1) + '" y="' + dyB.toFixed(1) +
            '" font-family="' + fonts.label + '" font-weight="700" font-size="' + f.dateSize +
            '" fill="' + dateColor + '"' + dateDeco + ' text-anchor="middle">' +
            R.escapeXml(dateLines[dt]) + '</text>');
        }
        yCursor += f.dateSize + (dateLines.length - 1) * lineHDate;
      }

      if (labelLines.length) {
        yCursor += descGap;
        for (var lbB = 0; lbB < labelLines.length; lbB++) {
          var lbY = yCursor + f.labelSize + lbB * labelLineH;
          body.push('    <text x="' + cx.toFixed(1) + '" y="' + lbY.toFixed(1) +
            '" font-family="' + fonts.value + '" font-weight="700" font-size="' + f.labelSize +
            '" fill="' + lblColor + '"' + lblDeco + ' text-anchor="middle">' +
            R.escapeXml(labelLines[lbB]) + '</text>');
        }
        yCursor += f.labelSize + (labelLines.length - 1) * labelLineH;
      }

      if (descLines && descLines.length) {
        yCursor += descGap;
        for (var dB = 0; dB < descLines.length; dB++) {
          var ddy = yCursor + f.descSize + dB * lineHDesc;
          body.push('    <text x="' + cx.toFixed(1) + '" y="' + ddy.toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + f.descSize +
            '" fill="' + descColor + '"' + descDeco + ' text-anchor="middle">' +
            R.escapeXml(descLines[dB]) + '</text>');
        }
      }
    } else {
      // Default: date below the dot (single line for default events,
      // multi-line possible for "narrow" arc-adjacent events).
      for (var dtD = 0; dtD < dateLines.length; dtD++) {
        var dyD = lineY + dateGap + f.dateSize + dtD * lineHDate;
        body.push('    <text x="' + cx.toFixed(1) + '" y="' + dyD.toFixed(1) +
          '" font-family="' + fonts.label + '" font-weight="700" font-size="' + f.dateSize +
          '" fill="' + dateColor + '"' + dateDeco + ' text-anchor="middle">' +
          R.escapeXml(dateLines[dtD]) + '</text>');
      }
    }
  }

  // ── Single-row horizontal layout ────────────────────────
  //
  // No arcs in this layout, so every event uses default placement.

  function renderHorizontal(data, ctx, config) {
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;
    var f = computeFonts(rs);
    var n = data.length;

    // Events per row given the available plot width and the event spacing.
    // If all events fit on one row → straight horizontal; otherwise → serpentine S.
    // Content-driven event spacing: column width grows just enough
    // to fit each event's text in 3 lines (label / desc) or 1 line
    // (date), capped so a single huge entry can't blow up the chart.
    // The user's slider value is the FLOOR — a user who explicitly
    // wants more breathing room can crank it higher and it still
    // wins.
    var availableW = svgW - rs.marginLeft - rs.marginRight;
    var userSpacing = Math.max(60, config.timelineEventSpacing || DEFAULT_EVENT_SPACING);
    var maxColW = Math.max(userSpacing, Math.min(220, Math.round(availableW * 0.45)));
    var eventSpacing = computeContentSpacing(data, f, userSpacing, maxColW, 3);
    var maxPerRow = Math.max(1, Math.floor(availableW / eventSpacing));
    if (n > maxPerRow) {
      return renderSShape(data, ctx, config, maxPerRow);
    }

    // Flush-left: leftmost event sits at x=0, aligned with title
    var marginLeft = 0;
    var marginRight = rs.marginRight;

    // Header
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: ctx.title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);

    // Optional category legend, when the data has a Category column.
    var catColors = resolveCategoryColors(data, config);
    var legend = { svg: [], height: 0 };
    if (catColors) {
      // Legend strip — only when the toggle is on (default true).
      // Dot-fill stamping below runs unconditionally so a user can
      // hide the legend strip and still get colour-coded dots.
      if (config.timelineLegend !== false) {
        var legendColors = [];
        for (var lc = 0; lc < catColors.ordered.length; lc++) {
          legendColors.push(catColors.map[catColors.ordered[lc]]);
        }
        legend = R.renderStackedLegend({
          x: 0, startY: plotTop,
          names: catColors.ordered,
          colors: legendColors,
          rs: rs, style: st,
          maxWidth: svgW,
          hasSubtitle: !!config.subtitle
        });
        plotTop += legend.height;
      }

      // Stamp the resolved fill onto each event so drawHorizontalEvent
      // can pick it up without re-running the resolver.
      for (var ce = 0; ce < n; ce++) {
        var cev = data[ce];
        if (cev.category && catColors.map[cev.category]) {
          cev._dotFill = catColors.map[cev.category];
        } else {
          cev._dotFill = null;
        }
      }
    } else {
      for (var ce2 = 0; ce2 < n; ce2++) data[ce2]._dotFill = null;
    }

    var plotWidth = svgW - marginLeft - marginRight;
    // Content-driven column width: each event uses the user's requested
    // spacing (eventSpacing, default 90 px). Events pack from x=0; the
    // right side of the canvas stays empty when there are few events.
    // If the natural step would overflow plotWidth, fall back to an
    // even split.
    var colW = eventSpacing;
    if (colW * n > plotWidth) {
      colW = plotWidth / n;
    }

    var anyIcon = hasAnyIcon(data);
    var iconH = anyIcon ? Math.round(rs.valueSize * 1.8) : 0;
    var iconGap = anyIcon ? 5 : 0;
    var strokeW0 = rs.strokeWidth;
    // Gaps adjacent to the timeline line scale with font size so
    // glyph descenders never cross the stroke.
    var dateGap = lineGapBelow(f.dateSize, strokeW0);
    var labelGap = lineGapAbove(f.labelSize, strokeW0);
    // Smaller line clearance used when a description sits directly
    // above the line (i.e. the event has no label). Mirrors labelGap
    // but sized for the smaller description font, so a description-
    // only event hugs the line tightly instead of leaving a gap big
    // enough for a missing label.
    var descLineGap = lineGapAbove(f.descSize, strokeW0);
    var descGap = 4;
    var lineHDesc = f.descSize * 1.2;
    var lineHDate = f.dateSize * 1.2;
    var labelLineH = Math.round(f.labelSize * 1.15);

    var sizes = {
      f: f, lineHDate: lineHDate, lineHDesc: lineHDesc,
      labelLineH: labelLineH, iconH: iconH, anyIcon: anyIcon,
      iconGap: iconGap, dateGap: dateGap, labelGap: labelGap,
      descLineGap: descLineGap, descGap: descGap
    };

    // Wrap descriptions, labels, dates against the full column width.
    var descMaxW = Math.max(40, colW - 8);
    var labelMaxW = Math.max(40, colW - 8);
    var wrappedDescs = [];
    var truncCount = 0;
    var maxAbove = 0, maxBelow = 0;

    for (var wi = 0; wi < n; wi++) {
      var ev = data[wi];
      ev._arcRole = null;

      // Description (wrap to ≤3 lines — content-driven colW grows to
      // keep most descs at 1-2 lines; the 3rd line is the buffer
      // before truncation). Truncation flag drives red + underline.
      var descRes = wrapDescription(ev.text, f.descSize, descMaxW, 3);
      var descLines = descRes.lines;
      ev._descTruncated = descRes.truncated;
      wrappedDescs.push(descLines);

      // Label (wrap to ≤3 lines — same buffer-before-truncate idea).
      // Truncated labels render in red + underlined and push a
      // warning so over-long ones are still visible to the user.
      var lbl = String(ev.label || "");
      var labelWrap = lbl ? R.wrapToFit(lbl, f.labelSize, labelMaxW, 3, R.LABEL_ADVANCE)
                          : { lines: [], fits: true, truncated: false };
      ev._labelLines = labelWrap.lines;
      ev._labelTruncated = labelWrap.truncated;
      if (!labelWrap.fits) truncCount++;

      // Date (single-line truncated for default events). Track when
      // truncation actually happened so the renderer can apply the
      // error treatment.
      var dateRes = shortDate(ev.date, 24);
      ev._dateLines = dateRes.lines;
      ev._dateTruncated = dateRes.truncated;

      var hb = computeBlockSizes(ev, descLines, ev._dateLines, sizes);
      if (hb.above > maxAbove) maxAbove = hb.above;
      if (hb.below > maxBelow) maxBelow = hb.below;
    }
    if (truncCount > 0) {
      R.pushWarning("label-truncated", { count: truncCount,
        suggestion: "Try a wider chart, fewer events per row, or shorter event labels" });
    }

    var aboveLineH = maxAbove;
    var belowLineH = maxBelow;
    var plotHeight = aboveLineH + belowLineH;
    var lineY = aboveLineH;

    // Footer — gap added by computeFooterStart only when footer has text
    var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height)  // request, but never clip content
      : (footerStartY + footer.height);

    var lineColor = (config.colors && config.colors[0]) || "#009EDB";
    var iconColor = config.rowIconColor || lineColor;
    var strokeW = rs.strokeWidth;
    var dotR = dotRadius(svgW);

    var style = {
      f: f, fonts: fonts, st: st,
      iconH: iconH, iconGap: iconGap, dateGap: dateGap,
      labelGap: labelGap, descLineGap: descLineGap, descGap: descGap,
      lineHDesc: lineHDesc, lineHDate: lineHDate,
      labelLineH: labelLineH,
      iconColor: iconColor, lineColor: lineColor,
      strokeW: strokeW, dotR: dotR, anyIcon: anyIcon
    };

    var body = [];
    body.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    // Flush-left: first event sits at colW/2 (its content centered
    // within the column, so the label's left edge falls at ~4 px).
    function cx(i) { return (i + 0.5) * colW; }

    // Main horizontal line
    var firstCx = cx(0);
    var lastCx  = cx(n - 1);
    if (n === 1) { firstCx = lastCx = plotWidth / 2; }
    body.push('    <line x1="' + firstCx.toFixed(1) + '" y1="' + lineY.toFixed(1) +
      '" x2="' + lastCx.toFixed(1) + '" y2="' + lineY.toFixed(1) +
      '" stroke="' + lineColor + '" stroke-width="' + strokeW +
      '" stroke-linecap="round"/>');

    for (var i = 0; i < n; i++) {
      var xc = n > 1 ? cx(i) : plotWidth / 2;
      drawHorizontalEvent(body, data[i], wrappedDescs[i], xc, lineY, style);
    }

    body.push('  </g>');
    var bodyOut = legend.svg.concat(body);
    return R.wrapSVG(svgW, svgH, header, footer, bodyOut);
  }

  // ── S-shape layout (serpentine, N rows, semicircle corners) ────
  //
  // When a horizontal timeline has more events than fit on one row at
  // MIN_EVENT_WIDTH, it folds into a snake pattern:
  //   Row 0: L → R
  //   Row 1: R → L   (connected by 180° arc bulging right)
  //   Row 2: L → R   (connected by 180° arc bulging left)
  //   Row 3: R → L   ...
  //
  // Each corner is a true semicircle (rx = ry = rowGapY/2) rendered as
  // a single SVG `A` command. The whole snake is one `<path>` so AI
  // imports it as one editable curve.
  //
  // Arc-adjacent events get a special role:
  //   - "narrow" → the SOURCE of a down-arc on rows 0, 3, 6, ...
  //   - "below"  → the SOURCE of a down-arc on rows 1, 4, 7, ...
  //                AND the DESTINATION of an up-arc on rows 2, 5, 8, …

  function renderSShape(data, ctx, config, eventsPerRow) {
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;
    var f = computeFonts(rs);
    var n = data.length;
    var k = eventsPerRow;               // events per full row
    var rows = Math.ceil(n / k);        // total number of rows

    // Map global event index → visual {row, col, rowEvents}.
    // Even rows are left-aligned (L→R). Odd rows are right-aligned (R→L).
    function eventPos(i) {
      var row = Math.floor(i / k);
      var localIdx = i - row * k;
      var rowEvents = Math.min(k, n - row * k);
      var col;
      if (row % 2 === 0) {
        col = localIdx;                // L→R, left-aligned
      } else {
        col = (k - 1) - localIdx;      // R→L, right-aligned
      }
      return { row: row, col: col, rowEvents: rowEvents, localIdx: localIdx };
    }

    // Arc role for an event. The pattern repeats every 3 rows:
    //
    //   row r, r%3 == 0, last input  → "narrow" (source of down-arc)
    //   row r, r%3 == 1, last input  → "below"  (source of down-arc)
    //   row r, r%3 == 2, first input → "below"  (destination of up-arc)
    //
    // The narrow/below treatments exist to keep text clear of the
    // semicircle CURVE that connects rows in the default mode. Compact
    // L-bracket mode has no curve to dodge — the bracket is small and
    // sits BESIDE the circle, not in the text area — so we skip the
    // role assignments there. That stops the rightmost event of a row
    // from being unnecessarily forced into a 40-px wrap budget and
    // truncated when the label would otherwise fit cleanly.
    //
    // Source of a down-arc only exists when r < rows-1.
    // Destination of an up-arc only exists when r >= 1.
    function eventArcRole(i) {
      if (config.timelineCompactArcs) return null;
      var pos = eventPos(i);
      var r = pos.row;
      var rMod = r % 3;
      var isLast = (pos.localIdx === pos.rowEvents - 1);
      var isFirst = (pos.localIdx === 0);

      if (isLast && r < rows - 1) {
        if (rMod === 0) return "narrow";
        if (rMod === 1) return "below";
      }
      if (rMod === 2 && isFirst && r >= 1) {
        return "below";
      }
      return null;
    }

    // Flush-left: leftmost event sits at x=0, aligned with title
    var marginLeft = 0;
    var marginRight = rs.marginRight;

    // Header
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: ctx.title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });
    var plotTop = R.computePlotTop(rs, header);

    // Optional category legend, when the data has a Category column.
    var catColors = resolveCategoryColors(data, config);
    var legend = { svg: [], height: 0 };
    if (catColors) {
      // Legend strip — only when the toggle is on (default true).
      // Dot-fill stamping below runs unconditionally so a user can
      // hide the legend strip and still get colour-coded dots.
      if (config.timelineLegend !== false) {
        var legendColors = [];
        for (var lc = 0; lc < catColors.ordered.length; lc++) {
          legendColors.push(catColors.map[catColors.ordered[lc]]);
        }
        legend = R.renderStackedLegend({
          x: 0, startY: plotTop,
          names: catColors.ordered,
          colors: legendColors,
          rs: rs, style: st,
          maxWidth: svgW,
          hasSubtitle: !!config.subtitle
        });
        plotTop += legend.height;
      }

      for (var ce = 0; ce < n; ce++) {
        var cev = data[ce];
        if (cev.category && catColors.map[cev.category]) {
          cev._dotFill = catColors.map[cev.category];
        } else {
          cev._dotFill = null;
        }
      }
    } else {
      for (var ce2 = 0; ce2 < n; ce2++) data[ce2]._dotFill = null;
    }

    var plotWidth = svgW - marginLeft - marginRight;

    var anyIcon = hasAnyIcon(data);
    var iconH = anyIcon ? Math.round(rs.valueSize * 1.8) : 0;
    var iconGap = anyIcon ? 5 : 0;
    var strokeW0 = rs.strokeWidth;
    var dateGap = lineGapBelow(f.dateSize, strokeW0);
    var labelGap = lineGapAbove(f.labelSize, strokeW0);
    // Smaller line clearance used when a description sits directly
    // above the line (i.e. the event has no label). Mirrors labelGap
    // but sized for the smaller description font, so a description-
    // only event hugs the line tightly instead of leaving a gap big
    // enough for a missing label.
    var descLineGap = lineGapAbove(f.descSize, strokeW0);
    var descGap = 4;
    var lineHDesc = f.descSize * 1.2;
    var lineHDate = f.dateSize * 1.2;
    var labelLineH = Math.round(f.labelSize * 1.15);

    var sizes = {
      f: f, lineHDate: lineHDate, lineHDesc: lineHDesc,
      labelLineH: labelLineH, iconH: iconH, anyIcon: anyIcon,
      iconGap: iconGap, dateGap: dateGap, labelGap: labelGap,
      descLineGap: descLineGap, descGap: descGap
    };

    // Per-event wrap budget. Default = colW - 8; "narrow" events
    // shrink to NARROW_TEXT_WIDTH.
    //
    // Returns wrap data + PER-ROW max above/below block heights so
    // each row's height fits its OWN content. Rows with only short
    // events stay short; rows with multi-line content grow. The
    // overall max across all rows is also returned for callers that
    // still need it (e.g. arc radius derivation).
    function wrapAll(colW) {
      var defaultMax = Math.max(40, colW - 8);
      var labelTruncCount = 0;
      var wrappedDescs = [];
      var rowAbove = [];
      var rowBelow = [];
      for (var rr = 0; rr < rows; rr++) { rowAbove.push(0); rowBelow.push(0); }
      var maxAbove = 0, maxBelow = 0;

      for (var wi = 0; wi < n; wi++) {
        var ev = data[wi];
        var role = eventArcRole(wi);
        ev._arcRole = role;
        var wrapW = (role === "narrow") ? NARROW_TEXT_WIDTH : defaultMax;

        // Label (wrap to ≤3 lines — content-driven colW keeps most
        // labels at 1-2 lines; the 3rd line is the buffer before
        // truncation. Narrow arc-adjacent events still cap at 3 lines
        // but at NARROW_TEXT_WIDTH so they stay snug against the arc).
        // Truncated labels render in red + underlined and push a
        // warning so over-long ones are still visible to the user.
        var lblText = String(ev.label || "");
        var labelWrap = lblText
          ? R.wrapToFit(lblText, f.labelSize, wrapW, 3, R.LABEL_ADVANCE)
          : { lines: [], fits: true, truncated: false };
        ev._labelLines = labelWrap.lines;
        ev._labelTruncated = labelWrap.truncated;
        if (!labelWrap.fits) labelTruncCount++;

        // Description (wrap to ≤3 lines — same buffer-before-truncate
        // idea). wrapDescription tracks truncation; the renderer
        // applies red + underline when ev._descTruncated is true.
        var descRes = wrapDescription(ev.text, f.descSize, wrapW, 3);
        var descLines = descRes.lines;
        ev._descTruncated = descRes.truncated;
        wrappedDescs.push(descLines);

        // Date — narrow events wrap to multi-line at NARROW_TEXT_WIDTH;
        // others stay single-line truncated. Either way, track
        // truncation so the renderer can flag the date in red +
        // underline.
        if (!ev.date) {
          ev._dateLines = [];
          ev._dateTruncated = false;
        } else if (role === "narrow") {
          var nDate = wrapDate(ev.date, f.dateSize, wrapW, 3);
          ev._dateLines = nDate.lines;
          ev._dateTruncated = nDate.truncated;
        } else {
          var dDate = shortDate(ev.date, 24);
          ev._dateLines = dDate.lines;
          ev._dateTruncated = dDate.truncated;
        }

        var hb = computeBlockSizes(ev, descLines, ev._dateLines, sizes);
        // Per-row maxes — each row sized for ITS own tallest event.
        var evRow = Math.floor(wi / k);
        if (hb.above > rowAbove[evRow]) rowAbove[evRow] = hb.above;
        if (hb.below > rowBelow[evRow]) rowBelow[evRow] = hb.below;
        // Global maxes — used by callers that need a single value
        // (e.g. arc radius derivation when all rows happen to share).
        if (hb.above > maxAbove) maxAbove = hb.above;
        if (hb.below > maxBelow) maxBelow = hb.below;
      }
      if (labelTruncCount > 0) {
        R.pushWarning("label-truncated", { count: labelTruncCount,
          suggestion: "Try a wider chart, fewer events per row, or shorter event labels" });
      }
      return {
        descs: wrappedDescs,
        rowAbove: rowAbove, rowBelow: rowBelow,
        maxAbove: maxAbove, maxBelow: maxBelow
      };
    }

    // Compact mode: rows are connected by vertical dashed lines
    // instead of curved semicircle arcs. The connector takes almost
    // no horizontal space (it's a thin line at the row endpoint x)
    // and very little vertical space (no curve), so we can pack the
    // rows much tighter.
    var compact = !!config.timelineCompactArcs;

    // Provisional layout pass: no arc margin yet
    var colW = plotWidth / k;
    var w0 = wrapAll(colW);
    var rowBlockH = w0.maxAbove + w0.maxBelow;

    // Compact connector geometry. Total row gap is driven directly
    // by the user slider; the arrow body is a fixed small marker
    // beside the edge circle.
    //   - ROW_GAP_FLOOR: hard min so the arrow has somewhere to live
    //     even when the user drags the slider as low as it goes.
    //   - ARROW_RESERVE: horizontal space outside the row's column
    //     for the arrow stem + head, so the arrow doesn't run off
    //     the canvas at the right (or left, for odd rows).
    var ROW_GAP_FLOOR = 14;
    var ARROW_RESERVE = 8;
    var BRACKET_RESERVE = ARROW_RESERVE;

    // Total row gap is always a real px value, driven by the slider.
    // Default in DataStore is 30 — slider range 14-80, so reset → 30.
    var rowGapY = Math.max(ROW_GAP_FLOOR,
      (config.timelineRowGap && config.timelineRowGap > 0) ? config.timelineRowGap : 30);
    var arcRadius = compact ? 0 : rowGapY / 2;

    // Per-side reserve:
    //   - Curved arcs need horizontal room equal to arcRadius for
    //     the semicircle bulge to fit beside the row.
    //   - Compact L-bracket connectors need a smaller reserve
    //     (BRACKET_RESERVE) on the outside of the edge circles so
    //     the bracket doesn't run off the canvas.
    //   - Right-side reserve is needed whenever rows ≥ 2 (a row 0→1
    //     transition exists). Left-side reserve is needed only when
    //     rows ≥ 3 (a row 1→2 transition exists).
    //   - For 2-row timelines this lets row 0 start at x ≈ 0 (flush
    //     with the title) since there's no left-side transition.
    function computeSideReserve(side) {
      if (compact) {
        if (side === "right") return rows >= 2 ? BRACKET_RESERVE : 0;
        return rows >= 3 ? BRACKET_RESERVE : 0;
      }
      if (side === "right") return arcRadius;
      return rows >= 3 ? arcRadius : 0;
    }

    var leadingArc = computeSideReserve("left");
    var trailingArc = computeSideReserve("right");

    // Refine: subtract reserve from plot width and re-wrap.
    var eventsPlotW = plotWidth - leadingArc - trailingArc;
    colW = eventsPlotW / k;
    var w1 = wrapAll(colW);
    rowBlockH = w1.maxAbove + w1.maxBelow;
    // Recalculate after the second wrap pass — rowGapY itself doesn't
    // depend on row content, but the side reserves do (arc radius uses
    // half the gap), so we re-derive both for clarity even though the
    // values are usually identical to the first pass.
    rowGapY = Math.max(ROW_GAP_FLOOR,
      (config.timelineRowGap && config.timelineRowGap > 0) ? config.timelineRowGap : 30);
    arcRadius = compact ? 0 : rowGapY / 2;
    leadingArc = computeSideReserve("left");
    trailingArc = computeSideReserve("right");
    eventsPlotW = plotWidth - leadingArc - trailingArc;
    colW = eventsPlotW / k;

    // Per-row sizes — each row's row line sits at "above this row"
    // pixels below the row's top, and its block extends "below this
    // row" pixels under the line. Rows where every event has only a
    // single-line label and no description stay short; rows with
    // multi-line content grow only by what they need.
    var rowAbove = w1.rowAbove;
    var rowBelow = w1.rowBelow;
    var rowYs = [];
    var plotHeight = 0;
    for (var ri = 0; ri < rows; ri++) {
      var thisAbove = rowAbove[ri] || 0;
      var thisBelow = rowBelow[ri] || 0;
      rowYs.push(plotHeight + thisAbove);
      plotHeight += thisAbove + thisBelow;
      if (ri < rows - 1) plotHeight += rowGapY;
    }

    // Footer — gap added by computeFooterStart only when footer has text
    var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height)  // request, but never clip content
      : (footerStartY + footer.height);

    var lineColor = (config.colors && config.colors[0]) || "#009EDB";
    var iconColor = config.rowIconColor || lineColor;
    var strokeW = rs.strokeWidth;
    var dotR = dotRadius(svgW);

    var style = {
      f: f, fonts: fonts, st: st,
      iconH: iconH, iconGap: iconGap, dateGap: dateGap,
      labelGap: labelGap, descLineGap: descLineGap, descGap: descGap,
      lineHDesc: lineHDesc, lineHDate: lineHDate,
      labelLineH: labelLineH,
      iconColor: iconColor, lineColor: lineColor,
      strokeW: strokeW, dotR: dotR, anyIcon: anyIcon
    };

    // Column x-center helper
    function cellCx(col) { return leadingArc + (col + 0.5) * colW; }

    // Build the snake. Default mode emits ONE continuous path with
    // semicircle arcs joining the rows. Compact mode emits one path
    // per row plus one dashed straight connector per row break, so
    // the connectors render with a different stroke style.
    var rowPaths = [];      // { d, dashed: false } per row line + per connector
    for (var r = 0; r < rows; r++) {
      var rowEvents = (r === rows - 1) ? (n - r * k) : k;
      var y = rowYs[r];
      var rowStartX, rowEndX;
      if (r % 2 === 0) {
        rowStartX = cellCx(0);
        rowEndX   = cellCx(rowEvents - 1);
      } else {
        rowStartX = cellCx(k - 1);
        rowEndX   = cellCx(k - rowEvents);
      }

      // Each row line is its own path so connectors can have their
      // own dasharray independently.
      rowPaths.push({
        d: "M" + rowStartX.toFixed(1) + "," + y.toFixed(1) +
           " L" + rowEndX.toFixed(1) + "," + y.toFixed(1),
        dashed: false
      });

      // Receiving-end L marker: small L bracket showing where the
      // line "came from above". Mirrors the outgoing arrow but
      // shorter (no arrowhead) and aligned at the same horizontal
      // offset from the circle as the outgoing arrow's corner — so
      // the corner of the incoming L sits exactly under the tip of
      // the outgoing arrow above it. Only drawn in compact mode and
      // only on rows that have a previous row (r ≥ 1).
      if (compact && r > 0) {
        var IN_HORIZ = 15;                  // matches the outgoing ARROW_STUB_H
        var IN_VERT = 6;                    // small vertical going up from row line
        // Receiving side = same as the previous row's outgoing side.
        // Row 0 outgoing right → row 1 receiving on right (rightmost dot).
        // Row 1 outgoing left  → row 2 receiving on left (leftmost dot).
        var inDirH = ((r - 1) % 2 === 0) ? 1 : -1;
        var inAnchorX = (inDirH > 0) ? cellCx(k - 1) : cellCx(0);
        var inAttachX = inAnchorX + dotR * inDirH;          // touch circle edge
        var inCornerX = inAttachX + IN_HORIZ * inDirH;      // 90° corner outward
        var inTopY = y - IN_VERT;

        // Path: vertical down from top, 90° turn, horizontal back to circle.
        rowPaths.push({
          d: "M" + inCornerX.toFixed(1) + "," + inTopY.toFixed(1) +
             " L" + inCornerX.toFixed(1) + "," + y.toFixed(1) +
             " L" + inAttachX.toFixed(1) + "," + y.toFixed(1),
          dashed: false
        });
      }

      if (r < rows - 1) {
        var nextY = rowYs[r + 1];
        // Connector x is the row's "outer" endpoint — right edge for
        // even rows (L→R), left edge for odd rows (R→L).
        var connectorX = (r % 2 === 0) ? cellCx(k - 1) : cellCx(0);
        var dirH = (r % 2 === 0) ? 1 : -1; // outward direction (right=+1, left=-1)

        if (compact) {
          // Compact mode: an L-shaped arrow off the outgoing edge of
          // row r. Shape:
          //
          //   ●━━━━━┓
          //         ┃
          //        ╲╱        ← chevron arrowhead (two stroked wings)
          //
          // Stem runs all the way to the tip; the head is two
          // separate strokes coming up-and-out from the tip, drawn
          // with the same stroke style as the rest of the line so
          // the arrow reads as a single continuous gesture.
          //
          // The horizontal stub clears the date/text under the dot.
          var ARROW_STUB_H = 15;          // horizontal segment off the circle
          var ARROW_DROP = Math.max(10, Math.round(rowGapY * 0.55));
          var ARROW_WING_DX = 4;          // wing horizontal offset from tip
          var ARROW_WING_DY = 4;          // wing vertical rise from tip
          var attachX = connectorX + dotR * dirH;             // touch the circle edge
          var cornerX = attachX + ARROW_STUB_H * dirH;        // 90° corner
          var arrowTip = y + ARROW_DROP;

          // Bracket + stem: horizontal stub from circle, then 90°
          // corner, then vertical stem all the way down to the tip.
          rowPaths.push({
            d: "M" + attachX.toFixed(1) + "," + y.toFixed(1) +
               " L" + cornerX.toFixed(1) + "," + y.toFixed(1) +
               " L" + cornerX.toFixed(1) + "," + arrowTip.toFixed(1),
            dashed: false
          });
          // Chevron arrowhead: two stroked wings from the tip going
          // up-and-out. Drawn as a single path for clean line joins.
          rowPaths.push({
            d: "M" + (cornerX - ARROW_WING_DX).toFixed(1) + "," + (arrowTip - ARROW_WING_DY).toFixed(1) +
               " L" + cornerX.toFixed(1) + "," + arrowTip.toFixed(1) +
               " L" + (cornerX + ARROW_WING_DX).toFixed(1) + "," + (arrowTip - ARROW_WING_DY).toFixed(1),
            dashed: false
          });
        } else {
          // Curved semicircle. sweep=1 → right-bulge (even row → odd row),
          // sweep=0 → left-bulge (odd row → even row).
          var sweep = (r % 2 === 0) ? "1" : "0";
          rowPaths.push({
            d: "M" + connectorX.toFixed(1) + "," + y.toFixed(1) +
               " A" + arcRadius.toFixed(1) + "," + arcRadius.toFixed(1) +
               " 0 0 " + sweep + " " + connectorX.toFixed(1) + "," + nextY.toFixed(1),
            dashed: false
          });
        }
      }
    }

    var body = [];
    body.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');
    for (var rp = 0; rp < rowPaths.length; rp++) {
      var rpItem = rowPaths[rp];
      if (rpItem.type === "fill") {
        // Filled shape (compact-mode arrowhead) — solid line colour,
        // no stroke so the triangle reads as a clean arrow tip.
        body.push('    <path d="' + rpItem.d + '" fill="' + lineColor +
          '" stroke="none"/>');
      } else {
        var dashAttr = rpItem.dashed ? ' stroke-dasharray="' + Math.round(strokeW * 2) + ',' + Math.round(strokeW * 2) + '"' : '';
        body.push('    <path d="' + rpItem.d + '" fill="none" stroke="' + lineColor +
          '" stroke-width="' + strokeW + '" stroke-linecap="round" stroke-linejoin="round"' + dashAttr + '/>');
      }
    }

    // Events on top
    for (var i = 0; i < n; i++) {
      var pos = eventPos(i);
      drawHorizontalEvent(body, data[i], w1.descs[i], cellCx(pos.col), rowYs[pos.row], style);
    }

    body.push('  </g>');
    var bodyOut = legend.svg.concat(body);
    return R.wrapSVG(svgW, svgH, header, footer, bodyOut);
  }

  // ── Vertical layout ─────────────────────────────────────
  //
  // Layout (per event):
  //
  //   icon    │     LABEL (bold)
  //   date    ●     description (wrapped)
  //           │
  //
  // Line runs top-to-bottom through the dots. Left column holds
  // icon + date, right column holds label + description.

  function renderVertical(data, ctx, config) {
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;
    var f = computeFonts(rs);
    var n = data.length;

    // Flush-left: leftmost event sits at x=0, aligned with title
    var marginLeft = 0;
    var marginRight = rs.marginRight;

    // Header
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: ctx.title, subtitle: config.subtitle, comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var plotTop = R.computePlotTop(rs, header);

    // Optional category legend, when the data has a Category column.
    // For vertical timelines the legend sits in the same place as the
    // horizontal flavour — between the header and the plot.
    var catColors = resolveCategoryColors(data, config);
    var legend = { svg: [], height: 0 };
    if (catColors) {
      // Legend strip — only when the toggle is on (default true).
      // Dot-fill stamping below runs unconditionally so a user can
      // hide the legend strip and still get colour-coded dots.
      if (config.timelineLegend !== false) {
        var legendColors = [];
        for (var lc = 0; lc < catColors.ordered.length; lc++) {
          legendColors.push(catColors.map[catColors.ordered[lc]]);
        }
        legend = R.renderStackedLegend({
          x: 0, startY: plotTop,
          names: catColors.ordered,
          colors: legendColors,
          rs: rs, style: st,
          maxWidth: svgW,
          hasSubtitle: !!config.subtitle
        });
        plotTop += legend.height;
      }

      for (var ce = 0; ce < n; ce++) {
        var cev = data[ce];
        if (cev.category && catColors.map[cev.category]) {
          cev._dotFill = catColors.map[cev.category];
        } else {
          cev._dotFill = null;
        }
      }
    } else {
      for (var ce2 = 0; ce2 < n; ce2++) data[ce2]._dotFill = null;
    }

    var plotWidth = svgW - marginLeft - marginRight;

    // Layout columns: leftCol (icon + date) | gutter | rightCol (label + description)
    // Line runs through the vertical divider between left and right (near ~35% mark).
    var leftColW = Math.max(60, Math.round(plotWidth * 0.30));
    var gutter   = 16;           // space reserved for the line + dot
    var rightColX = leftColW + gutter;
    var rightColW = plotWidth - rightColX;
    var lineX = leftColW + gutter / 2;

    var anyIcon = hasAnyIcon(data);
    var iconH = anyIcon ? Math.round(rs.valueSize * 1.8) : 0;

    // Per-event row height: max of (icon + date) left and (label + wrapped desc) right.
    var lineHDesc = f.descSize * 1.2;
    var rowGapY = 22; // breathing space between events

    // Wrap descriptions against the right column width.
    // wrapDescription tracks truncation so the renderer can apply
    // the red + underline error treatment when content gets cut.
    var wrappedDescs = [];
    var descTruncatedFlags = [];
    var rowHeights = [];
    for (var wi = 0; wi < n; wi++) {
      var dRes = wrapDescription(data[wi].text, f.descSize, rightColW - 8, 6);
      var lines = dRes.lines;
      wrappedDescs.push(lines);
      descTruncatedFlags.push(dRes.truncated);

      var rightH = (data[wi].label ? f.labelSize + 4 : 0) + lines.length * lineHDesc;
      var leftH = (anyIcon && data[wi]._iconSvg ? iconH + 4 : 0) + (data[wi].date ? f.dateSize : 0);
      var h = Math.max(rightH, leftH, 30);
      rowHeights.push(h);
    }

    // Total plot height = sum of row heights + gaps
    var plotHeight = 0;
    for (var ri = 0; ri < n; ri++) {
      plotHeight += rowHeights[ri];
      if (ri < n - 1) plotHeight += rowGapY;
    }

    // Footer — gap added by computeFooterStart only when footer has text
    var footerStartY = R.computeFooterStart(rs, plotTop + plotHeight, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer, rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });
    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height)  // request, but never clip content
      : (footerStartY + footer.height);

    var lineColor = (config.colors && config.colors[0]) || "#009EDB";
    var iconColor = config.rowIconColor || lineColor;
    var strokeW = rs.strokeWidth;
    var dotR = dotRadius(svgW);

    var body = [];
    body.push('  <g transform="translate(' + marginLeft + ',' + plotTop + ')">');

    // Main vertical line (from first dot to last dot)
    // Dot sits at y = <center of each row>.
    var dotYs = [];
    var y = 0;
    for (var ci = 0; ci < n; ci++) {
      dotYs.push(y + rowHeights[ci] / 2);
      y += rowHeights[ci] + rowGapY;
    }

    if (n > 1) {
      body.push('    <line x1="' + lineX.toFixed(1) + '" y1="' + dotYs[0].toFixed(1) +
        '" x2="' + lineX.toFixed(1) + '" y2="' + dotYs[n - 1].toFixed(1) +
        '" stroke="' + lineColor + '" stroke-width="' + strokeW +
        '" stroke-linecap="round"/>');
    }

    for (var i = 0; i < n; i++) {
      var ev = data[i];
      var dy = dotYs[i];

      // --- Left column: icon (top) then date (below it, both right-aligned near the line) ---
      var leftAnchor = "end";
      var leftRightEdge = lineX - 10; // 10px gap between text and the vertical line

      var leftY = dy; // vertical center of row

      // Stack icon above date: compute individual baselines
      var hasIcon = anyIcon && ev._iconSvg;
      var hasDate = !!ev.date;

      if (hasIcon) {
        var dims = R.getIconDims(ev._iconSvg, iconH, false);
        var icoX = leftRightEdge - dims.w;
        var icoY = leftY - (hasDate ? (iconH + 4 + f.dateSize / 2) : iconH / 2);
        // If only icon, center vertically on dot
        body.push('    ' + R.buildIconGroup(ev._iconSvg, iconH, icoX, icoY, iconColor, false));
      }

      if (hasDate) {
        var dateBaselineY;
        if (hasIcon) {
          // Date baseline sits below icon
          dateBaselineY = leftY + (iconH / 2) - 2;
        } else {
          // Only date — center it on the dot line
          dateBaselineY = leftY + f.dateSize / 2 - 1;
        }
        // Date — track truncation so we can flag the user via red +
        // underline when the date string was actually cut.
        var rawDateV = String(ev.date);
        var dateTextV = R.truncate(rawDateV, 24);
        var vDateTrunc = dateTextV !== rawDateV;
        var vDateColor = vDateTrunc ? R.FADED_LABEL_COLOR : st.labelColor;
        var vDateDeco = vDateTrunc ? ' text-decoration="underline"' : '';
        body.push('    <text x="' + leftRightEdge.toFixed(1) + '" y="' + dateBaselineY.toFixed(1) +
          '" font-family="' + fonts.label + '" font-weight="700" font-size="' + f.dateSize +
          '" fill="' + vDateColor + '"' + vDateDeco + ' text-anchor="' + leftAnchor + '">' +
          R.escapeXml(dateTextV) + '</text>');
      }

      // --- Dot on the line ---
      // Category-coloured fill when the data has a Category column;
      // resolveCategoryColors stamps the colour onto each event before
      // this loop runs.
      var dotFillV = ev._dotFill || "#ffffff";
      body.push('    <circle cx="' + lineX.toFixed(1) + '" cy="' + dy.toFixed(1) +
        '" r="' + dotR + '" fill="' + dotFillV + '" stroke="' + lineColor +
        '" stroke-width="' + (strokeW * 0.9).toFixed(1) + '"/>');

      // --- Right column: label then description ---
      var rx = rightColX;
      var rightTopY = dy - rowHeights[i] / 2;
      var rAnchor = "start";

      var cursorY = rightTopY + f.labelSize; // first baseline
      if (ev.label) {
        var rawLblV = String(ev.label);
        var lblTextV = R.truncate(rawLblV, 40);
        var vLblTrunc = lblTextV !== rawLblV;
        var vLblColor = vLblTrunc ? R.FADED_LABEL_COLOR : st.valueColor;
        var vLblDeco = vLblTrunc ? ' text-decoration="underline"' : '';
        body.push('    <text x="' + rx.toFixed(1) + '" y="' + cursorY.toFixed(1) +
          '" font-family="' + fonts.value + '" font-weight="700" font-size="' + f.labelSize +
          '" fill="' + vLblColor + '"' + vLblDeco + ' text-anchor="' + rAnchor + '">' +
          R.escapeXml(lblTextV) + '</text>');
        cursorY += 4; // small gap before description
      }

      var descLines = wrappedDescs[i];
      var vDescTrunc = !!descTruncatedFlags[i];
      var vDescColor = vDescTrunc ? R.FADED_LABEL_COLOR : st.labelColor;
      var vDescDeco = vDescTrunc ? ' text-decoration="underline"' : '';
      if (descLines && descLines.length) {
        var dYstart = cursorY + f.descSize;
        for (var dl = 0; dl < descLines.length; dl++) {
          body.push('    <text x="' + rx.toFixed(1) + '" y="' + (dYstart + dl * lineHDesc).toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + f.descSize +
            '" fill="' + vDescColor + '"' + vDescDeco + ' text-anchor="' + rAnchor + '">' +
            R.escapeXml(descLines[dl]) + '</text>');
        }
      }
    }

    body.push('  </g>');
    var bodyOut = legend.svg.concat(body);
    return R.wrapSVG(svgW, svgH, header, footer, bodyOut);
  }

  // ── Entry point ─────────────────────────────────────────

  function render(title, data, config) {
    if (!data || !data.length) return null;

    var ctx = R.initRender(config);
    ctx.title = title;

    var orient = config.timelineOrientation || "horizontal";

    if (orient === "vertical") {
      return renderVertical(data, ctx, config);
    }
    // default: horizontal
    return renderHorizontal(data, ctx, config);
  }

  R.register("timeline", "Timeline", render);
})();
