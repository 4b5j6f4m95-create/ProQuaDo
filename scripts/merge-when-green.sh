#!/usr/bin/env bash
#
# Mergt einen Pull Request erst, wenn alle CI-Checks grün sind.
#
#   scripts/merge-when-green.sh 3
#
# Warum es dieses Skript gibt: `gh pr merge --auto` klingt so, als würde es
# warten, tut das aber nur, wenn das Repository erforderliche Statuschecks
# kennt. Branch Protection und Rulesets sind bei GitHub für private
# Repositories dem Pro-Plan vorbehalten — in diesem Repository greift also
# keine serverseitige Bremse, und `--auto` mergt sofort. Genau so ist PR #3
# vor seinen eigenen Checks gelandet.
#
# Solange das so bleibt, ist dies die Bremse: sie fragt nach, statt sich auf
# das Erinnern zu verlassen. Sobald Branch Protection eingerichtet ist, darf
# das Skript weg.

set -euo pipefail

PR="${1:-}"
if [ -z "$PR" ]; then
  echo "Aufruf: $0 <PR-Nummer> [Merge-Optionen…]" >&2
  exit 64
fi
shift || true
MERGE_ARGS=("$@")
if [ ${#MERGE_ARGS[@]} -eq 0 ]; then
  MERGE_ARGS=(--rebase --delete-branch)
fi

# Die Jobs aus .github/workflows/ci.yml. Ausdrücklich aufgezählt, damit ein
# Lauf, der einen Job gar nicht erst startet, nicht als „alles grün" durchgeht
# — genau das passiert, wenn eine frühe Stufe scheitert und die abhängigen
# Jobs übersprungen werden.
EXPECTED_CHECKS=5
POLL_SECONDS="${POLL_SECONDS:-20}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-2400}"

echo "Warte auf die Checks von PR #${PR} (erwartet: ${EXPECTED_CHECKS})…"

waited=0
while :; do
  checks="$(gh pr checks "$PR" --json name,bucket 2>/dev/null || echo '[]')"
  total="$(echo "$checks" | jq 'length')"
  pending="$(echo "$checks" | jq '[.[] | select(.bucket == "pending")] | length')"
  failing="$(echo "$checks" | jq -r '[.[] | select(.bucket != "pass" and .bucket != "pending" and .bucket != "skipping")] | .[] | "\(.name): \(.bucket)"')"

  if [ -n "$failing" ]; then
    echo "Nicht gemergt — diese Checks sind nicht grün:" >&2
    echo "$failing" >&2
    exit 1
  fi

  if [ "$total" -ge "$EXPECTED_CHECKS" ] && [ "$pending" -eq 0 ]; then
    break
  fi

  if [ "$waited" -ge "$TIMEOUT_SECONDS" ]; then
    echo "Nicht gemergt — nach ${TIMEOUT_SECONDS}s waren ${pending} Checks offen (${total}/${EXPECTED_CHECKS} gemeldet)." >&2
    exit 1
  fi

  sleep "$POLL_SECONDS"
  waited=$((waited + POLL_SECONDS))
done

echo "Alle ${EXPECTED_CHECKS} Checks grün. Merge:"
gh pr merge "$PR" "${MERGE_ARGS[@]}"
