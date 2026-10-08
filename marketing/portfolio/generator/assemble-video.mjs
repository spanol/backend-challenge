import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'bun';

const portfolio = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(portfolio, '..', '..');
const brand = JSON.parse(readFileSync(join(portfolio, 'brand.json'), 'utf8'));
const planPath = process.argv[2];
if (!planPath) throw new Error('Usage: bun assemble-video.mjs <edit-plan.json>');
const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
const output = join(portfolio, 'videos', plan.output);
const work = join(
  repo,
  '.tmp',
  'linkedin-20261007',
  'video-edit',
  basename(plan.output).replace(/\.mp4$/, ''),
);
mkdirSync(work, { recursive: true });

const projectPath = (value) => (isAbsolute(value) ? value : join(portfolio, value));
async function command(args) {
  const child = spawn(args, { stdout: 'ignore', stderr: 'pipe' });
  const diagnostic = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(diagnostic);
}

const clips = [];
for (const [index, scene] of plan.scenes.entries()) {
  const path = join(work, `${String(index + 1).padStart(2, '0')}.mp4`);
  const input = projectPath(scene.source);
  if (!existsSync(input)) throw new Error(`Missing source: ${input}`);
  const common = [
    '-an',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    plan.encoding?.preset ?? 'fast',
    '-crf',
    String(plan.encoding?.crf ?? 19),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    path,
  ];
  if (scene.type === 'still') {
    await command([
      'ffmpeg',
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-loop',
      '1',
      '-framerate',
      '30',
      '-i',
      input,
      '-t',
      String(scene.duration),
      ...common,
    ]);
  } else {
    const frame = projectPath(scene.frame);
    if (!existsSync(frame)) throw new Error(`Missing frame: ${frame}`);
    const crop = scene.crop;
    if (!crop || crop.length !== 4)
      throw new Error('Each recording scene requires an observed [width, height, x, y] crop.');
    const filter = scene.proofMagnification
      ? `[0:v]setpts=PTS-STARTPTS,split=${scene.responseMagnification ? '3[a][b][c]' : '2[a][b]'};[a]crop=216:178:1034:211,scale=480:396:flags=lanczos,setsar=1[proof];[b]crop=602:150:656:405,scale=1000:249:flags=lanczos,setsar=1[controls];${scene.responseMagnification ? '[c]crop=326:43:925:554,scale=1000:132:flags=lanczos,setsar=1[result];' : ''}[1:v]format=rgb24[brand];[brand][proof]overlay=324:115:shortest=1[p];[p][controls]overlay=64:539:shortest=1[q];${scene.responseMagnification ? '[q][result]overlay=64:884:shortest=1,format=yuv420p[out]' : '[q]format=yuv420p[out]'}`
      : `[0:v]setpts=PTS-STARTPTS,crop=${crop.join(':')},scale=1000:928:force_original_aspect_ratio=decrease:flags=lanczos,pad=1000:928:(ow-iw)/2:(oh-ih)/2:color=${brand.colors.console.replace('#', '0x')},setsar=1[screen];[1:v]format=rgb24[brand];[brand][screen]overlay=64:108:shortest=1,format=yuv420p[out]`;
    await command([
      'ffmpeg',
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(scene.start),
      '-i',
      input,
      '-loop',
      '1',
      '-framerate',
      '30',
      '-i',
      frame,
      '-filter_complex',
      filter,
      '-map',
      '[out]',
      '-t',
      String(scene.duration),
      ...common,
    ]);
  }
  clips.push(path);
  console.log(`Rendered scene ${index + 1}/${plan.scenes.length}`);
}

const concat = join(work, 'concat.txt');
writeFileSync(
  concat,
  clips.map((path) => `file '${path.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`).join('\n'),
);
await command([
  'ffmpeg',
  '-y',
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  concat,
  '-c',
  'copy',
  '-movflags',
  '+faststart',
  output,
]);
writeFileSync(output.replace(/\.mp4$/, '-edit-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
console.log(`Saved ${output}`);
