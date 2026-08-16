/**
 * animation.js — Animation subsystem for pixel-engine (zero dependencies).
 *
 * UMD: Node `require('./engine/animation.js')` attaches to the pixel-engine
 * object; browser loads pixel-engine.js first, then animation.js attaches to
 * window.PixelEngine. No second pixel system: every frame is an ordinary
 * scene document and all pixel work delegates to the engine.
 *
 * ANIMATION DOCUMENT (plain JSON, agent-maintained):
 *
 *   {
 *     "width": 16, "height": 16, "fps": 8, "background": null,
 *     "palette": { "bg": "#1A1A2E", "ball": "#E94560" },
 *     "keyframes": { "frame-0": true },
 *     "frames": [
 *       { "id": "frame-0", "scene": { "size": 16, "palette": {...}, "layers": [...], "pixels": {...} } },
 *       { "id": "frame-1", "scene": { ... } }
 *     ]
 *   }
 *
 * Authoring model: duplicate a frame, then make localized changes (pixel
 * overrides, layer tweaks) — the diff between consecutive frames is the
 * motion. diff_frames() reports it exactly, validate_change() checks it
 * against an allowed region. Spritesheets are an export format, never the
 * internal representation. Frames are complete scenes for now; deltas are
 * computed, not stored.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const PE = require('./pixel-engine.js');
    module.exports = factory(PE);
  } else {
    factory(root.PixelEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (PE) {
  'use strict';

  // --------------------------------------------------------------------------
  // document lifecycle
  // --------------------------------------------------------------------------

  /** create_animation(width, height, opts?) -> empty animation document. opts: { fps?, background? } */
  function create_animation(width, height, opts) {
    opts = opts || {};
    return {
      width: width || 16,
      height: height || 16,
      fps: opts.fps || 8,
      background: opts.background !== undefined ? opts.background : null,
      palette: {},
      keyframes: {},
      frames: []
    };
  }

  function getFrame(anim, frameId) {
    const f = (anim.frames || []).find(function (fr) { return fr.id === frameId; });
    if (!f) throw new Error('unknown frame: ' + frameId);
    return f;
  }

  /** Frame scene with the animation palette seeded in — keys resolve against scene.palette. */
  function frameScene(anim, frameId) {
    const fr = getFrame(anim, frameId);
    seedPalette(fr.scene, anim.palette);
    return fr.scene;
  }

  /** normalize_animation(anim) -> same doc with defaults filled in (for loading JSON). */
  function normalize_animation(anim) {
    if (!anim.width) anim.width = anim.height || 16;
    if (!anim.height) anim.height = anim.width;
    if (!anim.fps) anim.fps = 8;
    if (!anim.palette) anim.palette = {};
    if (!anim.keyframes) anim.keyframes = {};
    if (!Array.isArray(anim.frames)) anim.frames = [];
    anim.frames.forEach(function (fr, i) {
      if (!fr.id) fr.id = 'frame-' + i;
      if (!fr.scene.size) fr.scene.size = anim.width;
      seedPalette(fr.scene, anim.palette);
    });
    return anim;
  }

  function seedPalette(scene, palette) {
    if (!scene.palette) scene.palette = {};
    for (const key of Object.keys(palette || {})) {
      if (!Object.prototype.hasOwnProperty.call(scene.palette, key)) scene.palette[key] = palette[key];
    }
  }

  /** add_frame(anim, scene?) -> new frame id. Scene defaults to a blank canvas. */
  function add_frame(anim, scene) {
    if (scene) {
      if (scene.size !== anim.width || scene.size !== anim.height) {
        throw new Error('frame scene size ' + scene.size + ' != animation ' + anim.width + 'x' + anim.height);
      }
    } else {
      scene = PE.create_canvas(anim.width, anim.background);
    }
    seedPalette(scene, anim.palette);
    const frame = { id: 'frame-' + anim.frames.length, scene: scene };
    anim.frames.push(frame);
    for (const key of Object.keys(scene.palette || {})) {
      if (!Object.prototype.hasOwnProperty.call(anim.palette, key)) anim.palette[key] = scene.palette[key];
    }
    return frame.id;
  }

  /** duplicate_frame(anim, frameId) -> deep-copied new frame id (independent of the source). */
  function duplicate_frame(anim, frameId) {
    const src = getFrame(anim, frameId);
    const scene = JSON.parse(JSON.stringify(src.scene));
    const frame = { id: 'frame-' + anim.frames.length, scene: scene };
    anim.frames.push(frame);
    return frame.id;
  }

  /** delete_frame(anim, frameId) -> true if removed. */
  function delete_frame(anim, frameId) {
    const idx = (anim.frames || []).findIndex(function (fr) { return fr.id === frameId; });
    if (idx === -1) return false;
    anim.frames.splice(idx, 1);
    delete anim.keyframes[frameId];
    return true;
  }

  /** frame_ids(anim) -> frame ids in play order. */
  function frame_ids(anim) {
    return (anim.frames || []).map(function (fr) { return fr.id; });
  }

  /** resolve_frame(anim, frameId) -> Uint8Array RGBA buffer (engine rasterize). */
  function resolve_frame(anim, frameId) {
    return PE.rasterize(frameScene(anim, frameId));
  }

  // --------------------------------------------------------------------------
  // frame pixel ops (delegate to the engine's scene ops)
  // --------------------------------------------------------------------------

  /** set_frame_pixel(anim, frameId, x, y, color) -> sparse override on the frame scene. */
  function set_frame_pixel(anim, frameId, x, y, color) {
    PE.set_pixel(frameScene(anim, frameId), x, y, color);
    return frameId;
  }

  /** get_frame_pixel(anim, frameId, x, y) -> resolved hex color or null (transparent/OOB). */
  function get_frame_pixel(anim, frameId, x, y) {
    return PE.get_pixel(frameScene(anim, frameId), x, y);
  }

  /** clear_frame_pixel(anim, frameId, x, y) -> remove override, reveal layers beneath. */
  function clear_frame_pixel(anim, frameId, x, y) {
    PE.clear_pixel(frameScene(anim, frameId), x, y);
    return frameId;
  }

  /** fill_frame_region(anim, frameId, x, y, w, h, color) -> filled rect layer on the frame scene. */
  function fill_frame_region(anim, frameId, x, y, w, h, color) {
    PE.fill_region(frameScene(anim, frameId), x, y, w, h, color);
    return frameId;
  }

  /**
   * move_frame_region(anim, frameId, x, y, w, h, dx, dy) -> moves the opaque
   * pixels of a region to (x+dx, y+dy) within the same frame. Source pixels
   * become null overrides, revealing the layers beneath — for sprites drawn
   * as overrides on a filled background this erases cleanly. Returns { moved }.
   */
  function move_frame_region(anim, frameId, x, y, w, h, dx, dy) {
    const scene = frameScene(anim, frameId);
    const size = scene.size;
    const buf = PE.rasterize(scene);
    const x1 = Math.min(size, x + w), y1 = Math.min(size, y + h);
    const moved = [];
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) {
        const i = (yy * size + xx) * 4;
        if (buf[i + 3] === 0) continue;
        const hex = '#' + [buf[i], buf[i + 1], buf[i + 2]].map(function (v) {
          return ('0' + v.toString(16)).slice(-2);
        }).join('');
        const nx = xx + dx, ny = yy + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
          PE.set_pixel(scene, nx, ny, hex);
          moved.push({ x: xx, y: yy, to: [nx, ny] });
        }
        PE.set_pixel(scene, xx, yy, null);
      }
    }
    return { moved: moved.length };
  }

  /**
   * copy_frame_region(anim, srcId, dstId, x, y, w, h, dx, dy) -> copies the
   * opaque pixels of src's region onto dst as overrides at the offset.
   * dstId defaults to srcId. Returns { copied }.
   */
  function copy_frame_region(anim, srcId, dstId, x, y, w, h, dx, dy) {
    if (dstId === undefined || dstId === null) dstId = srcId;
    const srcScene = frameScene(anim, srcId);
    const dstScene = frameScene(anim, dstId);
    const size = srcScene.size;
    const buf = PE.rasterize(srcScene);
    const x1 = Math.min(size, x + w), y1 = Math.min(size, y + h);
    let copied = 0;
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) {
        const i = (yy * size + xx) * 4;
        if (buf[i + 3] === 0) continue;
        const hex = '#' + [buf[i], buf[i + 1], buf[i + 2]].map(function (v) {
          return ('0' + v.toString(16)).slice(-2);
        }).join('');
        const nx = xx + dx, ny = yy + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
          PE.set_pixel(dstScene, nx, ny, hex);
          copied++;
        }
      }
    }
    return { copied: copied };
  }

  /** set_keyframe(anim, frameId, value?) -> marks a frame as a keyframe (default true). */
  function set_keyframe(anim, frameId, value) {
    getFrame(anim, frameId);
    if (value === false) delete anim.keyframes[frameId];
    else anim.keyframes[frameId] = true;
    return frameId;
  }

  /** is_keyframe(anim, frameId) -> bool. */
  function is_keyframe(anim, frameId) {
    return !!anim.keyframes[frameId];
  }

  // --------------------------------------------------------------------------
  // exact diffing + region validation
  // --------------------------------------------------------------------------

  function hexOrNull(buf, i) {
    if (buf[i + 3] === 0) return null;
    return '#' + [buf[i], buf[i + 1], buf[i + 2]].map(function (v) {
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }

  /**
   * diff_frames(anim, aId, bId) -> exact pixel diff, row-major:
   * { changed_pixels, unchanged_pixels, change_percentage, bounding_box, changes }
   * changes[i] = { x, y, old_value, new_value } (hex or null for transparent).
   * bounding_box = [x, y, w, h] or null when frames are identical.
   */
  function diff_frames(anim, aId, bId) {
    const a = resolve_frame(anim, aId);
    const b = resolve_frame(anim, bId);
    const w = anim.width, h = anim.height;
    const total = w * h;
    const changes = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const same = a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3];
        if (same) continue;
        changes.push({ x: x, y: y, old_value: hexOrNull(a, i), new_value: hexOrNull(b, i) });
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const changed = changes.length;
    const bbox = changed ? [minX, minY, maxX - minX + 1, maxY - minY + 1] : null;
    return {
      width: w,
      height: h,
      changed_pixels: changed,
      unchanged_pixels: total - changed,
      change_percentage: Math.round((changed / total) * 10000) / 100,
      bounding_box: bbox,
      changes: changes
    };
  }

  /**
   * validate_change(anim, aId, bId, allowed_region?) -> { pass, total_changes,
   * unexpected_changes, unexpected }. allowed_region = [x, y, w, h] or null for
   * the whole frame. unexpected = changes outside the allowed region.
   */
  function validate_change(anim, aId, bId, allowed_region) {
    const diff = diff_frames(anim, aId, bId);
    const unexpected = [];
    if (allowed_region) {
      const [rx, ry, rw, rh] = allowed_region;
      for (const c of diff.changes) {
        if (!(c.x >= rx && c.x < rx + rw && c.y >= ry && c.y < ry + rh)) unexpected.push(c);
      }
    }
    return {
      pass: unexpected.length === 0,
      allowed_region: allowed_region || null,
      total_changes: diff.changed_pixels,
      unexpected_changes: unexpected.length,
      unexpected: unexpected
    };
  }

  // --------------------------------------------------------------------------
  // palette reporting
  // --------------------------------------------------------------------------

  /** frame_palette(anim, frameId) -> { total, colors: { hex: count } } of resolved opaque pixels. */
  function frame_palette(anim, frameId) {
    const buf = resolve_frame(anim, frameId);
    const w = anim.width, h = anim.height;
    const colors = {};
    let total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (buf[i + 3] === 0) continue;
        const hex = hexOrNull(buf, i);
        colors[hex] = (colors[hex] || 0) + 1;
        total++;
      }
    }
    return { total: total, colors: colors };
  }

  /** palette_drift(anim) -> frames whose scene palette has keys missing from anim.palette. */
  function palette_drift(anim) {
    const drift = [];
    for (const fr of anim.frames || []) {
      const missing = Object.keys(fr.scene.palette || {}).filter(function (k) {
        return !Object.prototype.hasOwnProperty.call(anim.palette, k);
      });
      if (missing.length) drift.push({ frameId: fr.id, missing: missing });
    }
    return drift;
  }

  // --------------------------------------------------------------------------
  // spritesheet export
  // --------------------------------------------------------------------------

  /**
   * encode_spritesheet(anim, opts?) -> Uint8Array PNG. Frames laid out left to
   * right; opts: { columns? } (default: all frames in one row). Cells are the
   * resolved frame buffers — the sheet is a pure export artifact.
   */
  function encode_spritesheet(anim, opts) {
    opts = opts || {};
    const columns = opts.columns || anim.frames.length;
    const rows = Math.ceil(anim.frames.length / columns);
    const cw = anim.width, ch = anim.height;
    const sheet = new Uint8Array(columns * cw * rows * ch * 4);
    anim.frames.forEach(function (fr, i) {
      const col = i % columns, row = Math.floor(i / columns);
      const buf = resolve_frame(anim, fr.id);
      for (let y = 0; y < ch; y++) {
        const src = (y * cw) * 4;
        const dst = ((row * ch + y) * columns * cw + col * cw) * 4;
        sheet.set(buf.subarray(src, src + cw * 4), dst);
      }
    });
    return PE.encode_png_buffer(sheet, columns * cw, rows * ch);
  }

  /** export_spritesheet(anim, path, opts?) — Node only. */
  function export_spritesheet(anim, path, opts) {
    if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
      throw new Error('export_spritesheet requires Node.js');
    }
    require('fs').writeFileSync(path, Buffer.from(encode_spritesheet(anim, opts)));
  }

  // --------------------------------------------------------------------------
  // HTML preview (self-contained playback)
  // --------------------------------------------------------------------------

  function pngDataURL(png) {
    if (typeof btoa === 'function') {
      let bin = '';
      for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i]);
      return btoa(bin);
    }
    return Buffer.from(png).toString('base64');
  }

  /**
   * animation_to_html(anim, opts?) -> self-contained HTML preview string.
   * opts: { scale?: number (default 8), title?: string }. Node: opts.path writes.
   * Renders the resolved frame PNGs; play/pause/restart/step/next/prev, fps
   * control, keyframe badge, click-to-inspect, PNG + spritesheet download.
   */
  function animation_to_html(anim, opts) {
    opts = opts || {};
    const scale = opts.scale || 8;
    const title = opts.title || 'Pixel animation';
    const frames = anim.frames.map(function (fr) {
      const png = PE.encode_png(fr.scene);
      const scene = JSON.parse(JSON.stringify(fr.scene));
      for (const key of Object.keys(scene)) if (key[0] === '_') delete scene[key];
      return {
        id: fr.id,
        keyframe: !!anim.keyframes[fr.id],
        b64: pngDataURL(png),
        ascii: PE.read_region(fr.scene).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
        scene: scene
      };
    });
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + title + '</title>' +
      '<style>' +
      'body{font-family:ui-monospace,Consolas,monospace;background:#111;color:#ddd;margin:24px;}' +
      'h1{font-size:16px;color:#888;font-weight:400;}' +
      'canvas{image-rendering:pixelated;image-rendering:crisp-edges;border:1px solid #333;background:repeating-conic-gradient(#2a2a2a 0 25%,#222 0 50%) 0 0/16px 16px;}' +
      'pre{background:#0c0c0c;border:1px solid #2a2a2a;padding:12px;font-size:11px;line-height:1.15;overflow:auto;white-space:pre;}' +
      'button{background:#222;color:#ddd;border:1px solid #444;padding:6px 14px;cursor:pointer;margin-right:6px;}' +
      'input{background:#222;color:#ddd;border:1px solid #444;padding:6px;width:56px;}' +
      '.key{color:#ffd34e;}' +
      '</style></head><body>' +
      '<h1>' + title + ' — ' + anim.width + '×' + anim.height + ', ' + anim.frames.length + ' frames, ' + anim.fps + ' fps</h1>' +
      '<canvas id="cv" width="' + (anim.width * scale) + '" height="' + (anim.height * scale) + '"></canvas>' +
      '<div style="margin:10px 0;">' +
      '<button id="play">Play</button>' +
      '<button id="restart">Restart</button>' +
      '<button id="prev">Prev</button>' +
      '<button id="next">Next</button>' +
      '<button id="step">Step</button>' +
      '<span style="margin:0 10px;font-size:12px;">fps</span><input id="fps" value="' + anim.fps + '">' +
      '<span id="frame-info" style="margin-left:14px;font-size:13px;"></span>' +
      '</div>' +
      '<div style="margin:6px 0;font-size:12px;" id="info">click canvas to inspect pixel</div>' +
      '<button onclick="dl()">Export current frame PNG</button> ' +
      '<button onclick="dlSheet()">Export spritesheet PNG</button> ' +
      '<button onclick="toggleAscii()">Toggle ASCII (all frames)</button>' +
      '<pre id="ascii" style="display:none;">' + frames.map(function (f) {
        return '-- ' + f.id + (f.keyframe ? ' (keyframe)' : '') + ' --\n' + f.ascii;
      }).join('\n\n') + '</pre>' +
      '<script>' +
      'var frames = ' + JSON.stringify(frames.map(function (f) { return { id: f.id, keyframe: f.keyframe, b64: f.b64, scene: f.scene }; })) + ';\n' +
      'var imgs = frames.map(function(f){ var im = new Image(); im.src = "data:image/png;base64," + f.b64; return im; });\n' +
      'imgs.forEach(function(im, i){ im.onload = function(){ if (i === idx) draw(); }; });\n' +
      'var idx = 0, playing = false, fps = ' + anim.fps + ', last = 0;\n' +
      'var cv = document.getElementById("cv"), ctx = cv.getContext("2d");\n' +
      'ctx.imageSmoothingEnabled = false;\n' +
      'var scale = ' + scale + ', size = ' + anim.width + ';\n' +
      'function draw(){\n' +
      '  ctx.drawImage(imgs[idx], 0, 0, cv.width, cv.height);\n' +
      '  var f = frames[idx];\n' +
      '  document.getElementById("frame-info").textContent = "frame " + (idx + 1) + "/" + frames.length + " (" + f.id + (f.keyframe ? ", keyframe" : "") + ")";\n' +
      '}\n' +
      'function tick(t){\n' +
      '  if (playing) { if (t - last >= 1000 / fps) { last = t; idx = (idx + 1) % frames.length; draw(); } }\n' +
      '  requestAnimationFrame(tick);\n' +
      '}\n' +
      'document.getElementById("play").onclick = function(){ playing = !playing; this.textContent = playing ? "Pause" : "Play"; };\n' +
      'document.getElementById("restart").onclick = function(){ idx = 0; draw(); };\n' +
      'document.getElementById("prev").onclick = function(){ idx = (idx - 1 + frames.length) % frames.length; draw(); };\n' +
      'document.getElementById("next").onclick = function(){ idx = (idx + 1) % frames.length; draw(); };\n' +
      'document.getElementById("step").onclick = function(){ idx = (idx + 1) % frames.length; draw(); };\n' +
      'document.getElementById("fps").onchange = function(){ var v = parseInt(this.value, 10); if (v > 0) fps = v; };\n' +
      'cv.addEventListener("click", function(e){\n' +
      '  var r = this.getBoundingClientRect();\n' +
      '  var x = Math.floor((e.clientX - r.left) * size / this.width);\n' +
      '  var y = Math.floor((e.clientY - r.top) * size / this.height);\n' +
      '  var hex = window.PixelEngine ? window.PixelEngine.get_pixel(frames[idx].scene, x, y) : null;\n' +
      '  document.getElementById("info").textContent = "frame " + frames[idx].id + " (" + x + "," + y + ") -> " + (hex || "transparent");\n' +
      '});\n' +
      'function dl(){ var a = document.createElement("a"); a.href = imgs[idx].src; a.download = "frame.png"; a.click(); }\n' +
      'function dlSheet(){ var a = document.createElement("a"); a.href = sheetUrl; a.download = "spritesheet.png"; a.click(); }\n' +
      'var sheetUrl = "data:image/png;base64,' + pngDataURL(encode_spritesheet(anim)) + '";\n' +
      'function toggleAscii(){ var p = document.getElementById("ascii"); p.style.display = p.style.display === "none" ? "block" : "none"; }\n' +
      'draw(); requestAnimationFrame(tick);\n' +
      '</script></body></html>';
    if (typeof process !== 'undefined' && process.versions && process.versions.node && opts.path) {
      require('fs').writeFileSync(opts.path, html);
    }
    return html;
  }

  // --------------------------------------------------------------------------

  PE.create_animation = create_animation;
  PE.normalize_animation = normalize_animation;
  PE.add_frame = add_frame;
  PE.duplicate_frame = duplicate_frame;
  PE.delete_frame = delete_frame;
  PE.frame_ids = frame_ids;
  PE.resolve_frame = resolve_frame;
  PE.set_frame_pixel = set_frame_pixel;
  PE.get_frame_pixel = get_frame_pixel;
  PE.clear_frame_pixel = clear_frame_pixel;
  PE.fill_frame_region = fill_frame_region;
  PE.move_frame_region = move_frame_region;
  PE.copy_frame_region = copy_frame_region;
  PE.set_keyframe = set_keyframe;
  PE.is_keyframe = is_keyframe;
  PE.diff_frames = diff_frames;
  PE.validate_change = validate_change;
  PE.frame_palette = frame_palette;
  PE.palette_drift = palette_drift;
  PE.encode_spritesheet = encode_spritesheet;
  PE.export_spritesheet = export_spritesheet;
  PE.animation_to_html = animation_to_html;

  return PE;
});
