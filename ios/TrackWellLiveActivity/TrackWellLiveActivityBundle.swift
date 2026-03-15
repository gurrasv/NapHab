import WidgetKit
import SwiftUI

@main
struct TrackWellLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.1, *) {
      TrackWellWorkoutLiveActivity()
    }
  }
}

