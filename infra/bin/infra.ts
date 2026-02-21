#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ShockglobeStack } from '../lib/shockglobe-stack';

const app = new cdk.App();
new ShockglobeStack(app, 'ShockglobeStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
