// swift-tools-version: 5.9
// Mero AR's non-UI layer: the typed contract client, the scene and room models, the room
// service and the scene store. A plain SwiftPM package so `swift build` / `swift test` run it on
// macOS with no simulator; the app (project.yml) links it as a local package.
import PackageDescription

let package = Package(
    name: "MeroARCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MeroARCore", targets: ["MeroARCore"]),
    ],
    dependencies: [
        // MeroKit from a calimero-network/core release (Calimero 1.0); keep it equal to
        // ../project.yml.
        .package(url: "https://github.com/calimero-network/core", exact: "1.0.0-rc.35"),
    ],
    targets: [
        .target(
            name: "MeroARCore",
            dependencies: [
                .product(name: "MeroKit", package: "core"),
            ],
            // The sample living room (`RoomModel.sampleLivingRoom()`).
            resources: [.copy("Resources/sample-living-room.json")]
        ),
        .testTarget(
            name: "MeroARCoreTests",
            dependencies: [
                "MeroARCore",
                .product(name: "MeroKit", package: "core"),
            ]
        ),
    ]
)
