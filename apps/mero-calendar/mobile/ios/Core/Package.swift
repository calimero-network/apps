// swift-tools-version: 5.9
// CalendarCore: everything in the iOS app that is not SwiftUI (the generated
// contract client, the calendar layer, the view models), as a local package so
// `swift build` / `swift test` check it on macOS without a simulator. The app
// target (../project.yml) links it.
import PackageDescription

let package = Package(
    name: "CalendarCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "CalendarCore", targets: ["CalendarCore"]),
    ],
    dependencies: [
        // The main merge commit of calimero-network/swift-sdk#84 (app session);
        // keep in step with project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "c9ca1a06ea3b04c24d943cbb0e1d9b30eb4c5a8f"),
    ],
    targets: [
        // @generated from ../../../logic/res/abi.json — see README "Regenerate the client".
        .target(name: "CalendarGenerated", path: "Sources/CalendarGenerated"),
        .target(
            name: "CalendarCore",
            dependencies: [
                "CalendarGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
            ],
            path: "Sources/CalendarCore"),
        .testTarget(
            name: "CalendarCoreTests",
            dependencies: [
                "CalendarCore",
                "CalendarGenerated",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ],
            path: "Tests/CalendarCoreTests"),
    ]
)
