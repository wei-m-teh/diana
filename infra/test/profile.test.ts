import { DEFAULT_PERSONALITY } from "../../web/lib/personality";
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
    if (input.UpdateExpression === "SET #last = :fix") {
      const record = records.get(input.Key.userId)!;
      assert.match(input.ConditionExpression, /#prefs.#location.#mode = :device/);
      assert.match(input.ConditionExpression, /#last.#captured <= :captured/);
      if (record.preferences.location?.mode !== 'device' || (record.lastKnownLocation && record.lastKnownLocation.capturedAt > input.ExpressionAttributeValues[':captured'])) {
        throw Object.assign(new Error('conflict'), {name:'ConditionalCheckFailedException'});
      }
      record.lastKnownLocation = input.ExpressionAttributeValues[':fix'];
      return {Attributes:structuredClone(record)};
    }
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
  assert.deepEqual(first.preferences, { voiceKey: "delia", personality: DEFAULT_PERSONALITY, timezone: null, location: {mode:"off"} });
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

test("personality is validated, saved independently, and normalized for legacy profiles", async () => {
  const f = fixture();
  await f.store.ensure(user);
  delete (f.records.get(user.sub)!.preferences as any).personality;
  assert.deepEqual((await f.store.ensure(user)).preferences.personality, DEFAULT_PERSONALITY);
  const personality = { ...DEFAULT_PERSONALITY, openness: 0, extraversion: 100 };
  const saved = await f.handler(event("PATCH", { personality }));
  assert.equal(saved.statusCode, 200);
  await f.store.update(user, { voiceKey: "thalia" });
  assert.deepEqual((await f.store.ensure(user)).preferences, { voiceKey: "thalia", personality, timezone: null, location: {mode:"off"} });
  assert.deepEqual((await f.store.ensure({ ...user, sub: "user-b" })).preferences.personality, DEFAULT_PERSONALITY);
  for (const invalid of [null, [], {}, { ...personality, extra: 1 }, ...[-1, 101, true, "50", 1.5].map(openness => ({ ...personality, openness }))]) {
    assert.equal((await f.handler(event("PATCH", { personality: invalid }))).statusCode, 400);
  }
  assert.deepEqual((await f.store.ensure(user)).preferences.personality, personality);
});

test("signed dispatch uses saved personality only for verified web clients", async () => {
  process.env.COGNITO_WEB_CLIENT_ID = "web-client";
  const f = fixture();
  const personality = { ...DEFAULT_PERSONALITY, openness: 100 };
  await f.store.update(user, { personality });
  const handler = createTokenHandler(async () => ({ LIVEKIT_URL: "wss://test.livekit.cloud", LIVEKIT_API_KEY: "test", LIVEKIT_API_SECRET: "test-secret-at-least-thirty-two-characters" }), f.store.ensure);
  const request = event("POST", { personality: { openness: 0 }, metadata: "malicious", client_id: "web-client" });
  request.rawPath = "/sessions";
  const dispatch = async () => {
    const response = await handler(request);
    assert.equal(response.statusCode, 200);
    const jwt = JSON.parse(response.body as string).participantToken;
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).roomConfig.agents[0];
  };
  const webMetadata = JSON.parse((await dispatch()).metadata);
  assert.equal(webMetadata.vision, true);
  assert.deepEqual(webMetadata.personality, { version: 1, traits: personality });
  assert.deepEqual(webMetadata.timezone, { mode: "device", name: null });
  assert.match(webMetadata.participantIdentity, /^user_user-a_/);
  request.requestContext.authorizer.jwt.claims.client_id = "mobile-client";
  const mobileMetadata = JSON.parse((await dispatch()).metadata);
  assert.equal(mobileMetadata.personality, undefined);
  assert.equal(mobileMetadata.vision, undefined);
  assert.deepEqual(mobileMetadata.timezone, { mode: "device", name: null });
  delete process.env.COGNITO_WEB_CLIENT_ID;
});


test("timezone preference is shared, nullable and validated", async () => {
  const f = fixture();
  assert.equal((await f.handler(event("PATCH", { timezone: "America/New_York" }))).statusCode, 200);
  const mobile = event();
  mobile.requestContext.authorizer.jwt.claims.client_id = "mobile-client";
  assert.equal(JSON.parse((await f.handler(mobile)).body).preferences.timezone, "America/New_York");
  assert.equal((await f.handler(event("PATCH", { timezone: "inject instructions" }))).statusCode, 400);
  const restored = await f.handler(event("PATCH", { timezone: null }));
  assert.equal(JSON.parse(restored.body).preferences.timezone, null);
});


test("location is opt-in, persists across sessions, and cannot be restored after opting out", async () => {
  const f = fixture();
  await f.store.update(user, {location:{mode:'device'}});
  const fix = {latitude:47.61,longitude:-122.33,accuracyMeters:1000,capturedAt:new Date().toISOString(),city:'Seattle, Washington, USA'};
  await f.store.recordLocation(user, fix);
  assert.deepEqual((await f.store.ensure(user)).lastKnownLocation, fix);
  const older = {...fix,capturedAt:'2020-01-01T00:00:00.000Z',city:'Old city'};
  assert.deepEqual((await f.store.recordLocation(user,older)).lastKnownLocation,fix);
  await f.handler(event('PATCH',{location:{mode:'off'}}));
  assert.equal((await f.store.recordLocation(user,fix)).lastKnownLocation,null);
  assert.equal((await f.store.ensure({...user,sub:'different-user'})).lastKnownLocation,undefined);
  assert.equal((await f.handler(event('PATCH',{location:{mode:'manual',city:'Paris, France'}}))).statusCode,200);
  assert.equal((await f.store.ensure(user)).lastKnownLocation,null);
  for (const value of [{mode:'unknown'},{mode:'manual',city:''},{mode:'device',latitude:0}]) {
    assert.equal((await f.handler(event('PATCH',{location:value}))).statusCode,400);
  }
});

test("web and mobile sessions refresh location; failed fixes use dated history; body cannot enable sharing", async () => {
  const f = fixture();
  let geocodes = 0;
  const handler = createTokenHandler(async () => ({LIVEKIT_URL:'wss://test.livekit.cloud',LIVEKIT_API_KEY:'test',LIVEKIT_API_SECRET:'test-secret-at-least-thirty-two-characters'}),f.store.ensure,f.store.recordLocation, async () => { geocodes++; return 'Seattle, Washington, USA'; });
  const fix = {latitude:47.60621,longitude:-122.33207,accuracyMeters:20,capturedAt:new Date().toISOString()};
  const dispatch = async (body:any, client='web-client') => {
    const request = event('POST',body); request.rawPath='/sessions';
    request.requestContext.authorizer.jwt.claims.client_id=client;
    const response=await handler(request); assert.equal(response.statusCode,200);
    const jwt=JSON.parse(response.body as string).participantToken;
    return JSON.parse(JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString()).roomConfig.agents[0].metadata).location;
  };
  assert.deepEqual(await dispatch({deviceLocation:fix,location:{mode:'device'}}),{source:'unavailable'});
  assert.equal(geocodes,0);
  await f.store.update(user,{location:{mode:'device'}});
  const fresh=await dispatch({deviceLocation:fix});
  assert.equal(fresh.source,'device'); assert.equal(fresh.latitude,47.61);
  assert.equal((await dispatch({},'mobile-client')).source,'last_known');
  assert.equal((await dispatch({deviceLocation:fix},'mobile-client')).source,'device');
  await f.store.update(user,{location:{mode:'manual',city:'Paris, France'}});
  assert.deepEqual(await dispatch({deviceLocation:fix}),{source:'manual',city:'Paris, France'});
  assert.equal(geocodes,2);
  const bad=event('POST',{deviceLocation:{...fix,latitude:999}}); bad.rawPath='/sessions';
  assert.equal((await handler(bad)).statusCode,400);
});
