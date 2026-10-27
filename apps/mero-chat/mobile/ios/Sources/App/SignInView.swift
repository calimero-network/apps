import MeroKitUI
import SwiftUI

/// The landing page at phone width: a nav bar with the Mero Chat mark, the
/// hero, a glimpse of a channel, what the app does, and the connect button
/// pinned at the bottom. On the phone "connect" is signing in with the
/// Calimero account; the wallet certifies a key this device keeps.
struct SignInView: View {
    @ObservedObject var session: SessionModel
    @ObservedObject var client: MeroClient

    var body: some View {
        ZStack {
            GroundBackground()
            VStack(spacing: 0) {
                navBar
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        hero
                        preview.padding(.top, 28)
                        features.padding(.top, 28)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 24)
                    .padding(.bottom, 24)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { footer }
    }

    private var navBar: some View {
        HStack(spacing: 10) {
            AppMark(size: 30)
            Text("Mero Chat")
                .font(Theme.font(18, .bold))
                .tracking(-0.3)
                .foregroundStyle(Theme.ink)
                .accessibilityIdentifier("signInTitle")
            Spacer()
            Button {
                Task { await session.signIn() }
            } label: {
                Text("Sign in")
                    .font(Theme.font(15, .semibold))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(Capsule().fill(Color(light: 0xE3E9FF, dark: 0x1C2650)))
            }
            .buttonStyle(.plain)
            .disabled(client.isLoading)
            .accessibilityIdentifier("signInHeaderButton")
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
        .background(Theme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "lock.fill").font(.system(size: 10, weight: .semibold))
                Text("Powered by Calimero").font(Theme.font(12, .semibold))
            }
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(Capsule().fill(Color(light: 0xE3E9FF, dark: 0x1C2650)))

            (Text("Team chat on ").foregroundColor(Theme.ink)
                + Text("your own nodes.").foregroundColor(Theme.accent))
                .font(Theme.font(34, .heavy))
                .tracking(-0.8)
                .lineSpacing(2)
                .padding(.top, 14)
                .fixedSize(horizontal: false, vertical: true)
            Text("Channels, threads and direct messages, with no central server holding your conversations.")
                .font(Theme.font(16))
                .lineSpacing(5)
                .foregroundStyle(Theme.ink2)
                .padding(.top, 12)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// A glimpse of a channel, drawn with the app's own styles.
    private var preview: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "number").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted)
                Text("launch-planning").font(Theme.font(14, .semibold)).foregroundStyle(Theme.ink)
                Spacer()
                HStack(spacing: -6) {
                    previewAvatar("AM", 0x3E63F5)
                    previewAvatar("TB", 0xD6336C)
                    previewAvatar("LK", 0x12B886)
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }

            VStack(alignment: .leading, spacing: 12) {
                previewMessage("Ada Mensah", "AM", 0x3E63F5, "Release notes are final. Shipping Thursday?")
                previewMessage("Theo Brandt", "TB", 0xD6336C, "RC1 is building now. I'll share the link here.")
            }
            .padding(14)
        }
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Theme.chatCard)
                .shadow(color: Color(hex: 0x141A3C, alpha: 0.10), radius: 18, y: 10)
        )
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private func previewAvatar(_ initials: String, _ color: UInt32) -> some View {
        Text(initials)
            .font(Theme.font(9, .bold))
            .foregroundStyle(.white)
            .frame(width: 22, height: 22)
            .background(Circle().fill(Color(hex: color)))
            .overlay(Circle().stroke(Theme.chatCard, lineWidth: 2))
    }

    private func previewMessage(_ name: String, _ initials: String, _ color: UInt32, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(initials)
                .font(Theme.font(11, .bold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Circle().fill(Color(hex: color)))
            VStack(alignment: .leading, spacing: 3) {
                Text(name).font(Theme.font(13, .semibold)).foregroundStyle(Theme.ink)
                Text(text).font(Theme.font(14)).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var features: some View {
        VStack(alignment: .leading, spacing: 16) {
            feature("bubble.left.and.bubble.right.fill", "Channels, threads and DMs",
                    "Everything your team expects from a chat app.")
            feature("externaldrive.fill.badge.checkmark", "Messages stay on your nodes",
                    "No central server ever holds your conversations.")
            feature("laptopcomputer.and.iphone", "iOS, web and desktop",
                    "Pick up the same workspace on any device.")
        }
    }

    private func feature(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color(light: 0xE3E9FF, dark: 0x1C2650)))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Theme.font(15, .semibold)).foregroundStyle(Theme.ink)
                Text(detail).font(Theme.font(13)).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var footer: some View {
        VStack(spacing: 10) {
            if let error = client.errorMessage {
                Banner(kind: .error, text: error)
                    .accessibilityIdentifier("signInError")
            }
            Button {
                Task { await session.signIn() }
            } label: {
                HStack(spacing: 8) {
                    if client.isLoading { ProgressView().tint(Theme.onInk) }
                    Text("Continue with Calimero")
                }
                .frame(minHeight: 50)
            }
            .buttonStyle(InkButtonStyle(fullWidth: true))
            .disabled(client.isLoading)
            .accessibilityIdentifier("signInButton")
            HStack(spacing: 6) {
                Image(systemName: "person.badge.key.fill").font(.system(size: 11))
                Text("Approve this device with your passkey in the Calimero wallet.")
            }
            .font(Theme.font(12))
            .foregroundStyle(Theme.muted)
            .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Theme.surfaceSolid.opacity(0.92).ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }
}
