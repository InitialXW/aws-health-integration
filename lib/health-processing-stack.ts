import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from "aws-cdk-lib/aws-events";
import * as evtTargets from "aws-cdk-lib/aws-events-targets";
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as kfh from 'aws-cdk-lib/aws-kinesisfirehose';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as fs from 'fs';
import * as path from 'path';

export interface HealthProcessingProps extends cdk.StackProps {
  scopedAccountIds: string[]
  slackMeUrl: string,
  slackMeApiKey: string
  lifecycleEmail: string
  opsEmail: string
}

export class HealthProcessingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: HealthProcessingProps) {
    super(scope, id, props);

    let listOfAcctPrincipals = props.scopedAccountIds.map(id => new iam.AccountPrincipal(id));

    /*** create role QuickSight for event record visualization, needs to be changed in QS console settings to make QS use this role. ***/
    const qsRole = new iam.Role(this, 'MyQuickSightServiceRole', {
      assumedBy: new iam.ServicePrincipal('quicksight.amazonaws.com'),
    });
    qsRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: [
        "athena:BatchGetQueryExecution",
        "athena:CancelQueryExecution",
        "athena:GetCatalogs",
        "athena:GetExecutionEngine",
        "athena:GetExecutionEngines",
        "athena:GetNamespace",
        "athena:GetNamespaces",
        "athena:GetQueryExecution",
        "athena:GetQueryExecutions",
        "athena:GetQueryResults",
        "athena:GetQueryResultsStream",
        "athena:GetTable",
        "athena:GetTables",
        "athena:ListQueryExecutions",
        "athena:RunQuery",
        "athena:StartQueryExecution",
        "athena:StopQueryExecution",
        "athena:ListWorkGroups",
        "athena:ListEngineVersions",
        "athena:GetWorkGroup",
        "athena:GetDataCatalog",
        "athena:GetDatabase",
        "athena:GetTableMetadata",
        "athena:ListDataCatalogs",
        "athena:ListDatabases",
        "athena:ListTableMetadata",
        "iam:List*",
        "rds:Describe*",
        "redshift:Describe*",
        "s3:ListBucket",
        "s3:GetObject",
        "glue:*"
      ],
    }));
    /******************************************************************************* */

    /****************** S3 bucket to hold all AWS Health event records**************** */
    const healthEventBucket = new s3.Bucket(this, 'HealthEventBucket', {
      bucketName: `aws-health-events-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          enabled: true,
          prefix: `eventhose`,
          expiration: cdk.Duration.days(2)
        },
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          enabled: true,
          prefix: 'eventhose-errors',
          expiration: cdk.Duration.days(2)
        },
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          enabled: true,
          prefix: 'athena-query-results',
          expiration: cdk.Duration.days(2)
        }
      ]
    });

    healthEventBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [...listOfAcctPrincipals, qsRole],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ],
        resources: [healthEventBucket.arnForObjects("*"), healthEventBucket.bucketArn]
      }),
    );
    /******************************************************************************* */

    /******************* DynamoDB Table to track event integrated task status *****************/
    const healthEventManagementTable = new dynamodb.Table(this, 'HealthEventManagementTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // tableName: 'HealthEventManagementTable',
      // billingMode: dynamodb.BillingMode.PROVISIONED,
      // readCapacity: 1,
      // writeCapacity: 1,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING
      },
      // sortKey: {
      //     name: "SK",
      //     type: dynamodb.AttributeType.STRING
      // },
    });
    // healthEventManagementTable.addLocalSecondaryIndex({
    //     indexName: 'statusIndex',
    //     sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    //     projectionType: dynamodb.ProjectionType.ALL,
    // });
    new cdk.CfnOutput(this, "HealthEventManagementTableName", { value: healthEventManagementTable.tableName })
    /*************************************************************************************** */

    /****** Dedicated event bus for AWS Health event processing microservices*************** */
    const healthEventBus = new events.EventBus(this, "HealthEventBus", {
      eventBusName: `${cdk.Stack.of(this).stackName}HealthEventBus`,
    })

    const cfnEventBusResourcePolicy = new events.CfnEventBusPolicy(this, "EventBusResourcePolicy", {
      statementId: "EventBusResourcePolicy",
      eventBusName: healthEventBus.eventBusName,
      statement:
      {
        "Effect": "Allow",
        "Action": [
          "events:PutEvents"
        ],
        "Principal": {
          "AWS": props.scopedAccountIds
        },
        "Resource": healthEventBus.eventBusArn
      }
    });

    new cdk.CfnOutput(this, "EventLakeBusArn", { value: healthEventBus.eventBusArn })
    /******************************************************************************* */

    /*** AWS Data Firehose to stream events received into S3 bucket data lake*****************/
    const firehoseDeliveryRole = new iam.Role(this, "FirehoseDeliveryRole", {
      roleName: "MyFirehoseDeliveryRole",
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
      // externalIds: [accountid]
    });
    const firehosePolicy = new iam.Policy(this, "KinesisFirehosePolicy", {
      statements: [
        new iam.PolicyStatement({
          actions: [
            "s3:AbortMultipartUpload",
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:PutObject",
          ],
          resources: [`${healthEventBucket.bucketArn}`, `${healthEventBucket.bucketArn}/*`],
        })
      ],
    });

    firehosePolicy.attachToRole(firehoseDeliveryRole);

    const eventLakeFirehose = new kfh.CfnDeliveryStream(this, 'EventLakeFirehose', {
      extendedS3DestinationConfiguration: {
        bucketArn: healthEventBucket.bucketArn,
        bufferingHints: {
          intervalInSeconds: 60, //must be <= 900
          sizeInMBs: 64
        },
        compressionFormat: "UNCOMPRESSED",
        prefix: "eventhose/source=!{partitionKeyFromQuery:source}/detail_type=!{partitionKeyFromQuery:detail_type}/event_type_code=!{partitionKeyFromQuery:eventTypeCode}/",
        errorOutputPrefix: 'eventhose-errors/dt=!{timestamp:yyyy-MM-dd-HH}/result=!{firehose:error-output-type}/',
        dynamicPartitioningConfiguration: {
          enabled: true,
          retryOptions: {
            durationInSeconds: 300 //must be <= 21600 (6 hours) and > 0. If the value is 0, the dynamic partitioning retry policy is disabled and the event is delivered according to the default retry policy. If the value is -1, the event is delivered with the default retry policy. If the
          }
        },
        roleArn: firehoseDeliveryRole.roleArn,
        processingConfiguration: {
          enabled: true,
          processors: [
            {
              parameters: [
                {
                  parameterName: "MetadataExtractionQuery",
                  parameterValue: '{detail_type:."detail-type", source:.source, eventTypeCode:.detail.eventTypeCode}'
                },
                {
                  parameterName: "JsonParsingEngine",
                  parameterValue: 'JQ-1.6'
                },
              ],
              type: "MetadataExtraction"
            }
          ]
        }
      }
    });
    /******************************************************************************* */

    /*** Role to be used by event processing and integration state machines ************/
    const healthEventProcessingRole = new iam.Role(this, 'HealthEventProcessingRole', {
      roleName: 'HealthEventProcessingRole',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'IAM role to be assumed by health event processing state machines',
    });
    healthEventProcessingRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
    healthEventProcessingRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess'));
    //without KMS permissions, startInstance call would not work if instance volume is encrypted by key
    healthEventProcessingRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // "kms:Decrypt",
        // "kms:ReEncrypt*",
        // "kms:Encrypt",
        // "kms:GenerateDataKey*",
        // "kms:DescribeKey",
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

    /*** Secret record in secrete manager for API key used in HTTP request headers; API destination in API Gateway ******/
    const apiKeySecret = new secretsmanager.Secret(this, 'ApiKeySecret', {
      secretName: 'ApiKeySecret',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          "api_key_name": "x-api-key",
          "api_key_value": props.slackMeApiKey,
          "invocation_http_parameters": {}
        }),
        generateStringKey: 'api_key_value',
      }
    })

    const apiConnection = new events.Connection(this, 'ApiConnection', {
      authorization: events.Authorization.apiKey('x-api-key', cdk.SecretValue.secretsManager(apiKeySecret.secretName)),
      description: 'API Connection with API Key x-api-key',
    });

    const slackDestination = new events.ApiDestination(this, 'slackDestination', {
      connection: apiConnection,
      httpMethod: events.HttpMethod.POST,
      endpoint: props.slackMeUrl,
      rateLimitPerSecond: 1,
      description: 'Calling slackMe API with API key x-api-key',
    });
    /******************************************************************************* */

    /***************** Rest API and API integration to call Lambda functions ******* */
    // uncomment the below to enable logging when troubleshooting needed

    // const logGroup = new logs.LogGroup(this, "ApiGatewayAccessLogs", {
    //   retention: logs.RetentionDays.ONE_WEEK,
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    // });

    const restApi = new apigw.RestApi(this, 'RestEndpoints', {
      restApiName: `${cdk.Stack.of(this).stackName}-restApi`,
      description: `${cdk.Stack.of(this).stackName} Rest API Gateway`,
      cloudWatchRole: true,
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: false, // enable x-ray
        // accessLogDestination: new apigw.LogGroupLogDestination(logGroup),
        // accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields(),
        // loggingLevel: apigw.MethodLoggingLevel.INFO
      },
      defaultCorsPreflightOptions: {
        // allowHeaders: [
        //   'Content-Type',
        //   'X-Amz-Date',
        //   'Authorization',
        //   'X-Api-Key',
        // ],
        allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowCredentials: true,
        allowOrigins: ["*"],
      },
      endpointConfiguration: {
        types: [apigw.EndpointType.REGIONAL]
      }
    });
    /******************************************************************************* */

    /*** Lambda function to mimic State machine callbacks from integrated services ***/
    const lambdaExecutionRole = new iam.Role(this, 'AwsUtilsLambdaRole', {
      roleName: 'AwsUtilsLambdaRole',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role to be assumed by AWS utils functions',
    });

    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "states:SendTaskSuccess",
        "states:SendTaskFailure"
      ],
      resources: ['*']
    }));

    const eventCallbackFunction = new lambda.Function(this, 'EventCallback', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda/src/.aws-sam/build/CallbackEventFunction'),
      handler: 'app.lambdaHandler',
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      architecture: lambda.Architecture.ARM_64,
      reservedConcurrentExecutions: 1,
      role: lambdaExecutionRole,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
      },
    });

    new logs.LogGroup(this, 'EventCallbackLogGroup', {
      logGroupName: `/aws/lambda/${eventCallbackFunction.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const eventCallbackApi = restApi.root.addResource('event-callback');
    eventCallbackApi.addMethod(
      'GET',
      new LambdaIntegration(eventCallbackFunction, { proxy: true }),
    );
    new cdk.CfnOutput(this, "EventCallbackApiUrl", { value: `${restApi.url}event-callback` })
    /******************************************************************************* */

    /*** SNS topics to triage email alert to different recipients **** */
    // SNS to receive LIFECYCLE_EVENT threshold alerts
    const lifecycleEventTopic = new sns.Topic(this, "LifecycleEventTopic", {
      displayName: "LifecycleEventTopic",
      topicName: "LifecycleEventTopic",
      fifo: false
    });

    const lifecycleEventTopicPolicy = new sns.TopicPolicy(this, 'LifecycleEventTopicPolicy', {
      topics: [lifecycleEventTopic],
    });
    lifecycleEventTopicPolicy.document.addStatements(new iam.PolicyStatement({
      actions: ["sns:Publish"],
      principals: [
        new iam.ServicePrincipal('states.amazonaws.com')],
      resources: [lifecycleEventTopic.topicArn],
    }));
    lifecycleEventTopic.addSubscription(new subscriptions.EmailSubscription(props.lifecycleEmail));

    // SNS to receive OPERATIONAL ISSUE alerts
    const opsEventTopic = new sns.Topic(this, "OpsEventTopic", {
      displayName: "OpsEventTopic",
      topicName: "OpsEventTopic",
      fifo: false
    });

    const opsEventTopicPolicy = new sns.TopicPolicy(this, 'OpsEventTopicPolicy', {
      topics: [opsEventTopic],
    });
    opsEventTopicPolicy.document.addStatements(new iam.PolicyStatement({
      actions: ["sns:Publish"],
      principals: [
        new iam.ServicePrincipal('states.amazonaws.com')],
      resources: [opsEventTopic.topicArn],
    }));
    opsEventTopic.addSubscription(new subscriptions.EmailSubscription(props.opsEmail));
    /******************************************************************************* */

    /********* Main event processing state machine *************************/
    const processingSfn = new sfn.StateMachine(this, 'HealthEventProcessing', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/processing-flow.asl')).toString().trim()),
      definitionSubstitutions: {
        "HealthEventManagementTablePlaceHolder": healthEventManagementTable.tableName,
        "HealthProcessingHealthEventBusPlaceholder": healthEventBus.eventBusName,
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: healthEventProcessingRole
    });

    const eventLakeRule = new events.Rule(this, 'EventLakeRule', {
      eventBus: healthEventBus,
      eventPattern: {
        // source: [{ prefix: '' }] as any[]
        source: ['aws.health', 'awstest.health']
      },
      ruleName: 'EventLakeRule',
      description: 'Archive events received',
      targets: [new evtTargets.KinesisFirehoseStream(eventLakeFirehose), new evtTargets.SfnStateMachine(processingSfn)]
    });
    /******************************************************************************* */

    /*** State machine for integration microservices *****/
    const integrationSfn = new sfn.StateMachine(this, 'HealthEventIntegration', {
      definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync(path.join(__dirname, '../state-machine/integration-flow.asl')).toString().trim()),
      definitionSubstitutions: {
        "ConnectionArnPlaceholder": apiConnection.connectionArn,
        "EventCallbackUrlPlaceholder": `${restApi.url}event-callback`,
        "SlackApiEndpointPlaceholder": props.slackMeUrl,
        "LifecycleEventTopicArnPlaceholder": lifecycleEventTopic.topicArn,
        "OpsEventTopicArnPlaceholder": opsEventTopic.topicArn
      },
      tracingEnabled: false,
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      role: healthEventProcessingRole
    });

    const integrationRule = new events.Rule(this, 'IntegrationRule', {
      eventBus: healthEventBus,
      eventPattern: {
        source: ['awsutils.healtheventintegration']
      },
      ruleName: 'IntegrationRule',
      description: 'Health event processing integration with external services.',
      targets: [new evtTargets.SfnStateMachine(integrationSfn)]
    });
    /******************************************************************************* */
  }
}
