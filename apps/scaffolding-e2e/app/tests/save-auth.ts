import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import globalSetup from "./global-setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stateFile = path.join(__dirname, ".auth/state.json");
if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

await globalSetup({} as never);
console.log("Auth setup complete. You can now run: pnpm test");
