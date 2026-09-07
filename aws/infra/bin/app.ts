#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ScrollBackendStack } from "../lib/scroll-backend-stack.js";

const app = new cdk.App();

new ScrollBackendStack(app, "SherwoodScrollBackend", {
  env: {
    ...(process.env.CDK_DEFAULT_ACCOUNT ? { account: process.env.CDK_DEFAULT_ACCOUNT } : {}),
    region: process.env.CDK_DEFAULT_REGION ?? "us-west-2",
  },
  chainId: Number(app.node.tryGetContext("chainId") ?? 1),
  scrollContractAddress: app.node.tryGetContext("scrollContractAddress") ?? "0x0000000000000000000000000000000000000002",
  robinTokenAddress: app.node.tryGetContext("robinTokenAddress") ?? "0x0000000000000000000000000000000000000003",
  upkeepAddress: app.node.tryGetContext("upkeepAddress") ?? "0x0000000000000000000000000000000000000004",
  matchReceiptPublicKey: app.node.tryGetContext("matchReceiptPublicKey") ?? "CONFIGURE_BEFORE_DEPLOYMENT",
  metadataBaseUrl: app.node.tryGetContext("metadataBaseUrl") ?? "https://scroll-api.configure-before-deployment.invalid/v1",
  trustedGameOrigins: app.node.tryGetContext("trustedGameOrigins") ?? ["https://game.configure-before-deployment.invalid"],
  rpcUrl: app.node.tryGetContext("rpcUrl") ?? "https://configure-robinhood-chain-rpc.invalid",
});
