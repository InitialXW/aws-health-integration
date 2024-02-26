# Integrate AWS Health Events to Operation

- This project is built on AWS and deployable using AWS CDK as IaaS.
- A working illustration of how AWS Organization Heath featured events can be integrated into your IT operations for automated monitoring, triage, and reporting.
- Can be built further on to integrate with more types of events and other internal/external services of yours.
- Built fully on serverless and event-driven architecture (EDA) on AWS

## Summary of what is contained
- A health event processing microservice to consume organization health events and an example tracking/triage workflow.
- A health event integration microservice to manage 3rd party service integration (used Slack as an example but aiming at integration with Jira and ServiceNow).
- A visualization microservice with an S3 event data lake and AWS Quicksight at its core (QuickSight dashboards is work-in-progress)

## Prerequisites
- At least 1 AWS account with appropriate permissions. The project uses a typical setup of 2 accounts where as 1 is the org admin account and the other is the worker account hosting all the microservices.
- A Slack channel set up with a workflow to receive messages from webhook. This is optional if you wanted to skip the notification function integrated with Slack.
- AWS CDK installed on your local environment for stack deployment
- AWS SAM (Serverless Application Model) and Docker installed on your local environment to build Lambda images

## Architecture
<p align="left">
<img src="https://github.com/InitialXW/aws-health-integration/blob/main/architecture.png"
  alt="Archetectural diagram by seanxw">
</p>

## Deployment steps
### Copy repo to your local directory
```zsh
git clone https://github.com/InitialXW/aws-health-integration.git
cd aws-health-integration
npm install
cdk bootstrap aws://<your admin AWS account id>/<region where you Organization is> aws://<your worker AWS account id>/<region where your worker services to be>
cd lambda/src
# Depending on your buid environment, you might want o change the arch type to x84 or arm in lambda/src/template.yaml file before build 
sam build --use-container
cd ../..
```
### Create an '.env' file under project root directory that contains the following
```zsh
CDK_ADMIN_ACCOUNT=<replace with your 12 digits admin AWS account id>
CDK_PROCESSING_ACCOUNT=<replace with your 12 digits worker AWS account id>
CDK_ADMIN_REGION=<replace with the region where your Organization is, e.g. us-east-1>
CDK_PROCESSING_REGION=<replace with the region where you want the worker services to be, e.g. us-east-1>
SLACK_CHANNEL_HOOK=<your Slack channel webhook url here>
SLACK_CALL_API_KEY=<assign an random api key to be used when initiating Slack webhook calls, all letters>
LIFECYCLE_NOTIFY_EMAIL=<an email address to receive the triaged approval requests for lifecycle type of health events>
OPS_ISSUE_NOTIFY_EMAIL=<an email address to receive the triaged approval requests for operational issue type of health events>
EVENT_HUB_ARN=arn:aws:events:ap-southeast-2:111222333444:event-bus/HealthProcessingHealthEventBus
```
### Deploy worker account stack
```zsh
# deploying processing microservice to your worker account
# ensure you are in project root directory
cdk deploy HealthProcessingStack
```
### Replace in .env file the 'EVENT_HUB_ARN' value with the 'HealthProcessingStack.EventLakeBusArn' console output value from previous step
### Based on the email addresses provided in step 1, you should have received 2 emails respectively asking to consent to receive notifications, make sure you hit the confirm links in those emails. 
### Deploy admin account stack
```zsh
cdk deploy HealthOrgStack
```
## Testing out
### Go to EventBridge console in your chosen admin account, ensure you are in the right region, go to'Event buses' and firing off the below test event that mimic a real Health event. You should receive Slack messages for notification and approval request emails.
Test event 1 (a lifecycle event)
```json
{
    "eventArn": "arn:aws:health:ap-southeast-2::event/EKS/AWS_EKS_PLANNED_LIFECYCLE_EVENT/Example1",
    "service": "EKS",
    "eventTypeCode": "AWS_EKS_PLANNED_LIFECYCLE_EVENT",
    "eventTypeCategory": "plannedChange",
    "eventScopeCode": "ACCOUNT_SPECIFIC",
    "communicationId": "1234567890abcdef023456789-1",
    "startTime": "Wed, 31 Jan 2024 02:00:00 GMT",
    "endTime": "",
    "lastUpdatedTime": "Wed, 29 Nov 2023 08:20:00 GMT",
    "statusCode": "upcoming",
    "eventRegion": "ap-southeast-2",
    "eventDescription": [
        {
            "language": "en_US",
            "latestDescription": "Amazon EKS has deprecated Kubernetes version 1.2x..."
        }
    ],
    "eventMetadata": {
        "deprecated_versions": "Kubernetes 1.2x in EKS"
    },
    "affectedEntities": [
        {
            "entityValue": "arn:aws:eks:ap-southeast-2:111122223333:cluster/example1",
            "lastupdatedTime": "Wed, 29 Nov 2023 08:20:00 GMT",
            "statusCode": "RESOLVED"
        },
        {
            "entityValue": "arn:aws:eks:ap-southeast-2:111122223333:cluster/example3",
            "lastupdatedTime": "Wed, 29 Nov 2023 08:20:31 GMT",
            "statusCode": "PENDING"
        }
    ],
    "affectedAccount": "111122223333",
    "page": "1",
    "totalPages": "1"
}
```

Test event 2 (a Ops issue event)
```json
{
    "eventArn": "arn:aws:health:global::event/IAM/AWS_IAM_OPERATIONAL_ISSUE/AWS_FAKE_OPERATIONAL_ISSUE_12345_ABCDEFGHIJK",
        "service": "FAKE",
        "eventTypeCode": "AWS_FAKE_OPERATIONAL_ISSUE",
        "eventTypeCategory": "issue",
        "eventScopeCode": "PUBLIC",
        "communicationId": "a76afee0829c473703943fe5e2edd04cb91c6051-1",
        "startTime": "Thu, 22 Feb 2024 01:49:40 GMT",
        "endTime": "Thu, 22 Feb 2024 03:11:08 GMT",
        "lastUpdatedTime": "Thu, 22 Feb 2024 19:39:38 GMT",
        "statusCode": "closed",
        "eventRegion": "global",
        "eventDescription": [
            {
                "language": "en_US",
                "latestDescription": "A test operational issue that is happening to your account."
            }
        ],
        "affectedAccount": "444333222111",
        "page": "1",
        "totalPages": "1"
}
```
## Going beyond
[Integration with ServiceNow](https://docs.aws.amazon.com/smc/latest/ag/sn-aws-health.html)

[Integration with Jira](https://marketplace.atlassian.com/apps/1221283/aws-service-management-connector-for-jsm?tab=overview&hosting=cloud)

