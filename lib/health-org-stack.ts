import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as events from "aws-cdk-lib/aws-events";
import * as evtTargets from "aws-cdk-lib/aws-events-targets";

export interface HealthOrgProps extends cdk.StackProps {
  healthEventBusArn: string
}

export class HealthOrgStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: HealthOrgProps) {
    super(scope, id, props);

    // ----------- Event forwarding ---------------
    new events.Rule(this, `HealthEventHubForwardingRule`, {
      eventPattern: {
        source: [`aws.health`, 'awstest.health'],
        // detail: {
        //     alarmName: [...props.envBootstrap.ActionEc2AlarmNames],
        //     // operation: ["update"],
        //     state: {
        //         value: ["ALARM"]
        //     },
        //     previousState: {
        //         value: ["OK"]
        //     }
        // }
      },
      targets: [new evtTargets.EventBus(events.EventBus.fromEventBusArn(
        this,
        'HealthEventHub',
        props.healthEventBusArn,
      ),)]
    });
  }
}
