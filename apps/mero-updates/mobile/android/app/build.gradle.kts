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

// The node's consent page sends the person back to this URL; the manifest's intent filter is built
// from its scheme and host so the two cannot drift apart. Keep it in step with
// UpdatesViewModel.CONSENT_CALLBACK.
val consentCallback = "mero-updates://consent"
val consentScheme: String = consentCallback.substringBefore("://")
val consentHost: String = consentCallback.substringAfter("://")

android {
    namespace = "network.calimero.updates"
    // The SDK modules compile against 34 (AGP 8.5.2's supported ceiling); stay in step with them.
    compileSdk = 34

    defaultConfig {
        applicationId = "network.calimero.updates"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        // The Calimero Cloud cluster the sign-in form prefills: its name (nodes from the node
        // directory) or a node URL. Empty: the form asks.
        buildConfigField("String", "CLUSTER", configString("meroCluster"))
        // The development node (`merod local`) the form prefills; empty: http://10.0.2.2:2501.
        buildConfigField("String", "DEV_NODE_URL", configString("meroDevNodeUrl"))
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
    implementation(libs.compose.material.icons.extended)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.mero.testkit)
}
