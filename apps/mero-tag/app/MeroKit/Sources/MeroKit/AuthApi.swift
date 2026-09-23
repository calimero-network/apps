import Foundation

/// Login against a node's embedded auth (`POST /auth/token`, user_password).
/// On success the tokens + node URL are written into the supplied `TokenStore`.
public final class AuthApi {
    private let store: TokenStore
    private let session: URLSession
    private let authority: SessionAuthority?

    public init(store: TokenStore, session: URLSession = .shared, authority: SessionAuthority? = nil) {
        self.store = store
        self.session = session
        self.authority = authority
    }

    /// The grants this app asks its session to carry.
    ///
    /// This is a hand-rolled grant set — the same shape as the list every app
    /// that owns its own login keeps next to its token request, and the same one
    /// that had to be corrected by hand across the web apps when mero-react #73
    /// added `context:subscribe`. A fix in an SDK does not reach a list like
    /// this one, so it is spelled out and tested here.
    ///
    /// `context:subscribe` is the load-bearing entry. Core's `PermissionValidator`
    /// maps `/sse`, `/sse/subscription`, `/sse/session/{id}` AND `/ws` to
    /// `Context(Subscribe(Global))`. A token minted without it is refused `403`
    /// + `X-Auth-Error: permission_denied` on every one of them, while login,
    /// listing and `execute` all keep working — so the app looks healthy and
    /// simply never receives an event.
    ///
    /// ⚠️ MEASURED on core 0.11.0-rc.41: this app does not hit that refusal
    /// *today*, and the reason is worth writing down rather than trusting. With
    /// `auth_method: "user_password"`, `token_handler` mints from
    /// `auth_response.permissions` — the ROOT KEY's grants — and ignores this
    /// field entirely; `provision_admin_key` gives the node's admin `["admin"]`,
    /// which `Permission::satisfies` treats as satisfying everything. The field
    /// becomes load-bearing the moment this app logs in as anything but the node
    /// owner (a client key, the hosted `/auth/login` flow, a delegated device),
    /// and an empty list is precisely the token that gets a stream refused. It
    /// was empty.
    public static let permissions = [
        "context:execute",
        "context:list",
        "context:subscribe",
        "application:list",
        "namespace",
        "group",
        "blob",
        "context:alias",
    ]

    /// `POST /auth/token`.
    ///
    /// ⚠️ Core's `BaseTokenRequest` is `#[serde(deny_unknown_fields)]` — one of
    /// the 37 request bodies closed at rc.38 — so this must be the exact key
    /// set, never a superset. A stray field is a 400, not a warning.
    private struct TokenRequest: Encodable {
        let auth_method = "user_password"
        let public_key: String      // node uses the username as the public_key field
        let client_name = "MeroTag-iOS"
        let timestamp = 0
        let permissions: [String] = AuthApi.permissions
        let provider_data: ProviderData
        struct ProviderData: Encodable { let username: String; let password: String }
    }

    private struct TokenResponse: Decodable {
        struct Payload: Decodable { let access_token: String?; let refresh_token: String? }
        let data: Payload?
    }

    @discardableResult
    public func login(nodeUrl: String, username: String, password: String) async throws -> (access: String, refresh: String?) {
        let base = trim(nodeUrl)
        guard let url = URL(string: "\(base)/auth/token") else { throw MeroError.notConfigured }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = TokenRequest(public_key: username, provider_data: .init(username: username, password: password))
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw MeroError.transport(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw MeroError.http(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        guard let access = decoded.data?.access_token else {
            throw MeroError.rpc(message: "Login failed — no access token returned")
        }
        store.nodeUrl = base
        store.accessToken = access
        store.refreshToken = decoded.data?.refresh_token
        // A previous session may have been latched dead. This one is new.
        await authority?.reset()
        return (access, decoded.data?.refresh_token)
    }

    private func trim(_ s: String) -> String {
        var t = s; while t.hasSuffix("/") { t.removeLast() }; return t
    }
}
