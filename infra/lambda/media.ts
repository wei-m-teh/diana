import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { authenticatedUser } from "./auth";
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const dependencies = {
  get: async (
    room: string,
    id: string,
  ): Promise<Record<string, any> | undefined> =>
    (
      await db.send(
        new GetCommand({
          TableName: process.env.ATTACHMENTS_TABLE,
          Key: { room, id },
          ConsistentRead: true,
        }),
      )
    ).Item,
  sign: async (key: string, mime: string) => {
    const base = {
      Bucket: process.env.ATTACHMENTS_BUCKET!,
      Key: key,
      ResponseContentType: mime,
    };
    const extension = key.split(".").pop();
    const filename = ["docx", "pdf", "png", "mp4", "txt"].includes(
      extension ?? "",
    )
      ? "diana." + extension
      : "diana-file";
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ ...base, ResponseContentDisposition: "inline" }),
      { expiresIn: 900 },
    );
    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        ...base,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn: 900 },
    );
    return { url, downloadUrl };
  },
};
const allowed = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export function createMediaHandler(deps = dependencies) {
  return async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
    const reply = (statusCode: number, body: unknown) => ({
      statusCode,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(body),
    });
    const user = authenticatedUser(event);
    if (
      !user ||
      event.requestContext.authorizer.jwt.claims.client_id !==
        process.env.COGNITO_WEB_CLIENT_ID
    )
      return reply(403, { error: "not_authorized" });
    if (
      event.rawPath !== "/media" ||
      event.requestContext.http.method !== "POST"
    )
      return reply(404, { error: "not_found" });
    let room;
    let id;
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64").toString()
        : (event.body ?? "");
      if (raw.length > 1024) throw Error();
      ({ room, id } = JSON.parse(raw));
      if (
        typeof room !== "string" ||
        !/^diana_[a-f0-9-]{36}$/.test(room) ||
        typeof id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(id)
      )
        throw Error();
    } catch {
      return reply(400, { error: "invalid_request" });
    }
    try {
      const session = await deps.get(room, "SESSION");
      if (
        !session ||
        session.owner !== user.sub ||
        !(session.expires > Date.now() / 1000)
      )
        return reply(403, { error: "session_expired" });
      const item = await deps.get(room, id);
      const generated = new RegExp(
        `^generated/${room}/${id}\\.(png|mp4|docx)$`,
      );
      if (
        !item ||
        !(item.expires > Date.now() / 1000) ||
        !allowed.has(item.type) ||
        (item.key !== `uploads/${room}/${id}` && !generated.test(item.key))
      )
        return reply(404, { error: "media_unavailable" });
      return reply(200, {
        ...(await deps.sign(item.key, item.type)),
        type: item.type,
        expiresAt: Date.now() + 900000,
      });
    } catch {
      return reply(503, { error: "media_unavailable" });
    }
  };
}
export const handler = createMediaHandler();
