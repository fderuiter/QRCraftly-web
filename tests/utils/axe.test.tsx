import { afterEach, describe, expect, it } from 'vitest';
import { axe, toHaveNoViolations } from './axe';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tests/utils/axe', () => {
  it('passes a clean fixture', async () => {
    document.body.innerHTML = '<main><h1>Title</h1><img src="a.png" alt="A logo"></main>';
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('fails an image without alt text and names the rule and selector', async () => {
    document.body.innerHTML = '<main><h1>Title</h1><img id="bad" src="a.png"></main>';
    const results = await axe(document.body);
    const outcome = toHaveNoViolations(results);
    expect(outcome.pass).toBe(false);
    const message = outcome.message();
    expect(message).toContain('image-alt');
    expect(message).toContain('#bad');
    expect(message).toContain('https://dequeuniversity.com/rules/axe/');
    expect(() => expect(results).toHaveNoViolations()).toThrow(/image-alt/);
  });

  it('queues overlapping runs instead of throwing', async () => {
    document.body.innerHTML = '<main><h1>Title</h1><button>Go</button></main>';
    const runs = await Promise.all([axe(document.body), axe(document.body), axe(document.body)]);
    for (const results of runs) expect(results).toHaveNoViolations();
  });

  it('scans a detached element from a copy and restores the page', async () => {
    document.body.innerHTML = '<p id="keep">kept</p>';
    const detached = document.createElement('div');
    detached.innerHTML = '<img src="x.png">';
    const results = await axe(detached);
    expect(results.violations.map(v => v.id)).toContain('image-alt');
    expect(document.getElementById('keep')).not.toBeNull();
  });

  it('honours impact levels when the run asks for them', async () => {
    document.body.innerHTML = '<main><h1>Title</h1><img src="a.png"></main>';
    const results = await axe(document.body);
    const onlyMinor = { ...results, toolOptions: { ...results.toolOptions, impactLevels: ['minor' as const] } };
    expect(toHaveNoViolations(onlyMinor).pass).toBe(true);
  });

  it('rejects something that is not an axe result', () => {
    expect(() => toHaveNoViolations({} as Parameters<typeof toHaveNoViolations>[0])).toThrow(/results of axe/);
  });
});
