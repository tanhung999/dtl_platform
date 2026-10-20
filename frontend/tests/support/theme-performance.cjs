// Manual diagnostic: CPU throttling is not a low-end GPU/device benchmark.
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { frames: sorted.length, median_ms: sorted[Math.floor(sorted.length / 2)], p95_ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], over_32ms: sorted.filter(value => value > 32).length };
};
exports.measureGlass = async (page, theme) => {
  const viewport = page.viewportSize(), cdp = await page.context().newCDPSession(page);
  const results = { glass: [], no_glass: [] }; let override;
  try {
    await page.setViewportSize({ width: 1366, height: 768 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (let round = 0; round < 2; round++) {
      for (const setting of round ? ['no_glass', 'glass'] : ['glass', 'no_glass']) {
        if (setting === 'no_glass') override = await page.addStyleTag({ content: '.glass-panel { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }' });
        await page.waitForTimeout(150);
        const frames = await page.evaluate(() => new Promise(resolve => {
          const values = [], duration = 1200, maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
          let first, previous;
          const frame = stamp => {
            first ??= stamp;
            if (previous !== undefined) values.push(stamp - previous);
            previous = stamp;
            const progress = Math.min(1, (stamp - first) / duration);
            scrollTo(0, maximum * (1 - Math.cos(progress * Math.PI * 2)) / 2);
            if (progress < 1) requestAnimationFrame(frame); else resolve(values);
          };
          requestAnimationFrame(frame);
        }));
        results[setting].push(...frames);
        if (override) { await override.evaluate(el => el.remove()); override = undefined; }
      }
    }
    return { theme, viewport: '1366x768', cpu_throttle: 4, glass: summarize(results.glass), no_glass: summarize(results.no_glass) };
  } finally {
    if (override) await override.evaluate(el => el.remove());
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach();
    await page.setViewportSize(viewport); await page.evaluate(() => scrollTo(0, 0));
  }
};
