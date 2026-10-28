import MeroKit
import MerrariaCore
import SwiftUI
import UIKit

/// One world, full screen: the bundled game, with the touch controls over it. The screen stays
/// awake while it is open, and the game pauses (and saves) when the app leaves the foreground.
struct GameScreen: View {
    let backend: any MeroAppBackend
    let onClose: () -> Void
    @StateObject private var model: GameModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var pageID = UUID()

    init(backend: any MeroAppBackend, ref: WorldRef, settings: PlayerSettings, onClose: @escaping () -> Void) {
        self.backend = backend
        self.onClose = onClose
        _model = StateObject(wrappedValue: GameModel(backend: backend, ref: ref, settings: settings))
    }

    var body: some View {
        ZStack {
            Theme.gameGround.ignoresSafeArea()
            GameWebView(model: model)
                .id(pageID)
                .ignoresSafeArea()
            // Taps on the world pick the tile the mine and place buttons act on.
            Color.clear
                .contentShape(Rectangle())
                .ignoresSafeArea()
                .gesture(
                    SpatialTapGesture().onEnded { value in
                        Haptics.select()
                        model.tap(x: value.location.x, y: value.location.y)
                    })
            ControlsOverlay(model: model)
            switch model.phase {
            case .loading:
                LoadingCover(name: model.ref.name) { close() }
            case .failed(let message):
                FailedCover(message: message, onRetry: retry) { close() }
            case .playing, .left:
                EmptyView()
            }
            if model.paused && model.phase == .playing {
                PauseMenu(model: model, backend: backend)
            }
        }
        .persistentSystemOverlays(.hidden)
        .task { await model.start() }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            model.stop()
        }
        .onChange(of: scenePhase) { phase in
            if phase != .active { model.pause() }
        }
        .onChange(of: model.phase) { phase in
            if phase == .left { onClose() }
        }
    }

    private func retry() {
        model.retry()
        pageID = UUID()
    }

    private func close() {
        model.stop()
        onClose()
    }
}

// MARK: - Controls

/// D-pad bottom left, hotbar bottom centre, mine / place / jump bottom right, pause top left.
private struct ControlsOverlay: View {
    @ObservedObject var model: GameModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                RoundControl(icon: "pause.fill", label: "Pause", size: 44) {
                    Haptics.tap()
                    model.pause()
                }
                Spacer()
            }
            .overlay(alignment: .top) {
                if model.phase == .playing && !model.connected {
                    HStack(spacing: 8) {
                        ProgressView().tint(.white).controlSize(.small)
                        Text("Syncing the world…").font(Theme.body(13, .medium)).foregroundStyle(.white)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(Theme.control))
                    .overlay(Capsule().strokeBorder(Theme.controlLine, lineWidth: Theme.hairline))
                }
            }
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 12) {
                HStack(spacing: 8) {
                    HoldControl(icon: "chevron.left", label: "Move left", size: 62, shape: .rounded) {
                        model.press(.left)
                    } onRelease: {
                        model.release(.left)
                    }
                    HoldControl(icon: "chevron.right", label: "Move right", size: 62, shape: .rounded) {
                        model.press(.right)
                    } onRelease: {
                        model.release(.right)
                    }
                }
                Spacer(minLength: 0)
                Hotbar(slots: model.slots, selected: model.selected) { slot in
                    Haptics.select()
                    model.select(slot)
                }
                Spacer(minLength: 0)
                HStack(alignment: .bottom, spacing: 10) {
                    VStack(spacing: 10) {
                        HoldControl(icon: "plus.square.fill", label: "Place", size: 52) {
                            Haptics.soft()
                            model.press(.place)
                        } onRelease: {
                            model.release(.place)
                        }
                        HoldControl(icon: "hammer.fill", label: "Mine", size: 52) {
                            Haptics.soft()
                            model.press(.mine)
                        } onRelease: {
                            model.release(.mine)
                        }
                    }
                    HoldControl(icon: "arrow.up", label: "Jump", size: 70) {
                        Haptics.tap()
                        model.press(.jump)
                    } onRelease: {
                        model.release(.jump)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .opacity(model.phase == .playing ? 1 : 0)
        .allowsHitTesting(model.phase == .playing && !model.paused)
    }
}

/// A button that acts while a finger is on it: lime while held, dark glass otherwise.
private struct HoldControl: View {
    enum Shape { case circle, rounded }

    let icon: String
    let label: String
    let size: CGFloat
    var shape: Shape = .circle
    let onPress: () -> Void
    let onRelease: () -> Void
    @State private var held = false

    var body: some View {
        let fill = held ? Theme.lime : Theme.control
        let glyph = Image(systemName: icon)
            .font(.system(size: size * 0.38, weight: .bold))
            .foregroundStyle(held ? Theme.ink : Color.white)
        Group {
            switch shape {
            case .circle:
                Circle().fill(fill)
                    .overlay(Circle().strokeBorder(Theme.controlLine, lineWidth: Theme.hairline))
            case .rounded:
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(fill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(Theme.controlLine, lineWidth: Theme.hairline))
            }
        }
        .overlay(glyph)
        .frame(width: size, height: size)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !held else { return }
                    held = true
                    onPress()
                }
                .onEnded { _ in
                    held = false
                    onRelease()
                }
        )
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
    }
}

/// A plain tap button in the controls' style.
private struct RoundControl: View {
    let icon: String
    let label: String
    let size: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Circle().fill(Theme.control)
                .overlay(Circle().strokeBorder(Theme.controlLine, lineWidth: Theme.hairline))
                .overlay(
                    Image(systemName: icon).font(.system(size: size * 0.36, weight: .bold)).foregroundStyle(.white))
                .frame(width: size, height: size)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// The hotbar: each placeable tile with how many the player holds. Tap to pick what Place puts down.
private struct Hotbar: View {
    let slots: [HudSlot]
    let selected: Int
    let onSelect: (Int) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(slots.enumerated()), id: \.offset) { index, slot in
                    Button {
                        onSelect(index)
                    } label: {
                        VStack(spacing: 2) {
                            TileSwatch(color: slot.color, size: 18)
                            Text("\(slot.count)").font(.system(size: 11, weight: .bold, design: .rounded))
                                .foregroundStyle(index == selected ? Theme.ink : .white)
                                .monospacedDigit()
                        }
                        .frame(width: 38, height: 44)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(index == selected ? Theme.lime : Theme.control))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(index == selected ? Theme.ink : Theme.controlLine, lineWidth: Theme.hairline))
                        .opacity(slot.count == 0 && index != selected ? 0.6 : 1)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(slot.name), \(slot.count)")
                    .accessibilityAddTraits(index == selected ? .isSelected : [])
                }
            }
            .padding(4)
        }
        .frame(maxWidth: 9 * 42 + 8)
        .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Covers

private struct LoadingCover: View {
    let name: String
    let onClose: () -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            Theme.gameGround.ignoresSafeArea()
            VStack(spacing: 16) {
                AppMark(size: 56)
                ProgressView().tint(.white)
                Text("Loading \(name)…").font(Theme.body(15, .medium)).foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            RoundControl(icon: "xmark", label: "Close", size: 44, action: onClose)
                .padding(.horizontal, 16)
                .padding(.top, 10)
        }
    }
}

private struct FailedCover: View {
    let message: String
    let onRetry: () -> Void
    let onClose: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.danger)
                    Text("Could not open this world").font(Theme.heading(18)).foregroundStyle(Theme.ink)
                }
                Text(message).font(Theme.body(14)).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(6)
                HStack(spacing: 10) {
                    Button("Back to worlds", action: onClose).buttonStyle(SecondaryButtonStyle())
                    Button("Try again") {
                        Haptics.tap()
                        onRetry()
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
            }
            .card(padding: 20)
            .frame(maxWidth: 440)
            .padding(24)
        }
    }
}

// MARK: - Pause menu

/// Paused: back to the game, invite friends, zoom, the world's ids behind Details, leave.
private struct PauseMenu: View {
    @ObservedObject var model: GameModel
    let backend: any MeroAppBackend
    @State private var share: SharedLink?
    @State private var inviting = false
    @State private var leaving = false
    @State private var error: String?
    @State private var zoom = MerrariaConstants.defaultZoom

    var body: some View {
        ZStack {
            Color.black.opacity(0.5).ignoresSafeArea()
                .onTapGesture { model.resume() }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 12) {
                        AppMark(size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.ref.name).font(Theme.heading(19)).foregroundStyle(Theme.ink).lineLimit(1)
                            Text("Paused · the world keeps going for everyone else")
                                .font(Theme.body(13)).foregroundStyle(Theme.muted)
                        }
                    }
                    if let error { ErrorBanner(message: error) { self.error = nil } }
                    HStack(spacing: 10) {
                        Button {
                            invite()
                        } label: {
                            HStack(spacing: 8) {
                                if inviting {
                                    ProgressView().tint(Theme.ink)
                                } else {
                                    Image(systemName: "square.and.arrow.up")
                                }
                                Text("Invite friends")
                            }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(inviting || leaving)
                        Button {
                            Haptics.tap()
                            model.resume()
                        } label: {
                            Label("Back to game", systemImage: "play.fill")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(leaving)
                    }
                    HStack(spacing: 12) {
                        Image(systemName: "minus.magnifyingglass").foregroundStyle(Theme.muted)
                        Slider(value: $zoom, in: MerrariaConstants.zoomRange, step: 0.1)
                        .tint(Theme.ink)
                        .onChange(of: zoom) { model.setZoom($0) }
                        Image(systemName: "plus.magnifyingglass").foregroundStyle(Theme.muted)
                        Text(String(format: "%.1f×", zoom)).font(Theme.mono).foregroundStyle(Theme.ink2)
                            .frame(width: 40, alignment: .trailing)
                    }
                    DisclosureGroup("Details") {
                        VStack(spacing: 10) {
                            DetailRow(label: "World (context)", value: model.ref.contextId)
                            DetailRow(label: "Namespace", value: model.ref.namespaceId)
                            if let groupId = model.ref.groupId { DetailRow(label: "Group", value: groupId) }
                        }
                        .padding(.top, 8)
                    }
                    .font(Theme.body(14, .semibold))
                    .tint(Theme.ink)
                    Button {
                        leave()
                    } label: {
                        HStack(spacing: 8) {
                            if leaving {
                                ProgressView().tint(Theme.danger)
                            } else {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                            }
                            Text(leaving ? "Saving…" : "Save & leave world")
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle(destructive: true))
                    .disabled(leaving)
                }
                .card(padding: 20)
                .frame(maxWidth: 460)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
            }
        }
        .onAppear { zoom = model.zoom }
        .sheet(item: $share) { link in ShareSheet(items: [link.url]) }
    }

    private func invite() {
        Haptics.tap()
        inviting = true
        error = nil
        Task {
            do {
                share = SharedLink(url: try await WorldsModel.inviteLink(backend: backend, ref: model.ref))
            } catch {
                self.error = MerrariaText.error(error)
            }
            inviting = false
        }
    }

    private func leave() {
        Haptics.tap()
        leaving = true
        Task { await model.leave() }
    }
}
