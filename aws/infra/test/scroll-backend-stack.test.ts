import { describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ScrollBackendStack } from "../lib/scroll-backend-stack.js";

let cachedTemplate: Template | undefined;

const template = () => {
  if (cachedTemplate) return cachedTemplate;
  const app = new App();
  const stack = new ScrollBackendStack(app, "TestStack", {
    env: { account: "111111111111", region: "us-west-2" },
    chainId: 1,
    scrollContractAddress: "0x0000000000000000000000000000000000000002",
    robinTokenAddress: "0x0000000000000000000000000000000000000003",
    upkeepAddress: "0x0000000000000000000000000000000000000004",
    matchReceiptPublicKey: "test-public-key",
    metadataBaseUrl: "https://scroll.example.test/v1",
    trustedGameOrigins: ["https://game.example.test"],
    rpcUrl: "https://rpc.example.test",
  });
  cachedTemplate = Template.fromStack(stack);
  return cachedTemplate;
};

describe("ScrollBackendStack", () => {
  it("rejects wildcard browser origins", () => {
    const app = new App();
    expect(() => new ScrollBackendStack(app, "UnsafeCorsStack", {
      env: { account: "111111111111", region: "us-west-2" },
      chainId: 1,
      scrollContractAddress: "0x0000000000000000000000000000000000000002",
      robinTokenAddress: "0x0000000000000000000000000000000000000003",
      upkeepAddress: "0x0000000000000000000000000000000000000004",
      matchReceiptPublicKey: "test-public-key",
      metadataBaseUrl: "https://scroll.example.test/v1",
      trustedGameOrigins: ["*"],
      rpcUrl: "https://rpc.example.test",
    })).toThrow(/must not use/);
  });

  it("retains encrypted canonical stores and enables recovery controls", () => {
    const output = template();
    output.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      DeletionProtectionEnabled: true,
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    });
    output.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
      ObjectLockEnabled: true,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    output.resourceCountIs("AWS::KMS::Key", 1);
  });

  it("creates FIFO batching, standard reconciliation, DLQs and a max-age sweep", () => {
    const output = template();
    output.hasResourceProperties("AWS::SQS::Queue", { FifoQueue: true, RedrivePolicy: Match.anyValue() });
    output.hasResourceProperties("AWS::SQS::Queue", { RedrivePolicy: Match.anyValue(), VisibilityTimeout: 120 });
    output.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "rate(1 minute)", State: "ENABLED" });
    output.resourceCountIs("AWS::Lambda::EventSourceMapping", 2);
  });

  it("protects the API with WAF and exposes all adapter routes", () => {
    const output = template();
    output.resourceCountIs("AWS::WAFv2::WebACL", 1);
    output.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1);
    output.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "OPTIONS",
      Integration: Match.objectLike({ Type: "MOCK" }),
    });
    output.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([Match.objectLike({ Name: "PerIpRateLimit" })]),
    });
  });

  it("does not grant relayer-secret reads to public API Lambdas", () => {
    const output = template();
    output.resourceCountIs("AWS::SecretsManager::Secret", 1);
    const policies = output.findResources("AWS::IAM::Policy");
    const secretReadPolicies = Object.values(policies).filter((resource) =>
      JSON.stringify(resource).includes("secretsmanager:GetSecretValue"),
    );
    expect(secretReadPolicies).toHaveLength(2);
  });
});
