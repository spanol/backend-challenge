import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'bun';

const project = dirname(fileURLToPath(import.meta.url));
const portfolio = join(project, '..');
const publicDir = join(project, 'public', 'generated', 'linkedin');
const linkedin = join(portfolio, 'linkedin', '2026-10-14');
const videos = join(portfolio, 'videos');
const fonts = join(portfolio, 'assets', 'fonts');
mkdirSync(publicDir, { recursive: true });
mkdirSync(join(publicDir, 'fonts'), { recursive: true });

for (const [source, target] of [
  [join(portfolio, 'covers', '01-processador-1920x1080.png'), 'cover.png'],
  [join(linkedin, 'source-interface-overview.png'), 'interface-overview.png'],
  [join(linkedin, '03-configuracao-da-rodada.png'), 'round-configuration.png'],
  [join(linkedin, 'source-wallet-ledger-current.png'), 'wallet-ledger-current.png'],
  [join(portfolio, 'assets', 'subiu-logo.svg'), 'subiu-logo.svg'],
]) {
  copyFileSync(source, join(publicDir, target));
}

for (const font of [
  'archivo-400.woff2',
  'archivo-600.woff2',
  'archivo-black-400.woff2',
  'jetbrains-mono-400.woff2',
]) {
  copyFileSync(join(fonts, font), join(publicDir, 'fonts', font));
}

async function run(args) {
  const child = spawn(args, { cwd: project, stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`Failed to prepare video material: ${args[0]}`);
}

// Regenerate the ORIGINAL text paths, timing and base frames. Do not replace their motion.
await run(['bun', 'prepare.mjs', '--layers-only']);
const original = join(videos, 'processador-demo-remotion-60s.mp4');
for (const [name, start, duration, filter] of [
  ['round-game', 3, 9, 'crop=574:574:90:458,setsar=1'],
  ['round-original', 3, 9, null],
  ['reconciliation', 21, 7, null],
  ['replay', 28, 15, null],
  ['grafana', 43, 12, null],
]) {
  await run([
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(start),
    '-i',
    original,
    '-t',
    String(duration),
    ...(filter ? ['-vf', filter] : []),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    join(publicDir, `${name}.mp4`),
  ]);
}

// The original technical recording contains the post-replay refresh. Preserve its real values.
// The page has scrolled here: these observed crops differ from the earlier replay.
await run([
  'ffmpeg',
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-ss',
  '80',
  '-i',
  'C:/Users/cspan/Videos/2026-10-07 12-03-49.mp4',
  '-loop',
  '1',
  '-framerate',
  '30',
  '-i',
  join(project, 'public', 'generated', '02-reconciliation-base.png'),
  '-filter_complex',
  '[0:v]setpts=PTS-STARTPTS,split[a][b];[a]crop=220:182:1033:387,scale=480:397:flags=lanczos,setsar=1[proof];[b]crop=600:137:655:582,scale=1000:228:flags=lanczos,setsar=1[controls];[1:v][proof]overlay=324:115:shortest=1[p];[p][controls]overlay=64:620:shortest=1,format=yuv420p[out]',
  '-map',
  '[out]',
  '-t',
  '7',
  '-an',
  '-r',
  '30',
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  '-crf',
  '16',
  join(publicDir, 'after-replay.mp4'),
]);
console.log(
  `Prepared original animations, financial proof clips and current ledger capture in ${publicDir}.`,
);
