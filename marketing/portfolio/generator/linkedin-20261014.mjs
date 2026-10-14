import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brand, logo, portfolio, render, text } from './brand-kit.mjs';

const out = join(portfolio, 'linkedin', '2026-10-14');
const overviewCapture = readFileSync(join(out, 'source-interface-overview.png'));
const controlsCapture = readFileSync(join(out, 'source-round-controls.png'));
const overviewData = `data:image/png;base64,${overviewCapture.toString('base64')}`;
const controlsData = `data:image/png;base64,${controlsCapture.toString('base64')}`;
const ink = brand.colors.ink;
const paper = brand.colors.paper;
const muted = brand.colors.muted;
const accent = brand.colors.accent;

function frame(number, category, titleLines, subtitle, extra = []) {
  const shapes = [
    `<rect width="1080" height="1350" fill="${paper}"/>`,
    `<rect x="72" y="48" width="14" height="14" fill="${accent}"/>`,
    text(72, 104, brand.owner.toUpperCase(), 27, { role: 'body', bold: true }),
    logo(824, 28, 184, 112),
    `<path d="M72 154H1008" stroke="${ink}" stroke-width="3"/>`,
    text(72, 217, `ENGENHARIA APLICADA / ${number}`, 22, {
      role: 'data',
      color: muted,
      tracking: 1.2,
    }),
  ];

  titleLines.forEach((line, index) => {
    shapes.push(text(72, 330 + index * 94, line, 76, { bold: true, maxWidth: 936 }));
  });
  shapes.push(
    text(72, 330 + titleLines.length * 94 + 2, subtitle, 27, {
      role: 'body',
      color: muted,
      maxWidth: 936,
    }),
  );
  shapes.push(...extra);
  shapes.push(
    `<path d="M72 1250H1008" stroke="${ink}" stroke-width="3"/>`,
    text(72, 1292, 'jungle.subiu.dev', 24, { role: 'body', bold: true }),
    text(520, 1292, 'DEMO · CRÉDITOS FICTÍCIOS', 18, { role: 'data', color: muted }),
  );
  return shapes;
}

const cover = frame(
  '01',
  'Sistemas distribuídos',
  ['Mais gente.', 'Na mesma rodada.'],
  'Uma rodada de jogo, com uma janela de apostas de 5 segundos.',
  [
    `<rect x="72" y="575" width="936" height="210" fill="${accent}"/>`,
    text(98, 731, '1.500', 148, { bold: true, maxWidth: 850 }),
    text(72, 841, 'JOGADORES CONFIGURÁVEIS NA DEMO', 23, {
      role: 'data',
      color: ink,
      tracking: 0.8,
    }),
    `<path d="M72 895H1008" stroke="${brand.colors.line}" stroke-width="2"/>`,
    text(72, 956, 'Ajuste de admissão para observar a rodada com mais participantes.', 25, {
      role: 'body',
      color: muted,
      maxWidth: 936,
    }),
  ],
);
render(join(out, '01-ate-1500-jogadores'), 1080, 1350, cover);

const overview = frame(
  '02',
  'Demonstração atual',
  ['A interface', 'da rodada.'],
  'A atualização visual está aplicada na demo pública.',
  [
    `<rect x="48" y="540" width="984" height="266" fill="${brand.colors.console}"/>`,
    `<svg x="48" y="540" width="984" height="266" viewBox="0 0 1465 396" preserveAspectRatio="xMidYMid meet" overflow="hidden"><image x="0" y="0" width="1465" height="396" href="${overviewData}"/></svg>`,
    `<path d="M48 540H1032V806H48Z" fill="none" stroke="${ink}" stroke-width="3"/>`,
    text(72, 891, 'CAPTURA REAL DA DEMO · 14/10/2026', 18, { role: 'data', color: muted }),
    text(72, 941, 'A tela indica a simulação e os créditos fictícios.', 24, {
      role: 'body',
      maxWidth: 936,
    }),
    `<rect x="72" y="986" width="936" height="132" fill="${brand.colors.surface}"/>`,
    `<rect x="72" y="986" width="10" height="132" fill="${accent}"/>`,
    text(112, 1038, 'ATÉ 1.500 JOGADORES POR RODADA', 24, {
      role: 'data',
      bold: true,
      maxWidth: 850,
    }),
    text(112, 1084, 'Janela de apostas: 5 segundos', 27, { role: 'body', maxWidth: 850 }),
  ],
);
render(join(out, '02-interface-atual'), 1080, 1350, overview);

const setup = frame(
  '03',
  'Configuração da rodada',
  ['Entrada e janela', 'no mesmo painel.'],
  'O número de jogadores pode ser ajustado para cada simulação.',
  [
    `<rect x="48" y="540" width="984" height="710" fill="${brand.colors.console}"/>`,
    `<svg x="48" y="540" width="984" height="710" viewBox="0 0 350 368" preserveAspectRatio="xMidYMid meet" overflow="hidden"><image x="0" y="0" width="350" height="368" href="${controlsData}"/></svg>`,
    `<path d="M48 540H1032V1250H48Z" fill="none" stroke="${ink}" stroke-width="3"/>`,
  ],
);
render(join(out, '03-configuracao-da-rodada'), 1080, 1350, setup);
