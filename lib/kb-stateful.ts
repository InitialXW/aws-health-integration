import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { Construct } from 'constructs';
import * as fs from 'fs';

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
  public readonly opsActionGroupFunction: lambda.IFunction
  public readonly tamActionGroupFunction: lambda.IFunction

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
      instruction: `Use this knowledge base answer questions about operational events, issues, and lifecycle notifications.`,
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

    const tamAgent = new bedrock.Agent(this, 'TamAgent', {
      name: 'TamAgent',
      description: 'The agent for consultation on operational events, issues.',
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_V2,
      instruction:
        'You are an AWS Technical Account Manager (TAM) that provides details or advices related to operational events, issues, and notifications.',
      idleSessionTTL: cdk.Duration.minutes(15),
      knowledgeBases: [this.knowledgeBase],
      shouldPrepareAgent: false,
      aliasName: 'TamAgent',
      promptOverrideConfiguration: {
        promptConfigurations: [
          {
            promptType: bedrock.PromptType.PRE_PROCESSING,
            inferenceConfiguration: {
              temperature: 0,
              topP: 1,
              topK: 250,
              stopSequences: ['\n\nHuman:'],
              maximumLength: 2048,
            },
            promptCreationMode: bedrock.PromptCreationMode.OVERRIDDEN,
            promptState: bedrock.PromptState.ENABLED,
            basePromptTemplate: fs.readFileSync(path.join(__dirname, '../prompt-templates/tam-agent/preprocessing.xml')).toString(),
            parserMode: bedrock.ParserMode.DEFAULT
          },
          // {
          //   promptType: bedrock.PromptType.ORCHESTRATION,
          //   inferenceConfiguration: {
          //     temperature: 0,
          //     topP: 1,
          //     topK: 250,
          //     stopSequences: ['</function_call>','</answer>','</error>'],
          //     maximumLength: 2048,
          //   },
          //   promptCreationMode: bedrock.PromptCreationMode.OVERRIDDEN,
          //   promptState: bedrock.PromptState.ENABLED,
          //   basePromptTemplate: fs.readFileSync(path.join(__dirname, '../prompt-templates/tam-agent/orchestration.xml')).toString(),
          //   parserMode: bedrock.ParserMode.DEFAULT
          // }
        ]
      }
    });

    const opsAgent = new bedrock.Agent(this, 'OpsnAgent', {
      name: 'OpsAgent',
      description: 'The agent to assist in operational actions.',
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_V2,
      instruction:
        'You are a cloud operations assistant that answers questions and takes actions related to operational events, issues, and notifications. You have the help from an AWS TAM who can provide information about any AWS operations events, issues, and/or notifications. Uou can use actions available from your action groups to find out details about tickets.',
      idleSessionTTL: cdk.Duration.minutes(15),
      // knowledgeBases: [this.knowledgeBase],
      shouldPrepareAgent: false,
      aliasName: 'OpsAgent',
      promptOverrideConfiguration: {
        promptConfigurations: [
          {
            promptType: bedrock.PromptType.PRE_PROCESSING,
            inferenceConfiguration: {
              temperature: 0,
              topP: 1,
              topK: 250,
              stopSequences: ['\n\nHuman:'],
              maximumLength: 2048,
            },
            promptCreationMode: bedrock.PromptCreationMode.OVERRIDDEN,
            promptState: bedrock.PromptState.ENABLED,
            basePromptTemplate: fs.readFileSync(path.join(__dirname, '../prompt-templates/ops-agent/preprocessing.xml')).toString(),
            parserMode: bedrock.ParserMode.DEFAULT
          },
          {
            promptType: bedrock.PromptType.ORCHESTRATION,
            inferenceConfiguration: {
              temperature: 0,
              topP: 1,
              topK: 250,
              stopSequences: ['</function_call>','</answer>','</error>'],
              maximumLength: 2048,
            },
            promptCreationMode: bedrock.PromptCreationMode.OVERRIDDEN,
            promptState: bedrock.PromptState.ENABLED,
            basePromptTemplate: fs.readFileSync(path.join(__dirname, '../prompt-templates/ops-agent/orchestration.xml')).toString(),
            parserMode: bedrock.ParserMode.DEFAULT
          }
        ]
      }
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
        AGENT_ID: opsAgent.agentId,
        AGENT_ALIAS_ID: opsAgent.aliasId as string
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

    /*** Operations assisant action group executor funtion **************/
    this.opsActionGroupFunction = new lambda.Function(this, 'OpsActionGroupFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/OpsActionGroupFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      environment: {
        "TICKET_TABLE": props.healthEventManagementTableName,
        "KB_ID": this.knowledgeBase.knowledgeBaseId,
        "LLM_MODEL_ARN": `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-v2`
      },
    });

    const opsActionGroupLogGroup = new logs.LogGroup(this, 'OpsActionGroupLogGroup', {
      logGroupName: `/aws/lambda/${this.opsActionGroupFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const opsActionGroupPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeAgent",
        "bedrock:RetrieveAndGenerate",
        "bedrock:Retrieve",
        "bedrock:InvokeModel",
        "dynamodb:*"
      ],
      resources: [opsAgent.agentArn, this.knowledgeBase.knowledgeBaseArn, `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-v2`, 'arn:aws:dynamodb:*'],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    this.opsActionGroupFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'action-group-ops-policy', {
        statements: [opsActionGroupPolicy],
      }),
    );

    /*** TAM consultant action group executor funtion **************/
    this.tamActionGroupFunction = new lambda.Function(this, 'TamActionGroupFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/TamActionGroupFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      environment: {
        "TICKET_TABLE": props.healthEventManagementTableName,
        "KB_ID": this.knowledgeBase.knowledgeBaseId,
        "LLM_MODEL_ARN": `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-v2`
      },
    });

    const tamActionGroupLogGroup = new logs.LogGroup(this, 'TamActionGroupLogGroup', {
      logGroupName: `/aws/lambda/${this.tamActionGroupFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const tamActionGroupPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeAgent",
        "bedrock:RetrieveAndGenerate",
        "bedrock:Retrieve",
        "bedrock:InvokeModel",
        "dynamodb:*"
      ],
      resources: [tamAgent.agentArn, this.knowledgeBase.knowledgeBaseArn, `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-v2`, 'arn:aws:dynamodb:*'],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    this.tamActionGroupFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'action-group-tam-policy', {
        statements: [tamActionGroupPolicy],
      }),
    );

    // const tamAgentActionGroup = new bedrock.AgentActionGroup(this, 'TamAgentActionGroup', {
    //   actionGroupName: 'tam-action-group',
    //   description: 'The action group for TAM agent',
    //   agent: tamAgent,
    //   apiSchema: bedrock.S3ApiSchema.fromAsset(
    //     path.join(__dirname, './schema/api-tam.json')
    //   ),
    //   actionGroupState: 'ENABLED',
    //   actionGroupExecutor: this.tamActionGroupFunction,
    //   shouldPrepareAgent: true,
    // });

    const osAgentActionGroup = new bedrock.AgentActionGroup(this, 'OpsAgentActionGroup', {
      actionGroupName: 'ops-action-group',
      description: 'The action group for cloud operations assistant agent',
      agent: opsAgent,
      apiSchema: bedrock.S3ApiSchema.fromAsset(
        path.join(__dirname, './schema/api-ops.json')
      ),
      actionGroupState: 'ENABLED',
      actionGroupExecutor: this.opsActionGroupFunction,
      shouldPrepareAgent: true,
    });
  }
}