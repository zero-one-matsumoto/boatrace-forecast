/**
 * build-standalone.js
 * index.html / styles.css / js/*.js を1つのHTMLにインライン化し、
 * iOS Safari等で file:// から直接開ける単一ファイルを生成する。
 *
 *   node build-standalone.js
 *   -> dist/boatrace-forecast.html
 */
const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let html = read("index.html");

// <link rel="stylesheet" href="styles.css"> を <style> に置換
const css = read("styles.css");
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/,
  `<style>\n${css}\n</style>`
);

// <script src="js/xxx.js"></script> を中身インラインに置換（読み込み順を維持）
html = html.replace(
  /<script\s+src="(js\/[a-zA-Z0-9_.-]+)"><\/script>/g,
  (_, src) => `<script>\n${read(src)}\n</script>`
);

const outDir = path.join(root, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "boatrace-forecast.html");
fs.writeFileSync(outFile, html, "utf8");

const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`generated: dist/boatrace-forecast.html (${kb} KB)`);
