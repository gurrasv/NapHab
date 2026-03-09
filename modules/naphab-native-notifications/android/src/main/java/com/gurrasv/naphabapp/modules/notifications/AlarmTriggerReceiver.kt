package com.gurrasv.naphabapp.modules.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Receives AlarmManager triggers and shows the exercise reminder notification.
 * Used for exact-time scheduling (replaces WorkManager which was unreliable).
 */
class AlarmTriggerReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != NotificationConstants.ACTION_ALARM_TRIGGER) return

    val exerciseId = intent.getStringExtra(NotificationConstants.KEY_EXERCISE_ID) ?: return
    val title = intent.getStringExtra(NotificationConstants.KEY_TITLE) ?: "Ovning"
    val sets = intent.getIntExtra(NotificationConstants.KEY_SETS, 0)
    val reps = intent.getIntExtra(NotificationConstants.KEY_REPS, 0)
    val scheduledAt = intent.getStringExtra(NotificationConstants.KEY_SCHEDULED_AT) ?: ""
    val scheduleId = intent.getStringExtra(NotificationConstants.KEY_SCHEDULE_ID) ?: ""
    Log.d("NaphabNotify", "Alarm fired scheduleId=$scheduleId scheduledAt=$scheduledAt title=$title")

    val notificationId = NotificationScheduler.notificationIdFor(scheduleId)
    NotificationStore.removeScheduledId(context, scheduleId)

    NotificationHelper.showExerciseNotification(
      context = context,
      notificationId = notificationId,
      exerciseId = exerciseId,
      title = title,
      sets = sets,
      reps = reps,
      scheduledAt = scheduledAt,
      scheduleId = scheduleId,
    )
  }
}
