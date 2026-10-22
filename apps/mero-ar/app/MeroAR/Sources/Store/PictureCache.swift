import Foundation

#if canImport(UIKit)
import UIKit

/// Photos hung in the room, decoded once per blob id. A renderer asks for an
/// image; one it doesn't have yet is downloaded through the room's context and
/// ``version`` bumps when it lands, so the editor redraws that picture.
@MainActor
final class PictureCache: ObservableObject {
    static let shared = PictureCache()

    @Published private(set) var version = 0
    private var images: [String: UIImage] = [:]
    private var loading: Set<String> = []

    func image(for blobId: String) -> UIImage? { images[blobId] }

    /// The bytes this device just uploaded: shown at once, never re-downloaded.
    func seed(blobId: String, data: Data) {
        guard let image = UIImage(data: data) else { return }
        images[blobId] = image
        version += 1
    }

    /// Start downloading `blobId` unless it is cached or already on its way.
    func request(_ blobId: String, service: MeroARService) {
        guard !blobId.isEmpty, images[blobId] == nil, !loading.contains(blobId), service.hasBearerSession else {
            return
        }
        loading.insert(blobId)
        Task {
            defer { loading.remove(blobId) }
            guard let data = try? await service.downloadBlob(blobId: blobId), let image = UIImage(data: data) else {
                return
            }
            images[blobId] = image
            version += 1
        }
    }

    /// A photo shrunk to `maxSide` pixels on its longest side, as JPEG, with
    /// its pixel size.
    nonisolated static func prepare(_ data: Data, maxSide: CGFloat = 1024) -> (jpeg: Data, width: Int, height: Int)? {
        guard let source = UIImage(data: data), source.size.width > 0, source.size.height > 0 else { return nil }
        let scale = min(1, maxSide / max(source.size.width, source.size.height))
        let size = CGSize(width: (source.size.width * scale).rounded(), height: (source.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            source.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let jpeg = image.jpegData(compressionQuality: 0.82) else { return nil }
        return (jpeg, Int(size.width), Int(size.height))
    }
}
#endif
