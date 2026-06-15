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

    @StateObject private var ar = ARSessionManager()
    @State private var selected: String?
    @State private var status = "Move your device to scan the room"

    var body: some View {
        ZStack {
            ARViewContainer(manager: ar).ignoresSafeArea()

            // Center reticle for placement.
            Image(systemName: "plus.viewfinder")
                .font(.title)
                .foregroundStyle(.white.opacity(0.7))

            VStack {
                HStack {
                    statusPill
                    Spacer()
                    Button { Haptics.tap(); app.leave() } label: {
                        Label("Leave", systemImage: "xmark")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14).padding(.vertical, 9)
                            .background(.ultraThinMaterial, in: Capsule())
                            .overlay(Capsule().stroke(Theme.stroke, lineWidth: 1))
                    }
                    .buttonStyle(ScaleButtonStyle())
                }
                .padding()
                Spacer()
                toolbar
            }
        }
        .onAppear { setup() }
        .onDisappear { ar.pause() }
        .onChange(of: store.sortedObjects) { _, objs in ar.sync(objs) }
    }

    private var statusPill: some View {
        Label("\(store.objects.count) objects · \(store.presence.count) here",
              systemImage: "cube.transparent")
            .font(.caption).padding(8).background(.thinMaterial, in: Capsule())
    }

    private var toolbar: some View {
        HStack(spacing: 16) {
            placeButton("Cube", "cube", kind: "cube")
            placeButton("Sphere", "circle.fill", kind: "sphere")
            placeButton("Marker", "mappin", kind: "marker")
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
            VStack(spacing: 5) {
                Image(systemName: icon).font(.title3)
                Text(title).font(.caption2.weight(.medium))
            }
            .foregroundStyle(.white)
            .frame(width: 60, height: 56)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.stroke, lineWidth: 1))
        }
        .buttonStyle(ScaleButtonStyle())
    }

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
