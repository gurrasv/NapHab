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
debug_log "H1" "ci_post_clone.sh:start" "Post-clone script started" '{"script":"ci_post_clone.sh"}'
#endregion
echo "[AGENT-DEBUG c5427d H1] ci_post_clone started"

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

#region agent log
debug_log "H2" "ci_post_clone.sh:after_npm_install" "Node dependencies installed" "{\"hasExpoApplication\":$( [ -d "node_modules/expo-application" ] && echo true || echo false )}"
#endregion
echo "[AGENT-DEBUG c5427d H2] after npm install hasExpoApplication=$( [ -d "node_modules/expo-application" ] && echo true || echo false )"

expo_application_version="$(node -p "try{require('./node_modules/expo-application/package.json').version}catch(e){''}" 2>/dev/null || true)"
#region agent log
debug_log "H4" "ci_post_clone.sh:expo_application_version" "Resolved expo-application version after npm install" "{\"expoApplicationVersion\":\"${expo_application_version}\"}"
#endregion
echo "[AGENT-DEBUG c5427d H4] expoApplicationVersion=${expo_application_version}"

if [ ! -f "node_modules/expo-application/ios/PrivacyInfo.xcprivacy" ]; then
  #region agent log
  debug_log "H2" "ci_post_clone.sh:privacy_manifest_check" "Privacy manifest missing after npm install" '{"privacyManifestFound":false}'
  #endregion
  echo "[AGENT-DEBUG c5427d H2] privacyManifestFound=false"
  echo "ERROR: expo-application iOS privacy manifest not found after install."
  exit 1
fi

#region agent log
debug_log "H2" "ci_post_clone.sh:privacy_manifest_check" "Privacy manifest found after npm install" '{"privacyManifestFound":true}'
#endregion
echo "[AGENT-DEBUG c5427d H2] privacyManifestFound=true"

echo "==> Installing iOS pods"
cd ios
pod install

#region agent log
debug_log "H3" "ci_post_clone.sh:after_pod_install" "Pod install completed in post-clone" '{"podInstallCompleted":true}'
#endregion
echo "[AGENT-DEBUG c5427d H3] podInstallCompleted=true"

echo "==> Xcode Cloud post-clone complete"
