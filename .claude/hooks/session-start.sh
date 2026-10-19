#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: installs what `pnpm run lint`, `pnpm test`,
# `pnpm build`, `pnpm test:e2e`, the Rust checks and Semgrep need. It does nothing on a local
# machine. Every step is idempotent, and the container is cached once the hook finishes.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
ENV_FILE="${CLAUDE_ENV_FILE:-/dev/null}"

# Node: the image ships an older 22.x than .nvmrc pins, so install the pinned one with nvm.
want_node="$(tr -d '[:space:]' < .nvmrc)"
if [ "$(node -v 2>/dev/null)" != "v${want_node}" ] && [ -s /opt/nvm/nvm.sh ]; then
  export NVM_DIR=/opt/nvm
  # shellcheck source=/dev/null
  . /opt/nvm/nvm.sh --no-use
  nvm install "$want_node" > /dev/null
  node_bin="$(dirname "$(nvm which "$want_node")")"
  export PATH="${node_bin}:${PATH}"
  echo "export PATH=\"${node_bin}:\$PATH\"" >> "$ENV_FILE"
fi
echo "node $(node -v), pnpm $(pnpm -v)"

# Dependencies, exactly as CI installs them. Also installs the repo's git hooks (prepare).
# Hook stdout goes into the session's context, so keep the log in a file and print it on failure.
install_log="${HOME}/.cache/qrcraftly-pnpm-install.log"
mkdir -p "$(dirname "$install_log")"
pnpm install --frozen-lockfile > "$install_log" 2>&1 || { tail -40 "$install_log" >&2; exit 1; }

# Playwright: the image's Chromium build is older than the one @playwright/test expects, and
# `playwright install` must not run here. Point the expected build directories at it instead.
pw_core="$(node -e "const p=require('path');console.log(p.dirname(require.resolve('playwright-core/package.json',{paths:[require.resolve('@playwright/test')]})))")"
pw_rev="$(node -e "console.log(require(process.argv[1]).browsers.find(b=>b.name==='chromium').revision)" "${pw_core}/browsers.json")"
have_rev=""
[ -d /opt/pw-browsers ] && have_rev="$(find /opt/pw-browsers -maxdepth 1 -name 'chromium-*' -printf '%f\n' | sed 's/^chromium-//' | sort -n | tail -1)"
if [ -n "$have_rev" ]; then
  shim="${HOME}/.cache/qrcraftly-pw-shim"
  mkdir -p "${shim}/chromium-${pw_rev}/chrome-linux64" "${shim}/chromium_headless_shell-${pw_rev}/chrome-headless-shell-linux64"
  ln -sf "/opt/pw-browsers/chromium-${have_rev}/chrome-linux/chrome" "${shim}/chromium-${pw_rev}/chrome-linux64/chrome"
  ln -sf "/opt/pw-browsers/chromium_headless_shell-${have_rev}/chrome-linux/headless_shell" \
    "${shim}/chromium_headless_shell-${pw_rev}/chrome-headless-shell-linux64/chrome-headless-shell"
  touch "${shim}/chromium-${pw_rev}/INSTALLATION_COMPLETE" "${shim}/chromium_headless_shell-${pw_rev}/INSTALLATION_COMPLETE"
  echo "export PLAYWRIGHT_BROWSERS_PATH=\"${shim}\"" >> "$ENV_FILE"
fi

# Rust: crates/rust-toolchain.toml pins the toolchain, wasm target, rustfmt and clippy.
if command -v rustup > /dev/null; then
  (cd crates && rustup toolchain install > /dev/null)
fi

# Semgrep (CI's Static Validation job) in its own virtualenv, from the hash-pinned requirements.
semgrep_venv="${HOME}/.cache/qrcraftly-semgrep"
if ! "${semgrep_venv}/bin/semgrep" --version > /dev/null 2>&1; then
  python3 -m venv "$semgrep_venv"
  "${semgrep_venv}/bin/pip" install -q --require-hashes -r requirements.txt
fi
# Only semgrep goes on PATH, so the venv's python3 does not shadow the system one.
tool_bin="${HOME}/.cache/qrcraftly-bin"
mkdir -p "$tool_bin"
ln -sf "${semgrep_venv}/bin/semgrep" "${tool_bin}/semgrep"
echo "export PATH=\"${tool_bin}:\$PATH\"" >> "$ENV_FILE"

# ShellCheck (also run by the Static Validation job). Best effort: apt may be unavailable.
if ! command -v shellcheck > /dev/null; then
  apt-get install -y -qq shellcheck > /dev/null 2>&1 ||
    { apt-get update -qq > /dev/null 2>&1 && apt-get install -y -qq shellcheck > /dev/null 2>&1; } ||
    echo "shellcheck could not be installed; skipping it."
fi

echo "QRCraftly session setup done."
