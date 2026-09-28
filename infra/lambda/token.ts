import { parseLocationFix, locationPreference, type LocationFix } from "../../web/lib/location";
import { lookupCity, sessionLocation } from "./location";
import { resolveTimezone, validTimezone } from "../../web/lib/timezone";
import { normalizePersonality } from "../../web/lib/personality";
import { authenticatedUser } from "./auth";
import { profileStore, type UserIdentity, type UserProfile } from "./profile-store";
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
export function createHandler(loadCredentials = credentials, ensureProfile: (user: UserIdentity) => Promise<UserProfile | void> = profileStore.ensure, saveLocation = profileStore.recordLocation, geocode = lookupCity) {
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
    let deviceTimezone: string | undefined;
    let deviceLocation: LocationFix | null = null;
    if (event.body) {
      try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
        if (Buffer.byteLength(raw) > 4096) throw new Error("body too large");
        const value = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid body");
        if (value.deviceLocation != null) {
          deviceLocation = parseLocationFix(value.deviceLocation);
          if (!deviceLocation) throw new Error("invalid location");
        }
        if (value?.deviceTimezone != null) {
          if (!validTimezone(value.deviceTimezone)) throw new Error("invalid timezone");
          deviceTimezone = value.deviceTimezone;
        }
      } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid_session_context" }) }; }
    }
    try {
      let profile = await ensureProfile(user);
      let freshLocation;
      if (deviceLocation && locationPreference(profile?.preferences.location).mode === "device") {
        const fix = { ...deviceLocation, city: await geocode(deviceLocation) };
        profile = await saveLocation(user, fix);
        freshLocation = fix;
      }
      const isWeb = !!process.env.COGNITO_WEB_CLIENT_ID && event.requestContext.authorizer.jwt.claims.client_id === process.env.COGNITO_WEB_CLIENT_ID;
      // Server-owned profile snapshot; request bodies cannot supply agent instructions.

      const config = await loadCredentials();
      const roomName = `diana_${randomUUID()}`;
      const participantIdentity = `user_${user.sub}_${randomUUID()}`;
      const metadata = JSON.stringify({
        participantIdentity,
        location: sessionLocation(profile, freshLocation),
        timezone: resolveTimezone(profile?.preferences.timezone, deviceTimezone),
        ...(isWeb ? { vision: true, personality: { version: 1, traits: normalizePersonality(profile?.preferences.personality) } } : {}),
      });
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
        agents: [new RoomAgentDispatch({ agentName: "diana", metadata })],
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
