import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  InvokeAgentRequest,
  InvokeAgentResponse,
  RetrieveAndGenerateCommand,
  RetrieveAndGenerateCommandInput,
  RetrieveAndGenerateCommandOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';

import { v4 as uuid } from 'uuid';

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
const bedrockAgent = new BedrockAgentRuntimeClient();

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

    case '/ask-tam':
      let sessionId = uuid()
      const prompt = event.requestBody.content['application/json'].properties[0].value

      const input: InvokeAgentRequest = {
        // sessionState: {
        //   sessionAttributes,
        //   promptSessionAttributes,
        // },
        agentId: process.env.AGENT_ID,
        agentAliasId: process.env.AGENT_ALIAS_ID,
        sessionId: sessionId,
        inputText: prompt,
      };

      const agentCommand: InvokeAgentCommand = new InvokeAgentCommand(input);
      const agentResponse: InvokeAgentResponse = await bedrockAgent.send(agentCommand);

      const chunks = [];
      const completion = agentResponse.completion || [];
      for await (const chunk of completion) {
        if (chunk.chunk && chunk.chunk.bytes) {
          const output = Buffer.from(chunk.chunk.bytes).toString('utf-8');
          chunks.push(output);
        }
      }
      body = chunks.join(' ');

      // const input: RetrieveAndGenerateCommandInput = {
      //   input: {
      //     text: event.requestBody.content['application/json'].properties[0].value,
      //   },
      //   retrieveAndGenerateConfiguration: {
      //     type: 'KNOWLEDGE_BASE',
      //     knowledgeBaseConfiguration: {
      //       knowledgeBaseId: process.env.KB_ID,
      //       modelArn: process.env.LLM_MODEL_ARN,
      //     },
      //   },
      // };
      // const ragCommand: RetrieveAndGenerateCommand = new RetrieveAndGenerateCommand(
      //   input
      // );
      // const ragResponse: RetrieveAndGenerateCommandOutput = await bedrockAgent.send(ragCommand);
      // body = ragResponse.output?.text as string;
      break;

    default:
      httpStatusCode = 200;
      body = 'Sorry I am unable to help you with that. Please try rephrase your questions';
      break;
  }
  console.log('The response body is:', JSON.stringify(body))
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