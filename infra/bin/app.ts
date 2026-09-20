#!/usr/bin/env node
import "dotenv/config";
import { App } from "aws-cdk-lib";
import { DianaStack } from "../lib/diana-stack";

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

const app = new App();
new DianaStack(app, "Diana", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:
      process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  secretArn: process.env.LIVEKIT_SECRET_ARN,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  googleSecretArn: process.env.GOOGLE_SECRET_ARN?.trim() || undefined,
  desiredCount: positiveInteger("AGENT_DESIRED_COUNT", 1),
  cpu: positiveInteger("AGENT_CPU", 2048),
  memoryMiB: positiveInteger("AGENT_MEMORY_MIB", 4096),
});
