import { APIGatewayProxyEventV2 } from "aws-lambda"
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

interface ApiGwResponse {
  headers: {
    'Content-Type': string,
    'Access-Control-Allow-Methods': string,
    'Access-Control-Allow-Origin': string
  },
  statusCode: Number,
  body: string
}

interface VerificationRequest {
  token: string
  challenge: string
}

let credentialProvider = fromNodeProviderChain({})
const evt = new EventBridgeClient({ credentials: credentialProvider })
const sts = new STSClient({ credentials: credentialProvider });
const getCallerIdentityCommand = new GetCallerIdentityCommand({});
const responseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Origin': '*'
}

const verifyToken = async (requestParams: VerificationRequest): Promise<ApiGwResponse> => {
  if (requestParams.token === process.env.SLACK_APP_VERIFICATION_TOKEN as string) {
    return {
      headers: responseHeaders,
      statusCode: 200,
      body: requestParams.challenge
    }
  } else {
    return {
      headers: responseHeaders,
      statusCode: 400,
      body: "Slack app token verification failed."
    }
  }
}

const dispatchRequest = async (requestParams: any): Promise<ApiGwResponse> => {
  /* Clean up input message */
  try {
    requestParams.event.text = requestParams.event.text.replace(`<@${requestParams.authorizations[0].user_id}>`, ' ')
  } catch (err) {
    console.log(`Could not cleanup Slack payload: `, JSON.stringify(requestParams));
    throw err;
  }
  const putEventsCommand = new PutEventsCommand({
    Entries: [
      {
        Time: new Date("TIMESTAMP"),
        Source: "awsutils.slackintegration",
        Resources: [],
        DetailType: "slackMessageReceived",
        Detail: JSON.stringify(requestParams),
        EventBusName: process.env.INTEGRATION_EVENT_BUS_NAME as string,
        TraceHeader: process.env.AWS_LAMBDA_FUNCTION_NAME as string,
      },
    ]
  })
  return evt.send(putEventsCommand)
    .then(res => {
      return {
        headers: responseHeaders,
        statusCode: 200,
        body: JSON.stringify(res)
      }
    })
    .catch(error => {
      console.log(error)
      return {
        headers: responseHeaders,
        statusCode: 400,
        body: error as  string
      }
    });
}

// Lambda handler
export const lambdaHandler = async (event: APIGatewayProxyEventV2): Promise<ApiGwResponse> => {
  console.log("Incoming event:", JSON.stringify(event));
  let payload = event.body? JSON.parse(event.body) : ''

  switch (payload.type) {
    case "url_verification": { return verifyToken(payload) };
    case "event_callback": { return dispatchRequest(payload) };
    default: return {
      headers: responseHeaders,
      statusCode: 400,
      body: "Unknown type of request"
    } ;
  }
}