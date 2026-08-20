#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const enginePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../engine/pixel-engine.js');
const animPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../engine/animation.js');
const registryPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../engine/tool-registry.js');
const PE = require(enginePath);
require(animPath);
const tools = require(registryPath);

function sceneArg(v) {
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

async function handleTool(name, args) {
  switch (name) {
    case 'render': {
      const scene = sceneArg(args.scene);
      const out = PE.render(scene);
      const png = PE.encode_png(scene);
      return { width: out.width, height: out.height, pngBase64: Buffer.from(png).toString('base64') };
    }
    case 'inspect': return PE.inspect(sceneArg(args.scene));
    case 'read_region': return PE.read_region(sceneArg(args.scene), args.x, args.y, args.w, args.h, args.opts);
    case 'diff_scenes': return PE.diff_scenes(sceneArg(args.a), sceneArg(args.b));
    case 'diff_frames': return PE.diff_frames(sceneArg(args.anim), args.aId, args.bId);
    case 'validate_change': return PE.validate_change(sceneArg(args.anim), args.aId, args.bId, args.allowed_region);
    case 'validate_scene': return PE.validate_scene(sceneArg(args.scene));
    case 'encode_png': {
      const png = PE.encode_png(sceneArg(args.scene));
      return { base64: Buffer.from(png).toString('base64') };
    }
    case 'decode_png': {
      const buf = Buffer.from(args.base64, 'base64');
      const out = PE.decode_png(buf);
      return { width: out.width, height: out.height, rgbaBase64: Buffer.from(out.rgba).toString('base64') };
    }
    case 'quantize_palette': {
      const buf = Buffer.from(args.base64, 'base64');
      const rgba = new Uint8Array(buf);
      return PE.quantize_palette(rgba, args.maxColors);
    }
    case 'replace_color': {
      const scene = sceneArg(args.scene);
      const r = PE.replace_color(scene, args.from, args.to);
      return { ...r, scene };
    }
    case 'replace_color_region': {
      const scene = sceneArg(args.scene);
      const r = PE.replace_color_region(scene, args.x, args.y, args.w, args.h, args.from, args.to);
      return { ...r, scene };
    }
    case 'check_symmetry': return PE.check_symmetry(sceneArg(args.scene), args.axis, args.region);
    case 'measure_distance': return { distance: PE.measure_distance(args.x1, args.y1, args.x2, args.y2) };
    case 'dither_region': {
      const scene = sceneArg(args.scene);
      const r = PE.dither_region(scene, args.x, args.y, args.w, args.h, { from: args.from, to: args.to });
      return { ...r, scene };
    }
    case 'create_canvas': return PE.create_canvas(args.size, args.background);
    case 'flood_fill': {
      const scene = sceneArg(args.scene);
      const r = PE.flood_fill(scene, args.x, args.y, args.color, args.tolerance);
      return { ...r, scene };
    }
    case 'mirror_region': {
      const scene = sceneArg(args.scene);
      const r = PE.mirror_region(scene, args.x, args.y, args.w, args.h, args.axis);
      return { ...r, scene };
    }
    case 'draw_cluster': {
      const scene = sceneArg(args.scene);
      const r = PE.draw_cluster(scene, args.x, args.y, args.pattern, args.color);
      return { ...r, scene };
    }
    case 'encode_spritesheet': {
      const png = PE.encode_spritesheet(sceneArg(args.anim), { columns: args.columns });
      return { base64: Buffer.from(png).toString('base64') };
    }
    case 'encode_apng': {
      const png = PE.encode_apng(sceneArg(args.anim), { fps: args.fps, loop: args.loop });
      return { base64: Buffer.from(png).toString('base64') };
    }
    case 'encode_gif': {
      const png = PE.encode_gif(sceneArg(args.anim), { fps: args.fps, loop: args.loop });
      return { base64: Buffer.from(png).toString('base64') };
    }
    case 'animation_to_html': return { html: PE.animation_to_html(sceneArg(args.anim), { scale: args.scale, title: args.title }) };
    case 'scene_to_html': return { html: PE.scene_to_html(sceneArg(args.scene), { scale: args.scale, title: args.title }) };
    case 'extract_outline': return { outline: PE.extract_outline(sceneArg(args.scene), args.region) };
    case 'get_pixel': return { color: PE.get_pixel(sceneArg(args.scene), args.x, args.y) };
    case 'compare_scene_to_reference': {
      const refBuf = Buffer.from(args.refBase64, 'base64');
      const ref = { width: args.refWidth, height: args.refHeight, rgba: new Uint8Array(refBuf) };
      return PE.compare_scene_to_reference(sceneArg(args.scene), ref, { region: args.region });
    }
    case 'analyze_values': return PE.analyze_values(sceneArg(args.scene));
    case 'check_hue_shift': return PE.check_hue_shift(sceneArg(args.palette));
    case 'encode_compact': return PE.encode_compact(sceneArg(args.scene));
    case 'decode_compact': return PE.decode_compact(sceneArg(args.compact));
    case 'get_patch': return PE.get_patch(sceneArg(args.oldScene), sceneArg(args.newScene));
    case 'apply_patch': {
      const scene = sceneArg(args.scene);
      const r = PE.apply_patch(scene, sceneArg(args.patch));
      return { scene: r };
    }
    default: throw new Error('Unknown tool: ' + name);
  }
}

const server = new Server({ name: 'pixel-engine-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => { console.error(e); process.exit(1); });
