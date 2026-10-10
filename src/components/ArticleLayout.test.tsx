import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { ArticleHeading, ArticleLayout } from './ArticleLayout';

type Entry = { isIntersecting: boolean; target: Element };
type ObserverCallback = (entries: Entry[]) => void;

const SECTIONS = [
  { id: 'one', label: 'First section' },
  { id: 'two', label: 'Second section' },
];

function renderArticle() {
  return render(
    <ArticleLayout title="Guide" lead="A short lead." sections={SECTIONS}>
      {SECTIONS.map(({ id, label }) => (
        <section key={id} id={id} aria-labelledby={`${id}-title`}>
          <ArticleHeading id={id}>
            <span id={`${id}-title`}>{label}</span>
          </ArticleHeading>
          <p>Body of {label}.</p>
        </section>
      ))}
    </ArticleLayout>
  );
}

describe('ArticleLayout', () => {
  let callback: ObserverCallback | undefined;

  beforeEach(() => {
    callback = undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: ObserverCallback) {
          callback = cb;
        }
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the table of contents from the sections, at reading width, with no axe violations', async () => {
    const { container } = renderArticle();
    expect(screen.getByRole('heading', { level: 1, name: 'Guide' })).toBeInTheDocument();
    expect(container.querySelector('article')).toHaveClass('max-w-[68ch]');
    const navs = screen.getAllByRole('navigation', { name: 'On this page', hidden: true });
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(within(nav).getAllByRole('link', { hidden: true }).map((a) => a.getAttribute('href'))).toEqual(['#one', '#two']);
    }
    // Below lg the contents collapse into an "On this page" disclosure.
    expect(screen.getByRole('button', { name: 'On this page' })).toHaveAttribute('aria-expanded', 'false');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('highlights the section being read', () => {
    renderArticle();
    const desktop = screen.getAllByRole('navigation', { name: 'On this page', hidden: true })[1];
    const link = (name: string) => within(desktop).getByRole('link', { name, hidden: true });
    expect(link('First section')).toHaveAttribute('aria-current', 'location');

    act(() => callback?.([{ isIntersecting: true, target: document.getElementById('two') as Element }]));
    expect(link('Second section')).toHaveAttribute('aria-current', 'location');
    expect(link('First section')).not.toHaveAttribute('aria-current');
  });

  it('copies a link to a section from its heading anchor', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderArticle();
    const anchor = screen.getAllByRole('link', { name: 'Copy link to this section' })[1];
    expect(anchor).toHaveAttribute('href', '#two');
    await act(async () => {
      fireEvent.click(anchor);
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#two$/));
  });
});
