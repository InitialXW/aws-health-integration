#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as dotenv from "dotenv";
import * as path from "path";

import { HealthProcessingStack } from '../lib/health-processing-stack';
import { HealthOrgStack } from '../lib/health-org-stack';
import { KbStatefulStack } from '../lib/kb-stateful';
import { KbServiceStack } from '../lib/kb-service';

dotenv.config({ path: path.resolve(__dirname, "../.env") });
const app = new cdk.App();

const scopedAccountIds = process.env.CDK_PROCESSING_ACCOUNT as string === process.env.CDK_ADMIN_ACCOUNT as string? [process.env.CDK_PROCESSING_ACCOUNT as string] : [process.env.CDK_PROCESSING_ACCOUNT as string, process.env.CDK_ADMIN_ACCOUNT as string]

const healthProcessingStack = new HealthProcessingStack(app, 'HealthProcessingStack', {
  stackName: `HealthProcessing`,
  tags: {
    env: 'prod',
    "ManagedBy": 'HealthProcessingStack',
    "auto-delete": "no"

  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  scopedAccountIds: scopedAccountIds,
  slackMeUrl: process.env.SLACK_CHANNEL_HOOK as string,
  slackMeApiKey: process.env.SLACK_CALL_API_KEY as string,
  lifecycleEmail: process.env.LIFECYCLE_NOTIFY_EMAIL as string,
  opsEmail: process.env.OPS_ISSUE_NOTIFY_EMAIL as string,
  slackAppVerificationToken: process.env.SLACK_APP_VERIFICATION_TOKEN as string,
  slackAccessToken: process.env.SLACK_ACCESS_TOKEN as string,
});

new HealthOrgStack(app, 'HealthOrgStack', {
  stackName: `HealthOrg`,
  tags: {
    env: 'prod',
    "ManagedBy": 'HealthOrgStack',
    "auto-delete": "no"

  },
  env: {
    account: process.env.CDK_ADMIN_ACCOUNT,
    region: process.env.CDK_ADMIN_REGION,
  },
  healthEventBusArn: process.env.EVENT_HUB_ARN as string
});

const kbStatefulStack = new KbStatefulStack(app, 'KbStatefulStack', {
  stackName: `KbStatefulStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'KnolegeBase',
    "auto-delete": "no"

  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  scopedAccountIds: scopedAccountIds
});

new KbServiceStack(app, 'KbServiceStack', {
  stackName: `KbServiceStack`,
  tags: {
    env: 'prod',
    "ManagedBy": 'KnolegeBase',
    "auto-delete": "no"

  },
  env: {
    account: process.env.CDK_PROCESSING_ACCOUNT,
    region: process.env.CDK_PROCESSING_REGION,
  },
  connectionArn: healthProcessingStack.apiConnection.connectionArn,
  restApiUrl: healthProcessingStack.restApi.url,
  slackMeUrl: process.env.SLACK_CHANNEL_HOOK as string,
  integrationEventBus: healthProcessingStack.integrationEventBus,
  eventBucketName: healthProcessingStack.healthEventBucket.bucketName,
  kbBucketName: kbStatefulStack.knowledgeBaseBucket.bucketName,
  kbBucketRegion: kbStatefulStack.region,
  knowledgeBaseArn: kbStatefulStack.knowledgeBase.knowledgeBaseArn,
  knowledgeBaseId: kbStatefulStack.knowledgeBase.knowledgeBaseId,
  dataSourceId: kbStatefulStack.dataSource.dataSourceId,
});