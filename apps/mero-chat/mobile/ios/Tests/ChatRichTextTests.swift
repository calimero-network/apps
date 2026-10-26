import XCTest

/// Message bodies are the web editor's HTML: read it, and write it back the same way.
final class ChatRichTextTests: XCTestCase {
    func testReadsTheWebEditorsParagraphsAndInlineStyles() {
        let rich = RichText.parse(html: "<p>Hello <strong>bold</strong> and <em>it</em> <u>u</u> <code>x</code></p><p>two</p>")
        XCTAssertEqual(rich.blocks.count, 2)
        guard case .paragraph(let runs) = rich.blocks[0] else { return XCTFail("a paragraph") }
        XCTAssertEqual(runs.map(\.text), ["Hello ", "bold", " and ", "it", " ", "u", " ", "x"])
        XCTAssertEqual(runs[1].style, .bold)
        XCTAssertEqual(runs[3].style, .italic)
        XCTAssertEqual(runs[5].style, .underline)
        XCTAssertEqual(runs[7].style, .code)
        XCTAssertEqual(rich.plainText, "Hello bold and it u x\ntwo")
    }

    func testReadsMentionsLinksListsCodeAndEntities() {
        let html = """
            <p>hi <span class="mention mention-user-bob">@bob</span> <span class='mention-everyone'>@everyone</span> \
            <a href="https://x.test/a?b=1&amp;c=2">link</a> &lt;3 &amp; &#39;q&#39;</p>\
            <ul><li><p>one</p></li><li><p>two</p></li></ul><ol><li><p>first</p></li></ol>\
            <pre><code>let a = 1
            let b = 2</code></pre><blockquote><p>quoted</p></blockquote>
            """
        let rich = RichText.parse(html: html)
        guard case .paragraph(let runs) = rich.blocks[0] else { return XCTFail("a paragraph") }
        XCTAssertEqual(runs.first { $0.text == "@bob" }?.mention, .user)
        XCTAssertEqual(runs.first { $0.text == "@everyone" }?.mention, .broadcast)
        XCTAssertEqual(runs.first { $0.text == "link" }?.link, "https://x.test/a?b=1&c=2")
        XCTAssertTrue(rich.plainText.contains("<3 & 'q'"))
        XCTAssertEqual(rich.blocks[1], .list(ordered: false, items: [[.init(text: "one")], [.init(text: "two")]]))
        XCTAssertEqual(rich.blocks[2], .list(ordered: true, items: [[.init(text: "first")]]))
        XCTAssertEqual(rich.blocks[3], .code("let a = 1\nlet b = 2"))
        XCTAssertEqual(rich.blocks[4], .quote([.init(text: "quoted")]))
    }

    func testPlainTextFromAnOlderClientStaysPlain() {
        XCTAssertEqual(RichText.parse(html: "just text\nsecond").plainText, "just text\nsecond")
        XCTAssertTrue(RichText.parse(html: "<p><br></p>").isEmpty)
    }

    func testBrokenHTMLNeverLosesTheText() {
        XCTAssertEqual(RichText.parse(html: "<p>open <strong>never closed").plainText, "open never closed")
        XCTAssertEqual(RichText.parse(html: "</em>stray<p>").plainText, "stray")
    }

    func testTheComposerWritesTheEditorsHTMLWithMentionsLikeMarkdownParser() {
        let html = ChatComposerText.html(
            from: "Hi **there** @bob & @everyone\n- a\n- b\n1. x\n```\n<tag>\n```", members: ["bob"])
        XCTAssertEqual(
            html,
            "<p>Hi <strong>there</strong> <span class=\"mention mention-user-bob\">@bob</span> &amp; "
                + "<span class='mention-everyone'>@everyone</span></p>"
                + "<ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li><p>x</p></li></ol>"
                + "<pre><code>&lt;tag&gt;</code></pre>")
    }

    func testWhatTheComposerWritesReadsBackAndEditsRoundTrip() {
        let typed = "say *this* and __that__ with `code`\n- item"
        let rich = RichText.parse(html: ChatComposerText.html(from: typed))
        XCTAssertEqual(rich.plainText, "say this and that with code\n• item")
        XCTAssertEqual(ChatComposerText.text(from: rich), typed)
    }

    func testAnUnclosedMarkIsKeptAsTyped() {
        XCTAssertEqual(ChatComposerText.html(from: "2 * 3 = 6"), "<p>2 * 3 = 6</p>")
    }
}
