require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'NaphabNativeNotifications'
  s.version        = package['version']
  s.summary        = 'Native notifications bridge for TrackWell'
  s.description    = 'Cross-platform native notifications bridge used by TrackWell.'
  s.license        = package['license'] || 'UNLICENSED'
  s.author         = package['author'] || 'TrackWell'
  s.homepage       = package['homepage'] || 'https://example.invalid'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: 'https://example.invalid/naphab-native-notifications.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end

