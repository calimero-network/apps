import Foundation
import MeroKit

// The audience's types. The calls and the answer types are the generated `UpdatesClient`
// (`Generated/`, `scripts/mobile-codegen.sh` at the repo root), which speaks the component ABI.

// MARK: - The answers

// The contract's answer and argument types are the generated client's (`Generated/`, from the ABI):
// camelCase fields, u64s `UInt64` (decimal strings on the wire).

public typealias AskInput = UpdatesClient.AskInput
public typealias AskView = UpdatesClient.AskView
public typealias CategoryView = UpdatesClient.CategoryView
public typealias CommentView = UpdatesClient.CommentView
public typealias ContributionView = UpdatesClient.ContributionView
public typealias DraftView = UpdatesClient.DraftView
public typealias EngagementRow = UpdatesClient.EngagementRow
public typealias MeView = UpdatesClient.MeView
public typealias Metric = UpdatesClient.Metric
public typealias MetricPoint = UpdatesClient.MetricPoint
public typealias MetricSeries = UpdatesClient.MetricSeries
public typealias OfferView = UpdatesClient.OfferView
public typealias Overview = UpdatesClient.Overview
public typealias PersonView = UpdatesClient.PersonView
public typealias PostCard = UpdatesClient.PostCard
public typealias PostPage = UpdatesClient.PostPage
public typealias PostView = UpdatesClient.PostView
public typealias ReactionCount = UpdatesClient.ReactionCount
public typealias ReaderView = UpdatesClient.ReaderView
public typealias Section = UpdatesClient.Section
public typealias Settings = UpdatesClient.Settings
public typealias UpdateInput = UpdatesClient.UpdateInput
