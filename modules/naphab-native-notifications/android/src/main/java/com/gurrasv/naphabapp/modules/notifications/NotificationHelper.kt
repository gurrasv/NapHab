package com.gurrasv.naphabapp.modules.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.time.Instant

object NotificationHelper {
  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      NotificationConstants.CHANNEL_ID,
      NotificationConstants.CHANNEL_NAME,
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = NotificationConstants.CHANNEL_DESCRIPTION
    }
    manager.createNotificationChannel(channel)
  }

  fun ensureWorkoutChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      NotificationConstants.WORKOUT_CHANNEL_ID,
      NotificationConstants.WORKOUT_CHANNEL_NAME,
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = NotificationConstants.WORKOUT_CHANNEL_DESCRIPTION
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  fun showWorkoutOngoingNotification(context: Context, startedAtIso: String) {
    ensureWorkoutChannel(context)
    val startedAtMs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Instant.parse(startedAtIso).toEpochMilli()
    } else {
      System.currentTimeMillis()
    }
    val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val openPending = PendingIntent.getActivity(
      context,
      NotificationConstants.WORKOUT_NOTIFICATION_ID,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(context, NotificationConstants.WORKOUT_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle("Pass pagar")
      .setContentText("Tryck for att atergå till passet")
      .setWhen(startedAtMs)
      .setUsesChronometer(true)
      .setChronometerCountDown(false)
      .setOngoing(true)
      .setAutoCancel(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(openPending)
      .build()
    NotificationManagerCompat.from(context).notify(NotificationConstants.WORKOUT_NOTIFICATION_ID, notification)
  }

  fun dismissWorkoutOngoingNotification(context: Context) {
    NotificationManagerCompat.from(context).cancel(NotificationConstants.WORKOUT_NOTIFICATION_ID)
  }

  fun showExerciseNotification(
    context: Context,
    notificationId: Int,
    exerciseId: String,
    title: String,
    sets: Int,
    reps: Int,
    scheduledAt: String,
    scheduleId: String,
  ) {
    ensureChannel(context)

    val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val openPending = PendingIntent.getActivity(
      context,
      notificationId,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val donePending = actionPendingIntent(
      context = context,
      action = NotificationConstants.ACTION_MARK_DONE,
      notificationId = notificationId,
      exerciseId = exerciseId,
      title = title,
      sets = sets,
      reps = reps,
      scheduledAt = scheduledAt,
      scheduleId = scheduleId,
      requestCodeOffset = 1,
    )

    val snoozePending = actionPendingIntent(
      context = context,
      action = NotificationConstants.ACTION_SNOOZE,
      notificationId = notificationId,
      exerciseId = exerciseId,
      title = title,
      sets = sets,
      reps = reps,
      scheduledAt = scheduledAt,
      scheduleId = scheduleId,
      requestCodeOffset = 2,
    )

    val body = "$title - $sets set x $reps reps"
    val notification = NotificationCompat.Builder(context, NotificationConstants.CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Dags for ovning!")
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(openPending)
      .addAction(0, "Gjort", donePending)
      .addAction(0, "Snooze 10 min", snoozePending)
      .build()

    NotificationManagerCompat.from(context).notify(notificationId, notification)
  }

  private fun actionPendingIntent(
    context: Context,
    action: String,
    notificationId: Int,
    exerciseId: String,
    title: String,
    sets: Int,
    reps: Int,
    scheduledAt: String,
    scheduleId: String,
    requestCodeOffset: Int,
  ): PendingIntent {
    val intent = Intent(context, NotificationActionReceiver::class.java).apply {
      this.action = action
      putExtra(NotificationConstants.KEY_NOTIFICATION_ID, notificationId)
      putExtra(NotificationConstants.KEY_EXERCISE_ID, exerciseId)
      putExtra(NotificationConstants.KEY_TITLE, title)
      putExtra(NotificationConstants.KEY_SETS, sets)
      putExtra(NotificationConstants.KEY_REPS, reps)
      putExtra(NotificationConstants.KEY_SCHEDULED_AT, scheduledAt)
      putExtra(NotificationConstants.KEY_SCHEDULE_ID, scheduleId)
    }
    return PendingIntent.getBroadcast(
      context,
      notificationId * 10 + requestCodeOffset,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
