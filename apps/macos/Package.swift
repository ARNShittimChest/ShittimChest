// swift-tools-version: 6.2
// Package manifest for the ShittimChest macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "ShittimChest",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "ShittimChestIPC", targets: ["ShittimChestIPC"]),
        .library(name: "ShittimChestDiscovery", targets: ["ShittimChestDiscovery"]),
        .executable(name: "ShittimChest", targets: ["ShittimChest"]),
        .executable(name: "shittimchest-mac", targets: ["ShittimChestMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.3.0"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/ShittimChestKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "ShittimChestIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "ShittimChestDiscovery",
            dependencies: [
                .product(name: "ShittimChestKit", package: "ShittimChestKit"),
            ],
            path: "Sources/ShittimChestDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "ShittimChest",
            dependencies: [
                "ShittimChestIPC",
                "ShittimChestDiscovery",
                .product(name: "ShittimChestKit", package: "ShittimChestKit"),
                .product(name: "ShittimChestChatUI", package: "ShittimChestKit"),
                .product(name: "ShittimChestProtocol", package: "ShittimChestKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/ShittimChest.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "ShittimChestMacCLI",
            dependencies: [
                "ShittimChestDiscovery",
                .product(name: "ShittimChestKit", package: "ShittimChestKit"),
                .product(name: "ShittimChestProtocol", package: "ShittimChestKit"),
            ],
            path: "Sources/ShittimChestMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "ShittimChestIPCTests",
            dependencies: [
                "ShittimChestIPC",
                "ShittimChest",
                "ShittimChestDiscovery",
                .product(name: "ShittimChestProtocol", package: "ShittimChestKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
