import assert from "node:assert/strict";
import { test } from "node:test";
import { validateUpload, uploadKey } from "../lambda/attachments";
test("accepts supported uploads and generates server-owned keys", () => {
  assert.equal(
    validateUpload({ name: "photo.jpg", size: 100, type: "image/jpeg" }).type,
    "image/jpeg",
  );
  assert.equal(uploadKey("diana_abc", "123"), "uploads/diana_abc/123");
});
test("rejects oversized, disguised, executable and empty uploads", () => {
  for (const value of [
    { name: "x.jpg", size: 0, type: "image/jpeg" },
    { name: "x.jpg", size: 21 * 1024 * 1024, type: "image/jpeg" },
    { name: "x.html", size: 10, type: "text/html" },
    { name: "x.exe", size: 10, type: "image/jpeg" },
    { name: "x.mp4", size: 61 * 1024 * 1024, type: "video/mp4" },
    { name: "../x.txt", size: 10, type: "text/plain" },
  ])
    assert.throws(() => validateUpload(value));
});

import { createUploadHandler } from "../lambda/attachments";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
process.env.COGNITO_ISSUER = "https://issuer.test";
process.env.COGNITO_CLIENT_IDS = "web,mobile";
process.env.COGNITO_WEB_CLIENT_ID = "web";
function event(patch = {}) {
  return {
    rawPath: "/attachments",
    body: JSON.stringify({
      room: "diana_12345678-1234-1234-1234-123456789abc",
      name: "x.png",
      size: 100,
      type: "image/png",
    }),
    requestContext: {
      http: { method: "POST" },
      authorizer: {
        jwt: {
          claims: {
            sub: "owner",
            token_use: "access",
            iss: "https://issuer.test",
            client_id: "web",
            exp: Date.now() / 1000 + 60,
            scope: "diana/sessions.create",
            ...patch,
          },
        },
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}
test("authorization failures never sign uploads", async () => {
  const handler = createUploadHandler({
    reserve: async () => {
      throw Error("wrong owner");
    },
    record: async () => {
      throw Error("must not record");
    },
    sign: async () => {
      throw Error("must not sign");
    },
  });
  assert.equal((await handler(event())).statusCode, 403);
  for (const patch of [
    { sub: "" },
    { client_id: "mobile" },
    { exp: 0 },
    { iss: "other" },
    { scope: "" },
  ])
    assert.equal((await handler(event(patch))).statusCode, 403);
});
test("reserves against authenticated owner and returns only scoped upload fields", async () => {
  let reserved = false;
  let record: any;
  const handler = createUploadHandler({
    reserve: async (room, owner) => {
      assert.equal(owner, "owner");
      assert.match(room, /^diana_/);
      reserved = true;
    },
    record: async (item) => {
      record = item;
    },
    sign: async (key, type, size) => {
      assert.ok(reserved);
      assert.equal(type, "image/png");
      assert.equal(size, 100);
      return { url: "https://private-bucket", fields: { key } };
    },
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.fields.key, `uploads/${record.room}/${body.id}`);
  assert.equal(record.size, 100);
  assert.ok(record.expires > Date.now() / 1000);
});
