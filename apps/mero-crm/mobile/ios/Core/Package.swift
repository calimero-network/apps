// swift-tools-version: 5.9
// CrmCore: everything in the iOS app that is not SwiftUI. The generated
// contract client (its own module, CrmGenerated, because it declares its own
// `ContextContractCalling`), the CRM's rules (money, dates, deal health, the
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
        // swift-sdk#85 (feat/calimero-1.0, Calimero 1.0) head; moves to its merge commit once it lands.
        // Keep it equal to the revision in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "a1ec644130d4405a1bab7547654b1442cc559b49")
    ],
    targets: [
        // @generated from ../../../logic/res/abi.json; see ../../README.md "Regenerate the client".
        .target(name: "CrmGenerated", path: "Sources/CrmGenerated"),
        .target(
            name: "CrmCore",
            dependencies: [
                "CrmGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
            ],
            path: "Sources/CrmCore"),
        .testTarget(
            name: "CrmCoreTests",
            dependencies: [
                "CrmCore",
                "CrmGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ],
            path: "Tests/CrmCoreTests"),
    ]
)
