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


import { Eyebrow } from '@/components/ui/SectionHeading';
import { Ban, EyeOff, Laptop, Gift } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { JsonLdScript } from '@/components/ui/JsonLdScript';
import { contentRegistry } from '@/data/contentRegistry';
import { copy } from '@/data/copy/free-forever';
import {
  PLEDGE_AFFORDABLE,
  PLEDGE_COLLECTED,
  PLEDGE_COMMITMENT,
  PLEDGE_HEADLINE,
  PLEDGE_LEAD,
  PLEDGE_NEVER_EXPIRE,
  PLEDGE_NOT_COLLECTED,
  PLEDGE_PROMISES,
  PLEDGE_SIGNATURE,
  PLEDGE_VERIFY,
  PLEDGE_WHY,
  TRIAL_EXPIRY_LINK_LABEL,
} from '@/data/pledge';
import { generateSchema } from '@/utils/schemaGenerator';
import { resolveDomainForPath } from '@/utils/metadataEngine';
import { usePageContext } from 'vike-react/usePageContext';

const PROMISE_ICONS: readonly LucideIcon[] = [Ban, EyeOff, Laptop, Gift];

/**
 * The Free Forever page: the QRCraftly Pledge (no ads, no tracking, client-side processing,
 * free use), why the codes never expire, and an exact list of what is and isn't collected.
 * @returns The pledge page layout.
 */
export default function Page() {
  const pageContext = usePageContext();
  const urlPathname = pageContext?.urlPathname ?? '/free-forever';
  const resolvedDomain = resolveDomainForPath(urlPathname);
  const schemaData = generateSchema({ ...contentRegistry['free-forever'], ...copy }, resolvedDomain, urlPathname);

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 py-12">
        <JsonLdScript data={schemaData} />

        <header className="mb-12 text-center">
          <Eyebrow tone="accent" className="mb-3 justify-center">The QRCraftly Pledge</Eyebrow>
          <h1 className="mb-6 text-4xl font-bold text-fg md:text-5xl">{PLEDGE_HEADLINE}</h1>
          <p className="mx-auto mb-4 max-w-2xl text-xl font-medium text-fg">{PLEDGE_LEAD}</p>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-fg-muted">{PLEDGE_WHY}</p>
        </header>

        <section aria-labelledby="pledge-promises" className="mb-12">
          <h2 id="pledge-promises" className="sr-only">What I promise</h2>
          <ul className="grid gap-6 md:grid-cols-2">
            {PLEDGE_PROMISES.map((promise, index) => {
              const Icon = PROMISE_ICONS[index % PROMISE_ICONS.length];
              return (
                <li
                  key={promise.title}
                  className="rounded-2xl border border-line bg-surface-raised p-6 shadow-sm"
                >
                  <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <Icon className="size-6" aria-hidden="true" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-fg">{promise.title}</h3>
                  <p className="text-fg-muted">{promise.text}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <section
          aria-labelledby="pledge-commitment"
          className="mb-12 rounded-2xl border border-teal-100 bg-teal-50 p-8 text-center md:p-12 dark:border-teal-800/40 dark:bg-teal-900/20"
        >
          <h2 id="pledge-commitment" className="mb-4 text-2xl font-bold text-fg">Ads or nothing? Nothing.</h2>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-fg-soft">{PLEDGE_COMMITMENT}</p>
          <p className="mt-6 text-sm font-medium text-fg-muted">{PLEDGE_SIGNATURE}</p>
        </section>

        <section aria-labelledby="pledge-never-expire" className="mb-12">
          <h2 id="pledge-never-expire" className="mb-4 text-2xl font-bold text-fg">Why your codes never expire</h2>
          <p className="mb-3 leading-relaxed text-fg-muted">{PLEDGE_NEVER_EXPIRE}</p>
          <p className="leading-relaxed text-fg-muted">
            For example, see the vendor&apos;s own article on{' '}
            <a href="https://support.qr-code-generator.com/hc/en-us/articles/7665046137613-What-happens-to-my-account-and-QR-Codes-when-the-trial-expires" target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline hover:text-accent-strong">
              {TRIAL_EXPIRY_LINK_LABEL}
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="pledge-affordable" className="mb-12">
          <h2 id="pledge-affordable" className="mb-4 text-2xl font-bold text-fg">How it stays free without ads</h2>
          <p className="leading-relaxed text-fg-muted">{PLEDGE_AFFORDABLE}</p>
        </section>

        <section aria-labelledby="pledge-data" className="mb-12">
          <h2 id="pledge-data" className="mb-6 text-2xl font-bold text-fg">Exactly what is and isn&apos;t collected</h2>
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="mb-3 text-lg font-semibold text-fg">What is seen or stored</h3>
              <ul className="list-disc space-y-3 pl-5 text-fg-muted">
                {PLEDGE_COLLECTED.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="mb-3 text-lg font-semibold text-fg">What is never collected</h3>
              <ul className="list-disc space-y-3 pl-5 text-fg-muted">
                {PLEDGE_NOT_COLLECTED.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="pledge-verify" className="mb-12">
          <h2 id="pledge-verify" className="mb-4 text-2xl font-bold text-fg">Check it yourself</h2>
          <p className="leading-relaxed text-fg-muted">
            {PLEDGE_VERIFY} Read the{' '}
            <a href="/security#compliance" className="font-medium text-accent underline hover:text-accent-strong">
              privacy details
            </a>{' '}
            or the{' '}
            <a href="https://github.com/fderuiter/QRCraftly" target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline hover:text-accent-strong">
              source code on GitHub
            </a>
            .
          </p>
        </section>
      </div>
    </>
  );
}
