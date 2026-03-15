#!/bin/bash
set -euo pipefail

echo "==> Xcode Cloud pre-xcodebuild start"

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$PWD}"
cd "$REPO_ROOT"

if [ ! -d "node_modules" ]; then
  if [ -f "package-lock.json" ]; then
    echo "==> node_modules missing, running npm ci"
    npm ci --no-audit
  else
    echo "==> node_modules missing, running npm install"
    npm install --no-audit
  fi
fi

echo "==> Ensuring iOS Pods are installed"
cd ios
pod install

echo "==> Xcode Cloud pre-xcodebuild complete"
