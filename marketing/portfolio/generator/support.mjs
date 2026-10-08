import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brand, logo, portfolio, render, text } from './brand-kit.mjs';

const captures = [
  {
    slug: '01-recursos-operacao',
    image: 'grafana-visao-geral-20261007.jpg',
    title: 'A API em operação.',
    subtitle: 'Recursos, volume de operações e latência',
    context: 'Captura real · 07/10/2026 · consulta de 12 horas',
    note: 'CPU · Memória · p95 HTTP',
  },
  {
    slug: '02-latencia',
    image: 'grafana-latencia-20261007.jpg',
    title: 'Latência à vista.',
    subtitle: 'p95 HTTP com escala e histórico preservados',
    context: '07/10/2026 às 11:23 BRT · consulta de 12 horas',
    note: 'Lacunas não significam zero',
  },
  {
    slug: '03-traces',
    image: 'grafana-traces-20261007.jpg',
    title: 'Cada operação tem um rastro.',
    subtitle: 'Traces reais do processamento financeiro',
    context: 'Captura de 07/10/2026 · registros às 11:01 BRT',
    note: 'Duração de span não equivale ao p95 HTTP',
  },
];
const c = brand.colors;
for (const capture of captures) {
  const screenshot = readFileSync(join(portfolio, 'assets', capture.image)).toString('base64');
  render(join(portfolio, 'support', `${capture.slug}-1080x1350`), 1080, 1350, [
    `<rect width="1080" height="1350" fill="${c.paper}"/>`,
    `<rect x="56" y="31" width="12" height="12" fill="${c.accent}"/>`,
    text(56, 80, brand.owner.toUpperCase(), 28, { role: 'body', bold: true }),
    logo(824, 24, 200, 110),
    `<path d="M56 144H1024" stroke="${c.ink}" stroke-width="3"/>`,
    text(56, 206, capture.title, 49, { bold: true, maxWidth: 968 }),
    text(56, 247, capture.subtitle, 25, { color: c.muted, maxWidth: 968 }),
    `<rect x="40" y="285" width="1000" height="928" fill="${c.console}"/>`,
    `<image x="40" y="285" width="1000" height="928" preserveAspectRatio="xMidYMid meet" href="data:image/jpeg;base64,${screenshot}"/>`,
    text(56, 1237, capture.context, 19, { role: 'data', color: c.muted, maxWidth: 968 }),
    `<path d="M56 1260H1024" stroke="${c.ink}" stroke-width="3"/>`,
    text(56, 1299, capture.note, 19, { role: 'data', maxWidth: 968 }),
    text(56, 1328, 'jungle.subiu.dev · Demo com créditos fictícios', 18, {
      role: 'data',
      color: c.muted,
      maxWidth: 968,
    }),
  ]);
}
