/* pixel.js — the shared pixel-art look for every game.
   A game opts in with <script src="pixel.js"></script> and <body class="px">. That gives it:
   - the pixel font for its own text (score, labels, buttons, the win/lose screen). The quiz question pop-up keeps its
     normal font so questions stay easy to read.
   - crisp scaling: canvases and pixel images are enlarged without blurring, so every art pixel is a sharp block.
   - PX drawing helpers. Games draw at half size (1 art pixel = 2x2 screen pixels) and every piece gets the same
     treatment: a dark outline, a light top-left edge, a shadowed bottom-right edge and dithered (checkered) shading. */
(function () {
  var st = document.createElement('style');
  st.textContent =
    // Pixelify Sans ships with the app (games/fonts, SIL Open Font License) so it works even where Google Fonts is blocked
    '@font-face{font-family:"Pixelify Sans";font-weight:400;font-display:swap;src:url(fonts/pixelify-sans-latin-400-normal.woff2) format("woff2")}' +
    '@font-face{font-family:"Pixelify Sans";font-weight:600 700;font-display:swap;src:url(fonts/pixelify-sans-latin-700-normal.woff2) format("woff2")}' +
    '.px{font-family:"Pixelify Sans",ui-monospace,monospace;-webkit-font-smoothing:none;font-smooth:never}' +
    '.px canvas,.px .pxi{image-rendering:pixelated;image-rendering:crisp-edges}' +
    // stepped-corner pixel buttons with a bevel (light top edge, dark bottom edge); the quiz pop-up keeps its own buttons
    '.px .btn:not(.quiz-box .btn),.px .kit-end .btn{font-family:inherit;border-radius:0;border:none;' +
      'clip-path:polygon(0 4px,4px 4px,4px 0,calc(100% - 4px) 0,calc(100% - 4px) 4px,100% 4px,100% calc(100% - 4px),calc(100% - 4px) calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,4px calc(100% - 4px),0 calc(100% - 4px));' +
      'box-shadow:inset 0 4px 0 rgba(255,255,255,.28),inset 0 -4px 0 rgba(0,0,0,.35)}' +
    '.px .btn:not(.quiz-box .btn):active,.px .kit-end .btn:active{transform:translateY(2px);box-shadow:inset 0 4px 0 rgba(0,0,0,.3)}' +
    '.px .kit-end{font-family:"Pixelify Sans",ui-monospace,monospace}' +
    '.px .kit-end .btn{padding:10px 22px;background:#fff;color:#1a1a2e;font-weight:700;font-size:1rem;cursor:pointer}' +
    // a pixel frame: 2px dark line with a 2px lighter inner line, square corners
    '.px .pxframe{border-radius:0!important;border:none!important;box-shadow:0 0 0 2px #05070c,0 0 0 4px rgba(255,255,255,.14)}';
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
  var BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  function px(g, x, y, c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }

  // A square tile s art-pixels wide (Tetris cells, Block Blast blocks, ...)
  function block(g, x, y, s, c) {
    x = Math.round(x); y = Math.round(y); s = Math.round(s);
    var out = shade(c, -0.68), hi = shade(c, 0.45), hi2 = shade(c, 0.2), lo = shade(c, -0.38), lo2 = shade(c, -0.22), mid = shade(c, -0.16);
    g.fillStyle = c; g.fillRect(x, y, s, s);
    for (var j = 1; j < s - 1; j++) for (var i = 1; i < s - 1; i++)       // dithered shadow toward the bottom-right
      if (i + j > s * 1.05 && (i + j) % 2 === 0) px(g, x + i, y + j, mid);
    if (s >= 10) {                                                        // second, softer bevel ring
      g.fillStyle = hi2; g.fillRect(x + 2, y + 2, s - 4, 1); g.fillRect(x + 2, y + 2, 1, s - 4);
      g.fillStyle = lo2; g.fillRect(x + 2, y + s - 3, s - 4, 1); g.fillRect(x + s - 3, y + 2, 1, s - 4);
    }
    g.fillStyle = hi; g.fillRect(x + 1, y + 1, s - 2, 1); g.fillRect(x + 1, y + 1, 1, s - 2);
    g.fillStyle = lo; g.fillRect(x + 1, y + s - 2, s - 2, 1); g.fillRect(x + s - 2, y + 1, 1, s - 2);
    if (s >= 8) { g.fillStyle = '#fff'; g.fillRect(x + 2, y + 2, 2, 1); g.fillRect(x + 2, y + 2, 1, 2); }  // shine
    g.fillStyle = out; g.fillRect(x, y, s, 1); g.fillRect(x, y + s - 1, s, 1); g.fillRect(x, y, 1, s); g.fillRect(x + s - 1, y, 1, s);
  }

  // A round piece (discs, checkers, bubbles, gems' bodies): outlined, lit from the top-left in 3 tones with dithered bands
  function disc(g, cx, cy, r, c, opts) {
    opts = opts || {};
    var out = opts.outline || shade(c, -0.6), tones = [shade(c, 0.38), c, shade(c, -0.28)];
    var x0 = Math.floor(cx - r), y0 = Math.floor(cy - r), d = Math.ceil(r * 2);
    for (var j = 0; j < d; j++) for (var i = 0; i < d; i++) {
      var dx = x0 + i + 0.5 - cx, dy = y0 + j + 0.5 - cy, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) continue;
      if (dist > r - 1) { px(g, x0 + i, y0 + j, out); continue; }
      var light = (-dx - dy) / (r * 1.6) + 0.5 - dist / (r * 2.2);          // ~1 top-left .. ~0 bottom-right
      var t = light * 3 + BAYER[(y0 + j) & 3][(x0 + i) & 3] / 16 - 0.5;      // dither between tones
      px(g, x0 + i, y0 + j, tones[t > 2 ? 0 : t > 1 ? 1 : 2]);
    }
    if (r >= 4 && !opts.noShine) {                                         // little white shine
      var sx = Math.round(cx - r * 0.45), sy = Math.round(cy - r * 0.45);
      g.fillStyle = '#fff'; g.fillRect(sx, sy, 2, 1); g.fillRect(sx, sy + 1, 1, 1);
    }
  }

  // Fill a rectangle with an ordered-dither blend of two colors (amt 0 = all a, 1 = all b)
  function dither(g, x, y, w, h, a, b, amt) {
    g.fillStyle = a; g.fillRect(x, y, w, h); g.fillStyle = b;
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++)
      if (BAYER[(y + j) & 3][(x + i) & 3] / 16 < amt) g.fillRect(x + i, y + j, 1, 1);
  }

  // Draw something small once and get it back as an image URL, for games built from page elements
  function sprite(w, h, draw) {
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    return cv.toDataURL();
  }

  // A dithered top-to-bottom background on <body> at 2x2 screen pixels per art pixel
  function background(top, bottom) {
    function paint() {
      var h = Math.max(32, Math.ceil(innerHeight / 2)), url = sprite(4, h, function (g) {
        for (var y = 0; y < h; y++) dither(g, 0, y, 4, 1, top, bottom, y / (h - 1));
      });
      var s = document.body.style;
      s.background = '#000 url(' + url + ') repeat-x 0 0 / 8px ' + h * 2 + 'px';
      s.imageRendering = 'pixelated';
      s.backgroundColor = bottom;
    }
    paint(); addEventListener('resize', paint);
  }

  window.PX = { shade: shade, block: block, disc: disc, dither: dither, sprite: sprite, background: background };
})();
