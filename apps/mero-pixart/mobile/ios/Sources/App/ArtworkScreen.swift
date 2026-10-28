import MeroKit
import PixartCore
import SwiftUI

/// One project, view-only: the composed image with pinch and pan, the layer
/// list (show and hide on this phone only), export as PNG, and its details.
struct ArtworkScreen: View {
    @StateObject private var model: ArtworkModel
    @State private var viewport = Viewport()
    @State private var viewSize: CGSize = .zero
    @State private var didFit = false
    @State private var layersOpen = false
    @State private var infoOpen = false
    @State private var exporting = false
    @State private var exported: ShareItem?
    @State private var exportFailed = false

    init(backend: any MeroAppBackend, teamId: String, contextId: String, name: String, blobs: BlobStore) {
        _model = StateObject(
            wrappedValue: ArtworkModel(backend: backend, teamId: teamId, contextId: contextId, name: name, blobs: blobs))
    }

    var body: some View {
        ZStack {
            Theme.stage.ignoresSafeArea(edges: .bottom)
            switch model.phase {
            case .loading:
                VStack(spacing: 12) {
                    ProgressView().tint(Theme.ink)
                    Text("Opening project…").font(Theme.body(14)).foregroundStyle(Theme.muted)
                }
            case .failed(let message):
                ErrorBanner(message: message) { Task { await model.open() } }
            case .ready:
                ArtworkCanvas(model: model, viewport: $viewport, onDoubleTap: toggleZoom)
                    .ignoresSafeArea(edges: .bottom)
                VStack(spacing: 10) {
                    if model.hasOverrides || model.missing > 0 { Notice(model: model) }
                    Spacer()
                    BottomBar(
                        layerCount: model.layers.count, exporting: exporting,
                        layers: { layersOpen = true },
                        fit: { fit(animated: true) },
                        export: { Task { await export() } })
                }
                .padding(.vertical, 12)
            }
        }
        .background(GeometryReader { geo in Color.clear.onAppear { viewSize = geo.size }.onChange(of: geo.size) { viewSize = $0 } })
        .navigationTitle(model.name.isEmpty ? "Project" : model.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    ShareLink(item: URL(string: model.shareLink)!) {
                        Label("Share project link", systemImage: "link")
                    }
                    Button { fit(animated: true) } label: { Label("Fit to screen", systemImage: "viewfinder") }
                    Button { infoOpen = true } label: { Label("About this project", systemImage: "info.circle") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Project options")
            }
        }
        .task { await model.open() }
        .task { await model.live() }
        .onChange(of: model.document) { _ in fitOnce() }
        .onChange(of: viewSize) { _ in fitOnce() }
        .sheet(isPresented: $layersOpen) {
            LayersSheet(model: model)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $infoOpen) {
            ProjectInfoSheet(model: model)
                .presentationDetents([.medium, .large])
        }
        .sheet(item: $exported) { item in ShareSheet(items: item.items).ignoresSafeArea() }
        .alert("Couldn't export the image", isPresented: $exportFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("The image could not be drawn. Try again once every layer has loaded.")
        }
    }

    private var docSize: CGSize {
        CGSize(width: Double(model.document?.width ?? 0), height: Double(model.document?.height ?? 0))
    }

    private var fitted: Viewport {
        Viewport.fit(width: docSize.width, height: docSize.height, viewW: viewSize.width, viewH: viewSize.height - 76)
    }

    private func fitOnce() {
        guard !didFit, model.document != nil, viewSize.width > 0 else { return }
        didFit = true
        fit(animated: false)
    }

    private func fit(animated: Bool) {
        if animated {
            withAnimation(.easeInOut(duration: 0.25)) { viewport = fitted }
        } else {
            viewport = fitted
        }
    }

    /// Fit, or from fit to twice as close about the middle.
    private func toggleZoom() {
        Haptics.tap()
        let target = abs(viewport.scale - fitted.scale) < 0.001
            ? fitted.zoomed(by: 2.5, aboutX: viewSize.width / 2, y: (viewSize.height - 76) / 2)
            : fitted
        withAnimation(.easeInOut(duration: 0.25)) { viewport = target }
    }

    private func export() async {
        Haptics.tap()
        exporting = true
        defer { exporting = false }
        guard let png = await model.exportPNG() else {
            Haptics.error()
            exportFailed = true
            return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(PixartFormat.fileName(model.name))
        do {
            try png.write(to: url, options: .atomic)
            Haptics.success()
            exported = ShareItem(items: [url])
        } catch {
            Haptics.error()
            exportFailed = true
        }
    }
}

/// The composite at the viewport, over a checkerboard, with pinch and pan.
struct ArtworkCanvas: View {
    @ObservedObject var model: ArtworkModel
    @Binding var viewport: Viewport
    let onDoubleTap: () -> Void
    @State private var base: Viewport?

    var body: some View {
        GeometryReader { geo in
            let w = Double(model.document?.width ?? 1) * viewport.scale
            let h = Double(model.document?.height ?? 1) * viewport.scale
            ZStack(alignment: .topLeading) {
                Color.clear
                ZStack {
                    Checkerboard(cell: 10)
                    if let image = model.image {
                        Image(decorative: image.image, scale: 1)
                            .resizable()
                            .interpolation(viewport.scale > 3 ? .none : .high)
                    }
                }
                .frame(width: w, height: h)
                .shadow(color: .black.opacity(0.12), radius: 10, y: 3)
                .offset(x: viewport.offsetX, y: viewport.offsetY)
                if model.image == nil || model.rendering {
                    ProgressView()
                        .tint(Theme.ink)
                        .padding(10)
                        .background(.regularMaterial, in: Circle())
                        .position(x: geo.size.width / 2, y: geo.size.height / 2)
                        .allowsHitTesting(false)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .clipped()
            .contentShape(Rectangle())
            .gesture(panAndZoom(center: CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)))
            .onTapGesture(count: 2, perform: onDoubleTap)
            .accessibilityElement()
            .accessibilityLabel("Artwork")
            .accessibilityAddTraits(.isImage)
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

/// A line under the title when this phone's view differs from the document.
private struct Notice: View {
    @ObservedObject var model: ArtworkModel

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: model.missing > 0 ? "exclamationmark.triangle" : "eye.slash")
                .font(.system(size: 13, weight: .semibold))
            Text(text).font(Theme.body(13, .medium)).lineLimit(2)
            if model.hasOverrides {
                Button("Reset") {
                    Haptics.tap()
                    Task { await model.resetVisibility() }
                }
                .font(Theme.body(13, .semibold))
            }
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().stroke(Theme.line, lineWidth: Theme.hairline))
        .padding(.horizontal, 16)
    }

    private var text: String {
        if model.missing > 0 {
            return model.missing == 1 ? "1 layer's pixels couldn't be loaded" : "\(model.missing) layers' pixels couldn't be loaded"
        }
        return "Only on this phone: some layers are shown or hidden"
    }
}

/// Layers, fit and export, floating over the artwork.
private struct BottomBar: View {
    let layerCount: Int
    let exporting: Bool
    let layers: () -> Void
    let fit: () -> Void
    let export: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: layers) {
                HStack(spacing: 6) {
                    Image(systemName: "square.3.layers.3d")
                    Text("Layers")
                    if layerCount > 0 { Text("\(layerCount)").monospacedDigit().foregroundStyle(Theme.muted) }
                }
                .font(Theme.body(15, .semibold))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14)
                .frame(height: 44)
            }
            Button(action: fit) {
                Image(systemName: "viewfinder")
                    .font(Theme.body(16, .semibold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Fit to screen")
            Button(action: export) {
                HStack(spacing: 6) {
                    if exporting { ProgressView().tint(Theme.ink) } else { Image(systemName: "square.and.arrow.up") }
                    Text("Export")
                }
                .font(Theme.body(15, .semibold))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 16)
                .frame(height: 44)
                .background(Theme.lime, in: Capsule())
            }
            .disabled(exporting)
            .accessibilityHint("Shares the image as a PNG")
        }
        .padding(4)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().stroke(Theme.line, lineWidth: Theme.hairline))
        .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
    }
}

/// The folder tree, front-most first. The eye shows or hides a layer on this phone only.
struct LayersSheet: View {
    @ObservedObject var model: ArtworkModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if model.rows.isEmpty {
                        EmptyState(icon: "square.3.layers.3d", title: "No layers yet", message: "Layers added on the web or desktop show up here.")
                            .plainRow()
                    }
                    ForEach(model.rows) { row in
                        LayerRowView(row: row) {
                            Haptics.tap()
                            Task { await model.toggle(row.id) }
                        }
                        .listRowBackground(Theme.surface)
                    }
                } footer: {
                    Text("Showing or hiding a layer here changes only what this phone shows and exports. Everyone else sees the project as it is.")
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.muted)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("Layers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    if model.hasOverrides {
                        Button("Reset") { Task { await model.resetVisibility() } }
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }
}

private struct LayerRowView: View {
    let row: LayerRow
    let toggle: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.ink2)
                .frame(width: 32, height: 32)
                .background(Theme.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.layer.name.isEmpty ? "Untitled layer" : row.layer.name)
                        .font(Theme.body(15, .medium))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    if row.layer.locked {
                        Image(systemName: "lock.fill").font(.system(size: 10)).foregroundStyle(Theme.faint)
                            .accessibilityLabel("Locked")
                    }
                }
                Text(subtitle).font(Theme.body(12)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button(action: toggle) {
                Image(systemName: row.visible ? "eye" : "eye.slash")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(row.overridden ? Theme.ink : Theme.muted)
                    .frame(width: 40, height: 40)
                    .background(row.overridden ? Theme.lime.opacity(0.6) : Color.clear, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(row.visible ? "Hide on this phone" : "Show on this phone")
        }
        .padding(.leading, CGFloat(min(row.depth, 6)) * 18)
        .opacity(row.visible && !row.hiddenByFolder ? 1 : 0.45)
    }

    private var icon: String {
        switch row.layer.kind {
        case "group": return "folder"
        case "text": return "textformat"
        case "fill": return "paintbrush.pointed"
        case "adjustment": return "slider.horizontal.3"
        default: return "photo"
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        switch row.layer.kind {
        case "group": parts.append("Folder")
        case "text": parts.append("Text")
        case "fill": parts.append("Fill")
        case "adjustment": parts.append("Adjustment")
        default: parts.append(row.layer.blobId.isEmpty ? "Empty" : "Image")
        }
        let blend = BlendMode(wire: row.layer.blendMode)
        if blend != .normal { parts.append(blend.label) }
        if row.layer.opacity < 100 { parts.append("\(row.layer.opacity)%") }
        if row.overridden { parts.append(row.visible ? "Shown here" : "Hidden here") }
        return parts.joined(separator: " · ")
    }
}

/// Name, size, members, access and the ids.
struct ProjectInfoSheet: View {
    @ObservedObject var model: ArtworkModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(model.name.isEmpty ? "Project" : model.name).font(Theme.heading(20)).foregroundStyle(Theme.ink)
                        if let d = model.document?.description, !d.isEmpty {
                            Text(d).font(Theme.body(15)).foregroundStyle(Theme.ink2)
                        }
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
                                    if m.id == model.document?.owner { Text("Owner").font(Theme.body(13)).foregroundStyle(Theme.muted) }
                                    Spacer()
                                }
                            }
                        }
                        .card()
                    }
                    DetailsDisclosure(rows: [
                        ("Project (context)", model.contextId), ("Team", model.teamId),
                        ("Owner", model.document?.owner ?? "—"),
                    ])
                    .card()
                }
                .padding(16)
            }
            .background(Theme.ground)
            .navigationTitle("About this project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Done") { dismiss() } } }
        }
    }

    private var summary: String {
        guard let d = model.document else { return "" }
        return [
            PixartFormat.size(d.width, d.height), PixartFormat.count(model.layers.count, "layer", "layers"),
            PixartFormat.count(Int(d.memberCount), "member", "members"),
        ].joined(separator: " · ")
    }

    private var roleText: String {
        switch model.role {
        case "owner": return "You own this project. Edit it on the web or desktop."
        case "admin": return "You are an admin. Edit it on the web or desktop."
        case "editor": return "You can edit this project on the web or desktop."
        case "viewer": return "You have view-only access."
        default: return "Checking your access…"
        }
    }
}
