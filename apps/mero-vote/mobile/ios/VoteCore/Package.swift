// swift-tools-version: 5.9
// Hyperfeed Vote's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the ballot cryptography, the generated
// contract client, the invitation codec and the view models the SwiftUI
// screens bind.
//
// The MeroKit pin must match the one in ../project.yml (one revision for both).
import PackageDescription

let package = Package(
    name: "VoteCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "VoteCore", targets: ["VoteCore", "VoteCrypto"]),
    ],
    dependencies: [
        // MeroKit from a calimero-network/core release (Calimero 1.0); keep it equal to
        // `exactVersion` in ../project.yml.
        .package(
            url: "https://github.com/calimero-network/core",
            exact: "1.0.0-rc.37"),
    ],
    targets: [
        // ristretto255 and the mero-vote protocol, with no dependencies but
        // CryptoKit's SHA-2. Pinned to the web client by ../../test-vectors.
        // Always optimised, even in a Debug build: field arithmetic at -Onone
        // is ~15x slower, which turns a two-second ballot into half a minute.
        .target(name: "VoteCrypto", swiftSettings: [.unsafeFlags(["-O"])]),
        // Sources/VoteCore/Generated/VoteClient.swift is generated from ../../../logic/res/abi.json
        // by scripts/mobile-codegen.sh at the repo root.
        .target(
            name: "VoteCore",
            dependencies: [
                "VoteCrypto",
                .product(name: "MeroKit", package: "core"),
            ]),
        .testTarget(name: "VoteCryptoTests", dependencies: ["VoteCrypto"]),
        .testTarget(
            name: "VoteCoreTests",
            dependencies: [
                "VoteCore",
                "VoteCrypto",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]),
    ]
)
