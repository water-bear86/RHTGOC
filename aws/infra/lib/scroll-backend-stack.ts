import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  type StackProps,
  aws_apigateway as apigateway,
  aws_cloudwatch as cloudwatch,
  aws_dynamodb as dynamodb,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_kms as kms,
  aws_lambda as lambda,
  aws_lambda_event_sources as eventSources,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
  aws_sqs as sqs,
  aws_wafv2 as wafv2,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const serviceEntry = (name: string) => path.join(directory, "../../services/handlers", `${name}.ts`);

export interface ScrollBackendStackProps extends StackProps {
  chainId: number;
  scrollContractAddress: string;
  robinTokenAddress: string;
  upkeepAddress: string;
  matchReceiptPublicKey: string;
  metadataBaseUrl: string;
  trustedGameOrigins: string[];
  rpcUrl: string;
}

export class ScrollBackendStack extends Stack {
  constructor(scope: Construct, id: string, props: ScrollBackendStackProps) {
    super(scope, id, props);

    if (props.trustedGameOrigins.length === 0 || props.trustedGameOrigins.includes("*")) {
      throw new Error("trustedGameOrigins must contain explicit browser origins and must not use '*'");
    }

    const dataKey = new kms.Key(this, "DataKey", {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
      pendingWindow: Duration.days(30),
      description: "Encrypts Sherwood Soulbound Scroll snapshots and relayer credentials",
    });

    const relayerSecret = new secretsmanager.Secret(this, "RelayerSecret", {
      encryptionKey: dataKey,
      description: "JSON containing relayerPrivateKey and checkpointSignerPrivateKey; populate before enabling workers",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const snapshotBucket = new s3.Bucket(this, "SnapshotBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      enforceSSL: true,
      versioned: true,
      objectLockEnabled: true,
      objectLockDefaultRetention: s3.ObjectLockRetention.governance(Duration.days(365)),
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      lifecycleRules: [{ transitions: [{ storageClass: s3.StorageClass.GLACIER, transitionAfter: Duration.days(90) }] }],
    });

    const stateTable = new dynamodb.Table(this, "StateTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: "expiresAt",
    });
    stateTable.addGlobalSecondaryIndex({
      indexName: "CheckpointDueIndex",
      partitionKey: { name: "checkpointBucket", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "checkpointDueAt", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const checkpointDlq = new sqs.Queue(this, "CheckpointDLQ", {
      fifo: true,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      enforceSSL: true,
    });
    const checkpointQueue = new sqs.Queue(this, "CheckpointQueue", {
      fifo: true,
      contentBasedDeduplication: false,
      visibilityTimeout: Duration.minutes(3),
      retentionPeriod: Duration.days(4),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      enforceSSL: true,
      deadLetterQueue: { queue: checkpointDlq, maxReceiveCount: 5 },
    });

    const reconciliationDlq = new sqs.Queue(this, "ReconciliationDLQ", {
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      enforceSSL: true,
    });
    const reconciliationQueue = new sqs.Queue(this, "ReconciliationQueue", {
      visibilityTimeout: Duration.minutes(2),
      retentionPeriod: Duration.days(4),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      enforceSSL: true,
      deadLetterQueue: { queue: reconciliationDlq, maxReceiveCount: 8 },
    });

    const accessLogs = new logs.LogGroup(this, "ApiAccessLogs", {
      retention: logs.RetentionDays.ONE_YEAR,
      encryptionKey: dataKey,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const api = new apigateway.RestApi(this, "StateApi", {
      restApiName: "sherwood-scroll-state-api",
      description: "Soulbound Scroll persistence API for Sherwood, the game (on robinhood chain)",
      deployOptions: {
        stageName: "v1",
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogs),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: false,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: false,
        }),
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        metricsEnabled: true,
        throttlingBurstLimit: 200,
        throttlingRateLimit: 100,
        tracingEnabled: true,
      },
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      cloudWatchRole: true,
      minCompressionSize: Size.kibibytes(1),
      defaultCorsPreflightOptions: {
        allowOrigins: props.trustedGameOrigins,
        allowCredentials: true,
        allowHeaders: ["Authorization", "Content-Type"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        maxAge: Duration.hours(1),
      },
    });

    const environment: Record<string, string> = {
      STATE_TABLE_NAME: stateTable.tableName,
      SNAPSHOT_BUCKET_NAME: snapshotBucket.bucketName,
      CHECKPOINT_QUEUE_URL: checkpointQueue.queueUrl,
      RECONCILIATION_QUEUE_URL: reconciliationQueue.queueUrl,
      RELAYER_SECRET_ARN: relayerSecret.secretArn,
      ROBINHOOD_RPC_URL: props.rpcUrl,
      CHAIN_ID: String(props.chainId),
      SCROLL_CONTRACT_ADDRESS: props.scrollContractAddress,
      ROBIN_TOKEN_ADDRESS: props.robinTokenAddress,
      UPKEEP_ADDRESS: props.upkeepAddress,
      DEAD_ADDRESS: "0x000000000000000000000000000000000000dEaD",
      ROBIN_TOKEN_DECIMALS: "18",
      CHECKPOINT_AFTER_SECONDS: "300",
      MAX_UNCHECKPOINTED_SECONDS: "3600",
      CHECKPOINT_ON_MAJOR_ACHIEVEMENT: "true",
      CHECKPOINT_ON_MATCH_RESULT: "true",
      AUTH_DOMAIN_NAME: "Sherwood, the game (on robinhood chain)",
      AUTH_DOMAIN_VERSION: "1",
      AUTH_CHALLENGE_TTL_SECONDS: "300",
      AUTH_SESSION_TTL_SECONDS: "3600",
      CONFIRMATIONS_REQUIRED: "12",
      MAX_RELAYER_GAS_WEI: "5000000000000000",
      MAX_DAILY_RELAYER_SPEND_WEI: "100000000000000000",
      MAX_REPLACEMENT_ATTEMPTS: "3",
      REPLACEMENT_AFTER_SECONDS: "180",
      MATCH_RECEIPT_PUBLIC_KEY: props.matchReceiptPublicKey,
      METADATA_BASE_URL: props.metadataBaseUrl.replace(/\/$/, ""),
      TRUSTED_GAME_ORIGINS: JSON.stringify(props.trustedGameOrigins),
      NODE_OPTIONS: "--enable-source-maps",
    };

    const makeFunction = (name: string, memorySize = 512, timeout = Duration.seconds(15)) =>
      new nodejs.NodejsFunction(this, `${name.replace(/(^|-)(\w)/g, (_match, _dash, letter: string) => letter.toUpperCase())}Function`, {
        entry: serviceEntry(name),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize,
        timeout,
        tracing: lambda.Tracing.ACTIVE,
        loggingFormat: lambda.LoggingFormat.JSON,
        applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
        systemLogLevelV2: lambda.SystemLogLevel.WARN,
        environment,
        bundling: {
          minify: true,
          sourceMap: true,
          sourcesContent: false,
          target: "node20",
          externalModules: [],
        },
      });

    const functions = {
      challenge: makeFunction("challenge"),
      session: makeFunction("session"),
      register: makeFunction("register"),
      mintIntent: makeFunction("mint-intent"),
      mintConfirmation: makeFunction("mint-confirmation", 512, Duration.seconds(30)),
      statePost: makeFunction("state-post", 768, Duration.seconds(30)),
      stateGet: makeFunction("state-get"),
      summary: makeFunction("summary"),
      proof: makeFunction("proof"),
      flush: makeFunction("flush"),
      metadata: makeFunction("metadata"),
      scroll: makeFunction("scroll"),
      checkpointWorker: makeFunction("checkpoint-worker", 768, Duration.minutes(2)),
      reconciliationWorker: makeFunction("reconciliation-worker", 768, Duration.minutes(1)),
      checkpointSweep: makeFunction("checkpoint-sweep", 512, Duration.seconds(30)),
    };

    for (const fn of Object.values(functions)) stateTable.grantReadData(fn);
    for (const fn of [
      functions.challenge,
      functions.session,
      functions.register,
      functions.mintConfirmation,
      functions.statePost,
      functions.flush,
      functions.checkpointWorker,
      functions.reconciliationWorker,
      functions.checkpointSweep,
    ]) stateTable.grantWriteData(fn);
    snapshotBucket.grantPut(functions.statePost, "players/*");
    snapshotBucket.grantPut(functions.mintConfirmation, "players/*");
    checkpointQueue.grantSendMessages(functions.statePost);
    checkpointQueue.grantSendMessages(functions.mintConfirmation);
    checkpointQueue.grantSendMessages(functions.flush);
    checkpointQueue.grantSendMessages(functions.checkpointSweep);
    checkpointQueue.grantConsumeMessages(functions.checkpointWorker);
    reconciliationQueue.grantSendMessages(functions.checkpointWorker);
    reconciliationQueue.grantSendMessages(functions.reconciliationWorker);
    reconciliationQueue.grantConsumeMessages(functions.reconciliationWorker);
    relayerSecret.grantRead(functions.checkpointWorker);
    relayerSecret.grantRead(functions.reconciliationWorker);

    functions.checkpointWorker.addEventSource(
      new eventSources.SqsEventSource(checkpointQueue, { batchSize: 10, reportBatchItemFailures: true }),
    );
    functions.reconciliationWorker.addEventSource(
      new eventSources.SqsEventSource(reconciliationQueue, {
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(5),
        reportBatchItemFailures: true,
      }),
    );

    new events.Rule(this, "CheckpointMaxAgeSweep", {
      description: "Enqueues debounced or maximum-age Scroll checkpoints",
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(functions.checkpointSweep, { retryAttempts: 2 })],
    });

    const route = (method: string, resource: apigateway.IResource, fn: lambda.IFunction, publicRoute = false) => {
      resource.addMethod(method, new apigateway.LambdaIntegration(fn), {
        authorizationType: apigateway.AuthorizationType.NONE,
        apiKeyRequired: false,
        ...(publicRoute ? {} : { requestParameters: { "method.request.header.Authorization": false } }),
      });
    };
    const auth = api.root.addResource("auth");
    route("POST", auth.addResource("challenge"), functions.challenge, true);
    route("POST", auth.addResource("session"), functions.session, true);
    const players = api.root.addResource("players");
    route("POST", players.addResource("register"), functions.register);
    const player = players.addResource("{wallet}");
    route("POST", player.addResource("mint-intent"), functions.mintIntent);
    route("POST", player.addResource("mint-confirmation"), functions.mintConfirmation);
    const state = player.addResource("state");
    route("POST", state, functions.statePost);
    route("GET", state, functions.stateGet);
    route("GET", player.addResource("summary"), functions.summary, true);
    route("GET", player.addResource("proof"), functions.proof, true);
    route("GET", player.addResource("scroll"), functions.scroll, true);
    const checkpoints = api.root.addResource("checkpoints");
    route("POST", checkpoints.addResource("flush"), functions.flush);
    const scrolls = api.root.addResource("scrolls").addResource("{tokenId}");
    route("GET", scrolls.addResource("metadata"), functions.metadata, true);

    const webAcl = new wafv2.CfnWebACL(this, "ApiWebAcl", {
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "SherwoodScrollWebAcl", sampledRequestsEnabled: true },
      rules: [
        {
          name: "AWSManagedCommon",
          priority: 0,
          overrideAction: { none: {} },
          statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "ManagedCommon", sampledRequestsEnabled: true },
        },
        {
          name: "PerIpRateLimit",
          priority: 1,
          action: { block: {} },
          statement: { rateBasedStatement: { aggregateKeyType: "IP", limit: 1200 } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "PerIpRateLimit", sampledRequestsEnabled: true },
        },
      ],
    });
    const association = new wafv2.CfnWebACLAssociation(this, "ApiWebAclAssociation", {
      resourceArn: `arn:${this.partition}:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
      webAclArn: webAcl.attrArn,
    });
    association.node.addDependency(api.deploymentStage);

    for (const [name, queue] of [
      ["Checkpoint", checkpointDlq],
      ["Reconciliation", reconciliationDlq],
    ] as const) {
      new cloudwatch.Alarm(this, `${name}DeadLettersAlarm`, {
        metric: queue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }
    new cloudwatch.Alarm(this, "ApiServerErrorsAlarm", {
      metric: api.metricServerError({ period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Explicitly deny accidental secret writes by runtime functions.
    for (const fn of Object.values(functions)) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: ["secretsmanager:PutSecretValue", "secretsmanager:UpdateSecret", "kms:CreateGrant"],
          resources: ["*"],
        }),
      );
    }
  }
}
