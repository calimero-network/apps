import DesignCore
import MeroKit
import SwiftUI

/// One board, read-only: pan and pinch around it, present its screens, read
/// and add comments, see who else is here.
struct BoardScreen: View {
    @StateObject private var model: BoardModel
    @State private var viewport = Viewport()
    @State private var viewSize: CGSize = .zero
    @State private var didFit = false
    @State private var presenting = false
    @State private var commentsOpen = false
    @State private var openThread: String?
    @State private var infoOpen = false
    private let cache = ImageCache()

    init(backend: any MeroAppBackend, teamId: String, contextId: String, name: String, blobs: any BlobLoading) {
        _model = StateObject(
            wrappedValue: BoardModel(
                backend: backend, teamId: teamId, contextId: contextId, name: name, blobs: blobs, measure: Fonts.measure))
    }

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea(edges: .bottom)
            switch model.phase {
            case .loading:
                VStack(spacing: 12) {
                    ProgressView().tint(Theme.ink)
                    Text("Opening board…").font(Theme.body(14)).foregroundStyle(Theme.muted)
                }
            case .failed(let message):
                ErrorBanner(message: message) { Task { await model.open() } }
            case .ready:
                BoardCanvasView(model: model, viewport: $viewport, cache: cache) { id in
                    openThread = id
                    commentsOpen = true
                } onDoubleTap: {
                    fit(animated: true)
                }
                .ignoresSafeArea(edges: .bottom)
                if model.scene.nodes.isEmpty {
                    EmptyState(
                        icon: "square.dashed", title: "This board is empty",
                        message: "Shapes, text and images added on the web or desktop show up here.")
                }
                VStack {
                    Spacer()
                    BottomBar(
                        commentCount: model.comments.count, hasScreens: !model.scene.screens.isEmpty,
                        present: {
                            Haptics.tap()
                            presenting = true
                        },
                        comments: {
                            openThread = nil
                            commentsOpen = true
                        },
                        fit: { fit(animated: true) })
                }
                .padding(.bottom, 12)
            }
        }
        .background(GeometryReader { geo in Color.clear.onAppear { viewSize = geo.size }.onChange(of: geo.size) { viewSize = $0 } })
        .navigationTitle(model.name.isEmpty ? "Board" : model.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                if !model.viewers.isEmpty { ViewerStack(viewers: model.viewers) }
                Menu {
                    ShareLink(item: URL(string: model.shareLink)!) {
                        Label("Share board link", systemImage: "square.and.arrow.up")
                    }
                    Button { fit(animated: true) } label: { Label("Fit to screen", systemImage: "viewfinder") }
                    Button { infoOpen = true } label: { Label("About this board", systemImage: "info.circle") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Board options")
            }
        }
        .task { await model.open() }
        .task { await model.live() }
        .onChange(of: model.phase) { _ in fitOnce() }
        .onChange(of: viewSize) { _ in fitOnce() }
        .fullScreenCover(isPresented: $presenting) {
            PresentView(model: model, cache: cache)
        }
        .sheet(isPresented: $commentsOpen) {
            CommentsSheet(model: model, newCommentAt: viewCenter, openThread: openThread)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $infoOpen) {
            BoardInfoSheet(model: model)
                .presentationDetents([.medium, .large])
        }
    }

    /// The canvas point in the middle of the view: where a new comment is pinned.
    private var viewCenter: DesignCore.Point {
        viewport.canvasPoint(viewX: viewSize.width / 2, viewY: viewSize.height / 2)
    }

    private func fitOnce() {
        guard !didFit, model.phase == .ready, viewSize.width > 0 else { return }
        didFit = true
        fit(animated: false)
    }

    private func fit(animated: Bool) {
        let next = Viewport.fit(model.scene.bounds, viewW: viewSize.width, viewH: viewSize.height - 80)
        if animated {
            withAnimation(.easeInOut(duration: 0.25)) { viewport = next }
        } else {
            viewport = next
        }
    }
}

/// The board drawn at the viewport, with comment pins and other people's pointers on top.
struct BoardCanvasView: View {
    @ObservedObject var model: BoardModel
    @Binding var viewport: Viewport
    let cache: ImageCache
    let onPin: (String) -> Void
    let onDoubleTap: () -> Void
    @State private var base: Viewport?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Canvas { ctx, _ in
                    var c = ctx
                    c.translateBy(x: viewport.offsetX, y: viewport.offsetY)
                    c.scaleBy(x: viewport.scale, y: viewport.scale)
                    SceneRenderer.draw(model.scene.nodes, in: c, images: model.images, cache: cache)
                }
                ForEach(model.viewers) { viewer in
                    let p = viewport.viewPoint(viewer.point)
                    ViewerPointer(viewer: viewer).offset(x: p.x, y: p.y)
                }
                ForEach(Array(model.comments.enumerated()), id: \.element.id) { index, comment in
                    let p = viewport.viewPoint(DesignCore.Point(Double(comment.x), Double(comment.y)))
                    Button {
                        Haptics.tap()
                        onPin(comment.id)
                    } label: {
                        CommentPin(number: index + 1, author: comment.author)
                    }
                    .offset(x: p.x, y: p.y - 28)
                    .accessibilityLabel("Comment \(index + 1) by \(model.name(for: comment.author))")
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .clipped()
            .contentShape(Rectangle())
            .gesture(panAndZoom(center: CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)))
            .onTapGesture(count: 2, perform: onDoubleTap)
        }
    }

    private func panAndZoom(center: CGPoint) -> some Gesture {
        DragGesture(minimumDistance: 1)
            .simultaneously(with: MagnificationGesture())
            .onChanged { value in
                let start = base ?? viewport
                if base == nil { base = viewport }
                var next = start
                if let scale = value.second { next = next.zoomed(by: Double(scale), aboutX: center.x, y: center.y) }
                if let drag = value.first { next = next.panned(dx: drag.translation.width, dy: drag.translation.height) }
                viewport = next
            }
            .onEnded { _ in base = nil }
    }
}

/// A comment's pin: an ink bubble with its number, its point at the bottom left.
struct CommentPin: View {
    let number: Int
    let author: String

    var body: some View {
        Text("\(number)")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Theme.ink)
            .frame(minWidth: 28, minHeight: 28)
            .background(
                UnevenCorners(radius: 14, sharpBottomLeft: true)
                    .fill(Theme.lime))
            .overlay(UnevenCorners(radius: 14, sharpBottomLeft: true).stroke(Theme.ink, lineWidth: 1.5))
            .shadow(color: .black.opacity(0.18), radius: 3, y: 1)
    }
}

/// A rounded rectangle with one sharp corner (iOS 16 has no UnevenRoundedRectangle).
struct UnevenCorners: Shape {
    let radius: CGFloat
    let sharpBottomLeft: Bool

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let r = min(radius, rect.width / 2, rect.height / 2)
        p.move(to: CGPoint(x: rect.minX + r, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        p.addArc(center: CGPoint(x: rect.maxX - r, y: rect.minY + r), radius: r, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addArc(center: CGPoint(x: rect.maxX - r, y: rect.maxY - r), radius: r, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        if sharpBottomLeft {
            p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        } else {
            p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
            p.addArc(center: CGPoint(x: rect.minX + r, y: rect.maxY - r), radius: r, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        }
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + r))
        p.addArc(center: CGPoint(x: rect.minX + r, y: rect.minY + r), radius: r, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.closeSubpath()
        return p
    }
}

/// Someone else's pointer: an arrow in their colour with their name.
struct ViewerPointer: View {
    let viewer: Viewer

    var body: some View {
        HStack(alignment: .top, spacing: 2) {
            Image(systemName: "location.north.fill")
                .font(.system(size: 14))
                .rotationEffect(.degrees(-30))
                .foregroundStyle(Theme.memberColor(viewer.account))
            Text(viewer.name)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Theme.memberColor(viewer.account), in: Capsule())
                .padding(.top, 10)
        }
        .allowsHitTesting(false)
        .accessibilityLabel("\(viewer.name) is here")
    }
}

/// Up to three avatars of the people here, then a count.
struct ViewerStack: View {
    let viewers: [Viewer]

    var body: some View {
        HStack(spacing: -8) {
            ForEach(viewers.prefix(3)) { v in
                Avatar(id: v.account, name: v.name, size: 26)
                    .overlay(Circle().stroke(Color.white, lineWidth: 2))
            }
            if viewers.count > 3 {
                Text("+\(viewers.count - 3)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 26, height: 26)
                    .background(Theme.sunken, in: Circle())
                    .overlay(Circle().stroke(Color.white, lineWidth: 2))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(viewers.count == 1 ? "1 other person here" : "\(viewers.count) other people here")
    }
}

/// Present, comments and fit, floating over the board.
private struct BottomBar: View {
    let commentCount: Int
    let hasScreens: Bool
    let present: () -> Void
    let comments: () -> Void
    let fit: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: present) {
                Label("Present", systemImage: "play.fill")
                    .font(Theme.body(15, .semibold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(Theme.lime, in: Capsule())
            }
            .accessibilityHint(hasScreens ? "Plays the board's screens" : "Shows the whole board")
            Button(action: comments) {
                HStack(spacing: 6) {
                    Image(systemName: "bubble.left")
                    if commentCount > 0 { Text("\(commentCount)").monospacedDigit() }
                }
                .font(Theme.body(15, .semibold))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14)
                .frame(height: 44)
            }
            .accessibilityLabel(commentCount == 1 ? "1 comment" : "\(commentCount) comments")
            Button(action: fit) {
                Image(systemName: "viewfinder")
                    .font(Theme.body(16, .semibold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Fit to screen")
        }
        .padding(4)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().stroke(Theme.line, lineWidth: Theme.hairline))
        .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
    }
}

/// Name, size, members and the ids.
struct BoardInfoSheet: View {
    @ObservedObject var model: BoardModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(model.name.isEmpty ? "Board" : model.name).font(Theme.heading(20)).foregroundStyle(Theme.ink)
                        Text(summary).font(Theme.body(14)).foregroundStyle(Theme.muted)
                        Text(roleText).font(Theme.body(14)).foregroundStyle(Theme.ink2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                    if !model.members.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionLabel("Members")
                            ForEach(model.members, id: \.id) { m in
                                HStack(spacing: 10) {
                                    Avatar(id: m.id, name: model.name(for: m.id), size: 30)
                                    Text(model.name(for: m.id)).font(Theme.body(15)).foregroundStyle(Theme.ink)
                                    if m.id == model.account { Text("You").font(Theme.body(13)).foregroundStyle(Theme.muted) }
                                    Spacer()
                                }
                            }
                        }
                        .card()
                    }
                    DetailsDisclosure(rows: [("Board (context)", model.contextId), ("Team", model.teamId)]).card()
                }
                .padding(16)
            }
            .background(Theme.ground)
            .navigationTitle("About this board")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Done") { dismiss() } } }
        }
    }

    private var summary: String {
        let layers = model.elements.count == 1 ? "1 layer" : "\(model.elements.count) layers"
        let screens = model.scene.screens.count == 1 ? "1 screen" : "\(model.scene.screens.count) screens"
        let comments = model.comments.count == 1 ? "1 comment" : "\(model.comments.count) comments"
        return [layers, screens, comments].joined(separator: " · ")
    }

    private var roleText: String {
        switch model.role {
        case "admin": return "You are an admin of this board."
        case "editor": return "You can edit and comment on this board."
        case "viewer": return "You have view-only access."
        default: return "Checking your access…"
        }
    }
}
