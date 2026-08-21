require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name           = "ClipQuestLocalAudioDecoder"
  s.version        = package["version"]
  s.summary        = package["description"]
  s.description    = package["description"]
  s.license        = "MIT"
  s.author         = "ClipQuest"
  s.homepage       = "https://clipquest.ccwu.cc"
  s.platforms      = { :ios => "16.4" }
  s.swift_version  = "5.9"
  s.source         = { :git => "https://example.invalid/clipquest.git" }
  s.static_framework = true
  s.dependency "ExpoModulesCore"
  s.frameworks = "AVFoundation", "CoreMedia", "AudioToolbox"
  s.source_files = "ios/**/*.{h,m,mm,swift}"
end
