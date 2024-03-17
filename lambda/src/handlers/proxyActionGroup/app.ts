import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

interface ActionGroupEvent {
  messageVersion: string;
  agent: {
    name: string;
    id: string;
    alias: string;
    version: string;
  };
  inputText: string;
  sessionId: string;
  actionGroup: string;
  apiPath: string;
  httpMethod: string;
  parameters: {
    name: string;
    type: string;
    value: string;
  }[];
  requestBody: {
    content: {
      [contentType: string]: {
        properties: {
          name: string;
          type: string;
          value: string;
        }[];
      };
    };
  };
  sessionAttributes: Record<string, string>;
  promptSessionAttributes: Record<string, string>;
}

interface ActionGroupResponse {
  messageVersion: string;
  response: {
    actionGroup: string;
    apiPath: string;
    httpMethod: string;
    httpStatusCode: number;
    responseBody: {
      [contentType: string]: {
        body: string;
      };
    };
    sessionAttributes?: Record<string, string>;
    promptSessionAttributes?: Record<string, string>;
  };
}

let credentialProvider = fromNodeProviderChain({})
const table = new DynamoDBClient({ credentials: credentialProvider })
const sts = new STSClient({ credentials: credentialProvider });
const getCallerIdentityCommand = new GetCallerIdentityCommand({});

// Lambda handler
export const lambdaHandler = async (event: ActionGroupEvent): Promise<ActionGroupResponse> => {
  console.log("Incoming event:", JSON.stringify(event));

  let httpStatusCode = 200;
  let body = ''
  switch (event.apiPath) {
    case '/list-tickets':
      // let eventStatusCode = ''
      // let eventTypeCode = 'LIFECYCLE_EVENT'
      // let affectedAccount = ''
      let eventArn = event.parameters[0].value
      const command = new ScanCommand({
        TableName: process.env.TICKET_TABLE,
        FilterExpression: "contains(PK, :eventArn)",
        // FilterExpression: "contains(EventStatusCode, :eventStatusCode) AND contains(EventTypeCode, :eventTypeCode)",
        ExpressionAttributeValues: {
          // ":eventStatusCode": { S: "upcoming" },
          ":eventArn": { S: eventArn }
        }
      })

      const response = await table.send(command);

      body = JSON.stringify(response)
      break;

    case '/test':
      console.log('Test argument value is: ', event.parameters[0].value)
      body = 'test succeeded.'
      break;

    default:
      httpStatusCode = 200;
      body = 'Sorry I am unable to help you with that. Please try rephrase your questions';
      break;
  }

  return {
    messageVersion: event.messageVersion,
    response: {
      apiPath: event.apiPath,
      actionGroup: event.actionGroup,
      httpMethod: event.httpMethod,
      httpStatusCode: httpStatusCode,
      sessionAttributes: event.sessionAttributes,
      promptSessionAttributes: event.promptSessionAttributes,
      responseBody: {
        'application-json': {
          body: body,
        },
      },
    },
  };
}