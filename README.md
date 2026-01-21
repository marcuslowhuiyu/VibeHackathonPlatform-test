# Vibe Hackathon Platform

A multi-instance VS Code IDE management system for hackathons. Spin up 1-100 containerized VS Code environments on AWS, each pre-configured with the Cline AI assistant (Claude via AWS Bedrock).

## Features

- **Bulk Instance Management**: Spin up 1-100 VS Code instances with a single click
- **Per-Instance Access**: Each instance gets its own public URL for VS Code (port 8080) and React dev server (port 3000)
- **Participant Tracking**: Assign names, emails, and notes to instances for easy management
- **Bulk Actions**: Stop All / Delete All instances with one click
- **Export**: Copy links to clipboard or export to CSV for distribution
- **Real-time Status**: Live status updates (Running, Starting, Stopped)
- **Cost Tracking**: Estimated cost display (~$0.10/hour per instance)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Vibe Dashboard (localhost:5173)             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Credentials  │  │   Config     │  │  Instances   │          │
│  │    Tab       │  │    Tab       │  │    Tab       │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Express Backend (localhost:3001)              │
│                   - Instance CRUD operations                    │
│                   - AWS ECS/EC2 integration                     │
│                   - JSON file database                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         AWS Cloud                               │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐          │
│  │    ECR      │   │ ECS Fargate │   │   Bedrock   │          │
│  │  (Images)   │   │  (Compute)  │   │  (Claude)   │          │
│  └─────────────┘   └─────────────┘   └─────────────┘          │
│                           │                                     │
│                    ┌──────┴──────┐                             │
│                    │   Tasks     │                             │
│                    │ ┌─────────┐ │                             │
│                    │ │Instance1│ │ ──► http://<ip>:8080 (IDE) │
│                    │ │Instance2│ │ ──► http://<ip>:3000 (App) │
│                    │ │   ...   │ │                             │
│                    │ └─────────┘ │                             │
│                    └─────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

Before starting, you need:

| Requirement | Purpose | Download |
|-------------|---------|----------|
| **Node.js 18+** | Running the dashboard | [nodejs.org](https://nodejs.org/) |
| **Docker Desktop** | Building container images | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) |
| **AWS Account** | Hosting the instances | [aws.amazon.com](https://aws.amazon.com/) |

**Note:** AWS CLI is NOT required - the dashboard handles everything through the web interface.

---

## Quick Start (5 Minutes)

### Step 1: Install and Launch Dashboard

```bash
# Clone the repository (if you haven't already)
git clone <your-repo-url>
cd VibeHackathonPlatform

# Install dependencies
cd dashboard
npm install
cd client && npm install && cd ..

# Start the dashboard
npm run dev
```

The dashboard will open at:
- **Frontend**: http://localhost:5173 (or 5174 if 5173 is in use)
- **Backend API**: http://localhost:3001

### Step 2: Configure AWS Credentials

1. Open the dashboard in your browser
2. Go to **Settings** tab
3. Enter your AWS credentials:
   - Access Key ID
   - Secret Access Key
   - Region (e.g., `us-east-1`)

**Need help getting credentials?** See the collapsible guide in the Settings tab.

### Step 3: Run Automated Setup

1. Go to **Setup** tab
2. Expand **Prerequisites** to verify Docker is running
3. Expand **Step 1: AWS Infrastructure Setup** and click **Run Automated Setup**
   - This creates: ECS cluster, ECR repository, IAM roles, security groups, task definition
4. Expand **Step 2: Build & Push Docker Image** and click **Build & Push Image**
   - This builds and uploads the VS Code container to AWS

### Step 4: Spin Up Instances

1. Go to **Instances** tab
2. Select the number of instances (1-100)
3. Click **Spin Up Instances**
4. Wait for status to change from "Starting" to "Running"
5. Click **VS Code** or **React App** buttons to access each instance

---

## For Administrators

### Customizing the Container Environment

You can customize what's installed in each instance:

1. Go to **Setup** tab
2. Expand **Step 3: Customize Container (Optional)**
3. Edit the **Dockerfile** to add packages, tools, or extensions
4. Edit **entrypoint.sh** to change startup behavior
5. Click **Save Changes**
6. Go back to **Step 2** and rebuild the Docker image

Changes will apply to all **new** instances (existing instances keep their original configuration).

### Managing Participants

Each instance can be assigned to a participant:
1. Click the **dropdown arrow** on an instance to expand details
2. Click the **Edit** (pencil) icon
3. Enter participant name, email, and notes
4. Click **Save**

### Exporting Instance Data

- **Copy Links**: Copies all VS Code URLs to clipboard for distribution
- **Export CSV**: Downloads a spreadsheet with all instance data

---

## AWS Setup (Automated)

The dashboard's **Setup** tab handles all AWS infrastructure creation automatically. You typically don't need to run any manual commands.

### What Gets Created Automatically

| Resource | Name | Purpose |
|----------|------|---------|
| ECR Repository | `vibe-coding-lab` | Stores the VS Code container image |
| ECS Cluster | `vibe-cluster` | Runs the container tasks |
| Task Definition | `vibe-coding-lab` | Container specs (2 vCPU, 4 GB RAM) |
| IAM Role | `ecsTaskExecutionRole` | ECS task execution permissions |
| IAM Role | `vibeTaskRole` | Bedrock (Claude AI) access |
| Security Group | `vibe-ecs-sg` | Allows ports 8080, 3000 |

### Manual Setup (if automated doesn't work)

If you need to set up manually, here are the commands. This is a one-time setup.

### Required AWS Resources

| Resource | Purpose |
|----------|---------|
| ECR Repository | Stores the VS Code container image |
| ECS Cluster | Runs the container tasks |
| Task Definition | Defines container specs (CPU, memory, ports) |
| IAM Roles | Permissions for ECS tasks and Bedrock access |
| VPC + Subnets | Networking for containers |
| Security Group | Firewall rules (allow ports 8080, 3000) |

### Step 1: Create ECR Repository

```bash
aws ecr create-repository \
    --repository-name vibe-coding-lab \
    --region us-east-1
```

### Step 2: Build and Push Docker Image

```bash
# Get your AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Authenticate with ECR
aws ecr get-login-password --region us-east-1 | \
    docker login --username AWS --password-stdin \
    $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build the image
cd cline-setup
docker build -t vibe-coding-lab:latest .

# Tag and push
docker tag vibe-coding-lab:latest \
    $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/vibe-coding-lab:latest
docker push \
    $AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/vibe-coding-lab:latest
```

### Step 3: Create IAM Roles

#### ECS Task Execution Role

```bash
# Create trust policy
cat > ecs-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ecs-tasks.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

# Create role and attach policy
aws iam create-role \
    --role-name ecsTaskExecutionRole \
    --assume-role-policy-document file://ecs-trust-policy.json

aws iam attach-role-policy \
    --role-name ecsTaskExecutionRole \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

#### ECS Task Role (for Bedrock access)

```bash
# Create Bedrock access policy
cat > bedrock-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream"
    ],
    "Resource": ["arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-*"]
  }]
}
EOF

# Create role and attach policy
aws iam create-role \
    --role-name vibeTaskRole \
    --assume-role-policy-document file://ecs-trust-policy.json

aws iam put-role-policy \
    --role-name vibeTaskRole \
    --policy-name BedrockAccess \
    --policy-document file://bedrock-policy.json
```

### Step 4: Get VPC and Subnet IDs

```bash
# Get default VPC
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
    --query "Vpcs[0].VpcId" --output text)
echo "VPC ID: $VPC_ID"

# List subnets (pick 1-2 from different AZs)
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
    --query "Subnets[*].[SubnetId,AvailabilityZone]" --output table
```

### Step 5: Create Security Group

```bash
# Create security group
aws ec2 create-security-group \
    --group-name vibe-ecs-sg \
    --description "Security group for Vibe ECS tasks" \
    --vpc-id $VPC_ID

# Get security group ID
SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=vibe-ecs-sg" \
    --query "SecurityGroups[0].GroupId" --output text)

# Allow VS Code (8080) and React (3000) from anywhere
aws ec2 authorize-security-group-ingress \
    --group-id $SG_ID --protocol tcp --port 8080 --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
    --group-id $SG_ID --protocol tcp --port 3000 --cidr 0.0.0.0/0

echo "Security Group ID: $SG_ID"
```

### Step 6: Create ECS Cluster

```bash
aws ecs create-cluster \
    --cluster-name vibe-cluster \
    --capacity-providers FARGATE FARGATE_SPOT \
    --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1
```

### Step 7: Register Task Definition

```bash
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > task-definition.json << EOF
{
  "family": "vibe-coding-lab",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "executionRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/vibeTaskRole",
  "containerDefinitions": [{
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
  }]
}
EOF

aws ecs register-task-definition --cli-input-json file://task-definition.json
```

### Step 8: Enable Bedrock Model Access

1. Go to AWS Console → Bedrock → Model access
2. Request access to "Anthropic Claude" models
3. Wait for approval (usually instant)

### Summary: Values to Configure in Dashboard

After setup, enter these in the dashboard's **Config** tab:

| Field | Example Value |
|-------|---------------|
| Cluster Name | `vibe-cluster` |
| Task Definition | `vibe-coding-lab` |
| VPC ID | `vpc-0123456789abcdef0` |
| Subnet IDs | `subnet-abc123,subnet-def456` |
| Security Group ID | `sg-0123456789abcdef0` |

---

## Dashboard Usage Guide

### Credentials Tab
Enter your AWS credentials:
- **Access Key ID**: Your AWS access key
- **Secret Access Key**: Your AWS secret key
- **Region**: AWS region (e.g., `us-east-1`)

### Config Tab
Enter your AWS resource IDs from the setup above.

### Instances Tab

#### Spinning Up Instances
1. Use the slider to select 1-100 instances
2. Click "Spin Up N Instances"
3. Wait for instances to start (status: Provisioning → Running)
4. Click VS Code or React App buttons to access each instance

#### Managing Individual Instances
- **Edit** (pencil icon): Assign participant name, email, and notes
- **Stop** (square icon): Stop a running instance
- **Start** (play icon): Restart a stopped instance
- **Delete** (trash icon): Remove an instance permanently

#### Bulk Actions
- **Stop All**: Stops all running instances at once
- **Delete All**: Deletes all instances (stops them first)

#### Export Options
- **Copy Links**: Copies all running instance URLs to clipboard (for distribution)
- **Export CSV**: Downloads a CSV file with all instance data including participant info

---

## Scaling Considerations

For 50-100 instances, check these AWS limits:

| Quota | Default Limit | How to Increase |
|-------|---------------|-----------------|
| Fargate Tasks per Cluster | 100 | AWS Support ticket |
| Elastic IPs per Region | 5 | AWS Support ticket |
| VPC IP Addresses | Varies by subnet | Use larger subnets |
| Bedrock API Rate | Varies by model | AWS Support ticket |

---

## Cost Estimation

| Component | Cost |
|-----------|------|
| ECS Fargate (2 vCPU, 4 GB) | ~$0.10/hour per instance |
| ECR Storage | ~$0.10/GB/month |
| Data Transfer | ~$0.09/GB outbound |

**Examples**:
| Scenario | Cost |
|----------|------|
| 10 instances × 8 hours | $8 |
| 50 instances × 8 hours | $40 |
| 100 instances × 4 hours | $40 |

**Cost Saving Tip**: Use Fargate Spot for 60-70% savings (modify task definition).

---

## Troubleshooting

### Dashboard not loading / Wrong app showing

If you see a different application (not "Vibe Dashboard") or the page doesn't load:

1. **Kill any processes using the ports:**

   **Windows (PowerShell/CMD):**
   ```cmd
   # Find processes on port 5173 and 3001
   netstat -ano | findstr :5173
   netstat -ano | findstr :3001

   # Kill the process (replace <PID> with the number from above)
   taskkill /PID <PID> /F
   ```

   **Mac/Linux:**
   ```bash
   # Find and kill processes on ports
   lsof -ti:5173 | xargs kill -9
   lsof -ti:3001 | xargs kill -9
   ```

2. **Clear the Vite cache:**
   ```bash
   cd dashboard/client
   rm -rf node_modules/.vite
   # Windows: rmdir /s /q node_modules\.vite
   ```

3. **Restart the dashboard:**
   ```bash
   cd dashboard
   npm run dev
   ```

4. **Open in incognito/private window** to avoid browser cache issues:
   - Go to http://localhost:5173
   - You should see "Vibe Dashboard" with three tabs: Instances, Setup, Settings

### Buttons not working / No network requests

If clicking buttons does nothing:

1. Make sure **both servers are running** - you should see:
   ```
   Vibe Dashboard Server
   Running on: http://localhost:3001
   ```
   AND
   ```
   VITE ready
   Local: http://localhost:5173
   ```

2. Check browser console (F12) for JavaScript errors

3. Verify the backend is reachable: open http://localhost:3001/api/health in your browser - you should see `{"status":"ok"}`

### Instances stuck in "Starting"
- Check ECS task logs in CloudWatch (`/ecs/vibe-coding-lab`)
- Verify security group allows ports 8080 and 3000
- Ensure subnets have internet access (public subnet with IGW or private with NAT)

### "AWS credentials not configured"
- Enter credentials in the Credentials tab
- Ensure the IAM user has these permissions: `ecs:*`, `ec2:DescribeNetworkInterfaces`, `ecr:GetAuthorizationToken`

### "Cluster not found"
- Create the cluster: `aws ecs create-cluster --cluster-name vibe-cluster`
- Or update the cluster name in the Config tab to match your existing cluster

### Container fails to start
- Check CloudWatch logs: `/ecs/vibe-coding-lab`
- Verify ECR image exists: `aws ecr describe-images --repository-name vibe-coding-lab`
- Ensure task execution role has ECR pull permissions

### No public IP assigned
- Ensure `assignPublicIp: ENABLED` in task network config
- Use subnets that auto-assign public IPs, or use NAT gateway

---

## Project Structure

```
VibeHackathonPlatform/
├── dashboard/
│   ├── server/                 # Express.js backend
│   │   ├── index.ts           # Server entry point (port 3001)
│   │   ├── routes/
│   │   │   ├── instances.ts   # Instance CRUD + bulk operations
│   │   │   ├── credentials.ts # AWS credentials management
│   │   │   ├── config.ts      # AWS config management
│   │   │   └── setup.ts       # Automated AWS setup + file editing
│   │   ├── services/
│   │   │   ├── ecs-manager.ts # AWS ECS task management
│   │   │   └── aws-setup.ts   # AWS resource creation
│   │   └── db/
│   │       └── database.ts    # JSON file database
│   ├── client/                # React frontend (Vite)
│   │   └── src/
│   │       ├── App.tsx        # Main app with tab navigation
│   │       ├── components/
│   │       │   ├── CredentialsForm.tsx  # AWS credentials input
│   │       │   ├── ConfigForm.tsx       # AWS config display
│   │       │   ├── SetupGuide.tsx       # Automated setup wizard
│   │       │   ├── SpinUpForm.tsx       # Instance count selector
│   │       │   └── InstanceList.tsx     # Instance management
│   │       └── lib/api.ts     # API client
│   └── data/                  # Local JSON database storage
├── cline-setup/               # Docker container setup (editable in dashboard)
│   ├── Dockerfile            # OpenVSCode + Cline image
│   └── entrypoint.sh         # Container startup script
└── README.md                 # This file
```

---

## API Reference

### Instances

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/instances` | List all instances with live status |
| POST | `/api/instances/spin-up` | Create new instances `{ count: number }` |
| POST | `/api/instances/stop-all` | Stop all running instances |
| DELETE | `/api/instances/all` | Delete all instances |
| GET | `/api/instances/:id` | Get single instance details |
| PATCH | `/api/instances/:id` | Update participant info |
| POST | `/api/instances/:id/stop` | Stop single instance |
| POST | `/api/instances/:id/start` | Start single instance |
| DELETE | `/api/instances/:id` | Delete single instance |

### Credentials

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/credentials` | Check if credentials are configured |
| POST | `/api/credentials` | Save AWS credentials |
| DELETE | `/api/credentials` | Remove stored credentials |
| GET | `/api/credentials/validate` | Test credentials against AWS |

### Config

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/config` | Get current AWS resource config |
| PUT | `/api/config` | Update AWS resource config |

### Setup

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/setup/status` | Check AWS setup status |
| POST | `/api/setup/run` | Run automated AWS setup |
| GET | `/api/setup/docker-status` | Check if Docker is available |
| POST | `/api/setup/build-and-push` | Build and push Docker image |
| GET | `/api/setup/files` | List editable container files |
| GET | `/api/setup/files/:name` | Get file content |
| PUT | `/api/setup/files/:name` | Save file content |

---

## Data Storage & Security

### Where is my data stored?

All data is stored locally in a single JSON file:

```
dashboard/data/db.json
```

This file contains:
- **AWS Credentials** (Access Key ID, Secret Access Key, Region)
- **Instance Data** (IDs, URLs, participant info)
- **AWS Config** (VPC, subnets, security group IDs)

### Does my data persist?

**Yes** - The `db.json` file persists on disk. When you stop and restart the dashboard server, all your credentials, config, and instance data will still be there.

### Is my data safe from GitHub?

**Yes** - The `dashboard/data/` folder is in `.gitignore` and will never be committed to git. You can verify this:

```bash
# Check that no credential files are tracked
git ls-files | grep -E "(db\.json|data/)"
# Should return nothing

# Check gitignore includes the data folder
cat .gitignore | grep "dashboard/data"
# Should show: dashboard/data/
```

### Resetting your data

To start fresh, simply delete the database file:

```bash
rm dashboard/data/db.json
# Windows: del dashboard\data\db.json
```

The dashboard will create a new empty database on next startup.

---

## Pushing to Git Safely

Your AWS credentials are stored locally and should **never** be committed to git. Here's how to ensure you don't leak sensitive data:

### Before pushing, always verify:

```bash
# 1. Check that no sensitive files are staged
git status

# 2. Verify db.json is NOT in the list of changes
git diff --cached --name-only | grep -E "(db\.json|\.env|credentials)"
# Should return nothing

# 3. Double-check .gitignore is working
git ls-files | grep -E "(db\.json|data/)"
# Should return nothing
```

### What's already protected (in .gitignore):

- `dashboard/data/` - Contains `db.json` with your AWS credentials
- `node_modules/` - Dependencies
- `.env` files - Environment variables
- `*.log` - Log files

### Safe push workflow:

```bash
# 1. Check what will be committed
git status
git diff --cached

# 2. If you see any sensitive files, unstage them:
git reset HEAD dashboard/data/db.json

# 3. Add only the files you want
git add -p  # Interactive mode - review each change

# 4. Commit and push
git commit -m "Your message"
git push
```

### If you accidentally committed credentials:

**STOP!** Don't push yet. Remove the sensitive data:

```bash
# Remove the file from git history (keeps local file)
git rm --cached dashboard/data/db.json
git commit -m "Remove sensitive data from tracking"

# If already pushed, you need to rotate your AWS credentials immediately:
# 1. Go to AWS Console → IAM → Users → Security credentials
# 2. Delete the old access key
# 3. Create a new access key
# 4. Update the dashboard with new credentials
```

### Pro tip: Use git hooks

Add a pre-commit hook to prevent accidental commits of sensitive files:

```bash
# Create .git/hooks/pre-commit
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
if git diff --cached --name-only | grep -qE "(db\.json|\.env|credentials|secret)"; then
    echo "ERROR: Attempting to commit potentially sensitive files!"
    echo "Blocked files:"
    git diff --cached --name-only | grep -E "(db\.json|\.env|credentials|secret)"
    exit 1
fi
EOF
chmod +x .git/hooks/pre-commit
```

---

## Local Development

### Modify the Dashboard
```bash
cd dashboard
npm run dev  # Hot reload enabled
```

### Test Container Locally
```bash
cd cline-setup
docker build -t vibe-coding-lab:latest .
docker run -d -p 8080:8080 -p 3000:3000 --name vibe-test vibe-coding-lab:latest

# Access:
# VS Code: http://localhost:8080
# React App: http://localhost:3000

# Cleanup
docker stop vibe-test && docker rm vibe-test
```

---

## License

MIT
