import { join } from 'node:path';
import { brand, logo, portfolio, render, text } from './brand-kit.mjs';

const c = brand.colors;
const output = join(portfolio, 'videos', 'frames');
const scenes = [
  {
    name: '01-app',
    number: '01',
    title: ['Do jogo', 'à carteira.'],
    description: ['Apostas, liquidação', 'e saldo na mesma', 'aplicação.'],
    detail: ['TypeScript · Bun · NestJS', 'PostgreSQL · SQS'],
  },
  {
    name: '02-reconciliation',
    number: '02',
    title: ['Saldo e ledger', 'em acordo.'],
    description: ['Compare os lançamentos', 'com o saldo', 'da carteira.'],
    detail: ['Carteira existente', 'Valores exatos'],
  },
  {
    name: '03-replay',
    number: '03',
    title: ['Mesma aposta.', 'Um único débito.'],
    description: ['Reenvie a operação.', 'Consulte o resultado', 'já registrado.'],
    detail: ['Idempotência', 'Saldo e ledger preservados'],
  },
  {
    name: '04-grafana',
    number: '04',
    title: ['Operação', 'à vista.'],
    description: ['CPU, memória e p95.', 'Logs e traces', 'do processamento.'],
    detail: ['Prometheus · Loki · Tempo', 'Período exibido no Grafana'],
  },
];

for (const scene of scenes) {
  render(join(output, scene.name), 1920, 1080, [
    `<rect width="1920" height="1080" fill="${c.paper}"/>`,
    `<rect x="64" y="23" width="12" height="12" fill="${c.accent}"/>`,
    text(64, 69, brand.owner.toUpperCase(), 29, { role: 'body', bold: true }),
    logo(1666, 4, 190, 78),
    `<path d="M64 88H1856" stroke="${c.ink}" stroke-width="3"/>`,
    `<rect x="64" y="108" width="1000" height="928" fill="${c.console}" stroke="${c.ink}" stroke-width="3"/>`,
    text(1140, 217, `${scene.number} / PROCESSADOR DE APOSTAS`, 24, {
      role: 'data',
      color: c.muted,
      maxWidth: 716,
    }),
    `<rect x="1140" y="253" width="64" height="7" fill="${c.accent}"/>`,
    ...scene.title.map((value, index) =>
      text(1136, 338 + index * 92, value, 72, { bold: true, tracking: -2, maxWidth: 720 }),
    ),
    ...scene.description.map((value, index) =>
      text(1140, 540 + index * 52, value, 36, { color: c.muted, maxWidth: 716 }),
    ),
    `<path d="M1140 740H1856" stroke="${c.line}"/>`,
    ...scene.detail.map((value, index) =>
      text(1140, 800 + index * 48, value, 30, { maxWidth: 716 }),
    ),
    text(1140, 943, 'jungle.subiu.dev', 35, { role: 'body', bold: true }),
    `<rect x="1140" y="990" width="10" height="10" fill="${c.accent}"/>`,
    text(1167, 1007, 'DEMO · CRÉDITOS FICTÍCIOS', 22, {
      role: 'data',
      color: c.muted,
      maxWidth: 689,
    }),
  ]);
}

render(join(output, '05-outro'), 1920, 1080, [
  `<rect width="1920" height="1080" fill="${c.paper}"/>`,
  `<rect x="80" y="76" width="18" height="18" fill="${c.accent}"/>`,
  text(80, 149, brand.owner.toUpperCase(), 32, { role: 'body', bold: true }),
  logo(1630, 49, 210, 116),
  `<path d="M80 192H1840" stroke="${c.ink}" stroke-width="3"/>`,
  text(80, 371, 'Experimente a demo.', 88, { bold: true, tracking: -2, maxWidth: 1760 }),
  `<rect x="80" y="419" width="64" height="8" fill="${c.accent}"/>`,
  text(80, 524, 'jungle.subiu.dev', 112, { bold: true, tracking: -3, maxWidth: 1760 }),
  text(80, 676, 'Processamento financeiro para jogos.', 43, { color: c.muted }),
  text(80, 740, 'Apostas, reconciliação e replay.', 37, { color: c.muted }),
  `<path d="M80 926H1840" stroke="${c.ink}" stroke-width="3"/>`,
  text(80, 999, 'DEMO · CRÉDITOS FICTÍCIOS', 25, { role: 'data', color: c.muted }),
  text(1330, 999, 'ENGENHARIA APLICADA / 01', 23, { role: 'data', color: c.muted, maxWidth: 510 }),
]);
