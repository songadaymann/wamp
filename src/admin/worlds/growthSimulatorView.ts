import { simulateWorldGrowth } from '../../worlds/growthSimulator';

export function initWorldGrowthSimulator(): void {
  const form = required<HTMLFormElement>('worlds-growth-form');
  const output = required<HTMLElement>('worlds-growth-output');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    output.textContent = 'Running deterministic trials…';
    window.requestAnimationFrame(() => {
      try {
        const result = simulateWorldGrowth({
          worldCount: value(form, 'worldCount'),
          dailyActiveBuildersPerWorld: value(form, 'dailyActiveBuildersPerWorld'),
          claimsPerBuilderPerDay: value(form, 'claimsPerBuilderPerDay'),
          directionalBias: value(form, 'directionalBias') / 100,
          maxDays: value(form, 'maxDays'),
          trials: value(form, 'trials'),
          seed: 129,
        });
        output.textContent = result.medianDays === null
          ? `${result.collisions}/${result.collisions + result.censored} trials collided; the median is beyond the simulated window.`
          : [
              `${result.collisions}/${result.collisions + result.censored} trials collided.`,
              `Median ${result.medianDays} days`,
              result.p25Days !== null && result.p75Days !== null
                ? `middle 50% ${result.p25Days}–${result.p75Days} days`
                : '',
              result.p90Days !== null ? `90th percentile ${result.p90Days} days.` : '',
            ].filter(Boolean).join(' ');
      } catch (error) {
        output.textContent = error instanceof Error ? error.message : 'Simulation failed.';
      }
    });
  });
}

function value(form: HTMLFormElement, name: string): number {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Missing ${name} input.`);
  return Number(field.value);
}

function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}.`);
  return node as T;
}
