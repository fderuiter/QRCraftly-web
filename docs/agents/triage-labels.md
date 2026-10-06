# Triage Labels

Every open issue carries exactly one type label and one area label. Once triaged it also carries one triage role. A priority label is optional.

## Type

| Label           | Use for                                             |
| --------------- | --------------------------------------------------- |
| `bug`           | Something is broken or behaves wrongly              |
| `enhancement`   | A new feature or an improvement people will notice  |
| `refactor`      | An internal change with no change in behaviour      |
| `documentation` | Docs, records and checklists                        |
| `ci`            | CI workflows and the release process                |
| `spec`          | An umbrella issue; its work lives in its sub-issues |

## Area

| Label                | Covers                                                     |
| -------------------- | ---------------------------------------------------------- |
| `area:generator`     | Making, styling, checking and exporting QR codes           |
| `area:scanner`       | The camera and image scanner and its decoder               |
| `area:file-transfer` | Prism animated-QR transfer and the Optical colour modem    |
| `area:arcade`        | The Arcade games                                           |
| `area:edge`          | Hosting on Cloudflare, headers, CSP and the service worker |
| `area:docs`          | Documentation                                              |
| `area:ci`            | Tests, lint, build tooling and release automation          |
| `area:a11y`          | Accessibility                                              |
| `area:ui`            | Shared UI components, design tokens and brand assets       |
| `area:seo`           | Search engines, listings and structured data               |

## Priority

`priority:P1` is worked first and `priority:P2` next. An issue with no priority label waits until there is capacity.

## Triage roles

The skills speak in terms of five canonical triage roles. This table maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

The bug and feature issue templates apply `needs-triage` and their type label (`bug` or `enhancement`) to every new issue; triage adds the area.

## Conventions

- **`ready-for-human`** issues are assigned to the maintainer (`fderuiter`). They need something only a person can do, such as a decision, an account or a real device.
- **Specs** link their work as native GitHub sub-issues. Once triaged a spec carries no triage role; each sub-issue carries its own. Record issues, such as a pause checkpoint, carry no triage role either.
- **Order** between issues is recorded with GitHub's native "blocked by" dependencies (see [issue-tracker.md](./issue-tracker.md#wayfinding-operations)), not only in prose. An agent picks a `ready-for-agent` issue only when it has no open blocker.
- **Dependabot** applies `dependencies`, `github_actions` and `javascript` to its own pull requests. Issues do not use them.
