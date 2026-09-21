#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const HTML_SRC = path.join(ROOT, 'index.html');
const CSS_SRC = path.join(ROOT, 'style.css');
const JS_SRC = path.join(ROOT, 'script.js');
const LOGO_SRC = path.join(ROOT, 'logo.png');
const OUT = path.join(ROOT, 'all-in-one.html');

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function build() {
  let html = readText(HTML_SRC);
  let css = readText(CSS_SRC);
  const js = readText(JS_SRC);

  // Logo als Base64-Data-URI einbetten, damit die CSS-Regel ohne externe Bilddatei auskommt.
  const logoBuffer = fs.readFileSync(LOGO_SRC);
  const logoDataUri = `data:image/png;base64,${logoBuffer.toString('base64')}`;
  css = css.replace(/url\(["']?logo\.png["']?\)/g, `url("${logoDataUri}")`);

  // </script> im eingebetteten JS darf das umschließende <script>-Tag nicht vorzeitig schließen.
  const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

  html = html.replace(
    /<link rel="stylesheet" href="style\.css">/,
    `<style>\n${css}\n</style>`
  );
  html = html.replace(
    /<script src="script\.js"><\/script>/,
    `<script>\n${safeJs}\n</script>`
  );

  fs.writeFileSync(OUT, html, 'utf8');
  const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`✓ ${path.basename(OUT)} erstellt (${sizeKb} KB)`);
}

build();
