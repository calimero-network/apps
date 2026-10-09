import MeroKit
import SwiftUI

struct RoomView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        if let store = app.store, let service = app.service {
            #if canImport(ARKit) && os(iOS)
            if ARSupport.isAvailable {
                ARRoomView(store: store, service: service)
            } else {
                NoARRoomView(store: store)
            }
            #else
            NoARRoomView(store: store)
            #endif
        } else {
            ZStack {
                ScreenBackground()
                ProgressView("Entering room…").tint(Theme.textFaint)
            }
        }
    }
}

// MARK: - Shared overlay pieces

/// Top bar over the room: name + live count on the left, members and leave on
/// the right. Rendered as material chips so it reads over a camera feed and
/// over the light background alike.
private struct RoomTopBar: View {
    @EnvironmentObject private var app: AppState
    @ObservedObject var store: SceneStore
    @Binding var showMembers: Bool

    var body: some View {
        HStack(spacing: 8) {
            ARChip(padding: EdgeInsets(top: 7, leading: 8, bottom: 7, trailing: 12)) {
                HStack(spacing: 8) {
                    BrandMark(size: 22)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(roomName)
                            .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)
                        HStack(spacing: 4) {
                            Circle()
                                .fill(store.isLive ? Theme.accentInk : Theme.warning)
                                .frame(width: 6, height: 6)
                            Text("\(store.objects.count) objects · \(store.onlineMembers.count) here")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Theme.textDim)
                                .monospacedDigit()
                        }
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("roomStatus")

            Spacer(minLength: 8)

            Button {
                Haptics.tap()
                showMembers = true
            } label: {
                ARChip {
                    Label("\(max(store.roles.count, 1))", systemImage: "person.2")
                        .monospacedDigit()
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Members")
            .accessibilityIdentifier("membersButton")

            Button {
                Haptics.tap()
                app.leaveRoom()
            } label: {
                ARChip(padding: EdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10)) {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold))
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Leave room")
            .accessibilityIdentifier("leaveButton")
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 8)
    }

    private var roomName: String {
        guard let name = store.room?.name, !name.isEmpty else { return "Room" }
        return name
    }
}

/// A transient hint or error over the room.
private struct OverlayNotice: View {
    let text: String
    var icon: String = "info.circle"
    var tint: Color = Theme.textDim

    var body: some View {
        ARChip {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: icon).foregroundStyle(tint)
                Text(text).multilineTextAlignment(.leading)
            }
        }
        .padding(.horizontal, Theme.gutter)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

// MARK: - AR

#if canImport(ARKit) && os(iOS)
import ARKit

enum ARSupport {
    static var isAvailable: Bool { ARWorldTrackingConfiguration.isSupported }
}

struct ARRoomView: View {
    @ObservedObject var store: SceneStore
    let service: MeroARService

    static let openingHint = "Move your phone slowly to scan the room"

    @StateObject private var ar = ARSessionManager()
    @State private var selected: String?
    @State private var status = Self.openingHint
    @State private var showMembers = false
    @State private var isPublishing = false

    var body: some View {
        ZStack {
            ARViewContainer(manager: ar).ignoresSafeArea()

            // Centre reticle — only meaningful while placement is possible.
            if store.canEdit {
                Image(systemName: "plus.viewfinder")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(.white)
                    .shadow(color: Theme.ink.opacity(0.35), radius: 4)
                    .accessibilityHidden(true)
            }

            VStack(spacing: 8) {
                RoomTopBar(store: store, showMembers: $showMembers)
                Spacer()
                if !status.isEmpty { statusLine }
                if let error = store.lastError { errorLine(error) }
                if store.canEdit {
                    toolbar
                } else if store.myRole == "viewer" {
                    // Only once the role is actually known — otherwise the room
                    // owner sees "view-only" flash before `my_role` resolves.
                    OverlayNotice(text: "View only. Ask an admin for editor access.", icon: "eye")
                        .padding(.bottom, 12)
                }
            }
            .animation(.easeOut(duration: 0.2), value: status)
            .animation(.easeOut(duration: 0.2), value: store.lastError)
        }
        .sheet(isPresented: $showMembers) { MembersSheet(store: store) }
        .onAppear { setup() }
        .onDisappear { ar.pause() }
        .onChange(of: store.sortedObjects) { _, objs in ar.sync(objs) }
    }

    /// Session hints — scanning guidance, relocalization, scan-publish results.
    private var statusLine: some View {
        OverlayNotice(text: status, icon: "viewfinder")
            .task(id: status) {
                // Transient: a stale "Relocalizing…" left on screen reads as a
                // hang. The first hint stays until something replaces it.
                guard status != Self.openingHint else { return }
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                if !Task.isCancelled { status = "" }
            }
    }

    private func errorLine(_ error: String) -> some View {
        OverlayNotice(text: error, icon: "exclamationmark.circle", tint: Theme.danger)
            .task(id: error) {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if !Task.isCancelled { store.lastError = nil }
            }
    }

    private var toolbar: some View {
        HStack(spacing: 6) {
            placeButton("Cube", "cube", kind: "cube")
            placeButton("Sphere", "circle", kind: "sphere")
            placeButton("Marker", "mappin", kind: "marker")
            Rectangle().fill(Theme.border).frame(width: 1, height: 36).padding(.horizontal, 2)
            scanButton
            if let id = selected {
                Button {
                    Haptics.tap()
                    Task {
                        await store.deleteObject(id: id)
                        selected = nil
                    }
                } label: {
                    toolLabel("Delete", "trash", tint: Theme.danger)
                }
                .buttonStyle(ToolButtonStyle())
                .accessibilityIdentifier("deleteObjectButton")
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(8)
        .background(ARMaterial(shape: RoundedRectangle(cornerRadius: 20, style: .continuous)))
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: selected)
        .padding(.bottom, 12)
    }

    private func placeButton(_ title: String, _ icon: String, kind: String) -> some View {
        Button {
            Haptics.tap()
            guard let transform = ar.placementTransform() else {
                status = "Point at a surface, then tap"
                return
            }
            Task { await store.addObject(kind: kind, transform: transform, color: Theme.objectColorHex) }
        } label: {
            toolLabel(title, icon)
        }
        .buttonStyle(ToolButtonStyle())
        .accessibilityIdentifier("place-\(kind)")
    }

    /// Publish this device's scan as the room's shared `ARWorldMap`, so the next
    /// device to join relocalizes into the same coordinate space.
    private var scanButton: some View {
        Button {
            Haptics.tap()
            guard !isPublishing else { return }
            guard service.hasBearerSession else {
                status = "Sharing the scan needs the relay session. Try again shortly."
                return
            }
            isPublishing = true
            Task {
                defer { isPublishing = false }
                do {
                    let data = try await ar.saveWorldMap()
                    let ok = await store.publishWorldMap(data)
                    if ok { Haptics.success() }
                    status = ok ? "Room scan shared" : "Couldn't share the scan"
                } catch {
                    status = "Keep scanning — not enough of the room is mapped yet"
                }
            }
        } label: {
            if isPublishing {
                ProgressView().tint(Theme.ink).frame(width: 58, height: 52)
            } else {
                toolLabel("Share scan", "square.stack.3d.up")
            }
        }
        .buttonStyle(ToolButtonStyle())
        .accessibilityIdentifier("shareScanButton")
    }

    private func toolLabel(_ title: String, _ icon: String, tint: Color = Theme.ink) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 18, weight: .regular))
            Text(title).font(.system(size: 10.5, weight: .medium)).lineLimit(1)
        }
        .foregroundStyle(tint)
        .frame(width: 58, height: 52)
    }

    // MARK: Session wiring

    private func setup() {
        ar.start()
        ar.onCameraPose = { pos, rot in
            Task { @MainActor in store.sendPresence(position: pos, rotation: rot) }
        }
        ar.onSelect = { id in selected = id }
        ar.sync(store.sortedObjects)

        // If the room already has a shared world map, relocalize into it.
        if let blob = store.room?.worldMapBlob, !blob.isEmpty, service.hasBearerSession {
            status = "Lining up with the shared room scan…"
            Task {
                if let data = try? await service.downloadWorldMap(blobId: blob),
                    let map = ARSessionManager.decodeWorldMap(data)
                {
                    await MainActor.run { ar.start(worldMap: map) }
                }
            }
        }
    }
}

/// Tool tile: pressed = white wash.
private struct ToolButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(configuration.isPressed ? Color.white.opacity(0.9) : Color.clear)
            )
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
#endif

// MARK: - No AR (Simulator, unsupported devices)

/// The room without a camera: everything except placement — roster, roles,
/// invitations — so the session is still useful on a device that can't run
/// world tracking.
struct NoARRoomView: View {
    @ObservedObject var store: SceneStore
    @State private var showMembers = false

    var body: some View {
        ZStack(alignment: .top) {
            ScreenBackground()
            VStack(spacing: 16) {
                Spacer()
                EmptyState(
                    icon: "arkit", title: "AR isn't available here",
                    message: "Placing objects needs an ARKit-capable iPhone or iPad. You're still in the room: "
                        + "you can see who's here, manage roles and invite people."
                ) {
                    Button {
                        showMembers = true
                    } label: {
                        ButtonLabel(title: "Members & invites", icon: "person.2")
                    }
                    .buttonStyle(SecondaryButtonStyle(fullWidth: false, height: 40))
                    .padding(.top, 6)
                }
                .padding(.horizontal, Theme.gutter)
                Spacer()
            }
            RoomTopBar(store: store, showMembers: $showMembers)
        }
        .sheet(isPresented: $showMembers) { MembersSheet(store: store) }
    }
}
