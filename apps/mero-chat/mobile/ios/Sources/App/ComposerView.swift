import SwiftUI
import UIKit

/// `MessageInput.tsx` on a phone: a white card (radius 20) with the format
/// toolbar (B I U | • 1. </>), the text, and the emoji and send buttons; the
/// "Draft" badge when a saved draft was restored; the `@` mention list above it.
///
/// The toolbar marks the selection (`**bold**`, `*italic*`, `__underline__`,
/// `` `code` ``, `- ` and `1. ` lines); sending turns those marks into the
/// HTML the web editor writes (``ChatComposerText``).
struct ComposerView: View {
    @ObservedObject var model: ChannelModel
    var editing: ChatMessage?
    var onEdited: () -> Void = {}

    @State private var text = ""
    @State private var focused = false
    @State private var picking = false
    @State private var restored = false
    @StateObject private var editor = ComposerEditor()

    var body: some View {
        VStack(spacing: 0) {
            if let query = mentionQuery {
                mentionList(query)
            }
            if picking {
                EmojiPickerView(title: nil) { emoji in
                    editor.insert(emoji)
                } onClose: {
                    picking = false
                }
                .padding(.bottom, 8)
            }
            card
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
        }
        .onAppear {
            if let editing {
                text = model.composerText(for: editing)
            } else if text.isEmpty, !model.savedDraft.isEmpty {
                text = model.savedDraft
                restored = true
            }
        }
        .onChange(of: model.savedDraft) { draft in
            if editing == nil, text.isEmpty, !draft.isEmpty {
                text = draft
                restored = true
            }
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            toolbar
            ZStack(alignment: .topLeading) {
                ComposerTextView(text: $text, focused: $focused, editor: editor)
                    .frame(minHeight: 64, maxHeight: 132)
                    .padding(.horizontal, 8)
                    .padding(.top, 4)
                    .padding(.trailing, 92)
                    .onChange(of: text) { value in
                        if editing == nil { model.draftChanged(value) }
                        if value.isEmpty { restored = false }
                    }
                    .accessibilityIdentifier("composerField")
                if text.isEmpty {
                    Text(editing == nil ? ChatFormat.composerPlaceholder(channel: model.channel, inThread: model.thread != nil) : "Edit message")
                        .font(Theme.font(14))
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 13)
                        .padding(.top, 12)
                        .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .bottomTrailing) { actions.padding(.trailing, 14).padding(.bottom, 10) }
        }
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Theme.chatCard)
                .shadow(color: Color(hex: 0x141A3C, alpha: 0.12), radius: 15, y: 12)
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(focused ? Theme.lineStrong : Theme.line, lineWidth: 1))
                .background(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(focused ? Theme.tint.opacity(0.28) : .clear, lineWidth: 4)
                        .padding(-2))
        )
    }

    private var toolbar: some View {
        HStack(spacing: 4) {
            format("B", font: Theme.font(14, .bold), label: "Bold") { editor.wrap("**") }
            format("I", font: Theme.font(14).italic(), label: "Italic") { editor.wrap("*") }
            format("U", font: Theme.font(14), underline: true, label: "Underline") { editor.wrap("__") }
            Rectangle().fill(Theme.lineStrong).frame(width: 1, height: 20).padding(.horizontal, 4)
            format("•", font: Theme.font(16, .bold), label: "List") { editor.prefixLines { _ in "- " } }
            format("1.", font: Theme.font(13, .medium), label: "Ordered List") { editor.prefixLines { "\($0 + 1). " } }
            format("</>", font: .system(size: 12, weight: .medium, design: .monospaced), label: "Code") { editor.wrap("`") }
            Spacer()
        }
        .padding(.horizontal, 10)
        .frame(height: 41)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func format(
        _ glyph: String, font: Font, underline: Bool = false, label: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(glyph).font(font).underline(underline)
                .foregroundStyle(Theme.ink2)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var actions: some View {
        HStack(spacing: 10) {
            if restored, editing == nil {
                Text("Draft")
                    .font(Theme.font(10.6))
                    .foregroundStyle(Theme.ink(30))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Theme.ink(6)))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.ink(10), lineWidth: 1))
            }
            Button {
                picking.toggle()
            } label: {
                Image(systemName: picking ? "face.smiling.inverse" : "face.smiling")
                    .font(.system(size: 18))
                    .foregroundStyle(picking ? Theme.accent : Theme.muted)
                    .frame(width: 26, height: 26)
            }
            .accessibilityLabel("Emoji")
            Button(action: send) {
                if model.isSending {
                    ProgressView().tint(Theme.accent).frame(width: 26, height: 26)
                } else {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(isEmpty ? Theme.muted : Theme.accent)
                        .frame(width: 26, height: 26)
                }
            }
            .disabled(isEmpty || model.isSending)
            .accessibilityLabel(editing == nil ? "Send" : "Save")
            .accessibilityIdentifier("sendButton")
        }
    }

    private var isEmpty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        let body = text
        if let editing {
            Task {
                await model.edit(editing, to: body)
                onEdited()
            }
            return
        }
        Task {
            if await model.send(body) {
                text = ""
                restored = false
                picking = false
            }
        }
    }

    // MARK: Mentions

    /// The `@word` being typed at the end of the text, if any.
    private var mentionQuery: String? {
        guard focused, let last = text.split(separator: " ", omittingEmptySubsequences: false).last,
            last.hasPrefix("@"), !last.contains("\n")
        else { return nil }
        return String(last.dropFirst())
    }

    private func mentionList(_ query: String) -> some View {
        let members = model.mentionCandidates.map(\.name)
        let options = (["everyone", "here"] + members).filter {
            query.isEmpty || $0.localizedCaseInsensitiveContains(query)
        }
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(options.prefix(8), id: \.self) { name in
                Button {
                    complete(with: name)
                } label: {
                    Text("@\(name)").font(Theme.font(13)).foregroundStyle(Theme.ink)
                        .padding(.horizontal, 12)
                        .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.surfaceSolid))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line, lineWidth: 1))
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
        .opacity(options.isEmpty ? 0 : 1)
    }

    private func complete(with name: String) {
        guard let at = text.range(of: "@", options: .backwards) else { return }
        text.replaceSubrange(at.lowerBound..<text.endIndex, with: "@\(name) ")
    }
}

// MARK: - Text view

/// Commands the toolbar sends to the text view.
@MainActor
final class ComposerEditor: ObservableObject {
    weak var textView: UITextView?

    /// Surround the selection with `mark` (or insert an empty pair at the caret).
    func wrap(_ mark: String) {
        guard let view = textView, let range = Range(view.selectedRange, in: view.text) else { return }
        let selected = String(view.text[range])
        view.textStorage.replaceCharacters(in: view.selectedRange, with: mark + selected + mark)
        let start = view.selectedRange.location + mark.utf16.count
        view.selectedRange = NSRange(location: start, length: selected.utf16.count)
        view.delegate?.textViewDidChange?(view)
    }

    /// Put a prefix before each selected line (or the caret's line).
    func prefixLines(_ prefix: (Int) -> String) {
        guard let view = textView else { return }
        let ns = view.text as NSString
        let lines = ns.lineRange(for: view.selectedRange)
        let block = ns.substring(with: lines)
        let hasNewline = block.hasSuffix("\n")
        let parts = (hasNewline ? String(block.dropLast()) : block).components(separatedBy: "\n")
        let prefixed = parts.enumerated().map { prefix($0.offset) + $0.element }.joined(separator: "\n")
            + (hasNewline ? "\n" : "")
        view.textStorage.replaceCharacters(in: lines, with: prefixed)
        view.selectedRange = NSRange(location: lines.location + (prefixed as NSString).length - (hasNewline ? 1 : 0), length: 0)
        view.delegate?.textViewDidChange?(view)
    }

    func insert(_ string: String) {
        guard let view = textView else { return }
        view.insertText(string)
    }
}

/// A growing `UITextView` in Figtree 14, bound to the composer's text.
struct ComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool
    let editor: ComposerEditor

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = UIFont(name: "Figtree", size: 14) ?? .systemFont(ofSize: 14)
        view.textColor = UIColor(Theme.ink)
        view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        view.isScrollEnabled = true
        view.autocorrectionType = .default
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        editor.textView = view
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
        editor.textView = view
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate {
        private let parent: ComposerTextView

        init(_ parent: ComposerTextView) { self.parent = parent }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
        }

        func textViewDidBeginEditing(_ textView: UITextView) { parent.focused = true }
        func textViewDidEndEditing(_ textView: UITextView) { parent.focused = false }
    }
}

// MARK: - Emoji picker

/// `EmojiSelector.tsx`: eight category tabs over a 7-column grid.
struct EmojiPickerView: View {
    let title: String?
    let onPick: (String) -> Void
    let onClose: () -> Void
    @State private var category = 0

    var body: some View {
        VStack(spacing: 6) {
            if title != nil {
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.ink)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(Theme.surfaceSolid))
                }
                .accessibilityLabel("Close")
            }
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    ForEach(Array(EmojiCatalog.categories.enumerated()), id: \.offset) { i, item in
                        Button {
                            category = i
                        } label: {
                            Image(systemName: item.icon)
                                .font(.system(size: 14))
                                .foregroundStyle(category == i ? Theme.accent : Theme.muted)
                                .frame(width: 32, height: 32)
                                .overlay(alignment: .bottom) {
                                    if category == i { Rectangle().fill(Theme.accent).frame(height: 1) }
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.name)
                    }
                }
                .padding(.horizontal, 12)
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(EmojiCatalog.categories[category].name)
                            .font(Theme.font(12, .semibold)).foregroundStyle(Theme.muted)
                            .padding(.leading, 12).padding(.top, 6)
                        LazyVGrid(columns: Array(repeating: GridItem(.fixed(30), spacing: 2), count: 7), spacing: 2) {
                            ForEach(EmojiCatalog.categories[category].emojis, id: \.self) { emoji in
                                Button {
                                    onPick(emoji)
                                } label: {
                                    Text(emoji).font(.system(size: 22)).frame(width: 30, height: 30)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 12)
                    }
                }
            }
            .frame(width: 7 * 32 + 24, height: title == nil ? 260 : 362)
            .background(RoundedRectangle(cornerRadius: 6).fill(Theme.surfaceSolid))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.lineStrong, lineWidth: 1))
            .shadow(color: Color(hex: 0x141A3C, alpha: 0.2), radius: 16, y: 8)
        }
        .frame(maxWidth: .infinity, alignment: title == nil ? .trailing : .center)
        .padding(.trailing, title == nil ? 24 : 0)
    }
}

/// The picker's categories, in the web app's order.
enum EmojiCatalog {
    struct Category {
        let name: String
        let icon: String
        let emojis: [String]
    }

    static let categories: [Category] = [
        Category(name: "People", icon: "face.smiling", emojis: split(
            "😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥸🤩🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🫡🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿👹👺🤡💩👻💀👽🤖🎃😺😸😹😻😼😽🙀😿😾👋🤚🖐✋🖖👌🤌🤏✌🤞🫰🤟🤘🤙👈👉👆👇☝👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏💪🫶❤️🧡💛💚💙💜🖤🤍🤎💔💯")),
        Category(name: "Nature", icon: "tree", emojis: split(
            "🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🪲🐢🐍🦎🐙🦑🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🐘🦛🦏🐪🦒🦘🐃🐄🐎🐖🐏🐑🦙🐐🦌🐕🐈🐓🦃🦚🦜🦢🕊🐇🦝🦨🦡🦦🦥🐁🐀🐿🦔🌵🎄🌲🌳🌴🌱🌿☘🍀🎍🎋🍃🍂🍁🍄🌾💐🌷🌹🥀🌺🌸🌼🌻🌞🌝🌛🌜🌚🌕🌙🌎⭐🌟✨⚡🔥🌈☀️⛅☁️🌧⛈🌩❄️☃️⛄🌬💨💧💦🌊")),
        Category(name: "Food and Drinks", icon: "fork.knife", emojis: split(
            "🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶🫑🌽🥕🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🧈🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🥙🧆🌮🌯🥗🥘🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🍥🥠🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼☕🍵🧃🥤🧋🍶🍺🍻🥂🍷🥃🍸🍹🧉🍾🧊")),
        Category(name: "Activity", icon: "gamecontroller", emojis: split(
            "⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🥅⛳🪁🏹🎣🤿🥊🥋🎽🛹🛼🛷⛸🥌🎿⛷🏂🏋🤸⛹🤺🤾🏌🏇🧘🏄🏊🤽🚣🧗🚵🚴🏆🥇🥈🥉🏅🎖🏵🎗🎫🎟🎪🤹🎭🩰🎨🎬🎤🎧🎼🎹🥁🎷🎺🎸🪕🎻🎲♟🎯🎳🎮🎰🧩")),
        Category(name: "Travel Places", icon: "globe.americas", emojis: split(
            "🚗🚕🚙🚌🚎🏎🚓🚑🚒🚐🛻🚚🚛🚜🦯🦽🦼🛴🚲🛵🏍🛺🚨🚔🚍🚘🚖🚡🚠🚟🚃🚋🚞🚝🚄🚅🚈🚂🚆🚇🚊🚉✈️🛫🛬🛩💺🛰🚀🛸🚁🛶⛵🚤🛥🛳⛴🚢⚓⛽🚧🚦🚥🚏🗺🗿🗽🗼🏰🏯🏟🎡🎢🎠⛲⛱🏖🏝🏜🌋⛰🏔🗻🏕⛺🏠🏡🏘🏚🏗🏭🏢🏬🏣🏤🏥🏦🏨🏪🏫🏩💒🏛⛪🕌🕍🛕🕋⛩🛤🛣🗾🎑🏞🌅🌄🌠🎇🎆🌇🌆🏙🌃🌌🌉🌁")),
        Category(name: "Objects", icon: "lamp.desk", emojis: split(
            "⌚📱📲💻⌨️🖥🖨🖱🖲🕹🗜💽💾💿📀📼📷📸📹🎥📽🎞📞☎️📟📠📺📻🎙🎚🎛🧭⏱⏲⏰🕰⌛⏳📡🔋🔌💡🔦🕯🪔🧯🛢💸💵💴💶💷🪙💰💳💎⚖️🪜🧰🪛🔧🔨⚒🛠⛏🔩⚙️🧱⛓🧲🔫💣🧨🪓🔪🗡⚔️🛡🚬⚰️🪦⚱️🏺🔮📿🧿💈⚗️🔭🔬🕳🩹🩺💊💉🩸🧬🦠🧫🧪🌡🧹🧺🧻🚽🚰🚿🛁🧼🪥🪒🧽🪣🧴🛎🔑🗝🚪🪑🛋🛏🧸🪆🖼🪞🪟🛍🛒🎁🎈🎏🎀🪄🪅🎊🎉🎎🏮🎐🧧✉️📩📨📧💌📥📤📦🏷🪧📪📫📬📭📮📯📜📃📄📑🧾📊📈📉🗒🗓📆📅🗑📇🗃🗳🗄📋📁📂🗂🗞📰📓📔📒📕📗📘📙📚📖🔖🧷🔗📎🖇📐📏🧮📌📍✂️🖊🖋✒️🖌🖍📝✏️🔍🔎🔏🔐🔒🔓")),
        Category(name: "Symbols", icon: "shield", emojis: split(
            "❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟☮️✝️☪️🕉☸️✡️🔯🕎☯️☦️🛐⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛️🉑☢️☣️📴📳🈶🈚🈸🈺🈷️✴️🆚💮🉐㊙️㊗️🈴🈵🈹🈲🅰️🅱️🆎🆑🅾️🆘❌⭕🛑⛔📛🚫💯💢♨️🚷🚯🚳🚱🔞📵🚭❗❕❓❔‼️⁉️🔅🔆〽️⚠️🚸🔱⚜️🔰♻️✅🈯💹❇️✳️❎🌐💠Ⓜ️🌀💤🏧🚾♿🅿️🈳🈂️🛂🛃🛄🛅🚹🚺🚼⚧🚻🚮🎦📶🈁🔣ℹ️🔤🔡🔠🆖🆗🆙🆒🆕🆓0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟🔢#️⃣*️⃣⏏️▶️⏸⏯⏹⏺⏭⏮⏩⏪⏫⏬◀️🔼🔽➡️⬅️⬆️⬇️↗️↘️↙️↖️↕️↔️↪️↩️⤴️⤵️🔀🔁🔂🔄🔃🎵🎶➕➖➗✖️♾💲💱™️©️®️〰️➰➿🔚🔙🔛🔝🔜✔️☑️🔘🔴🟠🟡🟢🔵🟣⚫⚪🟤🔺🔻🔸🔹🔶🔷🔳🔲▪️▫️◾◽◼️◻️🟥🟧🟨🟩🟦🟪⬛⬜🟫🔈🔇🔉🔊🔔🔕📣📢💬💭🗯♠️♣️♥️♦️🃏🎴🀄")),
        Category(name: "Flags", icon: "flag.fill", emojis: split(
            "🏳️🏴🏁🚩🏳️‍🌈🏳️‍⚧️🏴‍☠️🇺🇳🇪🇺🇺🇸🇬🇧🇨🇦🇦🇺🇳🇿🇮🇪🇫🇷🇩🇪🇮🇹🇪🇸🇵🇹🇳🇱🇧🇪🇨🇭🇦🇹🇸🇪🇳🇴🇩🇰🇫🇮🇮🇸🇵🇱🇨🇿🇸🇰🇭🇺🇷🇴🇧🇬🇬🇷🇹🇷🇺🇦🇭🇷🇸🇮🇧🇦🇷🇸🇲🇪🇲🇰🇦🇱🇱🇹🇱🇻🇪🇪🇯🇵🇰🇷🇨🇳🇹🇼🇭🇰🇸🇬🇮🇳🇮🇩🇹🇭🇻🇳🇵🇭🇲🇾🇦🇪🇸🇦🇮🇱🇪🇬🇿🇦🇳🇬🇰🇪🇲🇦🇧🇷🇦🇷🇨🇱🇨🇴🇵🇪🇲🇽🇺🇾")),
    ]

    /// One string of emoji into its grapheme clusters.
    private static func split(_ string: String) -> [String] {
        string.map(String.init).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }
}
