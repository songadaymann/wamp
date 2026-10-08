import type { ReplaySample } from './model';

export function createReplayPlayer(elements: { image: HTMLImageElement; empty: HTMLElement;
  play: HTMLButtonElement; scrub: HTMLInputElement; time: HTMLElement }) {
  let samples: ReplaySample[] = [], position = 0, playing = false, previous = 0, frameId = 0;
  const end = () => samples.at(-1)?.time ?? 0;
  const clock = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  function draw(): void {
    const sample = [...samples].reverse().find(s => s.time <= position) ?? samples[0];
    elements.image.hidden = !sample?.image; elements.empty.hidden = !!sample?.image;
    if (sample?.image) elements.image.src = sample.image;
    elements.time.textContent = `${clock(position)} / ${clock(end())}`;
    elements.scrub.value = String(position);
  }
  function pause(): void {
    playing = false; elements.play.textContent = 'Play replay'; cancelAnimationFrame(frameId); frameId = 0;
  }
  function tick(now: number): void {
    if (!playing) return;
    position = Math.min(end(), position + now - previous); previous = now; draw();
    if (position >= end()) pause(); else frameId = requestAnimationFrame(tick);
  }
  const onPlay = () => {
    if (playing) { pause(); return; }
    if (position >= end()) position = 0;
    playing = true; previous = performance.now(); elements.play.textContent = 'Pause replay'; frameId = requestAnimationFrame(tick);
  };
  const onScrub = () => { pause(); position = Number(elements.scrub.value); draw(); };
  elements.play.addEventListener('click', onPlay); elements.scrub.addEventListener('input', onScrub);
  return {
    set(next: ReplaySample[]): void {
      pause(); samples = next; position = 0; elements.scrub.max = String(end());
      elements.play.disabled = end() === 0; elements.scrub.disabled = end() === 0; draw();
    }, pause,
    destroy(): void { pause(); elements.play.removeEventListener('click', onPlay); elements.scrub.removeEventListener('input', onScrub); },
  };
}
