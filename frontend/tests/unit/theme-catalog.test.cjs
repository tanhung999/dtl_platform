const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), vm = require('node:vm');
const ts = require('typescript');
const source = path.resolve(__dirname, '../../src/theme');
const catalogData = JSON.parse(fs.readFileSync(path.join(source, 'catalog.json'), 'utf8'));
test('rose and lavender palettes keep readable text and clean backgrounds', () => {
  const { catalog } = load();
  const luminance = hex => {
    const parts = hex.replace('#', '').match(/../g).map(part => parseInt(part, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return parts[0] * .2126 + parts[1] * .7152 + parts[2] * .0722;
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const [id, colors] of Object.entries({ 'princess-pink': ['#FFF4F8', '#E91E73', '#FFFFFF', '#F3D5E2'], 'fairy-purple': ['#F5F2FF', '#7138F5', '#FFFFFF', '#DDD5FA'] })) {
    const tokens = catalog.themeTokens(id);
    assert.deepEqual(['--bg-main', '--accent', '--bg-card-solid', '--border'].map(key => tokens[key]), colors);
    for (const ink of ['--text-main', '--text-secondary', '--text-muted', '--accent-text']) {
      assert.ok(contrast(tokens[ink], tokens['--bg-card-solid']) >= 4.5, id + ' low contrast ' + ink);
    }
    assert.ok(contrast(tokens['--on-calendar-selected'], tokens['--calendar-selected-bg']) >= 4.5);
    assert.ok(!tokens['--bg-page-gradient'].includes('url('));
  }
});
function load(data = catalogData) {
  const cache = new Map();
  function moduleFor(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const filename = path.join(source, file), m = new Module(filename, module); cache.set(file, m);
    const original = Module.createRequire(filename);
    m.require = id => id === './catalog.json' ? data : id.startsWith('./') ? moduleFor(id.slice(2) + '.ts') : original(id);
    m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
    return m.exports;
  }
  return { catalog: moduleFor('catalog.ts'), runtime: moduleFor('runtime.ts') };
}
function documentStub(withBody) {
  const element = () => ({ dataset: {}, style: {}, classes: new Set(), classList: { toggle(name, enabled) { enabled ? this.owner.classes.add(name) : this.owner.classes.delete(name); } } });
  const root = element(), body = withBody ? element() : null;
  for (const el of [root, body]) if (el) el.classList.owner = el;
  return { documentElement: root, body };
}
function boot(runtime, saved, blocked = false, withBody = false) {
  const doc = documentStub(withBody);
  vm.runInNewContext(runtime.renderThemeBootstrap(), { document: doc, localStorage: { getItem() { if (blocked) throw new Error('blocked'); return saved; } } });
  return doc;
}
test('all catalog entries share complete tokens and previews without unresolved variables', () => {
  const { catalog } = load();
  for (const { id, mode } of catalog.THEMES) {
    assert.ok(['light', 'dark'].includes(mode));
    const tokens = catalog.themeTokens(id);
    for (const value of Object.values(tokens)) for (const [, name] of value.matchAll(/var\((--[a-z-]+)/g)) assert.ok(name in tokens, id + ' missing ' + name);
    const preview = catalog.themePreview(id);
    assert.equal(preview['--preview-accent'], tokens['--accent']);
    assert.equal(preview['--preview-bg'], tokens['--bg-page-gradient']);
    assert.ok(catalog.renderThemeStyles().includes(':root[data-theme="' + id + '"]'));
  }
});
test('generated bootstrap works before body and recognizes every catalog entry, including invalid storage', () => {
  const { catalog, runtime } = load();
  for (const { id, mode } of catalog.THEMES) {
    const doc = boot(runtime, id, false, true);
    for (const el of [doc.documentElement, doc.body]) {
      assert.equal(el.dataset.theme, id); assert.equal(el.dataset.colorMode, mode);
      assert.equal(el.classes.has('dark'), mode === 'dark');
    }
    assert.equal(doc.documentElement.style.colorScheme, mode);
    assert.equal(boot(runtime, id).documentElement.dataset.theme, id);
  }
  for (const bad of [null, '', 'removed-theme', '__proto__', 'constructor']) assert.equal(boot(runtime, bad).documentElement.dataset.theme, catalog.DEFAULT_THEME);
  assert.equal(boot(runtime, 'dark', true).documentElement.dataset.theme, catalog.DEFAULT_THEME);
});
test('one catalog addition automatically reaches picker data, CSS, preview and early bootstrap', () => {
  const extended = structuredClone(catalogData);
  extended.themes.future = { ...extended.themes.obsidian, name: 'Future theme', tokens: { '--accent': '#ab12cd' } };
  const { catalog, runtime } = load(extended);
  assert.ok(catalog.THEMES.some(item => item.id === 'future'));
  assert.equal(catalog.themePreview('future')['--preview-accent'], '#ab12cd');
  assert.ok(catalog.renderThemeStyles().includes(':root[data-theme="future"]'));
  const root = boot(runtime, 'future').documentElement;
  assert.equal(root.dataset.theme, 'future'); assert.equal(root.dataset.colorMode, 'dark');
});
