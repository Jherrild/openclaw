#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $label (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: no args
output=$(bash "$SCRIPT_DIR/hello.sh")
assert_eq "Hello, world!" "$output" "no args → Hello, world!"

# Test 2: with name
output=$(bash "$SCRIPT_DIR/hello.sh" Magnus)
assert_eq "Hello, Magnus!" "$output" "name arg → Hello, Magnus!"

# Summary
echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
