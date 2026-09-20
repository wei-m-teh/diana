import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

// Trust only claims verified by API Gateway, whose invoke permission is route scoped.
export function authenticatedUser(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const clients = (process.env.COGNITO_CLIENT_IDS ?? "").split(",").filter(Boolean);
  const requiredScope = process.env.SESSION_SCOPE ?? "diana/sessions.create";
  if (!claims || typeof claims.sub !== "string" || !claims.sub ||
    claims.token_use !== "access" || !process.env.COGNITO_ISSUER ||
    claims.iss !== process.env.COGNITO_ISSUER ||
    typeof claims.client_id !== "string" || !clients.includes(claims.client_id) ||
    Number(claims.exp) <= Date.now() / 1000 || !Number.isFinite(Number(claims.exp)) ||
    typeof claims.scope !== "string" || !claims.scope.split(" ").includes(requiredScope)) {
    return undefined;
  }
  return { sub: claims.sub, username: typeof claims.username === "string" ? claims.username : claims.sub };
}
