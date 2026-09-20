import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { authenticatedUser } from "./auth";
import { profileStore, type ProfilePatch } from "./profile-store";
import { VOICES } from "../../web/lib/voices";

function parsePatch(event: APIGatewayProxyEventV2WithJWTAuthorizer): ProfilePatch {
  const contentType = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === "content-type")?.[1];
  if (contentType?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("invalid body");
  const body = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : event.body ?? "";
  if (Buffer.byteLength(body) > 4096) throw new Error("invalid body");
  const value = JSON.parse(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid body");
  const keys = Object.keys(value);
  if (!keys.length || keys.some(key => !["displayName", "voiceKey"].includes(key))) throw new Error("invalid fields");
  const patch: ProfilePatch = {};
  if (Object.hasOwn(value, "displayName")) {
    if (typeof value.displayName !== "string" || value.displayName.length > 100 || /[\u0000-\u001f\u007f]/u.test(value.displayName)) throw new Error("invalid name");
    patch.displayName = value.displayName.trim();
  }
  if (Object.hasOwn(value, "voiceKey")) {
    if (typeof value.voiceKey !== "string" || !VOICES.some(voice => voice.key === value.voiceKey)) throw new Error("invalid voice");
    patch.voiceKey = value.voiceKey;
  }
  return patch;
}

export function createProfileHandler(store = profileStore) {
  return async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    const reply = (statusCode: number, body: unknown) => ({ statusCode, headers, body: JSON.stringify(body) });
    if (event.rawPath !== "/me") return reply(404, { error: "not_found" });
    const method = event.requestContext.http.method;
    if (!["GET", "PATCH"].includes(method)) return { ...reply(405, { error: "method_not_allowed" }), headers: { ...headers, Allow: "GET, PATCH" } };
    const user = authenticatedUser(event);
    if (!user) return reply(403, { error: "not_authorized" });
    let patch: ProfilePatch | undefined;
    if (method === "PATCH") {
      try { patch = parsePatch(event); }
      catch { return reply(400, { error: "invalid_profile_update", message: "Provide displayName (up to 100 characters) and/or a valid voiceKey." }); }
    }
    try {
      return reply(200, patch ? await store.update(user, patch) : await store.ensure(user));
    } catch {
      console.error("Unable to access user profile");
      return reply(503, { error: "profile_unavailable" });
    }
  };
}

export const handler = createProfileHandler();
