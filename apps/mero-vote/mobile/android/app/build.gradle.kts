plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.compose.compiler)
}

/** A `-P` / gradle.properties value, quoted for a BuildConfig String field. */
fun configString(name: String): String {
    val value = providers.gradleProperty(name).getOrElse("").trim()
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}

// The node's consent page returns to this URL; the manifest's intent filter is built from its
// scheme and host so the two cannot drift apart.
val consentCallback: String = providers.gradleProperty("meroConsentCallback").getOrElse("mero-vote://consent").trim()
val consentScheme: String = consentCallback.substringBefore("://")
val consentHost: String =
    consentCallback
        .substringAfter("://")
        .substringBefore('/')
        .substringBefore('#')
        .substringBefore('?')

android {
    namespace = "network.calimero.vote"
    // The SDK modules compile against 34 (AGP 8.5.2's supported ceiling); stay in step with them.
    compileSdk = 34

    defaultConfig {
        applicationId = "network.calimero.vote"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        // Which cluster sign-in uses (Calimero 1.0). meroNodeUrl: your Calimero Cloud cluster, by
        // name or a node's URL; empty = the sign-in screen asks. meroDevNodeUrl: what the
        // "Development node" field starts with (`merod local`; 10.0.2.2 is the emulator's host).
        buildConfigField("String", "MERO_NODE_URL", configString("meroNodeUrl"))
        buildConfigField(
            "String",
            "MERO_DEV_NODE_URL",
            "\"" + providers.gradleProperty("meroDevNodeUrl").getOrElse("http://10.0.2.2:2501").trim() + "\"",
        )
        buildConfigField("String", "CONSENT_CALLBACK_URL", "\"$consentCallback\"")
        manifestPlaceholders["consentScheme"] = consentScheme
        manifestPlaceholders["consentHost"] = consentHost
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
            all { it.useJUnit() }
        }
    }

    lint {
        abortOnError = true
        // The SDK modules come from an included build and are linted by the SDK's own CI.
        checkDependencies = false
    }
}

dependencies {
    implementation(libs.mero.core)
    implementation(libs.mero.compose)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.mero.testkit)
}

// The cross-implementation vectors the web client writes (mobile/test-vectors/generate.mjs); the
// crypto tests replay them, as the iOS tests do.
tasks.withType<Test>().configureEach {
    systemProperty("vote.vectors", rootProject.file("../test-vectors/vectors.json").absolutePath)
}
