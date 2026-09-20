import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { createHandler } from "../lambda/token";

const credentials = {
  LIVEKIT_URL: "wss://test.livekit.cloud",
  LIVEKIT_API_KEY: "test-key",
  LIVEKIT_API_SECRET: "test-secret-at-least-thirty-two-characters",
};
process.env.COGNITO_ISSUER = "https://issuer.test";
process.env.COGNITO_CLIENT_IDS = "web-client,mobile-client";
const handler = createHandler(async () => credentials, async () => undefined);
function event(
  method = "POST",
  path = "/sessions",
  body?: string,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    rawPath: path,
    body,
    requestContext: { http: { method }, authorizer: { jwt: { claims: { sub: "test-user", token_use: "access", iss: "https://issuer.test", client_id: "web-client", exp: Math.floor(Date.now()/1000)+900, scope: "diana/sessions.create" }, scopes: ["diana/sessions.create"] } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

test("issues a signed, short-lived room-scoped token and dispatches only Diana", async () => {
  const response = await handler(
    event(
      "POST",
      "/sessions",
      JSON.stringify({
        roomName: "victim",
        room_config: { agents: [{ agent_name: "other" }] },
      }),
    ),
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.["Cache-Control"], "no-store");
  const result = JSON.parse(response.body!);
  const [head, body, signature] = result.participantToken.split(".");
  assert.equal(
    signature,
    createHmac("sha256", credentials.LIVEKIT_API_SECRET)
      .update(`${head}.${body}`)
      .digest("base64url"),
  );
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  assert.equal(claims.iss, credentials.LIVEKIT_API_KEY);
  assert.match(claims.sub, /^user_test-user_/);
  assert.match(result.roomName, /^diana_/);
  assert.equal(claims.video.room, result.roomName);
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.roomAdmin, undefined);
  assert.ok(claims.exp - claims.nbf <= 300);
  assert.equal(claims.roomConfig.agents[0].agentName, "diana");
  assert.equal(result.serverUrl, credentials.LIVEKIT_URL);
  const second = JSON.parse((await handler(event())).body!);
  assert.notEqual(second.roomName, result.roomName);
});

test("rejects unsupported methods and paths without reading credentials", async () => {
  const rejectRead = createHandler(async () => {
    throw new Error("must not load");
  });
  assert.equal((await rejectRead(event("GET"))).statusCode, 405);
  assert.equal((await rejectRead(event("POST", "/unknown"))).statusCode, 404);
});

test("does not expose credentials or internal errors on failure", async () => {
  const fail = createHandler(async () => {
    throw new Error("private-secret");
  }, async () => undefined);
  const response = await fail(event());
  assert.equal(response.statusCode, 503);
  assert.equal(response.body?.includes("private-secret"), false);
});

test("rejects missing, expired, wrong-client, wrong-issuer and unscoped authorization before reading secrets", async () => {
  const guard = createHandler(async () => { throw new Error("must not read"); });
  for (const patch of [{sub:""}, {token_use:"id"}, {iss:"wrong"}, {client_id:"wrong"}, {exp:0}, {scope:"openid"}]) {
    const request = event();
    Object.assign(request.requestContext.authorizer.jwt.claims, patch);
    assert.equal((await guard(request)).statusCode,403);
  }
  const request=event();
  delete (request.requestContext as any).authorizer;
  assert.equal((await guard(request)).statusCode,403);
});
