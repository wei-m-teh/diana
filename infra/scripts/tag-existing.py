#!/usr/bin/env python3
"""Reconcile project tags outside CloudFormation; never reads secret values."""
import json
import subprocess
from pathlib import Path

TAG = {"Key": "application", "Value": "conversation-agent"}
REGION = "us-east-1"
OUTPUTS = json.loads((Path(__file__).resolve().parents[1] / "outputs.json").read_text())["Diana"]


def aws(service, operation, *args, region=REGION):
    result = subprocess.run(
        ["aws", service, operation, *args, "--region", region, "--output", "json"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout) if result.stdout.strip() else {}


def verify(tags, label):
    mapping = tags if isinstance(tags, dict) else {t.get("Key", t.get("key")): t.get("Value", t.get("value")) for t in tags}
    if mapping.get(TAG["Key"]) != TAG["Value"]:
        raise RuntimeError("Tag verification failed: " + label)
    print("Verified:", label)


# These secrets are imported by CDK rather than owned by the stack.
for secret in aws("secretsmanager", "list-secrets")["SecretList"]:
    if not secret["Name"].startswith("diana/"):
        continue
    aws("secretsmanager", "tag-resource", "--secret-id", secret["ARN"], "--tags", json.dumps([TAG]))
    verify(aws("secretsmanager", "describe-secret", "--secret-id", secret["ARN"]).get("Tags", []), secret["Name"])

# Propagation covers new tasks; tag existing running tasks without restarting calls.
cluster = OUTPUTS["ClusterName"]
for arn in aws("ecs", "list-tasks", "--cluster", cluster, "--service-name", OUTPUTS["AgentServiceName"])["taskArns"]:
    aws("ecs", "tag-resource", "--resource-arn", arn, "--tags", json.dumps([{"key": TAG["Key"], "value": TAG["Value"]}]))
    verify(aws("ecs", "list-tags-for-resource", "--resource-arn", arn).get("tags", []), arn)

# Lambda can create these log groups outside CloudFormation on first invocation.
for group in aws("logs", "describe-log-groups", "--log-group-name-prefix", "/aws/lambda/Diana-")["logGroups"]:
    arn = group["arn"].removesuffix(":*")
    aws("logs", "tag-resource", "--resource-arn", arn, "--tags", json.dumps({TAG["Key"]: TAG["Value"]}))
    verify(aws("logs", "list-tags-for-resource", "--resource-arn", arn).get("tags", {}), group["logGroupName"])

# Only Diana's project; other Device Farm projects belong to other applications.
for project in aws("devicefarm", "list-projects", region="us-west-2")["projects"]:
    if project["name"] != "Diana mobile":
        continue
    arn = project["arn"]
    aws("devicefarm", "tag-resource", "--resource-arn", arn, "--tags", json.dumps([TAG]), region="us-west-2")
    verify(aws("devicefarm", "list-tags-for-resource", "--resource-arn", arn, region="us-west-2").get("Tags", []), project["name"])

# Tag default VPC resources and current task ENIs that EC2 creates outside CDK.
for vpc in aws("ec2", "describe-vpcs", "--filters", "Name=tag:aws:cloudformation:stack-name,Values=Diana")["Vpcs"]:
    for operation, collection, key in [
        ("describe-security-groups", "SecurityGroups", "GroupId"),
        ("describe-route-tables", "RouteTables", "RouteTableId"),
        ("describe-network-acls", "NetworkAcls", "NetworkAclId"),
        ("describe-network-interfaces", "NetworkInterfaces", "NetworkInterfaceId"),
    ]:
        for resource in aws("ec2", operation, "--filters", "Name=vpc-id,Values=" + vpc["VpcId"])[collection]:
            resource_id = resource[key]
            aws("ec2", "create-tags", "--resources", resource_id, "--tags", json.dumps([TAG]))
            verify(aws("ec2", "describe-tags", "--filters", "Name=resource-id,Values=" + resource_id)["Tags"], resource_id)
