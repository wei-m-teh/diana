import { locationPreference, type LocationPreference, type SavedLocation } from "../../web/lib/location";
import { validTimezone } from "../../web/lib/timezone";
import { normalizePersonality, type Personality } from "../../web/lib/personality";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

export interface UserIdentity { sub: string; username: string }
export interface UserProfile {
  userId: string;
  schemaVersion: number;
  email: string;
  emailVerified: boolean;
  displayName: string;
  preferences: { voiceKey: string; personality: Personality; timezone?: string | null; location?: LocationPreference };
  lastKnownLocation?: SavedLocation | null;
  // Stored foundation only: billing and entitlement enforcement are separate work.
  subscription: { planId: "free"; status: "active" };
  createdAt: string;
  updatedAt: string;
}
export interface ProfilePatch { displayName?: string; voiceKey?: string; personality?: Personality; timezone?: string | null; location?: LocationPreference }

function normalize(profile: UserProfile): UserProfile {
  return { ...profile, preferences: { ...profile.preferences, personality: normalizePersonality(profile.preferences?.personality), location: locationPreference(profile.preferences?.location), timezone: validTimezone(profile.preferences?.timezone) ? profile.preferences.timezone : null } };
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

async function lookupIdentity(user: UserIdentity) {
  const result = await cognito.send(new AdminGetUserCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID, Username: user.username,
  }));
  const attributes = Object.fromEntries((result.UserAttributes ?? []).map(a => [a.Name, a.Value]));
  if (attributes.sub !== user.sub) throw new Error("Cognito identity mismatch");
  return { email: attributes.email ?? "", emailVerified: attributes.email_verified === "true", displayName: attributes.name ?? "" };
}

// Dependencies are injectable so races and atomic updates can be tested without AWS.
export function createProfileStore(
  client: Pick<typeof db, "send"> = db,
  identity = lookupIdentity,
  table = () => process.env.PROFILES_TABLE,
) {
  async function read(userId: string) {
    const result = await client.send(new GetCommand({
      TableName: table(), Key: { userId }, ConsistentRead: true,
    }));
    return result.Item ? normalize(result.Item as UserProfile) : undefined;
  }
  async function ensure(user: UserIdentity): Promise<UserProfile> {
    const existing = await read(user.sub);
    if (existing) return existing;
    const attributes = await identity(user);
    const now = new Date().toISOString();
    const profile: UserProfile = {
      userId: user.sub, schemaVersion: 1, ...attributes,
      preferences: { voiceKey: "delia", personality: normalizePersonality(undefined), timezone: null, location: { mode: "off" } }, subscription: { planId: "free", status: "active" },
      createdAt: now, updatedAt: now,
    };
    try {
      await client.send(new PutCommand({
        TableName: table(), Item: profile, ConditionExpression: "attribute_not_exists(userId)",
      }));
      return profile;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
      // Another request created the record. Never reset its preferences or plan.
      const winner = await read(user.sub);
      if (!winner) throw new Error("Profile creation could not be confirmed");
      return winner;
    }
  }
  async function update(user: UserIdentity, patch: ProfilePatch): Promise<UserProfile> {
    await ensure(user);
    const names: Record<string, string> = { "#updated": "updatedAt" };
    const values: Record<string, unknown> = { ":updated": new Date().toISOString() };
    const changes = ["#updated = :updated"];
    if (patch.displayName !== undefined) {
      names["#name"] = "displayName";
      values[":name"] = patch.displayName;
      changes.push("#name = :name");
    }
    if (patch.voiceKey !== undefined) {
      names["#preferences"] = "preferences";
      names["#voice"] = "voiceKey";
      values[":voice"] = patch.voiceKey;
      changes.push("#preferences.#voice = :voice");
    }
    if (patch.personality !== undefined) {
      names["#preferences"] = "preferences";
      names["#personality"] = "personality";
      values[":personality"] = patch.personality;
      changes.push("#preferences.#personality = :personality");
    }
    if (patch.timezone !== undefined) {
      names["#preferences"] = "preferences";
      names["#timezone"] = "timezone";
      values[":timezone"] = patch.timezone;
      changes.push("#preferences.#timezone = :timezone");
    }
    if (patch.location !== undefined) {
      names["#preferences"] = "preferences";
      names["#location"] = "location";
      values[":location"] = patch.location;
      changes.push("#preferences.#location = :location");
      // Clear the previous fix when sharing is disabled or replaced by a manual city.
      if (patch.location.mode !== "device") {
        names["#last"] = "lastKnownLocation";
        values[":last"] = null;
        changes.push("#last = :last");
      }
    }
    const result = await client.send(new UpdateCommand({
      TableName: table(), Key: { userId: user.sub },
      ConditionExpression: "attribute_exists(userId)",
      UpdateExpression: `SET ${changes.join(", ")}`,
      ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    return normalize(result.Attributes as UserProfile);
  }
  async function recordLocation(user: UserIdentity, fix: SavedLocation): Promise<UserProfile> {
    try {
      const result = await client.send(new UpdateCommand({
        TableName: table(), Key: { userId: user.sub },
        // A concurrent opt-out or newer fix must win over this in-flight request.
        ConditionExpression: "#prefs.#location.#mode = :device AND (attribute_not_exists(#last.#captured) OR #last.#captured <= :captured)",
        UpdateExpression: "SET #last = :fix",
        ExpressionAttributeNames: { "#prefs": "preferences", "#location": "location", "#mode": "mode", "#last": "lastKnownLocation", "#captured": "capturedAt" },
        ExpressionAttributeValues: { ":device": "device", ":captured": fix.capturedAt, ":fix": fix },
        ReturnValues: "ALL_NEW",
      }));
      return normalize(result.Attributes as UserProfile);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
      return ensure(user);
    }
  }
  return { ensure, update, recordLocation };
}

export const profileStore = createProfileStore();
