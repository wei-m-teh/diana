import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CfnOutput,
  CfnParameter,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  Tags,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as assets from "aws-cdk-lib/aws-ecr-assets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as deployment from "aws-cdk-lib/aws-s3-deployment";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export interface DianaStackProps extends StackProps {
  secretArn?: string;
  googleClientId?: string;
  googleSecretArn?: string;
  desiredCount?: number;
  cpu?: number;
  memoryMiB?: number;
  webAssetPath?: string;
}

export class DianaStack extends Stack {
  constructor(scope: Construct, id: string, props: DianaStackProps = {}) {
    super(scope, id, props);
    // Required project cost allocation tag, inherited by all taggable children.
    Tags.of(this).add("application", "conversation-agent");
    if (Boolean(props.googleClientId) !== Boolean(props.googleSecretArn)) {
      throw new Error("Set both GOOGLE_CLIENT_ID and GOOGLE_SECRET_ARN to enable Google sign-in");
    }
    const root = join(__dirname, "../..");
    const webAssetPath = props.webAssetPath ?? join(root, "web/out");
    if (!existsSync(join(webAssetPath, "index.html"))) {
      throw new Error("Build the static UI first: cd web && pnpm build:static");
    }
    const secretArn =
      props.secretArn ??
      new CfnParameter(this, "LiveKitSecretArn", {
        type: "String",
        noEcho: true,
        description:
          "Complete ARN of a JSON Secrets Manager secret containing LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET",
        allowedPattern: "arn:[^:]+:secretsmanager:[^:]+:[0-9]{12}:secret:.+",
      }).valueAsString;
    const secret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "LiveKitCredentials",
      secretArn,
    );

    const bucket = new s3.Bucket(this, "Website", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // The small UI and runtime config must update together on each deployment.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
      },
      additionalBehaviors: {
        "_next/static/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy:
            cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          compress: true,
        },
      },
    });
    const websiteUrl = `https://${distribution.distributionDomainName}`;

    const userPool = new cognito.UserPool(this, "Users", {
      userPoolName: "Diana",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // Google users can join on first sign-in. No email/domain allowlist is applied.
    // Local email/password self-registration remains disabled.
    let google: cognito.UserPoolIdentityProviderGoogle | undefined;
    if (props.googleClientId && props.googleSecretArn) {
      const googleSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this, "GoogleOAuthSecret", props.googleSecretArn,
      );
      google = new cognito.UserPoolIdentityProviderGoogle(this, "Google", {
        userPool,
        clientId: props.googleClientId,
        clientSecretValue: googleSecret.secretValueFromJson("client_secret"),
        scopes: ["openid", "email", "profile"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          fullname: cognito.ProviderAttribute.GOOGLE_NAME,
        },
      });
    }
    const sessionScope = new cognito.ResourceServerScope({ scopeName: "sessions.create", scopeDescription: "Start a Diana conversation" });
    const resourceServer = userPool.addResourceServer("SessionScopes", { identifier: "diana", scopes: [sessionScope] });
    const domain = userPool.addDomain("LoginDomain", {
      cognitoDomain: { domainPrefix: `diana-${this.account}-${this.region}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const sessionScopeName = "diana/sessions.create";
    const issuer = `https://cognito-idp.${this.region}.${this.urlSuffix}/${userPool.userPoolId}`;
    const createClient = (id: string, callback: string, logout: string) => {
      const client = userPool.addClient(id, {
        generateSecret: false,
        preventUserExistenceErrors: true,
        supportedIdentityProviders: [
          cognito.UserPoolClientIdentityProvider.COGNITO,
          ...(google ? [cognito.UserPoolClientIdentityProvider.GOOGLE] : []),
        ],
        authFlows: { userSrp: true },
        accessTokenValidity: Duration.minutes(15),
        idTokenValidity: Duration.minutes(15),
        refreshTokenValidity: Duration.days(7),
        enableTokenRevocation: true,
        oAuth: {
          flows: { authorizationCodeGrant: true },
          scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.resourceServer(resourceServer, sessionScope)],
          callbackUrls: [callback], logoutUrls: [logout],
        },
      });
      // Cognito must create the provider before updating either app client.
      if (google) client.node.addDependency(google);
      const branding = new cognito.CfnManagedLoginBranding(this, `${id}Branding`, {
        userPoolId: userPool.userPoolId, clientId: client.userPoolClientId, useCognitoProvidedValues: true,
      });
      branding.node.addDependency(domain);
      return client;
    };
    const webClient = createClient("WebClient", `${websiteUrl}/`, `${websiteUrl}/`);
    const mobileCallback = "com.diana.app:/oauth2redirect";
    const mobileLogout = "com.diana.app:/signout";
    const mobileClient = createClient("MobileClient", mobileCallback, mobileLogout);

    const profiles = new dynamodb.Table(this, "Profiles", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const profileEnvironment = {
      PROFILES_TABLE: profiles.tableName, COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_ISSUER: issuer,
      COGNITO_CLIENT_IDS: `${webClient.userPoolClientId},${mobileClient.userPoolClientId}`,
      SESSION_SCOPE: sessionScopeName,
    };
    const profileFunction = new nodejs.NodejsFunction(this, "ProfileFunction", {
      entry: join(root, "infra/lambda/profile.ts"),
      depsLockFilePath: join(root, "infra/package-lock.json"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256, timeout: Duration.seconds(10),
      logGroup: new logs.LogGroup(this, "ProfileLogs", { retention: logs.RetentionDays.ONE_MONTH }),
      environment: profileEnvironment,
      bundling: { minify: true, sourceMap: true, externalModules: [] },
    });
    profiles.grant(profileFunction, "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem");
    const tokenLogs = new logs.LogGroup(this, "TokenLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const tokenFunction = new nodejs.NodejsFunction(this, "TokenFunction", {
      entry: join(root, "infra/lambda/token.ts"),
      depsLockFilePath: join(root, "infra/package-lock.json"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup: tokenLogs,
      environment: { LIVEKIT_SECRET_ARN: secret.secretArn, ...profileEnvironment },
      bundling: { minify: true, sourceMap: true, externalModules: [] },
    });
    secret.grantRead(tokenFunction);
    profiles.grant(tokenFunction, "dynamodb:GetItem", "dynamodb:PutItem");
    for (const fn of [tokenFunction, profileFunction]) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["cognito-idp:AdminGetUser"], resources: [userPool.userPoolArn],
      }));
    }
    const api = new apigateway.CfnApi(this, "SessionApi", {
      name: "Diana sessions", protocolType: "HTTP",
      corsConfiguration: { allowOrigins: [websiteUrl], allowMethods: ["POST", "GET", "PATCH"], allowHeaders: ["authorization", "content-type"], maxAge: 3600 },
    });
    const authorizer = new apigateway.CfnAuthorizer(this, "SessionAuthorizer", {
      apiId: api.ref, name: "Cognito", authorizerType: "JWT",
      identitySource: ["$request.header.Authorization"],
      jwtConfiguration: { issuer, audience: [webClient.userPoolClientId, mobileClient.userPoolClientId] },
    });
    const integration = new apigateway.CfnIntegration(this, "SessionIntegration", {
      apiId: api.ref, integrationType: "AWS_PROXY", integrationUri: tokenFunction.functionArn,
      payloadFormatVersion: "2.0", timeoutInMillis: 15000,
    });
    const route = new apigateway.CfnRoute(this, "SessionRoute", {
      apiId: api.ref, routeKey: "POST /sessions", authorizationType: "JWT",
      authorizerId: authorizer.ref, authorizationScopes: [sessionScopeName], target: `integrations/${integration.ref}`,
    });
    const accessLogs = new logs.LogGroup(this, "ApiLogs", { retention: logs.RetentionDays.ONE_MONTH });
    const stage = new apigateway.CfnStage(this, "SessionStage", {
      apiId: api.ref, stageName: "$default", autoDeploy: true,
      defaultRouteSettings: { throttlingBurstLimit: 10, throttlingRateLimit: 5 },
      accessLogSettings: { destinationArn: accessLogs.logGroupArn, format: JSON.stringify({ requestId: "$context.requestId", route: "$context.routeKey", status: "$context.status" }) },
    });
    stage.node.addDependency(route);
    const profileIntegration = new apigateway.CfnIntegration(this, "ProfileIntegration", {
      apiId: api.ref, integrationType: "AWS_PROXY", integrationUri: profileFunction.functionArn,
      payloadFormatVersion: "2.0", timeoutInMillis: 15000,
    });
    for (const method of ["GET", "PATCH"]) {
      const profileRoute = new apigateway.CfnRoute(this, `Profile${method}Route`, {
        apiId: api.ref, routeKey: `${method} /me`, authorizationType: "JWT",
        authorizerId: authorizer.ref, authorizationScopes: [sessionScopeName],
        target: `integrations/${profileIntegration.ref}`,
      });
      stage.node.addDependency(profileRoute);
      new lambda.CfnPermission(this, `ApiInvokeProfile${method}`, {
        functionName: profileFunction.functionArn, action: "lambda:InvokeFunction",
        principal: "apigateway.amazonaws.com", sourceAccount: this.account,
        sourceArn: `arn:${this.partition}:execute-api:${this.region}:${this.account}:${api.ref}/$default/${method}/me`,
      });
    }
    new lambda.CfnPermission(this, "ApiInvokeToken", {
      functionName: tokenFunction.functionArn, action: "lambda:InvokeFunction",
      principal: "apigateway.amazonaws.com", sourceAccount: this.account,
      sourceArn: `arn:${this.partition}:execute-api:${this.region}:${this.account}:${api.ref}/$default/POST/sessions`,
    });
    const tokenEndpoint = `${api.attrApiEndpoint}/sessions`;
    new deployment.BucketDeployment(this, "PublishWebsite", {
      destinationBucket: bucket,
      sources: [
        deployment.Source.asset(webAssetPath),
        deployment.Source.jsonData("config.json", {
          tokenEndpoint,
          cognitoIssuer: issuer, cognitoDomain: domain.baseUrl(), cognitoClientId: webClient.userPoolClientId,
          cognitoScope: sessionScopeName, redirectUri: `${websiteUrl}/`,
        }),
      ],
      distribution,
      distributionPaths: ["/*"],
      // Keep old hashed chunks available for browsers with a previous page open.
      prune: false,
      memoryLimit: 512,
    });

    // Public IP provides outbound access without a NAT gateway. No inbound rules.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "Agent", subnetType: ec2.SubnetType.PUBLIC },
      ],
    });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const task = new ecs.FargateTaskDefinition(this, "AgentTask", {
      cpu: props.cpu ?? 2048,
      memoryLimitMiB: props.memoryMiB ?? 4096,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const agentLogs = new logs.LogGroup(this, "AgentLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
    });
    task.addContainer("Diana", {
      image: ecs.ContainerImage.fromAsset(join(root, "agent"), {
        platform: assets.Platform.LINUX_AMD64,
      }),
      // Run Python directly so SIGTERM reaches the worker (instead of an uv parent).
      command: ["/app/.venv/bin/python", "src/agent.py", "start"],
      environment: { PYTHONUNBUFFERED: "1" },
      secrets: {
        LIVEKIT_URL: ecs.Secret.fromSecretsManager(secret, "LIVEKIT_URL"),
        LIVEKIT_API_KEY: ecs.Secret.fromSecretsManager(
          secret,
          "LIVEKIT_API_KEY",
        ),
        LIVEKIT_API_SECRET: ecs.Secret.fromSecretsManager(
          secret,
          "LIVEKIT_API_SECRET",
        ),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "diana",
        logGroup: agentLogs,
      }),
      stopTimeout: Duration.seconds(120),
      healthCheck: {
        command: [
          "CMD",
          "/app/.venv/bin/python",
          "-c",
          "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/', timeout=5)",
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
        retries: 3,
        startPeriod: Duration.seconds(120),
      },
    });
    const securityGroup = new ec2.SecurityGroup(this, "AgentSecurityGroup", {
      vpc,
      allowAllOutbound: true,
    });
    const service = new ecs.FargateService(this, "AgentService", {
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      cluster,
      taskDefinition: task,
      desiredCount: props.desiredCount ?? 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [securityGroup],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      // Fixed on-demand capacity; avoid automatic scale-in interrupting conversations.
      capacityProviderStrategies: [{ capacityProvider: "FARGATE", weight: 1 }],
    });
    // Private test-build distribution via short-lived S3 presigned URLs.
    const mobileDownloads = new s3.Bucket(this, "MobileDownloads", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [{ expiration: Duration.days(1), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    new CfnOutput(this, "MobileDownloadsBucket", { value: mobileDownloads.bucketName });
    new CfnOutput(this, "WebsiteUrl", { value: websiteUrl });
    new CfnOutput(this, "TokenEndpoint", { value: tokenEndpoint });
    new CfnOutput(this, "ProfileEndpoint", { value: `${api.attrApiEndpoint}/me` });
    new CfnOutput(this, "ProfilesTableName", { value: profiles.tableName });
    new CfnOutput(this, "CognitoUserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "CognitoIssuer", { value: issuer });
    new CfnOutput(this, "CognitoDomain", { value: domain.baseUrl() });
    new CfnOutput(this, "CognitoWebClientId", { value: webClient.userPoolClientId });
    new CfnOutput(this, "CognitoMobileClientId", { value: mobileClient.userPoolClientId });
    new CfnOutput(this, "CognitoScope", { value: sessionScopeName });
    new CfnOutput(this, "MobileCallback", { value: mobileCallback });
    new CfnOutput(this, "MobileLogout", { value: mobileLogout });
    new CfnOutput(this, "WebsiteBucket", { value: bucket.bucketName });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "AgentServiceName", { value: service.serviceName });
    new CfnOutput(this, "AgentLogGroup", { value: agentLogs.logGroupName });
    new CfnOutput(this, "TokenLogGroup", { value: tokenLogs.logGroupName });
  }
}
