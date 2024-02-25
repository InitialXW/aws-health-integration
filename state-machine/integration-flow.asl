{
  "Comment": "AWS Health event integration logics",
  "StartAt": "SnsTriageChoice",
  "States": {
    "SnsTriageChoice": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.detail.CarryingPayload.detail.eventTypeCode",
          "StringMatches": "*LIFECYCLE_EVENT*",
          "Next": "SendToLifecycleEventSns"
        }
      ],
      "Default": "SendToOpsEventSns"
    },
    "SendToLifecycleEventSns": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "${LifecycleEventTopicArnPlaceholder}",
        "Subject.$": "States.Format('New AWS Health event - {}', $.detail.CarryingPayload.detail.eventTypeCode)",
        "Message.$": "States.Format('You have a new AWS Health event arrived!\nEvent Type: {}\nCurrent Status: {}\nEvent Start time: {}\nEvent Description: {}\n\nConfirm ticket creation link: ${EventCallbackUrlPlaceholder}?status=SUCCESS&taskToken={}\nReject ticket creation link: ${EventCallbackUrlPlaceholder}?status=FAILURE&taskToken={}', $.detail.CarryingPayload.detail.eventTypeCode, $.detail.CarryingPayload.detail.statusCode, $.detail.CarryingPayload.detail.startTime, $.detail.CarryingPayload.detail.eventDescription[0].latestDescription, States.Base64Encode($.detail.TaskToken),States.Base64Encode($.detail.TaskToken))"
      },
      "Next": "SlackMe",
      "ResultPath": null
    },
    "SendToOpsEventSns": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "${OpsEventTopicArnPlaceholder}",
        "Subject.$": "States.Format('New AWS Health event - {}', $.detail.CarryingPayload.detail.eventTypeCode)",
        "Message.$": "States.Format('You have a new AWS Health event arrived!\nEvent Type: {}\nCurrent Status: {}\nEvent Start time: {}\nEvent Description: {}\n\nConfirm ticket creation link: ${EventCallbackUrlPlaceholder}?status=SUCCESS&taskToken={}\nReject ticket creation link: ${EventCallbackUrlPlaceholder}?status=FAILURE&taskToken={}', $.detail.CarryingPayload.detail.eventTypeCode, $.detail.CarryingPayload.detail.statusCode, $.detail.CarryingPayload.detail.startTime, $.detail.CarryingPayload.detail.eventDescription[0].latestDescription, States.Base64Encode($.detail.TaskToken),States.Base64Encode($.detail.TaskToken))"
      },
      "Next": "SlackMe",
      "ResultPath": null
    },
    "SlackMe": {
      "Type": "Task",
      "Resource": "arn:aws:states:::http:invoke",
      "Parameters": {
        "ApiEndpoint": "${SlackApiEndpointPlaceholder}",
        "Method": "POST",
        "RequestBody": {
          "content.$": "States.Format('\nYou have a new AWS Health event arrived!\nEvent Type: {}\nCurrent Status: {}\nEvent Start time: {}\nEvent Description: {}\n\nApprove or reject ticket creation from email received', $.detail.CarryingPayload.detail.eventTypeCode, $.detail.CarryingPayload.detail.statusCode, $.detail.CarryingPayload.detail.startTime, $.detail.CarryingPayload.detail.eventDescription[0].latestDescription)"
        },
        "Authentication": {
          "ConnectionArn": "${ConnectionArnPlaceholder}"
        }
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