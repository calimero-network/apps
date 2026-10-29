import SignCore
import SwiftUI
import UIKit

/// Consent to sign electronically: the web's disclosure, a checkbox, and
/// `set_consent` for this document.
struct ConsentSheet: View {
    @ObservedObject var model: DocumentModel
    @State private var agreed = false
    @State private var busy = false
    @State private var readingDisclosure = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Image(systemName: "checkmark.shield")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(Palette.ink)
                        .frame(width: 56, height: 56)
                        .background(Circle().fill(Palette.limeSoft))
                    Text(ConsentText.intro).font(.system(size: 16)).foregroundStyle(Palette.ink)
                    Button {
                        readingDisclosure = true
                    } label: {
                        Label(ConsentText.readLink, systemImage: "doc.plaintext")
                            .font(.system(size: 15, weight: .semibold))
                            .multilineTextAlignment(.leading)
                    }
                    .foregroundStyle(Palette.ink)
                    Button {
                        Haptics.tap()
                        agreed.toggle()
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: agreed ? "checkmark.square.fill" : "square")
                                .font(.system(size: 22))
                                .foregroundStyle(Palette.ink)
                            Text(ConsentText.checkbox)
                                .font(.system(size: 15))
                                .foregroundStyle(Palette.ink)
                                .multilineTextAlignment(.leading)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(agreed ? .isSelected : [])
                    if let error = model.error {
                        Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger)
                    }
                }
                .padding(20)
            }
            .background(Palette.surface)
            .safeAreaInset(edge: .bottom) {
                Button {
                    busy = true
                    Task {
                        await model.giveConsent()
                        busy = false
                    }
                } label: {
                    if busy { ProgressView().tint(Palette.ink) } else { Text(ConsentText.action) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!agreed || busy)
                .padding(16)
                .background(Palette.surface)
            }
            .navigationTitle(ConsentText.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { model.cancelSigning() }.foregroundStyle(Palette.ink)
                }
            }
            .sheet(isPresented: $readingDisclosure) { DisclosureSheet() }
        }
    }
}

struct DisclosureSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(ConsentText.lead).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.ink)
                    ForEach(Array(ConsentText.items.enumerated()), id: \.offset) { index, item in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(index + 1).").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.inkSoft)
                            Text(item).font(.system(size: 15)).foregroundStyle(Palette.ink)
                        }
                    }
                }
                .padding(20)
            }
            .background(Palette.surface)
            .navigationTitle(ConsentText.disclosureTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Close") { dismiss() }.foregroundStyle(Palette.ink) }
            }
        }
    }
}

/// Draw a new signature or reuse one from your library.
struct SignatureChooserSheet: View {
    @ObservedObject var model: DocumentModel
    @State private var drawing = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Button {
                        drawing = true
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "pencil.and.scribble")
                                .font(.system(size: 20, weight: .semibold))
                                .frame(width: 48, height: 48)
                                .background(Circle().fill(Palette.lime))
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Draw a signature").font(.system(size: 16, weight: .semibold))
                                Text("With your finger, on a signature pad.").font(.system(size: 13))
                                    .foregroundStyle(Palette.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(Palette.muted)
                        }
                        .foregroundStyle(Palette.ink)
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.surface))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
                    }
                    .buttonStyle(.plain)

                    SectionLabel(text: "Your signatures", trailing: model.savedSignatures.isEmpty ? nil : "\(model.savedSignatures.count)")
                    if model.libraryLoading && model.savedSignatures.isEmpty {
                        ProgressView().tint(Palette.ink).frame(maxWidth: .infinity).padding(20)
                    } else if model.savedSignatures.isEmpty {
                        Text("No saved signatures yet. Draw one and keep it for next time.")
                            .font(.system(size: 14)).foregroundStyle(Palette.muted)
                    } else {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                            ForEach(model.savedSignatures) { signature in
                                Button {
                                    guard let png = signature.png else { return }
                                    Haptics.tap()
                                    model.choose(png: png, isNew: false)
                                } label: {
                                    SignatureTile(signature: signature)
                                }
                                .buttonStyle(.plain)
                                .disabled(signature.png == nil)
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(Palette.ground)
            .navigationTitle("Choose a signature")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { model.cancelSigning() }.foregroundStyle(Palette.ink)
                }
            }
            .navigationDestination(isPresented: $drawing) {
                SignaturePadScreen(actionTitle: "Use signature") { png in
                    model.choose(png: png, isNew: true)
                }
            }
        }
    }
}

/// A saved signature on paper white.
struct SignatureTile: View {
    let signature: SavedSignature

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white)
                if let png = signature.png, let image = UIImage(data: png) {
                    Image(uiImage: image).resizable().scaledToFit().padding(6)
                } else {
                    Image(systemName: "photo").foregroundStyle(Palette.muted)
                }
            }
            .frame(height: 74)
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
            Text(signature.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink)
            Text(SignFormat.when(nanos: signature.createdAt)).font(.system(size: 12)).foregroundStyle(Palette.muted)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
    }
}

/// The signature pad: draw with a finger, undo a stroke, clear, use it.
struct SignaturePadScreen: View {
    let actionTitle: String
    let use: (Data) -> Void
    @State private var ink = SignatureInk()
    @State private var padSize: CGSize = .zero
    @State private var inStroke = false

    var body: some View {
        VStack(spacing: 16) {
            Text("Sign inside the box.").font(.system(size: 15)).foregroundStyle(Palette.muted)
            GeometryReader { geo in
                ZStack {
                    Color.white
                    Rectangle().fill(Palette.hairline).frame(height: 1.5)
                        .padding(.horizontal, 28)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, 48)
                    Image(systemName: "xmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.muted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                        .padding(.leading, 24).padding(.bottom, 54)
                    if ink.isEmpty {
                        Text("Sign here").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.muted)
                    }
                    Canvas { context, _ in
                        context.withCGContext { cg in ink.draw(in: cg) }
                    }
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0, coordinateSpace: .local)
                        .onChanged { value in
                            let point = SignatureInk.Point(
                                x: value.location.x, y: value.location.y,
                                time: Date().timeIntervalSinceReferenceDate)
                            if inStroke {
                                ink.add(point)
                            } else {
                                inStroke = true
                                ink.begin(point)
                            }
                        }
                        .onEnded { _ in inStroke = false }
                )
                .onAppear { padSize = geo.size }
                .onChange(of: geo.size) { padSize = $0 }
            }
            .frame(height: 220)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Palette.hairline, style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])))
            .accessibilityLabel("Signature pad")

            HStack(spacing: 10) {
                Button {
                    ink.undo()
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
                .disabled(ink.isEmpty)
                Button {
                    ink.clear()
                } label: {
                    Label("Clear", systemImage: "trash")
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
                .disabled(ink.isEmpty)
                Spacer()
            }
            Spacer()
            Button {
                guard let png = ink.renderPNG(size: padSize, scale: UIScreen.main.scale) else { return }
                Haptics.success()
                use(png)
            } label: {
                Label(actionTitle, systemImage: "checkmark")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(ink.isEmpty)
        }
        .padding(16)
        .background(Palette.ground.ignoresSafeArea())
        .navigationTitle("Draw your signature")
        .navigationBarTitleDisplayMode(.inline)
    }
}
