// swift-tools-version: 5.9
// Mero Vote's logic, outside the app target so it builds and tests on macOS
// with `swift test` (no simulator): the ballot cryptography, the generated
// contract client, the invitation codec and the view models the SwiftUI
// screens bind.
//
// The swift-sdk pin must match the one in ../project.yml (one revision for both).
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
        // swift-sdk#85 (feat/calimero-1.0, Calimero 1.0) head; moves to its merge commit once it lands.
        .package(
            url: "https://github.com/calimero-network/swift-sdk",
            revision: "35148e4de782c065f777e80c592d9548acd645cd"),
    ],
    targets: [
        // ristretto255 and the mero-vote protocol, with no dependencies but
        // CryptoKit's SHA-2. Pinned to the web client by ../../test-vectors.
        // Always optimised, even in a Debug build: field arithmetic at -Onone
        // is ~15x slower, which turns a two-second ballot into half a minute.
        .target(name: "VoteCrypto", swiftSettings: [.unsafeFlags(["-O"])]),
        // `VoteClient.swift` is generated (../../scripts/regenerate-client.sh).
        .target(
            name: "VoteCore",
            dependencies: [
                "VoteCrypto",
                .product(name: "MeroKit", package: "swift-sdk"),
            ]),
        .testTarget(name: "VoteCryptoTests", dependencies: ["VoteCrypto"]),
        .testTarget(
            name: "VoteCoreTests",
            dependencies: [
                "VoteCore",
                "VoteCrypto",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]),
    ]
)
