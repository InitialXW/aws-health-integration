import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from "aws-cdk-lib/aws-events";
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as evtTargets from "aws-cdk-lib/aws-events-targets";
import { Construct } from 'constructs';

import * as path from 'path';
import * as fs from 'fs';

export interface KbServiceProps extends cdk.StackProps {
  connectionArn: string
  restApiUrl: string
  slackMeUrl: string
  integrationEventBus: events.IEventBus
  eventBucketName: string
  kbBucketName: string
  kbBucketRegion: string
  knowledgeBaseArn: string
  knowledgeBaseId: string
  dataSourceId: string
  invokeAgentFunctionArn: string
}

export class KbServiceStack extends cdk.Stack {
  public kbBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: KbServiceProps) {
    super(scope, id, props);

    /******************* DynamoDB Table to manage user chat sessions *****************/
    const chatUserSessionsTable = new dynamodb.Table(this, 'ChatUserSessionsTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // tableName: 'ChatUserSessionsTable',
      // billingMode: dynamodb.BillingMode.PROVISIONED,
      // readCapacity: 1,
      // writeCapacity: 1,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING
      },
      timeToLiveAttribute: "expiresAt"
    });
    new cdk.CfnOutput(this, "ChatUserSessionsTableName", { value: chatUserSessionsTable.tableName })
    /*************************************************************************************** */

    // --------- Convert JSON events to txt and save to knowledge base data source function---------------
    const processFileDlq = new sqs.Queue(this, 'ProcessFileDlq', {
    })
    const processFileSqs = new sqs.Queue(this, 'ProcessFileSqs', {
        visibilityTimeout: cdk.Duration.seconds(90), //6 times the function timeout, plus the value of MaximumBatchingWindowInSeconds
        deadLetterQueue: {
            queue: processFileDlq,
            maxReceiveCount: 10
        }
    })

    const jsonToKnowledgeBaseFunction = new lambda.Function(this, 'JsonToKnowledgeBaseFunction', {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/JsonToKnowledgeBaseFunction'),
        handler: 'app.lambdaHandler',
        timeout: cdk.Duration.seconds(5),
        memorySize: 128,
        architecture: lambda.Architecture.ARM_64,
        reservedConcurrentExecutions: 1,
        // role: executionRole,
        environment: {
            TARGET_S3: props.kbBucketName,
            TARGET_S3_REGION: props.kbBucketRegion
        },
    });

    jsonToKnowledgeBaseFunction.addEventSource(new SqsEventSource(processFileSqs, {
        batchSize: 1,
        maxBatchingWindow: cdk.Duration.minutes(1),
        reportBatchItemFailures: true
    }));

    const jsonToKnowledgeBaseLogGroup = new logs.LogGroup(this, 'JsonToKnowledgeBaseLogGroup', {
        logGroupName: `/aws/lambda/${jsonToKnowledgeBaseFunction.functionName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const jsonToKnowledgeBasePolicy = new iam.PolicyStatement({
        actions: [
            "s3:ListBucket",
            "s3:GetObject",
            "s3:GetBucketLocation",
            "s3:ListMultipartUploadParts",
            "s3:PutObject",
            "s3:DeleteObject",
            "s3:DeleteObjects"
        ],
        resources: ['arn:aws:s3:::*'],
        effect: cdk.aws_iam.Effect.ALLOW
    });

    jsonToKnowledgeBaseFunction.role?.attachInlinePolicy(
        new iam.Policy(this, 'knowledge-base-buckets-policy', {
            statements: [jsonToKnowledgeBasePolicy],
        }),
    );

    new events.Rule(this, `HealthEventArrivalRule`, {
        // from default event bus
        eventPattern: {
            source: [
                "aws.s3"
            ],
            detailType: [
                "Object Created"
            ],
            detail: {
                bucket: {
                    name: [
                        props.eventBucketName
                    ]
                }
            }
        },
        targets: [new evtTargets.SqsQueue(processFileSqs)]
    });

    // ------------------- Ingest to knowledge base function ---------------------
    const bufferKbSyncSqs = new sqs.Queue(this, 'bufferKbSyncSqs', {
      visibilityTimeout: cdk.Duration.seconds(300), //6 times the function timeout, plus the value of MaximumBatchingWindowInSeconds
    })

    const ingestKbFunction = new lambda.Function(this, 'IngestKbFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/IngestKbFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      environment: {
        KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
        KB_DATA_SOURCE_ID: props.dataSourceId
      },
    });

    ingestKbFunction.addEventSource(new SqsEventSource(bufferKbSyncSqs, {
      batchSize: 100,
      maxBatchingWindow: cdk.Duration.minutes(3),
      reportBatchItemFailures: true
    }));

    const ingestKbLogGroup = new logs.LogGroup(this, 'IngestKbLogGroup', {
      logGroupName: `/aws/lambda/${ingestKbFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ingestKbPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:StartIngestionJob"
      ],
      resources: [props.knowledgeBaseArn],
      effect: cdk.aws_iam.Effect.ALLOW
    });

    ingestKbFunction.role?.attachInlinePolicy(
      new iam.Policy(this, 'ingest-knowledge-base-policy', {
        statements: [ingestKbPolicy],
      }),
    );

    new events.Rule(this, `KbFileArrivalRule`, {
      // from default event bus
      eventPattern: {
        source: [
          "aws.s3"
        ],
        detailType: [
          "Object Created",
          // "Object Deleted"
        ],
        detail: {
          bucket: {
            name: [
              props.kbBucketName
            ]
          }
        }
      },
      targets: [new evtTargets.SqsQueue(bufferKbSyncSqs)]
    });

    /*** Role to be used by Bedrock chat integration state machines ************/
    const cmdIntegrationRole = new iam.Role(this, 'CmdIntegrationRole', {
      roleName: 'CmdIntegrationRole',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'IAM role to be assumed by Bedrock chat integration state machines',
    });
    cmdIntegrationRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
    cmdIntegrationRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess'));
    //without KMS permissions, startInstance call would not work if instance volume is encrypted by key
    cmdIntegrationRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "bedrock:RetrieveAndGenerate",
        "bedrock:Retrieve",
        "bedrock:InvokeModel",
        "kms:CreateGrant",
        "states:InvokeHTTPEndpoint",
        "events:RetrieveConnectionCredentials",
        "events:PutEvents",
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
        "SNS:Publish"
      ],
      resources: ['*']
    }));
    /******************************************************************************* */

    /*** State machine for slack command event integration microservices *****/
    const cmdIntegrationSfn = new sfn.StateMachine(this, 'CmdIntegrationSfn', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/cmd-integration.asl')).toString().trim()),
      definitionSubstitutions: {
        "ConnectionArnPlaceholder": props.connectionArn,
        "SlackApiEndpointPlaceholder": props.slackMeUrl,
        "KnowledgeBaseIdPlaceHolder": props.knowledgeBaseId,
        "InvokeBedRockAgentArnPlaceholder": props.invokeAgentFunctionArn,
        "ChatUserSessionsTableNamePlaceholder": chatUserSessionsTable.tableName
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: cmdIntegrationRole
    });

    const cmdIntegrationRule = new events.Rule(this, 'CmdIntegrationRule', {
      eventBus: props.integrationEventBus,
      eventPattern: {
        source: ['awsutils.slackintegration']
      },
      ruleName: 'CmdIntegrationRule',
      description: 'Command event processing integration with external services.',
      targets: [new evtTargets.SfnStateMachine(cmdIntegrationSfn)]
    });
    /******************************************************************************* */
  }
}