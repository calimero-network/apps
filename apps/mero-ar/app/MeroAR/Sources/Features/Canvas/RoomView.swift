import MeroKit
import PhotosUI
import SwiftUI
import simd

/// The room: the live AR camera on an ARKit device, a 3D preview of the same
/// shared scene everywhere else (the Simulator, a Mac, older devices). Both
/// carry the same tools.
struct RoomView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        Group {
            if let store = app.store, let service = app.service {
                #if canImport(ARKit) && os(iOS)
                if ARSupport.isAvailable && !ARSupport.forcePreview {
                    ARRoomCanvas(store: store, service: service)
                } else {
                    PreviewRoomCanvas(store: store, service: service)
                }
                #else
                PreviewRoomCanvas(store: store, service: service)
                #endif
            } else {
                ZStack {
                    SpatialBackground()
                    VStack(spacing: 16) {
                        BrandMark(size: 56)
                        ProgressView().tint(Theme.textDim)
                        Text("Entering room…").font(.system(size: 15)).foregroundStyle(Theme.textDim)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - The canvas contract

/// What the editor needs from whichever renderer shows the room.
@MainActor
protocol RoomCanvas: AnyObject {
    /// Where a new object goes, or nil when there is nowhere to put it yet.
    func placementTransform(count: Int) -> Transform?
    /// Mirror the shared scene.
    func sync(objects: [SceneObject], selected: String?, presence: [Presence], comments: [SpatialComment], me: String)
    var onSelect: ((String?) -> Void)? { get set }
    /// Called when an object was dragged to a new floor position.
    var onMove: ((String, SIMD3<Float>) -> Void)? { get set }
    /// Show the room's 3D scan (nil: none).
    func showRoom(_ model: RoomModel?)
    /// Top-down floor plan instead of the orbit view.
    func setFloorPlan(_ on: Bool)
}

extension Transform {
    func moved(_ dx: Double, _ dy: Double, _ dz: Double) -> Transform {
        var t = self
        t.position = Vec3(position.x + dx, position.y + dy, position.z + dz)
        return t
    }

    func rotatedY(_ degrees: Float) -> Transform {
        var t = self
        let turn = simd_quatf(angle: degrees * .pi / 180, axis: SIMD3(0, 1, 0))
        t.rotation = Quat(turn * rotation.simd)
        return t
    }

    func scaled(_ factor: Double) -> Transform {
        var t = self
        let clamp = { (v: Double) in min(max(v * factor, 0.2), 6) }
        t.scale = Vec3(clamp(scale.x), clamp(scale.y), clamp(scale.z))
        return t
    }

    /// How furniture is placed: upright, at real size (scale 1), where the
    /// placement landed — on the floor (y = 0) unless `keepHeight` (live AR,
    /// where the camera found a surface).
    func standing(keepHeight: Bool) -> Transform {
        var p = position
        if !keepHeight { p.y = 0 }
        return .at(p)
    }

    /// An identity transform at `position`.
    static func at(_ position: Vec3) -> Transform {
        Transform(position: position, rotation: Quat(0, 0, 0, 1), scale: Vec3(1, 1, 1))
    }
}

/// The kinds the library offers.
enum ObjectKind: String, CaseIterable, Identifiable {
    case cube, sphere, arrow, marker, text

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var symbol: String {
        switch self {
        case .cube: return "cube.fill"
        case .sphere: return "circle.fill"
        case .arrow: return "arrow.up.forward"
        case .marker: return "mappin"
        case .text: return "textformat"
        }
    }

    static func symbol(for kind: String) -> String { ObjectKind(rawValue: kind)?.symbol ?? "cube.fill" }

    /// The icon for any object: its furniture piece, a photo, or its shape.
    static func symbol(for data: ObjectData) -> String {
        if let piece = data.furniture { return piece.symbol }
        if data.kind == "image" { return "photo.artframe" }
        return symbol(for: data.kind)
    }
}

/// What the library hands back to place.
enum LibraryChoice {
    case shape(ObjectKind, color: String)
    case label(String, color: String)
    case furniture(FurnitureItem)
    /// A photo's bytes, straight from the picker.
    case photo(Data)
}

// MARK: - The editor (shared chrome)

/// The tools over the room, the same over the camera and over the preview.
struct RoomEditor<Canvas: View>: View {
    @EnvironmentObject private var app: AppState
    @ObservedObject var store: SceneStore
    let service: MeroARService
    let controller: RoomCanvas
    let isLiveAR: Bool
    @Binding var status: String
    var shareScan: (() -> Void)?
    var isPublishing = false
    /// A dock button that swaps between the live camera and the 3D room.
    var switchView: (title: String, icon: String, action: () -> Void)?
    @ViewBuilder var canvas: Canvas

    @State private var selected: String?
    @State private var showLibrary = false
    @State private var showMembers = false
    @State private var showComments = false
    /// When something was last placed or posted: Return can deliver a submit
    /// twice, and the second must not add a duplicate.
    @State private var lastAdd = Date.distantPast
    @State private var floorPlan = false
    @State private var showScan = false
    #if canImport(UIKit)
    @ObservedObject private var pictures = PictureCache.shared
    #endif

    var body: some View {
        ZStack {
            canvas.ignoresSafeArea()

            if isLiveAR && store.canEdit && selected == nil {
                Image(systemName: "plus.viewfinder")
                    .font(.system(size: 34, weight: .ultraLight))
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.4), radius: 6)
                    .accessibilityHidden(true)
            }

            VStack(spacing: 10) {
                RoomTopBar(store: store, showMembers: $showMembers) { roomMenu }
                if !isLiveAR { previewBanner }
                if let model = store.roomModel, !isLiveAR { roomPill(model) }
                Spacer()
                if !status.isEmpty { notice(status, icon: "viewfinder", tone: .neutral) }
                if let error = store.lastError { errorNotice(error) }
                if let id = selected, let object = store.objects[id] {
                    Inspector(store: store, object: object) { selected = nil }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    if store.roomModel == nil && store.canEdit && !isLiveAR { addRoomPrompt }
                    dock.transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .padding(.bottom, 8)
            .animation(.spring(response: 0.42, dampingFraction: 0.86), value: selected)
            .animation(.easeOut(duration: 0.2), value: status)
            .animation(.easeOut(duration: 0.2), value: store.lastError)
        }
        .sheet(isPresented: $showLibrary) {
            ObjectLibrary(canAddPhotos: service.hasBearerSession) { choice in place(choice) }
                .presentationDetents([.large, .medium])
                .presentationBackground(.ultraThinMaterial)
                .presentationCornerRadius(32)
        }
        .sheet(isPresented: $showMembers) {
            MembersSheet(store: store).presentationBackground(.ultraThinMaterial).presentationCornerRadius(32)
        }
        .sheet(isPresented: $showComments) {
            CommentsSheet(store: store) { text in
                guard Date().timeIntervalSince(lastAdd) > 0.8 else { return }
                lastAdd = Date()
                let anchor = selected.flatMap { store.objects[$0]?.transform.position } ?? Vec3(0, 0.3, -0.6)
                Task { await store.addComment(text: text, position: anchor) }
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(.ultraThinMaterial)
            .presentationCornerRadius(32)
        }
        .onAppear {
            controller.onSelect = { id in
                Haptics.soft()
                selected = id
            }
            controller.onMove = { id, point in
                Haptics.soft()
                Task { await store.move(id: id, to: point) }
            }
            controller.showRoom(store.roomModel)
            resync()
        }
        .onChange(of: store.roomModel) { _, model in
            controller.showRoom(model)
            if model == nil { floorPlan = false }
        }
        .onChange(of: floorPlan) { _, on in controller.setFloorPlan(on) }
        .fullScreenCover(isPresented: $showScan) {
            #if canImport(RoomPlan) && os(iOS)
            RoomScanFlow(store: store)
            #else
            EmptyView()
            #endif
        }
        .onChange(of: store.sortedObjects) { _, _ in resync() }
        .onChange(of: store.comments) { _, _ in resync() }
        .onChange(of: store.presence) { _, _ in resync() }
        .onChange(of: selected) { _, _ in resync() }
        #if canImport(UIKit)
        .onChange(of: pictures.version) { _, _ in resync() }
        #endif
    }

    private func resync() {
        if let id = selected, store.objects[id] == nil { selected = nil }
        #if canImport(UIKit)
        for object in store.objects.values where object.data.kind == "image" {
            if let blob = object.data.blobId { pictures.request(blob, service: service) }
        }
        #endif
        controller.sync(
            objects: store.sortedObjects, selected: selected, presence: Array(store.presence.values),
            comments: store.comments, me: store.memberId)
    }

    private func place(_ choice: LibraryChoice) {
        guard Date().timeIntervalSince(lastAdd) > 0.8 else { return }
        lastAdd = Date()
        showLibrary = false
        guard let transform = controller.placementTransform(count: store.objects.count) else {
            status = "Point at a surface, then add"
            Haptics.error()
            return
        }
        Haptics.success()
        switch choice {
        case .shape(let kind, let color):
            Task { await store.addObject(kind: kind.rawValue, transform: transform, color: color) }
        case .label(let text, let color):
            Task { await store.addObject(kind: ObjectKind.text.rawValue, content: text, transform: transform, color: color) }
        case .furniture(let piece):
            Task {
                await store.addObject(
                    data: ObjectData(furniture: piece), transform: standing(transform), color: piece.defaultColor)
            }
        case .photo(let data):
            #if canImport(UIKit)
            status = "Hanging your photo…"
            Task {
                guard let prepared = await Task.detached(operation: { PictureCache.prepare(data) }).value else {
                    store.lastError = "That photo couldn't be read. Try another one."
                    return
                }
                await store.addPicture(
                    jpeg: prepared.jpeg, width: prepared.width, height: prepared.height, transform: standing(transform))
                if store.lastError == nil { status = "Photo hung for everyone here" }
            }
            #endif
        }
    }

    /// Furniture stands upright at real size: on the floor in the 3D room, at
    /// the surface the camera found in live AR. Not the ×3 the preview gives
    /// tabletop shapes.
    private func standing(_ transform: Transform) -> Transform { transform.standing(keepHeight: isLiveAR) }

    // MARK: The 3D room

    /// What can be done with the room's 3D scan.
    @ViewBuilder private var roomMenu: some View {
        Menu {
            if store.canEdit {
                if RoomScanSupport.isSupported {
                    Button {
                        showScan = true
                    } label: {
                        Label(store.roomModel == nil ? "Scan this room" : "Rescan this room", systemImage: "camera.metering.matrix")
                    }
                } else {
                    Section(RoomScanSupport.unsupportedReason) {}
                }
                Button {
                    tryTheSampleRoom()
                } label: {
                    Label("Try a sample room", systemImage: "sofa")
                }
            }
            if store.canEdit, let model = store.roomModel,
                model.objects.contains(where: { FurnitureItem.forScanCategory($0.category) != nil })
            {
                Button {
                    makeScanMovable()
                } label: {
                    Label("Make scanned furniture movable", systemImage: "hand.draw")
                }
            }
            if store.roomModel != nil && !isLiveAR {
                Button {
                    floorPlan.toggle()
                } label: {
                    Label(floorPlan ? "3D view" : "Floor plan", systemImage: floorPlan ? "cube" : "square.split.bottomrightquarter")
                }
            }
            if isLiveAR, store.canEdit, let shareScan {
                Button(action: shareScan) {
                    Label("Align to my room", systemImage: "scope")
                }
            }
            if store.isAdmin && store.roomScan != nil {
                Button(role: .destructive) {
                    Task { await store.clearRoomScan() }
                } label: {
                    Label("Remove the 3D room", systemImage: "trash")
                }
            }
        } label: {
            Image(systemName: "house.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.text)
                .frame(width: 44, height: 44)
                .modifier(Glass(shape: Circle()))
        }
        .accessibilityLabel("Room")
        .accessibilityIdentifier("roomMenuButton")
    }

    private func makeScanMovable() {
        Haptics.tap()
        Task {
            let count = await store.makeScannedFurnitureMovable()
            if count > 0 {
                Haptics.success()
                status = "\(count) piece\(count == 1 ? "" : "s") of furniture can be moved now"
            }
        }
    }

    private func tryTheSampleRoom() {
        guard let sample = RoomModel.sampleLivingRoom() else {
            store.lastError = "The sample room is missing from this build."
            return
        }
        Haptics.tap()
        Task {
            if await store.publishRoomScan(sample) {
                Haptics.success()
                status = "Sample room shared with everyone here"
            }
        }
    }

    private func roomPill(_ model: RoomModel) -> some View {
        let size = String(format: "%.1f × %.1f m", model.width, model.length)
        let who = store.roomScan.map { store.name(of: $0.scannedBy) } ?? ""
        return ARChip {
            Label(
                model.sample ? "Sample room · \(size)" : "Scanned by \(who) · \(size)",
                systemImage: model.sample ? "sofa" : "camera.metering.matrix")
                .font(.system(size: 12.5, weight: .semibold))
        }
        .accessibilityIdentifier("roomScanPill")
    }

    private var addRoomPrompt: some View {
        Menu {
            if RoomScanSupport.isSupported {
                Button {
                    showScan = true
                } label: {
                    Label("Scan this room", systemImage: "camera.metering.matrix")
                }
            }
            Button {
                tryTheSampleRoom()
            } label: {
                Label("Try a sample room", systemImage: "sofa")
            }
        } label: {
            HStack(spacing: 10) {
                if store.isPublishingScan {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "house.fill")
                }
                Text(store.isPublishingScan ? "Sharing the room…" : "Add your room in 3D")
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .padding(.vertical, 11)
            .background(Capsule().fill(Theme.aurora))
            .shadow(color: Theme.violet.opacity(0.45), radius: 12, y: 4)
        }
        .accessibilityIdentifier("addRoomPrompt")
    }

    private var previewBanner: some View {
        ARChip {
            Label("3D preview · live AR needs an ARKit iPhone or iPad", systemImage: "cube.transparent")
                .font(.system(size: 12.5, weight: .semibold))
        }
        .accessibilityIdentifier("previewBanner")
    }

    private var dock: some View {
        HStack(spacing: 14) {
            if store.canEdit {
                dockButton("Add", "plus", gradient: true, id: "addObjectButton") { showLibrary = true }
            }
            dockButton("Notes", "text.bubble.fill", badge: store.comments.count, id: "commentsButton") {
                showComments = true
            }
            if isLiveAR, store.canEdit, let shareScan {
                dockButton(isPublishing ? "Sharing" : "Share scan", "square.stack.3d.up.fill", id: "shareScanButton") {
                    shareScan()
                }
            }
            if !isLiveAR, store.roomModel != nil {
                dockButton(floorPlan ? "3D" : "Plan", floorPlan ? "cube.fill" : "square.split.bottomrightquarter.fill", id: "floorPlanButton") {
                    floorPlan.toggle()
                }
            }
            if let switchView {
                dockButton(switchView.title, switchView.icon, id: "switchViewButton", action: switchView.action)
            }
            dockButton("People", "person.2.fill", id: "peopleButton") { showMembers = true }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .glass(cornerRadius: Theme.Radius.dock, strong: true)
        .overlay(alignment: .top) {
            if !store.canEdit && store.myRole == "viewer" {
                Pill(text: "View only", tone: .warning).offset(y: -14)
            }
        }
    }

    private func dockButton(
        _ title: String, _ icon: String, gradient: Bool = false, badge: Int = 0, id: String,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 54, height: 54)
                    .background(
                        Circle().fill(gradient ? AnyShapeStyle(Theme.aurora) : AnyShapeStyle(Theme.glassFillStrong))
                    )
                    .overlay(Circle().strokeBorder(Color.white.opacity(gradient ? 0.35 : 0.14), lineWidth: 1))
                    .shadow(color: gradient ? Theme.violet.opacity(0.5) : .clear, radius: 12, y: 4)
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 {
                            Text("\(badge)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Capsule().fill(Theme.pink))
                                .offset(x: 4, y: -2)
                        }
                    }
                Text(title).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(Theme.textDim)
            }
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier(id)
    }

    private func notice(_ text: String, icon: String, tone: Tone) -> some View {
        ARChip {
            Label(text, systemImage: icon).foregroundStyle(tone == .danger ? Theme.danger : Theme.text)
        }
        .padding(.horizontal, Theme.gutter)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .task(id: text) {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if !Task.isCancelled && status == text { status = "" }
        }
    }

    private func errorNotice(_ error: String) -> some View {
        ARChip {
            Label(error, systemImage: "exclamationmark.octagon.fill")
                .foregroundStyle(Theme.danger)
                .multilineTextAlignment(.leading)
        }
        .padding(.horizontal, Theme.gutter)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .task(id: error) {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if !Task.isCancelled { store.lastError = nil }
        }
    }
}

// MARK: - Top bar

/// Room name, live state, who's here, and leave.
private struct RoomTopBar<Menu: View>: View {
    @EnvironmentObject private var app: AppState
    @ObservedObject var store: SceneStore
    @Binding var showMembers: Bool
    @ViewBuilder var menu: Menu

    var body: some View {
        HStack(spacing: 10) {
            Button {
                Haptics.tap()
                app.leaveRoom()
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(CircleButtonStyle())
            .accessibilityLabel("Leave room")
            .accessibilityIdentifier("leaveButton")

            VStack(alignment: .leading, spacing: 3) {
                Text(roomName).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.text).lineLimit(1)
                HStack(spacing: 6) {
                    Circle().fill(store.isLive ? Theme.success : Theme.warning).frame(width: 7, height: 7)
                    Text("\(store.objects.count) objects · \(store.onlineMembers.count) here")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textDim)
                        .monospacedDigit()
                }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 16)
            .glassCapsule()
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("roomStatus")

            Spacer(minLength: 6)

            menu

            Button {
                Haptics.tap()
                showMembers = true
            } label: {
                AvatarStack(people: people, size: 30)
                    .padding(6)
                    .glassCapsule()
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Members")
            .accessibilityIdentifier("membersButton")
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 6)
    }

    private var roomName: String {
        guard let name = store.room?.name, !name.isEmpty else { return "Room" }
        return name
    }

    private var people: [(id: String, name: String)] {
        let online = store.onlineMembers
        let here = store.members.filter { online.contains($0.id) || $0.id == store.memberId }
        let list = here.isEmpty ? [(store.memberId, app.effectiveDisplayName)] : here.map { ($0.id, $0.username) }
        return list.map { (id: $0.0, name: $0.1) }
    }
}

// MARK: - Inspector

/// The selected object: nudge, turn, resize, paint, lock, delete.
private struct Inspector: View {
    @ObservedObject var store: SceneStore
    let object: SceneObject
    let close: () -> Void

    private var lockedByOther: Bool { store.isLockedByOther(object.id) }
    private var lockedByMe: Bool { object.lockedBy == store.memberId }
    private var editable: Bool { store.canEdit && !lockedByOther }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                IconTile(systemName: ObjectKind.symbol(for: object.data), size: 40, gradient: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(object.data.displayTitle)
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.text).lineLimit(1)
                    Text(lockedByOther ? "Locked by \(store.name(of: object.lockedBy ?? ""))" : "Placed by \(store.name(of: object.createdBy))")
                        .font(.system(size: 12.5)).foregroundStyle(lockedByOther ? Theme.warning : Theme.textFaint)
                }
                Spacer()
                Button(action: close) { Image(systemName: "xmark") }
                    .buttonStyle(CircleButtonStyle(size: 36))
                    .accessibilityLabel("Done")
                    .accessibilityIdentifier("closeInspectorButton")
            }

            if editable {
                HStack(spacing: 8) {
                    nudge("arrow.left", "nudge-left") { $0.moved(-0.1, 0, 0) }
                    nudge("arrow.right", "nudge-right") { $0.moved(0.1, 0, 0) }
                    nudge("arrow.up", "nudge-forward") { $0.moved(0, 0, -0.1) }
                    nudge("arrow.down", "nudge-back") { $0.moved(0, 0, 0.1) }
                    nudge("arrow.up.to.line", "nudge-up") { $0.moved(0, 0.05, 0) }
                    nudge("rotate.right", "rotate") { $0.rotatedY(22.5) }
                    nudge("plus.magnifyingglass", "grow") { $0.scaled(1.2) }
                    nudge("minus.magnifyingglass", "shrink") { $0.scaled(1 / 1.2) }
                }
                HStack(spacing: 10) {
                    ForEach(Theme.objectColors, id: \.self) { hex in
                        Button {
                            Haptics.soft()
                            Task { await store.updateColor(id: object.id, color: hex) }
                        } label: {
                            Circle()
                                .fill(Color(hexString: hex))
                                .frame(width: 28, height: 28)
                                .overlay(
                                    Circle().strokeBorder(.white, lineWidth: object.color.uppercased() == hex ? 2.5 : 0)
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Colour \(hex)")
                    }
                    Spacer()
                }
            }

            HStack(spacing: 10) {
                if store.canEdit && !lockedByOther {
                    Button {
                        Haptics.tap()
                        Task { await store.setLocked(id: object.id, !lockedByMe) }
                    } label: {
                        ButtonLabel(title: lockedByMe ? "Unlock" : "Lock", icon: lockedByMe ? "lock.open.fill" : "lock.fill")
                    }
                    .buttonStyle(GlassButtonStyle(height: 46))
                    .accessibilityIdentifier("lockObjectButton")
                    Button {
                        Haptics.tap()
                        Task {
                            await store.deleteObject(id: object.id)
                            close()
                        }
                    } label: {
                        ButtonLabel(title: "Delete", icon: "trash.fill")
                    }
                    .buttonStyle(GlassButtonStyle(height: 46, destructive: true))
                    .accessibilityIdentifier("deleteObjectButton")
                }
            }
        }
        .padding(18)
        .glass(cornerRadius: Theme.Radius.dock, strong: true)
        .padding(.horizontal, Theme.gutter)
        // `.contain` keeps each control's own identifier; a bare identifier on
        // the panel would replace all of theirs.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("inspector")
    }

    private func nudge(_ icon: String, _ id: String, _ change: @escaping (Transform) -> Transform) -> some View {
        Button {
            Haptics.soft()
            Task { await store.updateTransform(id: object.id, transform: change(object.transform)) }
        } label: {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.text)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.glassFillStrong))
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier(id)
    }
}

// MARK: - Object library

/// Pick furniture, a photo, a shape or a label to place.
private struct ObjectLibrary: View {
    /// Photos travel as blobs, which need the relay's Bearer session.
    let canAddPhotos: Bool
    let place: (LibraryChoice) -> Void
    @State private var color = Theme.objectColorHex
    @State private var text = ""
    @State private var photo: PhotosPickerItem?
    @State private var loadingPhoto = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SheetHeader(title: "Add to the room", subtitle: "Everyone in the room sees it at once.")

                Eyebrow(text: "Furniture")
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(FurnitureItem.allCases) { piece in
                        tile(title: piece.title, symbol: piece.symbol, tint: Theme.text, id: "place-furniture-\(piece.rawValue)") {
                            place(.furniture(piece))
                        }
                    }
                }

                Eyebrow(text: "Your photos")
                photoRow

                Eyebrow(text: "Shapes and labels")
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(ObjectKind.allCases.filter { $0 != .text }) { kind in
                        tile(title: kind.title, symbol: kind.symbol, tint: Color(hexString: color), id: "place-\(kind.rawValue)") {
                            place(.shape(kind, color: color))
                        }
                    }
                }
                HStack(spacing: 10) {
                    TextInput(placeholder: "Add a 3D label", text: $text, icon: "textformat", identifier: "labelInput")
                        .submitLabel(.done)
                        .onSubmit {
                            if !text.trimmingCharacters(in: .whitespaces).isEmpty { place(.label(text, color: color)) }
                        }
                    Button {
                        place(.label(text, color: color))
                    } label: {
                        Image(systemName: "arrow.up")
                    }
                    .buttonStyle(CircleButtonStyle(size: 54, active: true))
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityLabel("Place label")
                    .accessibilityIdentifier("place-text")
                }
                HStack(spacing: 12) {
                    ForEach(Theme.objectColors, id: \.self) { hex in
                        Button {
                            Haptics.soft()
                            color = hex
                        } label: {
                            Circle().fill(Color(hexString: hex)).frame(width: 30, height: 30)
                                .overlay(Circle().strokeBorder(.white, lineWidth: color == hex ? 2.5 : 0))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Colour \(hex)")
                    }
                }
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
        .onChange(of: photo) { _, item in
            guard let item else { return }
            loadingPhoto = true
            Task {
                let data = try? await item.loadTransferable(type: Data.self)
                loadingPhoto = false
                photo = nil
                if let data { place(.photo(data)) }
            }
        }
    }

    @ViewBuilder private var photoRow: some View {
        if canAddPhotos {
            PhotosPicker(selection: $photo, matching: .images) {
                HStack(spacing: 14) {
                    IconTile(systemName: "photo.on.rectangle.angled", size: 44, gradient: true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Hang a photo").font(Theme.title(17)).foregroundStyle(Theme.text)
                        Text("Framed on the wall, for everyone in the room")
                            .font(.system(size: 13)).foregroundStyle(Theme.textFaint)
                    }
                    Spacer()
                    if loadingPhoto { ProgressView().tint(Theme.textDim) }
                }
                .padding(14)
                .glass(cornerRadius: 20)
            }
            .buttonStyle(PressableStyle())
            .accessibilityIdentifier("place-photo")
        } else {
            Callout(
                tone: .info, title: "Photos need a live connection",
                message: "Your relay's session isn't up yet, so photos can't be shared. Furniture and shapes still work.")
        }
    }

    private func tile(title: String, symbol: String, tint: Color, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(height: 28)
                Text(title).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Theme.text)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: 86)
            .glass(cornerRadius: 20)
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier(id)
    }
}

// MARK: - Comments

/// Notes pinned in the room.
private struct CommentsSheet: View {
    @ObservedObject var store: SceneStore
    let add: (String) -> Void
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SheetHeader(title: "Notes", subtitle: "Pinned to a spot in the room, visible to everyone in it.")
            ScrollView {
                VStack(spacing: 10) {
                    if store.comments.isEmpty {
                        EmptyState(
                            icon: "text.bubble", title: "No notes yet",
                            message: "Select an object to pin a note next to it, or leave one in the room.")
                    }
                    ForEach(store.comments) { comment in
                        HStack(alignment: .top, spacing: 12) {
                            Avatar(id: comment.author, name: store.name(of: comment.author), size: 34)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(store.name(of: comment.author))
                                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textDim)
                                Text(comment.text).font(.system(size: 15)).foregroundStyle(Theme.text)
                            }
                            Spacer()
                            if comment.author == store.memberId || store.isAdmin {
                                Button {
                                    Task { await store.deleteComment(id: comment.id) }
                                } label: {
                                    Image(systemName: "trash").font(.system(size: 13))
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(Theme.textFaint)
                                .accessibilityLabel("Delete note")
                            }
                        }
                        .padding(14)
                        .glass(cornerRadius: 20)
                    }
                }
            }
            if store.canEdit {
                HStack(spacing: 10) {
                    TextInput(placeholder: "Write a note", text: $draft, icon: "text.bubble", identifier: "commentInput")
                        .submitLabel(.send)
                        .onSubmit(post)
                    Button(action: post) {
                        Image(systemName: "arrow.up")
                    }
                    .buttonStyle(CircleButtonStyle(size: 54, active: true))
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityLabel("Post note")
                    .accessibilityIdentifier("postCommentButton")
                }
            }
        }
        .padding(24)
        .preferredColorScheme(.dark)
        .task { await store.refreshComments() }
    }

    private func post() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        Haptics.tap()
        add(text)
    }
}

// MARK: - Preview canvas (no AR)

struct PreviewRoomCanvas: View {
    @ObservedObject var store: SceneStore
    let service: MeroARService
    /// In live AR, the way back from the 3D room to the camera.
    var backToCamera: (() -> Void)?
    @StateObject private var preview = PreviewScene()
    @State private var status = ""

    var body: some View {
        RoomEditor(
            store: store, service: service, controller: preview, isLiveAR: false, status: $status,
            switchView: backToCamera.map { back in (title: "Camera", icon: "camera.fill", action: back) }
        ) {
            ZStack {
                SpatialBackground(animated: false)
                PreviewSceneView(scene: preview)
            }
        }
        .task {
            // The preview's own viewpoint counts as being in the room: a pose
            // once the join has landed, then a slow heartbeat.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if !store.myRole.isEmpty {
                    store.sendPresence(position: Vec3(0, 1.55, 1.75), rotation: Quat(0, 0, 0, 1))
                    try? await Task.sleep(nanoseconds: 8_000_000_000)
                }
            }
        }
    }
}

// MARK: - AR canvas

#if canImport(ARKit) && os(iOS)
import ARKit

enum ARSupport {
    static var isAvailable: Bool { ARWorldTrackingConfiguration.isSupported }
    /// `MEROAR_PREVIEW=1` shows the 3D preview even on an ARKit device.
    static var forcePreview: Bool { ProcessInfo.processInfo.environment["MEROAR_PREVIEW"] == "1" }
}

struct ARRoomCanvas: View {
    @ObservedObject var store: SceneStore
    let service: MeroARService

    @StateObject private var ar = ARSessionManager()
    @State private var status = "Move your phone slowly to scan the room"
    @State private var isPublishing = false
    /// Showing the room's 3D scan instead of the camera.
    @State private var showRoom3D = false

    var body: some View {
        if showRoom3D {
            PreviewRoomCanvas(store: store, service: service) { showRoom3D = false }
        } else {
            RoomEditor(
                store: store, service: service, controller: ar, isLiveAR: true, status: $status,
                shareScan: shareScan, isPublishing: isPublishing,
                switchView: store.roomModel == nil ? nil : (title: "3D room", icon: "house.fill", action: { showRoom3D = true })
            ) {
                ARViewContainer(manager: ar)
            }
            .onAppear(perform: setup)
            .onDisappear { ar.pause() }
        }
    }

    private func setup() {
        ar.start()
        ar.onCameraPose = { pos, rot in
            Task { @MainActor in store.sendPresence(position: pos, rotation: rot) }
        }
        // If the room already has a shared scan, relocalize into it.
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

    /// Publish this device's scan as the room's shared `ARWorldMap`, so the
    /// next device to join relocalizes into the same coordinate space.
    private func shareScan() {
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
                status = "Keep scanning: not enough of the room is mapped yet"
            }
        }
    }
}
#endif
