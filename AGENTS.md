# Diana infrastructure

All AWS resources dedicated to this project must carry the cost allocation tag
`application=conversation-agent`. Preserve the stack-wide CDK tag and ECS service
tag propagation. Tag resources created outside the stack explicitly, including
project secrets and Device Farm resources. Do not label shared infrastructure as
exclusively belonging to Diana; document shared-cost allocation separately.
