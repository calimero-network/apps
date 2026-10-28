import Foundation
import MeroKit

/// The signature library: drawings stored in the private context, reused
/// when signing (the web's `SignaturesPage`).
@MainActor
public final class SignaturesModel: ObservableObject {
    @Published public private(set) var signatures: [SavedSignature] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var isSaving = false
    @Published public var notice: String?

    public let store: PrivateStore

    public init(store: PrivateStore) { self.store = store }

    public func load() async {
        if signatures.isEmpty { phase = .loading }
        do {
            signatures = try await store.signatures()
            phase = .loaded
        } catch {
            phase = signatures.isEmpty ? .failed(SignErrorText.describe(error)) : .loaded
        }
    }

    /// Save a drawn signature as "Signature N", as the web names them.
    public func save(png: Data) async {
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = try await store.saveSignature(png: png, name: "Signature \(signatures.count + 1)")
            signatures.insert(saved, at: 0)
            await load()
        } catch {
            notice = SignErrorText.describe(error)
        }
    }

    public func delete(_ signature: SavedSignature) async {
        let before = signatures
        signatures.removeAll { $0.id == signature.id }
        do {
            try await store.deleteSignature(id: signature.id)
        } catch {
            signatures = before
            notice = SignErrorText.describe(error)
        }
    }
}
