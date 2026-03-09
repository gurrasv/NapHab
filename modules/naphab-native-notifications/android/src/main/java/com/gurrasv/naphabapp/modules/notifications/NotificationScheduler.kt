package com.gurrasv.naphabapp.modules.notifications

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

data class SchedulePayload(
  val exerciseId: String,
  val title: String,
  val sets: Int,
  val reps: Int,
  val scheduledAtIso: String,
  val scheduleId: String,
)

object NotificationScheduler {
  private fun alarmManager(context: Context): AlarmManager =
    context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  fun canScheduleExactAlarms(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return alarmManager(context).canScheduleExactAlarms()
  }

  fun openExactAlarmSettings(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK
    }
    context.startActivity(intent)
  }

  fun scheduleManyFromJson(context: Context, payloadJson: String): Int {
    cancelAllExerciseTriggers(context)
    NotificationHelper.ensureChannel(context)

    val json = JSONArray(payloadJson)
    val now = System.currentTimeMillis()
    var count = 0
    val tracked = mutableListOf<String>()

    for (i in 0 until json.length()) {
      val item = json.optJSONObject(i) ?: continue
      val payload = parsePayload(item) ?: continue
      val triggerAt = parseIso(payload.scheduledAtIso) ?: continue
      if (triggerAt <= now) continue
      scheduleAlarm(context, payload, triggerAt)
      tracked.add(payload.scheduleId)
      count += 1
    }

    NotificationStore.setScheduledIds(context, tracked)
    return count
  }

  fun cancelAllExerciseTriggers(context: Context) {
    val alarmManager = alarmManager(context)
    val ids = NotificationStore.getScheduledIds(context)
    ids.forEach { scheduleId ->
      val pendingIntent = alarmPendingIntent(context, scheduleId, includeExtras = false)
      alarmManager.cancel(pendingIntent)
      pendingIntent.cancel()
    }
    NotificationStore.setScheduledIds(context, emptyList())
  }

  fun scheduleSnooze(
    context: Context,
    exerciseId: String,
    title: String,
    sets: Int,
    reps: Int,
    minutes: Long = NotificationConstants.DEFAULT_SNOOZE_MINUTES,
  ) {
    val triggerAt = System.currentTimeMillis() + minutes * 60_000L
    val payload = SchedulePayload(
      exerciseId = exerciseId,
      title = title,
      sets = sets,
      reps = reps,
      scheduledAtIso = Instant.ofEpochMilli(triggerAt).toString(),
      scheduleId = "snooze-$exerciseId-$triggerAt",
    )
    scheduleAlarm(context, payload, triggerAt)
    NotificationStore.addScheduledId(context, payload.scheduleId)
  }

  fun notificationIdFor(scheduleId: String): Int = scheduleId.hashCode() and 0x7FFFFFFF

  private fun scheduleAlarm(context: Context, payload: SchedulePayload, triggerAtMillis: Long) {
    val alarmManager = alarmManager(context)
    val pendingIntent = alarmPendingIntent(
      context,
      payload.scheduleId,
      includeExtras = true,
      payload = payload,
    )
    val canExact = canScheduleExactAlarms(context)
    if (canExact) {
      alarmManager.setExactAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        triggerAtMillis,
        pendingIntent,
      )
    } else {
      // Fallback when exact alarm permission isn't granted.
      alarmManager.setAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        triggerAtMillis,
        pendingIntent,
      )
    }
  }

  private fun parsePayload(item: JSONObject): SchedulePayload? {
    val exerciseId = item.optString("exerciseId", "")
    val title = item.optString("title", "")
    val scheduleId = item.optString("scheduleId", "")
    val scheduledAtIso = item.optString("scheduledAtIso", "")
    if (exerciseId.isEmpty() || title.isEmpty() || scheduleId.isEmpty() || scheduledAtIso.isEmpty()) {
      return null
    }
    return SchedulePayload(
      exerciseId = exerciseId,
      title = title,
      sets = item.optInt("sets", 0),
      reps = item.optInt("reps", 0),
      scheduledAtIso = scheduledAtIso,
      scheduleId = scheduleId,
    )
  }

  private fun parseIso(iso: String): Long? = try {
    Instant.parse(iso).toEpochMilli()
  } catch (_: Exception) {
    null
  }

  private fun alarmPendingIntent(
    context: Context,
    scheduleId: String,
    includeExtras: Boolean,
    payload: SchedulePayload? = null,
  ): PendingIntent {
    val intent = Intent(context, AlarmTriggerReceiver::class.java).apply {
      action = NotificationConstants.ACTION_ALARM_TRIGGER
      putExtra(NotificationConstants.KEY_SCHEDULE_ID, scheduleId)
      if (includeExtras && payload != null) {
        putExtra(NotificationConstants.KEY_EXERCISE_ID, payload.exerciseId)
        putExtra(NotificationConstants.KEY_TITLE, payload.title)
        putExtra(NotificationConstants.KEY_SETS, payload.sets)
        putExtra(NotificationConstants.KEY_REPS, payload.reps)
        putExtra(NotificationConstants.KEY_SCHEDULED_AT, payload.scheduledAtIso)
      }
    }
    return PendingIntent.getBroadcast(
      context,
      notificationIdFor(scheduleId),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
