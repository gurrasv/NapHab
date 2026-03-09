/**
 * Expo config plugin: ensures Android native notification receivers are present.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const RECEIVERS = [
  'com.gurrasv.naphabapp.modules.notifications.AlarmTriggerReceiver',
  'com.gurrasv.naphabapp.modules.notifications.NotificationActionReceiver',
];

function withNativeAndroidNotifications(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest) return cfg;

    manifest['uses-permission'] = manifest['uses-permission'] || [];
    ensurePermission(manifest, 'android.permission.POST_NOTIFICATIONS');
    ensurePermission(manifest, 'android.permission.SCHEDULE_EXACT_ALARM');

    const app = manifest.application?.[0];
    if (!app) return cfg;
    app.receiver = app.receiver || [];
    RECEIVERS.forEach((receiverName) => ensureReceiver(app.receiver, receiverName));

    return cfg;
  });
}

function ensurePermission(manifest, permissionName) {
  const list = manifest['uses-permission'];
  const exists = list.some((item) => item?.$?.['android:name'] === permissionName);
  if (!exists) {
    list.push({ $: { 'android:name': permissionName } });
  }
}

function ensureReceiver(receiverList, className) {
  const exists = receiverList.some((item) => item?.$?.['android:name'] === className);
  if (!exists) {
    receiverList.push({
      $: {
        'android:name': className,
        'android:exported': 'false',
      },
    });
  }
}

module.exports = withNativeAndroidNotifications;
