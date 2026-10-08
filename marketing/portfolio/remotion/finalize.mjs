import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'bun';

const project = dirname(fileURLToPath(import.meta.url));
const videos = join(project, '..', 'videos');
const source = join(videos, 'processador-demo-remotion-60s.mp4');
const child = spawn(
  [
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames',
    '-of',
    'json',
    source,
  ],
  { stdout: 'pipe', stderr: 'pipe' },
);
const diagnostic = await new Response(child.stderr).text();
const result = JSON.parse(await new Response(child.stdout).text());
if ((await child.exited) !== 0) throw new Error(diagnostic);
const video = result.streams.find((stream) => stream.codec_type === 'video');
if (
  result.streams.length !== 1 ||
  video?.codec_name !== 'h264' ||
  video.width !== 1920 ||
  video.height !== 1080 ||
  video.r_frame_rate !== '30/1' ||
  video.nb_frames !== '1800' ||
  Number(result.format.duration) !== 60
)
  throw new Error(`Unexpected export format: ${JSON.stringify(result)}`);

const planPath = join(videos, 'edit-main.json');
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
plan.visualRevision = '2026-10-07-paper-v6-remotion';
plan.renderer = { name: 'Remotion', version: '4.0.534', composition: 'ProcessadorDemo' };
plan.animation = {
  entry: 'Opacity and 18px vertical translation; bezier(0.16, 1, 0.3, 1).',
  durationInFrames: 18,
  staggerInFrames: 3,
  fixedElements: ['signature', 'official logo', 'fictitious-credit notice'],
  continuousSequences: 6,
  note: 'Text remains settled until the next section. Consecutive cuts do not restart it. Recorded financial values and graphs are not animated or replaced.',
};
const timeline = JSON.parse(readFileSync(join(project, 'generated', 'timeline.json'), 'utf8'));
plan.animation.timeline = timeline.scenes.map(({ id, from, durationInFrames }) => ({
  id,
  from,
  durationInFrames,
}));
copyFileSync(source, join(videos, plan.output));
writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
writeFileSync(
  join(videos, plan.output.replace(/\.mp4$/, '-edit-plan.json')),
  `${JSON.stringify(plan, null, 2)}\n`,
);
console.log(`Finalized ${plan.output}: 1800 frames, H.264, 1920x1080, 30 fps, no audio.`);
