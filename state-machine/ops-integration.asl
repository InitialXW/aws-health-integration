{
  "Comment": "AWS Health event integration with other toolings",
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
          "blocks": [
            {
              "type": "header",
              "text": {
                "type": "plain_text",
                "text": "Request for ticket creation for a new AWS Health event",
                "emoji": true
              }
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Event Type:* {}', $.detail.CarryingPayload.detail.eventTypeCode)"
                }
              ]
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*Event Status:* {}', $.detail.CarryingPayload.detail.statusCode)"
                }
              ]
            },
            {
              "type": "section",
              "fields": [
                {
                  "type": "mrkdwn",
                  "text.$": "States.Format('*When:*\n{}', $.detail.CarryingPayload.detail.startTime)"
                }
              ]
            },
            {
              "type": "divider"
            },
            {
              "type": "section",
              "text": {
                "text.$": "States.Format('*Event Details:*\n{}', $.detail.CarryingPayload.detail.eventDescription[0].latestDescription)",
                "type": "mrkdwn"
              }
            },
            {
              "type": "actions",
              "elements": [
                {
                  "type": "button",
                  "text": {
                    "type": "plain_text",
                    "text": "Approve Ticket"
                  },
                  "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=SUCCESS&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                  "style": "primary"
                },
                {
                  "type": "button",
                  "text": {
                    "type": "plain_text",
                    "text": "Reject Ticket"
                  },
                  "url.$": "States.Format('${EventCallbackUrlPlaceholder}?status=FAILURE&taskToken={}', States.Base64Encode($.detail.TaskToken))",
                  "style": "danger"
                }
              ]
            }
          ]
        },
        "Authentication": {
          "ConnectionArn": "${ConnectionArnPlaceholder}"
        },
        "Headers": {
          "Content-type": "application/json"
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