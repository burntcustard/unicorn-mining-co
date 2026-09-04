---
name: build-size-analysis
description: Methodology and tool inner workings for analyzing minified JS source breakdown, sourcemap VLQ decoding, Roadroller packing, and ZIP size estimation in Unicorn Mining Co.
---

# Build Size Analysis & Tool Methodology

This skill details the methodology, inner workings of the build tools, and analysis techniques for measuring per-file contributions to the release ZIP (`dist/game.zip`) and minified JS (`dist/minified.js`).

For the latest detailed file-by-file byte breakdown and takeaways, see [build-size-breakdown.md](../../build-size-breakdown.md).

---

## Inner Workings of Build Pipeline & Tools

The build pipeline in `unicorn-mining-co` consists of several chained stages:

1. **Pre-processing (`plugins/vite-js13k.js` -> `viteJs13kPre`)**:
   * Intercepts `.js` files in Vite's `transform` hook.
   * Strips `// @ifdef DEBUG` and `// @ifdef BENCHMARK` blocks using regex based on flags.
   * Performs custom byte-saving string replacements (e.g. `acceleration` -> `_acceleration`, `const ` -> `let `).

2. **Bundling & Minification (Vite + Rollup + Terser)**:
   * Rollup tree-shakes unreferenced functions and modules.
   * Terser runs in `full` mode with `passes: 9`, `toplevel: true`, aggressive compression (`unsafe`, `unsafe_arrows`, `pure_getters`), and property mangling.
   * Property mangling renames literal dot/bracket accesses (`.foo`, `['foo']`) globally across modules unless explicitly listed in `mangle.properties.reserved` (e.g., `reserved: ['Up', 'ht', 'ft']`).

3. **JS Packing & HTML Minification (`plugins/vite-js13k.js` -> `viteJs13k`)**:
   * Runs in `generateBundle` hook.
   * Extracts minified JS code from Rollup assets and writes `dist/minified.js`.
   * Passes JS code to Roadroller (`Packer`), which creates a compressed payload string and decoder (`firstLine + secondLine`).
   * Replaces `<script src="...">` tags in HTML with `<script>ROADROLLER_DECODER</script>`.
   * Minifies HTML via `html-minifier-terser` and strips `<!DOCTYPE html>`, `<meta charset=UTF-8>`, `<title>`, etc.
   * Deletes raw `.js` chunks from Rollup's bundle so Vite does not output separate JS assets.

4. **ZIP Creation & Re-compression (`advzip`)**:
   * JSZip compresses `dist/index.html` into `dist/game.zip` with DEFLATE level 9.
   * In `closeBundle` (for `build:fast` or `build:full`), `advzip` re-compresses `dist/game.zip` with `--shrink-insane` (10 iterations in `fast` mode, 6000 iterations in `full` build mode). `build:search` skips this and instead runs an indefinite Roadroller CLI parameter search against `dist/minified.js`.

---

## Sourcemap VLQ Decoding Methodology

Standard bundle visualizers fail on this pipeline because:
- Terser heavily mangles, inlines, and transforms top-level code across modules.
- `viteJs13k` deletes JS assets from Rollup's output bundle during `generateBundle`.

To measure exact per-file byte counts post-mangling:

### 1. Intercepting the Sourcemap
Add a lightweight Rollup plugin before `viteJs13k` runs (`generateBundle` with `order: 'pre'`) with `sourcemap: true` enabled in Vite build config. This captures the generated JS code and its `SourceMap` object containing `sources` and `mappings`.

### 2. VLQ Decoding Mappings & AST Chunking
The `mappings` string contains semicolon-separated lines (matching generated lines) and comma-separated segments. Each segment contains Variable-Length Quantity (VLQ) base64-encoded integers:
`[generatedColumnDelta, sourceIndexDelta, originalLineDelta, originalColumnDelta, nameIndexDelta]`

* VLQ integers are relative deltas that accumulate state: `sourceIndex += delta[1]`, `originalLine += delta[2]`, `originalColumn += delta[3]`.
* Walking through the generated string slice by slice using generated column boundaries maps each slice of minified JS directly back to its original source path (`map.sources[sourceIndex]`).
* **Sub-file / Symbol Level Analysis**: Using `acorn` to parse original source files into AST nodes (functions, methods, variables, classes), we get `(startLine, startColumn)` and `(endLine, endColumn)` ranges for each symbol. Each mapped minified segment is assigned to its matching AST chunk range to produce per-function, per-method, and per-variable size metrics.

### 3. Calculating Estimated Packed & Zipped Sizes
Because Roadroller and DEFLATE operate on a single combined string, individual file compression ratios scale proportionately with the global compression factor:
- **Roadroller Ratio**: $R_{\text{RR}} = \frac{\text{size}(\text{dist/index.html})}{\text{size}(\text{dist/minified.js})} \approx 0.4582$
- **ZIP DEFLATE Ratio**: $R_{\text{ZIP}} = \frac{\text{size}(\text{dist/game.zip})}{\text{size}(\text{dist/minified.js})} \approx 0.3468$

*Note on Roadroller Context Sharing*: Standalone Roadroller compression of isolated file snippets yields higher ratios (~0.60 to ~1.00) because Roadroller relies on shared token contexts across the entire concatenated bundle. Ratio estimation based on global JS percentage accurately reflects each file's marginal contribution to the unified packed bundle.

---

## Reproducible Analysis Script

To re-run this size analysis at any time, execute the following command:

```bash
node -e '
import { build } from "vite";
import { viteJs13kPre } from "./plugins/vite-js13k.js";
import fs from "fs";
import path from "path";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeVLQ(str) {
  const values = [];
  let value = 0, shift = 0;
  for (let i = 0; i < str.length; i++) {
    let digit = BASE64.indexOf(str[i]);
    if (digit === -1) continue;
    const continuation = digit & 32;
    digit &= 31;
    value += (digit << shift);
    shift += 5;
    if (!continuation) {
      const isNegative = value & 1;
      const result = value >> 1;
      values.push(isNegative ? -result : result);
      value = 0; shift = 0;
    }
  }
  return values;
}

const flags = { BENCHMARK: false, DEBUG: false };
let capturedCode, capturedMap;

await build({
  mode: "full",
  plugins: [
    viteJs13kPre(flags),
    {
      name: "capture-map",
      generateBundle: {
        order: "pre",
        handler(_, bundle) {
          for (const name in bundle) {
            if (bundle[name].code) {
              capturedCode = bundle[name].code;
              capturedMap = bundle[name].map;
            }
          }
        }
      }
    }
  ],
  build: {
    minify: "terser",
    sourcemap: true,
    terserOptions: {
      toplevel: true,
      compress: {
        passes: 9, unsafe: true, unsafe_arrows: true, unsafe_comps: true, unsafe_math: true, pure_getters: true,
      },
      mangle: { properties: { reserved: ["Up", "ht", "ft"] } },
      module: true,
    },
  }
});

const genLines = capturedCode.split("\n");
const mapLines = capturedMap.mappings.split(";");
let sourceIndex = 0, originalLine = 0, originalColumn = 0, nameIndex = 0;
const fileBytes = {};

for (let gLine = 0; gLine < genLines.length; gLine++) {
  const lineText = genLines[gLine];
  const segs = (mapLines[gLine] || "").split(",");
  let lastGenCol = 0, currentSource = null, genCol = 0;

  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    if (!seg) continue;
    const vals = decodeVLQ(seg);
    genCol += vals[0];
    if (vals.length >= 4) {
      sourceIndex += vals[1]; originalLine += vals[2]; originalColumn += vals[3];
      if (vals.length >= 5) nameIndex += vals[4];
      let sourceName = (capturedMap.sources[sourceIndex] || "unknown").replace(/^(\.\.\/)+/, "");
      if (currentSource) {
        fileBytes[currentSource] = (fileBytes[currentSource] || 0) + (genCol - lastGenCol);
      }
      currentSource = sourceName; lastGenCol = genCol;
    }
  }
  if (currentSource) {
    fileBytes[currentSource] = (fileBytes[currentSource] || 0) + (lineText.length - lastGenCol);
  }
}

const allSrcFiles = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (full.endsWith(".js")) allSrcFiles.push(full);
  }
}
walk("src");

const minifiedTotal = capturedCode.length;
const indexHtmlTotal = fs.statSync("dist/index.html").size;
const gameZipTotal = fs.statSync("dist/game.zip").size;
const rrRatio = indexHtmlTotal / minifiedTotal;
const zipRatio = gameZipTotal / minifiedTotal;

const results = allSrcFiles.map(filePath => {
  const bytes = fileBytes[filePath] || 0;
  return {
    path: filePath,
    bytes,
    pct: (bytes / minifiedTotal) * 100,
    estIndexHtml: Math.round(bytes * rrRatio),
    estGameZip: Math.round(bytes * zipRatio),
    status: bytes > 0 ? "Included" : (["src/benchmark.js", "src/colors-demo.js", "src/fps.js", "src/section-test.js", "src/text-demo.js"].includes(filePath) ? "Stripped (@ifdef)" : "Unused / Tree-shaken")
  };
}).sort((a,b) => b.bytes - a.bytes);

console.log("File breakdown results generated.");
'
```
