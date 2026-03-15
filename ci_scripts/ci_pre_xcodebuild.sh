#!/bin/bash
set -euo pipefail

echo "==> Xcode Cloud pre-xcodebuild start"

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$PWD}"
cd "$REPO_ROOT"

if [ -f "package-lock.json" ]; then
  echo "==> Running npm ci to ensure complete dependencies"
  npm ci --no-audit
else
  echo "==> package-lock.json not found, running npm install"
  npm install --no-audit
fi

if [ ! -f "node_modules/expo-application/ios/PrivacyInfo.xcprivacy" ]; then
  echo "ERROR: expo-application iOS privacy manifest not found after install."
  exit 1
fi

echo "==> Ensuring iOS Pods are installed"
cd ios
pod install

echo "==> Xcode Cloud pre-xcodebuild complete"
