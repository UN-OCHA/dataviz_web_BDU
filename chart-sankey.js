/**
 * Sankey Diagram Renderer
 *
 * Renders a Sankey flow diagram showing weighted connections between
 * nodes. Data: 3-column rows — Source, Target, Value.
 *
 * ── Same-label handling (Source vs Target) ───────────────────────
 * The DEFAULT respects the sheet's columns: the Source column is the
 * LEFT stage and the Target column is the RIGHT stage. A label that
 * appears in BOTH columns is therefore drawn as TWO separate nodes —
 * a left (origin) node and a right (destination) node. This is what
 * movement / flow data wants: e.g. Niger as an origin (Niger → Cameroon)
 * is a different node from Niger as a destination (Mali → Niger).
 *
 * The one exception is a genuine multi-step PIPELINE — funding that
 * passes through a sector on the way to a country (Funding → Health,
 * Health → Sudan), where "Health" really is one node bridging two
 * levels. That's the opt-in "connect" mode.
 *
 * config.sankeyNodeMode:
 *   • "auto" (default) / "separate" → respect columns (split). Same
 *     label in Source and Target = two nodes, one on each side.
 *   • "connect" → chain repeated labels into a multi-level flow.
 */

/* global ChartRegistry */

(function () {
  "use strict";

  var R = ChartRegistry;

  // ── Graph builder ────────────────────────────────────
  // Builds nodes/links keyed by a node KEY. In "connect" mode the key
  // IS the name (so repeated labels merge across columns). In "split"
  // mode the key is role-prefixed, so the same name in the Source and
  // Target columns becomes two distinct nodes. Returns:
  //   { nodeByKey, nodes[], links[{sourceKey,targetKey,value}],
  //     levels[[node]], maxLevel }
  function buildGraph(data, mode) {
    var nodeByKey = {}, nodes = [], links = [], idx = 0;

    function ensure(key, name, level) {
      if (!nodeByKey[key]) {
        var n = { key: key, name: name, incoming: 0, outgoing: 0,
                  index: idx++, level: (level == null ? 0 : level) };
        nodeByKey[key] = n;
        nodes.push(n);
      }
      return nodeByKey[key];
    }

    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      // In split mode, role-prefix the key with a \u0001 control
      // char so the same label in the Source vs Target column
      // becomes two distinct nodes. The control char can't appear
      // in a real sheet value, so "s\u0001Mali" (origin) and
      // "t\u0001Mali" (destination) never collide with each other
      // or with any other label. In connect mode the key IS the
      // name, so repeated labels merge across columns into a chain.
      var sKey = (mode === "split") ? ("s" + d.source) : d.source;
      var tKey = (mode === "split") ? ("t" + d.target) : d.target;
      var sn = ensure(sKey, d.source, mode === "split" ? 0 : null);
      var tn = ensure(tKey, d.target, mode === "split" ? 1 : null);
      sn.outgoing += d.value;
      tn.incoming += d.value;
      links.push({ sourceKey: sKey, targetKey: tKey, value: d.value });
    }

    for (var ti = 0; ti < nodes.length; ti++) {
      nodes[ti].totalFlow = Math.max(nodes[ti].incoming, nodes[ti].outgoing);
    }

    var levels, maxLevel;

    if (mode === "split") {
      // Strict 2-level bipartite: sources left, targets right.
      maxLevel = 1;
      levels = [[], []];
      for (var si = 0; si < nodes.length; si++) levels[nodes[si].level].push(nodes[si]);
    } else {
      // Connect mode: name-keyed BFS longest-path layering (multi-level).
      var levelMap = {};
      maxLevel = 0;
      var adj = {};
      for (var li = 0; li < links.length; li++) {
        (adj[links[li].sourceKey] = adj[links[li].sourceKey] || []).push(links[li].targetKey);
      }
      var queue = [];
      for (var ni = 0; ni < nodes.length; ni++) {
        if (nodes[ni].incoming === 0) { levelMap[nodes[ni].key] = 0; queue.push(nodes[ni].key); }
      }
      if (queue.length === 0) {            // fully circular — flatten to one level
        for (var ci = 0; ci < nodes.length; ci++) { levelMap[nodes[ci].key] = 0; queue.push(nodes[ci].key); }
      }
      var visited = {};
      var guard = 0, guardMax = nodes.length * links.length + nodes.length + 10;
      while (queue.length > 0 && guard++ < guardMax) {
        var cur = queue.shift();
        if (visited[cur]) continue;
        visited[cur] = true;
        var outs = adj[cur] || [];
        for (var oi = 0; oi < outs.length; oi++) {
          var tgt = outs[oi];
          var nl = (levelMap[cur] || 0) + 1;
          if (levelMap[tgt] == null || nl > levelMap[tgt]) levelMap[tgt] = nl;
          if (nl > maxLevel) maxLevel = nl;
          queue.push(tgt);
        }
      }
      levels = [];
      for (var lv = 0; lv <= maxLevel; lv++) levels.push([]);
      for (var gi = 0; gi < nodes.length; gi++) {
        var lvl = levelMap[nodes[gi].key] || 0;
        nodes[gi].level = lvl;
        levels[lvl].push(nodes[gi]);
      }
    }

    // Sort nodes within each level by total flow (largest on top).
    for (var sl = 0; sl < levels.length; sl++) {
      levels[sl].sort(function (a, b) { return b.totalFlow - a.totalFlow; });
    }

    return { nodeByKey: nodeByKey, nodes: nodes, links: links, levels: levels, maxLevel: maxLevel };
  }

  function render(title, data, config) {
    if (!data || !data.length) return null;

    config = config || {};
    var ctx = R.initRender(config);
    var svgW = ctx.svgW, rs = ctx.rs, vPad = ctx.vPad, st = ctx.st, fonts = ctx.fonts;

    var colors = config.colors || ["#009EDB"];
    var nodeWidth = config.sankeyNodeWidth || 20;
    var nodePadding = config.sankeyNodePadding || 15;
    var linkOpacity = (config.sankeyLinkOpacity != null ? config.sankeyLinkOpacity : 0.4);
    var labelMode = config.sankeyLabelMode || "both";

    // Resolve same-label handling. The DEFAULT respects the columns: the
    // Source column is the left stage and the Target column is the right
    // stage, so a label that appears in both (e.g. Niger as both an
    // origin and a destination) is drawn as two separate nodes — one on
    // each side. Only "connect" chains repeated labels into a multi-step
    // flow (funding pipelines: Funding → Health → Country). Any other
    // value ("auto", legacy "separate") means respect-columns / split.
    var modePref = config.sankeyNodeMode || "auto";
    var mode = (modePref === "connect") ? "connect" : "split";

    // Flush-left: leftmost source nodes at x=0, aligned with title
    var marginLeft = 0;
    var marginRight = 10;

    // ── Header ────────────────────────────────────────
    var header = R.renderHeader({
      x: 0, startY: 6,
      title: title,
      subtitle: config.subtitle,
      comments: config.comments,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.headerTextWidth
    });

    var chartTop = R.computePlotTop(rs, header);

    // ── Build graph (nodes / links / levels) ──────────
    var graph = buildGraph(data, mode);
    var nodeByKey = graph.nodeByKey;
    var nodes = graph.nodes;
    var links = graph.links;
    var levels = graph.levels;
    var maxLevel = graph.maxLevel;

    // ── Compute positions ─────────────────────────────
    var chartWidth = svgW - marginLeft - marginRight;
    var numLevels = levels.length;

    // Label measurement: estimate max label width for left and right columns
    var fontSize = rs.labelSize;
    // Sankey labels render in fonts.label (Roboto Condensed)
    var avgCharW = fontSize * R.LABEL_ADVANCE;

    // Estimate label widths for left and right labels
    var leftLabelW = 0;
    var rightLabelW = 0;
    for (var eli = 0; eli < levels.length; eli++) {
      for (var eni = 0; eni < levels[eli].length; eni++) {
        var nd = levels[eli][eni];
        var lblText = buildLabelText(nd.name, nd.totalFlow, labelMode, config.numFmt);
        var lblW = lblText.length * avgCharW;
        if (eli === 0) leftLabelW = Math.max(leftLabelW, lblW);
        if (eli === levels.length - 1) rightLabelW = Math.max(rightLabelW, lblW);
      }
    }

    // Diagram area: leave just enough room for left/right labels.
    // Source labels are drawn at nodePos.x - 4 with text-anchor="end",
    // so the label's LEFT edge sits at diagramLeft - 4 - leftLabelW.
    // Setting diagramLeft = leftLabelW + 4 puts that left edge exactly
    // at x=0 — perceptually flush with the title (no spurious padding).
    var labelGap = 4;
    var diagramLeft = Math.min(leftLabelW + labelGap, chartWidth * 0.25);
    var diagramRight = chartWidth - Math.min(rightLabelW + labelGap, chartWidth * 0.25);
    var diagramWidth = diagramRight - diagramLeft;

    // X positions for each level
    var levelX = [];
    if (numLevels === 1) {
      levelX.push(diagramLeft + diagramWidth / 2 - nodeWidth / 2);
    } else {
      for (var xi = 0; xi < numLevels; xi++) {
        levelX.push(diagramLeft + (xi / (numLevels - 1)) * (diagramWidth - nodeWidth));
      }
    }

    // Compute total flow across levels to determine chart height
    var maxLevelHeight = 0;
    for (var mli = 0; mli < levels.length; mli++) {
      var totalLevelFlow = 0;
      for (var mni = 0; mni < levels[mli].length; mni++) {
        totalLevelFlow += levels[mli][mni].totalFlow;
      }
      var levelH = totalLevelFlow + nodePadding * (levels[mli].length - 1);
      if (levelH > maxLevelHeight) maxLevelHeight = levelH;
    }

    // Scale factor: fit within available height
    var availableH = Math.max(120, rs.defaultPlotHeight * vPad);
    var scaleFactor = maxLevelHeight > 0 ? Math.min(availableH / maxLevelHeight, 3) : 1;

    // Position nodes vertically within each level — keyed by node.key
    var nodePositions = {}; // key -> { x, y, height }

    for (var pl = 0; pl < levels.length; pl++) {
      var colNodes = levels[pl];
      var yStart = 0; // relative to chartTop
      for (var pn = 0; pn < colNodes.length; pn++) {
        var nh = colNodes[pn].totalFlow * scaleFactor;
        nodePositions[colNodes[pn].key] = {
          x: levelX[pl],
          y: yStart,
          height: Math.max(nh, 2)
        };
        yStart += nh + nodePadding;
      }
    }

    // ── Compute link paths (source/target port offsets) ──
    // Track how much of each node's height has been "used" for links
    var sourceOffsets = {};
    var targetOffsets = {};
    for (var oi = 0; oi < nodes.length; oi++) {
      sourceOffsets[nodes[oi].key] = 0;
      targetOffsets[nodes[oi].key] = 0;
    }

    // Sort links by value (largest first) for better visual layering
    links.sort(function (a, b) { return b.value - a.value; });

    var linkPaths = [];
    for (var lk = 0; lk < links.length; lk++) {
      var link = links[lk];
      var srcPos = nodePositions[link.sourceKey];
      var tgtPos = nodePositions[link.targetKey];
      if (!srcPos || !tgtPos) continue;

      var srcNode = nodeByKey[link.sourceKey];
      var tgtNode = nodeByKey[link.targetKey];

      // Link thickness proportional to value
      var linkH = (link.value / srcNode.totalFlow) * srcPos.height;
      var linkHtgt = (link.value / tgtNode.totalFlow) * tgtPos.height;

      // Source port: right edge
      var sx = srcPos.x + nodeWidth;
      var sy = srcPos.y + sourceOffsets[link.sourceKey];
      sourceOffsets[link.sourceKey] += linkH;

      // Target port: left edge
      var tx = tgtPos.x;
      var ty = tgtPos.y + targetOffsets[link.targetKey];
      targetOffsets[link.targetKey] += linkHtgt;

      // Cubic bezier control point at horizontal midpoint
      var mx = (sx + tx) / 2;

      linkPaths.push({
        sourceKey: link.sourceKey,
        targetKey: link.targetKey,
        value: link.value,
        sy: sy, sh: linkH,
        ty: ty, th: linkHtgt,
        sx: sx, tx: tx, mx: mx,
        sourceIndex: srcNode.index
      });
    }

    // ── Compute total chart height ────────────────────
    var maxNodeBottom = 0;
    for (var nbi in nodePositions) {
      if (nodePositions.hasOwnProperty(nbi)) {
        var bot = nodePositions[nbi].y + nodePositions[nbi].height;
        if (bot > maxNodeBottom) maxNodeBottom = bot;
      }
    }

    var chartH = maxNodeBottom + 10;

    // ── Footer ────────────────────────────────────────
    // Gap added by computeFooterStart only when footer has text
    var footerStartY = R.computeFooterStart(rs, chartTop + chartH, !!config.footer);
    var footer = R.renderFooter({
      x: 0, startY: footerStartY,
      footer: config.footer,
      rs: rs, style: st, vPad: vPad,
      maxWidth: svgW, widthPercent: config.footerTextWidth
    });

    var svgH = config.height
      ? Math.max(config.height, footerStartY + footer.height + rs.marginBottom)  // request, but never clip content
      : (footerStartY + footer.height + rs.marginBottom);

    // ── Build SVG ─────────────────────────────────────
    var svg = [];
    svg.push(R.svgOpen(svgW, svgH));
    svg.push(R.svgBg(svgW, svgH));

    // Header
    for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);

    // Chart group
    svg.push('  <g transform="translate(' + marginLeft + ',' + chartTop + ')">');

    // ── Draw links (behind nodes) ─────────────────────
    for (var di = 0; di < linkPaths.length; di++) {
      var lp = linkPaths[di];
      var colorIdx = lp.sourceIndex % colors.length;
      var linkColor = colors[colorIdx];

      // Cubic bezier path (filled band)
      var d = "M" + lp.sx.toFixed(1) + "," + lp.sy.toFixed(1) +
        " C" + lp.mx.toFixed(1) + "," + lp.sy.toFixed(1) +
        " " + lp.mx.toFixed(1) + "," + lp.ty.toFixed(1) +
        " " + lp.tx.toFixed(1) + "," + lp.ty.toFixed(1) +
        " L" + lp.tx.toFixed(1) + "," + (lp.ty + lp.th).toFixed(1) +
        " C" + lp.mx.toFixed(1) + "," + (lp.ty + lp.th).toFixed(1) +
        " " + lp.mx.toFixed(1) + "," + (lp.sy + lp.sh).toFixed(1) +
        " " + lp.sx.toFixed(1) + "," + (lp.sy + lp.sh).toFixed(1) +
        " Z";

      svg.push('    <path d="' + d + '" fill="' + linkColor +
        '" opacity="' + linkOpacity.toFixed(2) + '"/>');
    }

    // ── Draw nodes ────────────────────────────────────
    for (var ndi = 0; ndi < nodes.length; ndi++) {
      var node = nodes[ndi];
      var pos = nodePositions[node.key];
      if (!pos) continue;

      var cIdx = node.index % colors.length;
      var nodeColor = colors[cIdx];
      var nh = Math.max(pos.height, 2);

      svg.push('    <rect x="' + pos.x.toFixed(1) + '" y="' + pos.y.toFixed(1) +
        '" width="' + nodeWidth + '" height="' + nh.toFixed(1) +
        '" fill="' + nodeColor + '"/>');
    }

    // ── Draw labels ───────────────────────────────────
    if (labelMode !== "none") {
      for (var lb = 0; lb < nodes.length; lb++) {
        var lNode = nodes[lb];
        var lPos = nodePositions[lNode.key];
        if (!lPos) continue;

        var text = buildLabelText(lNode.name, lNode.totalFlow, labelMode, config.numFmt);
        if (!text) continue;

        var textY = lPos.y + lPos.height / 2 + fontSize * 0.35;
        var textX, anchor;

        if (lNode.level === 0) {
          // Leftmost: label to the left of node
          textX = lPos.x - 4;
          anchor = "end";
        } else if (lNode.level === maxLevel) {
          // Rightmost: label to the right of node
          textX = lPos.x + nodeWidth + 4;
          anchor = "start";
        } else {
          // Middle: label to the right of node
          textX = lPos.x + nodeWidth + 4;
          anchor = "start";
        }

        // Wrap to up to 3 lines that fit within the available label
        // width. Truncated labels get the last line ellipsised AND
        // are rendered in faded grey so the user can spot them at a
        // glance. Multi-line labels are vertically centred on the
        // node's centre.
        var maxLabelW = (lNode.level === 0 || lNode.level === maxLevel)
          ? chartWidth * 0.25 : chartWidth * 0.15;
        var wrap = R.wrapToFit(text, fontSize, maxLabelW, 3, R.LABEL_ADVANCE);
        if (!wrap.fits) {
          R.pushWarning("label-truncated", { count: 1,
            suggestion: "Try a wider chart or shorter source/target names" });
        }
        var lblColor = wrap.truncated ? R.FADED_LABEL_COLOR : st.labelColor;
        var lblLines = wrap.lines.length ? wrap.lines : [text];
        var lineH = Math.round(fontSize * 1.2);
        var blockH = (lblLines.length - 1) * lineH;
        var firstY = textY - blockH / 2;
        for (var ln = 0; ln < lblLines.length; ln++) {
          svg.push('    <text x="' + textX.toFixed(1) + '" y="' + (firstY + ln * lineH).toFixed(1) +
            '" font-family="' + fonts.label + '" font-size="' + fontSize +
            '" fill="' + lblColor + '" text-anchor="' + anchor + '">' +
            R.escapeXml(lblLines[ln]) + '</text>');
        }
      }
    }

    svg.push('  </g>');

    // Footer
    for (var fi = 0; fi < footer.svg.length; fi++) svg.push(footer.svg[fi]);

    svg.push('</svg>');
    return svg.join("\n");
  }

  // ── Label text builder ──────────────────────────────
  function buildLabelText(name, value, mode, numFmt) {
    if (mode === "name") return name;
    if (mode === "value") return R.formatNumber(value, numFmt);
    if (mode === "both") return name + " (" + R.formatNumber(value, numFmt) + ")";
    return "";
  }

  R.register("sankey", "Sankey Diagram", render);
})();
