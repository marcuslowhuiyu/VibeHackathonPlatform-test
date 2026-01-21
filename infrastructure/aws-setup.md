# AWS Infrastructure Setup Guide

This guide walks you through setting up the AWS infrastructure needed to run multiple Vibe Coding Lab instances.

## Prerequisites

- AWS CLI installed and configured
- AWS account with admin access
- Docker installed (for pushing images)

## Step 1: Create ECR Repository

```bash
# Create the container registry
aws ecr create-repository \
    --repository-name vibe-coding-lab \
    --region us-east-1

# Get your account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Your AWS Account ID: $AWS_ACCOUNT_ID"
```

## Step 2: Push Docker Image to ECR

```bash
# Authenticate Docker with ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Tag your image
docker tag vibe-coding-lab:latest $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/vibe-coding-lab:latest

# Push to ECR
docker push $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/vibe-coding-lab:latest
```

## Step 3: Create IAM Roles

### 3a. ECS Task Execution Role

```bash
# Create the trust policy file
cat > ecs-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the role
aws iam create-role \
    --role-name ecsTaskExecutionRole \
    --assume-role-policy-document file://ecs-trust-policy.json

# Attach the managed policy
aws iam attach-role-policy \
    --role-name ecsTaskExecutionRole \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### 3b. ECS Task Role (for Bedrock access)

```bash
# Create Bedrock access policy
cat > bedrock-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-*"
      ]
    }
  ]
}
EOF

# Create the task role
aws iam create-role \
    --role-name vibeTaskRole \
    --assume-role-policy-document file://ecs-trust-policy.json

# Create and attach the Bedrock policy
aws iam put-role-policy \
    --role-name vibeTaskRole \
    --policy-name BedrockAccess \
    --policy-document file://bedrock-policy.json
```

## Step 4: Create VPC and Networking

For simplicity, use the default VPC. Get your subnet IDs:

```bash
# Get default VPC ID
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)
echo "VPC ID: $VPC_ID"

# Get subnet IDs (need at least 2 for ALB)
aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$VPC_ID" \
    --query "Subnets[*].[SubnetId,AvailabilityZone]" \
    --output table
```

## Step 5: Create Security Groups

```bash
# Security group for ALB
aws ec2 create-security-group \
    --group-name vibe-alb-sg \
    --description "Security group for Vibe ALB" \
    --vpc-id $VPC_ID

ALB_SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=vibe-alb-sg" --query "SecurityGroups[0].GroupId" --output text)

# Allow HTTP/HTTPS inbound to ALB
aws ec2 authorize-security-group-ingress \
    --group-id $ALB_SG_ID \
    --protocol tcp \
    --port 80 \
    --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
    --group-id $ALB_SG_ID \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0

# Security group for ECS tasks
aws ec2 create-security-group \
    --group-name vibe-ecs-sg \
    --description "Security group for Vibe ECS tasks" \
    --vpc-id $VPC_ID

ECS_SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=vibe-ecs-sg" --query "SecurityGroups[0].GroupId" --output text)

# Allow traffic from ALB to ECS on ports 8080 and 3000
aws ec2 authorize-security-group-ingress \
    --group-id $ECS_SG_ID \
    --protocol tcp \
    --port 8080 \
    --source-group $ALB_SG_ID

aws ec2 authorize-security-group-ingress \
    --group-id $ECS_SG_ID \
    --protocol tcp \
    --port 3000 \
    --source-group $ALB_SG_ID

echo "ALB Security Group: $ALB_SG_ID"
echo "ECS Security Group: $ECS_SG_ID"
```

## Step 6: Create ECS Cluster

```bash
aws ecs create-cluster \
    --cluster-name vibe-cluster \
    --capacity-providers FARGATE FARGATE_SPOT \
    --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1
```

## Step 7: Create Application Load Balancer

```bash
# Get two subnet IDs (from Step 4 output)
SUBNET_1="subnet-xxxxxxxx"  # Replace with your subnet ID
SUBNET_2="subnet-yyyyyyyy"  # Replace with your subnet ID

# Create the ALB
aws elbv2 create-load-balancer \
    --name vibe-alb \
    --subnets $SUBNET_1 $SUBNET_2 \
    --security-groups $ALB_SG_ID \
    --scheme internet-facing \
    --type application

# Get ALB ARN
ALB_ARN=$(aws elbv2 describe-load-balancers --names vibe-alb --query "LoadBalancers[0].LoadBalancerArn" --output text)

# Create default target group (required for listener)
aws elbv2 create-target-group \
    --name vibe-default-tg \
    --protocol HTTP \
    --port 8080 \
    --vpc-id $VPC_ID \
    --target-type ip \
    --health-check-path /

DEFAULT_TG_ARN=$(aws elbv2 describe-target-groups --names vibe-default-tg --query "TargetGroups[0].TargetGroupArn" --output text)

# Create HTTP listener
aws elbv2 create-listener \
    --load-balancer-arn $ALB_ARN \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=forward,TargetGroupArn=$DEFAULT_TG_ARN
```

## Step 8: Register ECS Task Definition

```bash
# Get your account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create task definition
cat > task-definition.json << EOF
{
  "family": "vibe-coding-lab",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "executionRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/vibeTaskRole",
  "containerDefinitions": [
    {
      "name": "vibe-container",
      "image": "${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com/vibe-coding-lab:latest",
      "essential": true,
      "portMappings": [
        {"containerPort": 8080, "protocol": "tcp"},
        {"containerPort": 3000, "protocol": "tcp"}
      ],
      "environment": [
        {"name": "AWS_REGION", "value": "us-east-1"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/vibe-coding-lab",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "vibe",
          "awslogs-create-group": "true"
        }
      }
    }
  ]
}
EOF

# Register the task definition
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

## Outputs to Save

After completing setup, save these values for the dashboard configuration:

```bash
echo "=== Save these values ==="
echo "AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID"
echo "VPC_ID=$VPC_ID"
echo "SUBNET_1=$SUBNET_1"
echo "SUBNET_2=$SUBNET_2"
echo "ALB_SG_ID=$ALB_SG_ID"
echo "ECS_SG_ID=$ECS_SG_ID"
echo "ALB_ARN=$ALB_ARN"
echo "DEFAULT_TG_ARN=$DEFAULT_TG_ARN"
```

## Estimated Costs

| Component | Monthly Cost (Estimate) |
|-----------|------------------------|
| ALB | ~$20 |
| Fargate (per instance-hour) | ~$0.10 |
| ECR storage | ~$1 |
| Data transfer | Variable |

Example: 10 instances running 8 hours/day for 22 days = $176/month for compute.

## Cleanup

To delete all resources:

```bash
# Delete ECS cluster (after stopping all tasks)
aws ecs delete-cluster --cluster vibe-cluster

# Delete ALB
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN

# Delete target groups
aws elbv2 delete-target-group --target-group-arn $DEFAULT_TG_ARN

# Delete security groups
aws ec2 delete-security-group --group-id $ALB_SG_ID
aws ec2 delete-security-group --group-id $ECS_SG_ID

# Delete IAM roles
aws iam delete-role-policy --role-name vibeTaskRole --policy-name BedrockAccess
aws iam delete-role --role-name vibeTaskRole
aws iam detach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam delete-role --role-name ecsTaskExecutionRole

# Delete ECR repository
aws ecr delete-repository --repository-name vibe-coding-lab --force
```
