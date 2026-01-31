# Vibe Hackathon Platform

A complete platform for running coding hackathons with cloud-based VS Code instances. Spin up 1-100 isolated development environments on AWS ECS, each pre-configured with AI coding assistants (Continue + AWS Bedrock).

## Features

### For Organizers (Admin Dashboard)
- **One-Click AWS Setup** - Automated infrastructure provisioning (VPC, ECS, ECR, Security Groups)
- **Bulk Instance Management** - Spin up 1-100 VS Code instances with a single click
- **Participant Management** - Import from Excel/CSV, auto-generate login credentials
- **Orphaned Instance Scanner** - Find and clean up untracked AWS resources
- **Real-time Monitoring** - Live status, CloudFront deployment progress, cost estimates
- **HTTPS by Default** - Automatic CloudFront distribution for each instance

### For Participants (Portal)
- **Simple Login** - Email + password authentication
- **Instance Access** - Direct links to VS Code and React app preview
- **Auto-refresh** - Status updates automatically as instances become ready

### Each Coding Instance Includes
- **VS Code Server** - Full VS Code IDE in the browser (port 8080)
- **React Dev Server** - Live preview of their app (port 3000)
- **Continue AI** - Pre-configured AI assistant using AWS Bedrock (Claude)
- **HTTPS Access** - CloudFront distribution for secure connections

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Vibe Dashboard                           │
│  ┌─────────────────┐              ┌─────────────────────────┐  │
│  │  Admin Portal   │              │  Participant Portal     │  │
│  │  /admin         │              │  /portal                │  │
│  │                 │              │                         │  │
│  │  • AWS Setup    │              │  • Login (email+pass)   │  │
│  │  • Spin Up      │              │  • View Instance Links  │  │
│  │  • Participants │              │  • Access VS Code       │  │
│  │  • Settings     │              │                         │  │
│  └─────────────────┘              └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         AWS Cloud                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ ECS Fargate  │  │ ECS Fargate  │  │ ECS Fargate  │  ...     │
│  │  Instance 1  │  │  Instance 2  │  │  Instance 3  │          │
│  │              │  │              │  │              │          │
│  │ • VS Code    │  │ • VS Code    │  │ • VS Code    │          │
│  │ • React App  │  │ • React App  │  │ • React App  │          │
│  │ • Continue   │  │ • Continue   │  │ • Continue   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │     ECR      │  │   Bedrock    │  │  CloudFront  │          │
│  │ Docker Image │  │  Claude AI   │  │    HTTPS     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

| Requirement | Purpose |
|-------------|---------|
| **Node.js 20+** | Running the dashboard |
| **Docker Desktop** | Building container images |
| **AWS Account** | Hosting the instances |

### 1. Install and Run Locally

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/VibeHackathonPlatform.git
cd VibeHackathonPlatform/dashboard

# Install dependencies
npm install
cd client && npm install && cd ..

# Start development server
npm run dev
```

Open http://localhost:5173 and login with password: `admin`

### 2. Configure AWS

1. Go to **Settings** tab → Enter your AWS credentials
2. Go to **Setup** tab → Click **Run Automated Setup**
3. In Setup, click **Build & Push to ECR** to upload the Docker image

### 3. Import Participants

1. Go to **Participants** tab
2. Click **Import** and paste from Excel/CSV (Name, Email, Notes)
3. Save the generated passwords to distribute to participants

### 4. Spin Up Instances

1. Go to **Instances** tab
2. Select count and click **Spin Up**
3. Instances auto-assign to participants

### 5. Share Access

Give participants:
- **Portal URL**: `http://your-server/portal`
- **Their email and password**

## URLs

| Portal | URL | Who Uses It |
|--------|-----|-------------|
| **Participant Portal** | `/portal` | Hackathon participants login here |
| **Admin Dashboard** | `/admin` | Organizers manage everything |
| **Health Check** | `/api/health` | Monitoring endpoint |

## Authentication

| User Type | Login Method | Default |
|-----------|--------------|---------|
| Admin | Password only | `admin` (change in Settings!) |
| Participant | Email + Password | Auto-generated on import |

Passwords are 8-character alphanumeric, shown once after import. Export to CSV for distribution.

## AWS IAM Permissions for Deployment

### GitHub Secrets Required

Add these secrets to your GitHub repository (Settings → Secrets → Actions):

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |

### Required IAM Permissions

The IAM user needs the following permissions for the GitHub Actions deployment to work:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ecr:*",
                "ecs:*",
                "ec2:DescribeVpcs",
                "ec2:DescribeSubnets",
                "ec2:DescribeSecurityGroups",
                "ec2:CreateSecurityGroup",
                "ec2:AuthorizeSecurityGroupIngress",
                "ec2:DeleteSecurityGroup",
                "elasticloadbalancing:*",
                "iam:GetRole",
                "iam:CreateRole",
                "iam:PutRolePolicy",
                "iam:PassRole",
                "iam:AttachRolePolicy",
                "logs:CreateLogGroup",
                "logs:DescribeLogGroups",
                "cloudfront:*",
                "elasticfilesystem:CreateFileSystem",
                "elasticfilesystem:DescribeFileSystems",
                "elasticfilesystem:CreateMountTarget",
                "elasticfilesystem:DescribeMountTargets",
                "elasticfilesystem:CreateAccessPoint",
                "elasticfilesystem:DescribeAccessPoints",
                "elasticfilesystem:DeleteFileSystem",
                "elasticfilesystem:DeleteMountTarget",
                "elasticfilesystem:DeleteAccessPoint",
                "sts:GetCallerIdentity"
            ],
            "Resource": "*"
        }
    ]
}
```

Or attach these AWS managed policies:
- `AmazonECS_FullAccess`
- `AmazonEC2ContainerRegistryFullAccess`
- `ElasticLoadBalancingFullAccess`
- `CloudFrontFullAccess`
- `AmazonElasticFileSystemFullAccess`
- `IAMFullAccess` (or scoped to ECS roles)

## Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for detailed instructions including:
- EC2 deployment (simplest)
- ECS Fargate deployment
- GitHub Actions auto-deploy
- HTTPS setup
- Separate admin/participant domains

### Quick Deploy to EC2

```bash
# On EC2 instance (Amazon Linux 2023 or Ubuntu)
git clone https://github.com/YOUR_USERNAME/VibeHackathonPlatform.git
cd VibeHackathonPlatform/dashboard
npm install && cd client && npm install && npm run build && cd ..

# Run with PM2
sudo npm install -g pm2
NODE_ENV=production pm2 start "npx tsx server/index.ts" --name vibe-dashboard
```

## Project Structure

```
VibeHackathonPlatform/
├── dashboard/                 # Admin dashboard & API server
│   ├── client/               # React frontend (Vite + TypeScript + Tailwind)
│   │   └── src/
│   │       ├── components/   # UI components
│   │       │   ├── auth/     # Login pages
│   │       │   └── portal/   # Participant portal
│   │       ├── lib/          # API client, auth utilities
│   │       └── hooks/        # React hooks (useAuth)
│   ├── server/               # Express backend
│   │   ├── routes/           # API endpoints
│   │   ├── services/         # AWS integrations (ECS, CloudFront, etc.)
│   │   ├── middleware/       # Auth middleware (JWT)
│   │   └── db/               # JSON database
│   └── Dockerfile            # Dashboard container
├── docker/                    # Coding instance container
│   ├── Dockerfile            # VS Code + React + Continue
│   └── config/               # Extension configurations
├── .github/workflows/        # GitHub Actions (auto-deploy)
├── DEPLOYMENT.md             # Deployment guide
└── README.md                 # This file
```

## Cost Estimates

| Resource | Cost |
|----------|------|
| ECS Fargate (2 vCPU, 4 GB per instance) | ~$0.10/hour |
| CloudFront (per distribution) | ~$0.085/month |
| ECR Storage | ~$0.10/GB/month |

**Examples:**
| Scenario | Estimated Cost |
|----------|---------------|
| 10 instances × 8 hours | ~$8 |
| 50 instances × 8 hours | ~$40 |
| 100 instances × 4 hours | ~$40 |

## API Reference

### Authentication (Public)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/admin/login` | Admin login |
| POST | `/api/auth/participant/login` | Participant login |
| GET | `/api/auth/verify` | Verify token |

### Instances (Admin only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/instances` | List all instances |
| POST | `/api/instances/spin-up` | Create instances |
| POST | `/api/instances/stop-all` | Stop all instances |
| DELETE | `/api/instances/all` | Delete all instances |
| GET | `/api/instances/orphaned/scan` | Find orphaned AWS tasks |

### Participants (Admin only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/participants` | List all participants |
| POST | `/api/participants/import` | Bulk import with passwords |
| POST | `/api/participants/:id/assign` | Assign to instance |

### Portal (Participant only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/portal/my-instance` | Get assigned instance |

## Troubleshooting

### Dashboard not loading
```bash
# Check Node version (needs 20+)
node --version

# Kill processes on ports
npx kill-port 3001 5173

# Restart
npm run dev
```

### Instances stuck in "Provisioning"
- Check CloudWatch logs: `/ecs/vibe-coding-lab`
- Verify security group allows ports 8080, 3000
- Ensure subnets have internet access

### "No token provided" errors
- Clear browser localStorage
- Login again at `/admin` or `/portal`

### Orphaned instances (running but not tracked)
1. Go to Instances tab
2. Scroll to "Orphaned Instance Scanner"
3. Click "Scan AWS"
4. Import or terminate orphaned tasks

## Data Storage

All data stored locally in `dashboard/data/db.json`:
- AWS credentials (encrypted at rest via OS)
- Instance records
- Participant data (including password hashes)
- Configuration

**This file is in `.gitignore` and never committed to git.**

To reset: `rm dashboard/data/db.json`

## Security Notes

- Admin password: Change from default immediately
- Participant passwords: 8-char alphanumeric (~47 bits entropy)
- JWT tokens: 24-hour expiry, stored in localStorage
- HTTPS: Via CloudFront for coding instances
- AWS credentials: Stored locally only, never in git

## License

MIT - Feel free to use for your own hackathons!

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request
