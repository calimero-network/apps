import Foundation
import LobbyGenerated
import MeroKit

/// The lobbies (Calimero orgs running Battleships) this account is in, and founding a new one.
/// (Kotlin `LobbiesModel`; the web app's `LobbySelect` + `useNamespaceBootstrap`.)
@MainActor
public final class LobbiesModel: ObservableObject {
    @Published public private(set) var lobbies: [AppNamespace] = []
    @Published public private(set) var phase: LoadPhase = .loading

    public let backend: any BattleshipsBackend
    /// The session's application id, when known: what a lobby context is created with.
    public let applicationId: String?

    public init(backend: any BattleshipsBackend, applicationId: String?) {
        self.backend = backend
        self.applicationId = applicationId
    }

    public func load() async {
        if lobbies.isEmpty { phase = .loading }
        do {
            let all = try await backend.app.listNamespaces()
            lobbies = all.sorted { Names.lobby($0).localizedCaseInsensitiveCompare(Names.lobby($1)) == .orderedAscending }
            phase = .loaded
        } catch {
            if lobbies.isEmpty { phase = .failed(ErrorText.describe(error)) }
        }
    }

    /// Found a lobby: an org for the package, with an org-wide app instance of the lobby service
    /// (the web app's `createNamespaceWithLobby`). Match instances are created beside it.
    public func create(name raw: String) async throws -> AppNamespace {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw BattleshipsError.invalid("Give the lobby a name.") }
        guard backend.app.hasRelay else { throw BattleshipsError.invalid("Sign in to create a lobby.") }
        let founded = try await backend.app.foundNamespace(name: name)
        let listed = (try? await backend.app.listNamespaces()) ?? []
        let appId = listed.first { $0.id == founded.namespaceId }?.applicationId ?? applicationId ?? ""
        guard !appId.isEmpty else { throw BattleshipsError.invalid("Still connecting. Try again in a moment.") }
        _ = try await backend.createServiceContext(
            groupId: founded.namespaceId, applicationId: appId, service: Battleships.lobbyService, name: "lobby",
            initArgs: .object([:]))
        let lobby = AppNamespace(id: founded.namespaceId, name: name, applicationId: appId, memberCount: 1)
        if !lobbies.contains(where: { $0.id == lobby.id }) { lobbies.insert(lobby, at: 0) }
        phase = .loaded
        return lobby
    }
}

/// Creating a match, from the lobby and from a finished match's rematch: allocate it in the
/// lobby, create the game context beside the lobby's (the namespace root group, so the game's
/// `xcall` reaches the lobby), then record the context in the lobby. (The web app's `createMatch`.)
public enum MatchMaker {
    public static func create(
        backend: any BattleshipsBackend, namespace: AppNamespace, lobbyContextId: String, opponent: String
    ) async throws -> MatchRef {
        let key = opponent.trimmingCharacters(in: .whitespaces).lowercased()
        guard LobbyInvitation.isKey(key) else { throw BattleshipsError.invalid("That is not a valid player key.") }
        var applicationId = namespace.applicationId
        if applicationId.isEmpty {
            // A lobby opened straight from an invitation does not know its application yet.
            applicationId = try await backend.app.listNamespaces().first { $0.id == namespace.id }?.applicationId ?? ""
        }
        guard !applicationId.isEmpty else { throw BattleshipsError.invalid("The lobby is still syncing. Try again in a moment.") }
        let lobby = LobbyClient.make(backend.app.contract, contextId: lobbyContextId)
        let matchId = try await lobby.createMatch(player2: key)
        guard let created = try await lobby.getMatches().first(where: { $0.matchId == matchId }) else {
            throw BattleshipsError.invalid("That match no longer exists in this lobby.")
        }
        let initArgs: JSONValue = .object([
            "player1": .string(created.player1),
            "player2": .string(created.player2),
            "player2_account": .string(created.player2Account),
            "lobby_context_id": .string(lobbyContextId),
            "match_id": .string(matchId),
        ])
        let contextId = try await backend.createServiceContext(
            groupId: namespace.id, applicationId: applicationId, service: Battleships.gameService,
            name: "match", initArgs: initArgs)
        try await lobby.setMatchContextId(matchId: matchId, contextId: contextId)
        return MatchRef(
            namespaceId: namespace.id, lobbyContextId: lobbyContextId, matchId: matchId, contextId: contextId,
            opponent: key)
    }
}

/// One lobby: its matches, the players you can challenge, your record and its history, and
/// inviting people in. (Kotlin `LobbyModel`; the web app's `useBattleshipsLobby` + `LobbyView`.)
@MainActor
public final class LobbyModel: ObservableObject {
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var lobbyContextId: String?
    @Published public private(set) var matches: [MatchSummary] = []
    @Published public private(set) var players: [PlayerEntry] = []
    @Published public private(set) var stats: PlayerStatsView?
    @Published public private(set) var history: [MatchRecord] = []
    @Published public private(set) var me: String
    @Published public private(set) var challenging: String?
    @Published public var notice: String?

    public let backend: any BattleshipsBackend
    public let namespace: AppNamespace
    private let syncAttempts: Int
    private let syncDelay: Duration
    private var registered = false

    public init(
        backend: any BattleshipsBackend, namespace: AppNamespace, syncAttempts: Int = 8,
        syncDelay: Duration = .seconds(2)
    ) {
        self.backend = backend
        self.namespace = namespace
        self.me = backend.app.account
        self.syncAttempts = syncAttempts
        self.syncDelay = syncDelay
    }

    public var name: String { Names.lobby(namespace) }

    /// Players who opened this lobby, other than you: who you can challenge.
    public var opponents: [PlayerEntry] {
        players.filter { $0.player.lowercased() != me.lowercased() && $0.account.lowercased() != backend.app.account.lowercased() }
    }

    /// Your matches, the ones still going first, newest first within each.
    public var myMatches: [MatchSummary] {
        matches.filter { isMine($0) }.sorted { lhs, rhs in
            let l = lhs.status == .finished ? 1 : 0
            let r = rhs.status == .finished ? 1 : 0
            return l != r ? l < r : lhs.createdMs > rhs.createdMs
        }
    }

    /// Newest first.
    public var sortedHistory: [MatchRecord] { history.sorted { $0.finishedMs > $1.finishedMs } }

    public func isMine(_ match: MatchSummary) -> Bool {
        let key = me.lowercased()
        return match.player1.lowercased() == key || match.player2.lowercased() == key
    }

    public func opponent(in match: MatchSummary) -> String {
        match.player1.lowercased() == me.lowercased() ? match.player2 : match.player1
    }

    public func ref(for match: MatchSummary) -> MatchRef? {
        guard let lobbyContextId, let contextId = match.contextId, !contextId.isEmpty else { return nil }
        return MatchRef(
            namespaceId: namespace.id, lobbyContextId: lobbyContextId, matchId: match.matchId, contextId: contextId,
            opponent: opponent(in: match))
    }

    /// Find the lobby context, make sure this account is in it, record who you play as, read it all.
    public func load() async {
        if lobbyContextId == nil {
            phase = .loading
            for attempt in 0..<syncAttempts {
                if attempt > 0 { await pause(syncDelay) }
                if Task.isCancelled { return }
                do {
                    if let found = try await resolveLobbyContext() {
                        lobbyContextId = found
                        break
                    }
                } catch {
                    if attempt == syncAttempts - 1 {
                        phase = .failed(ErrorText.describe(error))
                        return
                    }
                }
            }
            guard let lobbyContextId else {
                phase = .failed("This lobby isn't ready yet. Pull to refresh in a moment.")
                return
            }
            if (try? await backend.app.isMember(contextId: lobbyContextId)) != true {
                try? await backend.app.joinContext(contextId: lobbyContextId)
            }
        }
        if !registered, let lobbyContextId {
            if let key = try? await LobbyClient.make(backend.app.contract, contextId: lobbyContextId).registerPlayer(),
                LobbyInvitation.isKey(key)
            {
                me = key.lowercased()
                registered = true
            }
        }
        await refresh()
    }

    /// Re-read the lobby's matches, players, your record and the history.
    public func refresh() async {
        guard let lobbyContextId else { return }
        let lobby = LobbyClient.make(backend.app.contract, contextId: lobbyContextId)
        do {
            matches = try await lobby.getMatches()
            phase = .loaded
        } catch {
            if case .loaded = phase {
                return
            }
            phase = .failed(ErrorText.describe(error))
            return
        }
        if let list = try? await lobby.getPlayers() { players = list }
        if let record = try? await lobby.getPlayerStats(player: me) { stats = record }
        if let records = try? await lobby.getHistory() { history = records }
    }

    /// Challenge `opponent`: a new match, its game context, and where to open it.
    public func challenge(_ opponent: String) async -> MatchRef? {
        guard let lobbyContextId else {
            notice = "The lobby is still syncing. Try again in a moment."
            return nil
        }
        challenging = opponent
        defer { challenging = nil }
        do {
            let ref = try await MatchMaker.create(
                backend: backend, namespace: namespace, lobbyContextId: lobbyContextId, opponent: opponent)
            await refresh()
            return ref
        } catch {
            notice = ErrorText.describe(error, fallback: "Couldn't create the match. Try again.")
            return nil
        }
    }

    /// A link that brings someone into this lobby (and every match context in it).
    public func invitationLink() async throws -> String {
        let signed = try await backend.app.createInvitation(namespaceId: namespace.id)
        return try LobbyInvitation(invitation: signed, lobbyName: name, inviterKey: me).link()
    }

    /// Keep the lobby fresh while it is on screen: the relay's events when it streams, and a poll
    /// either way (someone joining emits no event the lobby context sees).
    public func live() async {
        guard let lobbyContextId else { return }
        await withTaskGroup(of: Void.self) { group in
            if backend.app.canSubscribe {
                let stream = backend.app.events(contextId: lobbyContextId)
                group.addTask { [weak self] in
                    do {
                        for try await _ in stream { await self?.refresh() }
                    } catch {}
                }
            }
            group.addTask { [weak self] in
                while !Task.isCancelled {
                    await pause(Battleships.pollInterval * 2)
                    if Task.isCancelled { return }
                    await self?.refresh()
                }
            }
        }
    }

    /// The context in the namespace's root group that runs the lobby service. Match contexts sit
    /// in the same group, so "the first one" is wrong as soon as a match exists (the web app's
    /// note in `useBattleshipsLobby`). When nothing names a service, the first.
    private func resolveLobbyContext() async throws -> String? {
        let ids = try await backend.app.listContexts(groupId: namespace.id)
        guard !ids.isEmpty else { return nil }
        var anyNamed = false
        for id in ids {
            guard let service = try? await backend.serviceName(contextId: id) else { continue }
            if service == Battleships.lobbyService { return id }
            anyNamed = true
        }
        return anyNamed ? nil : ids.first
    }
}

/// Redeeming an invitation link: confirm, join the lobby's namespace, then open it.
/// (Kotlin `InvitationModel`; the web app's `InvitationPrompt` + `redeemLobby`.)
@MainActor
public final class InvitationModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case confirm(title: String)
        case joining(title: String)
        case joined(namespaceId: String, title: String)
        case failed(String)
    }

    @Published public private(set) var stage: Stage = .idle
    public private(set) var invitation: LobbyInvitation?

    public init() {}

    @discardableResult
    public func open(_ raw: String) -> Bool {
        guard let parsed = LobbyInvitation.parse(raw) else {
            invitation = nil
            stage = .failed("This isn't a Battleships invitation. Check the link and try again.")
            return false
        }
        invitation = parsed
        stage = .confirm(title: parsed.title)
        return true
    }

    /// Join (`POST /invites/{token}/redeem`). `backend` is read again after `didJoin`.
    public func accept(
        backend: @escaping @MainActor () -> (any MeroAppBackend)?,
        didJoin: @escaping @MainActor () async -> Void
    ) async {
        guard let invitation, let current = backend() else {
            stage = .failed("Sign in to join.")
            return
        }
        stage = .joining(title: invitation.title)
        do {
            _ = try await current.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
        } catch {
            let text = "\(error)".lowercased()
            if !(text.contains("already a member") || text.contains("already member") || text.contains("already joined")) {
                stage = .failed(ErrorText.describe(error, fallback: "Couldn't join this lobby. Try again."))
                return
            }
        }
        await didJoin()
        stage = .joined(namespaceId: invitation.namespaceId, title: invitation.title)
    }

    public func reset() {
        invitation = nil
        stage = .idle
    }
}
