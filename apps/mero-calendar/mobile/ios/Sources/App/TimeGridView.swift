import CalendarCore
import SwiftUI

/// The week and day views: day headers, an all-day strip, and a 24-hour grid
/// with events placed by time, overlaps side by side.
struct TimeGridView: View {
    @ObservedObject var model: CalendarModel
    let days: [Date]
    let open: (CalendarItem) -> Void
    let create: (Date) -> Void

    private let hourHeight: CGFloat = 52
    private let gutter: CGFloat = 44

    var body: some View {
        let math = model.math
        VStack(spacing: 0) {
            if days.count > 1 { dayHeaders }
            allDayStrip
            ScrollViewReader { proxy in
                ScrollView {
                    ZStack(alignment: .topLeading) {
                        hourLines
                        HStack(spacing: 0) {
                            Color.clear.frame(width: gutter)
                            ForEach(days, id: \.self) { day in
                                dayColumn(day)
                                    .overlay(alignment: .leading) {
                                        Rectangle().fill(Theme.line).frame(width: 0.5)
                                    }
                            }
                        }
                        nowLine
                    }
                    .frame(height: hourHeight * 24)
                    .padding(.vertical, 8)
                }
                .onAppear { proxy.scrollTo(7, anchor: .top) }
                .onChange(of: model.mode) { _ in proxy.scrollTo(7, anchor: .top) }
            }
        }
        .background(Theme.surface)
        .gesture(
            DragGesture(minimumDistance: 30).onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                withAnimation(.easeInOut(duration: 0.2)) { model.step(value.translation.width < 0 ? 1 : -1) }
            })
        .id(math.startOfDay(days.first ?? Date()))
    }

    private var dayHeaders: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: gutter)
            ForEach(days, id: \.self) { day in
                let isToday = model.math.isSameDay(day, Date())
                let isFocus = model.math.isSameDay(day, model.focus)
                Button {
                    Theme.haptic(.light)
                    model.focus = day
                    model.mode = .day
                } label: {
                    VStack(spacing: 3) {
                        Text(day.formatted(.dateTime.weekday(.narrow))).font(Theme.body(11, .semibold))
                            .foregroundStyle(Theme.muted)
                        Text("\(model.math.calendar.component(.day, from: day))")
                            .font(Theme.body(15, .semibold))
                            .foregroundStyle(isToday ? .white : Theme.ink)
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(isToday ? Theme.ink : (isFocus ? Theme.lime : .clear)))
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
        .background(Theme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 0.5) }
    }

    @ViewBuilder private var allDayStrip: some View {
        let perDay = days.map { day in model.events(on: day).filter(\.isAllDay) }
        if perDay.contains(where: { !$0.isEmpty }) {
            HStack(alignment: .top, spacing: 0) {
                Text("all-day").font(Theme.body(10, .semibold)).foregroundStyle(Theme.muted)
                    .frame(width: gutter, alignment: .center)
                    .padding(.top, 6)
                ForEach(Array(days.enumerated()), id: \.offset) { index, _ in
                    VStack(spacing: 2) {
                        ForEach(perDay[index].prefix(3)) { event in
                            Button { open(event) } label: {
                                Text(event.title)
                                    .font(Theme.body(11, .semibold))
                                    .foregroundStyle(Theme.ink)
                                    .lineLimit(1)
                                    .padding(.horizontal, 5)
                                    .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
                                    .background(Theme.eventColor(event.color).opacity(0.22), in: RoundedRectangle(cornerRadius: 5))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(2)
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 4)
            .background(Theme.surface)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 0.5) }
        }
    }

    private var hourLines: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                HStack(alignment: .top, spacing: 6) {
                    Text(hourLabel(hour))
                        .font(Theme.body(10, .medium))
                        .foregroundStyle(Theme.faint)
                        .frame(width: gutter - 8, alignment: .trailing)
                        .offset(y: -6)
                        .opacity(hour == 0 ? 0 : 1)
                    Rectangle().fill(Theme.line).frame(height: 0.5)
                }
                .frame(height: hourHeight, alignment: .top)
                .id(hour)
            }
        }
    }

    private func dayColumn(_ day: Date) -> some View {
        GeometryReader { geo in
            let slots = model.math.layout(model.events, on: day)
            ZStack(alignment: .topLeading) {
                // Tap an empty hour to start an event there.
                VStack(spacing: 0) {
                    ForEach(0..<24, id: \.self) { hour in
                        Color.clear.contentShape(Rectangle()).frame(height: hourHeight)
                            .onTapGesture {
                                let start = model.math.calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
                                create(start)
                            }
                    }
                }
                ForEach(slots) { slot in
                    let width = geo.size.width / CGFloat(slot.columns)
                    EventBlock(event: slot.event, compact: days.count > 1)
                        .frame(
                            width: max(width - 2, 10),
                            height: max(CGFloat(slot.endMinute - slot.startMinute) / 60 * hourHeight - 2, 18))
                        .offset(
                            x: CGFloat(slot.column) * width + 1,
                            y: CGFloat(slot.startMinute) / 60 * hourHeight + 1)
                        .onTapGesture { open(slot.event) }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var nowLine: some View {
        let now = Date()
        if let index = days.firstIndex(where: { model.math.isSameDay($0, now) }) {
            GeometryReader { geo in
                let columnWidth = (geo.size.width - gutter) / CGFloat(days.count)
                let minutes = now.timeIntervalSince(model.math.startOfDay(now)) / 60
                HStack(spacing: 0) {
                    Circle().fill(Theme.now).frame(width: 8, height: 8)
                    Rectangle().fill(Theme.now).frame(height: 1.5)
                }
                .frame(width: columnWidth + 4)
                .offset(x: gutter + CGFloat(index) * columnWidth - 4, y: CGFloat(minutes) / 60 * hourHeight - 4)
            }
            .allowsHitTesting(false)
        }
    }

    private func hourLabel(_ hour: Int) -> String {
        let date = model.math.calendar.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) ?? Date()
        return date.formatted(.dateTime.hour())
    }
}

/// A timed event in the grid.
struct EventBlock: View {
    let event: CalendarItem
    var compact = false

    var body: some View {
        let color = Theme.eventColor(event.color)
        HStack(spacing: 0) {
            Rectangle().fill(color).frame(width: 3)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 3) {
                    if event.isPrivate { Image(systemName: "lock.fill").font(.system(size: 8, weight: .bold)) }
                    Text(event.title).font(Theme.body(compact ? 11 : 13, .semibold)).lineLimit(compact ? 3 : 2)
                }
                if !compact {
                    Text(event.start.formatted(date: .omitted, time: .shortened))
                        .font(Theme.body(11)).foregroundStyle(Theme.muted)
                }
            }
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 4)
            .padding(.vertical, 3)
            Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(color.opacity(0.18))
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
    }
}
