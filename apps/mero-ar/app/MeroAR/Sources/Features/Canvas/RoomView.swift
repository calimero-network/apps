import SwiftUI
import MeroKit

struct RoomView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        if let store = app.store, let service = app.service {
            #if canImport(ARKit)
            ARRoomView(store: store, service: service)
            #else
            UnsupportedView()
            #endif
        } else {
            ProgressView("Entering room…")
        }
    }
}

#if canImport(ARKit)
import ARKit

struct ARRoomView: View {
    @EnvironmentObject private var app: AppState
    @ObservedObject var store: SceneStore
    let service: MeroARService

    static let openingHint = "Move your device to scan the room"

    @StateObject private var ar = ARSessionManager()
    @State private var selected: String?
    @State private var status = Self.openingHint
    @State private var showMembers = false
    @State private var isPublishing = false

    var body: some View {
        ZStack {
            ARViewContainer(manager: ar).ignoresSafeArea()

            // Center reticle — only meaningful while placement is possible.
            if store.canEdit {
                Image(systemName: "plus.viewfinder")
                    .font(.title)
                    .foregroundStyle(.white.opacity(0.7))
            }

            VStack {
                HStack(spacing: 10) {
                    statusPill
                    Spacer()
                    membersButton
                    leaveButton
                }
                .padding()
                Spacer()
                if !status.isEmpty { statusLine }
                if let error = store.lastError { errorPill(error) }
                if store.canEdit {
                    toolbar
                } else if store.myRole == "viewer" {
                    // Only once the role is actually known — otherwise the room
                    // owner sees "view-only" flash before `my_role` resolves.
                    viewerNotice
                }
            }
        }
        .sheet(isPresented: $showMembers) { MembersSheet(store: store) }
        .onAppear { setup() }
        .onDisappear { ar.pause() }
        .onChange(of: store.sortedObjects) { _, objs in ar.sync(objs) }
    }

    // ── Chrome ────────────────────────────────────────────────────────────────

    private var statusPill: some View {
        Label("\(store.objects.count) objects · \(store.onlineMembers.count) here",
              systemImage: "cube.transparent")
            .font(.caption).padding(8).background(.thinMaterial, in: Capsule())
    }

    private var membersButton: some View {
        Button { Haptics.tap(); showMembers = true } label: {
            Label("\(store.roles.count)", systemImage: "person.2.fill")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(Theme.stroke, lineWidth: 1))
        }
        .buttonStyle(ScaleButtonStyle())
    }

    private var leaveButton: some View {
        Button { Haptics.tap(); app.leave() } label: {
            Label("Leave", systemImage: "xmark")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(Theme.stroke, lineWidth: 1))
        }
        .buttonStyle(ScaleButtonStyle())
    }

    /// Session hints — scanning guidance, relocalization, scan-publish results.
    /// These were being assigned and never drawn, so the Scan button appeared to
    /// do nothing at all.
    private var statusLine: some View {
        Text(status)
            .font(.caption)
            .multilineTextAlignment(.center)
            .foregroundStyle(.white.opacity(0.9))
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(Theme.stroke, lineWidth: 1))
            .padding(.bottom, 6)
            .transition(.opacity)
            .task(id: status) {
                // Transient: a stale "Relocalizing…" left on screen forever reads
                // as a hang. The first hint stays until something replaces it.
                guard status != Self.openingHint else { return }
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                if !Task.isCancelled { withAnimation { status = "" } }
            }
    }

    private func errorPill(_ error: String) -> some View {
        Text(error)
            .font(.caption)
            .foregroundStyle(.white)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(.red.opacity(0.75), in: Capsule())
            .padding(.bottom, 6)
            .transition(.opacity)
            .task(id: error) {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if !Task.isCancelled { store.lastError = nil }
            }
    }

    /// A viewer isn't offered tools that the contract would reject.
    private var viewerNotice: some View {
        Label("View-only — ask an admin for editor access", systemImage: "eye")
            .font(.caption)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(Theme.stroke, lineWidth: 1))
            .padding(.bottom)
    }

    private var toolbar: some View {
        HStack(spacing: 16) {
            placeButton("Cube", "cube", kind: "cube")
            placeButton("Sphere", "circle.fill", kind: "sphere")
            placeButton("Marker", "mappin", kind: "marker")
            scanButton
            if let id = selected {
                Button(role: .destructive) {
                    Haptics.tap()
                    Task { await store.deleteObject(id: id); selected = nil }
                } label: {
                    Image(systemName: "trash.fill")
                        .foregroundStyle(.white)
                        .frame(width: 52, height: 52)
                        .background(Color.red.gradient, in: Circle())
                }
                .buttonStyle(ScaleButtonStyle())
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Theme.stroke, lineWidth: 1))
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: selected)
        .padding(.bottom)
    }

    private func placeButton(_ title: String, _ icon: String, kind: String) -> some View {
        Button {
            Haptics.tap()
            guard let transform = ar.placementTransform() else {
                withAnimation { status = "Point at a surface, then tap" }
                return
            }
            Task { await store.addObject(kind: kind, transform: transform, color: "7A6CFF") }
        } label: {
            toolLabel(title, icon)
        }
        .buttonStyle(ScaleButtonStyle())
    }

    /// Publish this device's scan as the room's shared `ARWorldMap`, so the next
    /// device to join relocalizes into the same coordinate space instead of
    /// placing objects in its own.
    private var scanButton: some View {
        Button {
            Haptics.tap()
            guard !isPublishing else { return }
            isPublishing = true
            Task {
                defer { isPublishing = false }
                do {
                    let data = try await ar.saveWorldMap()
                    let ok = await store.publishWorldMap(data)
                    withAnimation { status = ok ? "Room scan published" : "Couldn't publish the scan" }
                } catch {
                    withAnimation { status = "Keep scanning — not enough of the room is mapped yet" }
                }
            }
        } label: {
            if isPublishing {
                ProgressView().tint(.white).frame(width: 60, height: 56)
            } else {
                toolLabel("Scan", "square.stack.3d.up.fill")
            }
        }
        .buttonStyle(ScaleButtonStyle())
    }

    private func toolLabel(_ title: String, _ icon: String) -> some View {
        VStack(spacing: 5) {
            Image(systemName: icon).font(.title3)
            Text(title).font(.caption2.weight(.medium))
        }
        .foregroundStyle(.white)
        .frame(width: 60, height: 56)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.stroke, lineWidth: 1))
    }

    // ── Session wiring ────────────────────────────────────────────────────────

    private func setup() {
        ar.start()
        ar.onCameraPose = { pos, rot in
            Task { try? await service.updatePresence(position: pos, rotation: rot) }
        }
        ar.onSelect = { id in selected = id }
        ar.sync(store.sortedObjects)

        // If the room already has a published world map, relocalize into it.
        if let blob = store.room?.worldMapBlob, !blob.isEmpty {
            status = "Relocalizing into shared room…"
            Task {
                if let data = try? await service.downloadWorldMap(blobId: blob),
                   let map = ARSessionManager.decodeWorldMap(data) {
                    await MainActor.run { ar.start(worldMap: map) }
                }
            }
        }
    }
}
#endif

private struct UnsupportedView: View {
    var body: some View {
        ContentUnavailableView("AR unavailable",
                               systemImage: "arkit",
                               description: Text("Mero AR requires an ARKit-capable device."))
    }
}
