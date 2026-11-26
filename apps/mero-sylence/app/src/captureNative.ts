import { captureNativeApproval, captureNativeSignIn } from "@calimero-apps/passkey/native";
import { captureSignInIntent } from "./native";

// Imported first by main.tsx, so it runs before `session.ts` picks its storage:
// the extension's sign-in (`#native-sign-in&state=…&key=…`) or passkey approval
// (`#native-approve&…`) is kept for this tab and taken out of the address.
captureSignInIntent();
captureNativeSignIn();
captureNativeApproval();
