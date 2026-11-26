#!/usr/bin/env bash
# Snapshot the whole working tree (tracked + untracked, honouring .gitignore) into a dangling commit object WITHOUT
# touching HEAD, branches, the index or the working tree. The hash is appended to .research/checkpoints/LOG.
# Restore one file:  git show <hash>:<path> > <path>      Diff:  git diff <hash> -- <path>
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
name="${1:-checkpoint}"
idx="$(mktemp)"
rm -f "$idx"
GIT_INDEX_FILE="$idx" git add -A . 2>/dev/null
tree="$(GIT_INDEX_FILE="$idx" git write-tree)"
rm -f "$idx"
commit="$(git commit-tree "$tree" -p HEAD -m "checkpoint: $name")"
mkdir -p .research/checkpoints
echo "$(date -Iseconds) $commit $name" >> .research/checkpoints/LOG
echo "$commit"
