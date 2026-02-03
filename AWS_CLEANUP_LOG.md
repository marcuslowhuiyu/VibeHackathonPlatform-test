# AWS Resource Management Log

**Date:** 2026-02-03
**Project:** VibeHackathonPlatform

---

## Current Active Project Resources (ap-southeast-1)

| Resource | Name/ID | Details |
|----------|---------|---------|
| ECS Cluster | vibe-cluster | Running |
| ECS Service | vibe-dashboard-service | Running in vibe-cluster |
| ALB | vibe-dashboard-alb | DNS: vibe-dashboard-alb-473495601.ap-southeast-1.elb.amazonaws.com |
| CloudFront | E1I7CB5MN58V5E | URL: https://d3ubsvjdhuk97c.cloudfront.net |
| ECR | vibe-dashboard | Docker images for dashboard |
| ECR | vibe-coding-lab | Docker images for coding lab |
| EFS | fs-050cb07335b0afa08 | Persistent storage |
| IAM User | github-actions-deploy | For GitHub Actions CI/CD |

---

## Deployment URLs

### Production (Active)
- **CloudFront (HTTPS):** https://d3ubsvjdhuk97c.cloudfront.net
- **ALB (HTTP):** http://vibe-dashboard-alb-473495601.ap-southeast-1.elb.amazonaws.com

---

## Deleted Resources (2026-02-03)

### us-east-1 (Migrated to ap-southeast-1)
- ECS Cluster: vibe-cluster
- ECS Service: vibe-dashboard-service
- ALB: vibe-dashboard-alb
- Target Group: vibe-dashboard-tg
- EFS: fs-08af9a5b5fb9e7db7

### ap-southeast-1 (Staging Removed)
- ECS Service: vibe-dashboard-staging
- ECS Service: vibe-dashboard
- ALB: vibe-dashboard-alb (old one)
- Target Groups: vibe-dashboard-staging-tg, vibe-dashboard-tg (old ones)
- CloudFront: E1C31H0P83QP2V (d2gjoxlutncseu.cloudfront.net)

---

## Kept Resources (Minimal Cost)

### ECR Repositories (ap-southeast-1)
- hackathon-workspace
- hackathon-model-gateway
- hackathon-router
- vibe-coding-lab
- vibe-dashboard

### ECR Repository (us-east-1)
- vibe-dashboard (old images)
- vibe-coding-lab (old images)
- vibecodetest (old test repo)

### S3 Buckets
- hackathon-frontend-902707424595
- stackset-enableawsconfigstackset-* (AWS Config - do not delete)

### Security Groups (ap-southeast-1) - FREE
- vibe-alb-sg
- vibe-ecs-sg
- vibe-efs-sg

### Disabled CloudFront Distributions
| Distribution ID | Domain | Notes |
|-----------------|--------|-------|
| E3HQ4ST4JAN65G | d9mpzg9a5t2ho.cloudfront.net | Old hackathon |
| E2QM3VOD5I32LB | dottpwzd61kzz.cloudfront.net | Old hackathon |
| E3L840TDOA0LAH | d2y80y9rmw1bt9.cloudfront.net | Old hackathon |

---

## GitHub Actions Secrets (Active)

| Secret | Purpose |
|--------|---------|
| AWS_ACCESS_KEY_ID | IAM user: github-actions-deploy |
| AWS_SECRET_ACCESS_KEY | IAM user: github-actions-deploy |

---

## Migration Notes (2026-02-03)

Migrated production from us-east-1 to ap-southeast-1 for better latency for Singapore/Asia users.

**Changes:**
- Production now runs in ap-southeast-1 (Singapore)
- CloudFront still serves globally, now points to ap-southeast-1 ALB
- Staging environment removed (was not needed)
- GitHub Actions workflow updated to deploy to ap-southeast-1
