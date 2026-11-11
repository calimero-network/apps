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
        // swift-sdk v0.5.0 (Calimero 1.0). Keep it equal to the exactVersion
        // in ../project.yml.
        // swift-sdk master after #90 (the generated API): exact: "0.7.0" once that is tagged.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "9210f657394831a392ed5c63e1b26ae46db832ce")
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
