import assert from "node:assert/strict";
import { test } from "node:test";
import { createMediaHandler } from "../lambda/media";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
process.env.COGNITO_ISSUER = "https://issuer.test";
process.env.COGNITO_CLIENT_IDS = "web";
process.env.COGNITO_WEB_CLIENT_ID = "web";
const room = "diana_12345678-1234-1234-1234-123456789abc";
const id = "12345678-1234-1234-1234-123456789abc";
function event() {
  return {
    rawPath: "/media",
    body: JSON.stringify({ room, id }),
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
          },
        },
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}
test("does not sign media belonging to another user or expired sessions", async () => {
  for (const session of [
    { owner: "other", expires: Date.now() / 1000 + 60 },
    { owner: "owner", expires: 0 },
  ]) {
    const handler = createMediaHandler({
      get: async (_r, id) => (id === "SESSION" ? session : undefined),
      sign: async () => {
        throw Error("must not sign");
      },
    });
    assert.equal((await handler(event())).statusCode, 403);
  }
});
test("signs only the owned room asset and rejects injected keys", async () => {
  let key = `generated/${room}/${id}.docx`;
  const handler = createMediaHandler({
    get: async (_r, x) =>
      x === "SESSION"
        ? { owner: "owner", expires: Date.now() / 1000 + 60 }
        : {
            key,
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            expires: Date.now() / 1000 + 60,
          },
    sign: async (k) => ({
      url: "https://signed.test/" + k,
      downloadUrl: "https://signed.test/download",
    }),
  });
  assert.equal((await handler(event())).statusCode, 200);
  key = "generated/victim/other.docx";
  assert.equal((await handler(event())).statusCode, 404);
});
