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
        // swift-sdk v0.5.0 (Calimero 1.0); keep it equal to `exactVersion` in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            exact: "0.5.0"),
    ],
    targets: [
        .target(
            name: "SignCore",
            dependencies: [
                .product(name: "MeroKit", package: "swift-sdk"),
            ]),
        // Sources/SignCore/Generated/SignClient.swift is written from the
        // component ABI (../../logic/res/abi.json) and takes MeroKit's
        // `ContextContractCalling`; ContractSurfaceTests pins it to the ABI.
        .testTarget(
            name: "SignCoreTests",
            dependencies: [
                "SignCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]),
    ]
)
