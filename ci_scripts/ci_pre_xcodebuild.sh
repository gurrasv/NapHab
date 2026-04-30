#!/bin/bash
set -euo pipefail

echo "==> Xcode Cloud pre-xcodebuild start"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "package.json" ]; then
  echo "ERROR: package.json not found at repository root: $REPO_ROOT"
  exit 1
fi

if [ -f "package-lock.json" ]; then
  echo "==> Running npm ci to ensure complete dependencies"
  npm ci --no-audit
else
  echo "==> package-lock.json not found, running npm install"
  npm install --no-audit
fi

expo_application_version="$(node -p "try{require('./node_modules/expo-application/package.json').version}catch(e){''}" 2>/dev/null || true)"

if [ ! -f "node_modules/expo-application/ios/PrivacyInfo.xcprivacy" ]; then
  echo "ERROR: expo-application iOS privacy manifest not found after install."
  exit 1
fi

echo "==> Ensuring iOS Pods are installed"
cd ios
pod install

echo "==> Xcode Cloud pre-xcodebuild complete"
