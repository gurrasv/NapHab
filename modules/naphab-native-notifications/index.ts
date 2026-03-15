import { requireNativeModule } from 'expo-modules-core';

export type AndroidSchedulePayload = {
  exerciseId: string;
  title: string;
  sets: number;
  reps: number;
  scheduledAtIso: string;
  scheduleId: string;
};

export type PendingCompletion = {
  exerciseId: string;
  atIso: string;
};

type NaphabNativeNotificationsModuleType = {
  scheduleMany(payloadJson: string): Promise<number>;
  cancelAllExerciseTriggers(): Promise<void>;
  consumePendingCompletions(): Promise<PendingCompletion[]>;
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
  showWorkoutNotification(startedAtIso: string): Promise<boolean | void>;
  dismissWorkoutNotification(): Promise<void>;
};

export default requireNativeModule<NaphabNativeNotificationsModuleType>(
  'NaphabNativeNotifications',
);
