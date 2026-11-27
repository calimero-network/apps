// swift-tools-version: 5.9
// StreamCore: everything in the iOS app that is not a view or a camera. The
// generated contract client, the web app's media framing (byte for byte), the
// broadcaster slots, G.711 audio, the H.264 Annex-B helpers and the view
// models, on MeroKit only, so `swift test` runs them on macOS without a
// simulator. project.yml links it into the app.
import PackageDescription

let package = Package(
    name: "StreamCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "StreamCore", targets: ["StreamCore"])
    ],
    dependencies: [
        // MeroKit from a calimero-network/core release (Calimero 1.0). Keep it equal to the
        // exactVersion in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/core",
            exact: "1.0.0-rc.38")
    ],
    targets: [
        .target(
            name: "StreamCore",
            dependencies: [.product(name: "MeroKit", package: "core")]
        ),
        .testTarget(
            name: "StreamCoreTests",
            dependencies: [
                "StreamCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ],
            resources: [.copy("Fixtures")]
        ),
    ]
)
