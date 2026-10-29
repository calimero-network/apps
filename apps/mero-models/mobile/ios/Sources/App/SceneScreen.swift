import MeroKit
import ModelsCore
import SwiftUI

/// The panel under the viewport.
enum PanelTab: String, CaseIterable, Identifiable {
    case objects = "Objects"
    case checkOuts = "Check-outs"
    case people = "People"
    var id: String { rawValue }
}

/// One scene, view only: the 3D viewport on top, and the objects, check-outs
/// and members under it.
struct SceneScreen: View {
    @StateObject private var model: SceneModel
    @StateObject private var viewport = ViewportController()
    @State private var tab: PanelTab = .objects
    @State private var panelOpen = true
    @State private var showAbout = false
    @State private var shared: SharedLink?
    @State private var sharing = false
    @State private var shareError: String?

    init(backend: any MeroAppBackend, studioId: String, contextId: String, name: String, blobs: any BlobLoading) {
        _model = StateObject(
            wrappedValue: SceneModel(backend: backend, studioId: studioId, contextId: contextId, name: name, blobs: blobs))
    }

    var body: some View {
        Group {
            if case .failed(let message) = model.phase {
                ErrorBanner(message: message) { Task { await model.open() } }
                    .frame(maxHeight: .infinity)
                    .background(Theme.ground)
            } else {
                VStack(spacing: 0) {
                    viewportArea
                    ScenePanel(model: model, tab: $tab, open: $panelOpen) { id in
                        Haptics.select()
                        model.selectedId = id
                        viewport.select(id)
                        viewport.frame(id)
                    }
                }
            }
        }
        .background(Theme.ground)
        .navigationTitle(model.name.isEmpty ? "Scene" : model.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button(action: share) {
                    if sharing { ProgressView().tint(Theme.ink) } else { Image(systemName: "square.and.arrow.up") }
                }
                .disabled(sharing)
                .accessibilityLabel("Share link")
                Button {
                    showAbout = true
                } label: {
                    Image(systemName: "info.circle")
                }
                .accessibilityLabel("About this scene")
            }
        }
        .task {
            viewport.blob = { [weak model] id in await model?.blob(id) }
            viewport.onPick = { [weak model] id in
                Haptics.select()
                model?.selectedId = id
            }
            await model.open()
            await model.live()
        }
        .onChange(of: model.viewerScene) { _ in
            if let json = model.viewerJSON() { viewport.setScene(json) }
        }
        .sheet(isPresented: $showAbout) {
            AboutSheet(model: model).presentationDetents([.medium, .large])
        }
        .sheet(item: $shared) { link in ShareSheet(items: [URL(string: link.url) ?? link.url]).presentationDetents([.medium, .large]) }
        .alert("Couldn't make a link", isPresented: Binding(get: { shareError != nil }, set: { if !$0 { shareError = nil } })) {
            Button("OK") { shareError = nil }
        } message: {
            Text(shareError ?? "")
        }
    }

    private var viewportArea: some View {
        ZStack {
            Theme.viewport
            ViewportView(controller: viewport)
            VStack {
                HStack(alignment: .top) {
                    if viewport.pending > 0 {
                        StatusChip(icon: nil, text: viewport.pending == 1 ? "Loading 1 asset…" : "Loading \(viewport.pending) assets…")
                    }
                    Spacer()
                    ViewportControls(viewport: viewport)
                }
                Spacer()
                if let object = model.selected {
                    SelectedCard(model: model, object: object) {
                        viewport.frame(object.id)
                    } close: {
                        model.selectedId = nil
                        viewport.select(nil)
                    }
                }
            }
            .padding(12)
            if model.phase == .loading {
                VStack(spacing: 12) {
                    ProgressView().tint(.white)
                    Text("Opening the scene…").font(Theme.body(14)).foregroundStyle(.white.opacity(0.7))
                }
            } else if model.phase == .ready, model.objects.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "cube.transparent").font(.system(size: 30)).foregroundStyle(.white.opacity(0.6))
                    Text("This scene is empty").font(Theme.heading(16)).foregroundStyle(.white)
                    Text("Objects added in the studio show up here.").font(Theme.body(14)).foregroundStyle(.white.opacity(0.6))
                }
            }
        }
        .clipped()
    }

    private func share() {
        Haptics.tap()
        sharing = true
        Task {
            defer { sharing = false }
            do {
                shared = SharedLink(url: try await model.shareLink())
            } catch {
                Haptics.error()
                shareError = ModelsFormat.errorText(error)
            }
        }
    }
}

/// Fit, shading and grid, floating over the viewport's corner.
private struct ViewportControls: View {
    @ObservedObject var viewport: ViewportController

    var body: some View {
        VStack(spacing: 0) {
            control("scope", label: "Fit the scene") {
                Haptics.tap()
                viewport.frame(nil)
            }
            Divider().frame(width: 28).overlay(Color.white.opacity(0.12))
            control(viewport.shading == .solid ? "circle.lefthalf.filled" : "sparkles",
                    label: viewport.shading == .solid ? "Solid shading" : "Rendered shading") {
                Haptics.tap()
                viewport.shading = viewport.shading == .solid ? .rendered : .solid
            }
            Divider().frame(width: 28).overlay(Color.white.opacity(0.12))
            control("grid", label: viewport.grid ? "Hide grid" : "Show grid", on: viewport.grid) {
                Haptics.tap()
                viewport.grid.toggle()
            }
        }
        .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.white.opacity(0.12), lineWidth: Theme.hairline))
    }

    private func control(_ icon: String, label: String, on: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(on ? Color.white : Color.white.opacity(0.45))
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel(label)
    }
}

/// A small dark pill over the viewport.
private struct StatusChip: View {
    let icon: String?
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            if let icon { Image(systemName: icon) } else { ProgressView().controlSize(.mini).tint(.white) }
            Text(text)
        }
        .font(Theme.body(13, .medium))
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.45), in: Capsule())
    }
}

/// The picked object: what it is, its size, and who has it checked out.
private struct SelectedCard: View {
    @ObservedObject var model: SceneModel
    let object: SceneObject
    let frame: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                KindTile(kind: object.kind, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(object.name.isEmpty ? ModelsFormat.kindLabel(object.kind) : object.name)
                        .font(Theme.heading(16)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(subtitle).font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                Button(action: frame) {
                    Image(systemName: "scope").font(.system(size: 15, weight: .medium)).frame(width: 34, height: 34)
                        .background(Theme.sunken, in: Circle())
                }
                .accessibilityLabel("Frame")
                Button(action: close) {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).frame(width: 34, height: 34)
                        .background(Theme.sunken, in: Circle())
                }
                .accessibilityLabel("Close")
            }
            .foregroundStyle(Theme.ink)
            LockLine(lock: model.lock(for: object.id), holderName: model.lock(for: object.id).map { $0.mine ? "you" : model.name(for: $0.holder) })
        }
        .card(padding: 14)
        .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
    }

    private var subtitle: String {
        var parts = [ModelsFormat.kindLabel(object.kind)]
        if let mesh = model.mesh(for: object.id) {
            parts.append("\(ModelsFormat.compact(Int(mesh.triangleCount))) triangles")
            parts.append("\(ModelsFormat.compact(Int(mesh.vertexCount))) vertices")
        }
        if !object.visible { parts.append("Hidden") }
        return parts.joined(separator: " · ")
    }
}

/// "Checked out by Ana since 2h ago, until 18:00", or "Not checked out".
struct LockLine: View {
    let lock: LockView?
    let holderName: String?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: lock == nil ? "lock.open" : "lock.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(lock == nil ? Theme.faint : (lock!.mine ? Theme.ink : Theme.amber))
                .frame(width: 16)
            if let lock {
                Text("Checked out by \(holderName ?? "someone") \(ModelsFormat.relativeTime(lock.since)), until \(ModelsFormat.until(lock.expiresAt))")
                    .font(Theme.body(13)).foregroundStyle(Theme.ink2)
            } else {
                Text("Not checked out").font(Theme.body(13)).foregroundStyle(Theme.muted)
            }
        }
    }
}

/// Objects, check-outs and people, in tabs under the viewport.
private struct ScenePanel: View {
    @ObservedObject var model: SceneModel
    @Binding var tab: PanelTab
    @Binding var open: Bool
    let pick: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                ForEach(PanelTab.allCases) { t in
                    Button {
                        Haptics.select()
                        tab = t
                        open = true
                    } label: {
                        HStack(spacing: 5) {
                            Text(t.rawValue)
                            Text("\(count(t))").foregroundStyle(tab == t ? Theme.ink.opacity(0.6) : Theme.faint)
                        }
                        .font(Theme.body(14, .semibold))
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 12)
                        .frame(height: 34)
                        .background(tab == t ? Theme.lime : Theme.surface, in: Capsule())
                        .overlay(Capsule().stroke(tab == t ? Color.clear : Theme.line, lineWidth: Theme.hairline))
                    }
                }
                Spacer(minLength: 0)
                Button {
                    Haptics.tap()
                    withAnimation(.easeInOut(duration: 0.2)) { open.toggle() }
                } label: {
                    Image(systemName: open ? "chevron.down" : "chevron.up")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.ink2)
                        .frame(width: 34, height: 34)
                        .background(Theme.surface, in: Circle())
                        .overlay(Circle().stroke(Theme.line, lineWidth: Theme.hairline))
                }
                .accessibilityLabel(open ? "Collapse" : "Expand")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            if open {
                content
                    .frame(height: 280)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .background(Theme.ground)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: Theme.hairline) }
    }

    private func count(_ t: PanelTab) -> Int {
        switch t {
        case .objects: return model.objects.count
        case .checkOuts: return model.locks.count
        case .people: return model.members.count
        }
    }

    @ViewBuilder private var content: some View {
        List {
            switch tab {
            case .objects:
                if model.objects.isEmpty {
                    EmptyState(icon: "cube.transparent", title: "No objects", message: "Objects added in the studio show up here.").plainRow()
                }
                ForEach(model.outline) { row in
                    Button { pick(row.id) } label: {
                        ObjectRow(row: row, selected: model.selectedId == row.id, holderName: row.lock.map { $0.mine ? "You" : model.name(for: $0.holder) })
                    }
                    .listRowInsets(EdgeInsets(top: 2, leading: 12, bottom: 2, trailing: 12))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                }
            case .checkOuts:
                if model.checkOuts.isEmpty {
                    EmptyState(icon: "lock.open", title: "Nothing is checked out", message: "When someone checks out an object or texture in the studio, it shows here with who has it.").plainRow()
                }
                ForEach(model.checkOuts) { c in
                    Button { if c.assetKind != "texture", c.assetKind != "object" { pick(c.assetId) } } label: {
                        CheckOutRow(checkOut: c)
                    }
                    .cardRow()
                }
            case .people:
                if model.members.isEmpty {
                    EmptyState(icon: "person.2", title: "Nobody has joined yet", message: "Members appear once they open the scene.").plainRow()
                }
                ForEach(model.members, id: \.id) { m in
                    MemberRow(member: m, name: model.name(for: m.id), isMe: m.id == model.account).cardRow()
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await model.refresh() }
    }
}

private struct ObjectRow: View {
    let row: OutlineRow
    let selected: Bool
    let holderName: String?

    var body: some View {
        HStack(spacing: 10) {
            KindTile(kind: row.object.kind, size: 30)
            Text(row.object.name.isEmpty ? ModelsFormat.kindLabel(row.object.kind) : row.object.name)
                .font(Theme.body(15, selected ? .semibold : .regular))
                .foregroundStyle(row.object.visible ? Theme.ink : Theme.faint)
                .lineLimit(1)
            if !row.object.visible {
                Image(systemName: "eye.slash").font(.system(size: 12)).foregroundStyle(Theme.faint)
            }
            Spacer(minLength: 0)
            if let lock = row.lock {
                HStack(spacing: 4) {
                    Image(systemName: "lock.fill").font(.system(size: 11, weight: .semibold))
                    Text(holderName ?? "").lineLimit(1)
                }
                .font(Theme.body(12, .medium))
                .foregroundStyle(lock.mine ? Theme.ink : Theme.amber)
            }
        }
        .padding(.leading, CGFloat(min(row.depth, 6)) * 18)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(selected ? Theme.lime.opacity(0.35) : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contentShape(Rectangle())
    }
}

private struct CheckOutRow: View {
    let checkOut: CheckOut

    var body: some View {
        HStack(spacing: 12) {
            KindTile(kind: checkOut.assetKind, size: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(checkOut.assetName).font(Theme.heading(15)).foregroundStyle(Theme.ink).lineLimit(1)
                Text("\(checkOut.holderName) · since \(ModelsFormat.relativeTime(checkOut.since)) · until \(ModelsFormat.until(checkOut.expiresAt))")
                    .font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: "lock.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(checkOut.mine ? Theme.ink : Theme.amber)
        }
        .padding(.vertical, 2)
    }
}

private struct MemberRow: View {
    let member: MemberView
    let name: String
    let isMe: Bool

    var body: some View {
        HStack(spacing: 12) {
            Avatar(id: member.id, name: name, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(isMe ? "\(name) (you)" : name).font(Theme.heading(15)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(ModelsFormat.shortId(member.id)).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 0)
            RoleBadge(role: member.role)
        }
        .padding(.vertical, 2)
    }
}

/// Counts, your access, and the ids behind Details.
private struct AboutSheet: View {
    @ObservedObject var model: SceneModel
    @SwiftUI.Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(spacing: 0) {
                        stat("Objects", "\(model.objects.count)")
                        Divider()
                        stat("Meshes", "\(model.meshes.count)")
                        Divider()
                        stat("Textures", "\(model.textures.count)")
                        Divider()
                        stat("Triangles", ModelsFormat.compact(model.totalTriangles))
                        Divider()
                        stat("Members", "\(model.members.count)")
                    }
                    .card(padding: 4)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Your access").font(Theme.heading(15)).foregroundStyle(Theme.ink)
                            Spacer()
                            if let role = model.role { RoleBadge(role: role) }
                        }
                        Text("This app shows scenes; modelling, check-outs and roles are in Mero Models on the web or desktop.")
                            .font(Theme.body(14)).foregroundStyle(Theme.muted)
                    }
                    .card()
                    DetailsDisclosure(rows: [
                        ("Scene (context)", model.contextId),
                        ("Studio (namespace)", model.studioId),
                        ("Your account", model.account),
                    ])
                    .card()
                }
                .padding(16)
            }
            .background(Theme.ground)
            .navigationTitle(model.name.isEmpty ? "Scene" : model.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(Theme.body(15)).foregroundStyle(Theme.ink2)
            Spacer()
            Text(value).font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
    }
}
