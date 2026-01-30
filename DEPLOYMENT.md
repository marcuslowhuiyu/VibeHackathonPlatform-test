# Vibe Dashboard Deployment Guide

This guide covers deploying the Vibe Dashboard to AWS so your team can access it.

## URLs After Deployment

Once deployed, you'll have two separate entry points:

| Portal | URL | Purpose |
|--------|-----|---------|
| **Participant Portal** | `http://<your-ip>:3001/portal` | Participants login with email + password to see their instance |
| **Admin Dashboard** | `http://<your-ip>:3001/admin` | Admins manage instances, participants, and AWS setup |

---

## Option 1: EC2 Instance (Recommended - Simplest)

### Step 1: Launch an EC2 Instance

```bash
# Using AWS CLI
aws ec2 run-instances \
  --image-id ami-0c7217cdde317cfec \
  --instance-type t3.small \
  --key-name your-key-pair \
  --security-group-ids sg-xxxxxxxx \
  --subnet-id subnet-xxxxxxxx \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=vibe-dashboard}]'
```

Or via AWS Console:
1. Go to EC2 → Launch Instance
2. Select **Amazon Linux 2023** or **Ubuntu 22.04**
3. Instance type: **t3.small** (or t3.micro for testing)
4. Configure security group to allow:
   - Port 22 (SSH)
   - Port 3001 (Dashboard)
   - Port 80 (optional, for redirect)
5. Launch and note the public IP

### Step 2: Connect and Install Dependencies

```bash
# SSH into your instance
ssh -i your-key.pem ec2-user@<public-ip>

# For Amazon Linux 2023
sudo yum update -y
sudo yum install -y git

# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Verify installation
node --version  # Should show v20.x.x
npm --version
```

For Ubuntu:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Step 3: Clone and Build

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/VibeHackathonPlatform.git
cd VibeHackathonPlatform/dashboard

# Install dependencies
npm install
cd client && npm install && npm run build && cd ..
```

### Step 4: Run the Server

**Quick start (foreground):**
```bash
NODE_ENV=production PORT=3001 npx tsx server/index.ts
```

**Production (background with PM2):**
```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the dashboard
NODE_ENV=production PORT=3001 pm2 start "npx tsx server/index.ts" --name vibe-dashboard

# Auto-start on reboot
pm2 startup
pm2 save

# View logs
pm2 logs vibe-dashboard
```

### Step 5: Access Your Dashboard

- **Participant Portal:** `http://<ec2-public-ip>:3001/portal`
- **Admin Dashboard:** `http://<ec2-public-ip>:3001/admin`
- Default admin password: `admin` (change this immediately in Settings!)

---

## Option 2: ECS Fargate (Container-based)

### Prerequisites
- Docker installed locally
- AWS CLI configured
- ECS cluster already exists (from the Vibe Setup)

### Step 1: Build and Push Docker Image

```bash
cd dashboard

# Set variables
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=us-east-1
ECR_REPO=vibe-dashboard

# Create ECR repository
aws ecr create-repository --repository-name $ECR_REPO --region $AWS_REGION 2>/dev/null || true

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build and push
docker build -t $ECR_REPO .
docker tag $ECR_REPO:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest

echo "Image pushed: $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:latest"
```

### Step 2: Create Task Definition

Save this as `task-definition.json`:

```json
{
  "family": "vibe-dashboard",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "vibe-dashboard",
      "image": "YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/vibe-dashboard:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3001,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "3001"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/vibe-dashboard",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs",
          "awslogs-create-group": "true"
        }
      }
    }
  ]
}
```

Register it:
```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

### Step 3: Create ECS Service

```bash
# Get your VPC and subnet info
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=vibe-vpc" --query 'Vpcs[0].VpcId' --output text)
SUBNETS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[*].SubnetId' --output text | tr '\t' ',')

# Create security group for dashboard
SG_ID=$(aws ec2 create-security-group \
  --group-name vibe-dashboard-sg \
  --description "Vibe Dashboard" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 3001 --cidr 0.0.0.0/0

# Create the service
aws ecs create-service \
  --cluster vibe-cluster \
  --service-name vibe-dashboard \
  --task-definition vibe-dashboard \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG_ID],assignPublicIp=ENABLED}"
```

### Step 4: Get Public IP

```bash
# Wait for task to start, then get IP
TASK_ARN=$(aws ecs list-tasks --cluster vibe-cluster --service-name vibe-dashboard --query 'taskArns[0]' --output text)
ENI_ID=$(aws ecs describe-tasks --cluster vibe-cluster --tasks $TASK_ARN --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' --output text)
PUBLIC_IP=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI_ID --query 'NetworkInterfaces[0].Association.PublicIp' --output text)

echo "Dashboard URL: http://$PUBLIC_IP:3001"
echo "Participant Portal: http://$PUBLIC_IP:3001/portal"
echo "Admin Dashboard: http://$PUBLIC_IP:3001/admin"
```

---

## Option 3: GitHub Actions Auto-Deploy

If you want automatic deployment on every push, the workflow is already set up in `.github/workflows/deploy-dashboard.yml`.

### Setup Required:

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**

2. Add these secrets:
   | Secret | Value |
   |--------|-------|
   | `AWS_ACCESS_KEY_ID` | Your AWS access key |
   | `AWS_SECRET_ACCESS_KEY` | Your AWS secret key |

3. Push to main branch - deployment runs automatically!

---

## Adding HTTPS (Optional)

### Option A: CloudFront (Recommended for Production)

```bash
# Create CloudFront distribution pointing to your EC2/ECS
aws cloudfront create-distribution \
  --origin-domain-name <your-ec2-ip> \
  --default-root-object index.html
```

### Option B: Let's Encrypt with Nginx (EC2 only)

```bash
# Install Nginx and Certbot
sudo yum install -y nginx certbot python3-certbot-nginx

# Configure Nginx as reverse proxy
sudo tee /etc/nginx/conf.d/vibe.conf << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com
```

---

## Separate Domains for Admin/Participant (Advanced)

If you want completely separate URLs like:
- `admin.yourdomain.com` → Admin Dashboard
- `portal.yourdomain.com` → Participant Portal

### Using CloudFront + Route 53:

1. Create two CloudFront distributions pointing to same origin
2. Configure behaviors:
   - `admin.*` redirects to `/#/login`
   - `portal.*` redirects to `/#/portal`
3. Add Route 53 records for both subdomains

### Using Nginx:

```nginx
# admin.yourdomain.com
server {
    listen 80;
    server_name admin.yourdomain.com;
    location / {
        proxy_pass http://localhost:3001;
        # Redirect root to admin login
        if ($uri = /) {
            return 302 /#/login;
        }
    }
}

# portal.yourdomain.com
server {
    listen 80;
    server_name portal.yourdomain.com;
    location / {
        proxy_pass http://localhost:3001;
        # Redirect root to portal
        if ($uri = /) {
            return 302 /#/portal;
        }
    }
}
```

---

## Quick Reference

### Default Credentials
- **Admin password:** `admin` (change immediately!)
- **Participant passwords:** Auto-generated on import

### Useful Commands

```bash
# Check if dashboard is running
curl http://localhost:3001/api/health

# View PM2 logs
pm2 logs vibe-dashboard

# Restart dashboard
pm2 restart vibe-dashboard

# Update from git and restart
cd ~/VibeHackathonPlatform && git pull
cd dashboard && npm install && cd client && npm run build && cd ..
pm2 restart vibe-dashboard
```

### Ports
| Port | Service |
|------|---------|
| 3001 | Dashboard API + UI |
| 8080 | VS Code (on coding instances) |
| 3000 | React App (on coding instances) |

---

## Troubleshooting

### Dashboard won't start
```bash
# Check Node version (needs 20+)
node --version

# Check for port conflicts
sudo lsof -i :3001

# View detailed logs
NODE_ENV=production PORT=3001 npx tsx server/index.ts
```

### Can't connect to dashboard
- Check security group allows port 3001
- Verify EC2 instance has public IP
- Check instance is running: `pm2 status`

### AWS API errors
- Verify AWS credentials in dashboard Settings
- Check IAM permissions for ECS, EC2, ECR, CloudFront
