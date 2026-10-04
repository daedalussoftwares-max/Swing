import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import FirebaseCore

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    configureFirebaseIfPresent()

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "swing",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  /// Push (FCM) stays disabled until GoogleService-Info.plist is added to the
  /// app target (see docs/PUSH-SETUP.md). Without it, FirebaseApp.configure()
  /// would crash, so only configure when the file is bundled.
  private func configureFirebaseIfPresent() {
    guard Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
      NSLog("[push] GoogleService-Info.plist missing, Firebase/push disabled")
      return
    }
    FirebaseApp.configure()
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
