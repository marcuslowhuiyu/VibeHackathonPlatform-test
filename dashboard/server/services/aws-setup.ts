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
  UpdateAssumeRolePolicyCommand,
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
  DescribeImagesCommand,
  GetAuthorizationTokenCommand,
} from '@aws-sdk/client-ecr';
import {
  STSClient,
  GetCallerIdentityCommand,
} from '@aws-sdk/client-sts';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { setConfig, getConfig } from '../db/database.js';
import { ensureCodingLabALB, ensureCodingLabCloudFront, saveCodingLabALBConfig } from './coding-lab-alb.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use default credentials from ECS task role
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-southeast-1';

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
    ecr_repository: string;
  };
  error?: string;
}

function getClients() {
  return {
    ecs: new ECSClient({ region: AWS_REGION }),
    ec2: new EC2Client({ region: AWS_REGION }),
    iam: new IAMClient({ region: AWS_REGION }),
    ecr: new ECRClient({ region: AWS_REGION }),
    sts: new STSClient({ region: AWS_REGION }),
    codebuild: new CodeBuildClient({ region: AWS_REGION }),
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
    Resource: [
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
      'arn:aws:bedrock:*:*:inference-profile/*anthropic.claude-*',
    ],
  }],
});

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

// ELB permissions for creating/managing shared ALB
const ELB_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Action: [
      'elasticloadbalancing:CreateLoadBalancer',
      'elasticloadbalancing:CreateTargetGroup',
      'elasticloadbalancing:CreateListener',
      'elasticloadbalancing:CreateRule',
      'elasticloadbalancing:DeleteLoadBalancer',
      'elasticloadbalancing:DeleteTargetGroup',
      'elasticloadbalancing:DeleteListener',
      'elasticloadbalancing:DeleteRule',
      'elasticloadbalancing:RegisterTargets',
      'elasticloadbalancing:DeregisterTargets',
      'elasticloadbalancing:DescribeLoadBalancers',
      'elasticloadbalancing:DescribeTargetGroups',
      'elasticloadbalancing:DescribeListeners',
      'elasticloadbalancing:DescribeRules',
      'elasticloadbalancing:DescribeTags',
      'elasticloadbalancing:ModifyTargetGroupAttributes',
      'elasticloadbalancing:DescribeTargetHealth',
      'elasticloadbalancing:ModifyTargetGroup',
      'elasticloadbalancing:AddTags',
    ],
    Resource: '*',
  }],
});

// CloudFront permissions for creating/managing shared distribution
const CLOUDFRONT_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Action: [
      'cloudfront:CreateDistribution',
      'cloudfront:GetDistribution',
      'cloudfront:UpdateDistribution',
      'cloudfront:DeleteDistribution',
      'cloudfront:ListDistributions',
      'cloudfront:TagResource',
    ],
    Resource: '*',
  }],
});

const CODEBUILD_TRUST_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: { Service: 'codebuild.amazonaws.com' },
    Action: 'sts:AssumeRole',
  }],
});

function getCodeBuildPolicy(accountId: string, region: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['ecr:GetAuthorizationToken'],
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
    const subnetIds = subnets
      .slice(0, 2)
      .map((s) => s.SubnetId!)
      .join(',');
    report({ step: 'get_subnets', status: 'completed', message: `Found subnets: ${subnetIds}`, resourceId: subnetIds });

    // Step 3: Create or get security group
    report({ step: 'create_security_group', status: 'in_progress', message: 'Creating security group...' });
    let securityGroupId: string;
    try {
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
      const sgResponse = await clients.ec2.send(new CreateSecurityGroupCommand({
        GroupName: 'vibe-ecs-sg',
        Description: 'Security group for Vibe Hackathon ECS tasks',
        VpcId: vpcId,
      }));
      securityGroupId = sgResponse.GroupId!;
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
      try {
        await clients.iam.send(new PutRolePolicyCommand({
          RoleName: 'ecsTaskExecutionRole',
          PolicyName: 'CloudWatchLogsAccess',
          PolicyDocument: CLOUDWATCH_LOGS_POLICY,
        }));
      } catch {
        // Policy might already exist
      }
      report({ step: 'create_execution_role', status: 'skipped', message: 'Execution role already exists', resourceId: executionRoleArn });
    } catch {
      const roleResponse = await clients.iam.send(new CreateRoleCommand({
        RoleName: 'ecsTaskExecutionRole',
        AssumeRolePolicyDocument: ECS_TRUST_POLICY,
      }));
      executionRoleArn = roleResponse.Role!.Arn!;
      await clients.iam.send(new AttachRolePolicyCommand({
        RoleName: 'ecsTaskExecutionRole',
        PolicyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
      }));
      await clients.iam.send(new PutRolePolicyCommand({
        RoleName: 'ecsTaskExecutionRole',
        PolicyName: 'CloudWatchLogsAccess',
        PolicyDocument: CLOUDWATCH_LOGS_POLICY,
      }));
      report({ step: 'create_execution_role', status: 'completed', message: 'Created execution role', resourceId: executionRoleArn });
    }

    // Add ELB and CloudFront permissions to the dashboard's task role (ecsTaskRole)
    // This allows the dashboard to create/manage the shared ALB and CloudFront
    report({ step: 'add_alb_permissions', status: 'in_progress', message: 'Adding ALB/CloudFront permissions to dashboard role...' });
    try {
      // Add ELB permissions
      await clients.iam.send(new PutRolePolicyCommand({
        RoleName: 'ecsTaskRole',
        PolicyName: 'ELBAccess',
        PolicyDocument: ELB_POLICY,
      }));
      // Add CloudFront permissions
      await clients.iam.send(new PutRolePolicyCommand({
        RoleName: 'ecsTaskRole',
        PolicyName: 'CloudFrontAccess',
        PolicyDocument: CLOUDFRONT_POLICY,
      }));
      report({ step: 'add_alb_permissions', status: 'completed', message: 'Added ALB/CloudFront permissions to ecsTaskRole' });
    } catch (permErr: any) {
      // Role might not exist yet if this is first setup, or permissions might already be there
      console.log('Note: Could not add ALB/CloudFront permissions to ecsTaskRole:', permErr.message);
      report({ step: 'add_alb_permissions', status: 'skipped', message: 'Could not add permissions (role may not exist or already configured)' });
    }

    // Step 5: Create task role
    report({ step: 'create_task_role', status: 'in_progress', message: 'Creating ECS task role with Bedrock access...' });
    let taskRoleArn: string;
    try {
      const existingRole = await clients.iam.send(new GetRoleCommand({ RoleName: 'vibeTaskRole' }));
      taskRoleArn = existingRole.Role!.Arn!;
      // Always update the Bedrock policy to ensure inference-profile access
      await clients.iam.send(new PutRolePolicyCommand({
        RoleName: 'vibeTaskRole',
        PolicyName: 'BedrockAccess',
        PolicyDocument: BEDROCK_POLICY,
      }));
      report({ step: 'create_task_role', status: 'skipped', message: 'Task role already exists (policy updated)', resourceId: taskRoleArn });
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
      report({ step: 'create_task_role', status: 'completed', message: 'Created task role', resourceId: taskRoleArn });
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
          { name: 'AWS_REGION', value: AWS_REGION },
        ],
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': '/ecs/vibe-coding-lab',
            'awslogs-region': AWS_REGION,
            'awslogs-stream-prefix': 'vibe',
            'awslogs-create-group': 'true',
          },
        },
      }],
    }));
    report({ step: 'register_task_definition', status: 'completed', message: 'Registered task definition', resourceId: taskDefinitionFamily });

    // Step 9: Create CodeBuild role
    report({ step: 'create_codebuild_role', status: 'in_progress', message: 'Creating CodeBuild service role...' });
    let codebuildRoleArn: string;
    const codebuildRoleName = 'codebuild-vibe-service-role';
    let roleCreated = false;
    try {
      const existingRole = await clients.iam.send(new GetRoleCommand({ RoleName: codebuildRoleName }));
      codebuildRoleArn = existingRole.Role!.Arn!;

      // Update trust policy to ensure CodeBuild can assume this role
      try {
        await clients.iam.send(new UpdateAssumeRolePolicyCommand({
          RoleName: codebuildRoleName,
          PolicyDocument: CODEBUILD_TRUST_POLICY,
        }));
      } catch (trustErr: any) {
        console.log('Trust policy update:', trustErr.message);
      }

      // Update permissions policy
      try {
        await clients.iam.send(new PutRolePolicyCommand({
          RoleName: codebuildRoleName,
          PolicyName: 'CodeBuildPermissions',
          PolicyDocument: getCodeBuildPolicy(accountId, AWS_REGION),
        }));
      } catch {
        // Policy update failed
      }
      report({ step: 'create_codebuild_role', status: 'skipped', message: 'CodeBuild role already exists (updated trust policy)', resourceId: codebuildRoleArn });
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
        PolicyDocument: getCodeBuildPolicy(accountId, AWS_REGION),
      }));
      roleCreated = true;
      report({ step: 'create_codebuild_role', status: 'completed', message: 'Created CodeBuild service role', resourceId: codebuildRoleArn });
    }

    // Wait for IAM role to propagate (important for newly created or updated roles)
    if (roleCreated) {
      report({ step: 'create_codebuild_role', status: 'in_progress', message: 'Waiting for IAM role to propagate...' });
      await new Promise(resolve => setTimeout(resolve, 10000));
    } else {
      // Even for existing roles, wait a bit after trust policy update
      await new Promise(resolve => setTimeout(resolve, 3000));
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
      const buildspec = `version: 0.2
phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
  build:
    commands:
      - echo "=== Building Continue extension from continue-instance/ ==="
      - cd continue-instance
      - docker build -t vibe-coding-lab:continue .
      - docker tag vibe-coding-lab:continue $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:continue
      - docker tag vibe-coding-lab:continue $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:latest
      - cd ..
      - echo "=== Building Cline extension from cline-instance/ ==="
      - cd cline-instance
      - docker build -t vibe-coding-lab:cline .
      - docker tag vibe-coding-lab:cline $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:cline
      - cd ..
      - echo "=== Building Vibe extension from vibe-instance/ ==="
      - cd vibe-instance
      - docker build -t vibe-coding-lab:vibe .
      - docker tag vibe-coding-lab:vibe $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:vibe
      - cd ..
      - echo "=== Building Loclaude Lite extension from loclaude-lite-instance/ ==="
      - cd loclaude-lite-instance
      - docker build -t vibe-coding-lab:loclaude-lite .
      - docker tag vibe-coding-lab:loclaude-lite $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:loclaude-lite
      - cd ..
      - echo "=== Building Loclaude extension from loclaude-instance/ ==="
      - cd loclaude-instance
      - docker build -t vibe-coding-lab:loclaude .
      - docker tag vibe-coding-lab:loclaude $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:loclaude
      - cd ..
  post_build:
    commands:
      - echo Pushing the Docker images...
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:continue
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:cline
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:vibe
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:loclaude-lite
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:loclaude
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/vibe-coding-lab:latest
      - echo Build completed
`;

      await clients.codebuild.send(new CreateProjectCommand({
        name: codebuildProjectName,
        description: 'Builds Vibe Coding Lab Docker images',
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
          image: 'aws/codebuild/standard:7.0',
          privilegedMode: true,
          environmentVariables: [
            { name: 'AWS_ACCOUNT_ID', value: accountId },
            { name: 'AWS_DEFAULT_REGION', value: AWS_REGION },
          ],
        },
        serviceRole: codebuildRoleArn,
      }));
      report({ step: 'create_codebuild_project', status: 'completed', message: 'Created CodeBuild project', resourceId: codebuildProjectName });
    }

    // Step 11: Create shared ALB for coding instances
    report({ step: 'create_shared_alb', status: 'in_progress', message: 'Creating shared ALB for coding instances...' });
    let albConfig;
    try {
      albConfig = await ensureCodingLabALB(vpcId, subnetIds.split(','), securityGroupId);
      report({ step: 'create_shared_alb', status: 'completed', message: `ALB created: ${albConfig.albDnsName}`, resourceId: albConfig.albArn });
    } catch (albErr: any) {
      report({ step: 'create_shared_alb', status: 'failed', message: `Failed to create ALB: ${albErr.message}` });
      throw new Error(`Failed to create shared ALB: ${albErr.message}`);
    }

    // Step 12: Create shared CloudFront distribution
    report({ step: 'create_shared_cloudfront', status: 'in_progress', message: 'Creating shared CloudFront distribution...' });
    let cfConfig;
    try {
      cfConfig = await ensureCodingLabCloudFront(albConfig.albDnsName);
      report({ step: 'create_shared_cloudfront', status: 'completed', message: `CloudFront: ${cfConfig.domain}`, resourceId: cfConfig.distributionId });
    } catch (cfErr: any) {
      report({ step: 'create_shared_cloudfront', status: 'failed', message: `Failed to create CloudFront: ${cfErr.message}` });
      throw new Error(`Failed to create shared CloudFront: ${cfErr.message}`);
    }

    // Save ALB/CloudFront config
    saveCodingLabALBConfig({
      ...albConfig,
      cloudfrontDistributionId: cfConfig.distributionId,
      cloudfrontDomain: cfConfig.domain,
    });

    // Save config
    const config = {
      cluster_name: clusterName,
      task_definition: taskDefinitionFamily,
      vpc_id: vpcId,
      subnet_ids: subnetIds,
      security_group_id: securityGroupId,
      ecr_repository: ecrRepoUri,
    };

    setConfig('cluster_name', config.cluster_name);
    setConfig('task_definition', config.task_definition);
    setConfig('vpc_id', config.vpc_id);
    setConfig('subnet_ids', config.subnet_ids);
    setConfig('security_group_id', config.security_group_id);
    setConfig('ecr_repository', config.ecr_repository);

    report({ step: 'save_config', status: 'completed', message: 'Saved configuration to dashboard' });

    return { success: true, steps, config };
  } catch (err: any) {
    return { success: false, steps, error: err.message };
  }
}

export const AI_EXTENSIONS = ['continue', 'cline', 'vibe', 'loclaude-lite', 'loclaude'] as const;
export type AIExtension = typeof AI_EXTENSIONS[number];

export const EXTENSION_DIRECTORIES: Record<AIExtension, string> = {
  continue: 'continue-instance',
  cline: 'cline-instance',
  vibe: 'vibe-instance',
  'loclaude-lite': 'loclaude-lite-instance',
  loclaude: 'loclaude-instance',
};

export async function checkSetupStatus(): Promise<{
  configured: boolean;
  missing: string[];
  ecrImageExists: boolean;
  imageUri: string | null;
  availableImages: AIExtension[];
  sharedAlbConfigured: boolean;
  cloudfrontDomain: string | null;
}> {
  const missing: string[] = [];
  let ecrImageExists = false;
  let imageUri: string | null = null;
  const availableImages: AIExtension[] = [];
  let sharedAlbConfigured = false;
  let cloudfrontDomain: string | null = null;

  try {
    const clients = getClients();

    // Get account ID
    let accountId: string | null = null;
    try {
      const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
      accountId = identity.Account || null;
      if (accountId) {
        // Show base repository URI - actual tag depends on selected extension
        imageUri = `${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab`;
      }
    } catch {
      return { configured: false, missing: ['AWS access (check task role)'], ecrImageExists: false, imageUri: null, availableImages: [], sharedAlbConfigured: false, cloudfrontDomain: null };
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

    // Check ECR repo and images
    try {
      const repo = await clients.ecr.send(new DescribeRepositoriesCommand({
        repositoryNames: ['vibe-coding-lab'],
      }));
      if (repo.repositories && repo.repositories.length > 0) {
        for (const ext of AI_EXTENSIONS) {
          try {
            const images = await clients.ecr.send(new DescribeImagesCommand({
              repositoryName: 'vibe-coding-lab',
              imageIds: [{ imageTag: ext }],
            }));
            if ((images.imageDetails?.length || 0) > 0) {
              availableImages.push(ext);
            }
          } catch {
            // Image doesn't exist
          }
        }

        try {
          const images = await clients.ecr.send(new DescribeImagesCommand({
            repositoryName: 'vibe-coding-lab',
            imageIds: [{ imageTag: 'latest' }],
          }));
          ecrImageExists = (images.imageDetails?.length || 0) > 0;
          if (ecrImageExists && availableImages.length === 0) {
            availableImages.push('continue');
          }
        } catch {
          ecrImageExists = false;
        }

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

    // Check shared ALB/CloudFront configuration
    const albArn = getConfig('coding_lab_alb_arn');
    const listenerArn = getConfig('coding_lab_listener_arn');
    cloudfrontDomain = getConfig('coding_lab_cloudfront_domain') || null;

    if (albArn && listenerArn && cloudfrontDomain) {
      sharedAlbConfigured = true;
    } else {
      missing.push('Shared ALB/CloudFront');
    }

    return { configured: missing.length === 0, missing, ecrImageExists, imageUri, availableImages, sharedAlbConfigured, cloudfrontDomain };
  } catch (err: any) {
    return { configured: false, missing: ['Unable to check: ' + err.message], ecrImageExists: false, imageUri: null, availableImages: [], sharedAlbConfigured: false, cloudfrontDomain: null };
  }
}

export async function getDockerPushCommands(): Promise<string> {
  try {
    const clients = getClients();
    const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
    const accountId = identity.Account!;

    return `# Run these commands in your terminal (from the project root):

# 1. Authenticate Docker with ECR
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com

# 2. Build and push Continue image
cd continue-instance
docker build -t vibe-coding-lab:continue .
docker tag vibe-coding-lab:continue ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:continue
docker tag vibe-coding-lab:continue ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:latest
docker push ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:continue
docker push ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:latest
cd ..

# 3. Build and push Cline image
cd cline-instance
docker build -t vibe-coding-lab:cline .
docker tag vibe-coding-lab:cline ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:cline
docker push ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:cline
cd ..

# 4. Build and push Vibe image
cd vibe-instance
docker build -t vibe-coding-lab:vibe .
docker tag vibe-coding-lab:vibe ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:vibe
docker push ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:vibe
cd ..

# 5. Build and push Loclaude Lite image
cd loclaude-lite-instance
docker build -t vibe-coding-lab:loclaude-lite .
docker tag vibe-coding-lab:loclaude-lite ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:loclaude-lite
docker push ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:loclaude-lite
cd ..

# 6. Build and push Loclaude image
cd loclaude-instance
docker build -t vibe-coding-lab:loclaude .
docker tag vibe-coding-lab:loclaude ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:loclaude
docker push ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab:loclaude
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

export async function buildAndPushImage(
  onProgress?: (result: DockerBuildResult) => void,
  extensions?: AIExtension[]
): Promise<{ success: boolean; steps: DockerBuildResult[]; error?: string }> {
  const steps: DockerBuildResult[] = [];
  const report = (result: DockerBuildResult) => {
    steps.push(result);
    onProgress?.(result);
  };

  try {
    // Check Docker
    report({ success: true, step: 'check_docker', message: 'Checking Docker availability...' });
    const dockerCheck = await checkDockerAvailable();
    if (!dockerCheck.available) {
      throw new Error(dockerCheck.message);
    }
    report({ success: true, step: 'check_docker', message: dockerCheck.message });

    // Get AWS account
    report({ success: true, step: 'get_account', message: 'Getting AWS account info...' });
    const clients = getClients();
    const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
    const accountId = identity.Account!;
    const ecrRepo = `${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com/vibe-coding-lab`;
    report({ success: true, step: 'get_account', message: `Account: ${accountId}, Region: ${AWS_REGION}` });

    // Get ECR auth
    report({ success: true, step: 'ecr_auth', message: 'Getting ECR authentication token...' });
    const authResponse = await clients.ecr.send(new GetAuthorizationTokenCommand({}));
    const authData = authResponse.authorizationData?.[0];
    if (!authData?.authorizationToken) {
      throw new Error('Failed to get ECR authorization token');
    }
    const decodedToken = Buffer.from(authData.authorizationToken, 'base64').toString('utf-8');
    const [username, password] = decodedToken.split(':');
    report({ success: true, step: 'ecr_auth', message: 'Got ECR auth token' });

    // Docker login
    report({ success: true, step: 'docker_login', message: 'Logging into ECR...' });
    const loginCmd = `docker login --username ${username} --password ${password} ${accountId}.dkr.ecr.${AWS_REGION}.amazonaws.com`;
    await execAsync(loginCmd);
    report({ success: true, step: 'docker_login', message: 'Logged into ECR' });

    // Build extensions
    const extensionsToBuild = extensions || [getConfig('ai_extension') as AIExtension || 'continue'];
    report({ success: true, step: 'get_extension', message: `Building extensions: ${extensionsToBuild.join(', ')}` });

    for (const ext of extensionsToBuild) {
      const extDir = EXTENSION_DIRECTORIES[ext];
      const dockerfilePath = path.resolve(__dirname, `../../../${extDir}`);

      report({ success: true, step: `docker_build_${ext}`, message: `Building ${ext} image...` });
      const buildCmd = `docker build --no-cache -t vibe-coding-lab:${ext} "${dockerfilePath}"`;
      await execAsync(buildCmd, { maxBuffer: 50 * 1024 * 1024, timeout: 600000 });
      report({ success: true, step: `docker_build_${ext}`, message: `Built ${ext} image` });

      report({ success: true, step: `docker_tag_${ext}`, message: `Tagging ${ext} image...` });
      await execAsync(`docker tag vibe-coding-lab:${ext} ${ecrRepo}:${ext}`);
      report({ success: true, step: `docker_tag_${ext}`, message: `Tagged ${ecrRepo}:${ext}` });

      report({ success: true, step: `docker_push_${ext}`, message: `Pushing ${ext} image...` });
      await execAsync(`docker push ${ecrRepo}:${ext}`, { maxBuffer: 50 * 1024 * 1024 });
      report({ success: true, step: `docker_push_${ext}`, message: `Pushed ${ext} image` });
    }

    // Tag latest
    if (extensionsToBuild.length > 0) {
      const firstExt = extensionsToBuild[0];
      report({ success: true, step: 'docker_tag_latest', message: 'Tagging latest...' });
      await execAsync(`docker tag vibe-coding-lab:${firstExt} ${ecrRepo}:latest`);
      await execAsync(`docker push ${ecrRepo}:latest`, { maxBuffer: 50 * 1024 * 1024 });
      report({ success: true, step: 'docker_tag_latest', message: `Tagged ${firstExt} as :latest` });
    }

    return { success: true, steps };
  } catch (err: any) {
    steps.push({ success: false, step: 'error', message: 'Build failed', error: err.message });
    return { success: false, steps, error: err.message };
  }
}
