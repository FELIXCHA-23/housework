import { chromium } from 'playwright-core';
const glyph = (c) => `<path d="M256 120 112 244v152a20 20 0 0 0 20 20h248a20 20 0 0 0 20-20V244L256 120Z" fill="none" stroke="${c}" stroke-width="30" stroke-linejoin="round"/><path d="m190 300 50 50 90-100" fill="none" stroke="${c}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>`;
const svg = (kind) => {
  if (kind === 'badge') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 256) scale(1.1) translate(-256 -270)">${glyph('#fff')}</g></svg>`;
  const full = kind === 'maskable' || kind === 'apple';
  const g = kind === 'maskable' ? `<g transform="translate(256 256) scale(.78) translate(-256 -266)">${glyph('#fff')}</g>` : `<g transform="translate(256 256) scale(.9) translate(-256 -266)">${glyph('#fff')}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4b7bff"/><stop offset="1" stop-color="#ff7a52"/></linearGradient></defs>
  <rect width="512" height="512" ${full ? '' : 'rx="112"'} fill="url(#g)"/>${g}</svg>`;
};
const out = [['icon-192', 'any', 192], ['icon-512', 'any', 512], ['maskable-512', 'maskable', 512], ['apple-touch-icon', 'apple', 180], ['badge-96', 'badge', 96]];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] }); const p = await b.newPage();
for (const [name, kind, px] of out) {
  await p.setViewportSize({ width: px, height: px });
  await p.setContent(`<body style="margin:0;background:transparent">${svg(kind).replace('<svg ', `<svg width="${px}" height="${px}" `)}</body>`);
  await p.screenshot({ path: `site/icons/${name}.png`, omitBackground: true });
}
await b.close();
