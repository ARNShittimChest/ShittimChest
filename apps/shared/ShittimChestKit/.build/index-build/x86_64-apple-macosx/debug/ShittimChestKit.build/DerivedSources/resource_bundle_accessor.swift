import Foundation

extension Foundation.Bundle {
    static let module: Bundle = {
        let mainPath = Bundle.main.bundleURL.appendingPathComponent("ShittimChestKit_ShittimChestKit.bundle").path
        let buildPath = "/Volumes/OCungRoi/PRJ/Arona-CLW/apps/shared/ShittimChestKit/.build/index-build/x86_64-apple-macosx/debug/ShittimChestKit_ShittimChestKit.bundle"

        let preferredBundle = Bundle(path: mainPath)

        guard let bundle = preferredBundle ?? Bundle(path: buildPath) else {
            // Users can write a function called fatalError themselves, we should be resilient against that.
            Swift.fatalError("could not load resource bundle: from \(mainPath) or \(buildPath)")
        }

        return bundle
    }()
}