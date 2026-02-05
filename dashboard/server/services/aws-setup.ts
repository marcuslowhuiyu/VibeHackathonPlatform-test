import {
  ECSClient,
  CreateClusterCommand,
  RegisterTaskDefinitionCommand,
  DescribeClustersCommand,
} from '@aws-sdk/client-ecs';
import {
  EC2Client,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
} from '@aws-sdk/client-ec2';
import {
  IAMClient,
  CreateRoleCommand,
  PutRolePolicyCommand,
  AttachRolePolicyCommand,
  GetRoleCommand,
  DeleteRolePolicyCommand,
} from '@aws-sdk/client-iam';
import {
  CodeBuildClient,
  CreateProjectCommand,
  BatchGetProjectsCommand,
} from '@aws-sdk/client-codebuild';
import {
  ECRClient,
  CreateRepositoryCommand,
  DescribeRepositoriesCommand,
} from '@aws-sdk/client-ecr';
import {
  STSClient,
  GetCallerIdentityCommand,
} from '@aws-sdk/client-sts';
import {
  ECRClient as ECRClientFull,
  GetAuthorizationTokenCommand,
} from '@aws-sdk/client-ecr';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCredentials, setConfig, getConfig } from '../db/database.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SetupStatus {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  message?: string;
  resourceId?: string;
}

export interface SetupResult {
  success: boolean;
  steps: SetupStatus[];
  config?: {
    cluster_name: string;
    task_definition: string;
    vpc_id: string;
    subnet_ids: string;
    security_group_id: string;
  };
  error?: string;
}

function getClients() {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  const config = {
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  };

  return {
    ecs: new ECSClient(config),
    ec2: new EC2Client(config),
    iam: new IAMClient(config),
    ecr: new ECRClient(config),
    sts: new STSClient(config),
    codebuild: new CodeBuildClient(config),
  };
}

const ECS_TRUST_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: { Service: 'ecs-tasks.amazonaws.com' },
    Action: 'sts:AssumeRole',
  }],
});

const BEDROCK_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Action: [
      'bedrock:InvokeModel',
      'bedrock:InvokeModelWithResponseStream',
    ],
    Resource: ['arn:aws:bedrock:*::foundation-model/anthropic.claude-*'],
  }],
});

// CloudWatch Logs policy for execution role (required to create log groups)
const CLOUDWATCH_LOGS_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Action: [
      'logs:CreateLogGroup',
      'logs:CreateLogStream',
      'logs:PutLogEvents',
      'logs:DescribeLogStreams',
    ],
    Resource: ['arn:aws:logs:*:*:log-group:/ecs/*'],
  }],
});

// CodeBuild trust policy
const CODEBUILD_TRUST_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: { Service: 'codebuild.amazonaws.com' },
    Action: 'sts:AssumeRole',
  }],
});

// CodeBuild permissions policy (ECR, CloudWatch Logs, S3)
function getCodeBuildPolicy(accountId: string, region: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'ecr:GetAuthorizationToken',
        ],
        Resource: '*',
      },
      {
        Effect: 'Allow',
        Action: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
        ],
        Resource: `arn:aws:ecr:${region}:${accountId}:repository/vibe-coding-lab`,
      },
      {
        Effect: 'Allow',
        Action: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        Resource: `arn:aws:logs:${region}:${accountId}:log-group:/aws/codebuild/*`,
      },
    ],
  });
}

export async function runFullSetup(
  onProgress?: (step: SetupStatus) => void
): Promise<SetupResult> {
  const steps: SetupStatus[] = [];
  const report = (step: SetupStatus) => {
    steps.push(step);
    onProgress?.(step);
  };

  try {
    const clients = getClients();
    const creds = getCredentials()!;

    // Get AWS Account ID
    report({ step: 'get_account_id', status: 'in_progress', message: 'Getting AWS account ID...' });
    const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
    const accountId = identity.Account!;
    report({ step: 'get_account_id', status: 'completed', message: `Account ID: ${accountId}`, resourceId: accountId });

    // Step 1: Get default VPC
    report({ step: 'get_vpc', status: 'in_progress', message: 'Finding default VPC...' });
    const vpcsResponse = await clients.ec2.send(new DescribeVpcsCommand({
      Filters: [{ Name: 'isDefault', Values: ['true'] }],
    }));
    const vpcId = vpcsResponse.Vpcs?.[0]?.VpcId;
    if (!vpcId) {
      throw new Error('No default VPC found. Please create a VPC first.');
    }
    report({ step: 'get_vpc', status: 'completed', message: `Found VPC: ${vpcId}`, resourceId: vpcId });

    // Step 2: Get subnets
    report({ step: 'get_subnets', status: 'in_progress', message: 'Finding subnets...' });
    const subnetsResponse = await clients.ec2.send(new DescribeSubnetsCommand({
      Filters: [{ Name: 'vpc-id', Values: [vpcId] }],
    }));
    const subnets = subnetsResponse.Subnets || [];
    if (subnets.length === 0) {
      throw new Error('No subnets found in the default VPC.');
    }
    // Pick up to 2 subnets from different AZs
    const subnetIds = subnets
      .slice(0, 2)
      .map((s) => s.SubnetId!)
      .join(',');
    report({ step: 'get_subnets', status: 'completed', message: `Found subnets: ${subnetIds}`, resourceId: subnetIds });

    // Step 3: Create or get security group
    report({ step: 'create_security_group', status: 'in_progress', message: 'Creating security group...' });
    let securityGroupId: string;
    try {
      // Check if it already exists
      const existingSg = await clients.ec2.send(new DescribeSecurityGroupsCommand({
        Filters: [
          { Name: 'group-name', Values: ['vibe-ecs-sg'] },
          { Name: 'vpc-id', Values: [vpcId] },
        ],
      }));
      if (existingSg.SecurityGroups && existingSg.SecurityGroups.length > 0) {
        securityGroupId = existingSg.SecurityGroups[0].GroupId!;
        report({ step: 'create_security_group', status: 'skipped', message: `Security group already exists: ${securityGroupId}`, resourceId: securityGroupId });
      } else {
        throw new Error('Not found');
      }
    } catch {
      // Create new security group
      const sgResponse = await clients.ec2.send(new CreateSecurityGroupCommand({
        GroupName: 'vibe-ecs-sg',
        Description: 'Security group for Vibe Hackathon ECS tasks',
        VpcId: vpcId,
      }));
      securityGroupId = sgResponse.GroupId!;

      // Add ingress rules for ports 8080 and 3000
      await clients.ec2.send(new AuthorizeSecurityGroupIngressCommand({
        GroupId: securityGroupId,
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          { IpProtocol: 'tcp', FromPort: 3000, ToPort: 3000, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        ],
      }));
      report({ step: 'create_security_group', status: 'completed', message: `Created security group: ${securityGroupId}`, resourceId: securityGroupId });
    }

    // Step 4: Create IAM roles
    report({ step: 'create_execution_role', status: 'in_progress', message: 'Creating ECS task execution role...' });
    let executionRoleArn: string;
    try {
      const existingRole = await clients.iam.send(new GetRoleCommand({ RoleName: 'ecsTaskExecutionRole' }));
      executionRoleArn = existingRole.Role!.Arn!;
      // Ensure CloudWatch Logs policy is attached (might be missing from earlier setup)
      try {
        await clients.iam.send(new PutRolePolicyCommand({
          RoleName: 'ecsTaskExecutionRole',
          PolicyName: 'CloudWatchLogsAccess',
          PolicyDocument: CLOUDWATCH_LOGS_POLICY,
        }));
      } catch {
        // Policy might already exist, that's fine
      }
      report({ step: 'create_execution_role', status: 'skipped', message: 'Execution role already exists (updated CloudWatch permissions)', resourceId: executionRoleArn });
    } catch {
      const roleResponse = await clients.iam.send(new CreateRoleCommand({
        RoleName: 'ecsTaskExecutionRole',
        AssumeRolePolicyDocument: ECS_TRUST_POLICY,
      }));
      executionRoleArn = roleResponse.Role!.Arn!;
      // Attach standard ECS execution policy
      await clients.iam.send(new AttachRolePolicyCommand({
        RoleName: 'ecsTaskExecutionRole',
        PolicyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
      }));
      // Add CloudWatch Logs permissions (required for log group creation)
      await clients.iam.send(new PutRolePolicyCommand({
        RoleName: 'ecsTaskExecutionRole',
        PolicyName: 'CloudWatchLogsAccess',
        PolicyDocument: CLOUDWATCH_LOGS_POLICY,
      }));
      report({ step: 'create_execution_role', status: 'completed', message: 'Created execution role with CloudWatch permissions', resourceId: executionRoleArn });
    }

    // Step 5: Create task role with Bedrock access
    report({ step: 'create_task_role', status: 'in_progress', message: 'Creating ECS task role with Bedrock access...' });
    let taskRoleArn: string;
    try {
      const existingRole = await clients.iam.send(new GetRoleCommand({ RoleName: 'vibeTaskRole' }));
      taskRoleArn = existingRole.Role!.Arn!;
      report({ step: 'create_task_role', status: 'skipped', message: 'Task role already exists', resourceId: taskRoleArn });
    } catch {
      const roleResponse = await clients.iam.send(new CreateRoleCommand({
        RoleName: 'vibeTaskRole',
        AssumeRolePolicyDocument: ECS_TRUST_POLICY,
      }));
      taskRoleArn = roleResponse.Role!.Arn!;
      await clients.iam.send(new PutRolePolicyCommand({
        RoleName: 'vibeTaskRole',
        PolicyName: 'BedrockAccess',
        PolicyDocument: BEDROCK_POLICY,
      }));
      report({ step: 'create_task_role', status: 'completed', message: 'Created task role with Bedrock access', resourceId: taskRoleArn });
    }

    // Step 6: Create ECR repository
    report({ step: 'create_ecr_repo', status: 'in_progress', message: 'Creating ECR repository...' });
    let ecrRepoUri: string;
    try {
      const existingRepo = await clients.ecr.send(new DescribeRepositoriesCommand({
        repositoryNames: ['vibe-coding-lab'],
      }));
      ecrRepoUri = existingRepo.repositories![0].repositoryUri!;
      report({ step: 'create_ecr_repo', status: 'skipped', message: 'ECR repository already exists', resourceId: ecrRepoUri });
    } catch {
      const repoResponse = await clients.ecr.send(new CreateRepositoryCommand({
        repositoryName: 'vibe-coding-lab',
      }));
      ecrRepoUri = repoResponse.repository!.repositoryUri!;
      report({ step: 'create_ecr_repo', status: 'completed', message: 'Created ECR repository', resourceId: ecrRepoUri });
    }

    // Step 7: Create ECS cluster
    report({ step: 'create_cluster', status: 'in_progress', message: 'Creating ECS cluster...' });
    const clusterName = 'vibe-cluster';
    try {
      const existingCluster = await clients.ecs.send(new DescribeClustersCommand({
        clusters: [clusterName],
      }));
      if (existingCluster.clusters && existingCluster.clusters.length > 0 && existingCluster.clusters[0].status === 'ACTIVE') {
        report({ step: 'create_cluster', status: 'skipped', message: 'Cluster already exists', resourceId: clusterName });
      } else {
        throw new Error('Not found');
      }
    } catch {
      await clients.ecs.send(new CreateClusterCommand({
        clusterName: clusterName,
        capacityProviders: ['FARGATE', 'FARGATE_SPOT'],
        defaultCapacityProviderStrategy: [{ capacityProvider: 'FARGATE', weight: 1 }],
      }));
      report({ step: 'create_cluster', status: 'completed', message: 'Created ECS cluster', resourceId: clusterName });
    }

    // Step 8: Register task definition
    report({ step: 'register_task_definition', status: 'in_progress', message: 'Registering task definition...' });
    const taskDefinitionFamily = 'vibe-coding-lab';
    await clients.ecs.send(new RegisterTaskDefinitionCommand({
      family: taskDefinitionFamily,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: '2048',
      memory: '4096',
      executionRoleArn: executionRoleArn,
      taskRoleArn: taskRoleArn,
      containerDefinitions: [{
        name: 'vibe-container',
        image: `${ecrRepoUri}:latest`,
        essential: true,
        portMappings: [
          { containerPort: 8080, protocol: 'tcp' },
          { containerPort: 3000, protocol: 'tcp' },
        ],
        environment: [
          { name: 'AWS_REGION', value: creds.region },
        ],
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': '/ecs/vibe-coding-lab',
            'awslogs-region': creds.region,
            'awslogs-stream-prefix': 'vibe',
            'awslogs-create-group': 'true',
          },
        },
      }],
    }));
    report({ step: 'register_task_definition', status: 'completed', message: 'Registered task definition', resourceId: taskDefinitionFamily });

    // Step 9: Create CodeBuild service role
    report({ step: 'create_codebuild_role', status: 'in_progress', message: 'Creating CodeBuild service role...' });
    let codebuildRoleArn: string;
    const codebuildRoleName = 'vibe-codebuild-service-role';
    try {
      const existingRole = await clients.iam.send(new GetRoleCommand({ RoleName: codebuildRoleName }));
      codebuildRoleArn = existingRole.Role!.Arn!;
      // Update the policy in case it changed
      try {
        await clients.iam.send(new PutRolePolicyCommand({
          RoleName: codebuildRoleName,
          PolicyName: 'CodeBuildPermissions',
          PolicyDocument: getCodeBuildPolicy(accountId, creds.region),
        }));
      } catch {
        // Policy update failed, but role exists
      }
      report({ step: 'create_codebuild_role', status: 'skipped', message: 'CodeBuild role already exists', resourceId: codebuildRoleArn });
    } catch {
      const roleResponse = await clients.iam.send(new CreateRoleCommand({
        RoleName: codebuildRoleName,
        AssumeRolePolicyDocument: CODEBUILD_TRUST_POLICY,
        Description: 'Service role for Vibe Coding Lab CodeBuild project',
      }));
      codebuildRoleArn = roleResponse.Role!.Arn!;
      await clients.iam.send(new PutRolePolicyCommand({
        RoleName: codebuildRoleName,
        PolicyName: 'CodeBuildPermissions',
        PolicyDocument: getCodeBuildPolicy(accountId, creds.region),
      }));
      report({ step: 'create_codebuild_role', status: 'completed', message: 'Created CodeBuild service role', resourceId: codebuildRoleArn });
      // Wait a moment for IAM role to propagate
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Step 10: Create CodeBuild project
    report({ step: 'create_codebuild_project', status: 'in_progress', message: 'Creating CodeBuild project...' });
    const codebuildProjectName = 'vibe-coding-lab-builder';
    try {
      const existingProject = await clients.codebuild.send(new BatchGetProjectsCommand({
        names: [codebuildProjectName],
      }));
      if (existingProject.projects && existingProject.projects.length > 0) {
        report({ step: 'create_codebuild_project', status: 'skipped', message: 'CodeBuild project already exists', resourceId: codebuildProjectName });
      } else {
        throw new Error('Not found');
      }
    } catch {
      // Create buildspec that builds both Continue and Cline images
      const buildspec = `version: 0.2
phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
  build:
    commands:
      - echo "=== Building Continue extension from cline-setup/ ==="
      - cd cline-setup
      - docker build -t vibe-coding-lab:continue .
      - docker tag vibe-coding-lab:continue $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:continue
      - docker tag vibe-coding-lab:continue $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:latest
      - cd ..
      - echo "=== Building Cline extension from cline-ai/ ==="
      - cd cline-ai
      - docker build -t vibe-coding-lab:cline .
      - docker tag vibe-coding-lab:cline $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:cline
      - cd ..
  post_build:
    commands:
      - echo Pushing the Docker images...
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:continue
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:cline
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:latest
      - echo Build completed
`;

      await clients.codebuild.send(new CreateProjectCommand({
        name: codebuildProjectName,
        description: 'Builds Vibe Coding Lab Docker images (Continue and Cline)',
        source: {
          type: 'GITHUB',
          location: 'https://github.com/marcuslowhuiyu/VibeHackathonPlatform.git',
          buildspec: buildspec,
        },
        artifacts: {
          type: 'NO_ARTIFACTS',
        },
        environment: {
          type: 'LINUX_CONTAINER',
          computeType: 'BUILD_GENERAL1_MEDIUM',
          image: 'aws/codebuild/amazonlinux2-x86_64-standard:5.0',
          privilegedMode: true,
          environmentVariables: [
            { name: 'AWS_ACCOUNT_ID', value: accountId },
            { name: 'AWS_DEFAULT_REGION', value: creds.region },
          ],
        },
        serviceRole: codebuildRoleArn,
      }));
      report({ step: 'create_codebuild_project', status: 'completed', message: 'Created CodeBuild project', resourceId: codebuildProjectName });
    }

    // Save config to database
    const config = {
      cluster_name: clusterName,
      task_definition: taskDefinitionFamily,
      vpc_id: vpcId,
      subnet_ids: subnetIds,
      security_group_id: securityGroupId,
    };

    setConfig('cluster_name', config.cluster_name);
    setConfig('task_definition', config.task_definition);
    setConfig('vpc_id', config.vpc_id);
    setConfig('subnet_ids', config.subnet_ids);
    setConfig('security_group_id', config.security_group_id);

    report({ step: 'save_config', status: 'completed', message: 'Saved configuration to dashboard' });

    return {
      success: true,
      steps,
      config,
    };
  } catch (err: any) {
    return {
      success: false,
      steps,
      error: err.message,
    };
  }
}

export async function checkSetupStatus(): Promise<{
  configured: boolean;
  missing: string[];
  ecrImageExists: boolean;
  imageUri: string | null;
  availableImages: AIExtension[];
}> {
  const missing: string[] = [];
  let ecrImageExists = false;
  let imageUri: string | null = null;
  const availableImages: AIExtension[] = [];

  try {
    const clients = getClients();
    const creds = getCredentials();

    if (!creds) {
      return { configured: false, missing: ['AWS credentials'], ecrImageExists: false, imageUri: null, availableImages: [] };
    }

    // Get account ID for image URI
    let accountId: string | null = null;
    try {
      const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
      accountId = identity.Account || null;
      if (accountId) {
        imageUri = `${accountId}.dkr.ecr.${creds.region}.amazonaws.com/vibe-coding-lab:latest`;
      }
    } catch {
      // Will be caught later
    }

    // Check cluster
    try {
      const cluster = await clients.ecs.send(new DescribeClustersCommand({
        clusters: ['vibe-cluster'],
      }));
      if (!cluster.clusters || cluster.clusters.length === 0 || cluster.clusters[0].status !== 'ACTIVE') {
        missing.push('ECS cluster');
      }
    } catch {
      missing.push('ECS cluster');
    }

    // Check ECR repo and available images
    try {
      const repo = await clients.ecr.send(new DescribeRepositoriesCommand({
        repositoryNames: ['vibe-coding-lab'],
      }));
      if (repo.repositories && repo.repositories.length > 0) {
        const { ECRClient, DescribeImagesCommand, ListImagesCommand } = await import('@aws-sdk/client-ecr');
        const ecr = new ECRClient({
          region: creds.region,
          credentials: {
            accessKeyId: creds.access_key_id,
            secretAccessKey: creds.secret_access_key,
          },
        });

        // Check for each extension image
        for (const ext of AI_EXTENSIONS) {
          try {
            const images = await ecr.send(new DescribeImagesCommand({
              repositoryName: 'vibe-coding-lab',
              imageIds: [{ imageTag: ext }],
            }));
            if ((images.imageDetails?.length || 0) > 0) {
              availableImages.push(ext);
            }
          } catch {
            // Image tag doesn't exist
          }
        }

        // Also check for 'latest' tag for backwards compatibility
        try {
          const images = await ecr.send(new DescribeImagesCommand({
            repositoryName: 'vibe-coding-lab',
            imageIds: [{ imageTag: 'latest' }],
          }));
          ecrImageExists = (images.imageDetails?.length || 0) > 0;
          // If only 'latest' exists and no extension-specific tags, assume it's 'continue'
          if (ecrImageExists && availableImages.length === 0) {
            availableImages.push('continue');
          }
        } catch {
          ecrImageExists = false;
        }

        // If we have any extension images, mark as existing
        if (availableImages.length > 0) {
          ecrImageExists = true;
        }
      } else {
        missing.push('ECR repository');
      }
    } catch {
      missing.push('ECR repository');
    }

    // Check security group
    try {
      const sg = await clients.ec2.send(new DescribeSecurityGroupsCommand({
        Filters: [{ Name: 'group-name', Values: ['vibe-ecs-sg'] }],
      }));
      if (!sg.SecurityGroups || sg.SecurityGroups.length === 0) {
        missing.push('Security group');
      }
    } catch {
      missing.push('Security group');
    }

    // Check IAM roles
    try {
      await clients.iam.send(new GetRoleCommand({ RoleName: 'ecsTaskExecutionRole' }));
    } catch {
      missing.push('ECS execution role');
    }

    try {
      await clients.iam.send(new GetRoleCommand({ RoleName: 'vibeTaskRole' }));
    } catch {
      missing.push('ECS task role');
    }

    // Check CodeBuild project
    try {
      const project = await clients.codebuild.send(new BatchGetProjectsCommand({
        names: ['vibe-coding-lab-builder'],
      }));
      if (!project.projects || project.projects.length === 0) {
        missing.push('CodeBuild project');
      }
    } catch {
      missing.push('CodeBuild project');
    }

    return {
      configured: missing.length === 0,
      missing,
      ecrImageExists,
      imageUri,
      availableImages,
    };
  } catch (err: any) {
    return {
      configured: false,
      missing: ['Unable to check: ' + err.message],
      ecrImageExists: false,
      imageUri: null,
      availableImages: [],
    };
  }
}

export async function getDockerPushCommands(): Promise<string> {
  const creds = getCredentials();
  if (!creds) {
    return '# Configure AWS credentials first';
  }

  try {
    const clients = getClients();
    const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
    const accountId = identity.Account!;
    const region = creds.region;

    return `# Run these commands in your terminal (from the project root):

# 1. Authenticate Docker with ECR
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${accountId}.dkr.ecr.${region}.amazonaws.com

# 2. Build the image
cd cline-setup
docker build -t vibe-coding-lab:latest .

# 3. Tag and push to ECR
docker tag vibe-coding-lab:latest ${accountId}.dkr.ecr.${region}.amazonaws.com/vibe-coding-lab:latest
docker push ${accountId}.dkr.ecr.${region}.amazonaws.com/vibe-coding-lab:latest

# 4. Return to dashboard directory
cd ..`;
  } catch (err: any) {
    return `# Error: ${err.message}`;
  }
}

export interface DockerBuildResult {
  success: boolean;
  step: string;
  message: string;
  error?: string;
}

export async function checkDockerAvailable(): Promise<{ available: boolean; message: string }> {
  try {
    await execAsync('docker --version');
    // Check if Docker daemon is running
    await execAsync('docker info');
    return { available: true, message: 'Docker is available and running' };
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('not recognized')) {
      return { available: false, message: 'Docker is not installed. Please install Docker Desktop.' };
    }
    if (err.message.includes('daemon') || err.message.includes('connect')) {
      return { available: false, message: 'Docker is installed but not running. Please start Docker Desktop.' };
    }
    return { available: false, message: `Docker error: ${err.message}` };
  }
}

// ==========================================
// AI EXTENSION CONFIGURATION
// Add new AI extensions here to scale support
// ==========================================
// Each extension has its own directory with Dockerfile, entrypoint.sh, and config
export const AI_EXTENSIONS = ['continue', 'cline'] as const;
export type AIExtension = typeof AI_EXTENSIONS[number];

// Map extensions to their Dockerfile directories
export const EXTENSION_DIRECTORIES: Record<AIExtension, string> = {
  continue: 'cline-setup',  // Continue uses the cline-setup directory (historical naming)
  cline: 'cline-ai',        // Cline uses the cline-ai directory
};

export async function buildAndPushImage(
  onProgress?: (result: DockerBuildResult) => void,
  extensions?: AIExtension[] // If not provided, builds selected extension. Pass ['continue'] for all
): Promise<{ success: boolean; steps: DockerBuildResult[]; error?: string }> {
  const steps: DockerBuildResult[] = [];
  const report = (result: DockerBuildResult) => {
    steps.push(result);
    onProgress?.(result);
  };

  try {
    const creds = getCredentials();
    if (!creds) {
      throw new Error('AWS credentials not configured');
    }

    // Check Docker availability
    report({ success: true, step: 'check_docker', message: 'Checking Docker availability...' });
    const dockerCheck = await checkDockerAvailable();
    if (!dockerCheck.available) {
      throw new Error(dockerCheck.message);
    }
    report({ success: true, step: 'check_docker', message: dockerCheck.message });

    // Get AWS account ID
    report({ success: true, step: 'get_account', message: 'Getting AWS account info...' });
    const clients = getClients();
    const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
    const accountId = identity.Account!;
    const region = creds.region;
    const ecrRepo = `${accountId}.dkr.ecr.${region}.amazonaws.com/vibe-coding-lab`;
    report({ success: true, step: 'get_account', message: `Account: ${accountId}, Region: ${region}` });

    // Get ECR auth token
    report({ success: true, step: 'ecr_auth', message: 'Getting ECR authentication token...' });
    const ecrClient = new ECRClientFull({
      region: creds.region,
      credentials: {
        accessKeyId: creds.access_key_id,
        secretAccessKey: creds.secret_access_key,
      },
    });
    const authResponse = await ecrClient.send(new GetAuthorizationTokenCommand({}));
    const authData = authResponse.authorizationData?.[0];
    if (!authData?.authorizationToken) {
      throw new Error('Failed to get ECR authorization token');
    }
    const decodedToken = Buffer.from(authData.authorizationToken, 'base64').toString('utf-8');
    const [username, password] = decodedToken.split(':');
    report({ success: true, step: 'ecr_auth', message: 'Got ECR auth token' });

    // Docker login to ECR
    report({ success: true, step: 'docker_login', message: 'Logging into ECR...' });
    const loginCmd = `docker login --username ${username} --password ${password} ${accountId}.dkr.ecr.${region}.amazonaws.com`;
    await execAsync(loginCmd);
    report({ success: true, step: 'docker_login', message: 'Logged into ECR' });

    // Determine which extensions to build
    const extensionsToBuild = extensions || [getConfig('ai_extension') as AIExtension || 'continue'];

    report({ success: true, step: 'get_extension', message: `Building extensions: ${extensionsToBuild.join(', ')}` });

    // Build, tag, and push each extension
    for (const ext of extensionsToBuild) {
      const extTag = ext; // Tag will be :continue or :cline
      const extDir = EXTENSION_DIRECTORIES[ext];
      const dockerfilePath = path.resolve(__dirname, `../../../${extDir}`);

      // Build Docker image
      report({ success: true, step: `docker_build_${ext}`, message: `Building ${ext} image from ${extDir}/ (this may take several minutes)...` });
      const buildCmd = `docker build --no-cache -t vibe-coding-lab:${extTag} "${dockerfilePath}"`;
      await execAsync(buildCmd, { maxBuffer: 50 * 1024 * 1024, timeout: 600000 }); // 50MB buffer, 10min timeout
      report({ success: true, step: `docker_build_${ext}`, message: `Docker image built successfully: ${ext}` });

      // Tag image for ECR
      report({ success: true, step: `docker_tag_${ext}`, message: `Tagging ${ext} image for ECR...` });
      const tagCmd = `docker tag vibe-coding-lab:${extTag} ${ecrRepo}:${extTag}`;
      await execAsync(tagCmd);
      report({ success: true, step: `docker_tag_${ext}`, message: `Tagged as ${ecrRepo}:${extTag}` });

      // Push image
      report({ success: true, step: `docker_push_${ext}`, message: `Pushing ${ext} image to ECR...` });
      const pushCmd = `docker push ${ecrRepo}:${extTag}`;
      await execAsync(pushCmd, { maxBuffer: 50 * 1024 * 1024 });
      report({ success: true, step: `docker_push_${ext}`, message: `Image ${ext} pushed to ECR successfully` });
    }

    // Also tag the first extension as :latest for backwards compatibility
    if (extensionsToBuild.length > 0) {
      const firstExt = extensionsToBuild[0];
      report({ success: true, step: 'docker_tag_latest', message: 'Tagging latest...' });
      await execAsync(`docker tag vibe-coding-lab:${firstExt} ${ecrRepo}:latest`);
      await execAsync(`docker push ${ecrRepo}:latest`, { maxBuffer: 50 * 1024 * 1024 });
      report({ success: true, step: 'docker_tag_latest', message: `Tagged ${firstExt} as :latest` });
    }

    return { success: true, steps };
  } catch (err: any) {
    const errorResult: DockerBuildResult = {
      success: false,
      step: 'error',
      message: 'Build failed',
      error: err.message,
    };
    steps.push(errorResult);
    return { success: false, steps, error: err.message };
  }
}
