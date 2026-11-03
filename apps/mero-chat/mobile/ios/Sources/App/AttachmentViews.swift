import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Reads a blob of the open channel: from the cache, or from its app instance.
typealias BlobLoader = (String) async throws -> Data

/// An image blob, drawn once it has loaded (`MessageImageField.tsx`'s tile or an avatar).
struct BlobImage: View {
    let blobId: String
    let load: BlobLoader
    var contentMode: ContentMode = .fill
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else if failed {
                Image(systemName: "photo").foregroundStyle(Theme.muted)
            } else {
                ProgressView().tint(Theme.muted)
            }
        }
        .task(id: blobId) {
            if let cached = BlobCache.shared.data(for: blobId).flatMap(UIImage.init(data:)) {
                image = cached
                return
            }
            do {
                image = UIImage(data: try await load(blobId))
                failed = image == nil
            } catch {
                failed = true
            }
        }
    }
}

/// A member's avatar: their picture when they set one, else initials.
struct ProfileAvatar: View {
    let name: String
    let blobId: String?
    let load: BlobLoader
    var size: CGFloat = 32

    var body: some View {
        if let blobId {
            BlobImage(blobId: blobId, load: load)
                .frame(width: size, height: size)
                .clipShape(Circle())
                .background(AvatarView(name: name, size: size))
        } else {
            AvatarView(name: name, size: size)
        }
    }
}

/// A message's attachments: 80×80 image tiles that open full screen, and file
/// chips that download the file and offer it to the share sheet.
struct MessageAttachments: View {
    let message: ChatMessage
    let load: BlobLoader
    @State private var viewing: ChatAttachment?
    @State private var sharing: SharedFile?
    @State private var downloading: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !message.images.isEmpty {
                HStack(spacing: 6) {
                    ForEach(message.images, id: \.blobId) { image in
                        Button {
                            viewing = image
                        } label: {
                            BlobImage(blobId: image.blobId, load: load)
                                .frame(width: 80, height: 80)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Image \(image.name)")
                        .accessibilityIdentifier("imageAttachment")
                    }
                }
            }
            ForEach(message.files, id: \.blobId) { file in
                Button {
                    Task { await download(file) }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.ink))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(file.name).font(Theme.font(13, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                            Text(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file))
                                .font(Theme.font(11)).foregroundStyle(Theme.muted)
                        }
                        if downloading == file.blobId {
                            ProgressView().tint(Theme.accent).frame(width: 16, height: 16)
                        } else {
                            Image(systemName: "arrow.down.circle").font(.system(size: 16)).foregroundStyle(Theme.accent)
                        }
                    }
                    .padding(6)
                    .padding(.trailing, 6)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(Theme.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Download \(file.name)")
                .accessibilityIdentifier("fileAttachment")
            }
        }
        .fullScreenCover(item: $viewing) { image in
            ImageViewer(attachment: image, load: load) { viewing = nil }
        }
        .sheet(item: $sharing) { file in
            ShareSheet(items: [file.url])
        }
    }

    private func download(_ file: ChatAttachment) async {
        downloading = file.blobId
        defer { downloading = nil }
        guard let data = try? await load(file.blobId) else { return }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(file.blobId, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safeName = file.name.replacingOccurrences(of: "/", with: "_")
        let url = dir.appendingPathComponent(safeName.isEmpty ? "attachment" : safeName)
        guard (try? data.write(to: url)) != nil else { return }
        sharing = SharedFile(url: url)
    }
}

extension ChatAttachment: Identifiable {
    var id: String { blobId }
}

struct SharedFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

/// The full-screen image viewer.
struct ImageViewer: View {
    let attachment: ChatAttachment
    let load: BlobLoader
    let onClose: () -> Void
    @State private var sharing: SharedFile?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            BlobImage(blobId: attachment.blobId, load: load, contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack(spacing: 12) {
                Button {
                    Task {
                        guard let data = try? await load(attachment.blobId) else { return }
                        let url = FileManager.default.temporaryDirectory
                            .appendingPathComponent(attachment.name.isEmpty ? "image.jpg" : attachment.name)
                        if (try? data.write(to: url)) != nil { sharing = SharedFile(url: url) }
                    }
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Share image")
                Button(action: onClose) { Image(systemName: "xmark") }
                    .accessibilityLabel("Close")
            }
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(.white)
            .padding(20)
        }
        .sheet(item: $sharing) { file in ShareSheet(items: [file.url]) }
    }
}

/// `UIActivityViewController`, for saving or sending a downloaded file.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

// MARK: - Picking

enum AttachmentPicking {
    /// The largest attachment the app uploads. A blob goes up to the app instance
    /// in one request; past this, on mobile data, it looks like a hang.
    static let maxBytes = 25 * 1024 * 1024
    /// The longest edge a picked photo keeps: sharp full screen on any phone,
    /// a fraction of a 48 MP original's upload.
    static let maxImageEdge: CGFloat = 2048

    /// A picked photo as JPEG (HEIC does not display in a browser), scaled down
    /// to ``maxImageEdge`` and named like a camera roll file.
    static func image(from item: PhotosPickerItem) async throws -> PendingAttachment {
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
            throw AttachmentPickError.unreadablePhoto
        }
        guard let jpeg = scaled(image).jpegData(compressionQuality: 0.85) else { throw AttachmentPickError.unreadablePhoto }
        guard jpeg.count <= maxBytes else { throw AttachmentPickError.tooLarge }
        let stamp = Int(Date().timeIntervalSince1970)
        return PendingAttachment(name: "IMG_\(stamp).jpg", mimeType: "image/jpeg", data: jpeg)
    }

    /// A file from the Files app, with the MIME type its extension names.
    static func file(at url: URL) throws -> PendingAttachment {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > maxBytes {
            throw AttachmentPickError.tooLarge
        }
        guard let data = try? Data(contentsOf: url) else { throw AttachmentPickError.unreadableFile(url.lastPathComponent) }
        guard data.count <= maxBytes else { throw AttachmentPickError.tooLarge }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return PendingAttachment(name: url.lastPathComponent, mimeType: mime, data: data)
    }

    private static func scaled(_ image: UIImage) -> UIImage {
        let longest = max(image.size.width, image.size.height)
        guard longest > maxImageEdge else { return image }
        let factor = maxImageEdge / longest
        let size = CGSize(width: (image.size.width * factor).rounded(), height: (image.size.height * factor).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}

/// Why a pick didn't become an attachment, in the channel's error banner.
enum AttachmentPickError: LocalizedError, Equatable {
    case unreadablePhoto
    case unreadableFile(String)
    case tooLarge

    var errorDescription: String? {
        switch self {
        case .unreadablePhoto: return "That photo couldn't be loaded. If it's in iCloud, wait for it to download and try again."
        case .unreadableFile(let name): return "\(name) couldn't be read."
        case .tooLarge: return "Attachments can be up to 25 MB."
        }
    }
}
