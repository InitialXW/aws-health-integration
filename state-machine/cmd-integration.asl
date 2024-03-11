{
  "Comment": "Knowledge base integration logics",
  "StartAt": "ValidateInput",
  "States": {
    "ValidateInput": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.detail-type",
          "StringEquals": "slackMessageReceived",
          "Next": "RetrieveAndGenerate"
        }
      ],
      "Default": "IgnoreInvalidRequest"
    },
    "IgnoreInvalidRequest": {
      "Type": "Pass",
      "Parameters": {
        "SlackMessage.$": "$.detail.event.text"
      },
      "Next": "Finished"
    },
    "RetrieveAndGenerate": {
      "Type": "Task",
      "Next": "ValidateResponse",
      "Parameters": {
        "Input": {
          "Text.$": "$.detail.event.text"
        },
        "RetrieveAndGenerateConfiguration": {
          "Type": "KNOWLEDGE_BASE",
          "KnowledgeBaseConfiguration": {
            "KnowledgeBaseId": "${KnowledgeBaseIdPlaceHolder}",
            "ModelArn": "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-v2"
          }
        }
      },
      "Resource": "arn:aws:states:::aws-sdk:bedrockagentruntime:retrieveAndGenerate",
      "ResultPath": "$.KbResponse"
    },
    "ValidateResponse": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.KbResponse.Citations[0].GeneratedResponsePart",
          "IsPresent": true,
          "Next": "SlackBack"
        }
      ],
      "Default": "IDontKnow"
    },
    "IDontKnow": {
      "Type": "Task",
      "Resource": "arn:aws:states:::http:invoke",
      "Parameters": {
        "Method": "POST",
        "RequestBody": {
          "text": "Sorry, I don't have the knowledge needed to assist with this request. Is the knowledge base empty?",
          "thread_ts.$": "$.detail.event.ts"
        },
        "Authentication": {
          "ConnectionArn": "${ConnectionArnPlaceholder}"
        },
        "Headers": {
          "Content-type": "application/json"
        },
        "ApiEndpoint": "${SlackApiEndpointPlaceholder}"
      },
      "Retry": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "BackoffRate": 2,
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "JitterStrategy": "FULL"
        }
      ],
      "Catch": [
        {
          "ErrorEquals": [
            "States.TaskFailed"
          ],
          "Next": "Finished",
          "ResultPath": "$.SlackMe",
          "Comment": "Integration with specified Slack channel by calling http endpoints via API destination, will ignore any error and move to complete."
        }
      ],
      "Next": "Finished"
    },
    "SlackBack": {
      "Type": "Task",
      "Resource": "arn:aws:states:::http:invoke",
      "Parameters": {
        "Method": "POST",
        "RequestBody": {
          "text.$": "$.KbResponse.Citations[0].GeneratedResponsePart.TextResponsePart.Text",
          "thread_ts.$": "$.detail.event.ts"
        },
        "Authentication": {
          "ConnectionArn": "${ConnectionArnPlaceholder}"
        },
        "Headers": {
          "Content-type": "application/json"
        },
        "ApiEndpoint": "${SlackApiEndpointPlaceholder}"
      },
      "Retry": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "BackoffRate": 2,
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "JitterStrategy": "FULL"
        }
      ],
      "Catch": [
        {
          "ErrorEquals": [
            "States.TaskFailed"
          ],
          "Next": "Finished",
          "ResultPath": "$.SlackMe",
          "Comment": "Integration with specified Slack channel by calling http endpoints via API destination, will ignore any error and move to complete."
        }
      ],
      "Next": "Finished"
    },
    "Finished": {
      "Type": "Pass",
      "End": true
    }
  }
}