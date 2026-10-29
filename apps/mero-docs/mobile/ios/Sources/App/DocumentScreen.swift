import DocsCore
import SwiftUI
import UIKit

/// What the comments sheet shows: every thread, or one block's.
enum CommentFocus: Identifiable, Equatable {
    case all
    case block(String)

    var id: String {
        switch self {
        case .all: return "all"
        case .block(let b): return "block:\(b)"
        }
    }
}

/// One document, drawn natively and read-only, with its comments.
struct DocumentScreen: View {
    @StateObject private var model: DocumentModel
    let focusBlock: String?
    @EnvironmentObject private var router: Router
    @State private var comments: CommentFocus?
    @State private var highlighted: String?
    @State private var copied = false

    init(model: @escaping @autoclosure () -> DocumentModel, focusBlock: String? = nil) {
        _model = StateObject(wrappedValue: model())
        self.focusBlock = focusBlock
    }

    var body: some View {
        Group {
            switch model.phase {
            case .loading where model.blocks.isEmpty:
                ScrollView { LoadingRows(count: 5) }
            case .failed(let message):
                ErrorBanner(message: message) { Task { await model.open() } }
                    .frame(maxHeight: .infinity)
            default:
                document
            }
        }
        .background(Theme.surface)
        .navigationTitle(model.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button {
                    Haptics.tap()
                    comments = .all
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "text.bubble")
                        if model.commentCount > 0 {
                            Text("\(model.commentCount)").font(Theme.body(14, .semibold)).monospacedDigit()
                        }
                    }
                }
                .accessibilityLabel("Comments")
                .accessibilityIdentifier("doc.comments")
                .disabled(model.phase != .ready)
                ShareLink(item: URL(string: model.shareLink)!, subject: Text(model.title)) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Share link")
            }
        }
        .sheet(item: $comments) { focus in
            CommentsSheet(model: model, initialFocus: focus)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .overlay(alignment: .bottom) {
            if copied {
                Label("Link copied", systemImage: "checkmark")
                    .font(Theme.body(14, .semibold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Theme.lime, in: Capsule())
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .environment(\.openURL, OpenURLAction { url in open(url) })
        .task {
            if model.phase != .ready { await model.open() }
            await model.live()
        }
    }

    private var document: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    header.padding(.bottom, 18)
                    if model.blocks.allSatisfy(\.isBlank) && !model.blocks.contains(where: \.isImage) {
                        Text("This document is empty.")
                            .font(Theme.body(16))
                            .foregroundStyle(Theme.faint)
                            .padding(.vertical, 24)
                    }
                    ForEach(Array(model.blocks.enumerated()), id: \.element.id) { index, block in
                        BlockRow(
                            block: block, model: model, comments: model.countsByBlock[block.id] ?? 0,
                            highlighted: highlighted == block.id,
                            onComment: { comments = .block(block.id) },
                            onCopyLink: { copy(model.blockLink(block.id)) }
                        )
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("doc.block.\(index)")
                        .id(block.id)
                    }
                    DetailsDisclosure(rows: details)
                        .card()
                        .padding(.top, 32)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .refreshable { await model.refresh() }
            .onChange(of: model.blocks.count) { _ in scrollToFocus(proxy) }
            .onAppear { scrollToFocus(proxy) }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.title)
                .font(Theme.heading(28))
                .foregroundStyle(Theme.ink)
                .textSelection(.enabled)
            HStack(spacing: 6) {
                if !model.folderName.isEmpty {
                    Label(model.folderName, systemImage: "folder").labelStyle(.titleAndIcon)
                    Text("·")
                }
                if let doc = model.doc, doc.updatedAt > 0 {
                    Text("Updated \(DocsFormat.relativeTime(nanos: doc.updatedAt)) by \(personName(doc.updatedBy, me: model.account))")
                }
            }
            .font(Theme.body(13))
            .foregroundStyle(Theme.muted)
            .lineLimit(1)
            if model.doc?.archived == true {
                Label("This document is archived.", systemImage: "archivebox")
                    .font(Theme.body(14, .medium))
                    .foregroundStyle(Theme.ink2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Theme.sunken, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    private var details: [(String, String)] {
        [
            ("Document", model.docId),
            ("Folder", model.folderId),
            ("Docs context", model.contextId ?? "–"),
            ("Workspace", model.workspaceId),
            ("Words", "\(model.wordCount)"),
            ("Created by", model.doc?.createdBy.nonEmptyOrDash ?? "–"),
        ]
    }

    private func scrollToFocus(_ proxy: ScrollViewProxy) {
        guard let focusBlock, highlighted == nil, model.block(focusBlock) != nil else { return }
        highlighted = focusBlock
        withAnimation { proxy.scrollTo(focusBlock, anchor: .center) }
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            withAnimation { highlighted = "" }
        }
    }

    private func copy(_ link: String) {
        UIPasteboard.general.string = link
        Haptics.success()
        withAnimation { copied = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            withAnimation { copied = false }
        }
    }

    /// A doc link opens here, a mention stays put, anything else goes to the browser.
    private func open(_ url: URL) -> OpenURLAction.Result {
        switch DocsFormat.linkTarget(url.absoluteString) {
        case .doc(let target):
            router.path.append(.doc(target, contextId: nil, title: nil))
            return .handled
        case .member, .none:
            return .discarded
        case .web:
            return .systemAction
        }
    }
}

extension String {
    fileprivate var nonEmptyOrDash: String? { isEmpty ? nil : self }
}

extension DocBlock {
    fileprivate var isImage: Bool {
        if case .image = kind { return true }
        return false
    }
}

/// One block, with its comment count and a long-press menu.
private struct BlockRow: View {
    let block: DocBlock
    @ObservedObject var model: DocumentModel
    let comments: Int
    let highlighted: Bool
    let onComment: () -> Void
    let onCopyLink: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            BlockView(block: block, model: model)
                .frame(maxWidth: .infinity, alignment: .leading)
            if comments > 0 {
                Button(action: onComment) {
                    HStack(spacing: 3) {
                        Image(systemName: "text.bubble.fill").font(.system(size: 11))
                        Text("\(comments)").font(.system(size: 12, weight: .semibold)).monospacedDigit()
                    }
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(Theme.lime, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(comments == 1 ? "1 comment" : "\(comments) comments")
                .padding(.top, topPadding + 2)
            }
        }
        .padding(.vertical, 2)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(highlighted ? Theme.commentWash : comments > 0 ? Theme.commentWash.opacity(0.35) : .clear)
                .padding(.horizontal, -8))
        .contentShape(Rectangle())
        .contextMenu {
            Button(action: onComment) { Label("Comment", systemImage: "text.bubble") }
            Button(action: onCopyLink) { Label("Copy link to block", systemImage: "link") }
            if !block.plainText.isEmpty {
                Button {
                    UIPasteboard.general.string = block.plainText
                } label: {
                    Label("Copy text", systemImage: "doc.on.doc")
                }
            }
        }
    }

    private var topPadding: CGFloat {
        if case .heading = block.kind { return 14 }
        return 6
    }
}

/// A block, drawn by kind like the web's BlockNote schema.
struct BlockView: View {
    let block: DocBlock
    @ObservedObject var model: DocumentModel

    var body: some View {
        content
            .padding(.leading, CGFloat(block.depth) * 22)
            .frame(maxWidth: .infinity, alignment: frameAlignment)
    }

    @ViewBuilder private var content: some View {
        switch block.kind {
        case .paragraph:
            if block.isBlank {
                Color.clear.frame(height: 10)
            } else {
                text(size: 17).padding(.vertical, 5)
            }
        case .heading(let level):
            text(size: [26, 21, 18][level - 1], weight: .semibold)
                .padding(.top, level == 1 ? 18 : 14)
                .padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
        case .bullet:
            listItem(marker: Text(block.depth % 2 == 0 ? "•" : "◦").font(.system(size: 17, weight: .bold)))
        case .numbered(let index):
            listItem(marker: Text("\(index).").font(Theme.body(17)).monospacedDigit())
        case .check(let checked):
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .font(.system(size: 17))
                    .foregroundStyle(checked ? Theme.ink : Theme.muted)
                    .accessibilityLabel(checked ? "Done" : "Not done")
                text(size: 17)
                    .strikethrough(checked, color: Theme.muted)
                    .opacity(checked ? 0.6 : 1)
            }
            .padding(.vertical, 4)
        case .quote:
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 1.5).fill(Theme.lineStrong).frame(width: 3)
                text(size: 17).foregroundStyle(Theme.ink2)
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 6)
        case .code(let language):
            VStack(alignment: .leading, spacing: 6) {
                if let language {
                    Text(language.uppercased())
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(Theme.muted)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(block.plainText)
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(Theme.ink)
                        .textSelection(.enabled)
                        .fixedSize()
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.codeGround, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line, lineWidth: Theme.hairline))
            .padding(.vertical, 6)
        case .image(let blobId, let caption, let name, let width):
            ImageBlockView(blobId: blobId, caption: caption, name: name, width: width, model: model)
                .padding(.vertical, 8)
        case .divider:
            Rectangle().fill(Theme.lineStrong).frame(height: Theme.hairline).padding(.vertical, 14)
        case .unsupported:
            Text("This block needs a newer version of Mero Docs.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.sunken.opacity(0.6), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Theme.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                .padding(.vertical, 6)
        }
    }

    private func listItem(marker: Text) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            marker.foregroundStyle(Theme.ink2).frame(minWidth: 16, alignment: .trailing)
            text(size: 17)
        }
        .padding(.vertical, 3)
    }

    private func text(size: CGFloat, weight: Font.Weight = .regular) -> some View {
        Text(RichText.attributed(block, size: size, weight: weight))
            .lineSpacing(size * 0.22)
            .multilineTextAlignment(textAlignment)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
            .padding(.horizontal, block.backgroundColor == nil ? 0 : 6)
            .background(blockBackground, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private var blockBackground: Color {
        guard let name = block.backgroundColor, let hex = BlockNoteColors.background[name] else { return .clear }
        return Color(hex: hex)
    }

    private var textAlignment: TextAlignment {
        switch block.alignment {
        case .center: return .center
        case .right: return .trailing
        default: return .leading
        }
    }

    private var frameAlignment: Alignment {
        switch block.alignment {
        case .center: return .center
        case .right: return .trailing
        default: return .leading
        }
    }
}

/// Runs as an attributed string: marks, links in the accent ink, colours.
enum RichText {
    static func attributed(_ block: DocBlock, size: CGFloat, weight: Font.Weight) -> AttributedString {
        var out = AttributedString()
        let blockColor = block.textColor.flatMap { BlockNoteColors.text[$0] }.map { Color(hex: $0) }
        for run in block.runs {
            var a = AttributedString(run.text)
            let w: Font.Weight = run.bold ? (weight == .regular ? .semibold : .bold) : weight
            var font: Font = .system(size: run.code ? size * 0.88 : size, weight: w, design: run.code ? .monospaced : .default)
            if run.italic { font = font.italic() }
            a.font = font
            if run.underline { a.underlineStyle = .single }
            if run.strike { a.strikethroughStyle = .single }
            a.foregroundColor = Theme.ink
            if let c = blockColor { a.foregroundColor = c }
            if let c = run.textColor.flatMap({ BlockNoteColors.text[$0] }) { a.foregroundColor = Color(hex: c) }
            if let c = run.backgroundColor.flatMap({ BlockNoteColors.background[$0] }) { a.backgroundColor = Color(hex: c) }
            if run.code { a.backgroundColor = Theme.codeGround }
            if let href = run.link, let url = URL(string: href) {
                a.link = url
                a.foregroundColor = Theme.link
                if case .member = DocsFormat.linkTarget(href) {
                    a.font = .system(size: size, weight: .semibold)
                } else {
                    a.underlineStyle = .single
                }
            }
            out += a
        }
        return out
    }
}

/// An image block: the picture from its blob, or why it is not shown.
private struct ImageBlockView: View {
    let blobId: String?
    let caption: String
    let name: String
    let width: Double?
    @ObservedObject var model: DocumentModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            picture
            if !caption.isEmpty {
                Text(caption).font(Theme.body(14)).foregroundStyle(Theme.muted)
            }
        }
        .task(id: blobId) {
            if let blobId { await model.loadImage(blobId) }
        }
    }

    @ViewBuilder private var picture: some View {
        if let blobId {
            switch model.images[blobId] {
            case .loaded(let data):
                if let image = UIImage(data: data) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: width.map { CGFloat($0) } ?? .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .accessibilityLabel(name.isEmpty ? "Image" : name)
                } else {
                    notice(icon: "photo", title: "Image unavailable", body: "This image can't be shown.")
                }
            case .unavailable:
                notice(icon: "photo", title: "Image unavailable", body: "The member who added it may be offline.") {
                    Task { await model.loadImage(blobId, retry: true) }
                }
            default:
                notice(icon: nil, title: "Loading image…", body: nil)
            }
        } else {
            notice(icon: "photo", title: "Image unavailable", body: "This image can't be shown.")
        }
    }

    private func notice(icon: String?, title: String, body: String?, retry: (() -> Void)? = nil) -> some View {
        VStack(spacing: 6) {
            if let icon {
                Image(systemName: icon).font(.system(size: 20)).foregroundStyle(Theme.muted)
            } else {
                ProgressView().tint(Theme.muted)
            }
            Text(title).font(Theme.body(14, .medium)).foregroundStyle(Theme.ink)
            if let body { Text(body).font(Theme.body(12)).foregroundStyle(Theme.muted).multilineTextAlignment(.center) }
            if let retry {
                Button("Try again", action: retry).buttonStyle(SecondaryButtonStyle(fullWidth: false)).padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 160)
        .background(Theme.sunken.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Theme.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}
