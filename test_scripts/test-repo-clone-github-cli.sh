#!/bin/bash
# Test: GitHub repo replication via CLI
# Uses the small public repo octocat/Hello-World (1 file)

set -e

DEST_PATH="test-repo-clone/github-$(date +%s)"
echo "=== Test 1: Clone public GitHub repo (default branch) ==="
npx ts-node src/index.ts repo clone-github --repo octocat/Hello-World --dest "$DEST_PATH" --json

echo ""
echo "=== Test 2: Clone public GitHub repo (specific ref) ==="
DEST_PATH2="test-repo-clone/github-ref-$(date +%s)"
npx ts-node src/index.ts repo clone-github --repo octocat/Hello-World --ref master --dest "$DEST_PATH2" --json

echo ""
echo "=== Test 3: Missing --repo should fail ==="
npx ts-node src/index.ts repo clone-github --dest "test-path" --json || echo "Expected failure: exit code $?"

echo ""
echo "=== Test 4: Nonexistent repo should fail ==="
npx ts-node src/index.ts repo clone-github --repo "nonexistent-user-xyz/nonexistent-repo-abc" --dest "test-path" --json || echo "Expected failure: exit code $?"

echo ""
echo "=== All GitHub CLI tests completed ==="
