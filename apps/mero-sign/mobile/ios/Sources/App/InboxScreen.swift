import SignCore
import SwiftUI

/// Every document across your agreements: To sign, Waiting, Completed.
struct InboxScreen: View {
    @ObservedObject var model: InboxModel
    let openInvitation: (String) -> Void
    @State private var pasting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !model.hasRelay { NoRelayBanner() }
                BucketPicker(selection: $model.bucket, count: model.count)
                content
            }
            .padding(16)
        }
        .background(Palette.ground.ignoresSafeArea())
        .refreshable { await model.load() }
        .task { await model.load() }
        .signNavigation("Inbox")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                AccountMenu(openInvitation: { pasting = true })
            }
        }
        .safeAreaInset(edge: .top) {
            if let notice = model.notice { NoticeBanner(text: notice) { model.notice = nil } }
        }
        .sheet(isPresented: $pasting) {
            PasteInvitationSheet(open: openInvitation).presentationDetents([.medium])
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView().tint(Palette.ink).frame(maxWidth: .infinity).padding(.top, 60)
        case .failed(let message):
            ErrorState(message: message) { Task { await model.load() } }
        case .loaded:
            let entries = model.entries(in: model.bucket)
            if model.bucket == .toSign, !model.unopened.isEmpty { unopenedSection }
            if !model.syncing.isEmpty { syncingNote }
            if entries.isEmpty {
                empty
            } else {
                Card {
                    VStack(spacing: 0) {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            NavigationLink(value: DocumentRoute(agreement: entry.agreement, documentId: entry.document.id)) {
                                DocumentRowView(entry: entry)
                            }
                            .buttonStyle(.plain)
                            if index < entries.count - 1 { Divider().overlay(Palette.hairline).padding(.leading, 72) }
                        }
                    }
                }
            }
        }
    }

    private var unopenedSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "New agreements")
            Card {
                VStack(spacing: 0) {
                    ForEach(Array(model.unopened.enumerated()), id: \.element.id) { index, agreement in
                        HStack(spacing: 12) {
                            Avatar(label: agreement.name, seed: agreement.contextId, size: 40, square: true, symbol: "folder")
                            VStack(alignment: .leading, spacing: 3) {
                                Text(agreement.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
                                Text(agreement.workspaceName).font(.system(size: 13)).foregroundStyle(Palette.muted)
                            }
                            Spacer()
                            Button {
                                Haptics.tap()
                                Task { await model.open(agreement) }
                            } label: {
                                if model.opening == agreement.contextId {
                                    ProgressView().tint(Palette.ink).frame(minWidth: 44)
                                } else {
                                    Text("Open")
                                }
                            }
                            .buttonStyle(PrimaryButtonStyle(compact: true))
                            .disabled(model.opening != nil)
                        }
                        .padding(14)
                        if index < model.unopened.count - 1 { Divider().overlay(Palette.hairline).padding(.leading, 66) }
                    }
                }
            }
        }
    }

    private var syncingNote: some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small).tint(Palette.inkSoft)
            Text(
                model.syncing.count == 1
                    ? "“\(model.syncing[0].name)” is still syncing to your account."
                    : "\(model.syncing.count) agreements are still syncing to your account."
            )
            .font(.system(size: 14)).foregroundStyle(Palette.inkSoft)
        }
        .padding(.horizontal, 4)
    }

    @ViewBuilder private var empty: some View {
        switch model.bucket {
        case .toSign:
            EmptyState(
                symbol: "checkmark.circle", title: "Nothing to sign",
                message: "When someone sends you an agreement, the documents waiting on your signature show up here.",
                action: ("Open an invitation link", { pasting = true }))
        case .waiting:
            EmptyState(
                symbol: "clock", title: "Nothing waiting",
                message: "Documents you signed that still need other signatures show up here.")
        case .completed:
            EmptyState(
                symbol: "checkmark.seal", title: "No completed documents",
                message: "Once everyone has signed, the final signed version shows up here.")
        }
    }
}

/// To sign / Waiting / Completed, with counts. Lime marks the selected one.
struct BucketPicker: View {
    @Binding var selection: InboxBucket
    let count: (InboxBucket) -> Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(InboxBucket.allCases) { bucket in
                let selected = bucket == selection
                Button {
                    Haptics.tap()
                    withAnimation(.easeOut(duration: 0.15)) { selection = bucket }
                } label: {
                    HStack(spacing: 6) {
                        Text(bucket.title).font(.system(size: 14, weight: .semibold))
                        let n = count(bucket)
                        if n > 0 {
                            Text("\(n)")
                                .font(.system(size: 12, weight: .bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(Capsule().fill(selected ? Palette.ink.opacity(0.12) : Palette.sunken))
                        }
                    }
                    .foregroundStyle(Palette.ink)
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .background(Capsule().fill(selected ? Palette.lime : Color.clear))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Capsule().fill(Palette.surface))
        .overlay(Capsule().stroke(Palette.hairline, lineWidth: 0.5))
    }
}
