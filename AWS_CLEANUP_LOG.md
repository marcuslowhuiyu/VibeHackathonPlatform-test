# AWS Resource Management Log

**Date:** 2026-02-02
**Project:** VibeHackathonPlatform

---

## Current Active Project Resources (us-east-1)

| Resource | Name/ID | Details |
|----------|---------|---------|
| ECS Cluster | vibe-cluster | Running |
| ECS Service | vibe-dashboard-service | Running in vibe-cluster |
| ALB | vibe-dashboard-alb | DNS: vibe-dashboard-alb-221523168.us-east-1.elb.amazonaws.com |
| CloudFront | E1I7CB5MN58V5E | URL: https://d3ubsvjdhuk97c.cloudfront.net |
| ECR | vibe-dashboard | Docker images for dashboard |
| ECR | vibe-coding-lab | Docker images for coding lab |
| EFS | fs-08af9a5b5fb9e7db7 | Persistent storage |
| IAM User | github-actions-deploy | For GitHub Actions CI/CD |

---

## Paused/Disabled Resources (2026-02-02)

### ECS Services (ap-southeast-1) - PAUSED (scaled to 0)

| Service | Cluster | Previous Count |
|---------|---------|----------------|
| hackathon-model-gateway-service | hackathon-cluster | 1 |
| hackathon-router | hackathon-cluster | 1 |

**To resume:**
```bash
aws ecs update-service --cluster hackathon-cluster --service hackathon-model-gateway-service --desired-count 1 --region ap-southeast-1
aws ecs update-service --cluster hackathon-cluster --service hackathon-router --desired-count 1 --region ap-southeast-1
```

### CloudFront Distributions - DISABLED

| Distribution ID | Domain | Original Origin |
|-----------------|--------|-----------------|
| E3HQ4ST4JAN65G | d9mpzg9a5t2ho.cloudfront.net | hackathon-alb-v2 (deleted) |
| E2QM3VOD5I32LB | dottpwzd61kzz.cloudfront.net | hackathon-alb-v2 (deleted) |
| E3L840TDOA0LAH | d2y80y9rmw1bt9.cloudfront.net | 3-238-195-28.nip.io |

**To re-enable (after recreating ALB):**
```bash
# Get current config
aws cloudfront get-distribution-config --id <DISTRIBUTION_ID> --query "DistributionConfig" > cf-config.json
# Edit cf-config.json: set "Enabled": true
# Get ETag
ETAG=$(aws cloudfront get-distribution-config --id <DISTRIBUTION_ID> --query "ETag" --output text)
# Update
aws cloudfront update-distribution --id <DISTRIBUTION_ID> --if-match $ETAG --distribution-config file://cf-config.json
```

---

## Deleted Resources (2026-02-02)

### ALB (ap-southeast-1)
- **Name:** hackathon-alb-v2
- **ARN:** arn:aws:elasticloadbalancing:ap-southeast-1:902707424595:loadbalancer/app/hackathon-alb-v2/4e3449c230753331
- **DNS:** hackathon-alb-v2-836120258.ap-southeast-1.elb.amazonaws.com

### Target Groups (ap-southeast-1)
- hackathon-model-gateway-tg-v2
- hackathon-router-tg

### ECS Cluster (ap-southeast-1)
- vibe-cluster (was empty)

---

## Kept Resources (Minimal Cost)

### ECR Repositories (ap-southeast-1)
- hackathon-workspace
- hackathon-model-gateway
- hackathon-router
- vibe-coding-lab

### ECR Repository (us-east-1)
- vibecodetest (old test repo)

### S3 Buckets
- hackathon-frontend-902707424595
- stackset-enableawsconfigstackset-* (AWS Config - do not delete)

### Security Groups (ap-southeast-1) - FREE
- hackathon-alb-sg (x2)
- hackathon-model-gateway-sg (x2)
- vibe-ecs-sg
- vibe-coding-access

---

## Cost Savings Summary

| Resource Type | Monthly Savings |
|---------------|-----------------|
| ECS Fargate (2 services paused) | ~$20-40 |
| ALB (deleted) | ~$16 |
| CloudFront (3 disabled) | ~$3-15 |
| **Total Estimated Savings** | **~$35-55/mo** |

---

## To Fully Resume Hackathon Project

1. **Recreate ALB:**
```bash
# Create ALB
aws elbv2 create-load-balancer --name hackathon-alb-v2 --subnets <subnet-ids> --security-groups <sg-ids> --region ap-southeast-1

# Create target groups
aws elbv2 create-target-group --name hackathon-model-gateway-tg-v2 --protocol HTTP --port 80 --vpc-id <vpc-id> --target-type ip --region ap-southeast-1
aws elbv2 create-target-group --name hackathon-router-tg --protocol HTTP --port 80 --vpc-id <vpc-id> --target-type ip --region ap-southeast-1

# Create listeners and rules
```

2. **Scale up ECS services** (see commands above)

3. **Update CloudFront origins** to point to new ALB DNS

4. **Re-enable CloudFront distributions**

---

## GitHub Actions Secrets (Active)

| Secret | Purpose |
|--------|---------|
| AWS_ACCESS_KEY_ID | IAM user: github-actions-deploy |
| AWS_SECRET_ACCESS_KEY | IAM user: github-actions-deploy |

---

## Deployment URLs

### Production (Active)
- **ALB:** http://vibe-dashboard-alb-221523168.us-east-1.elb.amazonaws.com
- **CloudFront:** https://d3ubsvjdhuk97c.cloudfront.net (deploying)

### Staging (Planned)
- Not yet implemented
- Plan file: ~/.claude/plans/cozy-leaping-tarjan.md
