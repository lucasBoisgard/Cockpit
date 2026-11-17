#!/usr/bin/env node
// Visual check of a report page: screenshots at 360/768/1280 in light and dark, plus automatic checks on every visible SVG.
// Usage: node check-visual.js <page.html> <output dir>
// Installs and downloads nothing. Needs playwright-core: set PLAYWRIGHT_CORE to a directory that can resolve it
// (a project with Playwright installed) unless it resolves from this script or globally. CHROMIUM_PATH forces the browser.
// Exit codes: 0 all checks pass, 1 a check failed, 2 not run (bad arguments, no browser, browser error).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const [page, outDir] = process.argv.slice(2);
if (!page || !outDir || !fs.existsSync(page)) {
  console.error('Usage: node check-visual.js <page.html> <output dir>');
  process.exit(2);
}

function loadPlaywright() {
  // Never resolved from the current directory or the page's folder: those may hold untrusted code.
  const dirs = [process.env.PLAYWRIGHT_CORE, __dirname].filter(Boolean);
  for (const name of ['playwright-core', 'playwright']) {
    for (const dir of dirs) {
      try { return require(require.resolve(name, { paths: [dir] })); } catch { /* try the next place */ }
    }
    try { return require(name); } catch { /* not installed globally */ }
  }
  return null;
}

function findInTree(root, names, depth = 5) {
  if (depth < 0 || !fs.existsSync(root)) return null;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  const file = entries.find(e => e.isFile() && names.includes(e.name));
  if (file) return path.join(root, file.name);
  for (const e of entries.filter(e => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))) {
    const hit = findInTree(path.join(root, e.name), names, depth - 1);
    if (hit) return hit;
  }
  return null;
}

function findBrowser() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  for (const cache of caches) {
    const hit = findInTree(cache, ['chrome-headless-shell', 'headless_shell', 'chrome', 'Chromium']);
    if (hit) return hit;
  }
  const names = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const hit = names.map(n => path.join(dir, n)).find(p => fs.existsSync(p));
    if (hit) return hit;
  }
  return null;
}

// Runs in the page, in screen coordinates. A node is a rounded <rect> (rx > 0); a label background must be a plain rect.
function inspect() {
  const fails = [];
  for (const svg of document.querySelectorAll('svg')) {
    if (!svg.getClientRects().length) continue;
    const box = svg.getBoundingClientRect();
    if (!svg.viewBox.baseVal.width) { fails.push('an SVG has no viewBox'); continue; }
    const scale = box.width / svg.viewBox.baseVal.width;
    if (scale > 1.005) fails.push(`scaled up x${scale.toFixed(2)} (cap max-width at the viewBox width)`);
    if (scale < 0.85) fails.push(`scaled down x${scale.toFixed(2)} (needs a narrower layout)`);
    const nodes = [...svg.querySelectorAll('rect')].filter(r => r.rx.baseVal.value > 0).map(r => r.getBoundingClientRect());
    for (const text of svg.querySelectorAll('text')) {
      const t = text.getBoundingClientRect();
      const label = text.textContent.trim();
      if (!label || !t.width) continue;
      const size = parseFloat(getComputedStyle(text).fontSize) * scale;
      if (size < 11) fails.push(`"${label}" rendered at ${size.toFixed(1)}px (min 11)`);
      if (t.left < box.left - 0.5 || t.right > box.right + 0.5) fails.push(`"${label}" is cut by the viewBox`);
      const overlap = n => Math.max(0, Math.min(t.right, n.right) - Math.max(t.left, n.left)) * Math.max(0, Math.min(t.bottom, n.bottom) - Math.max(t.top, n.top));
      const node = nodes.filter(n => overlap(n) > 0).sort((a, b) => overlap(b) - overlap(a))[0];
      if (node && (t.left < node.left + 4 * scale || t.right > node.right - 6 * scale)) fails.push(`"${label}" overflows its node`);
    }
    for (let el = svg.parentElement; el && el !== document.body; el = el.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1) fails.push('the figure scrolls sideways');
    }
  }
  if (document.documentElement.scrollWidth > window.innerWidth) fails.push('the page scrolls sideways');
  return [...new Set(fails)];
}

(async () => {
  const playwright = loadPlaywright();
  const executablePath = findBrowser();
  if (!playwright || !executablePath || !fs.existsSync(executablePath)) {
    console.error(`Visual check not run: ${playwright ? 'no Chromium binary found (set CHROMIUM_PATH)' : 'playwright-core not found (set PLAYWRIGHT_CORE or run from a project that has it)'}.`);
    process.exit(2);
  }
  let browser;
  let failed = 0;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const runsAsRoot = process.getuid?.() === 0;
    browser = await playwright.chromium.launch({ executablePath, chromiumSandbox: !runsAsRoot });
    for (const colorScheme of ['light', 'dark']) {
      for (const width of [360, 768, 1280]) {
        const tab = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
        await tab.goto(pathToFileURL(path.resolve(page)).href);
        await tab.evaluate(() => document.fonts.ready);
        const fails = await tab.evaluate(inspect);
        await tab.screenshot({ path: path.join(outDir, `${width}-${colorScheme}.png`), fullPage: true });
        await tab.close();
        failed += fails.length ? 1 : 0;
        const shown = fails.slice(0, 8).map(f => '\n     - ' + f).join('') + (fails.length > 8 ? `\n     - … and ${fails.length - 8} more` : '');
        console.log(`${fails.length ? 'FAIL' : 'OK  '} ${width} ${colorScheme}${shown}`);
      }
    }
  } catch (error) {
    console.error(`Visual check not run: ${error.message.split('\n')[0]}`);
    process.exitCode = 2;
    return;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  console.log(failed ? `${failed}/6 renderings fail. Captures: ${outDir}` : `6/6 renderings pass. Read the captures before publishing: ${outDir}`);
  process.exitCode = failed ? 1 : 0;
})();
