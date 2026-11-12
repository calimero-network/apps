// The audience's types. The calls and the answer types are the generated [UpdatesClient]
// (`scripts/mobile-codegen.sh` at the repo root), which speaks the component ABI.

package network.calimero.updates.generated

import network.calimero.updates.generated.client.UpdatesClient

// The contract's answer and argument types are the generated client's ([UpdatesClient], from the
// ABI): camelCase fields, u64s [ULong] (decimal strings on the wire).

typealias AskInput = UpdatesClient.AskInput

typealias AskView = UpdatesClient.AskView

typealias CategoryView = UpdatesClient.CategoryView

typealias CommentView = UpdatesClient.CommentView

typealias ContributionView = UpdatesClient.ContributionView

typealias DraftView = UpdatesClient.DraftView

typealias EngagementRow = UpdatesClient.EngagementRow

typealias MeView = UpdatesClient.MeView

typealias Metric = UpdatesClient.Metric

typealias MetricPoint = UpdatesClient.MetricPoint

typealias MetricSeries = UpdatesClient.MetricSeries

typealias OfferView = UpdatesClient.OfferView

typealias Overview = UpdatesClient.Overview

typealias PersonView = UpdatesClient.PersonView

typealias PostCard = UpdatesClient.PostCard

typealias PostPage = UpdatesClient.PostPage

typealias PostView = UpdatesClient.PostView

typealias ReactionCount = UpdatesClient.ReactionCount

typealias ReaderView = UpdatesClient.ReaderView

typealias Section = UpdatesClient.Section

typealias Settings = UpdatesClient.Settings

typealias UpdateInput = UpdatesClient.UpdateInput
