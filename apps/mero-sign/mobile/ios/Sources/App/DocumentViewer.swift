import PDFKit
import SignCore
import SwiftUI
import UIKit

/// The document, full screen, and — when it waits on you — signing it:
/// consent, choose a signature, place it, finish.
struct DocumentViewerScreen: View {
    @ObservedObject var model: DocumentModel
    let startSigning: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var placement: SignaturePlacement?
    @State private var saveToLibrary = true

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.sunken.ignoresSafeArea()
                content
                if model.step == .checking || model.step == .submitting { busyOverlay }
            }
            .navigationTitle(model.entry?.document.name ?? "Document")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        model.cancelSigning()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark").foregroundStyle(Palette.ink)
                    }
                    .accessibilityLabel("Close")
                    .disabled(model.step == .submitting)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if let url = shareURL, model.step == .idle || model.step == .done {
                        ShareLink(item: url) { Image(systemName: "square.and.arrow.up").foregroundStyle(Palette.ink) }
                            .accessibilityLabel("Share")
                    }
                }
            }
            .safeAreaInset(edge: .top) {
                if let error = model.error { NoticeBanner(text: error) { model.error = nil } }
            }
            .safeAreaInset(edge: .bottom) { bottomBar }
        }
        .task {
            await model.loadPDF()
            if startSigning, model.entry?.canSign == true, model.step == .idle { await model.beginSigning() }
        }
        .sheet(isPresented: pickerShown) {
            Group {
                if model.step == .consent {
                    ConsentSheet(model: model)
                } else {
                    SignatureChooserSheet(model: model)
                }
            }
            .interactiveDismissDisabled(false)
        }
        .onChange(of: model.step) { step in
            if step == .placing, placement == nil { placement = initialPlacement(page: 0) }
            if step == .done { Haptics.success() }
            if step == .choose || step == .idle { placement = nil }
        }
    }

    @ViewBuilder private var content: some View {
        if let pdf = model.pdf {
            if model.step == .placing || model.step == .submitting, let png = model.chosenSignature {
                PlacementView(pdf: pdf, signature: png, placement: $placement)
            } else if model.step == .done {
                doneCard
            } else {
                PDFKitView(data: pdf).ignoresSafeArea(edges: .bottom)
            }
        } else if let error = model.pdfError {
            ErrorState(message: error) { Task { await model.loadPDF(force: true) } }
        } else {
            VStack(spacing: 12) {
                ProgressView().tint(Palette.ink).controlSize(.large)
                Text("Loading \(model.entry?.document.name ?? "the document")…")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
            }
        }
    }

    @ViewBuilder private var bottomBar: some View {
        switch model.step {
        case .idle, .checking, .consent, .choose:
            if model.entry?.canSign == true, model.pdf != nil {
                bar {
                    Button {
                        Haptics.tap()
                        Task { await model.beginSigning() }
                    } label: {
                        Label("Sign this document", systemImage: "signature")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.step == .checking)
                }
            }
        case .placing, .submitting:
            bar {
                VStack(spacing: 10) {
                    Text("Drag your signature into place. Drag the corner to resize.")
                        .font(.system(size: 13)).foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.center)
                    if model.chosenIsNew {
                        Toggle(isOn: $saveToLibrary) {
                            Text("Save to my signatures").font(.system(size: 15)).foregroundStyle(Palette.ink)
                        }
                        .tint(Palette.ink)
                    }
                    HStack(spacing: 10) {
                        Button("Change") { model.backToChoose() }
                            .buttonStyle(SecondaryButtonStyle())
                            .frame(maxWidth: 130)
                        Button {
                            guard let placement else { return }
                            Haptics.tap()
                            Task { await model.submit(placement: placement, saveToLibrary: saveToLibrary) }
                        } label: {
                            Label("Finish signing", systemImage: "checkmark")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(placement == nil || model.step == .submitting)
                    }
                }
            }
        case .done:
            bar {
                Button("Done") {
                    model.finish()
                    dismiss()
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
    }

    private func bar<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity)
            .background(Palette.surface.ignoresSafeArea(edges: .bottom))
            .overlay(alignment: .top) { Rectangle().fill(Palette.hairline).frame(height: 0.5) }
    }

    private var busyOverlay: some View {
        VStack(spacing: 12) {
            ProgressView().tint(Palette.ink).controlSize(.large)
            Text(model.step == .submitting ? "Signing…" : "Checking your consent…")
                .font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.ink)
        }
        .padding(24)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.surface))
        .shadow(color: .black.opacity(0.08), radius: 20, y: 8)
    }

    private var doneCard: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(Palette.ink)
                .frame(width: 72, height: 72)
                .background(Circle().fill(Palette.lime))
            Text("Signed").font(Typeface.display(26)).foregroundStyle(Palette.ink)
            Text(
                model.entry?.isComplete == true
                    ? "Everyone has signed. The final version is ready to share."
                    : "Your signature is recorded. The others see the signed version as it syncs to them."
            )
            .font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
        }
        .padding(32)
    }

    private var pickerShown: Binding<Bool> {
        Binding(
            get: { model.step == .consent || model.step == .choose },
            set: { shown in
                if !shown, model.step == .consent || model.step == .choose { model.cancelSigning() }
            })
    }

    private func initialPlacement(page: Int) -> SignaturePlacement? {
        guard let pdf = model.pdf, let png = model.chosenSignature, let image = UIImage(data: png) else { return nil }
        let sizes = PDFStamper.pageSizes(pdf)
        guard page < sizes.count else { return nil }
        let aspect = image.size.height > 0 ? image.size.width / image.size.height : 3
        return SignaturePlacement.initial(pageIndex: page, pageSize: sizes[page], imageAspect: aspect)
    }

    private var shareURL: URL? {
        guard let pdf = model.pdf, let entry = model.entry else { return nil }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(SignFormat.fileName(entry.document.name, signed: !entry.signatures.isEmpty))
        try? pdf.write(to: url, options: .atomic)
        return url
    }
}

/// PDFKit, read-only.
struct PDFKitView: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.pageShadowsEnabled = true
        view.backgroundColor = UIColor(Palette.sunken)
        view.document = PDFDocument(data: data)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document?.dataRepresentation() != data { view.document = PDFDocument(data: data) }
    }
}

/// One page at a time with the signature on it: drag to move, drag the
/// corner to resize, arrows to change page.
struct PlacementView: View {
    let pdf: Data
    let signature: Data
    @Binding var placement: SignaturePlacement?

    @State private var document: PDFDocument?
    @State private var sizes: [CGSize] = []
    @State private var dragStart: CGRect?

    var body: some View {
        VStack(spacing: 12) {
            GeometryReader { geo in
                if let placement, placement.pageIndex < sizes.count, let page = document?.page(at: placement.pageIndex) {
                    let size = sizes[placement.pageIndex]
                    let scale = min((geo.size.width - 32) / size.width, (geo.size.height - 16) / size.height)
                    let shown = CGSize(width: size.width * scale, height: size.height * scale)
                    ZStack(alignment: .topLeading) {
                        Image(uiImage: page.thumbnail(of: CGSize(width: shown.width * 2, height: shown.height * 2), for: .cropBox))
                            .resizable()
                            .frame(width: shown.width, height: shown.height)
                            .background(Color.white)
                            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                        signatureBox(placement: placement, scale: scale, page: size)
                    }
                    .frame(width: shown.width, height: shown.height)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            if sizes.count > 1, let placement {
                HStack(spacing: 18) {
                    Button {
                        move(to: placement.pageIndex - 1)
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .disabled(placement.pageIndex == 0)
                    .accessibilityLabel("Previous page")
                    Text("Page \(placement.pageIndex + 1) of \(sizes.count)")
                        .font(.system(size: 14, weight: .medium))
                    Button {
                        move(to: placement.pageIndex + 1)
                    } label: {
                        Image(systemName: "chevron.right")
                    }
                    .disabled(placement.pageIndex >= sizes.count - 1)
                    .accessibilityLabel("Next page")
                }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Capsule().fill(Palette.surface))
            }
        }
        .padding(.vertical, 12)
        .onAppear {
            document = PDFDocument(data: pdf)
            sizes = PDFStamper.pageSizes(pdf)
        }
    }

    private func signatureBox(placement: SignaturePlacement, scale: CGFloat, page: CGSize) -> some View {
        let rect = placement.rect
        return ZStack(alignment: .bottomTrailing) {
            if let image = UIImage(data: signature) {
                Image(uiImage: image).resizable()
                    .frame(width: rect.width * scale, height: rect.height * scale)
                    .overlay(Rectangle().stroke(Palette.ink, style: StrokeStyle(lineWidth: 1.5, dash: [5, 3])))
            }
            Circle()
                .fill(Palette.lime)
                .overlay(Circle().stroke(Palette.ink, lineWidth: 1.5))
                .frame(width: 26, height: 26)
                .overlay(Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 11, weight: .bold)))
                .offset(x: 13, y: 13)
                .highPriorityGesture(
                    DragGesture()
                        .onChanged { value in
                            let start = dragStart ?? rect
                            dragStart = start
                            let aspect = start.height > 0 ? start.width / start.height : 3
                            let width = start.width + value.translation.width / scale
                            var next = placement
                            next.rect = CGRect(x: start.minX, y: start.minY, width: width, height: width / aspect)
                            self.placement = next.clamped(to: page)
                        }
                        .onEnded { _ in dragStart = nil }
                )
                .accessibilityLabel("Resize signature")
        }
        .offset(x: rect.minX * scale, y: rect.minY * scale)
        .gesture(
            DragGesture()
                .onChanged { value in
                    let start = dragStart ?? rect
                    dragStart = start
                    var next = placement
                    next.rect.origin = CGPoint(
                        x: start.minX + value.translation.width / scale, y: start.minY + value.translation.height / scale)
                    self.placement = next.clamped(to: page)
                }
                .onEnded { _ in dragStart = nil }
        )
        .accessibilityLabel("Your signature. Drag to move.")
    }

    private func move(to page: Int) {
        guard let current = placement, page >= 0, page < sizes.count, let image = UIImage(data: signature) else { return }
        Haptics.tap()
        let aspect = image.size.height > 0 ? image.size.width / image.size.height : 3
        var next = SignaturePlacement.initial(pageIndex: page, pageSize: sizes[page], imageAspect: aspect)
        next.rect.size = current.rect.size
        placement = next.clamped(to: sizes[page])
    }
}
