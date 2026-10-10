#!/usr/bin/env bash
set -euo pipefail

# Waits until a Cloudflare Workers Builds deployment serves the expected build.
# Cloudflare builds and deploys on its own after a push, so smoke tests must not
# start until /version.json (written by scripts/write_build_info.js) reports the
# commit or release being verified.
#
# On timeout it prints the last response it got: the HTTP status, the caching and
# routing headers, and the first bytes of the body, so a failure says whether the
# host served an old build, a cached copy, an error or a challenge page (#1394).
#
# Env:
#   BASE_URL          Environment to poll, e.g. https://qrcraftly.com
#   EXPECTED_COMMIT   Full commit SHA to wait for (optional)
#   EXPECTED_VERSION  package.json version to wait for, without "v" (optional)
#   TIMEOUT_SECONDS   How long to wait before failing (default 900)
#   POLL_SECONDS      Pause between polls (default 20)

: "${BASE_URL:?BASE_URL is required}"
if [ -z "${EXPECTED_COMMIT:-}" ] && [ -z "${EXPECTED_VERSION:-}" ]; then
  echo "Set EXPECTED_COMMIT or EXPECTED_VERSION" >&2
  exit 1
fi

TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-900}"
POLL_SECONDS="${POLL_SECONDS:-20}"
BODY_PREVIEW_BYTES=512
DIAGNOSTIC_HEADERS='cf-cache-status|age|date|server|cf-ray|content-type|cache-control|location'
deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
body_file="$work_dir/body"
header_file="$work_dir/headers"
error_file="$work_dir/curl-error"

# Prints one field of the JSON body, or nothing when the body is not JSON.
json_field() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s)[process.argv[1]]||''))}catch{}})" "$1" <"$body_file"
}

# The header block of the final response (curl -L writes one block per redirect hop).
last_response_headers() {
  awk '/^HTTP\//{block=""} {sub(/\r$/,""); block=block $0 "\n"} END{printf "%s", block}' "$header_file"
}

print_diagnostics() {
  echo "Last response from $url:"
  if [ "$status" = "000" ]; then
    echo "  No HTTP response. curl said: $(tr -d '\r' <"$error_file" | tr '\n' ' ')"
    return
  fi
  echo "  HTTP status: $status"
  local headers
  headers=$(last_response_headers | grep -iE "^(${DIAGNOSTIC_HEADERS}):" || true)
  if [ -n "$headers" ]; then
    printf '%s\n' "$headers" | sed 's/^/  /'
  else
    echo "  (none of these headers were sent: ${DIAGNOSTIC_HEADERS//|/, })"
  fi
  echo "  First ${BODY_PREVIEW_BYTES} bytes of the body:"
  head -c "$BODY_PREVIEW_BYTES" "$body_file" | sed 's/^/  | /'
  echo
}

while :; do
  url="${BASE_URL%/}/version.json?ts=$(date +%s)"
  : >"$body_file"
  : >"$header_file"
  status=$(curl -sS -L --max-time 15 \
    -o "$body_file" -D "$header_file" -w '%{http_code}' "$url" 2>"$error_file" || true)
  status="${status:-000}"
  commit=""
  version=""
  if [ "$status" = "200" ]; then
    commit=$(json_field commit)
    version=$(json_field version)
  fi

  if { [ -z "${EXPECTED_COMMIT:-}" ] || [ "$commit" = "$EXPECTED_COMMIT" ]; } &&
     { [ -z "${EXPECTED_VERSION:-}" ] || [ "$version" = "$EXPECTED_VERSION" ]; }; then
    echo "$BASE_URL is serving v${version} (${commit})"
    exit 0
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error title=Production did not serve the expected build::Timed out after ${TIMEOUT_SECONDS}s: $BASE_URL serves version='${version:-none}' commit='${commit:-none}' (HTTP $status), expected version='${EXPECTED_VERSION:-any}' commit='${EXPECTED_COMMIT:-any}'"
    print_diagnostics >&2
    exit 1
  fi

  echo "Waiting for $BASE_URL (HTTP $status, currently version='${version:-none}' commit='${commit:-none}')..."
  sleep "$POLL_SECONDS"
done
