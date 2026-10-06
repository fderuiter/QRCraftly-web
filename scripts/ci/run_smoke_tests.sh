#!/usr/bin/env bash
set -euo pipefail

pnpm exec playwright install --with-deps chromium
# The tests tagged @prod (#1228): the page loads, the CSP holds, a code downloads, the scanner reads
# with its self-hosted decoder, and file transfers complete in both formats, all on the deployed site.
pnpm exec playwright test --grep @prod --project=chromium --project=chromium-csp
