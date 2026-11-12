package network.calimero.issues.core

import com.calimero.mero.app.ContextContract
import network.calimero.issues.generated.IssueTrackerClient

/** The tracker contract in one repo (app instance), through the account's cluster session. */
fun issueTrackerClient(
    contract: ContextContract,
    contextId: String,
): IssueTrackerClient = IssueTrackerClient(contract.bound(contextId))
