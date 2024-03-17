import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { Construct } from 'constructs';

import * as path from "path";

export interface KbStatefulProps extends cdk.StackProps {
  scopedAccountIds: string[],
  healthEventManagementTableName: string
}

export class KbStatefulStack extends cdk.Stack {
  public readonly knowledgeBaseBucket: s3.Bucket;
  public readonly dataSource: bedrock.S3DataSource
  public readonly knowledgeBase: bedrock.KnowledgeBase
  public readonly invokeAgentFunction: lambda.IFunction
  public readonly proxyActionGroupFunction: lambda.IFunction

  constructor(scope: Construct, id: string, props: KbStatefulProps) {
    super(scope, id, props);

    let listOfAcctPrincipals = props.scopedAccountIds.map(id => new iam.AccountPrincipal(id));

    // const kbBucket = s3.Bucket.fromBucketName(this, 'SourceBucket', props.kbBucketName);
    this.knowledgeBaseBucket = new s3.Bucket(this, 'KnowledgeBaseBucket', {
      bucketName: `aws-knowledge-base-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      eventBridgeEnabled: true
    });

    this.knowledgeBaseBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [...listOfAcctPrincipals],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ],
        resources: [this.knowledgeBaseBucket.arnForObjects("*"), this.knowledgeBaseBucket.bucketArn],
      }),
    );
    new cdk.CfnOutput(this, "KnowledgeBaseS3Name", { value: this.knowledgeBaseBucket.bucketName })

    this.knowledgeBase = new bedrock.KnowledgeBase(this, 'BedrockKnowledgeBase', {
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V1,
      instruction: `Try this knowledge base first to answer questions.`,
    });

    this.dataSource = new bedrock.S3DataSource(this, 'DataSource', {
      bucket: this.knowledgeBaseBucket,
      knowledgeBase: this.knowledgeBase,
      dataSourceName: 'aws-events',
      chunkingStrategy: bedrock.ChunkingStrategy.DEFAULT,
      maxTokens: 500,
      overlapPercentage: 10,
    });

    new cdk.CfnOutput(this, 'DataSourceIdOutput', {
      value: this.dataSource.dataSourceId,
      exportName: 'DataSourceIdOutput',
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseIdOutput', {
      value: this.knowledgeBase.knowledgeBaseId,
      exportName: 'KnowledgeBaseIdOutput',
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseArnOutput', {
      value: this.knowledgeBase.knowledgeBaseArn,
      exportName: 'KnowledgeBaseArnOutput',
    });

    const agent = new bedrock.Agent(this, 'HyperConnAgent', {
      name: 'HyperConnAgent',
      description: 'The agent for taking operational actions.',
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_V2,
      instruction:
        'You are a cloud operations assistant that answers questions. You should first try search in your knowledge base to generate answers and then try appropriate actions in your action groups if the knowledge base does not have the answer. For any given event in your knowledge base, there may or may not be a ticket record, you can use actions available from your action groups to find out details about tickets.',
      idleSessionTTL: cdk.Duration.minutes(15),
      knowledgeBases: [this.knowledgeBase],
      shouldPrepareAgent: false,
      aliasName: 'HyperConnAgent',
    });

    /*** Bedrock agent and agent action groups **************/
    this.invokeAgentFunction = new lambda.Function(this, 'InvokeAgentFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/InvokeAgentFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(120),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      environment: {
        AGENT_ID: agent.agentId,
        AGENT_ALIAS_ID: agent.aliasId as string
      },
    });

    const invokeAgentLogGroup = new logs.LogGroup(this, 'InvokeAgentLogGroup', {
      logGroupName: `/aws/lambda/${this.invokeAgentFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const invokeAgentPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeAgent"
      ],
      resources: ['*'],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    this.invokeAgentFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'invoke-agent-policy', {
        statements: [invokeAgentPolicy],
      }),
    );

    /*** action group executor funtion **************/
    this.proxyActionGroupFunction = new lambda.Function(this, 'ProxyActionGroupFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/ProxyActionGroupFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      environment: {
        "TICKET_TABLE": props.healthEventManagementTableName
      },
    });

    const proxyActionGroupLogGroup = new logs.LogGroup(this, 'proxyActionGroupLogGroup', {
      logGroupName: `/aws/lambda/${this.proxyActionGroupFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const proxyActionGroupPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeAgent",
        "bedrock:RetrieveAndGenerate",
        "dynamodb:*"
      ],
      resources: [agent.agentArn, 'arn:aws:dynamodb:*'],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    this.proxyActionGroupFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'action-group-proxy-policy', {
        statements: [proxyActionGroupPolicy],
      }),
    );

    const agentActionGroup = new bedrock.AgentActionGroup(this, 'HyperConnAgentActionGroup', {
      actionGroupName: 'hyper-conn-action-group',
      description: 'The action group for cloud operation actions',
      agent: agent,
      apiSchema: bedrock.S3ApiSchema.fromAsset(
        path.join(__dirname, './schema/api.json')
      ),
      actionGroupState: 'ENABLED',
      actionGroupExecutor: this.proxyActionGroupFunction,
      shouldPrepareAgent: true,
    });
  }
}