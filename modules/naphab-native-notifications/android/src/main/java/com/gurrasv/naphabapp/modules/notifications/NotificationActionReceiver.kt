package com.gurrasv.naphabapp.modules.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import java.time.Instant

class NotificationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val notificationId = intent.getIntExtra(NotificationConstants.KEY_NOTIFICATION_ID, -1)
    val exerciseId = intent.getStringExtra(NotificationConstants.KEY_EXERCISE_ID).orEmpty()
    val title = intent.getStringExtra(NotificationConstants.KEY_TITLE).orEmpty()
    val sets = intent.getIntExtra(NotificationConstants.KEY_SETS, 0)
    val reps = intent.getIntExtra(NotificationConstants.KEY_REPS, 0)

    if (notificationId > 0) {
      NotificationManagerCompat.from(context).cancel(notificationId)
    }

    when (action) {
      NotificationConstants.ACTION_MARK_DONE -> {
        if (exerciseId.isNotEmpty()) {
          NotificationStore.addPendingCompletion(
            context = context,
            exerciseId = exerciseId,
            atIso = Instant.now().toString(),
          )
        }
      }

      NotificationConstants.ACTION_SNOOZE -> {
        if (exerciseId.isNotEmpty()) {
          NotificationScheduler.scheduleSnooze(
            context = context,
            exerciseId = exerciseId,
            title = if (title.isNotEmpty()) title else "Ovning",
            sets = sets,
            reps = reps,
            minutes = NotificationConstants.DEFAULT_SNOOZE_MINUTES,
          )
        }
      }
    }
  }
}
