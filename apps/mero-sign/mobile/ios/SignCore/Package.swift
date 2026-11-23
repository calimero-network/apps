// swift-tools-version: 5.9
// Hyperfeed Sign's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the generated contract client, the
// private-store and identity-mapping flow, the PDF stamper, the signature ink
// model and the view models the SwiftUI screens bind.
//
// The MeroKit pin must match the one in ../project.yml (one revision for both).
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
        // MeroKit from a calimero-network/core release (Calimero 1.0); keep it equal to
        // `exactVersion` in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/core",
            exact: "1.0.0-rc.35"),
    ],
    targets: [
        .target(
            name: "SignCore",
            dependencies: [
                .product(name: "MeroKit", package: "core"),
            ]),
        // Sources/SignCore/Generated/SignClient.swift is generated from the
        // component ABI (../../../logic/res/abi.json) by scripts/mobile-codegen.sh;
        // ContractSurfaceTests pins it to the ABI.
        .testTarget(
            name: "SignCoreTests",
            dependencies: [
                "SignCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]),
    ]
)
