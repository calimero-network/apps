import Foundation

/// Login against a node's embedded auth (`POST /auth/token`, user_password).
/// On success the tokens + node URL are written into the supplied `TokenStore`.
public final class AuthApi {
    private let store: TokenStore
    private let session: URLSession

    public init(store: TokenStore, session: URLSession = .shared) {
        self.store = store
        self.session = session
    }

    private struct TokenRequest: Encodable {
        let auth_method = "user_password"
        let public_key: String      // node uses the username as the public_key field
        let client_name = "MeroTag-iOS"
        let timestamp = 0
        let permissions: [String] = []
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
        return (access, decoded.data?.refresh_token)
    }

    private func trim(_ s: String) -> String {
        var t = s; while t.hasSuffix("/") { t.removeLast() }; return t
    }
}
