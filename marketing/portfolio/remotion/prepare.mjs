import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'bun';
import { brand, portfolio, render } from '../generator/brand-kit.mjs';

const project = dirname(fileURLToPath(import.meta.url));
const assets = join(project, 'public', 'generated');
const metadata = join(project, 'generated');
mkdirSync(assets, { recursive: true });
mkdirSync(metadata, { recursive: true });
const plan = JSON.parse(readFileSync(join(portfolio, 'videos', 'edit-main.json'), 'utf8'));
const fps = 30;
const decode = (value) =>
  value.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity],
  );
const timeline = [];
const prepared = new Map();

function prepareFrame(source) {
  if (prepared.has(source)) return prepared.get(source);
  const id = source
    .split('/')
    .at(-1)
    .replace(/\.png$/, '');
  const svg = readFileSync(join(portfolio, source.replace(/\.png$/, '.svg')), 'utf8');
  const groups = [...svg.matchAll(/<g aria-label="([^"]*)">[\s\S]*?<\/g>/g)];
  const animated = groups.filter((match) => {
    const label = decode(match[1]);
    return (
      label !== brand.owner.toUpperCase() &&
      !label.includes('CRÉDITOS FICTÍCIOS') &&
      !(source.startsWith('covers/') && label === 'jungle.subiu.dev') &&
      !(id === '05-outro' && label === 'ENGENHARIA APLICADA / 01')
    );
  });
  let base = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const layers = animated.map((match, index) => {
    base = base.replace(match[0], '');
    const name = `${id}-text-${String(index).padStart(2, '0')}`;
    // brand-kit emits absolute M/L/Q/C path coordinates, with x/y pairs.
    // Include control points and padding so curved glyphs are never clipped.
    const path = match[0].match(/ d="([^"]+)"/)[1];
    const coordinates = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((part) => Number(part[0]));
    const xs = coordinates.filter((_, coordinate) => coordinate % 2 === 0);
    const ys = coordinates.filter((_, coordinate) => coordinate % 2 === 1);
    const x = Math.floor(Math.min(...xs)) - 4;
    const y = Math.floor(Math.min(...ys)) - 4;
    const width = Math.ceil(Math.max(...xs)) + 4 - x;
    const height = Math.ceil(Math.max(...ys)) + 4 - y;
    render(join(assets, name), width, height, [
      `<g transform="translate(${-x} ${-y})">${match[0]}</g>`,
    ]);
    return {
      src: `generated/${name}.png`,
      label: decode(match[1]),
      x,
      y,
      width,
      height,
      delay: index * 3,
      duration: 18,
      distance: 18,
    };
  });
  render(join(assets, `${id}-base`), 1920, 1080, [base]);
  const result = { id, base: join(assets, `${id}-base.png`), layers };
  prepared.set(source, result);
  return result;
}

let from = 0;
for (const scene of plan.scenes) {
  const frame = prepareFrame(scene.type === 'still' ? scene.source : scene.frame);
  const durationInFrames = Math.round(scene.duration * fps);
  const previous = timeline.at(-1);
  if (previous?.id === frame.id) previous.durationInFrames += durationInFrames;
  else timeline.push({ id: frame.id, from, durationInFrames, layers: frame.layers });
  if (scene.type === 'still') scene.source = frame.base;
  else scene.frame = frame.base;
  from += durationInFrames;
}
if (from !== 1800) throw new Error(`Expected 1800 frames, received ${from}`);

writeFileSync(
  join(metadata, 'timeline.json'),
  `${JSON.stringify({ fps, width: 1920, height: 1080, durationInFrames: from, scenes: timeline }, null, 2)}\n`,
);
plan.output = '../remotion/public/generated/underlay.mp4';
plan.encoding = { crf: 0, preset: 'fast' };
plan.status = 'Lossless intermediate for Remotion. Not a publication export.';
const planPath = join(metadata, 'underlay-plan.json');
writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
if (!process.argv.includes('--layers-only')) {
  const child = spawn(['bun', join(portfolio, 'generator', 'assemble-video.mjs'), planPath], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await child.exited) !== 0)
    throw new Error('Could not render the original capture underlay.');
}
console.log(`Prepared ${timeline.length} continuous text sequences; ${from} frames.`);
