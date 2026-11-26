// swift-tools-version: 5.9
// Mero Tag's non-UI layer: the typed contract client (Generated/, from the ABI by
// scripts/mobile-codegen.sh), the models, the space service, the tracker store and invite links.
// A plain SwiftPM package so `swift build` / `swift test` run it on macOS with no simulator; the
// app (project.yml) links it as a local package.
import PackageDescription

let package = Package(
    name: "TagCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "TagCore", targets: ["TagCore"]),
        // The fakes TagCore's tests and the app's tests share.
        .library(name: "TagCoreTestSupport", targets: ["TagCoreTestSupport"]),
    ],
    dependencies: [
        // MeroKit from a calimero-network/core release (Calimero 1.0); keep it equal to
        // ../project.yml.
        .package(url: "https://github.com/calimero-network/core", exact: "1.0.0-rc.38"),
    ],
    targets: [
        .target(
            name: "TagCore",
            dependencies: [
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitUI", package: "core"),
            ]
        ),
        .target(
            name: "TagCoreTestSupport",
            dependencies: [
                "TagCore",
                .product(name: "MeroKit", package: "core"),
            ]
        ),
        .testTarget(
            name: "TagCoreTests",
            dependencies: [
                "TagCore",
                "TagCoreTestSupport",
                .product(name: "MeroKit", package: "core"),
            ]
        ),
    ]
)
