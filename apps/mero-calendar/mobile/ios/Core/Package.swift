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
        // The head of calimero-network/swift-sdk#85 (core 1.0); moves to its
        // merge commit once it lands. Keep in step with project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "37c09f3f96e7d98440f6618eef8a0e83ddee8ebd"),
    ],
    targets: [
        // The calendar contract's typed client (../../../logic/res/abi.json).
        .target(
            name: "CalendarContract",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")],
            path: "Sources/CalendarContract"),
        .target(
            name: "CalendarCore",
            dependencies: [
                "CalendarContract",
                .product(name: "MeroKit", package: "swift-sdk"),
            ],
            path: "Sources/CalendarCore"),
        .testTarget(
            name: "CalendarCoreTests",
            dependencies: [
                "CalendarCore",
                "CalendarContract",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ],
            path: "Tests/CalendarCoreTests"),
    ]
)
