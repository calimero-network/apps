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
        // swift-sdk v2.0.0 (Calimero 1.0); keep in step with
        // `packages.MeroKit.exactVersion` in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            exact: "2.0.0")
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
