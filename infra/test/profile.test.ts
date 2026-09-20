import assert from "node:assert/strict";
import { test } from "node:test";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createProfileStore, type UserProfile } from "../lambda/profile-store";
import { createProfileHandler } from "../lambda/profile";
import { createHandler as createTokenHandler } from "../lambda/token";

process.env.COGNITO_ISSUER = "https://issuer.test";
process.env.COGNITO_CLIENT_IDS = "web-client,mobile-client";
const user = { sub: "user-a", username: "Google_123" };
const identity = { email: "person@example.com", emailVerified: true, displayName: "Person" };
function event(method = "GET", body?: unknown, sub = user.sub) {
  return {
    rawPath: "/me", headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method }, authorizer: { jwt: { claims: {
      sub, username: "Google_123", token_use: "access", iss: "https://issuer.test",
      client_id: "web-client", exp: Date.now() / 1000 + 900, scope: "openid diana/sessions.create",
    } } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

// Models conditional creates and named attribute updates, including concurrent calls.
function fixture() {
  const records = new Map<string, UserProfile>();
  const commands: any[] = [];
  let lookups = 0;
  const client = { send: async (command: any) => {
    commands.push(command);
    const input = command.input;
    assert.equal(input.TableName, "profiles");
    if (command instanceof GetCommand) {
      assert.equal(input.ConsistentRead, true);
      return { Item: structuredClone(records.get(input.Key.userId)) };
    }
    if (command instanceof PutCommand) {
      assert.equal(input.ConditionExpression, "attribute_not_exists(userId)");
      if (records.has(input.Item.userId)) throw Object.assign(new Error("collision"), { name: "ConditionalCheckFailedException" });
      records.set(input.Item.userId, structuredClone(input.Item));
      return {};
    }
    assert.ok(command instanceof UpdateCommand);
    assert.equal(input.ConditionExpression, "attribute_exists(userId)");
    assert.equal(input.ReturnValues, "ALL_NEW");
    const record = records.get(input.Key.userId)!;
    const names = input.ExpressionAttributeNames;
    const values = input.ExpressionAttributeValues;
    for (const expression of input.UpdateExpression.slice(4).split(", ")) {
      const [path, value] = expression.split(" = ");
      const keys = path.split(".").map((key: string) => names[key]);
      let target: any = record;
      for (const key of keys.slice(0, -1)) target = target[key];
      target[keys.at(-1)] = values[value];
    }
    return { Attributes: structuredClone(record) };
  } };
  const store = createProfileStore(client as any, async () => { lookups++; return identity; }, () => "profiles");
  return { store, handler: createProfileHandler(store), records, commands, lookups: () => lookups };
}

test("first access creates trusted defaults and subsequent logins preserve changes", async () => {
  const f = fixture();
  const first = JSON.parse((await f.handler(event())).body);
  assert.equal(first.userId, user.sub);
  assert.equal(first.email, identity.email);
  assert.equal(first.emailVerified, true);
  assert.equal(first.displayName, identity.displayName);
  assert.deepEqual(first.preferences, { voiceKey: "delia" });
  assert.deepEqual(first.subscription, { planId: "free", status: "active" });
  assert.ok(Date.parse(first.createdAt));
  await f.handler(event("PATCH", { displayName: "  Custom  ", voiceKey: "thalia" }));
  const restored = JSON.parse((await f.handler(event())).body);
  assert.equal(restored.displayName, "Custom");
  assert.equal(restored.preferences.voiceKey, "thalia");
  assert.equal(restored.createdAt, first.createdAt);
  assert.deepEqual(restored.subscription, first.subscription);
  assert.equal(f.lookups(), 1);
});

test("concurrent first requests create one record without overwriting a winner", async () => {
  const f = fixture();
  const [first, second] = await Promise.all([f.store.ensure(user), f.store.ensure(user)]);
  assert.equal(f.records.size, 1);
  assert.deepEqual(first, second);
  assert.equal(f.commands.filter(command => command instanceof PutCommand).length, 2);
  await Promise.all([f.store.update(user, { displayName: "New name" }), f.store.update(user, { voiceKey: "apollo" })]);
  const result = await f.store.ensure(user);
  assert.equal(result.displayName, "New name");
  assert.equal(result.preferences.voiceKey, "apollo");
});

test("uses only verified subject; records remain separate even for the same email", async () => {
  const f = fixture();
  await f.handler(event("PATCH", { displayName: "A" }));
  const second = event("PATCH", { displayName: "B" }, "user-b");
  second.queryStringParameters = { userId: "user-a" };
  second.requestContext.authorizer.jwt.claims.client_id = "mobile-client";
  assert.equal((await f.handler(second)).statusCode, 200);
  assert.equal(f.records.get("user-a")!.displayName, "A");
  assert.equal(f.records.get("user-b")!.displayName, "B");
  assert.equal((await f.handler(event())).headers["Cache-Control"], "no-store");
});

test("rejects privilege changes and invalid input before accessing storage", async () => {
  const f = fixture();
  for (const body of [null, [], {}, {userId:"victim"}, {email:"spoof@example.com"},
    {subscription:{planId:"pro"}}, {preferences:{voiceKey:"thalia"}}, {displayName:12},
    {displayName:"a".repeat(101)}, {displayName:"a\nb"}, {voiceKey:"missing"}, {voiceKey:null}]) {
    assert.equal((await f.handler(event("PATCH", body))).statusCode, 400);
  }
  const malformed = event("PATCH"); malformed.body = "{";
  assert.equal((await f.handler(malformed)).statusCode, 400);
  const wrongType = event("PATCH", {displayName:"Hi"}); wrongType.headers = {};
  assert.equal((await f.handler(wrongType)).statusCode, 400);
  const oversized = event("PATCH"); oversized.body = " ".repeat(4097);
  assert.equal((await f.handler(oversized)).statusCode, 400);
  assert.equal(f.commands.length, 0);
});

test("rejects missing or invalid authorization before accessing storage", async () => {
  const f = fixture();
  for (const patch of [{sub:""}, {token_use:"id"}, {iss:"wrong"}, {client_id:"wrong"}, {exp:0}, {exp:"bad"}, {scope:"openid"}]) {
    const request = event(); Object.assign(request.requestContext.authorizer.jwt.claims, patch);
    assert.equal((await f.handler(request)).statusCode, 403);
  }
  const request = event(); delete (request.requestContext as any).authorizer;
  assert.equal((await f.handler(request)).statusCode, 403);
  assert.equal(f.commands.length, 0);
});

test("supports encoded JSON, rejects unknown routes and hides provider failures", async () => {
  const f = fixture();
  const request = event("PATCH"); request.isBase64Encoded = true;
  request.body = Buffer.from(JSON.stringify({displayName:""})).toString("base64");
  assert.equal((await f.handler(request)).statusCode, 200);
  assert.equal(f.records.get(user.sub)!.displayName, "");
  assert.equal((await f.handler(event("DELETE"))).statusCode, 405);
  request.rawPath = "/users/victim";
  assert.equal((await f.handler(request)).statusCode, 404);
  const fail = async (): Promise<UserProfile> => { throw new Error("private details"); };
  const result = await createProfileHandler({ensure:fail, update:fail})(event());
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.includes("private details"), false);
});

test("existing session clients provision profiles before issuing room tokens", async () => {
  const f = fixture();
  const handler = createTokenHandler(async () => ({LIVEKIT_URL:"wss://test.livekit.cloud", LIVEKIT_API_KEY:"test", LIVEKIT_API_SECRET:"test-secret-at-least-thirty-two-characters"}), f.store.ensure);
  const request = event("POST"); request.rawPath = "/sessions";
  assert.equal((await handler(request)).statusCode, 200);
  assert.equal(f.records.get(user.sub)!.preferences.voiceKey, "delia");
  let secretsRead = false;
  const fail = createTokenHandler(async () => { secretsRead = true; throw new Error("unexpected"); }, async () => { throw new Error("storage failure"); });
  assert.equal((await fail(request)).statusCode, 503);
  assert.equal(secretsRead, false);
});
