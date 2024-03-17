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
        },
        {
          "Variable": "$.detail-type",
          "StringEquals": "AgentProxiedMessageReceived",
          "Next": "GetUserAgentSession"
        }
      ],
      "Default": "IgnoreInvalidRequest"
    },
    "GetUserAgentSession": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:getItem",
      "Parameters": {
        "TableName": "${ChatUserSessionsTableNamePlaceholder}",
        "Key": {
          "PK": {
            "S.$": "$.detail.event.user"
          }
        }
      },
      "Next": "UserAgentSessionExists",
      "ResultPath": "$.GetUserSession"
    },
    "UserAgentSessionExists": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.GetUserSession.Item",
          "IsPresent": true,
          "Next": "InvokeBedrockAgentWithSession"
        }
      ],
      "Default": "InvokeBedrockAgent"
    },
    "InvokeBedrockAgentWithSession": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "Payload.$": "$",
        "FunctionName": "${InvokeBedRockAgentArnPlaceholder}"
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Next": "UpsertUserAgentSession",
      "ResultPath": "$.KbResponse",
      "ResultSelector": {
        "Output.$": "$.Payload.Output",
        "SessionId.$": "$.Payload.SessionId",
        "ExpiresAt.$": "$.Payload.ExpiresAt"
      }
    },
    "UpsertUserAgentSession": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${ChatUserSessionsTableNamePlaceholder}",
        "Key": {
          "PK": {
            "S.$": "$.detail.event.user"
          }
        },
        "UpdateExpression": "SET expiresAt = :expiresAtValueRef, AgentSessionID = :AgentSessionIDValueRef",
        "ExpressionAttributeValues": {
          ":expiresAtValueRef": {
            "S.$": "$.KbResponse.ExpiresAt"
          },
          ":AgentSessionIDValueRef": {
            "S.$": "$.KbResponse.SessionId"
          }
        }
      },
      "Next": "ValidateResponse",
      "ResultPath": "$.PutUserSession"
    },
    "IgnoreInvalidRequest": {
      "Type": "Pass",
      "Parameters": {
        "SlackMessage.$": "$.detail.event.text"
      },
      "Next": "Finished"
    },
    "InvokeBedrockAgent": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "Payload.$": "$",
        "FunctionName": "${InvokeBedRockAgentArnPlaceholder}"
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Next": "PutUserAgentSession",
      "ResultPath": "$.KbResponse",
      "ResultSelector": {
        "Output.$": "$.Payload.Output",
        "SessionId.$": "$.Payload.SessionId",
        "ExpiresAt.$": "$.Payload.ExpiresAt"
      }
    },
    "PutUserAgentSession": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "${ChatUserSessionsTableNamePlaceholder}",
        "Item": {
          "PK": {
            "S.$": "$.detail.event.user"
          },
          "AgentSessionID": {
            "S.$": "$.KbResponse.SessionId"
          },
          "AgentSessionStart": {
            "S.$": "$$.State.EnteredTime"
          },
          "expiresAt": {
            "N.$": "$.KbResponse.ExpiresAt"
          }
        }
      },
      "Next": "ValidateResponse",
      "ResultPath": "$.PutUserSession"
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
          "Variable": "$.KbResponse.Output.Text",
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
          "text.$": "$.KbResponse.Output.Text",
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