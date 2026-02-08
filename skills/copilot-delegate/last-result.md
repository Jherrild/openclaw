# Magnus Button — Wear OS Build

**Date:** 2026-02-08

Built the magnus-button Wear OS app (`/home/jherrild/repos/magnus-button`) using the Android SDK at `/home/jherrild/android-sdk` with Gradle 8.5. Fixed three issues to get the build working: (1) created `local.properties` pointing to the Android SDK, (2) corrected `settings.gradle.kts` — changed invalid `dependencyResolution` block to `dependencyResolutionManagement` with `RepositoriesMode.FAIL_ON_PROJECT_REPOS`, and (3) generated missing `ic_launcher.png` icons for all mipmap density buckets (mdpi/hdpi/xhdpi/xxhdpi) since the mipmap directories were empty. Also regenerated the missing `gradle-wrapper.jar` by downloading and running Gradle 8.5 directly. Build completed successfully — debug APK is at `app/build/outputs/apk/debug/app-debug.apk` (23 MB).
