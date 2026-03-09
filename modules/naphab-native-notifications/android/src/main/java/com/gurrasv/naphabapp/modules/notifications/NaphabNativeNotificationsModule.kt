package com.gurrasv.naphabapp.modules.notifications

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NaphabNativeNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NaphabNativeNotifications")

    AsyncFunction("scheduleMany") { payloadJson: String ->
      val context = requireContext()
      NotificationScheduler.scheduleManyFromJson(context, payloadJson)
    }

    AsyncFunction("cancelAllExerciseTriggers") {
      val context = requireContext()
      NotificationScheduler.cancelAllExerciseTriggers(context)
    }

    AsyncFunction("consumePendingCompletions") {
      val context = requireContext()
      NotificationStore.consumePendingCompletions(context)
    }

    AsyncFunction("canScheduleExactAlarms") {
      val context = requireContext()
      NotificationScheduler.canScheduleExactAlarms(context)
    }

    AsyncFunction("openExactAlarmSettings") {
      val context = requireContext()
      NotificationScheduler.openExactAlarmSettings(context)
    }

    AsyncFunction("showWorkoutNotification") { startedAtIso: String ->
      val context = requireContext()
      NotificationHelper.showWorkoutOngoingNotification(context, startedAtIso)
    }

    AsyncFunction("dismissWorkoutNotification") {
      val context = requireContext()
      NotificationHelper.dismissWorkoutOngoingNotification(context)
    }
  }

  private fun requireContext(): Context {
    return appContext.reactContext?.applicationContext
      ?: throw CodedException("Android context unavailable")
  }
}
