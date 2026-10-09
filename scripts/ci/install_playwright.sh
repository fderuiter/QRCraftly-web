#!/usr/bin/env bash
set -euo pipefail

# Installs Playwright's system libraries and browsers in CI, each under a time limit with retries.
# The browsers come from ~/.cache/ms-playwright when the setup action restored it. The system
# libraries always come from apt (WebKit and Firefox need packages the runner image lacks), and an
# apt mirror can stall: on 2026-10-09 it took 26m45s instead of about a minute and ran E2E out of time.
# Usage: install_playwright.sh [browser ...]   (no browser installs all of them)

ATTEMPTS="${PLAYWRIGHT_INSTALL_ATTEMPTS:-3}"
ATTEMPT_SECONDS="${PLAYWRIGHT_INSTALL_ATTEMPT_SECONDS:-240}"

# Give up on a dead mirror connection quickly so the attempt limit is spent on retries.
echo 'Acquire::Retries "3"; Acquire::http::Timeout "30"; Acquire::https::Timeout "30";' |
  sudo tee /etc/apt/apt.conf.d/80-playwright-ci >/dev/null

retry() {
  local attempt
  for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
    if timeout --kill-after=15 "$ATTEMPT_SECONDS" "$@"; then
      return 0
    fi
    echo "::warning::'$*' failed or timed out (attempt $attempt of $ATTEMPTS)"
    # A killed apt run can leave dpkg half configured; repair it before the next attempt.
    sudo dpkg --configure -a || true
  done
  return 1
}

retry pnpm exec playwright install-deps "$@"
retry pnpm exec playwright install "$@"
