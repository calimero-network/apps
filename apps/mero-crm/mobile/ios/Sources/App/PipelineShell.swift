import CrmCore
import MeroKit
import SwiftUI

/// Where a row leads.
enum Route: Hashable {
    case deal(String)
    case contact(String)
    case company(String)
    case insights
    case stages
    case automations
    case settings
}

enum Tab: Hashable {
    case pipeline, deals, people, todos, more
}

/// One open pipeline: the five tabs over one live snapshot.
struct PipelineShell: View {
    @StateObject private var model: PipelineModel
    let onSwitch: () -> Void
    let onSignOut: () -> Void
    @State private var tab: Tab = .pipeline

    init(pipeline: PipelineRef, backend: any MeroAppBackend, onSwitch: @escaping () -> Void, onSignOut: @escaping () -> Void) {
        _model = StateObject(wrappedValue: PipelineModel(pipeline: pipeline, backend: backend))
        self.onSwitch = onSwitch
        self.onSignOut = onSignOut
    }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { BoardView(onSwitch: onSwitch).routes() }
                .tabItem { Label("Pipeline", systemImage: "rectangle.split.3x1") }
                .tag(Tab.pipeline)
            NavigationStack { DealsView().routes() }
                .tabItem { Label("Deals", systemImage: "list.bullet.rectangle") }
                .tag(Tab.deals)
            NavigationStack { PeopleView().routes() }
                .tabItem { Label("People", systemImage: "person.2") }
                .tag(Tab.people)
            NavigationStack { TodosView().routes() }
                .tabItem { Label("To-dos", systemImage: "checklist") }
                .badge(overdue)
                .tag(Tab.todos)
            NavigationStack { MoreView(onSwitch: onSwitch, onSignOut: onSignOut).routes() }
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .tag(Tab.more)
        }
        .environmentObject(model)
        .notices($model.notice)
        .task { await model.run() }
    }

    private var overdue: Int {
        let today = model.calendar.startOfDay(for: model.now())
        return model.activities.filter { !$0.done && Days.date($0.dueAt) < today && model.isMe($0.owner) }.count
    }
}

extension View {
    /// The screens every tab's stack can push.
    func routes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .deal(let id): DealDetailView(dealId: id)
            case .contact(let id): ContactDetailView(contactId: id)
            case .company(let key): CompanyDetailView(key: key)
            case .insights: InsightsView()
            case .stages: StagesView()
            case .automations: AutomationsView()
            case .settings: PipelineSettingsView()
            }
        }
    }
}

/// The loading / syncing / error states every list shares before the first read lands.
struct LoadGate<Content: View>: View {
    @EnvironmentObject private var model: PipelineModel
    @ViewBuilder let content: Content

    var body: some View {
        if model.hasLoaded {
            content
        } else if model.warmingUp {
            VStack(spacing: 14) {
                ProgressView()
                Text("Syncing this pipeline from your teammates…").font(.subheadline).foregroundStyle(Palette.ink2)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(32)
        } else if let error = model.error {
            VStack(spacing: 14) {
                EmptyState(icon: "exclamationmark.triangle", title: "Can't load this pipeline", message: error)
                Button("Try again") { Task { await model.load() } }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(maxWidth: 220)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(24)
        } else {
            ProgressView("Loading pipeline…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
