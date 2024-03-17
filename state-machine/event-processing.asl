{
  "Comment": "A description of my state machine",
  "StartAt": "GetEventItem",
  "States": {
    "GetEventItem": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:getItem",
      "Parameters": {
        "TableName": "${HealthEventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "States.Format('{}~{}', $.detail.eventArn, $.detail.affectedAccount)"
          }
        }
      },
      "Next": "EventItemExists",
      "ResultPath": "$.GetEventItem"
    },
    "EventItemExists": {
      "Type": "Choice",
      "Choices": [
        {
          "Not": {
            "Variable": "$.GetEventItem.Item",
            "IsPresent": true
          },
          "Next": "PutEventItem"
        }
      ],
      "Default": "EventUpdate-ToDo"
    },
    "PutEventItem": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "${HealthEventManagementTablePlaceHolder}",
        "Item": {
          "PK": {
            "S.$": "States.Format('{}~{}', $.detail.eventArn, $.detail.affectedAccount)"
          },
          "EventTypeCode": {
            "S.$": "$.detail.eventTypeCode"
          },
          "EventStatusCode": {
            "S.$": "$.detail.statusCode"
          },
          "CommunicationId": {
            "S.$": "$.detail.communicationId"
          },
          "StartTime": {
            "S.$": "$.detail.startTime"
          },
          "LastUpdatedTime": {
            "S.$": "$.detail.lastUpdatedTime"
          },
          "StatusCode": {
            "S.$": "$.detail.statusCode"
          },
          "EventDescription": {
            "S.$": "$.detail.eventDescription[0].latestDescription"
          },
          "EvenActionStatus": {
            "S": "New"
          }
        }
      },
      "Next": "EmitHealthEventAdded",
      "ResultPath": "$.PutItem"
    },
    "EmitHealthEventAdded": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents.waitForTaskToken",
      "Parameters": {
        "Entries": [
          {
            "Detail": {
              "Message": "New health event added.",
              "TaskToken.$": "$$.Task.Token",
              "CarryingPayload.$": "$"
            },
            "DetailType": "HealthEventProcess.EventAdded",
            "EventBusName": "${HealthProcessingHealthEventBusPlaceholder}",
            "Source": "awsutils.healtheventintegration"
          }
        ]
      },
      "ResultPath": "$.TaskTokenCallback",
      "Catch": [
        {
          "ErrorEquals": [
            "States.Timeout"
          ],
          "Comment": "wait confirmation timed out",
          "Next": "PutEventItem",
          "ResultPath": "$.cause"
        },
        {
          "ErrorEquals": [
            "States.TaskFailed"
          ],
          "Comment": "Operator rejected task.",
          "Next": "UpdateEventItemTicketRejected",
          "ResultPath": "$.cause"
        }
      ],
      "TimeoutSeconds": 3000,
      "Next": "UpdateEventItemTicketCreated"
    },
    "UpdateEventItemTicketCreated": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${HealthEventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "States.Format('{}~{}', $.detail.eventArn, $.detail.affectedAccount)"
          }
        },
        "UpdateExpression": "SET TicketCreatedAt = :myValueRef",
        "ExpressionAttributeValues": {
          ":myValueRef": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "Next": "ApprovedOrRejected",
      "ResultPath": "$.TicketAction"
    },
    "UpdateEventItemTicketRejected": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "${HealthEventManagementTablePlaceHolder}",
        "Key": {
          "PK": {
            "S.$": "States.Format('{}~{}', $.detail.eventArn, $.detail.affectedAccount)"
          }
        },
        "UpdateExpression": "SET TicketRejectedAt = :myValueRef",
        "ExpressionAttributeValues": {
          ":myValueRef": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "Next": "ApprovedOrRejected",
      "ResultPath": "$.TicketAction"
    },
    "ApprovedOrRejected": {
      "Type": "Choice",
      "Choices": [
        {
          "And": [
            {
              "Variable": "$.TaskTokenCallback.Payload",
              "IsPresent": true
            },
            {
              "Variable": "$.TaskTokenCallback.Payload",
              "StringEquals": "SUCCESS"
            }
          ],
          "Next": "NotifySuccess"
        }
      ],
      "Default": "NotifyFailure"
    },
    "NotifyFailure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::http:invoke",
      "Parameters": {
        "Method": "POST",
        "RequestBody": {
          "text": "Ticket creation rejected by operator."
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
      "End": true
    },
    "NotifySuccess": {
      "Type": "Task",
      "Resource": "arn:aws:states:::http:invoke",
      "Parameters": {
        "Method": "POST",
        "RequestBody": {
          "text": "Ticket creation approved by operator."
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
      "End": true
    },
    "EventUpdate-ToDo": {
      "Type": "Pass",
      "End": true
    }
  }
}