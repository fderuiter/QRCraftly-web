import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { PageFaq } from './PageFaq';

const FAQS = [
  { question: 'Do the codes expire?', answer: 'No. They are static codes.' },
  { question: 'Is it free?', answer: 'Yes, every feature.' },
];

describe('PageFaq', () => {
  it('renders every question as an h3 with its answer in the page', () => {
    const { container } = render(<PageFaq faqs={FAQS} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(FAQS.map((q) => q.question));
    // Collapsed answers stay in the DOM, so search engines can match them to the FAQ markup.
    expect(container).toHaveTextContent('No. They are static codes.');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<PageFaq faqs={FAQS} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
