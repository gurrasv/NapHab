#!/bin/bash
set -euo pipefail

DEBUG_LOG_PATH="/Users/rentamac/Documents/.cursor/debug-c5427d.log"
debug_log() {
  local hypothesis_id="$1"
  local location="$2"
  local message="$3"
  local data_json="$4"
  local ts_ms
  ts_ms=$(( $(date +%s) * 1000 ))
  printf '{"sessionId":"c5427d","runId":"%s","hypothesisId":"%s","location":"%s","message":"%s","data":%s,"timestamp":%s}\n' \
    "${DEBUG_RUN_ID:-baseline}" "$hypothesis_id" "$location" "$message" "$data_json" "$ts_ms" >> "$DEBUG_LOG_PATH" 2>/dev/null || true
}

#region agent log
debug_log "H1" "ci_pre_xcodebuild.sh:start" "Pre-xcodebuild script started" '{"script":"ci_pre_xcodebuild.sh"}'
#endregion
echo "[AGENT-DEBUG c5427d H1] ci_pre_xcodebuild started"

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

#region agent log
debug_log "H2" "ci_pre_xcodebuild.sh:after_npm_install" "Node dependencies installed" "{\"hasExpoApplication\":$( [ -d "node_modules/expo-application" ] && echo true || echo false )}"
#endregion
echo "[AGENT-DEBUG c5427d H2] after npm install hasExpoApplication=$( [ -d "node_modules/expo-application" ] && echo true || echo false )"

expo_application_version="$(node -p "try{require('./node_modules/expo-application/package.json').version}catch(e){''}" 2>/dev/null || true)"
#region agent log
debug_log "H4" "ci_pre_xcodebuild.sh:expo_application_version" "Resolved expo-application version after npm install" "{\"expoApplicationVersion\":\"${expo_application_version}\"}"
#endregion
echo "[AGENT-DEBUG c5427d H4] expoApplicationVersion=${expo_application_version}"

if [ ! -f "node_modules/expo-application/ios/PrivacyInfo.xcprivacy" ]; then
  #region agent log
  debug_log "H2" "ci_pre_xcodebuild.sh:privacy_manifest_check" "Privacy manifest missing after npm install" '{"privacyManifestFound":false}'
  #endregion
  echo "[AGENT-DEBUG c5427d H2] privacyManifestFound=false"
  echo "ERROR: expo-application iOS privacy manifest not found after install."
  exit 1
fi

#region agent log
debug_log "H2" "ci_pre_xcodebuild.sh:privacy_manifest_check" "Privacy manifest found after npm install" '{"privacyManifestFound":true}'
#endregion
echo "[AGENT-DEBUG c5427d H2] privacyManifestFound=true"

echo "==> Ensuring iOS Pods are installed"
cd ios
pod install

#region agent log
debug_log "H3" "ci_pre_xcodebuild.sh:after_pod_install" "Pod install completed pre-xcodebuild" '{"podInstallCompleted":true}'
#endregion
echo "[AGENT-DEBUG c5427d H3] podInstallCompleted=true"

echo "==> Xcode Cloud pre-xcodebuild complete"
