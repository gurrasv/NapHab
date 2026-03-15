import ExpoModulesCore
import Foundation
import UserNotifications
import ActivityKit

private enum IOSNotificationConstants {
  static let reminderCategoryId = "trackwell.exercise.reminder"
  static let actionDone = "trackwell.action.done"
  static let actionSnooze = "trackwell.action.snooze"
  static let defaultSnoozeMinutes = 10
  static let pendingCompletionsKey = "naphab_ios_native_pending_completions_v1"
}

private struct PendingCompletionRecord: Codable {
  let exerciseId: String
  let atIso: String
}

@available(iOS 16.1, *)
private struct WorkoutLiveActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    let startedAtIso: String
  }

  let startedAtIso: String
}

private final class IOSPendingCompletionStore {
  private static let defaults = UserDefaults.standard

  static func add(exerciseId: String, atIso: String) {
    var list = load()
    if list.contains(where: { $0.exerciseId == exerciseId && $0.atIso == atIso }) {
      return
    }
    list.append(PendingCompletionRecord(exerciseId: exerciseId, atIso: atIso))
    save(list)
  }

  static func consume() -> [PendingCompletionRecord] {
    let list = load()
    defaults.removeObject(forKey: IOSNotificationConstants.pendingCompletionsKey)
    return list
  }

  private static func load() -> [PendingCompletionRecord] {
    guard let data = defaults.data(forKey: IOSNotificationConstants.pendingCompletionsKey) else {
      return []
    }
    return (try? JSONDecoder().decode([PendingCompletionRecord].self, from: data)) ?? []
  }

  private static func save(_ list: [PendingCompletionRecord]) {
    guard let data = try? JSONEncoder().encode(list) else {
      return
    }
    defaults.set(data, forKey: IOSNotificationConstants.pendingCompletionsKey)
  }
}

private final class IOSWorkoutLiveActivityManager {
  static let shared = IOSWorkoutLiveActivityManager()
  private init() {}

  @discardableResult
  func start(startedAtIso: String) -> Bool {
    guard #available(iOS 16.1, *) else {
      return false
    }
    do {
      let attributes = WorkoutLiveActivityAttributes(startedAtIso: startedAtIso)
      let state = WorkoutLiveActivityAttributes.ContentState(startedAtIso: startedAtIso)
      _ = try Activity<WorkoutLiveActivityAttributes>.request(
        attributes: attributes,
        content: .init(state: state, staleDate: nil),
        pushType: nil
      )
      return true
    } catch {
      return false
    }
  }

  func stopAll() {
    guard #available(iOS 16.1, *) else {
      return
    }
    Task {
      for activity in Activity<WorkoutLiveActivityAttributes>.activities {
        await activity.end(dismissalPolicy: .immediate)
      }
    }
  }
}

final class IOSNotificationDelegateProxy: NSObject, UNUserNotificationCenterDelegate {
  static let shared = IOSNotificationDelegateProxy()
  private override init() {}

  private weak var previousDelegate: UNUserNotificationCenterDelegate?

  func installAsNotificationCenterDelegate() {
    let center = UNUserNotificationCenter.current()
    if center.delegate === self {
      return
    }
    previousDelegate = center.delegate
    center.delegate = self
  }

  private func handleSnooze(response: UNNotificationResponse) {
    let content = response.notification.request.content
    let data = content.userInfo
    let exerciseId = (data["exerciseId"] as? String) ?? ""
    if exerciseId.isEmpty {
      return
    }

    let sets = extractInt(data["sets"])
    let reps = extractInt(data["reps"])
    let title = content.title.isEmpty ? "Ovning" : content.title
    let triggerAt = Date().addingTimeInterval(TimeInterval(IOSNotificationConstants.defaultSnoozeMinutes * 60))

    let mutable = UNMutableNotificationContent()
    mutable.title = title
    mutable.body = "\(sets) x \(reps)"
    mutable.sound = .default
    mutable.categoryIdentifier = IOSNotificationConstants.reminderCategoryId
    mutable.userInfo = [
      "exerciseId": exerciseId,
      "scheduleId": "native-snooze-\(exerciseId)-\(Int(triggerAt.timeIntervalSince1970))",
      "scheduledAtIso": ISO8601DateFormatter().string(from: triggerAt),
      "sets": sets,
      "reps": reps
    ]

    let comps = Calendar.current.dateComponents(
      [.year, .month, .day, .hour, .minute, .second],
      from: triggerAt
    )
    let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
    let request = UNNotificationRequest(
      identifier: "trackwell.snooze.\(exerciseId).\(Int(triggerAt.timeIntervalSince1970))",
      content: mutable,
      trigger: trigger
    )
    UNUserNotificationCenter.current().add(request)
  }

  private func extractInt(_ value: Any?) -> Int {
    if let num = value as? NSNumber {
      return num.intValue
    }
    if let raw = value as? String, let parsed = Int(raw) {
      return parsed
    }
    return 0
  }

  @discardableResult
  private func handleNativeAction(_ response: UNNotificationResponse) -> Bool {
    let actionId = response.actionIdentifier
    if actionId != IOSNotificationConstants.actionDone && actionId != IOSNotificationConstants.actionSnooze {
      return false
    }

    let data = response.notification.request.content.userInfo
    let exerciseId = (data["exerciseId"] as? String) ?? ""
    if exerciseId.isEmpty {
      return true
    }

    let center = UNUserNotificationCenter.current()
    center.removeDeliveredNotifications(withIdentifiers: [response.notification.request.identifier])

    if actionId == IOSNotificationConstants.actionDone {
      IOSPendingCompletionStore.add(
        exerciseId: exerciseId,
        atIso: ISO8601DateFormatter().string(from: Date())
      )
      return true
    }

    handleSnooze(response: response)
    return true
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if let previous = previousDelegate,
       previous !== self,
       previous.responds(to: #selector(userNotificationCenter(_:willPresent:withCompletionHandler:))) {
      previous.userNotificationCenter?(
        center,
        willPresent: notification,
        withCompletionHandler: completionHandler
      )
      return
    }
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if handleNativeAction(response) {
      completionHandler()
      return
    }

    if let previous = previousDelegate,
       previous !== self,
       previous.responds(to: #selector(userNotificationCenter(_:didReceive:withCompletionHandler:))) {
      previous.userNotificationCenter?(
        center,
        didReceive: response,
        withCompletionHandler: completionHandler
      )
      return
    }
    completionHandler()
  }
}

public class NaphabNativeNotificationsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NaphabNativeNotifications")

    OnCreate {
      IOSNotificationDelegateProxy.shared.installAsNotificationCenterDelegate()
    }

    AsyncFunction("scheduleMany") { (_ payloadJson: String) -> Int in
      // iOS scheduling is handled from JS with expo-notifications.
      return 0
    }

    AsyncFunction("cancelAllExerciseTriggers") {
      // iOS scheduling is handled from JS with expo-notifications.
    }

    AsyncFunction("canScheduleExactAlarms") { () -> Bool in
      // Android-only concept.
      return true
    }

    AsyncFunction("openExactAlarmSettings") {
      // Android-only concept.
    }

    AsyncFunction("consumePendingCompletions") { () -> [[String: String]] in
      IOSPendingCompletionStore.consume().map { row in
        [
          "exerciseId": row.exerciseId,
          "atIso": row.atIso
        ]
      }
    }

    AsyncFunction("showWorkoutNotification") { (startedAtIso: String) -> Bool in
      IOSWorkoutLiveActivityManager.shared.start(startedAtIso: startedAtIso)
    }

    AsyncFunction("dismissWorkoutNotification") {
      IOSWorkoutLiveActivityManager.shared.stopAll()
    }
  }
}

