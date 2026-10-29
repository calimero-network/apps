import AVFoundation
import MeroKit
import StreamCore
import SwiftUI

/// The call, laid out like Google Meet on a phone: a dark stage with a tile
/// per person, the room and the broadcast slots on top, and the controls in a
/// bottom bar (mic, camera, people, more, leave).
struct CallView: View {
    let target: CallTarget
    let onName: (String) -> Void
    @StateObject private var model: CallModel
    @StateObject private var media = CallMedia()
    @EnvironmentObject private var nav: Navigator
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var showPeople = false
    @State private var showDetails = false
    @State private var nudged = false

    init(
        target: CallTarget, backend: any MeroAppBackend, channel: (any MediaChannel)?, name: String,
        onName: @escaping (String) -> Void
    ) {
        self.target = target
        self.onName = onName
        _model = StateObject(
            wrappedValue: CallModel(
                room: target.room, contextId: target.contextId, backend: backend, channel: channel, name: name))
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            notices
            StageGrid(model: model, media: media)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            controls
        }
        .background(Palette.stage.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
        .onAppear {
            media.attach(model)
            model.start()
        }
        .onDisappear {
            model.stop()
            media.detach()
        }
        .onChange(of: model.joined) { joined in
            // Like the web: someone who never picked a name is asked once.
            if joined, !nudged, model.name.trimmingCharacters(in: .whitespaces).isEmpty {
                nudged = true
                showPeople = true
            }
        }
        .sheet(isPresented: $showPeople) {
            PeopleSheet(model: model) { name in
                onName(name)
                Task { await model.rename(name) }
            }
        }
        .sheet(isPresented: $showDetails) { CallDetailsSheet(model: model, target: target) }
        .alert(item: $media.blocked) { blocked in
            Alert(
                title: Text(blocked == .camera ? "Camera access is off" : "Microphone access is off"),
                message: Text(
                    blocked == .camera
                        ? "Turn on camera access for Mero Stream in Settings to share your camera."
                        : "Turn on microphone access for Mero Stream in Settings to talk in calls."),
                primaryButton: .default(Text("Open Settings")) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                },
                secondaryButton: .cancel(Text("Not now")))
        }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(target.room.title).font(Typeface.display(18)).foregroundStyle(Palette.stageText).lineLimit(1)
                HStack(spacing: 6) {
                    CallTimer(start: model.startedAt)
                    Text("·")
                    Text(target.stream.title).lineLimit(1)
                }
                .font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.stageFaint)
            }
            Spacer(minLength: 8)
            SlotsPill(occupied: model.slots.occupied, live: model.isLive)
            if media.cameraOn {
                Button {
                    Haptics.tap()
                    media.flipCamera()
                } label: {
                    Image(systemName: "arrow.triangle.2.circlepath.camera")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Palette.stageText)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Palette.control))
                }
                .accessibilityLabel("Switch camera")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    // MARK: Notices

    @ViewBuilder private var notices: some View {
        VStack(spacing: 8) {
            if !model.joined, model.joinFailed == nil {
                StageNotice(symbol: "hourglass", text: "Joining the room…")
            }
            if let failed = model.joinFailed {
                StageNotice(symbol: "exclamationmark.triangle.fill", text: "Could not join: \(failed)", action: ("Retry", model.retryJoin))
            }
            if model.yielded {
                StageNotice(
                    symbol: "video.slash.fill",
                    text: "All \(Slots.maxBroadcasters) camera slots were taken, so your camera stopped. You still see everyone; turn it on again when a slot frees up.",
                    action: ("Dismiss", model.clearYielded))
            } else if model.slots.full, !model.isLive, model.joined {
                StageNotice(
                    symbol: "person.2.fill",
                    text: "All \(Slots.maxBroadcasters) camera slots are taken. You can watch and talk; the camera turns on again when one frees up.")
            }
            if model.degraded {
                StageNotice(
                    symbol: "info.circle.fill",
                    text: "\(model.slots.occupied) people are broadcasting, so every stream is choppier.",
                    action: ("Why?", { showDetails = true }))
            }
            if let error = model.error {
                StageNotice(symbol: "exclamationmark.circle.fill", text: error, action: ("Dismiss", { model.error = nil }))
            }
        }
        .padding(.horizontal, 12)
    }

    // MARK: Controls

    private var controls: some View {
        HStack(spacing: 14) {
            ControlButton(
                symbol: model.micOn ? "mic.fill" : "mic.slash.fill", label: model.micOn ? "Mute" : "Unmute",
                active: model.micOn, enabled: model.joined && model.channel != nil
            ) {
                Haptics.toggle()
                Task { await media.toggleMic() }
            }
            ControlButton(
                symbol: media.cameraOn ? "video.fill" : "video.slash.fill",
                label: media.cameraOn ? "Turn off camera" : "Turn on camera", active: media.cameraOn,
                enabled: model.canGoLive || media.cameraOn
            ) {
                Haptics.toggle()
                Task { await media.toggleCamera() }
            }
            ControlButton(symbol: "person.2.fill", label: "People", badge: model.people.count) { showPeople = true }
            ControlButton(symbol: "ellipsis", label: "Call details") { showDetails = true }
            Button {
                Haptics.toggle()
                leave()
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 52)
                    .background(Capsule().fill(Palette.danger))
            }
            .accessibilityLabel("Leave call")
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background(Palette.stage)
    }

    private func leave() {
        model.stop()
        media.detach()
        nav.call = nil
        dismiss()
    }
}

// MARK: - Stage

/// The tiles: one person fills the stage, two stack, more go two across.
struct StageGrid: View {
    @ObservedObject var model: CallModel
    @ObservedObject var media: CallMedia

    var body: some View {
        let people = model.people
        GeometryReader { geo in
            let spacing: CGFloat = 8
            if people.count <= 2 {
                VStack(spacing: spacing) {
                    ForEach(people) { person in tile(person) }
                }
            } else {
                let rows = CGFloat((people.count + 1) / 2)
                let height = max(160, (geo.size.height - spacing * (rows - 1)) / min(rows, 3))
                ScrollView {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: spacing), GridItem(.flexible(), spacing: spacing)], spacing: spacing) {
                        ForEach(people) { person in tile(person).frame(height: height) }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    @ViewBuilder private func tile(_ person: Person) -> some View {
        let peer = model.peers.first { $0.id == person.memberId }
        PersonTile(
            person: person,
            video: person.isSelf
                ? (media.cameraOn ? .preview : .off)
                : (peer.map { $0.decoding ? .remote : .waiting } ?? .off),
            speaking: person.isSelf ? false : model.speaking.contains(person.memberId),
            muted: person.isSelf && !model.micOn,
            media: media)
    }
}

struct PersonTile: View {
    enum Video { case off, preview, remote, waiting }

    let person: Person
    let video: Video
    let speaking: Bool
    let muted: Bool
    let media: CallMedia

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.tile)
            switch video {
            case .preview:
                CameraPreview(session: media.camera.session)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            case .remote:
                DecoderHost(view: media.decoder(for: person.memberId))
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            case .waiting, .off:
                VStack(spacing: 10) {
                    Avatar(name: person.name, seed: person.memberId, size: 72)
                    if video == .waiting {
                        HStack(spacing: 6) {
                            ProgressView().tint(Palette.stageFaint).scaleEffect(0.8)
                            Text("Waiting for a keyframe…")
                        }
                        .font(.system(size: 12)).foregroundStyle(Palette.stageFaint)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack(spacing: 6) {
                if muted {
                    Image(systemName: "mic.slash.fill").font(.system(size: 11, weight: .bold))
                } else if speaking {
                    Image(systemName: "waveform").font(.system(size: 11, weight: .bold)).foregroundStyle(Palette.lime)
                }
                Text(person.isSelf ? "\(person.name) (you)" : person.name).lineLimit(1)
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Capsule().fill(.black.opacity(0.55)))
            .padding(10)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(speaking ? Palette.lime : .clear, lineWidth: 3)
        )
        .animation(.easeOut(duration: 0.2), value: speaking)
        .accessibilityElement(children: .combine)
    }
}

/// The local camera, mirrored for the front camera as people expect.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Self.Context) -> PreviewView {
        let view = PreviewView()
        view.preview.session = session
        view.preview.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: PreviewView, context: Self.Context) {}
}

/// Hosts a sender's long-lived decoder view.
struct DecoderHost: UIViewRepresentable {
    let view: VideoDecoderView

    func makeUIView(context: Self.Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .black
        embed(in: container)
        return container
    }

    func updateUIView(_ container: UIView, context: Self.Context) {
        if view.superview !== container { embed(in: container) }
    }

    private func embed(in container: UIView) {
        view.removeFromSuperview()
        view.frame = container.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(view)
    }
}

// MARK: - Pieces

struct ControlButton: View {
    let symbol: String
    let label: String
    var active = false
    var enabled = true
    var badge: Int?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(active ? Palette.ink : Palette.stageText)
                .frame(width: 52, height: 52)
                .background(Circle().fill(active ? Palette.lime : Palette.control))
                .overlay(alignment: .topTrailing) {
                    if let badge, badge > 0 {
                        Text("\(badge)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Palette.ink)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Capsule().fill(Palette.lime))
                            .offset(x: 4, y: -4)
                    }
                }
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }
}

struct SlotsPill: View {
    let occupied: Int
    let live: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(occupied > 0 ? Palette.lime : Palette.stageFaint).frame(width: 7, height: 7)
            Text("\(occupied)/\(Slots.maxBroadcasters) on camera")
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(Palette.stageText)
        .padding(.horizontal, 10)
        .frame(height: 28)
        .background(Capsule().fill(Palette.control))
        .accessibilityLabel("\(occupied) of \(Slots.maxBroadcasters) camera slots in use")
    }
}

struct StageNotice: View {
    let symbol: String
    let text: String
    var action: (String, () -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(Palette.lime)
            Text(text).font(.system(size: 13)).foregroundStyle(Palette.stageText)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let action {
                Button(action.0, action: action.1)
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.lime)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.tile))
    }
}

struct CallTimer: View {
    let start: Date

    var body: some View {
        TimelineView(.periodic(from: start, by: 1)) { context in
            let seconds = max(0, Int(context.date.timeIntervalSince(start)))
            let h = seconds / 3600
            let m = (seconds % 3600) / 60
            let s = seconds % 60
            Text(h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s))
                .monospacedDigit()
        }
    }
}

// MARK: - Sheets

/// Your name, and who is in the room (the web's People dialog).
struct PeopleSheet: View {
    @ObservedObject var model: CallModel
    let onSave: (String) -> Void
    @State private var draft = ""
    @State private var saved = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 10) {
                        TextField("e.g. Ana", text: $draft)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.done)
                            .onSubmit(save)
                        Button("Save", action: save)
                            .buttonStyle(PrimaryButtonStyle(compact: true))
                            .disabled(!dirty)
                    }
                    if saved {
                        Label("Saved. Everyone sees it within a few seconds.", systemImage: "checkmark")
                            .font(.system(size: 13)).foregroundStyle(Palette.muted)
                    } else if model.name.trimmingCharacters(in: .whitespaces).isEmpty {
                        Text("You have not picked a name yet, so your tile shows a placeholder.")
                            .font(.system(size: 13)).foregroundStyle(Palette.muted)
                    }
                } header: {
                    Text("Your nickname")
                } footer: {
                    Text("This is the name on your tile, and what everyone else in the room sees.")
                }

                Section {
                    ForEach(model.people) { person in
                        HStack(spacing: 12) {
                            Avatar(name: person.name, seed: person.memberId, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(person.isSelf ? "\(person.name) (you)" : person.name)
                                    .font(.system(size: 16, weight: .medium))
                                Text(People.shortId(person.memberId)).font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if person.live {
                                Label("on camera", systemImage: "video.fill")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Palette.ink)
                                    .padding(.horizontal, 8).padding(.vertical, 4)
                                    .background(Capsule().fill(Palette.lime))
                            } else {
                                Text("watching").font(.system(size: 12)).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("In this room · \(model.people.count)")
                }
            }
            .navigationTitle("People")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { draft = model.name }
    }

    private var dirty: Bool {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed != model.name
    }

    private func save() {
        guard dirty else { return }
        Haptics.success()
        onSave(String(draft.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40)))
        saved = true
    }
}

/// Call health and the ids behind the room (the web's "Call details").
struct CallDetailsSheet: View {
    @ObservedObject var model: CallModel
    let target: CallTarget
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("This call") {
                    row("On camera", "\(model.slots.occupied) of \(Slots.maxBroadcasters)")
                    row("Your camera", model.isLive ? "\(model.encoding.fps) fps · \(model.encoding.bitrate / 1000) kbps" : "Off")
                    row("Codec", model.stats.lastCodec ?? "—")
                    row("Frames sent", "\(model.stats.framesSent)")
                    row("Frames dropped (behind)", "\(model.stats.framesDropped)")
                    row("Publish time", model.stats.publishMs.map { "\(Int($0)) ms" } ?? "—")
                    row("Publish errors", "\(model.stats.publishErrors)")
                    row("Frames received", "\(model.stats.framesReceived)")
                    row("Latency", model.stats.latencyMs.map { "\(Int($0)) ms" } ?? "—")
                    row("Audio sent / received", "\(model.stats.audioPacketsSent) / \(model.stats.audioPacketsReceived)")
                }
                Section {
                    Text(
                        "Video is H.264 carried on the room's ephemeral presence in ≤16 KiB slices, so nothing about the call is stored. With \(Slots.degradedFromBroadcasters) people on camera, each stream gets about \(Slots.degradedDeliveryPercent)% of its frames through: frame rate and bitrate are shared, and that is measured, not something the app can tune away. One person on camera at a time is smooth."
                    )
                    .font(.system(size: 14)).foregroundStyle(.secondary)
                } header: {
                    Text("Why it can be choppy")
                }
                Section {
                    DetailsDisclosure(rows: [
                        ("Room ID", target.room.id), ("Context ID", target.contextId), ("Stream ID", target.stream.id),
                        ("Your device key", model.me),
                    ])
                }
            }
            .navigationTitle("Call details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).foregroundStyle(.secondary).monospacedDigit()
        }
        .font(.system(size: 15))
    }
}
