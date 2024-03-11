import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';

import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import { Construct } from 'constructs';

export interface KbStatefulProps extends cdk.StackProps {
  scopedAccountIds: string[],
}

export class KbStatefulStack extends cdk.Stack {
  public readonly knowledgeBaseBucket: s3.Bucket;
  public readonly dataSource: bedrock.S3DataSource
  public readonly knowledgeBase: bedrock.KnowledgeBase

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
      instruction: `Use this knowledge base to answer questions about AWS events.`,
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
  }
}