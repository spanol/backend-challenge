import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'bun';
import { render, text } from '../generator/brand-kit.mjs';

const project = dirname(fileURLToPath(import.meta.url));
const portfolio = join(project, '..');
const work = join(project, 'generated', 'linkedin-render');
const assets = join(project, 'public', 'generated', 'linkedin');
const cli = join(project, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
mkdirSync(work, { recursive: true });
const assembleOnly = process.argv.includes('--assemble-only');

async function run(args) {
  const child = spawn(args, { cwd: project, stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`Video build failed: ${args[0]}`);
}

async function motion(name, from, to) {
  const output = join(work, `${name}.mp4`);
  if (assembleOnly) {
    if (!existsSync(output)) throw new Error(`Missing rendered segment: ${output}`);
    return output;
  }
  await run([
    'node',
    cli,
    'render',
    'src/linkedin.jsx',
    'LinkedInMasterpiece',
    output,
    `--frames=${from}-${to}`,
    '--codec=h264',
    '--pixel-format=yuv420p',
    '--crf=19',
    '--x264-preset=fast',
    '--concurrency=2',
  ]);
  return output;
}

// Render only the new scenes. Original proof clips already contain their Remotion motion.
const opening = await motion('opening', 0, 869);
const capabilities = await motion('capabilities', 2010, 2699);
const outro = await motion('outro', 3060, 3209);
const afterOverlay = join(work, 'after-overlay.mov');
if (!assembleOnly)
  await run([
    'node',
    cli,
    'render',
    'src/linkedin.jsx',
    'LinkedInAfterOverlay',
    afterOverlay,
    '--codec=prores',
    '--prores-profile=4444',
    '--pixel-format=yuva444p10le',
    '--image-format=png',
    '--concurrency=2',
  ]);

const caption = (name, value) => {
  const base = join(work, name);
  render(base, 710, 30, [
    '<rect width="710" height="30" fill="#eaebe6"/>',
    text(6, 21, value, 15, { role: 'data', color: '#4b534e' }),
  ]);
  return `${base}.png`;
};
const historicalLabel = caption(
  'historical-label',
  'CAPTURA REAL · 07/10/2026 · RECORTE HISTÓRICO',
);
const roundLabel = caption('round-label', 'RODADA GRAVADA · 07/10/2026');
const encoding = [
  '-an',
  '-r',
  '30',
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  '-crf',
  '19',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
];
const ffmpeg = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'];

async function labelOriginal(name, duration) {
  const output = join(work, `${name}-dated.mp4`);
  await run([
    ...ffmpeg,
    '-i',
    join(assets, `${name}.mp4`),
    '-loop',
    '1',
    '-i',
    historicalLabel,
    '-filter_complex',
    '[0:v][1:v]overlay=1134:955:shortest=1,format=yuv420p[out]',
    '-map',
    '[out]',
    '-t',
    String(duration),
    ...encoding,
    output,
  ]);
  return output;
}
const reconciliation = await labelOriginal('reconciliation', 7);
const replay = await labelOriginal('replay', 15);
const grafana = await labelOriginal('grafana', 12);

const round = join(work, 'round.mp4');
await run([
  ...ffmpeg,
  '-i',
  join(assets, 'round-original.mp4'),
  '-i',
  join(assets, 'round-game.mp4'),
  '-loop',
  '1',
  '-i',
  roundLabel,
  '-filter_complex',
  '[0:v]drawbox=x=64:y=108:w=1000:h=928:color=0x141815:t=fill[base];[1:v]scale=892:892:flags=lanczos,setsar=1[game];[base][game]overlay=118:128:shortest=1[p];[p][2:v]overlay=1134:955:shortest=1,format=yuv420p[out]',
  '-map',
  '[out]',
  '-t',
  '9',
  ...encoding,
  round,
]);

const after = join(work, 'after.mp4');
await run([
  ...ffmpeg,
  '-i',
  join(assets, 'after-replay.mp4'),
  '-i',
  afterOverlay,
  '-filter_complex',
  '[0:v][1:v]overlay=0:0:shortest=1,format=yuv420p[out]',
  '-map',
  '[out]',
  '-t',
  '7',
  ...encoding,
  after,
]);

const clips = [opening, round, reconciliation, replay, after, capabilities, grafana, outro];
const output = join(portfolio, 'videos', 'processador-masterpiece-linkedin-remotion.mp4');
// Original and Remotion exports have different time bases. Normalize by frame index
// before concatenation; stream-copy concatenation can produce overlapping timestamps.
const normalized = clips.map((_, i) => `[${i}:v]fps=30,settb=1/30,setpts=N[v${i}]`).join(';');
const inputs = clips.map((_, i) => `[v${i}]`).join('');
await run([
  ...ffmpeg,
  ...clips.flatMap((path) => ['-i', path]),
  '-filter_complex',
  `${normalized};${inputs}concat=n=${clips.length}:v=1:a=0[out]`,
  '-map',
  '[out]',
  ...encoding,
  output,
]);
console.log(`Built 107 seconds with original motion and financial proof: ${output}`);
