#!/bin/bash
# Test: Azure DevOps repo replication via REST API
# Requires the API server running AND Azure DevOps credentials configured

API_BASE="${API_BASE:-http://localhost:3000}"

echo "=== Test 1: Missing required fields (should return 400) ==="
curl -s -X POST "$API_BASE/api/v1/repo/devops" \
  -H "Content-Type: application/json" \
  -d "{\"project\": \"test\"}" | jq .

echo ""
echo "=== Test 2: Check endpoint exists in Swagger ==="
curl -s "$API_BASE/api/docs.json" | jq '.paths | keys[] | select(contains("repo"))'

echo ""
echo "=== Azure DevOps API tests completed ==="
echo "Note: Full integration tests require valid Azure DevOps credentials."
