/*
    QRCraftly
    Copyright (C) 2025 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/


import React from 'react';
import { Download, Keyboard, QrCode } from 'lucide-react';
import { PLEDGE_COMMITMENT, PLEDGE_HEADLINE } from '@/data/pledge';
import { GENERATOR_FOOTER_LINKS, TOOL_LINKS } from '@/data/navigation';
import { isDangerousUrl } from '@/utils/security';
import { ButtonLink } from '@/components/ui/Button';
import { ArticleHeading, ArticleLayout, type ArticleSection } from '@/components/ArticleLayout';

const GithubIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const SECTIONS: readonly ArticleSection[] = [
  { id: 'why', label: 'Why QRCraftly exists' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'pledge', label: 'The pledge' },
  { id: 'tools', label: 'Every tool' },
  { id: 'open-source', label: 'Open source' },
];

const STEPS = [
  { icon: Keyboard, title: 'You type', text: 'A link, Wi-Fi details, a contact or a file. It stays in this tab.' },
  { icon: QrCode, title: 'Your browser draws it', text: 'The code is encoded and styled on your device, with no server in between.' },
  { icon: Download, title: 'You keep it', text: 'Download, copy or share the file. It is a static code, so it never expires.' },
] as const;

const LINK_CLASSES = 'font-medium text-accent underline-offset-2 hover:underline';

/**
 * About page: why QRCraftly exists, how it works, the no-ads pledge, every tool and the
 * licence, in the shared article layout.
 * @returns The About page.
 */
export default function Page() {

  return (
    <>
      <ArticleLayout
        title="About QRCraftly"
        lead="A privacy-focused QR code generator that runs in your browser. Free, with no ads and no sign-up."
        sections={SECTIONS}
      >
        <section id="why" aria-labelledby="why-title" className="mb-10 scroll-mt-6 space-y-3 text-fg-soft">
          <ArticleHeading id="why"><span id="why-title">Why QRCraftly exists</span></ArticleHeading>
          <p>
            Many free QR code generators are not free for long. They send your codes through their own servers, then
            switch them off when a trial ends, or fill the page with ads and trackers.
          </p>
          <p>
            QRCraftly makes static codes: what you encode is written into the code itself, so it keeps working without
            us. QRCraftly is completely free to use. No sign-up, no login and no hidden fees.
          </p>
        </section>

        <section id="how-it-works" aria-labelledby="how-it-works-title" className="mb-10 scroll-mt-6">
          <ArticleHeading id="how-it-works"><span id="how-it-works-title">How it works</span></ArticleHeading>
          <ol className="grid gap-3 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="rounded-xl border border-line bg-surface p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent" aria-hidden="true">
                    {index + 1}
                  </span>
                  <Icon className="size-5 text-accent" aria-hidden="true" />
                </div>
                <h3 className="font-semibold text-fg">{title}</h3>
                <p className="text-sm text-fg-muted">{text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-fg-muted">
            No analytics, tracking cookies or third-party scripts. Our host, Cloudflare, only sees ordinary page
            requests, never your QR content. <a href="/security" className={LINK_CLASSES}>How we keep it that way</a>
          </p>
        </section>

        <section id="pledge" aria-labelledby="pledge-title" className="mb-10 scroll-mt-6 border-l-4 border-accent pl-4">
          <ArticleHeading id="pledge"><span id="pledge-title">The pledge</span></ArticleHeading>
          <p className="mb-2 font-semibold text-fg">{PLEDGE_HEADLINE}</p>
          <p className="mb-4 text-fg-soft">{PLEDGE_COMMITMENT}</p>
          <ButtonLink href="/free-forever" variant="primary">
            Read the QRCraftly Pledge
          </ButtonLink>
        </section>

        <section id="tools" aria-labelledby="tools-title" className="mb-10 scroll-mt-6">
          <ArticleHeading id="tools"><span id="tools-title">Every tool</span></ArticleHeading>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {[...GENERATOR_FOOTER_LINKS, ...TOOL_LINKS].map(([label, href]) => {
              if (!isDangerousUrl(href)) {
                return (
                  <li key={href}>
                    <a href={href} className={LINK_CLASSES}>{label}</a>
                  </li>
                );
              }
              return null;
            })}
          </ul>
        </section>

        <section id="open-source" aria-labelledby="open-source-title" className="mb-10 scroll-mt-6 text-fg-soft">
          <ArticleHeading id="open-source"><span id="open-source-title">Open source</span></ArticleHeading>
          <p className="mb-4">
            QRCraftly is released under the <strong>GNU Affero General Public License v3.0 (AGPL-3.0)</strong>. The code
            is open for inspection and contribution. We believe in transparency.
          </p>
          <p className="mb-4">
            QRCraftly is built on open-source packages too.{' '}
            <a href="/acknowledgements" className={LINK_CLASSES}>See every package it ships and its license</a>
          </p>
          <ButtonLink href="https://github.com/fderuiter/QRCraftly" target="_blank" rel="noopener noreferrer" variant="outline">
            <GithubIcon className="size-5" />
            View on GitHub
          </ButtonLink>
        </section>
      </ArticleLayout>
    </>
  );
}
