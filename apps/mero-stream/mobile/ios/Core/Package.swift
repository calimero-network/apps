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
        // swift-sdk `feat/app-session` (PR #84). Moves to the merge commit once
        // that PR lands; keep it equal to the revision in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "122bb0d71bb43b823cb9d694c4e70678a2ef8c89")
    ],
    targets: [
        .target(
            name: "StreamCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "StreamCoreTests",
            dependencies: [
                "StreamCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ],
            resources: [.copy("Fixtures")]
        ),
    ]
)
