package com.gurrasv.naphabapp.modules.notifications

object NotificationConstants {
  const val CHANNEL_ID = "naphab_reminders"
  const val CHANNEL_NAME = "TrackWell – Paminnelser"
  const val CHANNEL_DESCRIPTION = "Paminnelser for ovningar i TrackWell"

  const val WORKOUT_CHANNEL_ID = "naphab_workout"
  const val WORKOUT_CHANNEL_NAME = "TrackWell – Pagaende pass"
  const val WORKOUT_CHANNEL_DESCRIPTION = "Visar ett pagaende traning pass"
  const val WORKOUT_NOTIFICATION_ID = 9001

  const val ACTION_ALARM_TRIGGER = "com.gurrasv.naphabapp.ALARM_TRIGGER"
  const val ACTION_MARK_DONE = "com.gurrasv.naphabapp.NOTIFICATION_DONE"
  const val ACTION_SNOOZE = "com.gurrasv.naphabapp.NOTIFICATION_SNOOZE"

  const val KEY_EXERCISE_ID = "exerciseId"
  const val KEY_TITLE = "title"
  const val KEY_SETS = "sets"
  const val KEY_REPS = "reps"
  const val KEY_SCHEDULED_AT = "scheduledAt"
  const val KEY_SCHEDULE_ID = "scheduleId"
  const val KEY_NOTIFICATION_ID = "notificationId"

  const val DEFAULT_SNOOZE_MINUTES = 10L

  const val STORE_NAME = "naphab_native_notifications"
  const val STORE_SCHEDULED_IDS = "scheduled_ids_json"
  const val STORE_PENDING_COMPLETIONS = "pending_completions_json"
}
