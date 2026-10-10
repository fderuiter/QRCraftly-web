# Writing Site Copy

How to write the words on QRCraftly's pages, and where each kind of text goes. It came out of user feedback that the generator pages read like a textbook ([#1354](https://github.com/fderuiter/QRCraftly-web/issues/1354), [#1356](https://github.com/fderuiter/QRCraftly-web/issues/1356)).

## Where text goes

People who open a generator page already know what code they want. Nothing they have to read sits between them and the tool.

| Kind of text                                                         | Where it lives                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Field labels, validation messages, warnings about risky input        | Next to the control, in the input component                                                    |
| One or two sentences on what the code does                           | The intro below the tool (`TypeGuide.intro`, at most 40 words)                                 |
| Three or four how-to steps                                           | The how-to below the intro (page copy in `src/data/copy/` or `src/data/landingPageContent.ts`) |
| Everything else: what scanning does, uses, printing, checks, privacy | Collapsed FAQ answers (`TypeGuide` fields, rendered by `getGuideFaqs`)                         |
| Long explanations that are not about one page                        | A guide under `/guides`                                                                        |

FAQ answers stay in the prerendered HTML while collapsed, and every one is also in the page's FAQPage structured data, so search engines read them without anyone having to scroll past them.

## Checklist

Before you merge new or changed copy:

- **True.** Check every claim against the code: the input fields, the payload generator in `src/packages/qr-payload/` and the export formats. If a feature changes, change the copy in the same PR.
- **Privacy claims match the pledge.** Say what happens in the browser and what anyone holding the code can read. Do not claim more than [the pledge](./PLEDGE.md) and [the security notes](./SECURITY.md) support.
- **Short.** One idea per sentence. Cut any sentence that does not change what the reader does next. Three good list items beat five.
- **Concrete.** Name the real thing (“the iPhone Camera app”, “2 cm wide”), not a category (“modern devices”, “an appropriate size”).
- **No filler.** No “seamless”, “effortless”, “robust”, “leverage”, “unlock”, “in today’s world”, “whether you are … or …”, or stacked adjectives. Do not repeat “free, no sign-up, no ads” in every paragraph: the page title, the pledge link and one FAQ already say it.
- **Our own words.** Write from what the app does and what you tested. Link the source for any technical fact a reader might want to check, and never reword someone else’s text to hide where it came from.
- **No hedged promises.** Do not promise that every phone will scan a code or that a page will rank. Say what to test instead.
- **Headings.** FAQ questions are level 3 headings under the level 2 “Frequently Asked Questions”.

## Inventory, October 2026

Words in the content section below the tool, measured with Testing Library on the rendered `SidebarContent`. “Before the FAQ” is what a reader scrolls past before the first FAQ question.

| Pages                        | Before the FAQ: before | Before the FAQ: after | Total: before | Total: after |
| ---------------------------- | ---------------------- | --------------------- | ------------- | ------------ |
| 11 type generators (range)   | 440 to 499             | 85 to 113             | 612 to 719    | 374 to 512   |
| 7 landing generators (range) | 446 to 692             | 147 to 262            | 568 to 955    | 435 to 706   |

What changed:

- **Layout.** The “What happens when someone scans it”, “Use cases”, “Tips for printing and sharing”, “Check it before you share it” and “Privacy” sections are now FAQ answers. FAQs that repeated them (“What happens when someone scans a … QR code?”, “Is … sent to QRCraftly?”, and the duplicate size and upload questions on landing pages) were removed.
- **Rewrite.** Every type and landing guide, how-to and type FAQ was rewritten shorter, and the “Key features” lists now use plain words instead of labels such as “Secure Client-Side”.
- **Corrections.** Copy had fallen behind the app. It now says that payment codes cover SEPA (EPC QR), PayPal, Venmo and Cash App as well as crypto; that social codes cover eight networks, not three; that events have a time zone setting and Google, Outlook, Office 365 and Yahoo links; that contact cards come in vCard 2.1, 3.0, 4.0 and MECARD; that email codes take CC and BCC; and that downloads include EPS and PDF.

The About, Security and Pledge pages and the privacy and compliance notes (`docs/public/COMPLIANCE.md`) were reviewed with the same checklist in October 2026:

- **About.** Filler (“no hidden fees”, “we believe in transparency”) is gone, and the FAQ says where your input goes instead of answering “Is my data secure?” with “Yes”.
- **Security.** The FAQ no longer says QRCraftly is HIPAA and GDPR compliant. No software is, on its own, and Cloudflare does process IP addresses. The how-to now tells readers how to check the claims themselves, and the heading is plain “Security & Privacy”.
- **Compliance notes.** Rewritten in plain words, with the scanner added and the claim that the app provides HIPAA technical safeguards removed.
- **Pledge.** “No limits” became “no paid tier”, because bulk CSV takes at most 500 rows a batch.
- **Bulk, file transfer and Arcade.** The how-tos and FAQs now use the labels on screen (the old file transfer steps named a button and a chunk size setting that no longer exist), and the bulk FAQ gives the 500-row limit.
- **Guides.** The five guides under `/guides` were checked and left as they are: they are short for their subject, cite their sources and match the app. Each one is now linked from at least three tool pages ([#1309](https://github.com/fderuiter/QRCraftly-web/issues/1309)).

Still to do:

- The Acknowledgements page.
- A human read-through for voice. A WCAG 2.2 AA check with a keyboard, a screen reader and real phones is tracked in [#1057](https://github.com/fderuiter/QRCraftly-web/issues/1057).
