#!/usr/bin/env python3
"""check-mobile-staging.py still catches what it claims to: each way a store
build could trust staging fails it, and the gated shapes pass."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check-mobile-staging.py"

GOOD_GRADLE = """
val meroStaging: Boolean = providers.gradleProperty("meroStaging").getOrElse("false").trim() == "true"
android {
    defaultConfig {
        buildConfigField("boolean", "MERO_STAGING", meroStaging.toString())
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            buildConfigField("boolean", "MERO_STAGING", "false")
        }
    }
}
"""
GOOD_KOTLIN = "private val CLOUD = if (BuildConfig.MERO_STAGING) CloudEnvironment.STAGING else CloudEnvironment.PRODUCTION\n"
GOOD_SWIFT = """
static var cloud: CloudEnvironment {
    #if MERO_STAGING
    return .staging
    #else
    return .production
    #endif
}
"""
GOOD_YML = """
configs:
  Debug: debug
  Staging: debug
  Release: release
targets:
  App:
    settings:
      configs:
        Staging:
          SWIFT_ACTIVE_COMPILATION_CONDITIONS: "$(inherited) MERO_STAGING"
"""


def run(files: dict[str, str]) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name, text in files.items():
            path = root / "apps" / "demo" / "mobile" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        done = subprocess.run([sys.executable, str(SCRIPT), str(root)], capture_output=True, text=True)
        return done.returncode, done.stdout


def good() -> dict[str, str]:
    return {
        "android/app/build.gradle.kts": GOOD_GRADLE,
        "android/app/src/main/kotlin/App.kt": GOOD_KOTLIN,
        "ios/Sources/App/AppConfig.swift": GOOD_SWIFT,
        "ios/project.yml": GOOD_YML,
    }


def main() -> int:
    failures: list[str] = []

    code, out = run(good())
    if code != 0:
        failures.append(f"the gated shapes should pass:\n{out}")

    cases = {
        "Kotlin staging without the BuildConfig check": (
            "android/app/src/main/kotlin/App.kt",
            "val policy = CloudEnvironment.STAGING.policy()\n",
            "outside a BuildConfig.MERO_STAGING check",
        ),
        "CloudPolicy.staging in Kotlin": (
            "android/app/src/main/kotlin/App.kt",
            "val policy = CloudPolicy.staging\n",
            "outside a BuildConfig.MERO_STAGING check",
        ),
        "a release build type that does not pin MERO_STAGING": (
            "android/app/build.gradle.kts",
            GOOD_GRADLE.replace('            buildConfigField("boolean", "MERO_STAGING", "false")\n', ""),
            "does not pin it to false",
        ),
        "Swift staging outside #if MERO_STAGING": (
            "ios/Sources/App/AppConfig.swift",
            "let policy = CloudEnvironment.staging.policy()\n",
            "outside #if MERO_STAGING",
        ),
        "Swift staging in the #else branch": (
            "ios/Sources/App/AppConfig.swift",
            GOOD_SWIFT.replace("return .production", "return .staging"),
            "outside #if MERO_STAGING",
        ),
        "MERO_STAGING in every configuration": (
            "ios/project.yml",
            GOOD_YML.replace("      configs:\n        Staging:\n          SWIFT", "      base:\n          SWIFT"),
            "outside the Staging configuration",
        ),
    }
    for name, (file, text, expected) in cases.items():
        files = good()
        files[file] = text
        code, out = run(files)
        if code == 0 or expected not in out:
            failures.append(f"{name}: expected a failure naming {expected!r}, got exit {code}:\n{out}")

    for failure in failures:
        print(f"FAIL {failure}")
    print(f"{len(cases) + 1 - len(failures)}/{len(cases) + 1} cases")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
