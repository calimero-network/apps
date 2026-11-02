import Foundation
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
            let all = try await backend.listNamespaces()
            lobbies = all.sorted { Names.lobby($0).localizedCaseInsensitiveCompare(Names.lobby($1)) == .orderedAscending }
            phase = .loaded
        } catch {
            if lobbies.isEmpty { phase = .failed(ErrorText.describe(error)) }
        }
    }

    /// Found a lobby: an organization for the package, then the app instance in it (the web
    /// app's `createLobby`). Every match is played inside that one instance.
    public func create(name raw: String) async throws -> AppNamespace {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw BattleshipsError.invalid("Give the lobby a name.") }
        guard backend.hasRelay else { throw BattleshipsError.invalid("Sign in to create a lobby.") }
        let founded = try await backend.foundNamespace(name: name)
        _ = try await backend.createContext(
            groupId: founded.namespaceId, applicationId: applicationId ?? "", name: name, initArgs: .object([:]))
        let lobby = AppNamespace(
            id: founded.namespaceId, name: name, applicationId: applicationId ?? Battleships.packageName, memberCount: 1)
        if !lobbies.contains(where: { $0.id == lobby.id }) { lobbies.insert(lobby, at: 0) }
        phase = .loaded
        return lobby
    }
}

/// Creating a match, from the lobby and from a finished match's rematch: `createMatch` in the
/// lobby's instance starts it (no context per match on 1.0). (The web app's `createMatch`.)
public enum MatchMaker {
    public static func create(
        backend: any BattleshipsBackend, namespace: AppNamespace, appId: String, opponent: String
    ) async throws -> MatchRef {
        let key = opponent.trimmingCharacters(in: .whitespaces)
        guard LobbyInvitation.isKey(key) else { throw BattleshipsError.invalid("That is not a valid player.") }
        let matchId = try await BattleshipsContract(backend.contract, appId: appId).createMatch(player2: key)
        return MatchRef(namespaceId: namespace.id, appId: appId, matchId: matchId, opponent: key)
    }
}

/// One lobby: its matches, the players you can challenge, your record and its history, and
/// inviting people in. (Kotlin `LobbyModel`; the web app's `useBattleshipsLobby` + `LobbyView`.)
@MainActor
public final class LobbyModel: ObservableObject {
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var appId: String?
    @Published public private(set) var matches: [MatchSummary] = []
    @Published public private(set) var players: [PlayerEntry] = []
    @Published public private(set) var stats: PlayerStatsView?
    @Published public private(set) var history: [MatchRecord] = []
    /// Display names members set in the lobby's organization, by account.
    @Published public private(set) var names: [String: String] = [:]
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
        self.me = backend.account
        self.syncAttempts = syncAttempts
        self.syncDelay = syncDelay
    }

    public var name: String { Names.lobby(namespace) }

    /// Players who opened this lobby, other than you: who you can challenge.
    public var opponents: [PlayerEntry] {
        players.filter { $0.player.lowercased() != me.lowercased() && $0.account.lowercased() != backend.account.lowercased() }
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
        guard let appId else { return nil }
        return MatchRef(namespaceId: namespace.id, appId: appId, matchId: match.matchId, opponent: opponent(in: match))
    }

    /// "You", their name in the lobby, or a short handle.
    public func displayName(_ key: String) -> String { Names.player(key, me: me, names: names) }

    /// Find the lobby's app instance, record who you play as, read it all.
    public func load() async {
        if appId == nil {
            phase = .loading
            for attempt in 0..<syncAttempts {
                if attempt > 0 { await pause(syncDelay) }
                if Task.isCancelled { return }
                do {
                    if let found = try await backend.listContexts(groupId: namespace.id).first {
                        appId = found
                        break
                    }
                } catch {
                    if attempt == syncAttempts - 1 {
                        phase = .failed(ErrorText.describe(error))
                        return
                    }
                }
            }
            guard appId != nil else {
                phase = .failed("This lobby isn't ready yet. Pull to refresh in a moment.")
                return
            }
        }
        if !registered, let appId {
            if let key = try? await BattleshipsContract(backend.contract, appId: appId).registerPlayer(),
                LobbyInvitation.isKey(key)
            {
                me = key
                registered = true
            }
        }
        await refresh()
    }

    /// Re-read the lobby's matches, players, your record and the history.
    public func refresh() async {
        guard let appId else { return }
        let lobby = BattleshipsContract(backend.contract, appId: appId)
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
        if let members = try? await backend.listMembers(groupId: namespace.id) {
            names = Dictionary(members.compactMap { m in m.name.map { (m.identity, $0) } }, uniquingKeysWith: { a, _ in a })
        }
    }

    /// Challenge `opponent`: a new match, and where to open it.
    public func challenge(_ opponent: String) async -> MatchRef? {
        guard let appId else {
            notice = "The lobby is still syncing. Try again in a moment."
            return nil
        }
        challenging = opponent
        defer { challenging = nil }
        do {
            let ref = try await MatchMaker.create(
                backend: backend, namespace: namespace, appId: appId, opponent: opponent)
            await refresh()
            return ref
        } catch {
            notice = ErrorText.describe(error, fallback: "Couldn't create the match. Try again.")
            return nil
        }
    }

    /// A link that brings someone into this lobby's organization (a passkey step-up).
    public func invitationLink() async throws -> String {
        let signed = try await backend.createInvitation(namespaceId: namespace.id)
        return try LobbyInvitation(invitation: signed, lobbyName: name, inviterKey: me).link()
    }

    /// Keep the lobby fresh while it is on screen: the instance's event stream, and a poll either
    /// way (someone joining the organization emits no event in the instance).
    public func live() async {
        guard let appId else { return }
        await withTaskGroup(of: Void.self) { group in
            if backend.canSubscribe {
                let stream = backend.events(contextId: appId)
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
