import MeroKit
import SignCore
import SwiftUI

/// Your workspaces and the agreements in each.
struct AgreementsScreen: View {
    @ObservedObject var model: AgreementsModel
    let openInvitation: (String) -> Void
    let push: (AgreementRef) -> Void
    @State private var pasting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if !model.hasRelay { NoRelayBanner() }
                content
            }
            .padding(16)
        }
        .background(Palette.ground.ignoresSafeArea())
        .refreshable { await model.load() }
        .task { await model.load() }
        .signNavigation("Agreements")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    pasting = true
                } label: {
                    Image(systemName: "link.badge.plus").foregroundStyle(Palette.ink)
                }
                .accessibilityLabel("Open an invitation link")
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
            if model.sections.isEmpty {
                EmptyState(
                    symbol: "folder", title: "No agreements yet",
                    message: "Agreements are created and shared from Mero Sign on the web. Open the invitation link you were sent to join one.",
                    action: ("Open an invitation link", { pasting = true }))
            } else {
                ForEach(model.sections) { section in
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(text: section.name, trailing: "\(section.agreements.count)")
                        if section.agreements.isEmpty {
                            Card {
                                Text("No agreements in this workspace yet.")
                                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(14)
                            }
                        } else {
                            Card {
                                VStack(spacing: 0) {
                                    ForEach(Array(section.agreements.enumerated()), id: \.element.id) { index, row in
                                        agreementRow(row)
                                        if index < section.agreements.count - 1 {
                                            Divider().overlay(Palette.hairline).padding(.leading, 66)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func agreementRow(_ row: AgreementRow) -> some View {
        Button {
            Haptics.tap()
            Task {
                if await model.prepare(row) { push(row.agreement) }
            }
        } label: {
            HStack(spacing: 12) {
                Avatar(label: row.agreement.name, seed: row.agreement.contextId, size: 40, square: true, symbol: "doc.on.doc")
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.agreement.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
                    Text(row.joined ? "Open" : "Not opened yet — tap to join")
                        .font(.system(size: 13)).foregroundStyle(Palette.muted)
                }
                Spacer()
                if model.opening == row.id {
                    ProgressView().tint(Palette.ink)
                } else {
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.muted)
                }
            }
            .padding(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.opening != nil)
    }
}

/// One agreement: its documents and the people in it.
struct AgreementScreen: View {
    @StateObject private var model: AgreementModel
    @State private var tab = 0

    init(model: @autoclosure @escaping () -> AgreementModel) {
        _model = StateObject(wrappedValue: model())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                Picker("Show", selection: $tab) {
                    Text("Documents").tag(0)
                    Text("People").tag(1)
                }
                .pickerStyle(.segmented)
                switch model.phase {
                case .loading:
                    ProgressView().tint(Palette.ink).frame(maxWidth: .infinity).padding(.top, 40)
                case .failed(let message):
                    ErrorState(message: message) { Task { await model.load() } }
                case .loaded:
                    if tab == 0 { documents } else { people }
                }
                Card {
                    DetailsDisclosure(rows: [
                        ("Agreement context", model.agreement.contextId),
                        ("Agreement group", model.agreement.agreementId),
                        ("Workspace", model.agreement.namespaceId),
                        ("Your account", model.snapshot?.me ?? ""),
                    ])
                    .padding(.horizontal, 14)
                }
            }
            .padding(16)
        }
        .background(Palette.ground.ignoresSafeArea())
        .refreshable { await model.load() }
        .task { await model.load() }
        .task(id: model.isSyncing) {
            while model.isSyncing, !Task.isCancelled {
                try? await Task.sleep(for: SignConstants.pollInterval)
                await model.load()
            }
        }
        .signNavigation(model.agreement.name)
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(systemName: "signature")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 52, height: 52)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.lime))
            VStack(alignment: .leading, spacing: 4) {
                Text(model.agreement.name).font(Typeface.display(22)).foregroundStyle(Palette.ink)
                HStack(spacing: 10) {
                    Label(model.agreement.workspaceName, systemImage: "building.2")
                    if let snapshot = model.snapshot {
                        Label("\(snapshot.details.participants.count)", systemImage: "person.2")
                        Label("\(snapshot.documents.count)", systemImage: "doc.text")
                    }
                }
                .font(.system(size: 13))
                .foregroundStyle(Palette.muted)
                .labelStyle(.titleAndIcon)
            }
        }
    }

    @ViewBuilder private var documents: some View {
        if model.isSyncing, model.snapshot == nil {
            EmptyState(symbol: "arrow.triangle.2.circlepath", title: "Syncing", message: "This agreement is still reaching your account. It opens on its own once it arrives.")
        } else if model.documents.isEmpty {
            EmptyState(
                symbol: "doc.text", title: "No documents yet",
                message: "Documents are uploaded from Mero Sign on the web. They appear here for you to sign.")
        } else {
            Card {
                VStack(spacing: 0) {
                    ForEach(Array(model.documents.enumerated()), id: \.element.id) { index, entry in
                        NavigationLink(value: DocumentRoute(agreement: entry.agreement, documentId: entry.document.id)) {
                            DocumentRowView(entry: entry, showAgreement: false)
                        }
                        .buttonStyle(.plain)
                        if index < model.documents.count - 1 { Divider().overlay(Palette.hairline).padding(.leading, 72) }
                    }
                }
            }
        }
    }

    @ViewBuilder private var people: some View {
        if model.people.isEmpty {
            EmptyState(symbol: "person.2", title: "Nobody yet", message: "People appear here once they join this agreement.")
        } else {
            Card {
                VStack(spacing: 0) {
                    ForEach(Array(model.people.enumerated()), id: \.element.id) { index, person in
                        PersonRowView(person: person)
                        if index < model.people.count - 1 { Divider().overlay(Palette.hairline).padding(.leading, 66) }
                    }
                }
            }
        }
    }
}

struct PersonRowView: View {
    let person: PersonRow

    var body: some View {
        let (level, description) = SignFormat.level(person.level)
        HStack(alignment: .top, spacing: 12) {
            Avatar(label: person.name ?? "", seed: person.account, size: 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(person.displayName).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
                    if person.isMe { Text("(you)").font(.system(size: 14)).foregroundStyle(Palette.muted) }
                }
                HStack(spacing: 6) {
                    Badge(text: level, strong: person.level == .admin)
                    Text(description).font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
    }
}
