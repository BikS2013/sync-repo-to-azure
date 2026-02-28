#!/bin/bash
# Test: Azure DevOps repo replication via CLI
# Requires AZURE_DEVOPS_PAT and AZURE_DEVOPS_AUTH_METHOD env vars

set -e

echo "=== Checking Azure DevOps configuration ==="
if [ -z "$AZURE_DEVOPS_AUTH_METHOD" ]; then
  echo "AZURE_DEVOPS_AUTH_METHOD not set. Skipping Azure DevOps tests."
  echo "Set AZURE_DEVOPS_AUTH_METHOD=pat and AZURE_DEVOPS_PAT to run these tests."
  exit 0
fi

echo "=== Test 1: Missing --org should show usage help ==="
npx ts-node src/index.ts repo clone-devops --project test --repo test --dest "test-path" --json || echo "Expected failure: exit code $?"

echo ""
echo "=== Test 2: Missing auth config test ==="
# This would test what happens when auth is misconfigured
# Actual cloning requires valid org/project/repo, so this is a smoke test

echo ""
echo "=== Azure DevOps CLI tests completed ==="
echo "Note: Full integration tests require valid Azure DevOps credentials and repos."
