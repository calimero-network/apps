import CalendarCore
import SwiftUI

/// What the event sheet is open for.
enum EditorTarget: Identifiable {
    case new(Date)
    case existing(CalendarItem)
    var id: String {
        switch self {
        case .new(let day): return "new-\(day.timeIntervalSince1970)"
        case .existing(let event): return event.id
        }
    }
}

/// An open calendar: month, week, day and agenda views of its events.
struct CalendarScreen: View {
    @StateObject private var model: CalendarModel
    @State private var editor: EditorTarget?
    @State private var showMembers = false
    @State private var showDetails = false
    @State private var askName = false
    @State private var pendingDelete: CalendarItem?

    init(model: @autoclosure @escaping () -> CalendarModel) {
        _model = StateObject(wrappedValue: model())
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                Picker("View", selection: $model.mode) {
                    ForEach(CalendarMode.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("calendar.mode")
                periodHeader
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 10)
            .background(Theme.surface)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }

            if let error = model.error {
                Banner(text: error) { Task { await model.reload() } }
                    .padding(.horizontal, 16).padding(.top, 10)
            }

            Group {
                switch model.mode {
                case .month: MonthView(model: model, open: open)
                case .week: TimeGridView(model: model, days: model.math.weekDays(model.focus), open: open, create: create)
                case .day: TimeGridView(model: model, days: [model.focus], open: open, create: create)
                case .agenda: AgendaView(model: model, open: open, delete: { pendingDelete = $0 })
                }
            }
            .frame(maxHeight: .infinity)
        }
        .background(Theme.ground.ignoresSafeArea())
        .navigationTitle(model.calendar.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button { showMembers = true } label: { Label("Members", systemImage: "person.2") }
                        .accessibilityIdentifier("calendar.members")
                    Button { askName = true } label: { Label("Your name", systemImage: "person.crop.circle") }
                    Button { showDetails = true } label: { Label("Details", systemImage: "info.circle") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("More")
                .accessibilityIdentifier("calendar.more")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { create(model.focus) } label: {
                    Image(systemName: "plus").font(.system(size: 17, weight: .semibold))
                }
                .accessibilityLabel("New event")
                .accessibilityIdentifier("calendar.add")
            }
        }
        .task { await model.start() }
        .task { await model.runLive() }
        .onChange(of: model.needsName) { if $0 { askName = true } }
        .sheet(item: $editor) { target in
            EventEditor(model: model, target: target)
        }
        .sheet(isPresented: $askName) {
            NameSheet(initial: model.suggestedName) { name in
                Task { await model.setName(name) }
            } onSkip: {
                model.skipName()
            }
        }
        .sheet(isPresented: $showMembers) { MembersSheet(model: model) }
        .sheet(isPresented: $showDetails) { CalendarDetailsSheet(model: model) }
        .confirmationDialog(
            "Delete this event?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let event = pendingDelete {
                    Theme.haptic()
                    Task {
                        do { try await model.delete(event) } catch {
                            model.error = ErrorText.describe(error, doing: "delete the event")
                        }
                    }
                }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        }
    }

    private var periodHeader: some View {
        HStack(spacing: 8) {
            Text(model.title)
                .font(Theme.heading(18))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer()
            if model.mode != .agenda {
                Button { withAnimation(.easeInOut(duration: 0.2)) { model.step(-1) } } label: {
                    Image(systemName: "chevron.left").frame(width: 32, height: 30)
                }
                .accessibilityLabel("Previous")
                Button { withAnimation(.easeInOut(duration: 0.2)) { model.step(1) } } label: {
                    Image(systemName: "chevron.right").frame(width: 32, height: 30)
                }
                .accessibilityLabel("Next")
            }
            Button("Today") { withAnimation(.easeInOut(duration: 0.2)) { model.goToToday() } }
                .buttonStyle(PillButtonStyle())
                .accessibilityIdentifier("calendar.today")
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(Theme.ink)
    }

    private func open(_ event: CalendarItem) { editor = .existing(event) }
    private func create(_ day: Date) {
        Theme.haptic(.light)
        editor = .new(day)
    }
}

// MARK: - Month

struct MonthView: View {
    @ObservedObject var model: CalendarModel
    let open: (CalendarItem) -> Void

    var body: some View {
        let math = model.math
        let grid = math.monthGrid(model.focus)
        let symbols = ["M", "T", "W", "T", "F", "S", "S"]
        ScrollView {
            VStack(spacing: 14) {
                VStack(spacing: 6) {
                    HStack(spacing: 0) {
                        ForEach(0..<7, id: \.self) { i in
                            Text(symbols[i]).font(Theme.body(12, .semibold)).foregroundStyle(Theme.muted)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 4) {
                        ForEach(grid, id: \.self) { day in
                            DayCell(
                                day: day, inMonth: math.isSameMonth(day, model.focus),
                                isToday: math.isSameDay(day, Date()), isSelected: math.isSameDay(day, model.focus),
                                colors: model.events(on: day).prefix(3).map { Theme.eventColor($0.color) },
                                number: math.calendar.component(.day, from: day)
                            )
                            .accessibilityIdentifier("month.day.\(dayKey(day))")
                            .onTapGesture {
                                Theme.haptic(.light)
                                model.focus = math.startOfDay(day)
                            }
                        }
                    }
                }
                .card(padding: 10)

                let items = model.events(on: model.focus)
                VStack(alignment: .leading, spacing: 8) {
                    Theme.label(dayHeading(model.focus))
                    if items.isEmpty {
                        Text("No events").font(Theme.body(15)).foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .card()
                    } else {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, event in
                            Button { open(event) } label: { EventRow(event: event, model: model, day: model.focus) }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("month.event.\(index)")
                        }
                    }
                }
            }
            .padding(16)
        }
        .refreshable { await model.reload() }
        .gesture(
            DragGesture(minimumDistance: 30).onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                withAnimation(.easeInOut(duration: 0.2)) { model.step(value.translation.width < 0 ? 1 : -1) }
            })
    }

    /// `2026-10-28`, for the day cell's accessibility identifier.
    private func dayKey(_ day: Date) -> String {
        let c = model.math.calendar.dateComponents([.year, .month, .day], from: day)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private func dayHeading(_ day: Date) -> String {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEEEMMMMd")
        return f.string(from: day)
    }
}

private struct DayCell: View {
    let day: Date
    let inMonth: Bool
    let isToday: Bool
    let isSelected: Bool
    let colors: [Color]
    let number: Int

    var body: some View {
        VStack(spacing: 3) {
            Text("\(number)")
                .font(Theme.body(15, isToday || isSelected ? .semibold : .regular))
                .foregroundStyle(foreground)
                .frame(width: 34, height: 34)
                .background(Circle().fill(background))
            HStack(spacing: 3) {
                ForEach(Array(colors.enumerated()), id: \.offset) { _, color in
                    Circle().fill(color).frame(width: 5, height: 5)
                }
            }
            .frame(height: 5)
        }
        .frame(maxWidth: .infinity, minHeight: 48)
        .contentShape(Rectangle())
        .opacity(inMonth ? 1 : 0.35)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var background: Color {
        if isSelected { return Theme.lime }
        if isToday { return Theme.ink }
        return .clear
    }

    private var foreground: Color { isToday && !isSelected ? .white : Theme.ink }
}

// MARK: - Agenda

struct AgendaView: View {
    @ObservedObject var model: CalendarModel
    let open: (CalendarItem) -> Void
    let delete: (CalendarItem) -> Void

    var body: some View {
        let sections = model.math.agenda(model.events, from: model.focus)
        if sections.isEmpty && model.hasLoaded {
            ScrollView {
                EmptyStateView(symbol: "calendar", title: "Nothing coming up", message: "Tap + to add an event.") {
                    EmptyView()
                }
                .padding(.top, 40)
            }
            .refreshable { await model.reload() }
        } else {
            List {
                ForEach(Array(sections.enumerated()), id: \.element.day) { sectionIndex, section in
                    Section {
                        ForEach(Array(section.items.enumerated()), id: \.element.id) { index, event in
                            Button { open(event) } label: { EventRow(event: event, model: model, day: section.day) }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("agenda.event.\(sectionIndex).\(index)")
                                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    if model.canEdit(event) {
                                        Button(role: .destructive) { delete(event) } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                                }
                        }
                    } header: {
                        Theme.label(heading(section.day))
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .refreshable { await model.reload() }
        }
    }

    private func heading(_ day: Date) -> String {
        let math = model.math
        if math.isSameDay(day, Date()) { return "Today" }
        if math.isSameDay(day, math.addDays(1, to: Date())) { return "Tomorrow" }
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEEEMMMd")
        return f.string(from: day)
    }
}

// MARK: - Event row

/// An event in a list: times, a color bar, the title, private / invitees.
struct EventRow: View {
    let event: CalendarItem
    @ObservedObject var model: CalendarModel
    let day: Date

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .trailing, spacing: 2) {
                if event.isAllDay {
                    Text("All day").font(Theme.body(13, .semibold))
                } else {
                    Text(timeText(max(event.start, model.math.startOfDay(day)))).font(Theme.body(13, .semibold))
                    Text(timeText(event.end)).font(Theme.body(12)).foregroundStyle(Theme.muted)
                }
            }
            .foregroundStyle(Theme.ink)
            .frame(width: 52, alignment: .trailing)

            RoundedRectangle(cornerRadius: 2).fill(Theme.eventColor(event.color)).frame(width: 4)

            VStack(alignment: .leading, spacing: 3) {
                Text(event.title).font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink).lineLimit(2)
                HStack(spacing: 10) {
                    if event.isPrivate {
                        Label("Private", systemImage: "lock.fill")
                    }
                    if !event.peers.isEmpty {
                        Label("\(event.peers.count + 1)", systemImage: "person.2")
                    }
                    if !model.canEdit(event) {
                        Text(model.displayName(event.owner))
                    }
                }
                .font(Theme.body(12))
                .foregroundStyle(Theme.muted)
                .labelStyle(CompactLabelStyle())
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .background(Theme.eventColor(event.color).opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).stroke(Theme.line, lineWidth: 1))
        .contentShape(Rectangle())
    }

    private func timeText(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }
}

struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.font(.system(size: 10, weight: .semibold))
            configuration.title
        }
    }
}
