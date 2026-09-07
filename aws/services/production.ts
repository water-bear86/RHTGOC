import { loadConfig } from "./config.js";
import { DynamoPersistence, DynamoRelayerSpendLimiter, S3SnapshotStore, SqsCheckpointQueue, SqsReconciliationQueue } from "./adapters/aws-persistence.js";
import { ScrollStateCoreAdapter } from "./state-core-adapter.js";
import { AuthoritativeRulesEngine, DynamoEvidenceSource } from "./rules.js";
import { EthersRobinhoodChainClient } from "./chain.js";
import { MintPaymentVerifier } from "./payment.js";
import { ScrollService } from "./scroll-service.js";
import { systemClock } from "./ports.js";
import { WalletAuthService } from "./auth.js";
import { CheckpointReconciler, CheckpointRelayer, CheckpointSweep } from "./relayer.js";

export interface ProductionServices {
  scroll: ScrollService;
  auth: WalletAuthService;
  relayer: CheckpointRelayer;
  reconciler: CheckpointReconciler;
  sweep: CheckpointSweep;
}

let singleton: ProductionServices | undefined;

export function productionServices(): ProductionServices {
  singleton ??= createProductionServices();
  return singleton;
}

function createProductionServices(): ProductionServices {
  const config = loadConfig();
  const persistence = new DynamoPersistence(config.tableName);
  const snapshots = new S3SnapshotStore(config.snapshotBucket);
  const checkpoints = new SqsCheckpointQueue(config.checkpointQueueUrl);
  const reconciliation = new SqsReconciliationQueue(config.reconciliationQueueUrl);
  const core = new ScrollStateCoreAdapter();
  const chain = new EthersRobinhoodChainClient(config, new DynamoRelayerSpendLimiter(config.tableName));
  const rules = new AuthoritativeRulesEngine(new DynamoEvidenceSource(config.tableName), config.matchReceiptPublicKey);
  const payment = new MintPaymentVerifier({
    scrollContractAddress: config.scrollContractAddress,
    robinTokenAddress: config.robinTokenAddress,
    upkeepAddress: config.upkeepAddress,
    deadAddress: config.deadAddress,
  });
  return {
    scroll: new ScrollService(persistence, snapshots, checkpoints, core, rules, chain, payment, systemClock, config),
    auth: new WalletAuthService(persistence, systemClock, {
      chainId: config.chainId,
      verifyingContract: config.scrollContractAddress,
      domainName: config.authDomainName,
      domainVersion: config.authDomainVersion,
      challengeTtlSeconds: config.challengeTtlSeconds,
      sessionTtlSeconds: config.sessionTtlSeconds,
    }),
    relayer: new CheckpointRelayer(persistence, chain, reconciliation, systemClock),
    reconciler: new CheckpointReconciler(persistence, chain, reconciliation, systemClock, config),
    sweep: new CheckpointSweep(persistence, checkpoints, systemClock, config.maxUncheckpointedSeconds),
  };
}
