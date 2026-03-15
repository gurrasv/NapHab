#!/bin/bash
set -euo pipefail

echo "==> Xcode Cloud post-clone start"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "package.json" ]; then
  echo "ERROR: package.json not found at repository root: $REPO_ROOT"
  exit 1
fi

echo "==> Repository root: $REPO_ROOT"
echo "==> Node version: $(node -v)"
echo "==> npm version: $(npm -v)"
echo "==> Ruby version: $(ruby -v)"

if [ -f "package-lock.json" ]; then
  echo "==> Installing JavaScript dependencies with npm ci"
  npm ci --no-audit
else
  echo "==> package-lock.json not found, using npm install"
  npm install --no-audit
fi

if [ ! -f "node_modules/expo-application/ios/PrivacyInfo.xcprivacy" ]; then
  echo "ERROR: expo-application iOS privacy manifest not found after install."
  exit 1
fi

echo "==> Installing iOS pods"
cd ios
pod install

echo "==> Xcode Cloud post-clone complete"
