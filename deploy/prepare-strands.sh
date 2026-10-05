#!/usr/bin/env bash
# Prepare the exact GitHub SDK source used by both text and Live agents.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="$ROOT/agent/api/core/harness-sdk"
REVISION=563f57d7a387931760a2c3106014cd7c0db4c9bc
REMOTE=https://github.com/strands-agents/harness-sdk.git
PATCH="$ROOT/deploy/strands-bidi.patch"
[ -s "$PATCH" ] || { echo "Missing native Bidi patch: $PATCH" >&2; exit 1; }

if [ ! -d "$SDK" ]; then
  git clone --filter=blob:none --no-checkout "$REMOTE" "$SDK"
  git -C "$SDK" sparse-checkout set strands-py team site/src/content/docs/user-guide/sdk/bidi
  git -C "$SDK" checkout --detach "$REVISION"
fi

[ -d "$SDK/.git" ] || { echo "SDK path is not the expected GitHub checkout: $SDK" >&2; exit 1; }
[ "$(git -C "$SDK" remote get-url origin)" = "$REMOTE" ] || { echo "Unexpected SDK origin; refusing to change it" >&2; exit 1; }
[ "$(git -C "$SDK" rev-parse HEAD)" = "$REVISION" ] || { echo "SDK revision differs; preserve this checkout by moving it aside, then rerun. See docs/deploy-vps.md." >&2; exit 1; }

if git -C "$SDK" apply --reverse --check "$PATCH" 2>/dev/null; then
  echo "Native Bidi patch already present"
else
  git -C "$SDK" apply --check "$PATCH" || { echo "SDK patch differs; move the existing checkout aside (do not delete local work), then rerun. See docs/deploy-vps.md." >&2; exit 1; }
  git -C "$SDK" apply "$PATCH"
fi

echo "Strands source ready: $REVISION"
