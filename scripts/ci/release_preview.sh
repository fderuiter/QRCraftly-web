#!/usr/bin/env bash
set -euo pipefail

# Previews the next release without making it (#1217): runs `pnpm run release:dry-run` and writes
# the next version, whether a release is due, and the changelog section it would add to the
# workflow run summary. It changes no file, opens no PR and pushes no tag.
#
# A release is due when main has user-visible commits since the last tag: a breaking change, a
# feature or a fix (see RELEASING.md, "Release cadence").
#
# Env:
#   GITHUB_STEP_SUMMARY  File the summary is appended to (set by GitHub Actions; defaults to stdout)
#   RELEASE_PREVIEW_INPUT  Read a saved dry-run output from this file instead of running it (tests)

summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
preview=$(mktemp)
trap 'rm -f "$preview"' EXIT

if [ -n "${RELEASE_PREVIEW_INPUT:-}" ]; then
  cp "$RELEASE_PREVIEW_INPUT" "$preview"
else
  pnpm run --silent release:dry-run >"$preview"
fi
cat "$preview"

# Value of a "   Label:   value" line in the dry-run header.
field() {
  sed -n "s/^ *$1: *//p" "$preview" | head -n 1
}

# The changelog section, printed between two lines of 60 dashes.
section=$(awk '/^-{60}$/ { n++; next } n == 1' "$preview")

latest_tag=$(field 'Latest tag')
next_version=$(field 'Next version')
commits=$(field 'Commits')

if [ -z "$next_version" ] || [ -z "$section" ]; then
  echo "::error::Could not read the next version or changelog from release:dry-run." >&2
  exit 1
fi

if grep -qE '^### (Breaking Changes|Features|Bug Fixes)$' <<<"$section"; then
  due="Yes: there are user-visible changes since ${latest_tag}."
else
  due="No: nothing user-visible since ${latest_tag}."
fi

{
  echo "## Release preview: ${next_version}"
  echo
  echo "| Field | Value |"
  echo "| --- | --- |"
  echo "| Latest tag | \`${latest_tag}\` |"
  echo "| Next version | \`${next_version}\` |"
  echo "| Commits | ${commits} |"
  echo "| Release due | ${due} |"
  echo
  echo "### Changelog it would add"
  echo
  # Demote the section's headings one level so they sit under this summary's headings.
  sed 's/^## /#### /; s/^### \([A-Z]\)/##### \1/' <<<"$section"
  echo
  echo "Nothing was tagged or published. To release, run \`pnpm run release:prepare\` on an up-to-date \`main\` (see RELEASING.md)."
} >>"$summary"
