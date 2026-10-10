#!/usr/bin/env bash
set -euo pipefail

bash "$(dirname "$0")/install_playwright.sh" chromium
# The tests tagged @prod (#1228): the page loads, the CSP holds, a code downloads, the scanner reads
# with its self-hosted decoder, and file transfers complete in both formats, all on the deployed site.
# production-headers.spec.ts (#1353) also checks the headers the host really sends and that the
# deployed files match the build (set EXPECTED_COMMIT or EXPECTED_VERSION to pin which build).
pnpm exec playwright test --grep @prod --project=chromium --project=chromium-csp
