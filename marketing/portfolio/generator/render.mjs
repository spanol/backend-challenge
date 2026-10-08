import { join } from 'node:path';
import { brand, logo, portfolio, render, text } from './brand-kit.mjs';

function design(cover, landscape) {
  const width = landscape ? 1920 : 1080;
  const height = landscape ? 1080 : 1350;
  const margin = landscape ? 80 : 72;
  const c = brand.colors;
  const rule = (y, weight = 1, color = c.line) =>
    `<path d="M${margin} ${y}H${width - margin}" stroke="${color}" stroke-width="${weight}"/>`;
  const label = (x, y, value, size = 22, options = {}) =>
    text(x, y, value, size, { role: 'data', color: c.muted, ...options });
  const shapes = [
    `<rect width="${width}" height="${height}" fill="${c.paper}"/>`,
    `<rect x="${margin}" y="50" width="18" height="18" fill="${c.accent}"/>`,
    text(margin, 112, brand.owner.toUpperCase(), 30, { role: 'body', bold: true }),
    logo(width - margin - 210, 48, 210, 112),
    rule(178, 3, c.ink),
    label(margin, 239, `${brand.series.toUpperCase()} / ${cover.number}`, 23),
  ];
  if (landscape) {
    const titleSize = cover.landscapeTitle.some((title) => title.length > 17) ? 95 : 118;
    for (const [index, value] of cover.landscapeTitle.entries()) {
      shapes.push(
        text(margin - 4, 399 + index * 140, value, titleSize, {
          bold: true,
          tracking: -4,
          maxWidth: 1090,
        }),
      );
    }
    shapes.push(text(margin, 651, cover.description, 33, { color: c.muted, maxWidth: 1090 }));
    shapes.push(text(margin, 790, cover.detail, 30));
    shapes.push(label(margin, 859, cover.category.toUpperCase(), 21));
    shapes.push(`<path d="M1243 293V818" stroke="${c.ink}" stroke-width="3"/>`);
    for (const [index, metric] of cover.metrics.entries()) {
      const y = 380 + index * 185;
      shapes.push(`<rect x="1235" y="${y - 35}" width="16" height="16" fill="${c.accent}"/>`);
      shapes.push(
        text(1300, y, metric.value, metric.value.length > 3 ? 77 : 112, {
          bold: true,
          tracking: -4,
          maxWidth: 520,
        }),
      );
      shapes.push(label(1304, y + 47, metric.label.toUpperCase(), 23));
    }
    shapes.push(rule(939, 3, c.ink));
    shapes.push(text(margin, 1008, cover.site, 29, { role: 'body', bold: true }));
    shapes.push(label(width - margin - 520, 1008, cover.note, 22, { maxWidth: 520 }));
  } else {
    const titleSize = cover.portraitTitle.some((title) => title.length > 11) ? 105 : 119;
    for (const [index, value] of cover.portraitTitle.entries()) {
      shapes.push(
        text(margin - 5, 393 + index * 134, value, titleSize, {
          bold: true,
          tracking: -4,
          maxWidth: width - margin * 2,
        }),
      );
    }
    shapes.push(text(margin, 746, cover.description, 32, { color: c.muted, maxWidth: 936 }));
    for (const [index, metric] of cover.metrics.entries()) {
      const x = margin + index * 324;
      if (index > 0) shapes.push(`<path d="M${x - 33} 837V987" stroke="${c.line}"/>`);
      shapes.push(
        text(x, 930, metric.value, metric.value.length > 3 ? 79 : 110, {
          bold: true,
          tracking: -4,
          maxWidth: 260,
        }),
      );
      shapes.push(label(x + 2, 978, metric.label.toUpperCase(), 22, { maxWidth: 260 }));
    }
    shapes.push(rule(1025, 3, c.ink));
    shapes.push(text(margin, 1099, cover.detail, 28, { maxWidth: 936 }));
    shapes.push(label(margin, 1164, cover.category.toUpperCase(), 21, { maxWidth: 936 }));
    shapes.push(rule(1221));
    shapes.push(text(margin, 1286, cover.site, 27, { role: 'body', bold: true }));
    shapes.push(label(margin + 386, 1286, cover.note, 19, { maxWidth: 550 }));
  }
  return { width, height, shapes };
}

for (const cover of brand.covers) {
  for (const landscape of [false, true]) {
    const { width, height, shapes } = design(cover, landscape);
    render(join(portfolio, 'covers', `${cover.slug}-${width}x${height}`), width, height, shapes);
  }
}
