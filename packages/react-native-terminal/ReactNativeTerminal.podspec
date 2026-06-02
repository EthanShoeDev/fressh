require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# STUB — structure only. See docs/projects/native-rendering-refactor.md §8.
# The iOS analogue of the umbrella CMake: compile the ubrn shim C++ + nitrogen
# view sources + our adapter, and link the cargo staticlib (libshim_uniffi.a /
# libfressh_core.a from the xcframework). GLES on iOS via ANGLE->Metal comes
# later (§5); v1 PoC is Android-first.
#
# Model on packages/react-native-uniffi-russh/UniffiRussh.podspec, then add the
# Nitro view + render-plane sources.

Pod::Spec.new do |s|
  s.name         = "ReactNativeTerminal"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/EthanShoeDev/fressh.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,cpp}"

  # TODO(scaffold): install_modules_dependencies(s); link the rust staticlib /
  # xcframework; add nitro view deps.
  install_modules_dependencies(s)
end
