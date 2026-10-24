/* pixel.js — the shared retro look for every game: simple, flat, chunky pixels like an Atari or Game Boy game.
   A game opts in with <script src="pixel.js"></script> and <body class="px">. That gives it:
   - the 8-bit font (Press Start 2P) for its own text: score, labels, buttons, the win/lose screen. The quiz question
     pop-up keeps its normal font so questions stay easy to read.
   - crisp scaling: canvases and pixel images are enlarged without blurring, so every art pixel is a sharp square.
   - PX drawing helpers. Pieces are flat colors with a dark outline: no gradients, no shading, no textures. */
(function () {
  var st = document.createElement('style');
  st.textContent =
    // the font ships with the app (games/fonts, SIL Open Font License) so it works even where Google Fonts is blocked
    '@font-face{font-family:"Press Start 2P";font-display:swap;src:url(fonts/press-start-2p-latin-400-normal.woff2) format("woff2")}' +
    '.px{font-family:"Press Start 2P",ui-monospace,monospace;-webkit-font-smoothing:none;line-height:1.5}' +
    '.px b,.px strong,.px h1,.px h2,.px h3{font-weight:400}' +                     // the font has one weight; fake bold blurs it
    '.px canvas,.px .pxi{image-rendering:pixelated;image-rendering:crisp-edges}' +
    // flat pixel buttons: a dark outline drawn as four offset edges, so the corners come out stepped.
    // A game can recolor the outline with --px-line.
    '.px .btn:not(.quiz-box .btn),.px .kit-end .btn{font-family:inherit;font-weight:400;border:none;border-radius:0;' +
      'box-shadow:0 -3px 0 var(--px-line,#000),0 3px 0 var(--px-line,#000),-3px 0 0 var(--px-line,#000),3px 0 0 var(--px-line,#000)}' +
    '.px .btn:not(.quiz-box .btn):active,.px .kit-end .btn:active{transform:translateY(3px)}' +
    '.px .kit-end{font-family:"Press Start 2P",ui-monospace,monospace}' +
    '.px .kit-end h2{font-size:1.4rem;font-weight:400;margin-bottom:14px}' +
    '.px .kit-end p{font-size:.8rem}' +
    '.px .kit-end .btn{padding:12px 20px;background:#fff;color:#000;font-size:.8rem;cursor:pointer}' +
    // a pixel frame: solid square border
    '.px .pxframe{border-radius:0!important;border:none!important;box-shadow:0 0 0 4px #fff}';
  document.head.appendChild(st);

  function hex(c) {                                           // '#abc' / '#aabbcc' / 'rgb(...)' -> [r,g,b]
    if (c[0] === '#') {
      if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    }
    var m = c.match(/\d+/g) || [0, 0, 0];
    return [+m[0], +m[1], +m[2]];
  }
  // amt > 0 mixes toward white, amt < 0 toward black (-1..1)
  function shade(c, amt) {
    var v = hex(c), t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    return 'rgb(' + v.map(function (x) { return Math.round(x + (t - x) * p); }).join(',') + ')';
  }

  // A flat square tile s pixels wide with a dark outline and one light pixel corner (Tetris cells, blocks, ...)
  function block(g, x, y, s, c, outline) {
    x = Math.round(x); y = Math.round(y); s = Math.round(s);
    g.fillStyle = outline || '#000'; g.fillRect(x, y, s, s);
    g.fillStyle = c; g.fillRect(x + 1, y + 1, s - 2, s - 2);
    if (s >= 6) { g.fillStyle = shade(c, 0.55); g.fillRect(x + 1, y + 1, 1, 1); }
  }

  // A flat round piece (discs, checkers, bubbles): one color, dark outline, a 1-pixel shine
  function disc(g, cx, cy, r, c, opts) {
    opts = opts || {};
    var out = opts.outline || '#000';
    var x0 = Math.floor(cx - r), y0 = Math.floor(cy - r), d = Math.ceil(r * 2);
    for (var j = 0; j < d; j++) for (var i = 0; i < d; i++) {
      var dx = x0 + i + 0.5 - cx, dy = y0 + j + 0.5 - cy, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) continue;
      g.fillStyle = dist > r - 1 ? out : c;
      g.fillRect(x0 + i, y0 + j, 1, 1);
    }
    if (r >= 4 && !opts.noShine) { g.fillStyle = shade(c, 0.6); g.fillRect(Math.round(cx - r * 0.45), Math.round(cy - r * 0.45), 1, 1); }
  }

  // A thin circle line (the inner ring on discs and checkers)
  function ring(g, cx, cy, r, c) {
    g.fillStyle = c;
    var x0 = Math.floor(cx - r - 1), y0 = Math.floor(cy - r - 1), d = Math.ceil(r * 2) + 2;
    for (var j = 0; j < d; j++) for (var i = 0; i < d; i++) {
      var dx = x0 + i + 0.5 - cx, dy = y0 + j + 0.5 - cy;
      if (Math.abs(Math.sqrt(dx * dx + dy * dy) - r) < 0.5) g.fillRect(x0 + i, y0 + j, 1, 1);
    }
  }

  // A thick line made of square pixels (robot fingers, rods)
  function line(g, x0, y0, x1, y1, w, c) {
    g.fillStyle = c;
    var n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0, h = w / 2;
    for (var k = 0; k <= n; k++) {
      var x = x0 + (x1 - x0) * (n ? k / n : 0), y = y0 + (y1 - y0) * (n ? k / n : 0);
      g.fillRect(Math.round(x - h), Math.round(y - h), w, w);
    }
  }

  // Draw a picture from rows of letters, one letter per pixel, using a color for each letter ('.' = empty)
  function map(g, rows, colors, ox, oy) {
    rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) if (colors[row[x]]) { g.fillStyle = colors[row[x]]; g.fillRect((ox || 0) + x, (oy || 0) + y, 1, 1); }
    });
  }

  // Draw on a small canvas and read it back as squares: one <rect> per run of same-colored pixels in a row
  function rects(w, h, draw) {
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var g = cv.getContext('2d'); draw(g, w, h);
    var d = g.getImageData(0, 0, w, h).data, out = '';
    var hx = function (i) { return '#' + ((1 << 24) | (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]).toString(16).slice(1); };
    for (var y = 0; y < h; y++) for (var x = 0; x < w;) {
      var i = (y * w + x) * 4;
      if (d[i + 3] < 128) { x++; continue; }
      var x2 = x + 1;
      while (x2 < w) { var k = (y * w + x2) * 4; if (d[k + 3] < 128 || d[k] !== d[i] || d[k + 1] !== d[i + 1] || d[k + 2] !== d[i + 2]) break; x2++; }
      out += '<rect x="' + x + '" y="' + y + '" width="' + (x2 - x) + '" height="1" fill="' + hx(i) + '"/>';
      x = x2;
    }
    return out;
  }

  // Small pixel pictures for games built from page elements (pieces, holes, crowns). They come back as a vector image
  // made of squares, not a tiny bitmap: iPhone Safari blurs stretched bitmaps, but squares stay sharp at any size.
  function sprite(w, h, draw) {
    var svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h +
      '" preserveAspectRatio="none" shape-rendering="crispEdges">' + rects(w, h, draw) + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svgText).replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  // The same squares as inline SVG markup, for pictures with moving parts (the Checkers robot's blinking eyes)
  function svg(w, h, draw) { return '<g shape-rendering="crispEdges">' + rects(w, h, draw) + '</g>'; }

  window.PX = { shade: shade, block: block, disc: disc, ring: ring, line: line, map: map, sprite: sprite, svg: svg };
})();
