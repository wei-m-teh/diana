import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { DianaStack } from "../lib/diana-stack";

for (const googleEnabled of [false, true]) {
test(`deploys protected infrastructure with Google enabled=${googleEnabled}`, () => {
  const directory = mkdtempSync(join(tmpdir(), "diana-stack-"));
  try {
    writeFileSync(join(directory, "index.html"), "<html>Diana</html>");
    const app = new App();
    const stack = new DianaStack(app, "Test", {
      webAssetPath: directory,
      ...(googleEnabled ? {
        googleClientId: "test.apps.googleusercontent.com",
        googleSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:diana/google-oauth-AbCdEf",
      } : {}),
      secretArn:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:diana/livekit-AbCdEf",
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", googleEnabled ? 1 : 0);
    const clients = Object.values(template.findResources("AWS::Cognito::UserPoolClient"));
    assert.equal(clients.length, 2);
    for (const client of clients) {
      assert.deepEqual(client.Properties.SupportedIdentityProviders,
        googleEnabled ? ["COGNITO", "Google"] : ["COGNITO"]);
      assert.deepEqual(client.Properties.AllowedOAuthFlows, ["code"]);
    }
    if (googleEnabled) {
      template.hasResourceProperties("AWS::Cognito::UserPoolIdentityProvider", {
        ProviderName: "Google", ProviderType: "Google",
        ProviderDetails: {
          client_id: "test.apps.googleusercontent.com",
          client_secret: "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-1:123456789012:secret:diana/google-oauth-AbCdEf:SecretString:client_secret::}}",
          authorize_scopes: "openid email profile",
        },
        AttributeMapping: {email: "email", name: "name"},
      });
      const providerId = Object.keys(template.findResources("AWS::Cognito::UserPoolIdentityProvider"))[0];
      for (const client of clients) assert.ok(client.DependsOn.includes(providerId));
    }
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: "s3",
        SigningBehavior: "always",
      }),
    });

    template.resourceCountIs("AWS::Lambda::Url", 0);
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain",
      Properties: Match.objectLike({
        KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
        SSESpecification: { SSEEnabled: true },
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      }),
    });
    for (const method of ["GET", "PATCH"]) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: `${method} /me`, AuthorizationType: "JWT",
        AuthorizationScopes: ["diana/sessions.create"], AuthorizerId: Match.anyValue(),
      });
    }
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /sessions", AuthorizationType: "JWT",
      AuthorizationScopes: ["diana/sessions.create"],
    });
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Principal: "apigateway.amazonaws.com", Action: "lambda:InvokeFunction",
      SourceAccount: Match.anyValue(), SourceArn: Match.anyValue(),
    });
    for (const resource of Object.values(template.findResources("AWS::Lambda::Permission")) as any[]) {
      if (resource.Properties.Principal === "*") throw new Error("Public Lambda permission");
      if (resource.Properties.Principal === "apigateway.amazonaws.com") {
        assert.ok(resource.Properties.SourceAccount);
        const source = JSON.stringify(resource.Properties.SourceArn);
        assert.equal(source.includes("*"), false);
        assert.match(source, /\$default\/(POST\/sessions|GET\/me|PATCH\/me)/);
      }
    }
    const profilePolicies = Object.entries(template.findResources("AWS::IAM::Policy"))
      .filter(([id]) => id.startsWith("ProfileFunction") || id.startsWith("TokenFunction"));
    assert.equal(profilePolicies.length, 2);
    for (const [id, policy] of profilePolicies) {
      const statements = policy.Properties.PolicyDocument.Statement;
      const database = statements.find((statement: any) => JSON.stringify(statement.Action).includes("dynamodb:"));
      assert.deepEqual(database.Action, id.startsWith("ProfileFunction")
        ? ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        : ["dynamodb:GetItem", "dynamodb:PutItem"]);
      assert.equal(JSON.stringify(database.Resource).includes("*"), false);
      const lookup = statements.find((statement: any) => statement.Action === "cognito-idp:AdminGetUser");
      assert.ok(lookup);
      assert.equal(JSON.stringify(lookup.Resource).includes("*"), false);
    }
    template.hasResourceProperties("AWS::Cognito::UserPool", { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } });
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          StopTimeout: 120,
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: "LIVEKIT_API_SECRET" }),
          ]),
          Command: ["/app/.venv/bin/python", "src/agent.py", "start"],
        }),
      ]),
    });
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 1,
      CapacityProviderStrategy: [{ CapacityProvider: "FARGATE", Weight: 1 }],
      NetworkConfiguration: Match.objectLike({
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "ENABLED" }),
      }),
    });
    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
}
test("rejects partially configured Google sign-in", () => {
  for (const settings of [
    { googleClientId: "test.apps.googleusercontent.com" },
    { googleSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test-AbCdEf" },
  ]) {
    assert.throws(() => new DianaStack(new App(), "Invalid", settings),
      /Set both GOOGLE_CLIENT_ID and GOOGLE_SECRET_ARN/);
  }
});
