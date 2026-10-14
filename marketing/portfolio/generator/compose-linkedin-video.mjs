import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const portfolio = join(fileURLToPath(new URL('..', import.meta.url)));
const repo = join(portfolio, '..', '..');
const media = join(portfolio, 'linkedin', '2026-10-14');
const video = join(portfolio, 'videos');
const output = join(video, 'processador-masterpiece-linkedin-74s.mp4');
const stills = [
  join(media, '01-ate-1500-jogadores.png'),
  join(media, '02-interface-atual.png'),
  join(media, '03-configuracao-da-rodada.png'),
];
const original = join(video, 'processador-demo-60s.mp4');
const inputArgs = [
  '-loop',
  '1',
  '-framerate',
  '30',
  '-t',
  '4',
  '-i',
  stills[0],
  '-i',
  original,
  '-loop',
  '1',
  '-framerate',
  '30',
  '-t',
  '4',
  '-i',
  stills[1],
  '-loop',
  '1',
  '-framerate',
  '30',
  '-t',
  '6',
  '-i',
  stills[2],
];
const filters = [
  '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xeaebe6,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v0]',
  '[1:v]scale=1920:1080,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v1]',
  '[2:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xeaebe6,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v2]',
  '[3:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xeaebe6,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v3]',
  '[v0][v1][v2][v3]concat=n=4:v=1:a=0[outv]',
].join(';');
const args = [
  '-hide_banner',
  '-y',
  ...inputArgs,
  '-filter_complex',
  filters,
  '-map',
  '[outv]',
  '-an',
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '19',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  output,
];

const result = spawnSync('ffmpeg', args, { cwd: repo, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(output);
