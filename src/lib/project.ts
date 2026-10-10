/**
 * Project identity, in one place.
 *
 * Why this file exists: the token's IPFS metadata is immutable and carries the demo URL,
 * but nothing on the demo pointed back at the source repository. The reward rule asks for
 * "a working demo or MVP with evidence that it belongs to the submitting creator", so the
 * chain has to be closed somewhere a reviewer can walk it:
 *
 *   token metadata (on-chain) -> demo URL -> repository -> same owner
 *
 * Every link here is public and verifiable.
 */
export const REPO_URL = "https://github.com/Chaitu945/vibe-launch-lab";
export const DEMO_URL = "https://vibe-launch-lab.vercel.app/";
export const TOKEN_ADDRESS = "0x1277e53FDA036CD5C922F0409D97BCf6Cf193960";
export const TOKEN_EXPLORER_URL = `https://explorer.testnet.chain.robinhood.com/address/${TOKEN_ADDRESS}`;
