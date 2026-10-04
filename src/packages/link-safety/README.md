# link-safety

Reads a web address for the signs people use to disguise where a link goes. Pure, synchronous and offline: it only looks at the text, so it can say a link looks unusual and never that a site is safe.

```ts
import { analyseLink } from '@/packages/link-safety';

analyseLink('https://paypa1.com/signin');
// [{ code: 'lookalike', severity: 'caution', message: 'The name paypa1 imitates paypal. The real site is paypal.com.' }]
```

## Findings

| Code                 | Severity | Meaning                                                             |
| -------------------- | -------- | ------------------------------------------------------------------- |
| `userinfo`           | caution  | `name@host`: what comes before the `@` is not the site              |
| `ip-host`            | caution  | A number instead of a name (decimal, hex, octal and IPv6 forms too) |
| `mixed-scripts`      | caution  | A label mixes alphabets                                             |
| `lookalike`          | caution  | The label reads like a well-known brand but is not its domain       |
| `brand-in-subdomain` | caution  | A brand is named in a subdomain of another registrable domain       |
| `deep-subdomain`     | caution  | Four or more name levels before the registrable domain              |
| `http`               | caution  | Not encrypted                                                       |
| `shortener`          | info     | A shortener or redirector hides the destination                     |
| `brand-in-path`      | info     | A sign-in style path names a brand of another site                  |
| `international`      | info     | International characters; the plain form is shown                   |
| `punycode`           | info     | An encoded `xn--` label that could not be decoded                   |
| `port`               | info     | A non-default port                                                  |

## Data

The brand list, shortener list, confusable table and the public-suffix subset live in `lib/data.ts` and ship in the bundle. The suffix list is deliberately small: an unlisted multi-label suffix is read as a plain top-level domain, which can only make the registrable domain look shorter, never invent a warning on a listed brand's own domain.

## Budget

The package adds at most 6 KB gzipped, and is loaded with the scanner and checker, and lazily by the generator's link hints. The false-positive corpus in `tests/analyseLink.test.ts` (200 ordinary addresses) must raise no `caution`.

## Not covered

Real-time reputation lists (Safe Browsing and the like) would need a network request, which QRCraftly never makes. A brand missing from the list is not detected.
