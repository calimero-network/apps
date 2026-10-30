// swift-tools-version: 5.9
// Mero Sheets' non-UI layer: the generated contract client, the models
// behind every screen, and their tests. A SwiftPM package so `swift test` runs
// it on macOS with no simulator; project.yml links it into the iOS app.
import PackageDescription

let package = Package(
    name: "SheetsCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "SheetsCore", targets: ["SheetsCore"])
    ],
    dependencies: [
        // swift-sdk#85 (feat/calimero-1.0, Calimero 1.0) head; moves to its merge commit once it lands;
        // keep in step with `packages.MeroKit.revision` in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "6c5f1167d1e586f556f59c326de5f51d034e80dd")
    ],
    targets: [
        .target(
            name: "SheetsCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "SheetsCoreTests",
            dependencies: [
                "SheetsCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
