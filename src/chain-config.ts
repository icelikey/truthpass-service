/**
 * BOT Chain network configuration used by the read-only/transaction-building
 * adapter.  The adapter deliberately does not contain a private key or a
 * deployed contract address.  A teammate can provide the address after the
 * TruthPass contract has been deployed and verified.
 */

export type BotChainNetwork = "bohr-testnet" | "bot-mainnet";
export type BotChainNetworkAlias = BotChainNetwork | "testnet" | "mainnet";

export interface BotChainConfig {
  readonly network: BotChainNetwork;
  readonly chainId: number;
  readonly chainIdHex: string;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  /** Deployed TruthPass contract. Undefined until deployment is confirmed. */
  readonly contractAddress?: string;
}

const CONFIGS: Record<BotChainNetwork, BotChainConfig> = {
  "bohr-testnet": {
    network: "bohr-testnet",
    chainId: 968,
    chainIdHex: "0x3c8",
    rpcUrl: "https://rpc.bohr.life",
    explorerUrl: "https://scan.bohr.life",
  },
  "bot-mainnet": {
    network: "bot-mainnet",
    chainId: 677,
    chainIdHex: "0x2a5",
    rpcUrl: "https://rpc.botchain.ai",
    explorerUrl: "https://scan.botchain.ai",
  },
};

const ALIASES: Record<BotChainNetworkAlias, BotChainNetwork> = {
  "bohr-testnet": "bohr-testnet",
  testnet: "bohr-testnet",
  "bot-mainnet": "bot-mainnet",
  mainnet: "bot-mainnet",
};

export const BOT_CHAIN_CONFIGS: Readonly<Record<BotChainNetwork, BotChainConfig>> = CONFIGS;

export function normalizeBotChainNetwork(network: BotChainNetworkAlias): BotChainNetwork {
  return ALIASES[network];
}

export interface BotChainConfigOverrides {
  rpcUrl?: string;
  explorerUrl?: string;
  contractAddress?: string;
}

/**
 * Return a copy so callers cannot mutate the process-wide network constants.
 * Mainnet is explicit: callers must request it rather than silently falling
 * back from an unavailable testnet endpoint.
 */
export function getBotChainConfig(
  network: BotChainNetworkAlias = "testnet",
  overrides: BotChainConfigOverrides = {},
): BotChainConfig {
  const base = CONFIGS[normalizeBotChainNetwork(network)];
  return Object.freeze({
    ...base,
    ...(overrides.rpcUrl === undefined ? {} : { rpcUrl: overrides.rpcUrl }),
    ...(overrides.explorerUrl === undefined ? {} : { explorerUrl: overrides.explorerUrl }),
    ...(overrides.contractAddress === undefined ? {} : { contractAddress: overrides.contractAddress }),
  });
}

export function chainIdToHex(chainId: number): string {
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new Error(`Invalid EVM chain ID: ${chainId}`);
  }
  return `0x${chainId.toString(16)}`;
}

export function parseChainId(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Invalid eth_chainId response: ${String(value)}`);
  }
  const chainId = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(chainId)) {
    throw new Error(`Unsupported EVM chain ID: ${value}`);
  }
  return chainId;
}
