import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { authenticatedUser } from "./auth";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const types: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt", "md"],
  "text/markdown": ["md"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
  "video/mp4": ["mp4"],
  "video/webm": ["webm"],
  "video/quicktime": ["mov"],
};
export function validateUpload(value: unknown) {
  const v = value as { name?: unknown; type?: unknown; size?: unknown };
  if (
    !v ||
    typeof v.name !== "string" ||
    !v.name.trim() ||
    v.name.length > 150 ||
    /[\\/\x00-\x1f]/.test(v.name) ||
    typeof v.type !== "string" ||
    !types[v.type]?.includes(v.name.split(".").pop()!.toLowerCase()) ||
    !Number.isSafeInteger(v.size) ||
    Number(v.size) < 1 ||
    Number(v.size) > (v.type.startsWith("video/") ? 60 : 20) * 1024 * 1024
  )
    throw new Error("invalid_upload");
  return { name: v.name, type: v.type, size: Number(v.size) };
}
export const uploadKey = (room: string, id: string) => `uploads/${room}/${id}`;
export async function registerAttachmentSession(room: string, owner: string) {
  if (!process.env.ATTACHMENTS_TABLE) return; // Local development without upload infrastructure.
  await db.send(
    new PutCommand({
      TableName: process.env.ATTACHMENTS_TABLE,
      Item: {
        room,
        id: "SESSION",
        owner,
        count: 0,
        expires: Math.floor(Date.now() / 1000) + 86400,
      },
    }),
  );
}
export const uploadDependencies = {
  reserve: async (room: string, owner: string) => {
    await db.send(
      new UpdateCommand({
        TableName: process.env.ATTACHMENTS_TABLE,
        Key: { room, id: "SESSION" },
        UpdateExpression: "ADD #count :one",
        ConditionExpression:
          "#owner = :owner AND #expires > :now AND #count < :max",
        ExpressionAttributeNames: {
          "#count": "count",
          "#owner": "owner",
          "#expires": "expires",
        },
        ExpressionAttributeValues: {
          ":one": 1,
          ":owner": owner,
          ":now": Math.floor(Date.now() / 1000),
          ":max": 10,
        },
      }),
    );
  },
  record: async (item: Record<string, unknown>) => {
    await db.send(
      new PutCommand({ TableName: process.env.ATTACHMENTS_TABLE, Item: item }),
    );
  },
  sign: async (key: string, type: string, size: number) =>
    createPresignedPost(s3, {
      Bucket: process.env.ATTACHMENTS_BUCKET!,
      Key: key,
      Expires: 300,
      Fields: { "Content-Type": type },
      Conditions: [
        ["content-length-range", size, size],
        ["eq", "$Content-Type", type],
      ],
    }),
};
export function createUploadHandler(deps = uploadDependencies) {
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
      event.requestContext.http.method !== "POST" ||
      event.rawPath !== "/attachments"
    )
      return reply(404, { error: "not_found" });
    let file;
    let room;
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64").toString()
        : (event.body ?? "");
      if (raw.length > 4096) throw new Error();
      const value = JSON.parse(raw);
      file = validateUpload(value);
      room = value.room;
      if (typeof room !== "string" || !/^diana_[a-f0-9-]{36}$/.test(room))
        throw new Error();
    } catch {
      return reply(400, { error: "invalid_upload" });
    }
    try {
      await deps.reserve(room, user.sub);
    } catch {
      return reply(403, { error: "session_unavailable_or_upload_limit" });
    }
    try {
      const id = randomUUID();
      const key = uploadKey(room, id);
      const upload = await deps.sign(key, file.type, file.size);
      await deps.record({
        room,
        id,
        key,
        ...file,
        expires: Math.floor(Date.now() / 1000) + 86400,
      });
      return reply(200, { id, ...upload });
    } catch {
      return reply(503, { error: "upload_unavailable" });
    }
  };
}
export const handler = createUploadHandler();
