import React from 'react';
import {
  AbsoluteFill,
  Composition,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  registerRoot,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import timeline from '../generated/timeline.json';

const easing = Easing.bezier(0.16, 1, 0.3, 1);

function AnimatedText({ layer }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [layer.delay, layer.delay + layer.duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
  return (
    <Img
      src={staticFile(layer.src)}
      alt={layer.label}
      style={{
        position: 'absolute',
        left: layer.x,
        top: layer.y,
        width: layer.width,
        height: layer.height,
        opacity: progress,
        transform: `translateY(${(1 - progress) * layer.distance}px)`,
      }}
    />
  );
}

export function ProcessadorDemo() {
  return (
    <AbsoluteFill style={{ backgroundColor: '#eaebe6' }}>
      <OffthreadVideo
        src={staticFile('generated/underlay.mp4')}
        muted
        style={{ width: '100%', height: '100%' }}
      />
      {timeline.scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
          {scene.layers.map((layer) => (
            <AnimatedText key={layer.src} layer={layer} />
          ))}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function Root() {
  return (
    <Composition
      id="ProcessadorDemo"
      component={ProcessadorDemo}
      durationInFrames={timeline.durationInFrames}
      fps={timeline.fps}
      width={timeline.width}
      height={timeline.height}
    />
  );
}

registerRoot(Root);
