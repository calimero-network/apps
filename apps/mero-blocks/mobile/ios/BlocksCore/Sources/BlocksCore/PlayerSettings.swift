import Foundation

/// The player's name in worlds and their look sensitivity, kept on the device (the web app keeps
/// the name in `localStorage` the same way).
@MainActor
public final class PlayerSettings: ObservableObject {
    @Published public var name: String {
        didSet { defaults.set(name, forKey: Self.nameKey) }
    }

    @Published public var sensitivity: Double {
        didSet { defaults.set(sensitivity, forKey: Self.sensitivityKey) }
    }

    private let defaults: UserDefaults
    static let nameKey = "blocks.playerName"
    static let sensitivityKey = "blocks.sensitivity"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        name = defaults.string(forKey: Self.nameKey) ?? BlocksConstants.defaultPlayerName
        let stored = defaults.object(forKey: Self.sensitivityKey) as? Double
        sensitivity = stored.map {
            min(max($0, BlocksConstants.sensitivityRange.lowerBound), BlocksConstants.sensitivityRange.upperBound)
        } ?? BlocksConstants.defaultSensitivity
    }

    /// The name as it goes to the contract: trimmed, never empty, at most 16 characters.
    public var playerName: String { BlocksText.playerName(name) }
}
