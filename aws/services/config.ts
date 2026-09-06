import { getAddress } from "ethers";

export interface ServiceConfig {
  tableName: string;
  snapshotBucket: string;
  checkpointQueueUrl: string;
  reconciliationQueueUrl: string;
  relayerSecretArn: string;
  rpcUrl: string;
  chainId: number;
  scrollContractAddress: string;
  robinTokenAddress: string;
  robinTokenDecimals: number;
  upkeepAddress: string;
  deadAddress: string;
  checkpointAfterSeconds: number;
  maxUncheckpointedSeconds: number;
  checkpointOnMajorAchievement: boolean;
  checkpointOnMatchResult: boolean;
  authDomainName: string;
  authDomainVersion: string;
  challengeTtlSeconds: number;
  sessionTtlSeconds: number;
  confirmationsRequired: number;
  maxRelayerGasWei: bigint;
  maxDailyRelayerSpendWei: bigint;
  maxReplacementAttempts: number;
  replacementAfterSeconds: number;
  matchReceiptPublicKey: string;
  metadataBaseUrl: string;
}

const required = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

const integer = (name: string, value: string | undefined, fallback: number): number => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
};

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value.toLowerCase() === "true";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const deadAddress = getAddress(env.DEAD_ADDRESS ?? "0x000000000000000000000000000000000000dEaD");
  if (deadAddress.toLowerCase() !== "0x000000000000000000000000000000000000dead") {
    throw new Error("DEAD_ADDRESS must be the verified 0x...dEaD address");
  }
  return {
    tableName: required("STATE_TABLE_NAME", env),
    snapshotBucket: required("SNAPSHOT_BUCKET_NAME", env),
    checkpointQueueUrl: required("CHECKPOINT_QUEUE_URL", env),
    reconciliationQueueUrl: required("RECONCILIATION_QUEUE_URL", env),
    relayerSecretArn: required("RELAYER_SECRET_ARN", env),
    rpcUrl: required("ROBINHOOD_RPC_URL", env),
    chainId: integer("CHAIN_ID", required("CHAIN_ID", env), 0),
    scrollContractAddress: getAddress(required("SCROLL_CONTRACT_ADDRESS", env)),
    robinTokenAddress: getAddress(required("ROBIN_TOKEN_ADDRESS", env)),
    robinTokenDecimals: integer("ROBIN_TOKEN_DECIMALS", env.ROBIN_TOKEN_DECIMALS, 18),
    upkeepAddress: getAddress(required("UPKEEP_ADDRESS", env)),
    deadAddress,
    checkpointAfterSeconds: integer("CHECKPOINT_AFTER_SECONDS", env.CHECKPOINT_AFTER_SECONDS, 300),
    maxUncheckpointedSeconds: integer("MAX_UNCHECKPOINTED_SECONDS", env.MAX_UNCHECKPOINTED_SECONDS, 3600),
    checkpointOnMajorAchievement: bool(env.CHECKPOINT_ON_MAJOR_ACHIEVEMENT, true),
    checkpointOnMatchResult: bool(env.CHECKPOINT_ON_MATCH_RESULT, true),
    authDomainName: env.AUTH_DOMAIN_NAME ?? "Sherwood, the game (on robinhood chain)",
    authDomainVersion: env.AUTH_DOMAIN_VERSION ?? "1",
    challengeTtlSeconds: integer("AUTH_CHALLENGE_TTL_SECONDS", env.AUTH_CHALLENGE_TTL_SECONDS, 300),
    sessionTtlSeconds: integer("AUTH_SESSION_TTL_SECONDS", env.AUTH_SESSION_TTL_SECONDS, 3600),
    confirmationsRequired: integer("CONFIRMATIONS_REQUIRED", env.CONFIRMATIONS_REQUIRED, 12),
    maxRelayerGasWei: BigInt(env.MAX_RELAYER_GAS_WEI ?? "5000000000000000"),
    maxDailyRelayerSpendWei: BigInt(env.MAX_DAILY_RELAYER_SPEND_WEI ?? "100000000000000000"),
    maxReplacementAttempts: integer("MAX_REPLACEMENT_ATTEMPTS", env.MAX_REPLACEMENT_ATTEMPTS, 3),
    replacementAfterSeconds: integer("REPLACEMENT_AFTER_SECONDS", env.REPLACEMENT_AFTER_SECONDS, 180),
    matchReceiptPublicKey: required("MATCH_RECEIPT_PUBLIC_KEY", env),
    metadataBaseUrl: required("METADATA_BASE_URL", env).replace(/\/$/, ""),
  };
}
