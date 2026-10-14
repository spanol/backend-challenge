import React from 'react';
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

// Shared with the original film: one entry per section, then settled for reading.
export const textEasing = Easing.bezier(0.16, 1, 0.3, 1);

export function AnimatedText({ layer }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [layer.delay, layer.delay + layer.duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: textEasing,
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
