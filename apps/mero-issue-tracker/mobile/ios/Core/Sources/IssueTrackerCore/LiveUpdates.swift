import Foundation
import MeroKit

/// Re-read a repo when it changes: on each of the relay's events for the
/// context, or every few seconds when the stream is not available (no relay
/// session yet) or ends. Runs until the calling task is cancelled.
public enum LiveUpdates {
    public static func follow(
        backend: any MeroAppBackend, contextId: String, interval: TimeInterval = Tracker.pollInterval,
        reload: @escaping @MainActor () async -> Void
    ) async {
        if backend.canSubscribe {
            do {
                for try await _ in backend.events(contextId: contextId) {
                    if Task.isCancelled { return }
                    await reload()
                }
            } catch {
                // The stream broke: fall back to polling.
            }
        }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            if Task.isCancelled { return }
            await reload()
        }
    }
}
