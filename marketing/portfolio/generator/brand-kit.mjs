import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const portfolio = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(portfolio, '..', '..');
export const brand = JSON.parse(readFileSync(join(portfolio, 'brand.json'), 'utf8'));
const { Resvg } = await import(
  pathToFileURL(join(repo, '.tmp/brand-kit-deps/node_modules/@resvg/resvg-js/index.js')).href
);
const { default: fontkit } = await import(
  pathToFileURL(join(repo, '.tmp/brand-kit-deps/node_modules/fontkit/dist/main.cjs')).href
);
const font = (file) =>
  fontkit.create(readFileSync(join(portfolio, 'assets/fonts', `${file}.woff2`)));
const fonts = {
  display: font('archivo-black-400'),
  body: font('archivo-400'),
  bodyBold: font('archivo-600'),
  data: font('jetbrains-mono-400'),
  dataBold: font('jetbrains-mono-700'),
};
export const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character],
  );

export function text(x, baseline, value, size, options = {}) {
  const role = options.role ?? (options.bold ? 'display' : 'body');
  const typeface =
    fonts[
      role === 'body' && options.bold
        ? 'bodyBold'
        : role === 'data' && options.bold
          ? 'dataBold'
          : role
    ];
  const run = typeface.layout(String(value));
  const tracking = options.tracking ?? 0;
  const advance = run.positions.reduce((sum, pos) => sum + pos.xAdvance, 0);
  const naturalWidth =
    (advance * size) / typeface.unitsPerEm + tracking * Math.max(0, run.glyphs.length - 1);
  const fit = options.maxWidth ? Math.min(1, options.maxWidth / naturalWidth) : 1;
  const scale = (size * fit) / typeface.unitsPerEm;
  let cursor = x;
  const paths = [];
  for (const [index, glyph] of run.glyphs.entries()) {
    const pos = run.positions[index];
    const gx = cursor + pos.xOffset * scale;
    const gy = baseline - pos.yOffset * scale;
    const parts = [];
    for (const cmd of glyph.path.commands) {
      const X = (i) => (gx + cmd.args[i] * scale).toFixed(2);
      const Y = (i) => (gy - cmd.args[i] * scale).toFixed(2);
      if (cmd.command === 'moveTo') parts.push(`M${X(0)} ${Y(1)}`);
      else if (cmd.command === 'lineTo') parts.push(`L${X(0)} ${Y(1)}`);
      else if (cmd.command === 'quadraticCurveTo') parts.push(`Q${X(0)} ${Y(1)} ${X(2)} ${Y(3)}`);
      else if (cmd.command === 'bezierCurveTo')
        parts.push(`C${X(0)} ${Y(1)} ${X(2)} ${Y(3)} ${X(4)} ${Y(5)}`);
      else if (cmd.command === 'closePath') parts.push('Z');
    }
    paths.push(parts.join(''));
    cursor += pos.xAdvance * scale + tracking * fit;
  }
  return `<g aria-label="${escape(value)}"><path d="${paths.join('')}" fill="${options.color ?? brand.colors.ink}"/></g>`;
}

export function logo(x, y, width, height) {
  if (brand.designSystem.logo === 'vs') {
    return text(x, y + height * 0.84, 'VS/', height * 0.95, {
      bold: true,
      tracking: -3,
      maxWidth: width,
    });
  }
  const vector = readFileSync(join(portfolio, 'assets/subiu-logo.svg'));
  return `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="data:image/svg+xml;base64,${vector.toString('base64')}"/>`;
}

export function render(base, width, height, shapes) {
  mkdirSync(dirname(base), { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join('\n')}</svg>`;
  writeFileSync(`${base}.svg`, svg);
  writeFileSync(
    `${base}.png`,
    new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng(),
  );
  console.log(`${base}.png`);
}
