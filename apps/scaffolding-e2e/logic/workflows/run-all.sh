#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=()
FAIL=()

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Run from the logic/ directory so relative paths in YAMLs (res/, etc.) resolve correctly
cd "$SCRIPT_DIR/.."

WORKFLOWS=($(ls "$SCRIPT_DIR"/*.yml | sort))

echo ""
echo "Running ${#WORKFLOWS[@]} workflows from $SCRIPT_DIR"
echo "=================================================="

for wf in "${WORKFLOWS[@]}"; do
  name="$(basename "$wf")"
  echo ""
  echo -e "${YELLOW}▶ $name${NC}"
  echo "--------------------------------------------------"

  if merobox bootstrap run "$wf"; then
    PASS+=("$name")
    echo -e "${GREEN}✓ $name passed${NC}"
  else
    FAIL+=("$name")
    echo -e "${RED}✗ $name FAILED${NC}"
  fi
done

echo ""
echo "=================================================="
echo "Results: ${#PASS[@]} passed, ${#FAIL[@]} failed"
echo ""

if [ ${#PASS[@]} -gt 0 ]; then
  echo -e "${GREEN}Passed:${NC}"
  for w in "${PASS[@]}"; do echo "  ✓ $w"; done
fi

if [ ${#FAIL[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}Failed:${NC}"
  for w in "${FAIL[@]}"; do echo "  ✗ $w"; done
  echo ""
  exit 1
fi

echo ""
