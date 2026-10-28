import SignCore
import SwiftUI

/// Your signature library, kept in your private context.
struct SignaturesScreen: View {
    @ObservedObject var model: SignaturesModel
    @State private var drawing = false
    @State private var deleting: SavedSignature?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("The drawings you sign documents with. They're stored in your own private context and never shared.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
                Button {
                    drawing = true
                } label: {
                    if model.isSaving {
                        ProgressView().tint(Palette.ink)
                    } else {
                        Label("Draw a new signature", systemImage: "pencil.and.scribble")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.isSaving)
                content
            }
            .padding(16)
        }
        .background(Palette.ground.ignoresSafeArea())
        .refreshable { await model.load() }
        .task { await model.load() }
        .signNavigation("Signatures")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountMenu() } }
        .safeAreaInset(edge: .top) {
            if let notice = model.notice { NoticeBanner(text: notice) { model.notice = nil } }
        }
        .navigationDestination(isPresented: $drawing) {
            SignaturePadScreen(actionTitle: "Save signature") { png in
                drawing = false
                Task { await model.save(png: png) }
            }
        }
        .confirmationDialog(
            "Delete \(deleting?.name ?? "this signature")?", isPresented: deletingShown, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let deleting { Task { await model.delete(deleting) } }
            }
        } message: {
            Text("Documents you already signed with it keep it.")
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView().tint(Palette.ink).frame(maxWidth: .infinity).padding(.top, 40)
        case .failed(let message):
            ErrorState(message: message) { Task { await model.load() } }
        case .loaded:
            if model.signatures.isEmpty {
                EmptyState(
                    symbol: "signature", title: "No signatures yet",
                    message: "Draw one now, or keep the one you draw when you next sign a document.")
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    ForEach(model.signatures) { signature in
                        SignatureTile(signature: signature)
                            .contextMenu {
                                Button(role: .destructive) {
                                    deleting = signature
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                            .overlay(alignment: .topTrailing) {
                                Menu {
                                    Button(role: .destructive) {
                                        deleting = signature
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                } label: {
                                    Image(systemName: "ellipsis")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(Palette.inkSoft)
                                        .frame(width: 32, height: 32)
                                }
                                .accessibilityLabel("More for \(signature.name)")
                            }
                    }
                }
            }
        }
    }

    private var deletingShown: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
    }
}
