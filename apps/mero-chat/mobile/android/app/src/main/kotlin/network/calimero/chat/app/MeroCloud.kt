package network.calimero.chat.app

import com.calimero.mero.CloudEnvironment
import network.calimero.chat.BuildConfig

/**
 * The Calimero Cloud this build reaches: staging only in a debug build made with
 * `-PmeroStaging=true`, production otherwise, release builds always. Fixed by the build, never by
 * what a person types: a staging cluster's name or node URL in a production build is refused (its
 * debug images are not trusted, and production's directory does not list it).
 */
internal val meroCloud: CloudEnvironment = if (BuildConfig.MERO_STAGING) CloudEnvironment.STAGING else CloudEnvironment.PRODUCTION
