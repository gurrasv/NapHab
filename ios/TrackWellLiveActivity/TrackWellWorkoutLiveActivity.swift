import ActivityKit
import WidgetKit
import SwiftUI

@available(iOS 16.1, *)
struct WorkoutLiveActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    let startedAtIso: String
  }

  let startedAtIso: String
}

@available(iOS 16.1, *)
private struct WorkoutLiveActivityView: View {
  let context: ActivityViewContext<WorkoutLiveActivityAttributes>

  private var startedAt: Date {
    ISO8601DateFormatter().date(from: context.state.startedAtIso)
    ?? ISO8601DateFormatter().date(from: context.attributes.startedAtIso)
    ?? Date()
  }

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: "figure.strengthtraining.traditional")
        .foregroundStyle(.white)
      VStack(alignment: .leading, spacing: 2) {
        Text("Aktivt pass")
          .font(.headline)
          .foregroundStyle(.white)
        Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
          .font(.subheadline.monospacedDigit())
          .foregroundStyle(.white.opacity(0.9))
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 8)
  }
}

@available(iOS 16.1, *)
struct TrackWellWorkoutLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WorkoutLiveActivityAttributes.self) { context in
      WorkoutLiveActivityView(context: context)
        .activityBackgroundTint(Color.black.opacity(0.9))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "figure.strengthtraining.traditional")
            .foregroundStyle(.white)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(timerInterval: (ISO8601DateFormatter().date(from: context.state.startedAtIso) ?? Date())...Date.distantFuture, countsDown: false)
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.white)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text("TrackWell - Aktivt pass")
            .font(.subheadline)
            .foregroundStyle(.white)
        }
      } compactLeading: {
        Image(systemName: "figure.strengthtraining.traditional")
      } compactTrailing: {
        Text(timerInterval: (ISO8601DateFormatter().date(from: context.state.startedAtIso) ?? Date())...Date.distantFuture, countsDown: false)
          .font(.caption2.monospacedDigit())
      } minimal: {
        Image(systemName: "figure.strengthtraining.traditional")
      }
      .keylineTint(Color.white)
    }
  }
}

