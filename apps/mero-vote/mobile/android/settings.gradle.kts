pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "mero-vote-android"

include(":app")

// ---------------------------------------------------------------------------
// The Calimero Kotlin SDK, consumed from source (composite build).
// ---------------------------------------------------------------------------
//
// The delegated-execution layer this app is built on (Cloud sign-in, relay intents, founding,
// direct admission) came with kotlin-sdk#67 and is not on Maven Central yet. So the
// SDK is included as a build and its modules replace the `network.calimero:*` coordinates the app
// declares. Which checkout:
//   1. `-PmeroKotlinSdkDir=/path` (or `meroKotlinSdkDir=` in ~/.gradle/gradle.properties),
//   2. the `MERO_KOTLIN_SDK_DIR` environment variable,
//   3. `.sdk/kotlin-sdk`, the checkout `scripts/fetch-sdk.sh` makes at the SHA in `kotlin-sdk.ref`.
// Once the SDK is on Maven Central, delete this block and give the catalog entries a real version.
val sdkDir: File =
    file(
        providers
            .gradleProperty("meroKotlinSdkDir")
            .orElse(providers.environmentVariable("MERO_KOTLIN_SDK_DIR"))
            .getOrElse(".sdk/kotlin-sdk"),
    )

if (!sdkDir.resolve("settings.gradle.kts").isFile) {
    throw GradleException(
        "The Calimero Kotlin SDK checkout is missing at $sdkDir. Run ./scripts/fetch-sdk.sh " +
            "(clones the commit pinned in kotlin-sdk.ref), or point -PmeroKotlinSdkDir / " +
            "MERO_KOTLIN_SDK_DIR at a kotlin-sdk checkout.",
    )
}

includeBuild(sdkDir) {
    dependencySubstitution {
        substitute(module("network.calimero:mero-core")).using(project(":mero-core"))
        substitute(module("network.calimero:mero-compose")).using(project(":mero-compose"))
        substitute(module("network.calimero:mero-testkit")).using(project(":mero-testkit"))
    }
}
