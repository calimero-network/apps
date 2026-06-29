// Mero Meet — ephemeral TURN credential minting service.
//
// Dependency-free Node HTTP server. It mints short-lived TURN credentials using
// coturn's "use-auth-secret" mechanism (TURN REST API, draft-uberti-behave-turn-rest):
//
//   username   = <unix-expiry-timestamp>
//   credential = base64( HMAC-SHA1( static-auth-secret, username ) )
//
// The desktop app fetches `GET /ice` (bearer-authenticated) at call time and feeds
// the returned `iceServers` straight into RTCPeerConnection. Because credentials
// expire (default 1h), nothing long-lived ships in the app binary — a leaked
// response is worthless within the hour, and the API key gates minting.
import http from "node:http";
import crypto from "node:crypto";

const SECRET = required("TURN_SECRET"); // must equal coturn's static-auth-secret
const API_KEY = required("ICE_API_KEY"); // bearer token the desktop app must send
const DOMAIN = required("TURN_DOMAIN"); // public hostname clients dial, e.g. turn.example.com
const TTL = int(process.env.CRED_TTL_SECONDS, 3600);
const PORT = int(process.env.PORT, 8080);
const ENABLE_TURNS = process.env.ENABLE_TURNS === "true"; // advertise turns:5349 (needs TLS cert in coturn)

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[ice-cred] missing required env ${name}`);
    process.exit(1);
  }
  return v;
}
function int(v, dflt) {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : dflt;
}

function mint() {
  const expiry = Math.floor(Date.now() / 1000) + TTL;
  const username = String(expiry);
  const credential = crypto.createHmac("sha1", SECRET).update(username).digest("base64");
  return { username, credential };
}

function iceServers() {
  const { username, credential } = mint();
  const servers = [
    { urls: `stun:${DOMAIN}:3478` },
    { urls: `turn:${DOMAIN}:3478?transport=udp`, username, credential },
    { urls: `turn:${DOMAIN}:3478?transport=tcp`, username, credential },
  ];
  if (ENABLE_TURNS) {
    servers.push({ urls: `turns:${DOMAIN}:5349?transport=tcp`, username, credential });
  }
  return servers;
}

// Crude in-memory rate limit: max 30 mints/min per client IP. Bounds abuse if the
// API key ever leaks; restart clears it (fine — credentials are short-lived anyway).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const server = http.createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  if (req.method === "GET" && path === "/healthz") {
    res.writeHead(200);
    return res.end("ok");
  }
  if (req.method !== "GET" || path !== "/ice") {
    res.writeHead(404);
    return res.end();
  }
  const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.socket.remoteAddress || "?";
  if (rateLimited(ip)) {
    res.writeHead(429);
    return res.end("rate limited");
  }
  const auth = (req.headers["authorization"] || "").toString();
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEq(token, API_KEY)) {
    res.writeHead(401);
    return res.end("unauthorized");
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ iceServers: iceServers() }));
});

server.listen(PORT, () =>
  console.log(`[ice-cred] listening on :${PORT} domain=${DOMAIN} ttl=${TTL}s turns=${ENABLE_TURNS}`)
);
