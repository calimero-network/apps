// swift-tools-version: 5.9
// Mero Sign's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the generated contract client, the
// private-store and identity-mapping flow, the PDF stamper, the signature ink
// model and the view models the SwiftUI screens bind.
//
// The swift-sdk pin must match the one in ../project.yml (one revision for both).
import PackageDescription

let package = Package(
    name: "SignCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "SignCore", targets: ["SignCore"]),
    ],
    dependencies: [
        // The head of swift-sdk's Calimero 1.0 branch (swift-sdk#85); moves to its merge commit once it lands.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "35148e4de782c065f777e80c592d9548acd645cd"),
    ],
    targets: [
        .target(
            name: "SignCore",
            dependencies: [
                .product(name: "MeroKit", package: "swift-sdk"),
            ]),
        // Sources/SignCore/Generated/SignClient.swift is generated from
        // ../../logic/res/abi.json with `--transport-import MeroKit`, so it
        // takes MeroKit's `ContextContractCalling` directly. Never edit it.
        .testTarget(
            name: "SignCoreTests",
            dependencies: [
                "SignCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]),
    ]
)
