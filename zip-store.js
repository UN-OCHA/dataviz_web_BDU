/**
 * ZipStore — builds a .zip file in the browser, with no outside library.
 *
 * Files are STORED (not compressed): the web version zips a handful of SVG
 * charts, where compression would save little and a deflate implementation
 * would be a lot of code to maintain. File names are UTF-8 (general-purpose
 * flag bit 11), so titles with accents survive.
 *
 *   var blob = ZipStore.build([{ name: "chart.svg", text: "<svg…" }, …]);
 */

/* exported ZipStore */

var ZipStore = (function () {
  "use strict";

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // MS-DOS date/time, as ZIP stores it.
  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function build(files, now) {
    var enc = new TextEncoder();
    var dt = dosDateTime(now || new Date());
    var parts = [], central = [], offset = 0;

    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = enc.encode(f.text);
      var crc = crc32(data);

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);     // local file header
      local.setUint16(4, 20, true);             // version needed
      local.setUint16(6, 0x0800, true);         // flags: UTF-8 names
      local.setUint16(8, 0, true);              // method: stored
      local.setUint16(10, dt.time, true);
      local.setUint16(12, dt.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);   // compressed size
      local.setUint32(22, data.length, true);   // uncompressed size
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);             // extra length
      parts.push(new Uint8Array(local.buffer), name, data);

      var cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);       // central directory header
      cen.setUint16(4, 20, true);               // version made by
      cen.setUint16(6, 20, true);               // version needed
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, dt.time, true);
      cen.setUint16(14, dt.date, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint16(30, 0, true);               // extra
      cen.setUint16(32, 0, true);               // comment
      cen.setUint16(34, 0, true);               // disk
      cen.setUint16(36, 0, true);               // internal attrs
      cen.setUint32(38, 0, true);               // external attrs
      cen.setUint32(42, offset, true);          // local header offset
      central.push(new Uint8Array(cen.buffer), name);

      offset += 30 + name.length + data.length;
    });

    var centralSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);         // end of central directory
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: "application/zip" });
  }

  return { build: build, crc32: crc32 };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = ZipStore; }
