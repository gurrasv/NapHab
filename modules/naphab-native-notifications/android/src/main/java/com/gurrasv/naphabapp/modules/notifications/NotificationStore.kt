package com.gurrasv.naphabapp.modules.notifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

object NotificationStore {
  private fun prefs(context: Context) =
    context.getSharedPreferences(NotificationConstants.STORE_NAME, Context.MODE_PRIVATE)

  fun getScheduledIds(context: Context): MutableList<String> {
    val raw = prefs(context).getString(NotificationConstants.STORE_SCHEDULED_IDS, "[]") ?: "[]"
    val json = JSONArray(raw)
    val ids = mutableListOf<String>()
    for (i in 0 until json.length()) {
      val id = json.optString(i, "")
      if (id.isNotEmpty()) ids.add(id)
    }
    return ids
  }

  fun setScheduledIds(context: Context, ids: List<String>) {
    val json = JSONArray()
    ids.forEach { json.put(it) }
    prefs(context).edit().putString(NotificationConstants.STORE_SCHEDULED_IDS, json.toString()).apply()
  }

  fun addScheduledId(context: Context, scheduleId: String) {
    val ids = getScheduledIds(context)
    if (!ids.contains(scheduleId)) {
      ids.add(scheduleId)
      setScheduledIds(context, ids)
    }
  }

  fun removeScheduledId(context: Context, scheduleId: String) {
    val ids = getScheduledIds(context).filterNot { it == scheduleId }
    setScheduledIds(context, ids)
  }

  fun addPendingCompletion(context: Context, exerciseId: String, atIso: String = Instant.now().toString()) {
    val raw = prefs(context).getString(NotificationConstants.STORE_PENDING_COMPLETIONS, "[]") ?: "[]"
    val json = JSONArray(raw)
    val item = JSONObject()
      .put("exerciseId", exerciseId)
      .put("atIso", atIso)
    json.put(item)
    prefs(context).edit().putString(NotificationConstants.STORE_PENDING_COMPLETIONS, json.toString()).apply()
  }

  fun consumePendingCompletions(context: Context): List<Map<String, String>> {
    val raw = prefs(context).getString(NotificationConstants.STORE_PENDING_COMPLETIONS, "[]") ?: "[]"
    val json = JSONArray(raw)
    val out = mutableListOf<Map<String, String>>()
    for (i in 0 until json.length()) {
      val item = json.optJSONObject(i) ?: continue
      val exerciseId = item.optString("exerciseId", "")
      val atIso = item.optString("atIso", "")
      if (exerciseId.isNotEmpty() && atIso.isNotEmpty()) {
        out.add(mapOf("exerciseId" to exerciseId, "atIso" to atIso))
      }
    }
    prefs(context).edit().putString(NotificationConstants.STORE_PENDING_COMPLETIONS, "[]").apply()
    return out
  }
}
