'use client';

import { type PointerEvent, useEffect, useRef } from 'react';
import type { RevealProps } from './Reveal';
import { RevealContent } from './RevealContent';
import { clearedRatio, SCRATCH_THRESHOLD } from './scratch';

const BRUSH_RADIUS = 26;

/** A foil layer over the surprise that is rubbed away with a finger or the mouse. */
export function ScratchCardReveal({ reveal, revealed, onReveal, labels }: RevealProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const moves = useRef(0);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    // Match the backing store to the displayed size so that pointer coordinates map 1:1.
    const { width, height } = element.getBoundingClientRect();
    element.width = Math.round(width);
    element.height = Math.round(height);
    const foil = context.createLinearGradient(0, 0, element.width, element.height);
    foil.addColorStop(0, '#e9b44c');
    foil.addColorStop(0.5, '#f6dc9a');
    foil.addColorStop(1, '#c98f2b');
    context.fillStyle = foil;
    context.fillRect(0, 0, element.width, element.height);
    context.fillStyle = 'rgba(29, 19, 38, 0.75)';
    context.font = '600 16px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(labels.SCRATCH_CARD, element.width / 2, element.height / 2 + 6);
  }, [labels.SCRATCH_CARD]);

  function scratch(event: PointerEvent<HTMLCanvasElement>) {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context || revealed) return;
    const bounds = element.getBoundingClientRect();
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const from = last.current ?? point;

    context.globalCompositeOperation = 'destination-out';
    context.lineWidth = BRUSH_RADIUS * 2;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    last.current = point;

    // Measuring reads back the whole canvas; every few moves is plenty.
    moves.current += 1;
    if (moves.current % 6 !== 0) return;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    if (clearedRatio(pixels) >= SCRATCH_THRESHOLD) onReveal();
  }

  return (
    <div className="bg-paper text-ink relative w-full overflow-hidden rounded-3xl p-6 shadow-2xl">
      <div aria-hidden={!revealed}>
        <RevealContent reveal={reveal} />
      </div>
      <canvas
        ref={canvas}
        data-testid="scratch-surface"
        className={`absolute inset-0 size-full touch-none transition-opacity duration-700 ${
          revealed ? 'pointer-events-none opacity-0' : 'cursor-grab opacity-100'
        }`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          last.current = null;
          scratch(event);
        }}
        onPointerMove={(event) => {
          // A mouse only scratches while pressed; a finger is always "pressed".
          if (event.pointerType === 'mouse' && event.buttons === 0) return;
          scratch(event);
        }}
        onPointerUp={() => (last.current = null)}
      />
    </div>
  );
}
