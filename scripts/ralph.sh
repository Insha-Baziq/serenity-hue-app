#!/usr/bin/env bash
set -euo pipefail

PROMPT_FILE="${1:-prompts/implement.md}"
ISSUES_DIR="${2:-issues}"
MAX_ITERATIONS="${MAX_ITERATIONS:-20}"
CMD="${AGENT_CMD:-codex exec}"
PERM_FLAG="${AGENT_PERM_FLAG:---full-auto}"

if [ ! -f "$PROMPT_FILE" ]; then echo "prompt file not found: $PROMPT_FILE" >&2; exit 1; fi
if [ -n "$(git status --porcelain)" ]; then echo "working tree is dirty" >&2; exit 1; fi

iteration=0
while [ "$iteration" -lt "$MAX_ITERATIONS" ]; do
  iteration=$((iteration + 1))
  issues=$(cat "$ISSUES_DIR"/*.md 2>/dev/null || true)
  commits=$(git log --oneline -10)
  prompt=$(cat "$PROMPT_FILE")
  result=$($CMD $PERM_FLAG <<EOF
$prompt

## Open issues
$issues

## Recent commits
$commits
EOF
)
  echo "$result" | tail -n 40
  if echo "$result" | grep -qx "NO_MORE_TASKS"; then break; fi
done
