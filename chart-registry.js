/**
 * ChartRegistry — Chart type registry, shared SVG utilities, styles & fonts.
 *
 * v9: Added STYLES, FONTS, shared text block rendering, vertical padding support.
 *
 * Responsive system: breakpoint-based presets (not continuous scaling).
 *   - FIXED: fonts, strokes, margins, bar thickness (step at breakpoints)
 *   - SCALES: data area, bar lengths, point positions (proportional to space)
 *   - ADAPTS: tick count, label rotation, legend position (breakpoint rules)
 */

var ChartRegistry = (function () {
  "use strict";

  var registry = {};
  var renderers = {};

  // User-defined custom color themes (id -> theme), populated at startup from
  // persisted JSON and by import. Built-in styles (ocha/hnrp/flash/gho) are
  // NOT stored here; the palette getters below check this first, then fall
  // back to the built-in maps, so built-in behaviour is unchanged.
  registry.CUSTOM_THEMES = {};

  // ── OCHA Color Palette ────────────────────────────────

  registry.OCHA_COLORS = [
    "#009EDB", // OCHA Blue (primary)
    "#F2645A", // Red
    "#1EBFB3", // Teal
    "#FFB92A", // Amber
    "#7B68EE", // Slate Blue
    "#E86E5A", // Salmon
    "#78B7D0", // Light Blue
    "#AAC85C", // Yellow-Green
    "#C77CFF", // Purple
    "#FF8C69"  // Pink
  ];

  // ── UN Blue Colour Ramp + Grey (official OCHA palette) ──
  registry.ICON_PALETTE = [
    "#009EDB", // UN Blue — Primary
    "#E6E6E6", // OCHA Grey
    "#0074B7", // Blue 3
    "#E3EDF6", // Blue 7 (lightest)
    "#004987", // Blue 2
    "#C5DFEF", // Blue 6
    "#002E6E", // Blue 1 (darkest)
    "#64BDEA"  // Blue 5
  ];

  // ── Per-style Swatch Palettes (for color pickers) ─────

  registry.OCHA_SWATCHES = [
    { hex: "#002E6E", name: "Navy" },
    { hex: "#004987", name: "Dark Blue" },
    { hex: "#0074B7", name: "Blue" },
    { hex: "#009EDB", name: "UN Blue" },
    { hex: "#64BDEA", name: "Light Blue" },
    { hex: "#C5DFEF", name: "Pale Blue" },
    { hex: "#E3EDF6", name: "Ice Blue" },
    { hex: "#E6E6E6", name: "Grey" },
    { hex: "#FFFFFF", name: "White" },
    { hex: "#000000", name: "Black" }
  ];

  registry.HNRP_SWATCHES = [
    { hex: "#002E6E", name: "Navy" },
    { hex: "#004987", name: "Dark Blue" },
    { hex: "#0074B7", name: "Blue" },
    { hex: "#009EDB", name: "UN Blue" },
    { hex: "#70200C", name: "Dark Brown" },
    { hex: "#90371C", name: "Brown" },
    { hex: "#C15025", name: "Rust" },
    { hex: "#F58220", name: "Orange" },
    { hex: "#F9A870", name: "Light Orange" },
    { hex: "#FEDCBD", name: "Pale Orange" },
    { hex: "#E6E6E6", name: "Grey" },
    { hex: "#FFFFFF", name: "White" },
    { hex: "#000000", name: "Black" }
  ];

  registry.FLASH_SWATCHES = [
    { hex: "#520000", name: "Dark Maroon" },
    { hex: "#780B20", name: "Maroon" },
    { hex: "#A71F36", name: "Crimson" },
    { hex: "#ED1847", name: "Red" },
    { hex: "#F3859B", name: "Pink" },
    { hex: "#F9C0C5", name: "Light Pink" },
    { hex: "#F7DFDF", name: "Pale Pink" },
    { hex: "#E6E6E6", name: "Grey" },
    { hex: "#FFFFFF", name: "White" },
    { hex: "#000000", name: "Black" }
  ];

  registry.GHO_SWATCHES = [
    { hex: "#815017", name: "Dark Gold" },
    { hex: "#B16D03", name: "Gold" },
    { hex: "#CF9220", name: "Amber" },
    { hex: "#FFC800", name: "Yellow" },
    { hex: "#FFDE2F", name: "Light Yellow" },
    { hex: "#F8E66B", name: "Pale Yellow" },
    { hex: "#FAF0BB", name: "Cream" },
    { hex: "#4D4D4D", name: "Dark Grey" },
    { hex: "#FFFFFF", name: "White" },
    { hex: "#000000", name: "Black" }
  ];

  /** Get swatch palette for a given style name. */
  registry.getSwatches = function (styleName) {
    if (registry.CUSTOM_THEMES[styleName]) return registry.CUSTOM_THEMES[styleName].swatches;
    var map = { ocha: registry.OCHA_SWATCHES, hnrp: registry.HNRP_SWATCHES,
                flash: registry.FLASH_SWATCHES, gho: registry.GHO_SWATCHES };
    return map[styleName] || registry.OCHA_SWATCHES;
  };

  // ── Per-style Icon/Stacked Palettes ──────────────────

  registry.HNRP_ICON_PALETTE = [
    "#F58220", "#E6E6E6", "#C15025", "#FEDCBD",
    "#90371C", "#F9A870", "#70200C", "#FFEAD5"
  ];

  registry.FLASH_ICON_PALETTE = [
    "#ED1847", "#E6E6E6", "#A71F36", "#F9C0C5",
    "#780B20", "#F3859B", "#520000", "#F7DFDF"
  ];

  registry.GHO_ICON_PALETTE = [
    "#FFC800", "#4D4D4D", "#CF9220", "#FAF0BB",
    "#B16D03", "#F8E66B", "#815017", "#FFDE2F"
  ];

  /** Get icon/stacked palette for a given style name. */
  registry.getIconPalette = function (styleName) {
    if (registry.CUSTOM_THEMES[styleName]) return registry.CUSTOM_THEMES[styleName].iconPalette;
    var map = { ocha: registry.ICON_PALETTE, hnrp: registry.HNRP_ICON_PALETTE,
                flash: registry.FLASH_ICON_PALETTE, gho: registry.GHO_ICON_PALETTE };
    return map[styleName] || registry.ICON_PALETTE;
  };

  // ── Sequential Color Ramps (for choropleth maps) ──────

  registry.SEQUENTIAL_RAMPS = {
    ocha:  ["#E3EDF6", "#C5DFEF", "#64BDEA", "#009EDB", "#0074B7", "#004987", "#002E6E"],
    hnrp:  ["#FEDCBD", "#F9A870", "#F58220", "#C15025", "#90371C", "#70200C", "#4A1508"],
    flash: ["#F7DFDF", "#F9C0C5", "#F3859B", "#ED1847", "#A71F36", "#780B20", "#520000"],
    gho:   ["#FAF0BB", "#F8E66B", "#FFDE2F", "#FFC800", "#CF9220", "#B16D03", "#815017"]
  };

  registry.getSequentialRamp = function (styleName) {
    if (registry.CUSTOM_THEMES[styleName]) return registry.CUSTOM_THEMES[styleName].ramp;
    return registry.SEQUENTIAL_RAMPS[styleName] || registry.SEQUENTIAL_RAMPS.ocha;
  };

  // ── Font Families ──────────────────────────────────────

  registry.FONTS = {
    heading: "Roboto, Arial, Helvetica, sans-serif",
    label: "'Roboto Condensed', Arial, Helvetica, sans-serif",
    value: "'Roboto Condensed', Arial, Helvetica, sans-serif"
  };

  // ── Text-Width Estimation ──────────────────────────────
  //
  // Approximate per-character advance ratios for the two font families
  // the plugin renders. Used by renderers to estimate label-column
  // widths, wrap thresholds, and "does this value fit inside a bar
  // segment" decisions, without needing canvas.measureText.
  //
  // Real measured advance for typical mixed-case English text:
  //   Roboto regular:    ~0.55  (bold variant ~0.60)
  //   Roboto Condensed:  ~0.46
  //
  // We use 0.47 for Condensed (a 1-pixel safety margin against
  // ascender bearings on capital letters in very short labels).
  //
  // If `registry.FONTS` ever changes (different font stack), update
  // these constants — they are the SINGLE SOURCE OF TRUTH for
  // text-width estimation across all 14 chart types. Previously the
  // 0.55 ratio was hardcoded in 13 places, and the mismatch with
  // the actual Roboto Condensed glyph widths produced a visible
  // ~15-20 px gap between the title's left edge and the longest
  // chart label's left edge in stacked-bar / hbar / cluster charts.
  registry.LABEL_ADVANCE = 0.47;         // fonts.label, fonts.value, footer, comments (Roboto Condensed)
  registry.HEADING_ADVANCE = 0.50;       // fonts.heading regular (subtitle) — Roboto Regular avg ~0.50
  registry.HEADING_BOLD_ADVANCE = 0.53;  // fonts.heading bold (title, KPI figures) — Roboto Bold avg ~0.52

  // Roboto baselines. Custom themes may override the fonts and supply their own
  // measured advance ratios; useThemeMetrics() (below) swaps these live for the
  // active theme and resets to these defaults for built-in styles.
  registry._DEFAULT_FONTS = {
    heading: registry.FONTS.heading,
    label: registry.FONTS.label,
    value: registry.FONTS.value
  };
  registry._DEFAULT_LABEL_ADVANCE = registry.LABEL_ADVANCE;
  registry._DEFAULT_HEADING_ADVANCE = registry.HEADING_ADVANCE;
  registry._DEFAULT_HEADING_BOLD_ADVANCE = registry.HEADING_BOLD_ADVANCE;
  // The HEADING_* values were previously 0.55 / 0.6 — calibrated
  // pessimistically to guarantee text never overflows the wrap zone.
  // The side effect was that titles wrapped 10-13 % earlier than the
  // actual rendered Roboto could fit, so a chart at default Width 500
  // visibly left whitespace at the right of every wrapped title /
  // subtitle line. Lowering to real-Roboto averages makes wrapped lines
  // fill the chart's container width as the user expects.

  /**
   * Approximate the rendered pixel width of a string at a given font
   * size. Pass the advance constant matching the font being rendered:
   *
   *   R.LABEL_ADVANCE         for Roboto Condensed (chart text, footer)
   *   R.HEADING_ADVANCE       for regular Roboto (subtitle)
   *   R.HEADING_BOLD_ADVANCE  for bold Roboto (title)
   *
   * Defaults to LABEL_ADVANCE since that's the most common font in a
   * chart. Returns 0 for null/undefined.
   *
   * @param {string|*} text
   * @param {number} fontSize
   * @param {number} [advance=LABEL_ADVANCE] one of the *_ADVANCE constants
   * @returns {number} approximate pixel width
   */
  registry.measureTextWidth = function (text, fontSize, advance) {
    if (text == null) return 0;
    return String(text).length * fontSize * (advance || registry.LABEL_ADVANCE);
  };

  // Color used when a label is rendered in truncated form (wrapping
  // hit the maxLines cap and the last line had to be shortened with
  // an ellipsis). Bright red so the user spots the error at a glance
  // and knows to widen the chart, shorten the label, or accept the
  // ellipsis. Renderers apply this in place of `st.labelColor` only
  // on the truncated lines themselves.
  //
  // The constant name (FADED_LABEL_COLOR) is retained for backwards
  // compatibility with all the chart-* renderers that reference it;
  // it is no longer "faded" — it's an error red.
  registry.FADED_LABEL_COLOR = "#D32F2F";

  // ── Label wrapping with overflow detection ─────────────
  //
  // The plugin's universal label-fit policy:
  //   1. Try to fit the text in 1 line at the given fontSize/maxWidth.
  //   2. If too wide, wrap into up to `maxLines` lines (paragraph style).
  //   3. If even at maxLines the text doesn't fit, return a best-effort
  //      wrap with the last line shortened + "…" AND set `truncated:
  //      true` so the renderer can fade that line and emit a warning.
  //
  // Replaces the old per-renderer `R.truncate(text, maxLabelChars)`
  // pattern, which silently inserted "…" without telling the user.
  //
  // @param {string}  text
  // @param {number}  fontSize
  // @param {number}  maxWidth     in px
  // @param {number}  maxLines     hard cap on lines (3 by default)
  // @param {number}  [advance]    one of the *_ADVANCE constants;
  //                                defaults to LABEL_ADVANCE
  // @returns {{lines: string[], fits: boolean, truncated: boolean}}
  registry.wrapToFit = function (text, fontSize, maxWidth, maxLines, advance) {
    if (text == null || text === "") {
      return { lines: [], fits: true, truncated: false };
    }
    maxLines = maxLines || 3;
    advance = advance || registry.LABEL_ADVANCE;
    // Use the existing wrapText to do the word-by-word break.
    var allLines = registry.wrapText(String(text), fontSize, maxWidth, advance);
    if (!allLines.length) {
      return { lines: [""], fits: true, truncated: false };
    }
    if (allLines.length <= maxLines) {
      return { lines: allLines, fits: true, truncated: false };
    }
    // Overflow — keep the first (maxLines-1) lines, then collapse the
    // remainder onto the last line and ellipsise it to fit.
    var kept = allLines.slice(0, maxLines - 1);
    var remaining = allLines.slice(maxLines - 1).join(" ");
    var avgCharW = fontSize * advance;
    var maxChars = Math.max(2, Math.floor(maxWidth / avgCharW));
    if (remaining.length > maxChars - 1) {
      remaining = remaining.substring(0, maxChars - 1) + "…";
    }
    kept.push(remaining);
    return { lines: kept, fits: false, truncated: true };
  };

  // ── Warning collection ─────────────────────────────────
  //
  // Renderers call `registry.pushWarning(code, info)` whenever they
  // had to truncate a label, detected overlap, or made any other
  // best-effort compromise. The chart-builder layer reads them after
  // each render via `registry.takeWarnings()` and passes them to the
  // panel UI for surfacing as a banner.
  //
  // The warnings are global state per-render — a fresh `R.render(...)`
  // call resets the buffer, so each chart's warnings stay scoped to
  // its own render pass.
  //
  // @param {string} code  short identifier (e.g. "label-truncated",
  //                        "labels-overlap")
  // @param {object} info  arbitrary payload (count, where, suggestion, …)
  var _activeWarnings = [];
  registry.pushWarning = function (code, info) {
    _activeWarnings.push({ code: code, info: info || {} });
  };
  registry.takeWarnings = function () {
    var w = _activeWarnings;
    _activeWarnings = [];
    return w;
  };
  registry.resetWarnings = function () {
    _activeWarnings = [];
  };

  // ── Styles ─────────────────────────────────────────────

  // Shared base: fonts, text colors, grid — identical across all styles
  var STYLE_BASE = {
    fontHeading: "Roboto, Arial, Helvetica, sans-serif",
    fontLabel: "'Roboto Condensed', Arial, Helvetica, sans-serif",
    fontValue: "'Roboto Condensed', Arial, Helvetica, sans-serif",
    titleColor: "#1A1A1A",
    subtitleColor: "#555555",
    labelColor: "#555555",
    valueColor: "#333333",
    commentColor: "#777777",
    footerColor: "#999999",
    gridColor: "#e0e0e0",
    baselineColor: "#333333"
  };

  function makeStyle(name, colors) {
    var s = { name: name, colors: colors };
    for (var k in STYLE_BASE) { if (STYLE_BASE.hasOwnProperty(k)) s[k] = STYLE_BASE[k]; }
    return s;
  }

  registry.STYLES = {
    ocha: makeStyle("OCHA", [
      "#009EDB", "#F2645A", "#1EBFB3", "#FFB92A", "#7B68EE",
      "#E86E5A", "#78B7D0", "#AAC85C", "#C77CFF", "#FF8C69"
    ]),
    hnrp: makeStyle("HNRP", [
      "#F58220", "#009EDB", "#C15025", "#0074B7",
      "#90371C", "#64BDEA", "#F9A870", "#E6E6E6"
    ]),
    flash: makeStyle("Flash Appeal", [
      "#ED1847", "#A71F36", "#780B20", "#F3859B",
      "#F9C0C5", "#520000", "#F7DFDF", "#E6E6E6"
    ]),
    gho: makeStyle("GHO", [
      "#FFC800", "#CF9220", "#B16D03", "#FFDE2F",
      "#F8E66B", "#815017", "#4D4D4D", "#FAF0BB"
    ])
  };

  /**
   * Get the active style object. Falls back to OCHA.
   */
  registry.getStyle = function (styleName) {
    if (registry.CUSTOM_THEMES[styleName]) return registry.CUSTOM_THEMES[styleName]._styleObj;
    return registry.STYLES[styleName] || registry.STYLES.ocha;
  };

  // ── Custom color themes ───────────────────────────────
  //
  // A custom theme carries the FULL categorical palette (user-controlled).
  // The sequential ramp and swatch list are used as supplied, else derived
  // from the palette so all four getters work. Non-colour base (fonts, text
  // colours, grid) is inherited from STYLE_BASE via makeStyle — colours-only.
  //
  // Theme shape (also the import/export JSON):
  //   { id, name, colors:[...hex], ramp?:[...hex], swatches?:[{hex,name}],
  //     iconPalette?:[...hex] }

  function _hexToRgb(h) {
    h = String(h || "").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function _rgbToHex(rgb) {
    return "#" + rgb.map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return ("0" + v.toString(16)).slice(-2);
    }).join("").toUpperCase();
  }
  function _mix(hex, target, t) {
    var a = _hexToRgb(hex), b = _hexToRgb(target);
    return _rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }

  // Build a 7-step light→dark ramp around a base colour (used for choropleth
  // when a theme doesn't ship its own ramp).
  registry.deriveRamp = function (base) {
    base = base || "#009EDB";
    return [_mix(base, "#FFFFFF", 0.85), _mix(base, "#FFFFFF", 0.6), _mix(base, "#FFFFFF", 0.3),
            base, _mix(base, "#000000", 0.25), _mix(base, "#000000", 0.5), _mix(base, "#000000", 0.7)];
  };
  // Swatch list = the theme's palette plus neutrals, for manual colour pickers.
  registry.deriveSwatches = function (colors) {
    var out = (colors || []).map(function (c) { return { hex: c, name: c }; });
    out.push({ hex: "#E6E6E6", name: "Grey" }, { hex: "#FFFFFF", name: "White" }, { hex: "#000000", name: "Black" });
    return out;
  };

  // Build a CSS font stack from a raw family name, with safe fallbacks.
  // The family is wrapped in SINGLE quotes: this stack is emitted into a
  // double-quoted SVG font-family="..." attribute, so double quotes here would
  // terminate the attribute and produce invalid SVG (Illustrator rejects it).
  // Matches the built-in FONTS convention ('Roboto Condensed', ...).
  function _fontStack(name) {
    name = String(name || "").replace(/['"]/g, "").trim();
    if (!name) return null;
    return "'" + name + "', Arial, Helvetica, sans-serif";
  }

  registry.registerCustomTheme = function (t) {
    if (!t || !t.id) return null;
    var colors = (t.colors && t.colors.length) ? t.colors.slice() : registry.OCHA_COLORS.slice();
    // Optional fonts: { title, body } raw family names (colours-only themes
    // leave this null and inherit Roboto).
    var fonts = (t.fonts && (t.fonts.title || t.fonts.body))
      ? { title: t.fonts.title || "", body: t.fonts.body || "" } : null;
    var headingStack = fonts ? _fontStack(fonts.title) : null;
    var bodyStack = fonts ? _fontStack(fonts.body) : null;

    var styleObj = makeStyle(t.name || t.id, colors);
    if (headingStack) styleObj.fontHeading = headingStack;
    if (bodyStack) { styleObj.fontLabel = bodyStack; styleObj.fontValue = bodyStack; }

    var theme = {
      id: t.id,
      name: t.name || t.id,
      custom: true,
      colors: colors,
      fonts: fonts,                 // { title, body } raw names (or null)
      metrics: t.metrics || null,   // measured advance ratios (or null)
      _fontStacks: { heading: headingStack, label: bodyStack, value: bodyStack },
      ramp: (t.ramp && t.ramp.length) ? t.ramp.slice() : registry.deriveRamp(colors[0]),
      swatches: (t.swatches && t.swatches.length) ? t.swatches : registry.deriveSwatches(colors),
      iconPalette: (t.iconPalette && t.iconPalette.length) ? t.iconPalette.slice() : colors.slice(),
      _styleObj: styleObj
    };
    registry.CUSTOM_THEMES[t.id] = theme;
    return theme;
  };

  // Apply the active theme's fonts + text-width metrics globally for the next
  // render. Custom themes may override the fonts (and ship measured advance
  // ratios so layout estimation stays tight); built-ins / missing fields reset
  // to the Roboto defaults. Called at the top of registry.render.
  registry.useThemeMetrics = function (styleName) {
    var t = registry.CUSTOM_THEMES[styleName];
    var fs = (t && t._fontStacks) ? t._fontStacks : null;
    registry.FONTS = {
      heading: (fs && fs.heading) || registry._DEFAULT_FONTS.heading,
      label:   (fs && fs.label)   || registry._DEFAULT_FONTS.label,
      value:   (fs && fs.value)   || registry._DEFAULT_FONTS.value
    };
    var m = (t && t.metrics) ? t.metrics : null;
    registry.LABEL_ADVANCE        = (m && m.labelAdvance)       || registry._DEFAULT_LABEL_ADVANCE;
    registry.HEADING_ADVANCE      = (m && m.headingAdvance)     || registry._DEFAULT_HEADING_ADVANCE;
    registry.HEADING_BOLD_ADVANCE = (m && m.headingBoldAdvance) || registry._DEFAULT_HEADING_BOLD_ADVANCE;
  };
  registry.removeCustomTheme = function (id) { delete registry.CUSTOM_THEMES[id]; };

  // All selectable themes (built-ins first, then custom) for the picker UI.
  registry.listThemes = function () {
    var out = [];
    ["ocha", "hnrp", "flash", "gho"].forEach(function (id) {
      out.push({ id: id, name: registry.STYLES[id].name, custom: false });
    });
    for (var id in registry.CUSTOM_THEMES) {
      if (registry.CUSTOM_THEMES.hasOwnProperty(id)) {
        out.push({ id: id, name: registry.CUSTOM_THEMES[id].name, custom: true });
      }
    }
    return out;
  };

  // ── Registry ──────────────────────────────────────────
  //
  // ┌─ MAINTAINER NOTE — adding a new CHART TYPE ────────────────────────┐
  // │ When you add a new chart type to the plugin, you MUST also:        │
  // │                                                                    │
  // │   1. Add the type id to `SUPPORTED_TYPES` in `client/ai-import.js` │
  // │   2. Decide if it needs `MULTI_VALUE_TYPES` (multi-column)         │
  // │      or `SPECIAL_SCHEMA_TYPES` (custom data shape) registration    │
  // │      in the same file                                              │
  // │   3. Add per-type guidance + a worked data-shape example to        │
  // │      `client/ai-prompt-template.js`                                │
  // │   4. Add an alias entry in `ALIAS_TABLE` (in ai-import.js) for     │
  // │      common name variants the AI might produce                     │
  // │                                                                    │
  // │ Without those four updates, Copilot/ChatGPT will refuse to         │
  // │ generate the new chart type — see commit history for the donut    │
  // │ rollout for the canonical example. Tests live at                   │
  // │ `/tmp/test_ai_import_phase_b.js` (regenerable from this repo).    │
  // └────────────────────────────────────────────────────────────────────┘
  //
  // ┌─ MAINTAINER NOTE — adding a new chart SETTING / config field ──────┐
  // │ Two cases:                                                         │
  // │                                                                    │
  // │   A) Pure visual/layout/styling change (margins, palette, font     │
  // │      sizes, default behaviour) → AUTOMATIC. No AI work needed.     │
  // │      Chart code is shared between manual UI and AI flow; the new   │
  // │      look applies to every chart on next reload.                   │
  // │                                                                    │
  // │   B) New optional config field the user can tweak (a checkbox,     │
  // │      slider, dropdown) → wire it through `DataStore.toConfig` +    │
  // │      `loadFromConfig` (you would for the manual UI anyway), then   │
  // │      add the field name to the `passthrough` list in               │
  // │      `ai-import.js`'s `expand()`. One line. Optional: also mention │
  // │      the field in `ai-prompt-template.js` if you want the AI to    │
  // │      actively choose values (otherwise defaults apply when the AI  │
  // │      omits it — totally fine).                                     │
  // │                                                                    │
  // │ See data-store.js's loadFromConfig comment for the full rule and   │
  // │ CLAUDE.md "Plugin-internal sync rules" for the canonical doc.      │
  // └────────────────────────────────────────────────────────────────────┘

  registry.register = function (id, name, renderFn) {
    renderers[id] = { name: name, render: renderFn };
  };

  registry.render = function (type, title, data, config) {
    if (!renderers[type]) return null;
    config = config || {};

    // Fresh warning buffer for this render. Renderers populate via
    // registry.pushWarning(); chart-builder reads via takeWarnings()
    // immediately after this call returns.
    registry.resetWarnings();

    // Fresh "resolved Auto values" buffer for this render. When a control
    // is left on "Auto" the engine picks the actual number (chart height,
    // bar thickness, bar spacing, bubble separation). We record those here
    // so the panel can show them back to the user as "Auto · 240px" instead
    // of a bare "Auto". svgOpen() records the resolved height for every
    // chart type centrally; bar/bubble renderers call registry.reportResolved
    // for the values only they know. Presentation only — never read back into
    // rendering, so a stale or missing value can never change a chart.
    registry.resolved = {};

    // Resolve style colors (user override > style palette)
    var styleName = config.style || "ocha";
    // Apply the active theme's fonts + text-width metrics for this render. A
    // custom theme can override the fonts and ship measured advance ratios;
    // built-in styles reset to the Roboto defaults. Must run before the fonts
    // and width estimation below are read.
    registry.useThemeMetrics(styleName);
    var style = registry.getStyle(styleName);
    // Icon charts → style-specific icon palette (blue ramp); stacked/sankey → distinct main colors
    var useIconPalette = (type === "stacked-bar" || type === "stacked-col" || type === "icon" || type === "sankey" || type === "cluster" || type === "cluster-donut");
    var defaultPalette = useIconPalette ? registry.getIconPalette(styleName) : style.colors;
    config.colors = config.colors || defaultPalette;
    // Always expose the icon palette too — timeline uses it for
    // category dot fills so colours stay brand-coherent (a clean
    // ramp in the active style) regardless of `colors` above.
    config.iconPalette = registry.getIconPalette(styleName);

    // Clone style to avoid mutating the shared original
    var styleCopy = {};
    for (var sk in style) {
      if (style.hasOwnProperty(sk)) styleCopy[sk] = style[sk];
    }

    // Apply label color override (chart labels + values only — not title/subtitle/footer)
    if (config.labelColor) {
      styleCopy.labelColor = config.labelColor;
      styleCopy.valueColor = config.labelColor;
    }

    config.style = styleCopy;
    config.fonts = registry.FONTS;

    // Number format options for formatNumber
    config.numFmt = {
      format: config.numberFormat || "auto",
      prefix: config.valuePrefix || "",
      suffix: config.valueSuffix || ""
    };

    return renderers[type].render(title, data, config);
  };

  registry.getTypes = function () {
    var types = [];
    for (var id in renderers) {
      if (renderers.hasOwnProperty(id)) {
        types.push({ id: id, name: renderers[id].name });
      }
    }
    return types;
  };

  // ── Shared SVG Utilities ──────────────────────────────

  registry.escapeXml = function (str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };

  // Returns true if a hex color is light (needs dark text on top)
  registry.isLightColor = function (hex) {
    hex = hex.replace("#", "");
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    // Relative luminance (perceptual)
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6;
  };

  // Returns appropriate text color for overlay on a given background
  registry.contrastText = function (bgHex) {
    return registry.isLightColor(bgHex) ? "#333333" : "#ffffff";
  };

  registry.truncate = function (str, maxLen) {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 1) + "\u2026";
  };

  registry.svgOpen = function (w, h) {
    // Central capture point for the resolved chart height. svgOpen builds the
    // ROOT <svg> of every chart type exactly once per render (nested insets
    // build their <svg> tag inline, not through here), so `h` is always the
    // final, content-derived canvas height. The panel reads this back to show
    // "Auto · <h>px" on the Height pill. Guarded so an out-of-render call
    // (there are none today) can't throw.
    if (registry.resolved) {
      registry.resolved.height = Math.round(h);
      registry.resolved.width = Math.round(w);
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
      '" viewBox="0 0 ' + w + ' ' + h + '">';
  };

  // Renderers call this for resolved values only they compute (bar thickness,
  // bar spacing, bubble separation). Presentation only — the panel reads it to
  // turn "Auto" into "Auto · 28px". Never read back into rendering.
  registry.reportResolved = function (key, value) {
    if (registry.resolved && value != null && isFinite(value)) {
      registry.resolved[key] = Math.round(value);
    }
  };

  registry.svgBg = function (w, h) {
    // White fill at 0% opacity — visually transparent (so a chart placed
    // on a coloured artboard still shows the artboard through), but
    // registered by Illustrator's SVG importer as a FILLED path. This
    // matters for the chart's bounding box on placement: with
    // fill="none" the rect is excluded from visibleBounds, so the
    // imported group's bbox starts at the leftmost visible content
    // — which depends on whether the chart has a title, subtitle, or
    // comments. When that bbox left changes between two renders of
    // the same chart, updateChart's `placed.left = oldLeft` lands the
    // chart at a different artboard position than the user expects
    // (the chart appears to "move" when re-edited). Anchoring the bbox
    // to the SVG canvas via this transparent rect keeps the chart
    // visually pinned regardless of what header/footer text is set.
    return '  <rect width="' + w + '" height="' + h + '" fill="#FFFFFF" fill-opacity="0"/>';
  };

  /**
   * wrapSVG — Assembles the common SVG scaffold used by all chart renderers.
   * @param {number} svgW  - SVG width
   * @param {number} svgH  - SVG height
   * @param {object} header - object with .svg array from renderHeader
   * @param {object} footer - object with .svg array from renderFooter
   * @param {string[]} bodyLines - chart-specific SVG lines (between header and footer)
   * @returns {string} Complete SVG string
   */
  registry.wrapSVG = function (svgW, svgH, header, footer, bodyLines) {
    var svg = [];
    svg.push(registry.svgOpen(svgW, svgH));
    svg.push(registry.svgBg(svgW, svgH));
    for (var hi = 0; hi < header.svg.length; hi++) svg.push(header.svg[hi]);
    for (var bi = 0; bi < bodyLines.length; bi++) svg.push(bodyLines[bi]);
    for (var fi = 0; fi < footer.svg.length; fi++) svg.push(footer.svg[fi]);
    svg.push('</svg>');
    return svg.join("\n");
  };

  // ── Shared Text Block Rendering ────────────────────────
  //
  // Renders title, subtitle, comments, footer as SVG text elements.
  // Returns { svg: string[], headerHeight: number, footerHeight: number }

  /**
   * Render the text header block (title + subtitle + comments).
   * Returns { svg: [], height: total height consumed }
   *
   * @param {object} opts
   *   - x: left x position
   *   - startY: starting y position
   *   - title: string
   *   - subtitle: string
   *   - comments: string (may be multi-line)
   *   - rs: responsive settings
   *   - style: style object
   *   - vPad: vertical padding multiplier (1 + verticalPadding/200)
   */
  /**
   * Word-wrap text into lines that fit within maxWidth pixels.
   * @param {string} text
   * @param {number} fontSize
   * @param {number} maxWidth  available width in px
   * @param {number} charFactor  avg char width as fraction of fontSize (0.55 normal, 0.6 bold)
   * @returns {string[]} array of lines
   */
  registry.wrapText = function (text, fontSize, maxWidth, charFactor) {
    if (!text) return [];
    var avgCharW = fontSize * (charFactor || registry.LABEL_ADVANCE);
    var maxChars = Math.floor(maxWidth / avgCharW);
    if (maxChars < 4) maxChars = 4;

    var words = text.split(/\s+/);
    var lines = [];
    var cur = "";
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + " " + words[i] : words[i];
      if (test.length > maxChars && cur) {
        lines.push(cur);
        cur = words[i];
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // ── Inline emphasis (a tiny markdown subset) ────────────
  //
  // Subtitle / comments / footer accept **bold** and *italic*. Parsed into
  // styled runs here, wrapped with per-run width, and emitted as <tspan>s so
  // Illustrator imports them as bold / italic text runs (Roboto / Roboto
  // Condensed faces). Title is intentionally left literal (already bold).
  //
  // "Tight" rule (like real markdown): a marker only opens emphasis when the
  // character after it is non-space, and only closes when the character
  // before it is non-space. So footnote asterisks ("* preliminary data") and
  // arithmetic ("2 * 3") stay literal — emphasis needs to hug its text.

  /**
   * parseInline(text) → [{ text, bold, italic }] styled runs.
   * Markers that don't form valid tight emphasis are kept as literal text.
   */
  registry.parseInline = function (text) {
    var s = String(text == null ? "" : text);
    var n = s.length;
    var runs = [];
    var buf = "", bold = false, italic = false;
    function flush() {
      if (buf) { runs.push({ text: buf, bold: bold, italic: italic }); buf = ""; }
    }
    function tightOpen(at, len) {
      var after = s.charAt(at + len);
      return after !== "" && after !== " " && after !== "\t";
    }
    function tightClose(at) {
      var before = s.charAt(at - 1);
      return before !== "" && before !== " " && before !== "\t";
    }
    var i = 0;
    while (i < n) {
      if (s.charAt(i) === "*" && s.charAt(i + 1) === "*") {
        if (bold ? tightClose(i) : tightOpen(i, 2)) { flush(); bold = !bold; i += 2; continue; }
      } else if (s.charAt(i) === "*") {
        if (italic ? tightClose(i) : tightOpen(i, 1)) { flush(); italic = !italic; i += 1; continue; }
      }
      buf += s.charAt(i);
      i += 1;
    }
    flush();
    if (!runs.length) runs.push({ text: "", bold: false, italic: false });
    return runs;
  };

  /** Does this text carry any emphasis? (Lets callers keep the plain path.) */
  registry.hasInlineStyle = function (runs) {
    if (runs.length > 1) return true;
    return !!(runs[0] && (runs[0].bold || runs[0].italic));
  };

  /**
   * wrapStyled(runs, fontSize, maxWidth, baseAdvance) → lines, where each
   * line is an array of styled words [{text, bold, italic}]. Bold words are
   * measured ~7% wider (the Bold face is wider than Regular).
   */
  registry.wrapStyled = function (runs, fontSize, maxWidth, baseAdvance) {
    var BOLD_MULT = 1.07;
    var spaceW = fontSize * baseAdvance;
    // Flatten to styled words, carrying a `glue` flag for words that sit
    // immediately after the previous one with NO whitespace between them
    // (an emphasis boundary mid-text, e.g. *OCHA FTS*, → "FTS" then a glued
    // ","). Glued words render with no leading space.
    var words = [];
    var prevEndedSpace = true;
    for (var r = 0; r < runs.length; r++) {
      var rt = String(runs[r].text);
      if (rt === "") continue;
      var startsSpace = /^\s/.test(rt);
      var pieces = rt.split(/\s+/);
      var first = true;
      for (var p = 0; p < pieces.length; p++) {
        if (pieces[p] === "") continue;
        var glue = first && words.length > 0 && !startsSpace && !prevEndedSpace;
        words.push({ text: pieces[p], bold: runs[r].bold, italic: runs[r].italic, glue: glue });
        first = false;
      }
      prevEndedSpace = /\s$/.test(rt);
    }
    var lines = [];
    var cur = [];
    var curW = 0;
    for (var w = 0; w < words.length; w++) {
      var adv = (words[w].bold ? baseAdvance * BOLD_MULT : baseAdvance) * fontSize;
      var ww = words[w].text.length * adv;
      var gap = (cur.length && !words[w].glue) ? spaceW : 0;
      if (cur.length && !words[w].glue && curW + gap + ww > maxWidth) {
        lines.push(cur);
        cur = [words[w]];
        curW = ww;
      } else {
        cur.push(words[w]);
        curW += gap + ww;
      }
    }
    if (cur.length) lines.push(cur);
    if (!lines.length) lines.push([]);
    return lines;
  };

  /** Emit the inner <tspan>s for one styled line (words joined by spaces,
   *  except glued words which attach with no space). */
  registry.emitStyledTspans = function (lineWords) {
    var parts = [];
    for (var i = 0; i < lineWords.length; i++) {
      var wrd = lineWords[i];
      var attrs = "";
      if (wrd.bold) attrs += ' font-weight="bold"';
      if (wrd.italic) attrs += ' font-style="italic"';
      var txt = (i > 0 && !wrd.glue ? " " : "") + wrd.text;
      parts.push('<tspan' + attrs + '>' + registry.escapeXml(txt) + '</tspan>');
    }
    return parts.join("");
  };

  /**
   * emitTextLines — shared "wrap + emit" for any header/footer text block
   * that supports inline emphasis. Plain text (no markers) takes the exact
   * original path (wrapText + a single <text>), so existing charts render
   * byte-identically; only text with emphasis markers uses the styled path.
   * Returns { svg: string[], lineCount } and advances y via the lineH step.
   * The caller owns y; this returns the rendered lines and how many there are.
   */
  registry.emitTextLines = function (opts) {
    // opts: { text, x, yStart, lineH, fontFamily, fontSize, fill, advance,
    //         maxWidth, extraAttrs }
    var runs = registry.parseInline(opts.text);
    var styled = registry.hasInlineStyle(runs);
    var extra = opts.extraAttrs || "";
    var out = [];
    var y = opts.yStart;
    var lines;
    if (!styled) {
      lines = registry.wrapText(opts.text, opts.fontSize, opts.maxWidth, opts.advance);
      for (var i = 0; i < lines.length; i++) {
        y += opts.lineH;
        out.push('  <text x="' + opts.x + '" y="' + y +
          '" font-family="' + opts.fontFamily + '" font-size="' + opts.fontSize +
          '" fill="' + opts.fill + '"' + extra + '>' +
          registry.escapeXml(lines[i]) + '</text>');
      }
    } else {
      lines = registry.wrapStyled(runs, opts.fontSize, opts.maxWidth, opts.advance);
      for (var j = 0; j < lines.length; j++) {
        y += opts.lineH;
        out.push('  <text x="' + opts.x + '" y="' + y +
          '" font-family="' + opts.fontFamily + '" font-size="' + opts.fontSize +
          '" fill="' + opts.fill + '"' + extra + '>' +
          registry.emitStyledTspans(lines[j]) + '</text>');
      }
    }
    return { svg: out, lineCount: lines.length, yEnd: y };
  };

  /**
   * Render the chart's header text block (title + subtitle + comments).
   *
   * Returns the height of JUST the text block — no trailing cushion,
   * no plot gap, no chart-side breathing room. The caller (chart
   * renderer) adds the header-to-plot gap explicitly via
   * `registry.computePlotTop()`. This separation lets the gap scale
   * with breakpoint and with the user's vertical-padding slider, and
   * lets the gap collapse cleanly to zero when the header is empty.
   *
   * Output is wrapped in `<g class="chart-header">` so designers see a
   * dedicated "Header" group when the SVG is imported into Illustrator.
   *
   * Returns:
   *   { svg: string[], height: number }
   *   - svg: SVG snippets (already wrapped in <g>) ready to concat
   *   - height: pixels consumed by the text alone, 0 when empty
   *
   * Options:
   *   x, startY, title, subtitle, comments, rs, style, vPad, maxWidth
   *   widthPercent (optional, 0-100) — narrows the wrap zone without
   *     moving the left anchor. Default 100 = full chart width.
   */
  registry.renderHeader = function (opts) {
    // IMPORTANT: use != null, not `|| 10` — callers pass x: 0 to align
    // text flush to the left edge of the composition, and `||` treats
    // 0 as falsy and silently falls back to 10.
    var x = opts.x != null ? opts.x : 10;
    var startY = opts.startY || 0;
    var y = startY;
    var rs = opts.rs;
    var st = opts.style;
    var vPad = opts.vPad || 1;
    var lineGap = Math.round(4 * vPad);
    // widthPercent (0-100) narrows the text-wrap zone without moving the
    // anchor — title/subtitle/comments stay flush-left at x but wrap at
    // a smaller width when the user pulls the "Text width" slider down.
    // Default 100 = full chart width (same as before this option existed).
    var widthPercent = (opts.widthPercent != null && opts.widthPercent > 0) ? opts.widthPercent : 100;
    var fullW = (opts.maxWidth || 380) - x;
    var maxW = Math.max(40, Math.round(fullW * widthPercent / 100));

    var hasContent = !!(opts.title || opts.subtitle || opts.comments);
    if (!hasContent) {
      // Empty header → no group emitted, height 0, hasContent false.
      // computePlotTop() falls back to rs.marginTop in this case.
      return { svg: [], height: 0, hasContent: false };
    }

    // Inner content is collected separately so we can wrap it in a
    // <g class="chart-header"> group around the final emission.
    var inner = [];

    // Title (bold Roboto regular). Trailing lineGap only when
    // another header section follows — otherwise it's wasted space
    // before the plot starts.
    if (opts.title) {
      var titleLines = registry.wrapText(opts.title, rs.titleSize, maxW, registry.HEADING_BOLD_ADVANCE);
      for (var ti = 0; ti < titleLines.length; ti++) {
        y += Math.round(rs.titleSize * 1.2);
        inner.push('  <text x="' + x + '" y="' + y +
          '" font-family="' + st.fontHeading + '" font-size="' + rs.titleSize +
          '" font-weight="bold" fill="' + st.titleColor + '">' +
          registry.escapeXml(titleLines[ti]) + '</text>');
      }
      if (opts.subtitle || opts.comments) y += lineGap;
    }

    // Subtitle (regular-weight Roboto). Trailing lineGap only when
    // a comments section follows.
    if (opts.subtitle) {
      var subSize = Math.max(8, rs.titleSize - 2);
      // Subtitle supports **bold** / *italic* via emitTextLines (plain text
      // falls through to the original single-<text> path unchanged).
      var subOut = registry.emitTextLines({
        text: opts.subtitle, x: x, yStart: y, lineH: Math.round(subSize * 1.2),
        fontFamily: st.fontHeading, fontSize: subSize, fill: st.subtitleColor,
        advance: registry.HEADING_ADVANCE, maxWidth: maxW
      });
      for (var si = 0; si < subOut.svg.length; si++) inner.push(subOut.svg[si]);
      y = subOut.yEnd;
      if (opts.comments) y += lineGap;
    }

    // Comments (up to 3 explicit lines, each wrapped). No trailing
    // lineGap — last possible header section, the gap to the plot
    // is afterHeaderGap below.
    if (opts.comments) {
      var commentSize = rs.commentSize;
      var rawLines = opts.comments.split("\n").slice(0, 3);
      for (var i = 0; i < rawLines.length; i++) {
        var trimmed = rawLines[i].trim();
        if (!trimmed) continue;
        // Comments: Roboto Condensed (st.fontLabel), with **bold** / *italic*.
        var cmtOut = registry.emitTextLines({
          text: trimmed, x: x, yStart: y, lineH: Math.round(commentSize * 1.3),
          fontFamily: st.fontLabel, fontSize: commentSize, fill: st.commentColor,
          advance: registry.LABEL_ADVANCE, maxWidth: maxW
        });
        for (var w = 0; w < cmtOut.svg.length; w++) inner.push(cmtOut.svg[w]);
        y = cmtOut.yEnd;
      }
    }

    // Wrap in a semantic group so the SVG output reads
    //   <g class="chart-header"> ...title/subtitle/comments... </g>
    // and Illustrator's import preserves it as a selectable group.
    var svg = ['  <g class="chart-header">'].concat(inner).concat(['  </g>']);

    // height is the ABSOLUTE Y of the text bottom (consistent with the
    // historical contract — renderers do `plotTop = header.height + …`).
    // hasContent is the explicit signal for "is there a header to gap
    // away from?" — needed because an empty header still has a non-zero
    // height equal to startY.
    return { svg: svg, height: y, hasContent: true };
  };

  /**
   * Render a series legend above the chart (stacked-bar, stacked-col).
   *
   * Grid layout — items arrange in equal-width columns so circles line
   * up vertically across rows (not just horizontally within a row).
   * When the row overflows maxWidth the remainder wraps to a new row
   * at the same left-anchored column grid.
   *
   * Spacing hints:
   *   hasSubtitle=true  → extra top gap so the legend doesn't crowd the
   *                      subtitle
   *   hasSubtitle=false → tighter top gap so the legend sits closer to
   *                      the title
   * Adds a fixed bottom pad so there's breathing room before the chart.
   *
   * opts: { x, startY, names[], colors[], rs, style, maxWidth, hasSubtitle }
   * Returns: { svg: [], height }
   */
  registry.renderStackedLegend = function (opts) {
    var svg = [];
    var names = opts.names || [];
    var colors = opts.colors || [];
    if (!names.length) return { svg: svg, height: 0 };

    var rs = opts.rs;
    var st = opts.style;
    var x0 = opts.x || 0;
    var startY = opts.startY || 0;
    var maxW = (opts.maxWidth || 380) - x0;

    var textSize = Math.max(8, rs.labelSize - 1);
    var radius = Math.max(3, Math.round(textSize * 0.38));
    var gapAfterCircle = 6;      // space between circle and label
    var colGap = 18;             // horizontal gap between columns
    var rowGap = Math.round(textSize * 0.8);
    var rowH = Math.round(textSize * 1.3);

    // Spacing — the gap ABOVE the legend is already provided by
    // computePlotTop() (the caller sets startY = plotTop, which has
    // rs.afterHeaderGap baked in after the header). Adding another
    // header gap here would double the visible gap between the header
    // and the legend.
    // The bottom pad mirrors the same afterHeaderGap so the gap
    // ABOVE the legend and the gap BELOW the legend stay balanced
    // through the vertical-padding slider — when the user pulls vPad
    // low both sides shrink together; when they push it high both
    // sides grow together. Falls back to headerGap for older configs
    // that don't define afterHeaderGap.
    var topPad = 0;
    var bottomPad = (rs.afterHeaderGap != null) ? rs.afterHeaderGap : rs.headerGap;

    var lineFont = st.fontLabel || "Arial, sans-serif";
    var textColor = st.labelColor;

    // Per-item width (circle + gap + text)
    var widest = 0;
    var items = [];
    for (var i = 0; i < names.length; i++) {
      var name = String(names[i] || "Series " + (i + 1));
      // Legend item text uses fonts.label / fonts.value (Roboto Condensed)
      var estTextW = name.length * textSize * registry.LABEL_ADVANCE;
      var itemW = radius * 2 + gapAfterCircle + estTextW;
      if (itemW > widest) widest = itemW;
      items.push({ name: name, color: colors[i % colors.length], w: itemW });
    }

    // Grid dimensions — every column is the same width so circles in
    // row 2 align underneath circles in row 1.
    var colW = widest;
    var cols = Math.max(1, Math.floor((maxW + colGap) / (colW + colGap)));
    if (cols > items.length) cols = items.length;

    // Emit SVG
    var y = startY + topPad + rowH;
    for (var j = 0; j < items.length; j++) {
      var colIdx = j % cols;
      if (j > 0 && colIdx === 0) {
        y += rowH + rowGap;
      }
      var cellX = x0 + colIdx * (colW + colGap);
      var textBaselineY = y;
      var circleY = textBaselineY - textSize * 0.4;
      var it = items[j];
      svg.push('  <circle cx="' + (cellX + radius).toFixed(1) +
        '" cy="' + circleY.toFixed(1) +
        '" r="' + radius + '" fill="' + it.color + '"/>');
      var textX = cellX + radius * 2 + gapAfterCircle;
      svg.push('  <text x="' + textX.toFixed(1) + '" y="' + textBaselineY.toFixed(1) +
        '" font-family="' + lineFont + '" font-size="' + textSize +
        '" fill="' + textColor + '">' + registry.escapeXml(it.name) + '</text>');
    }

    var totalH = (y - startY) + bottomPad;
    return { svg: svg, height: totalH };
  };

  /**
   * Render the chart's footer text block (source / attribution).
   *
   * Returns the height of JUST the text block — no leading "gap from
   * the plot" and no trailing breathing room. The caller is expected
   * to compute the footer's startY via `registry.computeFooterStart()`,
   * which adds `rs.footerGap` between the plot bottom and the footer
   * when (and only when) the footer has content. This keeps the gap
   * scaling responsive and lets it collapse cleanly to zero when the
   * footer is empty.
   *
   * Output is wrapped in `<g class="chart-footer">` so designers see
   * a dedicated "Footer" group when the SVG is imported.
   *
   * Returns:
   *   { svg: string[], height: number, hasContent: boolean }
   *
   * Options:
   *   x, startY, footer, rs, style, maxWidth
   *   widthPercent (optional, 0-100) — narrows the wrap zone without
   *     moving the left anchor. Default 100 = full chart width.
   */
  registry.renderFooter = function (opts) {
    if (!opts.footer) {
      return { svg: [], height: 0, hasContent: false };
    }

    var footerSize = opts.rs.footerSize;
    var st = opts.style;
    // IMPORTANT: use != null, not `|| 10`. Callers pass x: 0 to sit
    // flush-left with the title; `||` would silently fall back to 10.
    var x = opts.x != null ? opts.x : 10;
    // Same widthPercent contract as renderHeader — narrow the wrap zone
    // without moving the left anchor.
    var widthPercent = (opts.widthPercent != null && opts.widthPercent > 0) ? opts.widthPercent : 100;
    var fullW = (opts.maxWidth || 380) - x;
    var maxW = Math.max(40, Math.round(fullW * widthPercent / 100));
    var startY = opts.startY || 0;
    var y = startY;

    var inner = [];
    // Footer: Roboto Condensed (st.fontLabel), with **bold** / *italic*
    // (e.g. italicising a source name). Plain footers render unchanged.
    var footerOut = registry.emitTextLines({
      text: opts.footer, x: x, yStart: y, lineH: Math.round(footerSize * 1.2),
      fontFamily: st.fontLabel, fontSize: footerSize, fill: st.footerColor,
      advance: registry.LABEL_ADVANCE, maxWidth: maxW
    });
    for (var i = 0; i < footerOut.svg.length; i++) inner.push(footerOut.svg[i]);
    y = footerOut.yEnd;

    var svg = ['  <g class="chart-footer">'].concat(inner).concat(['  </g>']);

    // height is the consumed pixels (NOT absolute Y). Renderers add
    // this to the footer's startY to get the bottom of the footer
    // block, used to compute total SVG height.
    return { svg: svg, height: y - startY, hasContent: true };
  };

  // ── Layout Helpers ──────────────────────────────────
  //
  // The chart layout is conceptually three vertical zones:
  //
  //   ┌──────────────────────────┐
  //   │  HEADER (text)           │   ← renderHeader
  //   ├──── headerGap ───────────┤   ← computePlotTop
  //   │  PLOT (the chart)        │
  //   ├──── footerGap ───────────┤   ← computeFooterStart
  //   │  FOOTER (source line)    │   ← renderFooter
  //   └──────────────────────────┘
  //
  // Each zone is independent:
  //   - Empty header → no group emitted, plotTop falls back to rs.marginTop
  //   - Empty footer → no group emitted, no footerGap consumed
  //   - Both gaps scale with breakpoint (xs/sm/md/lg) and with the
  //     user's vertical-padding slider via applyVerticalPadding.
  //
  // These helpers replace the old per-renderer pattern
  //   `var plotTop = header.height || rs.marginTop;`
  // (which baked a 32 px cushion into the header function and wasn't
  // breakpoint-aware) — and the +4 fudge factor that drifted across
  // about half of the renderers.

  /**
   * Compute where the plot area should start (in absolute SVG y) based
   * on whether the header has content.
   * @param {object} rs - responsive settings (must include marginTop, headerGap)
   * @param {object} header - the result of registry.renderHeader()
   * @returns {number} y position in SVG coordinates
   */
  registry.computePlotTop = function (rs, header) {
    if (header && header.hasContent) {
      // header.height is the absolute Y of the text bottom; add the
      // (smaller) afterHeaderGap to land at the plot top. The full
      // headerGap is kept for legend bottom-padding so a multi-row
      // legend still has air between itself and the plot.
      var gap = (rs.afterHeaderGap != null) ? rs.afterHeaderGap : rs.headerGap;
      return header.height + gap;
    }
    // No header text → use the chart's natural top margin so we don't
    // sit flush against the SVG edge.
    return rs.marginTop;
  };

  /**
   * Compute where the footer text should start (in absolute SVG y) based
   * on the plot's bottom edge and whether the footer has content.
   *
   * Accepts either a boolean (typical — caller knows from `config.footer`
   * before calling renderFooter) or the rendered-footer object with a
   * `.hasContent` flag (for callers that prefer to compute after).
   *
   * @param {object} rs - responsive settings (must include footerGap)
   * @param {number} plotBottom - absolute Y of the plot's bottom edge
   * @param {boolean|object} hasFooterOrObj - either `!!config.footer`
   *                          or the result of registry.renderFooter()
   * @returns {number} y position in SVG coordinates where the footer
   *                   group should start. When the footer has no
   *                   content, equal to plotBottom (no gap consumed).
   */
  registry.computeFooterStart = function (rs, plotBottom, hasFooterOrObj) {
    var hasContent = (hasFooterOrObj === true) ||
      (hasFooterOrObj && hasFooterOrObj.hasContent === true);
    return hasContent ? plotBottom + rs.footerGap : plotBottom;
  };

  /**
   * Measure how much vertical space the x-axis label row needs below
   * the chart's baseline, given the longest actual label in the data.
   *
   * Returns the FULL margin-bottom budget — i.e. the pixel distance
   * from the chart baseline down to the bottom of the lowest visible
   * label glyph + a small breathing gap. Caller sets
   *
   *     var marginBottom = R.measureXAxisLabelBudget(data, rs, rotated);
   *
   * and trusts the helper to size the row to the actual content.
   *
   * Replaces the old magic-number margins like
   *   `rotated ? Math.max(rs.marginBottom * 3, 65) : Math.max(rs.marginBottom * 2, 48)`
   * which under-reserved space whenever a label was even moderately
   * long. A 14-char label at the default 12 pt font tilted -45° extends
   * ~95 px below the chart baseline — the old magic 65 wasn't enough,
   * so the footer landed on top of the labels.
   *
   * Layout assumptions (consistent across line / vbar / stacked-col):
   *   chart baseline
   *   ↓  ~16 px breathing gap to label baseline
   *   label baseline (rotation pivot for tilted)
   *   ↓  STRAIGHT:  cap-to-descender ≈ labelSize × 1.2
   *      ROTATED:   sin(45°) × (labelWidth + descender) plus
   *                 a small font allowance
   *   ↓  small bottom gap
   *
   * @param {Array}   data    - chart data; each item must have `.label`
   * @param {object}  rs      - responsive settings (labelSize, maxLabelChars)
   * @param {boolean} rotated - true when labels render at -45°
   * @returns {number} pixel budget below the chart baseline
   */
  /**
   * Measure how far below the label's anchor point its visible content
   * extends, given the longest actual label in the data.
   *
   * The anchor point is:
   *   - For straight labels: the text baseline (set by the SVG y attribute)
   *   - For rotated -45° labels with text-anchor="end": the rotation pivot
   *
   * Used as a building block by `measureXAxisLabelBudget` (which adds a
   * baseline gap and bottom gap on top) and directly by renderers whose
   * label-anchor offset isn't a flat constant — e.g. bubble, where the
   * label sits below each bubble's bottom edge rather than below a shared
   * baseline.
   *
   * @param {Array}   data    - chart data; each item must have `.label`
   * @param {object}  rs      - responsive settings (labelSize, maxLabelChars)
   * @param {boolean} rotated - true when labels render at -45°
   * @returns {number} pixel extent below the label anchor
   */
  registry.measureLabelExtentBelowAnchor = function (data, rs, rotated) {
    if (!data || !data.length) {
      // Pathological case — reserve room for a single-line glyph anyway.
      return Math.ceil(rs.labelSize * 0.2);
    }
    // Longest visible label after truncation — matches what renders on
    // screen, so budgeting reflects on-screen content not raw input.
    var maxLen = 0;
    for (var i = 0; i < data.length; i++) {
      var s = (data[i] && data[i].label != null) ? String(data[i].label) : "";
      if (rs.maxLabelChars && s.length > rs.maxLabelChars) {
        s = s.substring(0, rs.maxLabelChars);
      }
      if (s.length > maxLen) maxLen = s.length;
    }
    // Approximate label pixel width (chars × fontSize × ~0.55 advance).
    // X-axis labels render in fonts.label (Roboto Condensed)
    var labelW = maxLen * rs.labelSize * registry.LABEL_ADVANCE;
    if (rotated) {
      // After rotate(-45) around (lx, labelY) with text-anchor="end",
      // the descender's lower-left corner ends up at
      //   labelY + (labelW + 0.2 × labelSize) × 0.707
      // below the pivot.
      return Math.ceil(rs.labelSize * 0.14 + labelW * 0.707);
    }
    // Straight labels: descender extends ~0.2 × labelSize below baseline.
    return Math.ceil(rs.labelSize * 0.2);
  };

  /**
   * Measure how much vertical space the x-axis label row needs below
   * the chart's baseline, given the longest actual label in the data.
   *
   * Returns the FULL margin-bottom budget — i.e. the pixel distance
   * from the chart baseline down to the bottom of the lowest visible
   * label glyph + a small breathing gap. Caller sets
   *
   *     var marginBottom = R.measureXAxisLabelBudget(data, rs, rotated);
   *
   * and trusts the helper to size the row to the actual content.
   *
   * Replaces the old magic-number margins like
   *   `rotated ? Math.max(rs.marginBottom * 3, 65) : Math.max(rs.marginBottom * 2, 48)`
   * which under-reserved space whenever a label was even moderately
   * long. A 14-char label at the default 12 pt font tilted -45° extends
   * ~95 px below the chart baseline — the old magic 65 wasn't enough,
   * so the footer landed on top of the labels.
   *
   * Layout assumptions (consistent across line / vbar / stacked-col):
   *   chart baseline
   *   ↓  ~16 px breathing gap to label baseline
   *   label baseline (rotation pivot for tilted)
   *   ↓  cap-to-baseline (~labelSize) + extentBelowAnchor (rotated/straight)
   *   ↓  small bottom gap
   *
   * @param {Array}   data    - chart data; each item must have `.label`
   * @param {object}  rs      - responsive settings (labelSize, maxLabelChars)
   * @param {boolean} rotated - true when labels render at -45°
   * @returns {number} pixel budget below the chart baseline
   */
  registry.measureXAxisLabelBudget = function (data, rs, rotated, lineCount, hasFooter) {
    var baselineGap = 16;       // chart baseline → label baseline
    // Breathing room below the lowest glyph. ONLY when there's no footer:
    // a footer below the labels already supplies its own gap (footerGap via
    // computeFooterStart), so keeping bottomGap too made the footer sit a
    // label-row's worth too far below the x-axis labels (it didn't on hbar,
    // which has no x-axis label row). Drop it when a footer follows so the
    // footer hugs the labels the same way it hugs the bars on hbar.
    var bottomGap = hasFooter ? 0 : 6;
    if (rotated) {
      // Rotated labels are single-line by design.
      var capHeight = rs.labelSize;
      var below = registry.measureLabelExtentBelowAnchor(data, rs, rotated);
      return Math.ceil(baselineGap + capHeight + below + bottomGap);
    }
    // Straight labels: the FIRST line's baseline sits baselineGap below the
    // chart baseline; each ADDITIONAL line adds one lineH; below the last
    // baseline only the descender + bottomGap are needed. The old formula
    // added a whole lineH per line (including the first), reserving a full
    // empty line below single-line labels — which pushed the footer ~10px
    // too far down on every column / line chart.
    lineCount = lineCount || 1;
    var lineH = Math.round(rs.labelSize * 1.2);
    var descender = Math.ceil(rs.labelSize * 0.25);
    return Math.ceil(baselineGap + (lineCount - 1) * lineH + descender + bottomGap);
  };

  // ── Scale Functions ─────────────────────────────────

  registry.linearScale = function (domainMin, domainMax, rangeMin, rangeMax) {
    var domainSpan = domainMax - domainMin;
    if (domainSpan === 0) domainSpan = 1;
    var rangeSpan = rangeMax - rangeMin;
    return function (value) {
      return rangeMin + ((value - domainMin) / domainSpan) * rangeSpan;
    };
  };

  /**
   * Distribute `count` bands across [rangeMin, rangeMax].
   *
   * The bands are flush-left: the first band starts exactly at rangeMin,
   * with the inter-band gap (`padding × step`) appearing AFTER each
   * band. The last band is followed by one trailing gap, so the total
   * length is preserved.
   *
   * Used by vbar / stacked-col to put the first column's left edge at
   * x=0 inside the plot group, matching the title's flush-left position.
   * Pass `centered=true` to opt into the legacy behaviour where the
   * leading gap was split symmetrically before the first band — kept
   * as an escape hatch but no current renderer uses it.
   *
   * @param {number} count
   * @param {number} rangeMin
   * @param {number} rangeMax
   * @param {number} [padding=0.2] gap between bands as a fraction of step
   * @param {boolean} [centered=false] true to restore legacy centred bands
   */
  registry.bandScale = function (count, rangeMin, rangeMax, padding, centered) {
    padding = padding != null ? padding : 0.2;
    var totalRange = rangeMax - rangeMin;
    if (count <= 0) return { bandwidth: totalRange, step: totalRange, position: function () { return rangeMin; } };

    var step = totalRange / count;
    var bandwidth = step * (1 - padding);
    // Default flush-left: no leading offset, gap sits AFTER each band.
    // Legacy centered: split (step - bandwidth) symmetrically before first band.
    var offset = centered ? (step - bandwidth) / 2 : 0;

    return {
      bandwidth: bandwidth,
      step: step,
      position: function (index) {
        return rangeMin + index * step + offset;
      }
    };
  };

  // ── Math Utilities ────────────────────────────────────

  registry.polarToCartesian = function (cx, cy, r, angleDeg) {
    var rad = (angleDeg - 90) * Math.PI / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad)
    };
  };

  registry.describeArc = function (cx, cy, r, startAngle, endAngle) {
    var start = registry.polarToCartesian(cx, cy, r, endAngle);
    var end = registry.polarToCartesian(cx, cy, r, startAngle);
    var largeArc = (endAngle - startAngle > 180) ? 1 : 0;

    return [
      "M", start.x.toFixed(2), start.y.toFixed(2),
      "A", r, r, 0, largeArc, 0, end.x.toFixed(2), end.y.toFixed(2)
    ].join(" ");
  };

  registry.describeDonutArc = function (cx, cy, outerR, innerR, startAngle, endAngle) {
    var outerStart = registry.polarToCartesian(cx, cy, outerR, endAngle);
    var outerEnd = registry.polarToCartesian(cx, cy, outerR, startAngle);
    var innerStart = registry.polarToCartesian(cx, cy, innerR, startAngle);
    var innerEnd = registry.polarToCartesian(cx, cy, innerR, endAngle);
    var largeArc = (endAngle - startAngle > 180) ? 1 : 0;

    return [
      "M", outerStart.x.toFixed(2), outerStart.y.toFixed(2),
      "A", outerR, outerR, 0, largeArc, 0, outerEnd.x.toFixed(2), outerEnd.y.toFixed(2),
      "L", innerStart.x.toFixed(2), innerStart.y.toFixed(2),
      "A", innerR, innerR, 0, largeArc, 1, innerEnd.x.toFixed(2), innerEnd.y.toFixed(2),
      "Z"
    ].join(" ");
  };

  registry.niceScale = function (dataMin, dataMax, maxTicks) {
    maxTicks = maxTicks || 6;
    if (dataMin === dataMax) {
      dataMax = dataMin + 1;
    }

    var range = dataMax - dataMin;
    var roughStep = range / (maxTicks - 1);

    var mag = Math.pow(10, Math.floor(Math.log(roughStep) / Math.LN10));
    var normalized = roughStep / mag;
    var niceStep;

    if (normalized <= 1) niceStep = 1 * mag;
    else if (normalized <= 2) niceStep = 2 * mag;
    else if (normalized <= 5) niceStep = 5 * mag;
    else niceStep = 10 * mag;

    var niceMin = Math.floor(dataMin / niceStep) * niceStep;
    var niceMax = Math.ceil(dataMax / niceStep) * niceStep;

    var ticks = [];
    for (var v = niceMin; v <= niceMax + niceStep * 0.5; v += niceStep) {
      ticks.push(Math.round(v * 1000) / 1000);
    }

    return {
      min: niceMin,
      max: niceMax,
      step: niceStep,
      ticks: ticks
    };
  };

  /**
   * Format a number for display on charts.
   * @param {number} n - The value
   * @param {object} [opts] - { format, prefix, suffix }
   *   format: "auto" (default) | "full" | "K" | "M" | "B"
   *   prefix: string prepended (e.g. "US$ ")
   *   suffix: string appended (e.g. "%")
   */
  registry.formatNumber = function (n, opts) {
    opts = opts || {};
    var fmt = opts.format || "auto";
    var prefix = opts.prefix || "";
    var suffix = opts.suffix || "";

    var str;
    if (n === 0) {
      str = "0";
    } else if (fmt === "full") {
      // No abbreviation — add thousand separators
      str = addCommas(n);
    } else if (fmt === "K") {
      str = (n / 1000).toFixed(1) + "k";
    } else if (fmt === "M") {
      str = (n / 1000000).toFixed(1) + "M";
    } else if (fmt === "B") {
      str = (n / 1000000000).toFixed(1) + "B";
    } else {
      // "auto" — pick abbreviation based on magnitude
      if (Math.abs(n) >= 1000000000) str = (n / 1000000000).toFixed(1) + "B";
      else if (Math.abs(n) >= 1000000) str = (n / 1000000).toFixed(1) + "M";
      else if (Math.abs(n) >= 1000) str = (n / 1000).toFixed(1) + "k";
      else if (n % 1 !== 0) str = n.toFixed(1);
      else str = String(n);
    }

    // Strip trailing ".0" for cleaner display
    str = str.replace(/\.0([kMB%]?)$/, "$1");

    return prefix + str + suffix;
  };

  /** Add thousand separators (e.g. 1234567 → "1,234,567") */
  function addCommas(n) {
    var s = n % 1 !== 0 ? n.toFixed(1) : String(n);
    var parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  // ── Responsive System ────────────────────────────────

  var BREAKPOINT_PRESETS = {
    xs: {
      titleSize: 10, labelSize: 8, valueSize: 7, legendSize: 8, commentSize: 7, footerSize: 7,
      marginTop: 24, marginBottom: 12, marginLeft: 30, marginRight: 10,
      // headerGap: legend bottom-padding (and any other "balanced" gap a
      //            renderer wants between two visually heavy zones).
      // afterHeaderGap: gap directly between the header text block and
      //            whatever's next (legend OR plot top). Smaller than
      //            headerGap on purpose — the title doesn't need as
      //            much air below it as a multi-row legend does.
      // footerGap: plot-bottom → footer text gap.
      // All three scale with breakpoint AND with the user's
      // vertical-padding slider (see applyVerticalPadding). When the
      // corresponding text zone is empty, computePlotTop /
      // computeFooterStart skip the gap entirely.
      headerGap: 12, afterHeaderGap: 7, footerGap: 10,
      barThickness: 14, barGap: 5,
      legendItemH: 14, legendSwatchW: 8, legendGap: 4,
      maxTicks: 3, labelRotateThreshold: 4, maxLabelChars: 10,
      legendPosition: "bottom", defaultPlotHeight: 140
    },
    sm: {
      titleSize: 11, labelSize: 9, valueSize: 8, legendSize: 9, commentSize: 8, footerSize: 8,
      marginTop: 30, marginBottom: 15, marginLeft: 40, marginRight: 15,
      headerGap: 18, afterHeaderGap: 11, footerGap: 14,
      barThickness: 18, barGap: 7,
      legendItemH: 16, legendSwatchW: 10, legendGap: 5,
      maxTicks: 5, labelRotateThreshold: 5, maxLabelChars: 14,
      legendPosition: "bottom", defaultPlotHeight: 180
    },
    md: {
      titleSize: 14, labelSize: 11, valueSize: 10, legendSize: 10, commentSize: 10, footerSize: 10,
      marginTop: 40, marginBottom: 20, marginLeft: 50, marginRight: 20,
      headerGap: 24, afterHeaderGap: 14, footerGap: 18,
      barThickness: 24, barGap: 10,
      legendItemH: 20, legendSwatchW: 12, legendGap: 6,
      maxTicks: 8, labelRotateThreshold: 7, maxLabelChars: 20,
      legendPosition: "right", defaultPlotHeight: 240
    },
    lg: {
      titleSize: 16, labelSize: 12, valueSize: 11, legendSize: 11, commentSize: 11, footerSize: 11,
      marginTop: 45, marginBottom: 25, marginLeft: 55, marginRight: 25,
      headerGap: 32, afterHeaderGap: 19, footerGap: 22,
      barThickness: 28, barGap: 12,
      legendItemH: 22, legendSwatchW: 14, legendGap: 7,
      maxTicks: 12, labelRotateThreshold: 10, maxLabelChars: 30,
      legendPosition: "right", defaultPlotHeight: 300
    }
  };

  // Breakpoint thresholds — single source of truth
  registry.BP_THRESHOLDS = { xs: 0, sm: 200, md: 350, lg: 550 };

  registry.getBreakpoint = function (width) {
    if (width < 200)      return "xs";
    if (width < 350)      return "sm";
    if (width < 550)      return "md";
    return "lg";
  };

  registry.responsive = function (width) {
    var bp = registry.getBreakpoint(width);

    var preset = BREAKPOINT_PRESETS[bp];
    var rs = {};
    for (var key in preset) {
      if (preset.hasOwnProperty(key)) {
        rs[key] = preset[key];
      }
    }

    // Font sizes stay constant across widths — the width slider only
    // adjusts spacings (margins, plot height, bar thickness). This keeps
    // labels and titles visually consistent regardless of chart size.
    // textScale / labelScale sliders remain as independent overrides.
    var FIXED_FONTS = BREAKPOINT_PRESETS.md;
    rs.titleSize   = FIXED_FONTS.titleSize;
    rs.labelSize   = FIXED_FONTS.labelSize;
    rs.valueSize   = FIXED_FONTS.valueSize;
    rs.legendSize  = FIXED_FONTS.legendSize;
    rs.commentSize = FIXED_FONTS.commentSize;
    rs.footerSize  = FIXED_FONTS.footerSize;

    // Always fixed
    rs.strokeWidth = 2;
    rs.gridStrokeWidth = 1;
    rs.dotRadius = 4;

    rs.breakpoint = bp;
    rs.width = width;

    return rs;
  };

  /**
   * Apply vertical padding multiplier to responsive settings.
   * Returns a new object with padded margins and gaps.
   */
  registry.applyVerticalPadding = function (rs, verticalPadding) {
    if (!verticalPadding) return rs;
    // Clamp the effective multiplier so extreme negatives don't crush
    // the chart. -100 maps to 0.5x which is plenty to say "tight"; any
    // lower would start clipping axis labels, values, and data points.
    var vPad = 1 + (verticalPadding / 200);
    if (vPad < 0.5) vPad = 0.5;
    var padded = {};
    for (var key in rs) {
      if (rs.hasOwnProperty(key)) padded[key] = rs[key];
    }
    // Spacings scale; font sizes stay unchanged so text remains
    // consistently readable at any height. Use textScale / labelScale
    // if independent font adjustment is needed.
    padded.marginTop = Math.round(rs.marginTop * vPad);
    padded.marginBottom = Math.round(rs.marginBottom * vPad);
    padded.headerGap = Math.round(rs.headerGap * vPad);
    padded.afterHeaderGap = Math.round(rs.afterHeaderGap * vPad);
    padded.footerGap = Math.round(rs.footerGap * vPad);
    padded.barGap = Math.round(rs.barGap * vPad);
    padded.defaultPlotHeight = Math.round(rs.defaultPlotHeight * vPad);
    padded.legendItemH = Math.round(rs.legendItemH * vPad);
    return padded;
  };

  /**
   * Apply independent text and label scale multipliers.
   * textScale  (50–200%): title, subtitle, comments, footer
   * labelScale (50–200%): axis labels, data values, legend
   */
  registry.applyScales = function (rs, textScale, labelScale) {
    var ts = textScale || 100;
    var ls = labelScale || 100;
    if (ts === 100 && ls === 100) return rs;
    var scaled = {};
    for (var key in rs) {
      if (rs.hasOwnProperty(key)) scaled[key] = rs[key];
    }
    if (ts !== 100) {
      var tF = ts / 100;
      scaled.titleSize   = Math.max(6, Math.round(rs.titleSize * tF));
      scaled.commentSize = Math.max(5, Math.round(rs.commentSize * tF));
      scaled.footerSize  = Math.max(5, Math.round(rs.footerSize * tF));
    }
    if (ls !== 100) {
      var lF = ls / 100;
      scaled.labelSize  = Math.max(5, Math.round(rs.labelSize * lF));
      scaled.valueSize  = Math.max(5, Math.round(rs.valueSize * lF));
      scaled.legendSize = Math.max(5, Math.round(rs.legendSize * lF));
    }
    return scaled;
  };

  // ── Chart Init Helper ──────────────────────────────────
  // Eliminates the 7-line boilerplate repeated in every chart renderer.

  registry.initRender = function (config) {
    var svgW = config.width || 500;
    var rs = registry.responsive(svgW);
    var vPad = 1 + ((config.verticalPadding || 0) / 200);
    rs = registry.applyVerticalPadding(rs, config.verticalPadding);
    rs = registry.applyScales(rs, config.textScale, config.labelScale);
    var st = config.style || registry.getStyle("ocha");
    var fonts = config.fonts || registry.FONTS;
    return { svgW: svgW, rs: rs, vPad: vPad, st: st, fonts: fonts };
  };

  // ── Shared Pie/Donut Utilities ────────────────────────

  var PIE_MAX_SLICES = 7;

  registry.mergeSlices = function (data) {
    if (data.length <= PIE_MAX_SLICES) return data.slice();
    var sorted = data.slice().sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
    var top = sorted.slice(0, PIE_MAX_SLICES - 1);
    var rest = sorted.slice(PIE_MAX_SLICES - 1);
    var othersVal = 0;
    for (var i = 0; i < rest.length; i++) othersVal += Math.abs(rest[i].value);
    top.push({ label: "Others", value: othersVal });
    return top;
  };

  registry.resolveOverlaps = function (labels, minGap) {
    var left = [], right = [];
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].isRight) right.push(labels[i]);
      else left.push(labels[i]);
    }
    function fixSide(arr) {
      arr.sort(function (a, b) { return a.y - b.y; });
      for (var j = 1; j < arr.length; j++) {
        var overlap = (arr[j - 1].y + minGap) - arr[j].y;
        if (overlap > 0) arr[j].y += overlap;
      }
    }
    fixSide(left);
    fixSide(right);
  };

  registry.buildPieLabelText = function (label, pct, absVal, contentMode, rs, numFmt) {
    switch (contentMode) {
      case "pct": return pct + "%";
      case "value": return registry.formatNumber(absVal, numFmt);
      case "value-pct": return registry.formatNumber(absVal, numFmt) + " (" + pct + "%)";
      case "label-value": return registry.truncate(label, rs.maxLabelChars) + " (" + registry.formatNumber(absVal, numFmt) + ")";
      case "label-value-pct": return registry.truncate(label, rs.maxLabelChars) + " (" + registry.formatNumber(absVal, numFmt) + ", " + pct + "%)";
      case "label-pct":
      default: return registry.truncate(label, rs.maxLabelChars) + " (" + pct + "%)";
    }
  };

  /**
   * Build wrapped lines for a pie/donut OUTSIDE label.
   * Wraps the label across up to maxLines lines using wrapText, then appends
   * the suffix (like " (45%)" or " (12.3K)") to the last line so it never
   * splits across wraps. If even wrapped the label exceeds maxLines, the
   * overflow into the last line is truncated with an ellipsis.
   *
   * @param {string} label       raw label text
   * @param {number} pct         percentage value (e.g. 45)
   * @param {number|string} absVal absolute value
   * @param {string} contentMode "pct" | "value" | "value-pct" |
   *                             "label-pct" | "label-value" |
   *                             "label-value-pct"
   * @param {number} fontSize
   * @param {number} maxWidth    available pixel width for text
   * @param {number} maxLines    2 or 3 typically
   * @param {object} numFmt      passed to formatNumber
   * @returns {string[]}         array of line strings (1..maxLines long)
   */
  registry.buildPieLabelLines = function (label, pct, absVal, contentMode, fontSize, maxWidth, maxLines, numFmt) {
    maxLines = maxLines || 2;

    // Compact modes — single line, no wrapping needed.
    if (contentMode === "pct")       return [pct + "%"];
    if (contentMode === "value")     return [registry.formatNumber(absVal, numFmt)];
    if (contentMode === "value-pct") return [registry.formatNumber(absVal, numFmt) + " (" + pct + "%)"];

    // label-value / label-value-pct / label-pct (default): wrap label,
    // suffix on last line.
    var suffix;
    if (contentMode === "label-value") {
      suffix = " (" + registry.formatNumber(absVal, numFmt) + ")";
    } else if (contentMode === "label-value-pct") {
      suffix = " (" + registry.formatNumber(absVal, numFmt) + ", " + pct + "%)";
    } else {
      suffix = " (" + pct + "%)";
    }

    // Pie/donut outside labels render in fonts.label (Roboto Condensed)
    var lines = registry.wrapText(label || "", fontSize, Math.max(20, maxWidth), registry.LABEL_ADVANCE);
    if (!lines.length) lines = [""];

    if (lines.length > maxLines) {
      var lastIdx = maxLines - 1;
      var remaining = lines.slice(lastIdx).join(" ");
      var maxChars = Math.floor(maxWidth / (fontSize * registry.LABEL_ADVANCE));
      var cap = Math.max(1, maxChars - suffix.length - 1);
      if (remaining.length > cap) remaining = remaining.substring(0, cap) + "\u2026";
      lines = lines.slice(0, lastIdx).concat([remaining]);
    }

    lines[lines.length - 1] = lines[lines.length - 1] + suffix;
    return lines;
  };

  // ── Inline Icon Helpers ────────────────────────────────

  /**
   * Compute rendered dimensions for an icon/flag.
   *
   * When normalize=false (default, for humanitarian icons):
   *   Simple height-based scaling: all icons get the same height.
   *
   * When normalize=true (for flags):
   *   Area-normalized scaling: all flags get roughly the same visual area,
   *   regardless of aspect ratio. A square flag (Switzerland 1:1) becomes
   *   slightly taller/wider while a wide flag (Sudan ~2:1) becomes slightly
   *   shorter. The reference area is that of a standard 3:2 flag at targetH.
   *
   * Returns { w, h, scale }.
   */
  registry.getIconDims = function (resolved, targetH, normalize) {
    if (!resolved || !resolved.vbH || !resolved.vbW) return { w: 0, h: 0, scale: 0 };

    var scale;
    if (normalize) {
      // normalize can be:
      //   true  → 1.5 (3:2 flag reference, backward compat)
      //   number → custom aspect ratio (e.g. 1.0 for square icons)
      var refRatio = (typeof normalize === "number") ? normalize : 1.5;
      var refArea = targetH * (targetH * refRatio);
      var srcArea = resolved.vbW * resolved.vbH;
      scale = Math.sqrt(refArea / srcArea);
    } else {
      scale = targetH / resolved.vbH;
    }

    return {
      w: resolved.vbW * scale,
      h: resolved.vbH * scale,
      scale: scale
    };
  };

  /**
   * Build an SVG <g> with resolved icon content.
   * Uses getIconDims for scaling (normalize=true for area-based flag sizing).
   * Optional fillColor applies a fill override (for humanitarian icons).
   * Returns SVG string or "".
   */
  registry.buildIconGroup = function (resolved, targetH, x, y, fillColor, normalize) {
    if (!resolved || !resolved.innerSvg) return "";
    var dims = registry.getIconDims(resolved, targetH, normalize);
    var content = resolved.innerSvg;
    var colorAttr = '';
    if (fillColor) {
      content = content.replace(/fill:\s*#[0-9a-fA-F]{3,8}\b/g, 'fill:' + fillColor);
      content = content.replace(/fill="[^"]*"/g, 'fill="' + fillColor + '"');
      colorAttr = ' fill="' + fillColor + '"';
    }
    // Wrap in nested <svg> with overflow hidden so flags whose clipPaths were
    // stripped still clip correctly to their viewBox bounds
    return '<svg x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
      '" width="' + dims.w.toFixed(2) + '" height="' + dims.h.toFixed(2) +
      '" viewBox="0 0 ' + resolved.vbW + ' ' + resolved.vbH +
      '" overflow="hidden"' + colorAttr + '>' + content + '</svg>';
  };

  /**
   * Get the rendered width of an icon at a given target height.
   */
  registry.getIconWidth = function (resolved, targetH, normalize) {
    return registry.getIconDims(resolved, targetH, normalize).w;
  };

  /**
   * Get the rendered height of an icon at a given target height.
   * Only differs from targetH when normalize=true.
   */
  registry.getIconHeight = function (resolved, targetH, normalize) {
    return registry.getIconDims(resolved, targetH, normalize).h;
  };

  /**
   * Build a <path> for a rectangle with selective corner rounding.
   * @param {number} x - left edge
   * @param {number} y - top edge
   * @param {number} w - width
   * @param {number} h - height
   * @param {number} r - corner radius
   * @param {boolean} tl - round top-left
   * @param {boolean} tr - round top-right
   * @param {boolean} br - round bottom-right
   * @param {boolean} bl - round bottom-left
   * @returns {string} SVG path d attribute
   */
  registry.roundedRectPath = function (x, y, w, h, r, tl, tr, br, bl) {
    r = Math.min(r, w / 2, h / 2);
    var rtl = tl ? r : 0, rtr = tr ? r : 0, rbr = br ? r : 0, rbl = bl ? r : 0;
    return 'M' + (x + rtl).toFixed(1) + ',' + y.toFixed(1) +
      ' L' + (x + w - rtr).toFixed(1) + ',' + y.toFixed(1) +
      (rtr ? ' A' + rtr + ',' + rtr + ' 0 0 1 ' + (x + w).toFixed(1) + ',' + (y + rtr).toFixed(1) : '') +
      ' L' + (x + w).toFixed(1) + ',' + (y + h - rbr).toFixed(1) +
      (rbr ? ' A' + rbr + ',' + rbr + ' 0 0 1 ' + (x + w - rbr).toFixed(1) + ',' + (y + h).toFixed(1) : '') +
      ' L' + (x + rbl).toFixed(1) + ',' + (y + h).toFixed(1) +
      (rbl ? ' A' + rbl + ',' + rbl + ' 0 0 1 ' + x.toFixed(1) + ',' + (y + h - rbl).toFixed(1) : '') +
      ' L' + x.toFixed(1) + ',' + (y + rtl).toFixed(1) +
      (rtl ? ' A' + rtl + ',' + rtl + ' 0 0 1 ' + (x + rtl).toFixed(1) + ',' + y.toFixed(1) : '') +
      ' Z';
  };

  /**
   * Find the maximum icon width across data items at a given target height.
   * Returns 0 if no icons are present.
   */
  registry.maxIconWidth = function (data, targetH, normalize) {
    var maxW = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i]._iconSvg) {
        var w = registry.getIconWidth(data[i]._iconSvg, targetH, normalize);
        if (w > maxW) maxW = w;
      }
    }
    return maxW;
  };

  /**
   * Find the maximum icon height across data items at a given target height.
   * Only meaningful when normalize=true (heights vary per icon).
   */
  registry.maxIconHeight = function (data, targetH, normalize) {
    var maxH = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i]._iconSvg) {
        var h = registry.getIconHeight(data[i]._iconSvg, targetH, normalize);
        if (h > maxH) maxH = h;
      }
    }
    return maxH;
  };

  return registry;
})();
