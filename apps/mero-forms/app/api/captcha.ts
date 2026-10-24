/**
 * GET/POST /api/captcha: the captcha verifier for public links. The logic and
 * its configuration are in `src/lib/captchaVerifier.ts`.
 */
import { handleCaptcha, type VerifierEnv } from "../src/lib/captchaVerifier";

const env = () => process.env as VerifierEnv;

export const GET = (request: Request) => handleCaptcha(request, env());
export const POST = (request: Request) => handleCaptcha(request, env());
