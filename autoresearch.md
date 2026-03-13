# Autoresearch Configuration

## Project

**opencode-warcraft** - OpenCode plugin for plan-first workflow with AI agents

## Primary Metric

**Total Build+Test Time** (seconds) - The combined time for:
1. Full build: `bun run build`
2. Full test suite: `bun run test`

**Direction**: lower is better

**Why**: This metric directly impacts developer experience and CI/CD pipeline efficiency. Faster builds and tests mean:
- Quicker feedback loops during development
- Faster PR validation in CI
- Lower computational costs

## Baseline

- Build time: ~3.2s
- Test time: ~3.7s
- **Total: ~6.9s**

## Measurement Method

```bash
#!/bin/bash
# autoresearch.sh - Run benchmark and report total time

set -e

echo "=== Running Full Build ==="
BUILD_START=$(date +%s%3N)
bun run build > /dev/null 2>&1
BUILD_END=$(date +%s%3N)
BUILD_MS=$((BUILD_END - BUILD_START))

echo "=== Running Full Test Suite ==="
TEST_START=$(date +%s%3N)
bun run test > /dev/null 2>&1
TEST_END=$(date +%s%3N)
TEST_MS=$((TEST_END - TEST_START))

TOTAL_MS=$((BUILD_MS + TEST_MS))
TOTAL_SEC=$(echo "scale=2; $TOTAL_MS / 1000" | bc)

echo "Build: ${BUILD_MS}ms ($((BUILD_MS / 1000))s)"
echo "Tests: ${TEST_MS}ms ($((TEST_MS / 1000))s)"
echo "Total: ${TOTAL_MS}ms (${TOTAL_SEC}s)"
echo "METRIC=${TOTAL_MS}"
```

## Optimization Opportunities

### High Impact
1. **Parallel test execution optimization** - Bun test runs in parallel, but we can optimize test structure and sharding
2. **TypeScript compilation optimization** - Use incremental builds, optimize tsconfig
3. **Bundle size reduction** - Better tree-shaking, code splitting, remove unused code

### Medium Impact
4. **Skill generation optimization** - Cache skill parsing, incremental generation
5. **Dependency graph computation** - Optimize task dependency resolution in taskDependencyGraph.ts
6. **Service lazy loading** - Defer heavy service initialization until needed

### Low Impact
7. **Build artifact caching** - Use bun's built-in caching more effectively
8. **Test fixture optimization** - Reduce setup/teardown overhead in tests

## Constraints

- Must pass all tests (986 tests)
- Must maintain backward compatibility
- Cannot break OpenCode plugin integration
- Must work with both beadsMode "on" and "off"

## Success Criteria

- 10% improvement: ~6.2s (good win)
- 20% improvement: ~5.5s (significant win)
- 30% improvement: ~4.8s (major win)

## Experiment Notes

- Run each experiment 3 times and use the median to reduce variance
- Check test counts remain at 986 (no tests skipped)
- Verify build output size doesn't increase significantly
- Monitor memory usage during benchmarks

## Ideas Log

*Add promising optimization ideas here as we discover them:*

- [ ] Experiment with Bun's `--smol` flag for smaller bundle
- [ ] Add selective test execution via `--filter` patterns
- [ ] Investigate if TypeScript `incremental: true` helps
- [ ] Profile memory usage during tests to identify bottlenecks
- [ ] Consider test sharding by package for CI parallelism
- [ ] Explore skill content compression or binary encoding
