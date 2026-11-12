plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.compose.compiler) apply false
    alias(libs.plugins.ktlint) apply false
    alias(libs.plugins.detekt) apply false
}

// Same lint gates, versions and settings as the Kotlin SDK this app is built on.
subprojects {
    apply(plugin = "org.jlleitschuh.gradle.ktlint")
    apply(plugin = "io.gitlab.arturbosch.detekt")

    configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        version.set("1.3.1")
        android.set(true)
        ignoreFailures.set(false)
        filter {
            exclude { entry -> entry.file.path.contains("/build/") }
            // The contract client is generated (scripts/mobile-codegen.sh); it is not edited here.
            exclude { entry -> entry.file.path.contains("/generated/") }
        }
    }

    configure<io.gitlab.arturbosch.detekt.extensions.DetektExtension> {
        buildUponDefaultConfig = true
        config.setFrom(rootProject.file("config/detekt/detekt.yml"))
        parallel = true
        source.setFrom(files("src/main/kotlin", "src/test/kotlin"))
    }

    tasks.withType<io.gitlab.arturbosch.detekt.Detekt>().configureEach {
        exclude("**/generated/**")
    }
}

// ---------------------------------------------------------------------------
// Calls the Calimero SDK deprecates fail the build.
// ---------------------------------------------------------------------------
//
// kotlin-sdk 0.4 deprecates the CalimeroClient methods its generated facade replaces
// (`client.orgs`, `client.apps`, `client.consent`, ...), and 1.0 removes them. A call to one fails
// this app's Kotlin compiles, main and tests, so none come back. Kotlin 2.0 cannot raise one
// warning to an error (`-Xwarning-level` arrives in Kotlin 2.2), and `allWarningsAsErrors` would
// also fail on unrelated warnings, other libraries' deprecations included. So each compile watches
// its own output for the messages the SDK's `@Deprecated` annotations carry; other warnings stay
// warnings. If the SDK deprecates something with another message, add it here.
val sdkDeprecation =
    Regex("is deprecated\\. (Use the generated facade|Raw request plumbing|Core refuses a sealed upload|No relays on Calimero 1\\.0)")

subprojects {
    tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
        val calls = java.util.Collections.synchronizedSet(linkedSetOf<String>())
        val listener = StandardOutputListener { text -> text.lines().filter(sdkDeprecation::containsMatchIn).forEach { calls += it.trim() } }
        logging.addStandardOutputListener(listener)
        logging.addStandardErrorListener(listener)
        doFirst { calls.clear() }
        doLast {
            if (calls.isNotEmpty()) {
                throw GradleException("$path calls what the Calimero SDK deprecates; use the facade method each one names:\n" + calls.joinToString("\n"))
            }
        }
    }
}
