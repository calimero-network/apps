package network.calimero.sheets.core

import com.calimero.mero.app.ContextContract
import network.calimero.sheets.generated.client.SheetsClient

/**
 * The sheets contract in one spreadsheet (context), through the account's node session. The generated
 * client takes the SDK's `ContextContractCalling`, so the bound contract goes straight in.
 */
fun sheetsClient(
    contract: ContextContract,
    contextId: String,
): SheetsClient = SheetsClient(contract.bound(contextId))
