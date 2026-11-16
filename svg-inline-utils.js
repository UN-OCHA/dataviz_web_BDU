/**
 * SvgInlineUtils — Reads flag/icon SVGs from disk and prepares them
 * for inline embedding inside chart SVGs.
 *
 * Runs in the CEP panel context (Chromium + Node.js).
 * Chart renderers receive pre-resolved SVG content via data items.
 */

/* global FlagsData, Connector */

var SvgInlineUtils = (function () {
  "use strict";

  // Icon / flag SVGs are read through the shell's Connector (disk in
  // Illustrator, same-site files on the web).
  var fs = (typeof Connector !== "undefined") ? Connector.fs : null;

  var idCounter = 0;
  var cache = {}; // keyed by filePath → { innerSvg, vbW, vbH }

  // ── Flag lookup index (built once) ──────────────────────

  var flagByCode = null; // lazy init: { "AFG": { name, code, file }, ... }
  var flagByName = null; // lazy init: { "afghanistan": { name, code, file }, ... }

  function ensureFlagIndex() {
    if (flagByCode) return;
    flagByCode = {};
    flagByName = {};
    if (typeof FlagsData === "undefined") return;
    for (var i = 0; i < FlagsData.length; i++) {
      var f = FlagsData[i];
      if (f.code) flagByCode[f.code.toUpperCase()] = f;
      if (f.name) flagByName[f.name.toLowerCase()] = f;
      // Names the flag had in older versions (tools/sync-flags.js keeps
      // them): saved charts, links and the Recent row still carry them.
      for (var k = 0; f.formerly && k < f.formerly.length; k++) {
        if (!flagByName[f.formerly[k].toLowerCase()]) flagByName[f.formerly[k].toLowerCase()] = f;
      }
    }
  }

  // ── SVG content processing ──────────────────────────────

  /**
   * Read an SVG file, strip outer wrapper, scope IDs, extract viewBox.
   * Returns { innerSvg, vbW, vbH, fileW?, fileH? } or null. innerSvg always
   * draws inside "0 0 vbW vbH" (see the viewBox-origin note below).
   */
  function readAndProcess(filePath) {
    if (!fs) return null;
    if (cache[filePath]) return cache[filePath];

    try {
      if (!fs.exists(filePath)) return null;
      var content = fs.readText(filePath);

      // Strip XML preamble and DOCTYPE
      content = content.replace(/<\?xml[^?]*\?>/gi, "");
      content = content.replace(/<!DOCTYPE[^>]*>/gi, "");

      // Extract viewBox
      var vbMatch = content.match(/viewBox="([^"]+)"/);
      if (!vbMatch) return null;
      var parts = vbMatch[1].trim().split(/[\s,]+/);
      var vbW = parseFloat(parts[2]);
      var vbH = parseFloat(parts[3]);
      if (!vbW || !vbH || vbW <= 0 || vbH <= 0) return null;

      // Inline class-based fills/strokes before stripping <style>.
      //
      // Rules can target a SINGLE class (.cls-1{...}) or a GROUP of
      // classes sharing one declaration (.cls-1,.cls-2{fill:#009edb;}).
      // The OCHA icon set uses the grouped form heavily — and an earlier
      // single-class-only parser silently dropped the fill for every
      // class after the first comma, so those paths fell back to black
      // (e.g. Mobile clinic, Water trucking). We now split the selector
      // list and apply the declaration to every class in it. We also
      // inline fill-rule so evenodd "carve-out" holes survive the
      // <style> strip.
      var styleBlocks = content.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      if (styleBlocks) {
        for (var si = 0; si < styleBlocks.length; si++) {
          var cssInner = styleBlocks[si].replace(/<\/?style[^>]*>/gi, "");
          // Match "selectorList { declarations }" for each rule.
          var ruleRe = /([^{}]+)\{([^}]*)\}/g;
          var rm;
          while ((rm = ruleRe.exec(cssInner)) !== null) {
            var selectorText = rm[1];
            var props = rm[2];
            // Extract paintable properties.
            var fillM = props.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/);
            var strokeM = props.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/);
            var opacityM = props.match(/(?:^|;)\s*opacity\s*:\s*([^;]+)/);
            var fillRuleM = props.match(/(?:^|;)\s*fill-rule\s*:\s*([^;]+)/);
            var inlineAttrs = "";
            if (fillM) inlineAttrs += ' fill="' + fillM[1].trim() + '"';
            if (strokeM) inlineAttrs += ' stroke="' + strokeM[1].trim() + '"';
            if (opacityM) inlineAttrs += ' opacity="' + opacityM[1].trim() + '"';
            if (fillRuleM) inlineAttrs += ' fill-rule="' + fillRuleM[1].trim() + '"';
            if (!inlineAttrs) continue;
            // Apply to EVERY class named in the (possibly grouped) selector.
            var sels = selectorText.split(",");
            for (var sx = 0; sx < sels.length; sx++) {
              var cm = sels[sx].match(/\.([\w-]+)/);
              if (!cm) continue;
              var cRe = new RegExp('class="([^"]*\\b' + cm[1] + '\\b[^"]*)"', 'g');
              content = content.replace(cRe, (function (attrs) {
                return function (m) { return m + attrs; };
              })(inlineAttrs));
            }
          }
        }
      }

      // Strip <style> blocks (they reference class names that may collide)
      content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
      // No clipping masks are stripped or added here: the flags (master flag
      // set) and the icons carry none and paint nothing outside their
      // viewBox. tests/shell/check-shared.js fails if a flag gains a mask.
      // Strip empty <defs> blocks left after style removal
      content = content.replace(/<defs>\s*<\/defs>/gi, "");
      // Remove class attributes (fills already inlined; prevents CSS collisions
      // with raw SVGs loaded elsewhere on the page, e.g. icons panel)
      content = content.replace(/\s*class="[^"]*"/g, "");

      // Scope IDs with unique prefix to prevent collisions
      var scope = "ic" + (idCounter++);
      content = content.replace(/\bid="([^"]+)"/g, 'id="' + scope + '_$1"');
      content = content.replace(/url\(#([^)]+)\)/g, 'url(#' + scope + '_$1)');
      content = content.replace(/xlink:href="#([^"]+)"/g, 'xlink:href="#' + scope + '_$1"');
      content = content.replace(/href="#([^"]+)"/g, 'href="#' + scope + '_$1"');

      // Extract inner content (between <svg...> and </svg>)
      var svgOpenMatch = content.match(/<svg[^>]*>/);
      if (!svgOpenMatch) return null;
      var svgOpenEnd = content.indexOf(svgOpenMatch[0]) + svgOpenMatch[0].length;
      var svgCloseIdx = content.lastIndexOf("</svg>");
      if (svgCloseIdx === -1) return null;

      var innerSvg = content.substring(svgOpenEnd, svgCloseIdx).trim();

      // A flag cropped to its edge has a viewBox that doesn't start at 0,0
      // (Catalonia: "39.8925 26.8988 730.215 486.304"). Everything that
      // draws innerSvg uses "0 0 vbW vbH", so move the artwork back to the
      // origin here. Without this the flag is drawn shifted and cut off.
      // A plain translate, not a shifted viewBox on the nested <svg>:
      // Illustrator's SVG import is only trusted with the former.
      var vbX = parseFloat(parts[0]) || 0, vbY = parseFloat(parts[1]) || 0;
      if (vbX || vbY) {
        innerSvg = '<g transform="translate(' + (-vbX) + ' ' + (-vbY) + ')">' + innerSvg + '</g>';
      }

      var result = { innerSvg: innerSvg, vbW: vbW, vbH: vbH };
      // The size written in the file. For flags it is the master set's
      // balanced size (a 3:2 flag is 60 x 40): charts keep those
      // proportions between flags, see registry.getIconDims.
      var fileW = parseFloat((svgOpenMatch[0].match(/\swidth="([\d.]+)"/) || [])[1]);
      var fileH = parseFloat((svgOpenMatch[0].match(/\sheight="([\d.]+)"/) || [])[1]);
      if (fileW > 0 && fileH > 0) { result.fileW = fileW; result.fileH = fileH; }
      cache[filePath] = result;
      return result;
    } catch (e) {
      return null;
    }
  }

  // ── Public API ──────────────────────────────────────────

  // Common OCHA short forms → ISO3 code. The flag files carry the official
  // long names ("Democratic Republic of the Congo (COD).svg"), but real
  // datasets — and our own samples — usually say "DR of the Congo" or "DRC".
  // Keys are lowercase; extend freely as new short forms show up in data.
  var FLAG_NAME_ALIASES = {
    "drc": "COD",
    "dr congo": "COD",
    "dr of the congo": "COD",
    "democratic republic of congo": "COD",
    "car": "CAF",
    "opt": "PSE",
    "palestine": "PSE",
    "syria": "SYR",
    "north korea": "PRK",
    "south korea": "KOR",
    "laos": "LAO",
    "tanzania": "TZA",
    "uk": "GBR",
    "united states": "USA",
    "us": "USA"
  };

  /**
   * The one flag lookup: ISO3 code, country name, common short form, or a
   * name the flag had in an older version ("formerly" in flags-data.js). Returns the FlagsData entry
   * ({ name, code, file }) or null.
   */
  function findFlag(ref) {
    if (!ref) return null;
    ensureFlagIndex();
    // NFC: a name pasted from a Mac file list can carry its accents in
    // another Unicode form (Côte d'Ivoire, Curaçao, Türkiye).
    var key = String(ref).trim().normalize("NFC");
    var alias = FLAG_NAME_ALIASES[key.toLowerCase()];
    return (alias && flagByCode[alias]) ||
      flagByCode[key.toUpperCase()] || flagByName[key.toLowerCase()] || null;
  }

  /**
   * Resolve a flag SVG by anything findFlag accepts.
   * Returns { innerSvg, vbW, vbH } or null.
   */
  function resolveFlag(ref, flagsDir) {
    var flag = flagsDir ? findFlag(ref) : null;
    return flag ? readAndProcess(flagsDir + "/" + flag.file) : null;
  }

  /**
   * The flag entry for a file name saved by an older version (the Recent
   * row keeps file names). A renamed flag keeps its ISO3 code, so
   * "Monserrat (MSR).svg" finds today's "Montserrat (MSR).svg".
   * Returns the FlagsData entry or null.
   */
  function flagForFile(file) {
    var m = String(file || "").match(/^(.*?)\s*(?:\(([A-Z]{3})\))?\.svg$/);
    return m ? findFlag(m[2] || m[1]) : null;
  }

  /**
   * Resolve an OCHA icon SVG by key name.
   * Returns { innerSvg, vbW, vbH, iconName } or null. iconName (the file
   * name) marks it as a humanitarian icon: the chart engine balances those
   * by ink (registry.getIconDims), never flags.
   */
  function resolveIcon(ref, iconsDir) {
    if (!ref || !iconsDir) return null;

    var key = ref.trim();
    // Try exact match first, then with dashes for spaces
    var result = readAndProcess(iconsDir + "/" + key + ".svg");
    if (result) { result.iconName = key; return result; }

    // Try replacing spaces with dashes
    var dashedKey = key.replace(/\s+/g, "-");
    if (dashedKey !== key) {
      result = readAndProcess(iconsDir + "/" + dashedKey + ".svg");
      if (result) { result.iconName = dashedKey; return result; }
    }

    return null;
  }

  /**
   * Batch-resolve icon/flag SVGs for an array of data items.
   * Each item must have an `iconRef` property (raw cell value).
   * Attaches `item._iconSvg = { innerSvg, vbW, vbH }` or null.
   */
  function resolveDataIcons(data, iconColType, flagsDir, iconsDir) {
    if (!data || !data.length) return;
    var resolveMap = {}; // cache by ref value within this batch

    for (var i = 0; i < data.length; i++) {
      var ref = data[i].iconRef;
      if (!ref) { data[i]._iconSvg = null; continue; }

      var refKey = ref.trim();
      if (resolveMap.hasOwnProperty(refKey)) {
        data[i]._iconSvg = resolveMap[refKey];
        continue;
      }

      var resolved = null;
      if (iconColType === "flags") {
        resolved = resolveFlag(refKey, flagsDir);
      } else if (iconColType === "icons") {
        resolved = resolveIcon(refKey, iconsDir);
      }

      resolveMap[refKey] = resolved;
      data[i]._iconSvg = resolved;
    }
  }

  /**
   * Build an SVG <g> element with the resolved icon content,
   * positioned and scaled to fit targetH (preserving aspect ratio).
   * Returns SVG string or "".
   */
  function buildIconGroup(resolved, targetH, x, y) {
    if (!resolved || !resolved.innerSvg) return "";
    var scale = targetH / resolved.vbH;
    var w = resolved.vbW * scale;
    return '<svg x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
      '" width="' + w.toFixed(2) + '" height="' + targetH.toFixed(2) +
      '" viewBox="0 0 ' + resolved.vbW + ' ' + resolved.vbH +
      '">' + resolved.innerSvg + '</svg>';
  }

  /**
   * Get the rendered width of an icon at a given target height.
   */
  function getIconWidth(resolved, targetH) {
    if (!resolved || !resolved.vbH) return 0;
    return resolved.vbW * (targetH / resolved.vbH);
  }

  /**
   * Build an iconSvgMap for table rendering.
   * Keyed by cell value → resolved SVG.
   */
  function buildIconMap(rows, iconCol, iconColType, flagsDir, iconsDir) {
    var map = {};
    if (iconCol == null) return map;

    for (var r = 0; r < rows.length; r++) {
      var ref = String(rows[r][iconCol] || "").trim();
      if (!ref || map.hasOwnProperty(ref)) continue;

      if (iconColType === "flags") {
        map[ref] = resolveFlag(ref, flagsDir);
      } else if (iconColType === "icons") {
        map[ref] = resolveIcon(ref, iconsDir);
      }
    }
    return map;
  }

  /**
   * Get an HTML string with inline SVG for displaying a preview
   * in the data grid picker cells (small thumbnail).
   * Returns HTML string or "" if not found.
   */
  function getPreviewHtml(ref, type, flagsDir, iconsDir) {
    if (!ref) return "";
    var resolved = null;
    if (type === "flags") {
      resolved = resolveFlag(ref, flagsDir);
    } else if (type === "icons") {
      resolved = resolveIcon(ref, iconsDir);
    }
    if (!resolved || !resolved.innerSvg) return "";
    return '<svg viewBox="0 0 ' + resolved.vbW + ' ' + resolved.vbH +
      '" xmlns="http://www.w3.org/2000/svg">' + resolved.innerSvg + '</svg>';
  }

  /**
   * Clear the file cache (call if icon files change on disk).
   */
  function clearCache() {
    cache = {};
    idCounter = 0;
  }

  return {
    findFlag: findFlag,
    resolveFlag: resolveFlag,
    flagForFile: flagForFile,
    resolveIcon: resolveIcon,
    resolveDataIcons: resolveDataIcons,
    buildIconGroup: buildIconGroup,
    getIconWidth: getIconWidth,
    buildIconMap: buildIconMap,
    getPreviewHtml: getPreviewHtml,
    clearCache: clearCache
  };
})();
