import DesignCore
import SwiftUI

/// One slide of Present: a screen, or the whole board when it has none.
struct Slide: Identifiable, Equatable {
    let id: String
    let name: String
    let frame: DesignCore.Rect

    static func of(_ scene: DesignCore.BoardScene, boardName: String) -> [Slide] {
        if !scene.screens.isEmpty { return scene.screens.map { Slide(id: $0.id, name: $0.name, frame: $0.frame) } }
        guard let bounds = scene.bounds else { return [] }
        let pad = 24.0
        return [
            Slide(
                id: "board", name: boardName.isEmpty ? "Board" : boardName,
                frame: Rect(x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2))
        ]
    }
}

/// Full screen, one slide at a time; swipe between them. Tap shows or hides the controls.
struct PresentView: View {
    @ObservedObject var model: BoardModel
    let cache: ImageCache
    @Environment(\.dismiss) private var dismiss
    @State private var index = 0
    @State private var chrome = true
    @State private var showAll = false

    var body: some View {
        let slides = Slide.of(model.scene, boardName: model.name)
        ZStack {
            Theme.stage.ignoresSafeArea()
            if slides.isEmpty {
                EmptyState(icon: "rectangle.on.rectangle.slash", title: "Nothing to present", message: "This board is empty.")
                    .colorScheme(.dark)
            } else {
                TabView(selection: $index) {
                    ForEach(Array(slides.enumerated()), id: \.element.id) { i, slide in
                        SlideView(slide: slide, model: model, cache: cache)
                            .tag(i)
                            .contentShape(Rectangle())
                            .onTapGesture { withAnimation(.easeOut(duration: 0.2)) { chrome.toggle() } }
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .ignoresSafeArea()
            }
            if chrome {
                VStack {
                    HStack(spacing: 12) {
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(width: 40, height: 40)
                                .background(.white.opacity(0.14), in: Circle())
                        }
                        .accessibilityLabel("Stop presenting")
                        VStack(alignment: .leading, spacing: 1) {
                            Text(slides.indices.contains(index) ? slides[index].name : "")
                                .font(Theme.heading(16))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            Text(slides.isEmpty ? "" : "\(index + 1) of \(slides.count)")
                                .font(Theme.body(13))
                                .foregroundStyle(.white.opacity(0.6))
                                .monospacedDigit()
                        }
                        Spacer()
                        if slides.count > 1 {
                            Button {
                                showAll = true
                            } label: {
                                Image(systemName: "square.grid.2x2")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 40, height: 40)
                                    .background(.white.opacity(0.14), in: Circle())
                            }
                            .accessibilityLabel("All screens")
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    Spacer()
                    if slides.count > 1 {
                        HStack(spacing: 6) {
                            ForEach(slides.indices, id: \.self) { i in
                                Capsule()
                                    .fill(i == index ? Theme.lime : .white.opacity(0.3))
                                    .frame(width: i == index ? 18 : 6, height: 6)
                            }
                        }
                        .padding(.bottom, 16)
                        .accessibilityHidden(true)
                    }
                }
                .transition(.opacity)
            }
        }
        .statusBarHidden(!chrome)
        .sheet(isPresented: $showAll) {
            AllScreensSheet(slides: slides, model: model, cache: cache, current: index) { picked in
                index = picked
                showAll = false
            }
            .presentationDetents([.medium, .large])
        }
    }
}

/// A slide fitted to the space it has: whole, or at a readable width and
/// scrolling when it is a long page.
struct SlideView: View {
    let slide: Slide
    @ObservedObject var model: BoardModel
    let cache: ImageCache

    var body: some View {
        GeometryReader { geo in
            let fit = Screens.fit(
                width: slide.frame.width, height: slide.frame.height, viewW: geo.size.width, viewH: geo.size.height)
            let w = slide.frame.width * fit.scale
            let h = slide.frame.height * fit.scale
            let page = SlideCanvas(slide: slide, model: model, cache: cache, scale: fit.scale).frame(width: w, height: h)
            if fit.scrolls {
                ScrollView(.vertical, showsIndicators: true) { page.frame(maxWidth: .infinity) }
            } else {
                page.frame(width: geo.size.width, height: geo.size.height)
            }
        }
    }
}

/// The slide's area of the board, clipped at its edge.
struct SlideCanvas: View {
    let slide: Slide
    @ObservedObject var model: BoardModel
    let cache: ImageCache
    let scale: Double

    var body: some View {
        Canvas { ctx, _ in
            var c = ctx
            c.scaleBy(x: scale, y: scale)
            c.translateBy(x: -slide.frame.x, y: -slide.frame.y)
            SceneRenderer.draw(model.scene.nodes(in: slide.frame), in: c, images: model.images, cache: cache)
        }
        .background(Color.white)
        .clipped()
    }
}

/// Every slide as a thumbnail; tap one to jump to it.
private struct AllScreensSheet: View {
    let slides: [Slide]
    @ObservedObject var model: BoardModel
    let cache: ImageCache
    let current: Int
    let pick: (Int) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 16) {
                    ForEach(Array(slides.enumerated()), id: \.element.id) { i, slide in
                        Button {
                            pick(i)
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                GeometryReader { geo in
                                    let s = min(geo.size.width / slide.frame.width, geo.size.height / slide.frame.height)
                                    SlideCanvas(slide: slide, model: model, cache: cache, scale: s)
                                        .frame(width: slide.frame.width * s, height: slide.frame.height * s)
                                        .frame(width: geo.size.width, height: geo.size.height)
                                }
                                .frame(height: 110)
                                .background(Theme.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .stroke(i == current ? Theme.ink : Theme.line, lineWidth: i == current ? 2 : Theme.hairline))
                                Text("\(i + 1). \(slide.name)")
                                    .font(Theme.body(13, .medium))
                                    .foregroundStyle(Theme.ink)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(Theme.ground)
            .navigationTitle("All screens")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
