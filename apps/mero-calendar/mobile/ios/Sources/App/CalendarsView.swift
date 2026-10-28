import CalendarCore
import SwiftUI

/// One team's calendars: pick one to open, or start another.
struct CalendarsView: View {
    @StateObject private var model: CalendarsModel
    @ObservedObject var teams: TeamsModel
    @Binding var path: [Route]
    @State private var creating = false
    @State private var inviting = false
    @State private var openError: String?

    init(model: @autoclosure @escaping () -> CalendarsModel, teams: TeamsModel, path: Binding<[Route]>) {
        _model = StateObject(wrappedValue: model())
        self.teams = teams
        _path = path
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Pick a calendar to open, or start another one in this team.")
                    .font(Theme.body(15)).foregroundStyle(Theme.muted)
                if let error = openError ?? model.error {
                    Banner(text: error) {
                        openError = nil
                        Task { await model.load() }
                    }
                }
                content
                DetailsDisclosure(rows: [("Team id", model.team.id)])
                    .padding(.top, 8)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Theme.ground.ignoresSafeArea())
        .refreshable { await model.load() }
        .navigationTitle(model.team.name)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { inviting = true } label: { Image(systemName: "person.badge.plus") }
                    .accessibilityLabel("Invite")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { creating = true } label: { Image(systemName: "plus").font(.system(size: 17, weight: .semibold)) }
                    .accessibilityLabel("New calendar")
            }
        }
        .task {
            if !model.hasLoaded { await model.load() }
            // A team joined moments ago: its calendars may still be syncing.
            var tries = 0
            while model.calendars.isEmpty, model.justJoined, tries < 18, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                await model.load()
                tries += 1
            }
        }
        .sheet(isPresented: $creating) {
            NameEntrySheet(
                title: "New calendar", label: "Calendar name", placeholder: model.team.name,
                action: "Create calendar", busyAction: "Creating…", allowEmpty: true
            ) { name in
                let calendar = try await model.create(name: name)
                path.append(.calendar(model.team, calendar))
            }
        }
        .sheet(isPresented: $inviting) {
            InviteSheet(team: model.team) { try await teams.inviteLink(for: model.team) }
        }
    }

    @ViewBuilder private var content: some View {
        if !model.hasLoaded {
            ProgressView().tint(Theme.ink).frame(maxWidth: .infinity).padding(.top, 60)
        } else if model.calendars.isEmpty {
            EmptyStateView(
                symbol: model.justJoined ? "arrow.triangle.2.circlepath" : "calendar",
                title: model.justJoined ? "Syncing calendars…" : "No calendars yet",
                message: model.justJoined
                    ? "You just joined. This team's calendars are on their way."
                    : "Create the first calendar in this team."
            ) {
                Button("New calendar") { creating = true }.buttonStyle(PrimaryButtonStyle())
            }
            .card()
        } else {
            LazyVStack(spacing: 10) {
                ForEach(model.calendars) { calendar in
                    Button {
                        open(calendar)
                    } label: {
                        TeamRow(
                            title: calendar.name, subtitle: "Calendar", symbol: "calendar",
                            busy: model.opening == calendar.id)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.opening != nil)
                }
            }
        }
    }

    private func open(_ calendar: TeamCalendar) {
        openError = nil
        Theme.haptic(.light)
        Task {
            do {
                try await model.open(calendar)
                path.append(.calendar(model.team, calendar))
            } catch {
                openError = ErrorText.describe(error, doing: "open this calendar")
            }
        }
    }
}
