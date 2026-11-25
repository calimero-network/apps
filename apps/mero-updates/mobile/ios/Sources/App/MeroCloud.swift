import MeroKit

// A staging build is a Debug build (project.yml's Staging configuration); a
// Release build, the one people install from the App Store, never is.
#if MERO_STAGING && !DEBUG
#error("MERO_STAGING is set only by the Staging configuration, never in a Release build")
#endif

/// The Calimero Cloud this build reaches: staging only in the Staging
/// configuration (`MERO_STAGING`, see project.yml), production otherwise,
/// Release always. Fixed by the build, never by what a person types: a
/// staging cluster's name or node URL in a production build is refused (its
/// debug images are not trusted, and production's directory does not list it).
enum MeroCloud {
    static var environment: CloudEnvironment {
        #if MERO_STAGING
        return .staging
        #else
        return .production
        #endif
    }
}
