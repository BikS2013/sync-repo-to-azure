#!/bin/bash
# Test: GitHub repo replication via REST API
# Requires the API server to be running (npm run api)

API_BASE="${API_BASE:-http://localhost:3000}"
DEST_PATH="test-repo-api/github-$(date +%s)"

echo "=== Test 1: Clone public GitHub repo via API ==="
curl -s -X POST "$API_BASE/api/v1/repo/github" \
  -H "Content-Type: application/json" \
  -d "{\"repo\": \"octocat/Hello-World\", \"destPath\": \"$DEST_PATH\"}" | jq .

echo ""
echo "=== Test 2: Clone with specific ref ==="
DEST_PATH2="test-repo-api/github-ref-$(date +%s)"
curl -s -X POST "$API_BASE/api/v1/repo/github" \
  -H "Content-Type: application/json" \
  -d "{\"repo\": \"octocat/Hello-World\", \"ref\": \"master\", \"destPath\": \"$DEST_PATH2\"}" | jq .

echo ""
echo "=== Test 3: Missing required fields (should return 400) ==="
curl -s -X POST "$API_BASE/api/v1/repo/github" \
  -H "Content-Type: application/json" \
  -d "{\"ref\": \"main\"}" | jq .

echo ""
echo "=== Test 4: Nonexistent repo (should return 404) ==="
curl -s -X POST "$API_BASE/api/v1/repo/github" \
  -H "Content-Type: application/json" \
  -d "{\"repo\": \"nonexistent-user-xyz/nonexistent-repo-abc\", \"destPath\": \"test-path\"}" | jq .

echo ""
echo "=== Test 5: Check Swagger lists new endpoints ==="
curl -s "$API_BASE/api/docs.json" | jq '.paths | keys[] | select(contains("repo"))'

echo ""
echo "=== All GitHub API tests completed ==="
