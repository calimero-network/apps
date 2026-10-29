import StandupCore
import SwiftUI
import UIKit

/// A week of standups per person, shareable as Markdown for a weekly report.
struct WeekTab: View {
    @ObservedObject var team: TeamModel
    @ObservedObject var model: WeekModel
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    header
                    if let error = model.error { Card { ErrorLine(message: error) } }
                    if model.week == nil, model.isLoading {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
                    } else if model.week != nil, model.people.isEmpty {
                        Card { EmptyState(icon: "calendar", title: "No updates this week.") }
                    }
                    ForEach(Array(model.people.enumerated()), id: \.element.id) { index, person in
                        PersonCard(team: team, model: model, person: person)
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("week.person.\(index)")
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle("Week")
            .refreshable { await model.load() }
            .task { await model.load() }
            .onChange(of: team.version) { _ in Task { await model.load() } }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        UIPasteboard.general.string = model.markdown
                        Haptics.success()
                        copied = true
                        Task {
                            try? await Task.sleep(for: .seconds(2))
                            copied = false
                        }
                    } label: {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc").accessibilityLabel(copied ? "Copied" : "Copy as Markdown")
                    }
                    .disabled(model.week == nil)
                    ShareLink(item: model.markdown) {
                        Image(systemName: "square.and.arrow.up").accessibilityLabel("Share")
                    }
                    .disabled(model.week == nil)
                }
            }
        }
    }

    private var header: some View {
        Card(padding: 12) {
            HStack {
                Button { Task { await model.shift(by: -1) } } label: {
                    Image(systemName: "chevron.left").frame(width: 36, height: 36)
                }
                .accessibilityLabel("Previous week")
                .accessibilityIdentifier("week.prev")
                Spacer()
                VStack(spacing: 2) {
                    Text(model.isThisWeek ? "This week" : "Week of").font(.headline).foregroundStyle(Palette.ink)
                    Text(model.range).font(.subheadline).foregroundStyle(Palette.ink2)
                }
                Spacer()
                Button { Task { await model.shift(by: 1) } } label: {
                    Image(systemName: "chevron.right").frame(width: 36, height: 36)
                }
                .disabled(model.isThisWeek)
                .accessibilityLabel("Next week")
                .accessibilityIdentifier("week.next")
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(Palette.ink)
        }
    }
}

private struct PersonCard: View {
    @ObservedObject var team: TeamModel
    @ObservedObject var model: WeekModel
    let person: PersonWeek

    var body: some View {
        Card {
            HStack(spacing: 10) {
                Avatar(account: person.account, name: person.name)
                Text(team.name(of: person.account, person.name)).font(.headline).foregroundStyle(Palette.ink)
                Spacer()
                Text("\(person.updates.count) day\(person.updates.count == 1 ? "" : "s")")
                    .font(.footnote).foregroundStyle(Palette.ink2)
            }
            ForEach(person.updates, id: \.day) { update in
                HStack(alignment: .top, spacing: 12) {
                    Text(model.weekday(update.day)).font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink2)
                        .frame(width: 34, alignment: .leading)
                    VStack(alignment: .leading, spacing: 4) {
                        if !update.done.isEmpty { RichTextView(text: update.done) }
                        if !update.next.isEmpty {
                            Text("Next: \(firstLine(update.next))").font(.footnote).foregroundStyle(Palette.ink2)
                        }
                        if !update.blockers.isEmpty {
                            Text("Blocked: \(firstLine(update.blockers))").font(.footnote).foregroundStyle(Palette.danger)
                        }
                    }
                }
                .padding(.top, 2)
            }
        }
    }

    private func firstLine(_ text: String) -> String {
        String(text.split(separator: "\n").first ?? "")
    }
}
