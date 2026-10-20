#!/usr/bin/env bash
# Build the Ron repair replica image (deploy/repair-replica/Dockerfile) from the current Ron
# checkout and the sibling electron-playwright-mcp checkout.
#
# The build context holds `git archive` exports of both repositories (committed files only): no
# node_modules, venv, .env, SDK clone or build output is ever copied into the image. The tag pins
# both commits, so the same (Ron, MCP) pair always yields the same image name; the hashes of the
# archives are recorded as labels for provenance.
#
#   bash deploy/repair-replica/build.sh                 # ron-repair-replica:<ron-sha>-<mcp-sha>
#   RON_REPLICA_BASE=ubuntu:26.04 bash deploy/repair-replica/build.sh
#   RON_REPLICA_PLATFORM=linux/amd64 bash deploy/repair-replica/build.sh   # for the x86 VPS
#
# Then: RON_TOOL_REPAIR_SANDBOX_IMAGE=ron-repair-replica:<tag> in .env / ron.env.
set -euo pipefail

RON_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MCP_ROOT="${RON_MCP_ROOT:-$(cd "$RON_ROOT/.." && pwd)/electron-playwright-mcp}"
BASE_IMAGE="${RON_REPLICA_BASE:-ubuntu:24.04}"
PLATFORM="${RON_REPLICA_PLATFORM:-}"
IMAGE_NAME="${RON_REPLICA_IMAGE:-ron-repair-replica}"

log() { printf '[replica] %s\n' "$*" >&2; }

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
[ -d "$MCP_ROOT/.git" ] || { echo "electron-playwright-mcp checkout not found at $MCP_ROOT (set RON_MCP_ROOT)" >&2; exit 1; }

ron_sha="$(git -C "$RON_ROOT" rev-parse --short=12 HEAD)"
mcp_sha="$(git -C "$MCP_ROOT" rev-parse --short=12 HEAD)"
if [ -n "$(git -C "$RON_ROOT" status --porcelain)" ]; then
  log "warning: Ron worktree is dirty; the image contains COMMITTED files only (${ron_sha})"
fi
tag="${IMAGE_NAME}:${ron_sha}-${mcp_sha}"

context="$(mktemp -d "${TMPDIR:-/tmp}/ron-replica.XXXXXX")"
trap 'rm -rf "$context"' EXIT
log "exporting sources into $context"
mkdir -p "$context/RonBrowserRebuild" "$context/electron-playwright-mcp"
git -C "$RON_ROOT" archive --format=tar HEAD | tar -x -C "$context/RonBrowserRebuild"
git -C "$MCP_ROOT" archive --format=tar HEAD | tar -x -C "$context/electron-playwright-mcp"
cp "$RON_ROOT/deploy/repair-replica/Dockerfile" "$context/Dockerfile"

ron_digest="$(tar -C "$context/RonBrowserRebuild" -cf - . | shasum -a 256 | cut -d' ' -f1)"
mcp_digest="$(tar -C "$context/electron-playwright-mcp" -cf - . | shasum -a 256 | cut -d' ' -f1)"

args=(build --file "$context/Dockerfile" --tag "$tag"
      --build-arg "BASE_IMAGE=$BASE_IMAGE" --build-arg "RON_SHA=$ron_sha" --build-arg "MCP_SHA=$mcp_sha"
      --label "ron.replica.ron_tree_sha256=$ron_digest" --label "ron.replica.mcp_tree_sha256=$mcp_digest"
      --label "ron.replica.base=$BASE_IMAGE")
if [ -n "$PLATFORM" ]; then
  args+=(--platform "$PLATFORM")
fi
log "docker ${args[*]} $context"
docker "${args[@]}" "$context"
log "built $tag"
printf '%s\n' "$tag"
