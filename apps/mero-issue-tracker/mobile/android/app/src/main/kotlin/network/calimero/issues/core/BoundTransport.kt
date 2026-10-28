package network.calimero.issues.core

import com.calimero.mero.app.ContextContract
import network.calimero.issues.generated.ContextContractCalling
import network.calimero.issues.generated.IssueTrackerClient
import com.calimero.mero.app.ContextContractCalling as SdkContextContractCalling

/**
 * The generated client declares its own `ContextContractCalling` (the same two methods as the
 * SDK's), so the SDK's bound contract is adapted here.
 */
class BoundTransport(
    private val bound: SdkContextContractCalling,
) : ContextContractCalling {
    override suspend fun query(
        method: String,
        argsJson: String,
    ): String = bound.query(method, argsJson)

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String = bound.execute(method, argsJson)
}

/** The tracker contract in one repo (context), through the account's relay. */
fun issueTrackerClient(
    contract: ContextContract,
    contextId: String,
): IssueTrackerClient = IssueTrackerClient(BoundTransport(contract.bound(contextId)))
