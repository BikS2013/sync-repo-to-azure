#!/bin/bash
# Test: repo sync API endpoint
# Tests sync pair configuration via the REST API
# Requires the API server to be running (npm run api or similar)
#
# Usage: ./test_scripts/test-sync-pair-api.sh [base_url]
# Example: ./test_scripts/test-sync-pair-api.sh http://localhost:3000

BASE="${1:-http://localhost:3000}"

PASS_COUNT=0
FAIL_COUNT=0
TOTAL=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  TOTAL=$((TOTAL + 1))
  echo "  PASS"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  TOTAL=$((TOTAL + 1))
  echo "  FAIL - $1"
}

# Check that the API server is reachable
echo "Checking API server at $BASE ..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health" 2>/dev/null)
if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: API server not reachable at $BASE (HTTP $HTTP_CODE)"
  echo "Start the server first (e.g., npm run api) and retry."
  exit 1
fi
echo "API server is up."
echo ""

# ---------------------------------------------------------------------------
echo "=== Test 1: Missing body should return 400 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d '{}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [ "$HTTP_CODE" = "400" ]; then
  pass
else
  fail "Expected HTTP 400, got $HTTP_CODE"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 2: Empty syncPairs array should return 400 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d '{"syncPairs": []}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [ "$HTTP_CODE" = "400" ]; then
  if echo "$BODY" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
    pass
  else
    fail "Expected REPO_INVALID_SYNC_CONFIG error code"
  fi
else
  fail "Expected HTTP 400, got $HTTP_CODE"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 3: Invalid platform should return 400 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "bad-platform",
      "platform": "bitbucket",
      "source": { "repo": "owner/repo" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/test",
        "sasToken": "sv=2022-11-02"
      }
    }
  ]
}
HEREDOC
)")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected HTTP 400 with REPO_INVALID_SYNC_CONFIG, got HTTP $HTTP_CODE"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 4: Missing required fields (no name) should return 400 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'HEREDOC'
{
  "syncPairs": [
    {
      "platform": "github",
      "source": { "repo": "octocat/Hello-World" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/test",
        "sasToken": "sv=2022-11-02"
      }
    }
  ]
}
HEREDOC
)")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected HTTP 400 with REPO_INVALID_SYNC_CONFIG, got HTTP $HTTP_CODE"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 5: Missing source object should return 400 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "no-source",
      "platform": "github",
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/test",
        "sasToken": "sv=2022-11-02"
      }
    }
  ]
}
HEREDOC
)")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected HTTP 400 with REPO_INVALID_SYNC_CONFIG, got HTTP $HTTP_CODE"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 6: Missing destination fields (no sasToken) should return 400 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "no-sas",
      "platform": "github",
      "source": { "repo": "octocat/Hello-World" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/test"
      }
    }
  ]
}
HEREDOC
)")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected HTTP 400 with REPO_INVALID_SYNC_CONFIG, got HTTP $HTTP_CODE"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 7: Duplicate sync pair names should return 400 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "dup-name",
      "platform": "github",
      "source": { "repo": "octocat/Hello-World" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/test1",
        "sasToken": "sv=2022-11-02"
      }
    },
    {
      "name": "dup-name",
      "platform": "github",
      "source": { "repo": "octocat/Spoon-Knife" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/test2",
        "sasToken": "sv=2022-11-02"
      }
    }
  ]
}
HEREDOC
)")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected HTTP 400 with REPO_INVALID_SYNC_CONFIG, got HTTP $HTTP_CODE"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 8: Invalid GitHub repo format should return 400 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "bad-repo-format",
      "platform": "github",
      "source": { "repo": "not-a-valid-format" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/test",
        "sasToken": "sv=2022-11-02"
      }
    }
  ]
}
HEREDOC
)")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected HTTP 400 with REPO_INVALID_SYNC_CONFIG, got HTTP $HTTP_CODE"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 9: DevOps pair missing PAT should return 400 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "devops-no-pat",
      "platform": "azure-devops",
      "source": {
        "organization": "myorg",
        "project": "myproject",
        "repository": "myrepo"
      },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/devops-test",
        "sasToken": "sv=2022-11-02"
      }
    }
  ]
}
HEREDOC
)")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected HTTP 400 with REPO_INVALID_SYNC_CONFIG, got HTTP $HTTP_CODE"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 10: Valid config with dummy credentials - sync attempted ==="
# Structurally valid config with fake Azure credentials.
# Should pass validation (no 400) and attempt sync, which will fail
# with an auth/connection error (not a validation error).
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/repo/sync" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "hello-world-sync",
      "platform": "github",
      "source": {
        "repo": "octocat/Hello-World"
      },
      "destination": {
        "accountUrl": "https://fakeaccount.blob.core.windows.net",
        "container": "fakecontainer",
        "folder": "repos/hello-world",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlac&se=2099-01-01"
      }
    }
  ]
}
HEREDOC
)")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
# Should NOT get 400 (validation passed). Expect 500 or 207 (replication failed due to fake creds)
if [ "$HTTP_CODE" = "400" ]; then
  fail "Config was structurally valid but got HTTP 400 (validation should have passed)"
else
  echo "  Got HTTP $HTTP_CODE (expected non-400 since config validation passed)"
  pass
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 11: Check Swagger lists the /sync endpoint ==="
SWAGGER_RESPONSE=$(curl -s "$BASE/api/docs.json" 2>/dev/null)
if echo "$SWAGGER_RESPONSE" | jq -e '.paths["/api/v1/repo/sync"]' > /dev/null 2>&1; then
  echo "  /api/v1/repo/sync found in Swagger spec"
  pass
else
  echo "$SWAGGER_RESPONSE" | jq '.paths | keys[] | select(contains("repo"))' 2>/dev/null
  fail "Expected /api/v1/repo/sync in Swagger spec"
fi

# ---------------------------------------------------------------------------
echo ""
echo "==========================================="
echo "  API Sync Pair Test Summary"
echo "==========================================="
echo "  Base URL: $BASE"
echo "  Total:    $TOTAL"
echo "  Passed:   $PASS_COUNT"
echo "  Failed:   $FAIL_COUNT"
echo "==========================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
