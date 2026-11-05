const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../../src/theme/catalog.json');

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? files(name) : /\.(css|tsx?|json)$/.test(entry.name) ? [name] : [];
  });
}

test('component styles use registered theme tokens instead of falling back to another color mode', () => {
  const sources = files(path.resolve(__dirname, '../../src')).map(name => [name, fs.readFileSync(name, 'utf8')]);
  const known = new Set([
    ...Object.keys(catalog.common),
    ...Object.values(catalog.modes).flatMap(mode => Object.keys(mode)),
    ...Object.values(catalog.themes).flatMap(theme => Object.keys(theme.tokens)),
  ]);
  for (const [, source] of sources) {
    for (const match of source.matchAll(/["']?(--[\w-]+)["']?\s*:/g)) known.add(match[1]);
  }
  // Preview properties are generated per swatch; scrollbar width is measured at runtime.
  const dynamic = new Set(['--preview-bg', '--preview-accent', '--preview-card', '--preview-line', '--calendar-scrollbar-width']);
  const missing = [];
  for (const [name, source] of sources.filter(([name]) => name.endsWith('.css'))) {
    for (const match of source.matchAll(/var\((--[\w-]+)/g)) {
      if (!known.has(match[1]) && !dynamic.has(match[1])) missing.push(path.relative(process.cwd(), name) + ': ' + match[1]);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});
