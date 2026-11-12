package network.calimero.docs.core

import network.calimero.docs.generated.DocsClient

// The shapes of the contract's answers the phone reads: the read and comment half of the web's
// adapter (`app/src/lib/docsApi.ts`), over the component ABI in `../logic/res/abi.json`. The calls
// are [DocsClient], generated from the ABI (`scripts/mobile-codegen.sh` at the repo root), and so
// are the shapes the ABI describes. (Swift `DocsShapes.swift`.)
//
// - Method and argument names are camelCase (`listDocs { includeArchived }`), results' fields too.
// - 64-bit integers arrive as decimal strings, timestamps in milliseconds. Like the web adapter,
//   the screens show them in nanoseconds ([DocsFormat.nanos]).
// - A read is a view (`query`), a write a call (`execute`).

// The shapes the ABI describes are the generated client's ([DocsClient]). Their timestamps are the
// wire's milliseconds; the screens, written for nanoseconds like the web adapter's, convert where
// they show one ([DocsFormat.nanos]).

/** A document's header (`DocView`). Timestamps in milliseconds. */
typealias DocDto = DocsClient.DocView

/** A comment (`CommentView`). `createdAt` in milliseconds. */
typealias CommentDto = DocsClient.CommentView

/** One document `searchDocs` found; `snippet` has the matched words in `<b>`. */
typealias DocSearchHit = DocsClient.DocSearchHit

/** A page of `searchDocs`. */
typealias DocSearchPage = DocsClient.DocSearchPage

/** What the app keeps of the contract beside the generated [DocsClient]. */
object DocsContract {
    /** Every method the app calls: the ABI test checks each against `abi.json`. */
    val METHODS = listOf("listDocs", "getDoc", "searchDocs", "getDocument", "listComments", "addComment")
}
