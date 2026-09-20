import { authenticatedUser } from "./auth";
import { profileStore, type UserIdentity } from "./profile-store";
import { randomUUID } from "node:crypto";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
} from "livekit-server-sdk";
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

export interface LiveKitCredentials {
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
}

const secrets = new SecretsManagerClient({});
let cached: { value: LiveKitCredentials; expires: number } | undefined;

async function credentials(): Promise<LiveKitCredentials> {
  if (cached && cached.expires > Date.now()) return cached.value;
  const result = await secrets.send(
    new GetSecretValueCommand({ SecretId: process.env.LIVEKIT_SECRET_ARN }),
  );
  const value = JSON.parse(result.SecretString ?? "{}") as LiveKitCredentials;
  if (
    !value.LIVEKIT_URL?.startsWith("wss://") ||
    !value.LIVEKIT_API_KEY ||
    !value.LIVEKIT_API_SECRET
  ) {
    throw new Error(
      "LiveKit secret must contain a wss URL, API key and API secret",
    );
  }
  cached = { value, expires: Date.now() + 60_000 };
  return value;
}

// Dependency injection keeps token permissions testable without AWS credentials.
export function createHandler(loadCredentials = credentials, ensureProfile: (user: UserIdentity) => Promise<unknown> = profileStore.ensure) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    if (event.requestContext.http.method !== "POST") {
      return {
        statusCode: 405,
        headers: { ...headers, Allow: "POST" },
        body: JSON.stringify({ error: "method_not_allowed" }),
      };
    }
    if (event.rawPath !== "/sessions") {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "not_found" }),
      };
    }
    // API Gateway verifies the signature; only its scoped service principal can invoke
    // this function. Validate its trusted claims again before loading credentials.
    const user = authenticatedUser(event);
    if (!user) return { statusCode: 403, headers, body: JSON.stringify({ error: "not_authorized" }) };
    try {
      await ensureProfile(user);
      const config = await loadCredentials();
      const roomName = `diana_${randomUUID()}`;
      const participantIdentity = `user_${user.sub}_${randomUUID()}`;
      const token = new AccessToken(
        config.LIVEKIT_API_KEY,
        config.LIVEKIT_API_SECRET,
        {
          identity: participantIdentity,
          name: "Diana user",
          ttl: "5m",
        },
      );
      // Authenticated callers cannot choose a room, identity, agent, metadata or permissions.
      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      token.roomConfig = new RoomConfiguration({
        agents: [new RoomAgentDispatch({ agentName: "diana" })],
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          serverUrl: config.LIVEKIT_URL,
          roomName,
          participantName: "Diana user",
          participantToken: await token.toJwt(),
        }),
      };
    } catch {
      // Do not log secret values or return provider error details to anonymous clients.
      console.error("Unable to issue LiveKit token");
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ error: "conversation_unavailable" }),
      };
    }
  };
}

export const handler = createHandler();
