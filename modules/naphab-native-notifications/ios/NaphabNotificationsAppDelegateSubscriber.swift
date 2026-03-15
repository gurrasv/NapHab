import ExpoModulesCore
import Foundation
import UIKit

public class NaphabNotificationsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    IOSNotificationDelegateProxy.shared.installAsNotificationCenterDelegate()
    return true
  }
}

