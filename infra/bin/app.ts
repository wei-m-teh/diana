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
  openRouterSecretArn: process.env.OPENROUTER_SECRET_ARN?.trim() || undefined,
  openRouterModel: process.env.OPENROUTER_MODEL?.trim() || undefined,
  openRouterVisionModel: process.env.OPENROUTER_VISION_MODEL?.trim() || undefined,
  imageGenerationModel: process.env.DIANA_IMAGE_MODEL?.trim() || undefined,
  videoGenerationModel: process.env.DIANA_VIDEO_MODEL?.trim() || undefined,
  speechProvider: process.env.DIANA_SPEECH_PROVIDER?.trim() || undefined,
  ttsProvider: process.env.DIANA_TTS_PROVIDER?.trim() || undefined,
  elevenLabsSecretArn: process.env.ELEVENLABS_SECRET_ARN?.trim() || undefined,
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || undefined,
  elevenLabsTtsModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || undefined,
  openRouterTtsModel: process.env.OPENROUTER_TTS_MODEL?.trim() || undefined,
  openRouterTtsVoice: process.env.OPENROUTER_TTS_VOICE?.trim() || undefined,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  googleSecretArn: process.env.GOOGLE_SECRET_ARN?.trim() || undefined,
  desiredCount: positiveInteger("AGENT_DESIRED_COUNT", 1),
  cpu: positiveInteger("AGENT_CPU", 2048),
  memoryMiB: positiveInteger("AGENT_MEMORY_MIB", 4096),
});
