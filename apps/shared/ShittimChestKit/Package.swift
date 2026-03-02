// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "ShittimChestKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "ShittimChestProtocol", targets: ["ShittimChestProtocol"]),
        .library(name: "ShittimChestKit", targets: ["ShittimChestKit"]),
        .library(name: "ShittimChestChatUI", targets: ["ShittimChestChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "ShittimChestProtocol",
            path: "Sources/ShittimChestProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "ShittimChestKit",
            dependencies: [
                "ShittimChestProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/ShittimChestKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "ShittimChestChatUI",
            dependencies: [
                "ShittimChestKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/ShittimChestChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "ShittimChestKitTests",
            dependencies: ["ShittimChestKit", "ShittimChestChatUI"],
            path: "Tests/ShittimChestKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
