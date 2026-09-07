import { AbiCoder, Contract, Interface, JsonRpcProvider, Wallet, getAddress, keccak256 } from "ethers";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { ChainClient, ChainReceipt, RelayerSpendLimiter } from "./ports.js";
import type { ServiceConfig } from "./config.js";
import type { TransactionRecord } from "./domain.js";
import { ServiceError, unavailable } from "./errors.js";

const scrollAbi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function scrollOf(address player) view returns (uint256)",
  "function hasScroll(address player) view returns (bool)",
  "function latestCheckpoint(uint256 tokenId) view returns (uint256 version,bytes32 stateRoot,uint256 timestamp)",
  "function verifyCheckpoint(uint256 tokenId,uint256 version,bytes32 stateRoot) view returns (bool)",
  "function checkpointNonces(uint256 tokenId) view returns (uint256)",
  "function treasury() view returns (address)",
  "function mintPrice() view returns (uint256)",
  "function submitCheckpoint((uint256 tokenId,uint256 version,bytes32 stateRoot,uint256 timestamp,bytes32[] achievementIds,bytes32[] fineryIds,uint256 nonce,uint256 deadline,bytes signature) input)",
  "event ScrollMinted(uint256 indexed tokenId,address indexed owner,uint256 robinPaid)",
  "event ScrollPaymentSplit(uint256 indexed tokenId,address indexed buyer,uint256 totalPaid,uint256 upkeepAmount,uint256 burnedAmount)",
] as const;
const erc20Abi = ["function allowance(address owner,address spender) view returns (uint256)"] as const;
const authTypes: Record<string, Array<{ name: string; type: string }>> = {
  CheckpointAuthorization: [
    { name: "tokenId", type: "uint256" },
    { name: "owner", type: "address" },
    { name: "version", type: "uint256" },
    { name: "stateRoot", type: "bytes32" },
    { name: "timestamp", type: "uint256" },
    { name: "achievementsHash", type: "bytes32" },
    { name: "fineriesHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

interface RelayerSecret {
  relayerPrivateKey: string;
  checkpointSignerPrivateKey: string;
}

export function relayerFeeEnvelope(gasEstimate: bigint, maxFeePerGas: bigint, replacement: boolean) {
  const gasLimit = (gasEstimate * 120n) / 100n;
  const submissionMaxFeePerGas = replacement ? (maxFeePerGas * 115n) / 100n : maxFeePerGas;
  return { gasLimit, submissionMaxFeePerGas, maximumCostWei: gasLimit * submissionMaxFeePerGas };
}

export class EthersRobinhoodChainClient implements ChainClient {
  private readonly provider: JsonRpcProvider;
  private readonly readScroll: Contract;
  private readonly robin: Contract;
  private credentials?: Promise<{ relayer: Wallet; checkpointSigner: Wallet }>;
  private chainValidation: Promise<void> | undefined;

  constructor(
    private readonly config: ServiceConfig,
    private readonly spendLimiter: RelayerSpendLimiter,
    private readonly secrets = new SecretsManagerClient({}),
  ) {
    this.provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
    this.readScroll = new Contract(config.scrollContractAddress, scrollAbi, this.provider);
    this.robin = new Contract(config.robinTokenAddress, erc20Abi, this.provider);
  }

  async getScrollTokenId(wallet: string): Promise<string | null> {
    try {
      await this.assertChainId();
      if (!(await this.readScroll.getFunction("hasScroll")(wallet))) return null;
      return String(await this.readScroll.getFunction("scrollOf")(wallet));
    } catch (error) {
      throw this.rpcError(error);
    }
  }

  async getCheckpoint(tokenId: string) {
    try {
      await this.assertChainId();
      const result = await this.readScroll.getFunction("latestCheckpoint")(tokenId);
      return { version: Number(result.version), stateRoot: String(result.stateRoot).toLowerCase() as `0x${string}`, timestamp: Number(result.timestamp) };
    } catch (error) {
      throw this.rpcError(error);
    }
  }

  async verifyCheckpoint(tokenId: string, version: number, root: `0x${string}`): Promise<boolean> {
    try {
      await this.assertChainId();
      return Boolean(await this.readScroll.getFunction("verifyCheckpoint")(tokenId, version, root));
    } catch (error) {
      throw this.rpcError(error);
    }
  }

  async getAllowance(wallet: string): Promise<bigint> {
    try {
      await this.assertChainId();
      return BigInt(await this.robin.getFunction("allowance")(wallet, this.config.scrollContractAddress));
    } catch (error) {
      throw this.rpcError(error);
    }
  }

  async getMintPrice(): Promise<bigint> {
    try {
      await this.assertChainId();
      return BigInt(await this.readScroll.getFunction("mintPrice")());
    } catch (error) {
      throw this.rpcError(error);
    }
  }

  async getTreasury(): Promise<string> {
    try {
      await this.assertChainId();
      return getAddress(await this.readScroll.getFunction("treasury")()).toLowerCase();
    } catch (error) {
      throw this.rpcError(error);
    }
  }

  async submitCheckpoint(tokenId: string, version: number, root: `0x${string}`) {
    const credentials = await this.loadCredentials();
    const input = await this.createInput(credentials.checkpointSigner, tokenId, version, root);
    return this.send(credentials.relayer, input);
  }

  async replaceCheckpoint(transaction: TransactionRecord) {
    const credentials = await this.loadCredentials();
    const input = await this.createInput(credentials.checkpointSigner, transaction.tokenId, transaction.version, transaction.stateRoot);
    return this.send(credentials.relayer, input, transaction.chainNonce);
  }

  async getReceipt(hash: `0x${string}`): Promise<ChainReceipt> {
    try {
      await this.assertChainId();
      const receipt = await this.provider.getTransactionReceipt(hash);
      if (!receipt) {
        const transaction = await this.provider.getTransaction(hash);
        return { hash, status: transaction ? "pending" : "not_found", confirmations: 0 };
      }
      const currentBlock = await this.provider.getBlockNumber();
      return {
        hash,
        status: receipt.status === 1 ? "success" : "reverted",
        confirmations: Math.max(0, currentBlock - receipt.blockNumber + 1),
        blockNumber: receipt.blockNumber,
        logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
      };
    } catch (error) {
      throw this.rpcError(error);
    }
  }

  private async createInput(signer: Wallet, tokenId: string, version: number, stateRoot: `0x${string}`) {
    await this.assertChainId();
    const tokenNonce = BigInt(await this.readScroll.getFunction("checkpointNonces")(tokenId));
    const owner = getAddress(await this.readScroll.getFunction("ownerOf")(tokenId));
    const latestBlock = await this.provider.getBlock("latest");
    if (!latestBlock) throw unavailable("block_unavailable", "RPC did not return the latest block");
    // Bind the authorization to the chain clock. A Lambda wall clock can be a
    // few seconds ahead of the sequencer, and the contract rejects future timestamps.
    const timestamp = latestBlock.timestamp;
    const deadline = timestamp + 300;
    const ids: string[] = [];
    const emptyIdsHash = keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32[]"], [ids]));
    const message = {
      tokenId: BigInt(tokenId),
      owner,
      version,
      stateRoot,
      timestamp,
      achievementsHash: emptyIdsHash,
      fineriesHash: emptyIdsHash,
      nonce: tokenNonce,
      deadline,
    };
    const signature = await signer.signTypedData(
      { name: "RobinHoodScroll", version: "1", chainId: this.config.chainId, verifyingContract: this.config.scrollContractAddress },
      authTypes,
      message,
    );
    return { tokenId, version, stateRoot, timestamp, achievementIds: ids, fineryIds: ids, nonce: tokenNonce, deadline, signature };
  }

  private async send(relayer: Wallet, input: Awaited<ReturnType<EthersRobinhoodChainClient["createInput"]>>, nonce?: number) {
    const contract = new Contract(this.config.scrollContractAddress, scrollAbi, relayer);
    const method = contract.getFunction("submitCheckpoint");
    const gas = BigInt(await method.estimateGas(input));
    const fees = await this.provider.getFeeData();
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
    if (!maxFeePerGas) throw unavailable("fee_data_unavailable", "RPC did not return fee data");
    const { gasLimit, submissionMaxFeePerGas, maximumCostWei: estimatedCostWei } =
      relayerFeeEnvelope(gas, maxFeePerGas, nonce !== undefined);
    // Reserve the transaction's maximum exposure, including both the gas-limit safety
    // margin and replacement fee bump, rather than the lower estimate returned by RPC.
    if (estimatedCostWei > this.config.maxRelayerGasWei) {
      throw unavailable("relayer_transaction_limit", "Estimated checkpoint gas exceeds the per-transaction relayer limit");
    }
    await this.spendLimiter.reserve(new Date().toISOString().slice(0, 10), estimatedCostWei, this.config.maxDailyRelayerSpendWei);
    const transaction = await method(input, {
      gasLimit,
      maxFeePerGas: submissionMaxFeePerGas,
      ...(fees.maxPriorityFeePerGas ? { maxPriorityFeePerGas: fees.maxPriorityFeePerGas } : {}),
      ...(nonce === undefined ? {} : { nonce }),
    });
    return { hash: transaction.hash.toLowerCase() as `0x${string}`, estimatedCostWei, chainNonce: transaction.nonce };
  }

  private async loadCredentials() {
    this.credentials ??= (async () => {
      const response = await this.secrets.send(new GetSecretValueCommand({ SecretId: this.config.relayerSecretArn }));
      if (!response.SecretString) throw new Error("Relayer secret has no SecretString");
      const parsed = JSON.parse(response.SecretString) as Partial<RelayerSecret>;
      if (!parsed.relayerPrivateKey || !parsed.checkpointSignerPrivateKey) throw new Error("Relayer secret fields are missing");
      const credentials = {
        relayer: new Wallet(parsed.relayerPrivateKey, this.provider),
        checkpointSigner: new Wallet(parsed.checkpointSignerPrivateKey),
      };
      if (credentials.relayer.address === credentials.checkpointSigner.address) {
        throw new Error("Checkpoint signer and relayer must use different keys");
      }
      return credentials;
    })();
    return this.credentials;
  }

  private async assertChainId(): Promise<void> {
    this.chainValidation ??= (async () => {
      const rawChainId = await this.provider.send("eth_chainId", []);
      if (BigInt(rawChainId) !== BigInt(this.config.chainId)) {
        throw unavailable("rpc_wrong_chain", "RPC chain ID does not match configured Robinhood Chain");
      }
    })();
    try {
      await this.chainValidation;
    } catch (error) {
      this.chainValidation = undefined;
      throw error;
    }
  }

  private rpcError(error: unknown) {
    if (error instanceof ServiceError) return error;
    const reason = error instanceof Error ? error.name : "unknown";
    return unavailable("rpc_unavailable", `Robinhood Chain RPC unavailable (${reason})`);
  }
}
