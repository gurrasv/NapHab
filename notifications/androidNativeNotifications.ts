import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import type { AndroidSchedulePayload, PendingCompletion } from '../modules/naphab-native-notifications';

export type AndroidNotificationSchedule = AndroidSchedulePayload;

type NativeNotificationsModuleType = {
  scheduleMany(payloadJson: string): Promise<number>;
  cancelAllExerciseTriggers(): Promise<void>;
  consumePendingCompletions(): Promise<PendingCompletion[]>;
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
  showWorkoutNotification(startedAtIso: string): Promise<boolean | void>;
  dismissWorkoutNotification(): Promise<void>;
};

let nativeModuleCache: NativeNotificationsModuleType | null = null;

function getNativeNotificationsModule(): NativeNotificationsModuleType {
  if (!nativeModuleCache) {
    try {
      nativeModuleCache = requireNativeModule<NativeNotificationsModuleType>(
        'NaphabNativeNotifications',
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`Native notification module is not available: ${details}`);
    }
  }
  return nativeModuleCache;
}

export async function requestAndroidNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version < 33) return true;
  const alreadyGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  if (alreadyGranted) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function ensureAndroidExactAlarmPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const allowed = await getNativeNotificationsModule().canScheduleExactAlarms();
  if (allowed) return true;

  await getNativeNotificationsModule().openExactAlarmSettings();
  Alert.alert(
    'Behorighet for alarm',
    'Aktivera "Alarm och paminnelser" for TrackWell sa att schemalagda notiser fungerar nar appen ar stangd.',
    [{ text: 'OK' }],
  );
  return false;
}

export async function scheduleAndroidNotifications(
  items: AndroidNotificationSchedule[],
): Promise<number> {
  return getNativeNotificationsModule().scheduleMany(JSON.stringify(items));
}

export async function cancelAndroidExerciseTriggers(): Promise<void> {
  await getNativeNotificationsModule().cancelAllExerciseTriggers();
}

export async function consumeAndroidPendingCompletions(): Promise<PendingCompletion[]> {
  const items = await getNativeNotificationsModule().consumePendingCompletions();
  return Array.isArray(items) ? items : [];
}

export async function consumeIosPendingCompletionsNative(): Promise<PendingCompletion[]> {
  if (Platform.OS !== 'ios') return [];
  const items = await getNativeNotificationsModule().consumePendingCompletions();
  return Array.isArray(items) ? items : [];
}

export async function showAndroidWorkoutNotification(startedAtIso: string): Promise<void> {
  await getNativeNotificationsModule().showWorkoutNotification(startedAtIso);
}

export async function dismissAndroidWorkoutNotification(): Promise<void> {
  await getNativeNotificationsModule().dismissWorkoutNotification();
}

export async function showIosWorkoutLiveActivity(startedAtIso: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const started = await getNativeNotificationsModule().showWorkoutNotification(startedAtIso);
  if (started === false) {
    console.warn('[notifications] iOS Live Activity could not be started on this device/build.');
  }
}

export async function dismissIosWorkoutLiveActivity(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await getNativeNotificationsModule().dismissWorkoutNotification();
}
