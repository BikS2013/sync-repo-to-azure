#!/bin/bash
# Test: repo sync CLI command
# Tests sync pair configuration loading and validation via CLI
# NOTE: Does not perform actual replication (would need valid Azure credentials)
# Instead, tests config validation and error handling

PASS_COUNT=0
FAIL_COUNT=0
TOTAL=0
TMPDIR=$(mktemp -d)

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

cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
echo "=== Test 1: Missing --sync-config flag and no env var should show error ==="
# With no --sync-config flag and no AZURE_FS_SYNC_CONFIG_PATH, should get CONFIG_MISSING
OUTPUT=$(AZURE_FS_SYNC_CONFIG_PATH= npx ts-node src/index.ts repo sync --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -qi "CONFIG_MISSING\|not provided\|sync-config"; then
  pass
else
  fail "Expected error about missing --sync-config flag"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 2: Config file not found should show CONFIG_FILE_NOT_FOUND ==="
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$TMPDIR/nonexistent.json" --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -q "CONFIG_FILE_NOT_FOUND"; then
  pass
else
  fail "Expected CONFIG_FILE_NOT_FOUND error code"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 3: Invalid JSON content should show CONFIG_FILE_PARSE_ERROR ==="
INVALID_JSON_FILE="$TMPDIR/invalid.json"
cat > "$INVALID_JSON_FILE" <<'HEREDOC'
{ this is not valid json!!!
HEREDOC
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$INVALID_JSON_FILE" --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -q "CONFIG_FILE_PARSE_ERROR"; then
  pass
else
  fail "Expected CONFIG_FILE_PARSE_ERROR error code"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 4: Unsupported file extension should show error ==="
WRONG_EXT_FILE="$TMPDIR/config.txt"
echo '{"syncPairs":[]}' > "$WRONG_EXT_FILE"
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$WRONG_EXT_FILE" --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -qi "CONFIG_INVALID_VALUE\|extension"; then
  pass
else
  fail "Expected error about invalid file extension"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 5: Empty syncPairs array should show REPO_INVALID_SYNC_CONFIG ==="
EMPTY_PAIRS_FILE="$TMPDIR/empty-pairs.json"
cat > "$EMPTY_PAIRS_FILE" <<'HEREDOC'
{
  "syncPairs": []
}
HEREDOC
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$EMPTY_PAIRS_FILE" --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected REPO_INVALID_SYNC_CONFIG error code"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 6: Missing 'syncPairs' key should show REPO_INVALID_SYNC_CONFIG ==="
NO_KEY_FILE="$TMPDIR/no-key.json"
cat > "$NO_KEY_FILE" <<'HEREDOC'
{
  "repos": [{"name": "test"}]
}
HEREDOC
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$NO_KEY_FILE" --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected REPO_INVALID_SYNC_CONFIG error code"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 7: Sync pair with invalid platform should show REPO_INVALID_SYNC_CONFIG ==="
INVALID_PLATFORM_FILE="$TMPDIR/invalid-platform.json"
cat > "$INVALID_PLATFORM_FILE" <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "test-pair",
      "platform": "bitbucket",
      "source": { "repo": "owner/repo" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "mycontainer",
        "folder": "repos/test",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlac"
      }
    }
  ]
}
HEREDOC
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$INVALID_PLATFORM_FILE" --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected REPO_INVALID_SYNC_CONFIG error code for invalid platform"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 8: Sync pair missing destination fields should show REPO_INVALID_SYNC_CONFIG ==="
MISSING_DEST_FILE="$TMPDIR/missing-dest.json"
cat > "$MISSING_DEST_FILE" <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "test-pair",
      "platform": "github",
      "source": { "repo": "octocat/Hello-World" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "mycontainer"
      }
    }
  ]
}
HEREDOC
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$MISSING_DEST_FILE" --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected REPO_INVALID_SYNC_CONFIG for missing destination fields"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 9: Duplicate sync pair names should show REPO_INVALID_SYNC_CONFIG ==="
DUP_NAMES_FILE="$TMPDIR/dup-names.json"
cat > "$DUP_NAMES_FILE" <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "my-repo",
      "platform": "github",
      "source": { "repo": "octocat/Hello-World" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/test1",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlac"
      }
    },
    {
      "name": "my-repo",
      "platform": "github",
      "source": { "repo": "octocat/Spoon-Knife" },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "c1",
        "folder": "repos/test2",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlac"
      }
    }
  ]
}
HEREDOC
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$DUP_NAMES_FILE" --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected REPO_INVALID_SYNC_CONFIG for duplicate names"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 10: DevOps pair missing PAT should show REPO_INVALID_SYNC_CONFIG ==="
DEVOPS_NO_PAT_FILE="$TMPDIR/devops-no-pat.json"
cat > "$DEVOPS_NO_PAT_FILE" <<'HEREDOC'
{
  "syncPairs": [
    {
      "name": "devops-pair",
      "platform": "azure-devops",
      "source": {
        "organization": "myorg",
        "project": "myproject",
        "repository": "myrepo"
      },
      "destination": {
        "accountUrl": "https://test.blob.core.windows.net",
        "container": "mycontainer",
        "folder": "repos/devops-test",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlac"
      }
    }
  ]
}
HEREDOC
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$DEVOPS_NO_PAT_FILE" --json 2>&1 || true)
echo "$OUTPUT"
if echo "$OUTPUT" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  pass
else
  fail "Expected REPO_INVALID_SYNC_CONFIG for DevOps pair missing PAT"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 11: Valid config structure (dummy credentials) - proves config parsed OK ==="
# This test has a structurally valid config but fake Azure credentials.
# The sync attempt should get past validation and fail on actual replication
# (auth error or connection error), proving the config was accepted.
VALID_CONFIG_FILE="$TMPDIR/valid-config.json"
cat > "$VALID_CONFIG_FILE" <<'HEREDOC'
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
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$VALID_CONFIG_FILE" --json 2>&1 || true)
echo "$OUTPUT"
# Should NOT contain REPO_INVALID_SYNC_CONFIG (config was valid)
# Should fail with a replication/connection error instead
if echo "$OUTPUT" | grep -q "REPO_INVALID_SYNC_CONFIG"; then
  fail "Config was structurally valid but got REPO_INVALID_SYNC_CONFIG"
elif echo "$OUTPUT" | grep -q "CONFIG_FILE_NOT_FOUND\|CONFIG_FILE_PARSE_ERROR"; then
  fail "Config was structurally valid but got a file loading error"
else
  pass
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Test 12: YAML config file support ==="
YAML_CONFIG_FILE="$TMPDIR/config.yaml"
cat > "$YAML_CONFIG_FILE" <<'HEREDOC'
syncPairs:
  - name: yaml-test
    platform: github
    source:
      repo: octocat/Hello-World
    destination:
      accountUrl: https://fakeaccount.blob.core.windows.net
      container: fakecontainer
      folder: repos/yaml-test
      sasToken: sv=2022-11-02&ss=b&srt=co&sp=rwdlac&se=2099-01-01
HEREDOC
OUTPUT=$(npx ts-node src/index.ts repo sync --sync-config "$YAML_CONFIG_FILE" --json 2>&1 || true)
echo "$OUTPUT"
# Should NOT contain config validation errors (YAML parsed and validated OK)
if echo "$OUTPUT" | grep -q "REPO_INVALID_SYNC_CONFIG\|CONFIG_FILE_PARSE_ERROR"; then
  fail "YAML config was structurally valid but got a validation/parse error"
else
  pass
fi

# ---------------------------------------------------------------------------
echo ""
echo "==========================================="
echo "  CLI Sync Pair Test Summary"
echo "==========================================="
echo "  Total:  $TOTAL"
echo "  Passed: $PASS_COUNT"
echo "  Failed: $FAIL_COUNT"
echo "==========================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
