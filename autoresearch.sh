#!/usr/bin/env bash
#
# Benchmark script for opencode-warcraft autoresearch
# Measures total build+test time as the primary metric
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get milliseconds since epoch
ms_now() {
  # macOS compatible way to get milliseconds
  if [[ $(uname) == "Darwin" ]]; then
    # macOS: use python or perl for milliseconds
    python3 -c 'import time; print(int(time.time() * 1000))'
  else
    # Linux: use date with %N
    date +%s%3N
  fi
}

echo -e "${BLUE}=== opencode-warcraft Autoresearch Benchmark ===${NC}\n"

# Clean any existing dist/build artifacts
echo -e "${YELLOW}Cleaning build artifacts...${NC}"
bun run clean 2>/dev/null || rm -rf packages/*/dist
echo "Clean complete\n"

echo -e "${BLUE}=== Running Full Build ===${NC}"
BUILD_START=$(ms_now)
bun run build > /tmp/build-$$.log 2>&1
BUILD_EXIT_CODE=$?
BUILD_END=$(ms_now)
BUILD_MS=$((BUILD_END - BUILD_START))

if [ $BUILD_EXIT_CODE -ne 0 ]; then
  echo -e "${RED}BUILD FAILED${NC}"
  cat /tmp/build-$$.log
  exit 1
fi

BUILD_SEC=$(echo "scale=2; $BUILD_MS / 1000" | bc)
echo -e "${GREEN}✓ Build completed in ${BUILD_MS}ms (${BUILD_SEC}s)${NC}\n"

echo -e "${BLUE}=== Running Full Test Suite ===${NC}"
TEST_START=$(ms_now)
bun run test > /tmp/test-$$.log 2>&1
TEST_EXIT_CODE=$?
TEST_END=$(ms_now)
TEST_MS=$((TEST_END - TEST_START))

if [ $TEST_EXIT_CODE -ne 0 ]; then
  echo -e "${RED}TESTS FAILED${NC}"
  cat /tmp/test-$$.log
  exit 1
fi

# Extract test count from output
TEST_COUNT=$(grep -oE 'Ran [0-9]+ tests' /tmp/test-$$.log | grep -oE '[0-9]+' | head -1 || echo "unknown")

TEST_SEC=$(echo "scale=2; $TEST_MS / 1000" | bc)
echo -e "${GREEN}✓ Tests completed in ${TEST_MS}ms (${TEST_SEC}s)${NC}\n"

# Calculate total
TOTAL_MS=$((BUILD_MS + TEST_MS))
TOTAL_SEC=$(echo "scale=2; $TOTAL_MS / 1000" | bc)

# Output results
echo -e "${BLUE}=== Benchmark Results ===${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  %-20s %12s %10s\n" "Component" "Time (ms)" "Time (s)"
echo "────────────────────────────────────────"
printf "  %-20s %12s %10s\n" "Build" "$BUILD_MS" "$BUILD_SEC"
printf "  %-20s %12s %10s\n" "Tests ($TEST_COUNT)" "$TEST_MS" "$TEST_SEC"
echo "────────────────────────────────────────"
printf "  %-20s %12s %10s\n" "Total" "$TOTAL_MS" "$TOTAL_SEC"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Output metric for autoresearch
echo ""
echo -e "${GREEN}METRIC=${TOTAL_MS}${NC}"

# Cleanup
rm -f /tmp/build-$$.log /tmp/test-$$.log

# Exit with success
exit 0
