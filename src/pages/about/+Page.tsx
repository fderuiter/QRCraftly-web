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


import { Download, Keyboard, QrCode } from 'lucide-react';
import { PLEDGE_COMMITMENT, PLEDGE_HEADLINE } from '@/data/pledge';
import { CONTACT_ADDRESS } from '@/data/contact';
import { GENERATOR_FOOTER_LINKS, TOOL_LINKS } from '@/data/navigation';
import { isDangerousUrl } from '@/packages/core/security';
import { ButtonLink } from '@/components/ui/Button';
import { PageFaq } from '@/components/PageFaq';
import { copy } from '@/data/copy/about';
import { ArticleHeading, ArticleLayout, type ArticleSection } from '@/components/ArticleLayout';

const SECTIONS: readonly ArticleSection[] = [
  { id: 'why', label: 'Why QRCraftly exists' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'pledge', label: 'The pledge' },
  { id: 'tools', label: 'Every tool' },
  { id: 'how-its-built', label: 'How it is built' },
  { id: 'questions', label: 'Common questions' },
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
        pageId="about"
        title="About QRCraftly"
        lead="A QR code generator that runs in your browser. Free, with no ads, no tracking and no sign-up."
        sections={SECTIONS}
      >
        <section id="why" aria-labelledby="why-title" className="mb-10 scroll-mt-6 space-y-3 text-fg-soft">
          <ArticleHeading id="why"><span id="why-title">Why QRCraftly exists</span></ArticleHeading>
          <p>
            Many free QR code generators are not free for long. They route your codes through their own servers and
            switch them off when a trial ends, or they pay for the site with ads and trackers.
          </p>
          <p>
            QRCraftly makes static codes: what you encode is written into the code itself, so the code keeps working
            even if this site goes away. It costs nothing and needs no account.
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

        <section id="how-its-built" aria-labelledby="how-its-built-title" className="mb-10 scroll-mt-6 space-y-3 text-fg-soft">
          <ArticleHeading id="how-its-built"><span id="how-its-built-title">How it is built</span></ArticleHeading>
          <p>
            QRCraftly is a set of static files. The QR encoder and scanner are my own code, written in Rust and run in
            your browser as WebAssembly. There is no server code, no database and no account system.
          </p>
          <p>
            The code published up to October 2026 was released under the GNU AGPL v3.0. Later versions are not public,
            but the privacy promises do not depend on reading the code: your browser enforces them.{' '}
            <a href="/security" className={LINK_CLASSES}>How to check them yourself</a>
          </p>
          <p>
            QRCraftly also uses a few open-source packages.{' '}
            <a href="/acknowledgements" className={LINK_CLASSES}>See every package it ships and its license</a>
          </p>
          <p>
            Questions or ideas? <a href="mailto:fpderuiter+qrcraftly@gmail.com" className={LINK_CLASSES}>Email {CONTACT_ADDRESS}</a>
          </p>
        </section>

        <section id="questions" aria-labelledby="questions-title" className="mb-10 scroll-mt-6 text-fg-soft">
          <ArticleHeading id="questions"><span id="questions-title">Common questions</span></ArticleHeading>
          <PageFaq faqs={copy.faqs ?? []} />
        </section>
      </ArticleLayout>
    </>
  );
}
