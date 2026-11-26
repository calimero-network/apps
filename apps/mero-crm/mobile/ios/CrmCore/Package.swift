// swift-tools-version: 5.9
// CrmCore: everything in the iOS app that is not SwiftUI. The generated
// contract client (its own module, CrmGenerated, one target per client as
// core's codegen asks), the answer types, the CRM's rules (money, dates, deal health, the
// assistant, insights) and the view models, on MeroKit only, so `swift test`
// runs them on macOS without a simulator. ../project.yml links it into the app.
import PackageDescription

let package = Package(
    name: "CrmCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "CrmCore", targets: ["CrmCore"])
    ],
    dependencies: [
        // MeroKit from a calimero-network/core release (Calimero 1.0). Keep it equal to the version
        // in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/core",
            exact: "1.0.0-rc.38")
    ],
    targets: [
        // Generated from ../../../logic/res/abi.json by core's meroctl app codegen
        // (scripts/mobile-codegen.sh at the repo root); see ../../README.md "The contract client".
        .target(
            name: "CrmGenerated",
            dependencies: [.product(name: "MeroKit", package: "core")],
            path: "Sources/CrmGenerated"),
        .target(
            name: "CrmCore",
            dependencies: [
                "CrmGenerated",
                .product(name: "MeroKit", package: "core"),
            ],
            path: "Sources/CrmCore"),
        .testTarget(
            name: "CrmCoreTests",
            dependencies: [
                "CrmCore",
                "CrmGenerated",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ],
            path: "Tests/CrmCoreTests"),
    ]
)
