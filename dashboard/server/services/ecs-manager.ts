import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  ListClustersCommand,
  RegisterTaskDefinitionCommand,
  DescribeTaskDefinitionCommand,
} from '@aws-sdk/client-ecs';
import {
  EC2Client,
  DescribeNetworkInterfacesCommand,
  DescribeVpcsCommand,
} from '@aws-sdk/client-ec2';
import {
  ECRClient,
  DescribeRepositoriesCommand,
} from '@aws-sdk/client-ecr';
import {
  IAMClient,
  ListRolesCommand,
} from '@aws-sdk/client-iam';
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  CloudFrontClient,
  ListDistributionsCommand,
} from '@aws-sdk/client-cloudfront';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { getConfig, getAllConfig } from '../db/database.js';

// Use default credentials from ECS task role - no need to store credentials
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-southeast-1';

export interface TaskInfo {
  taskArn: string;
  status: string;
  privateIp?: string;
  publicIp?: string;
}

// All clients use default credentials (from ECS task role)
function getECSClient(): ECSClient {
  return new ECSClient({ region: AWS_REGION });
}

function getEC2Client(): EC2Client {
  return new EC2Client({ region: AWS_REGION });
}

function getECRClient(): ECRClient {
  return new ECRClient({ region: AWS_REGION });
}

function getIAMClient(): IAMClient {
  return new IAMClient({ region: AWS_REGION });
}

function getCloudWatchLogsClient(): CloudWatchLogsClient {
  return new CloudWatchLogsClient({ region: AWS_REGION });
}

function getCloudFrontClient(): CloudFrontClient {
  // CloudFront is a global service
  return new CloudFrontClient({ region: 'us-east-1' });
}

function getSTSClient(): STSClient {
  return new STSClient({ region: AWS_REGION });
}

// Export region for other modules
export function getAwsRegion(): string {
  return AWS_REGION;
}

export async function runTask(instanceId: string, extension: string = 'continue'): Promise<TaskInfo> {
  const client = getECSClient();
  const config = getAllConfig();

  const clusterName = config.cluster_name || 'vibe-cluster';
  const baseTaskDefinition = config.task_definition || 'vibe-coding-lab';
  const subnetIds = config.subnet_ids?.split(',').filter(Boolean) || [];
  const securityGroupId = config.security_group_id;
  const ecrRepository = config.ecr_repository;

  if (subnetIds.length === 0) {
    throw new Error('Subnet IDs not configured. Please run automated setup first.');
  }

  if (!securityGroupId) {
    throw new Error('Security group ID not configured. Please run automated setup first.');
  }

  // Get the base task definition to copy its configuration
  const describeResponse = await client.send(
    new DescribeTaskDefinitionCommand({
      taskDefinition: baseTaskDefinition,
    })
  );

  const baseDef = describeResponse.taskDefinition;
  if (!baseDef) {
    throw new Error(`Task definition ${baseTaskDefinition} not found`);
  }

  // Determine the image tag based on extension
  const imageTagMap: Record<string, string> = {
    continue: 'continue',
    cline: 'cline',
    vibe: 'vibe',
  };
  const imageTag = imageTagMap[extension] || 'continue';

  // Build the new image URI
  let imageUri: string;
  if (ecrRepository) {
    // Use configured ECR repository with the appropriate tag
    imageUri = `${ecrRepository}:${imageTag}`;
  } else {
    // Try to extract from the base task definition and modify the tag
    const baseImage = baseDef.containerDefinitions?.[0]?.image;
    if (baseImage) {
      // Replace the tag in the image URI
      const imageWithoutTag = baseImage.replace(/:[\w.-]+$/, '');
      imageUri = `${imageWithoutTag}:${imageTag}`;
    } else {
      throw new Error('Cannot determine image URI. Please configure ECR repository.');
    }
  }

  console.log(`Starting task with image: ${imageUri} for extension: ${extension}`);

  // Register a new task definition revision with the correct image
  const containerDef = baseDef.containerDefinitions?.[0];
  if (!containerDef) {
    throw new Error('No container definition found in base task definition');
  }

  const registerResponse = await client.send(
    new RegisterTaskDefinitionCommand({
      family: baseTaskDefinition,
      taskRoleArn: baseDef.taskRoleArn,
      executionRoleArn: baseDef.executionRoleArn,
      networkMode: baseDef.networkMode,
      requiresCompatibilities: baseDef.requiresCompatibilities,
      cpu: baseDef.cpu,
      memory: baseDef.memory,
      runtimePlatform: baseDef.runtimePlatform,
      containerDefinitions: [
        {
          ...containerDef,
          image: imageUri,
          environment: [
            ...(containerDef.environment || []).filter(
              e => e.name !== 'INSTANCE_ID' && e.name !== 'AWS_REGION' && e.name !== 'AI_EXTENSION' && e.name !== 'INSTANCE_MODE' && e.name !== 'BEDROCK_MODEL_ID'
            ),
            { name: 'INSTANCE_ID', value: instanceId },
            { name: 'AWS_REGION', value: AWS_REGION },
            { name: 'AI_EXTENSION', value: extension },
            ...(extension === 'vibe' ? [
              { name: 'INSTANCE_MODE', value: 'vibe' },
            ] : []),
            { name: 'BEDROCK_MODEL_ID', value: process.env.BEDROCK_MODEL_ID || `${AWS_REGION.startsWith('ap-') ? 'apac' : AWS_REGION.startsWith('eu-') ? 'eu' : 'us'}.anthropic.claude-sonnet-4-20250514-v1:0` },
          ],
        },
      ],
      volumes: baseDef.volumes,
    })
  );

  const newTaskDefArn = registerResponse.taskDefinition?.taskDefinitionArn;
  if (!newTaskDefArn) {
    throw new Error('Failed to register task definition');
  }

  console.log(`Registered task definition: ${newTaskDefArn}`);

  // Run the task with the new task definition
  const response = await client.send(
    new RunTaskCommand({
      cluster: clusterName,
      taskDefinition: newTaskDefArn,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: subnetIds,
          securityGroups: [securityGroupId],
          assignPublicIp: 'ENABLED',
        },
      },
    })
  );

  const task = response.tasks?.[0];
  if (!task || !task.taskArn) {
    throw new Error('Failed to start ECS task');
  }

  return {
    taskArn: task.taskArn,
    status: task.lastStatus || 'PROVISIONING',
  };
}

export async function stopTask(taskArn: string): Promise<void> {
  const client = getECSClient();
  const config = getAllConfig();
  const clusterName = config.cluster_name || 'vibe-cluster';

  await client.send(
    new StopTaskCommand({
      cluster: clusterName,
      task: taskArn,
      reason: 'User requested stop from dashboard',
    })
  );
}

export async function getTaskStatus(taskArn: string): Promise<TaskInfo | null> {
  const client = getECSClient();
  const config = getAllConfig();
  const clusterName = config.cluster_name || 'vibe-cluster';

  try {
    const response = await client.send(
      new DescribeTasksCommand({
        cluster: clusterName,
        tasks: [taskArn],
      })
    );

    const task = response.tasks?.[0];
    if (!task) {
      return null;
    }

    const eniAttachment = task.attachments?.find(a => a.type === 'ElasticNetworkInterface');
    const eniId = eniAttachment?.details?.find(d => d.name === 'networkInterfaceId')?.value;

    let publicIp: string | undefined;
    let privateIp: string | undefined;

    if (eniId) {
      try {
        const ec2Client = getEC2Client();
        const eniResponse = await ec2Client.send(
          new DescribeNetworkInterfacesCommand({
            NetworkInterfaceIds: [eniId],
          })
        );
        const eni = eniResponse.NetworkInterfaces?.[0];
        publicIp = eni?.Association?.PublicIp;
        privateIp = eni?.PrivateIpAddress;
      } catch (err) {
        // ENI might not be ready yet
      }
    }

    return {
      taskArn: task.taskArn!,
      status: task.lastStatus || 'UNKNOWN',
      publicIp,
      privateIp,
    };
  } catch (err) {
    console.error('Error getting task status:', err);
    return null;
  }
}

export async function listAllTasks(): Promise<string[]> {
  const client = getECSClient();
  const config = getAllConfig();
  const clusterName = config.cluster_name || 'vibe-cluster';

  const response = await client.send(
    new ListTasksCommand({
      cluster: clusterName,
    })
  );

  return response.taskArns || [];
}

export interface RunningTaskInfo {
  taskArn: string;
  taskId: string;
  status: string;
  publicIp?: string;
  privateIp?: string;
  startedAt?: Date;
  taskDefinition?: string;
}

export async function getAllRunningTasks(): Promise<RunningTaskInfo[]> {
  const client = getECSClient();
  const ec2Client = getEC2Client();
  const config = getAllConfig();
  const clusterName = config.cluster_name || 'vibe-cluster';
  // Get the task definition family for coding labs (to filter out dashboard tasks)
  const codingLabTaskDef = config.task_definition || 'vibe-coding-lab';

  const listResponse = await client.send(
    new ListTasksCommand({
      cluster: clusterName,
      // Filter by the coding lab task definition family
      family: codingLabTaskDef,
    })
  );

  const taskArns = listResponse.taskArns || [];
  if (taskArns.length === 0) {
    return [];
  }

  const describeResponse = await client.send(
    new DescribeTasksCommand({
      cluster: clusterName,
      tasks: taskArns,
    })
  );

  const tasks: RunningTaskInfo[] = [];

  for (const task of describeResponse.tasks || []) {
    const taskId = task.taskArn?.split('/').pop() || '';
    const taskDefName = task.taskDefinitionArn?.split('/').pop() || '';

    // Double-check: only include tasks from the coding lab task definition family
    // This filters out dashboard tasks and other services
    if (!taskDefName.startsWith(codingLabTaskDef)) {
      continue;
    }

    const eniAttachment = task.attachments?.find(a => a.type === 'ElasticNetworkInterface');
    const eniId = eniAttachment?.details?.find(d => d.name === 'networkInterfaceId')?.value;

    let publicIp: string | undefined;
    let privateIp: string | undefined;

    if (eniId) {
      try {
        const eniResponse = await ec2Client.send(
          new DescribeNetworkInterfacesCommand({
            NetworkInterfaceIds: [eniId],
          })
        );
        const eni = eniResponse.NetworkInterfaces?.[0];
        publicIp = eni?.Association?.PublicIp;
        privateIp = eni?.PrivateIpAddress;
      } catch (err) {
        // ENI might not be ready
      }
    }

    tasks.push({
      taskArn: task.taskArn!,
      taskId,
      status: task.lastStatus || 'UNKNOWN',
      publicIp,
      privateIp,
      startedAt: task.startedAt,
      taskDefinition: taskDefName,
    });
  }

  return tasks;
}

export interface PermissionCheck {
  service: string;
  permission: string;
  status: 'granted' | 'denied' | 'error';
  message: string;
}

export interface ValidateCredentialsResult {
  valid: boolean;
  message: string;
  accountId?: string;
  region?: string;
  permissions?: PermissionCheck[];
}

export async function validateCredentials(): Promise<ValidateCredentialsResult> {
  const permissions: PermissionCheck[] = [];
  let accountId: string | undefined;

  // First check if we can get caller identity (basic credential check)
  try {
    const stsClient = getSTSClient();
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    accountId = identity.Account;
  } catch (err: any) {
    return {
      valid: false,
      message: 'Unable to access AWS - task role may not be configured correctly',
      region: AWS_REGION,
    };
  }

  // Check ECS permissions
  try {
    const ecsClient = getECSClient();
    await ecsClient.send(new ListClustersCommand({ maxResults: 1 }));
    permissions.push({
      service: 'ECS',
      permission: 'ecs:ListClusters',
      status: 'granted',
      message: 'Can manage ECS clusters and tasks',
    });
  } catch (err: any) {
    permissions.push({
      service: 'ECS',
      permission: 'ecs:ListClusters',
      status: err.name === 'AccessDeniedException' ? 'denied' : 'error',
      message: err.name === 'AccessDeniedException'
        ? 'Missing ECS permissions - add AmazonECS_FullAccess to task role'
        : err.message,
    });
  }

  // Check EC2 permissions
  try {
    const ec2Client = getEC2Client();
    await ec2Client.send(new DescribeVpcsCommand({ MaxResults: 5 }));
    permissions.push({
      service: 'EC2',
      permission: 'ec2:DescribeVpcs',
      status: 'granted',
      message: 'Can read VPC and networking info',
    });
  } catch (err: any) {
    permissions.push({
      service: 'EC2',
      permission: 'ec2:DescribeVpcs',
      status: err.name === 'UnauthorizedOperation' ? 'denied' : 'error',
      message: err.name === 'UnauthorizedOperation'
        ? 'Missing EC2 permissions - add AmazonEC2ReadOnlyAccess to task role'
        : err.message,
    });
  }

  // Check ECR permissions
  try {
    const ecrClient = getECRClient();
    await ecrClient.send(new DescribeRepositoriesCommand({ maxResults: 1 }));
    permissions.push({
      service: 'ECR',
      permission: 'ecr:DescribeRepositories',
      status: 'granted',
      message: 'Can manage container registry',
    });
  } catch (err: any) {
    permissions.push({
      service: 'ECR',
      permission: 'ecr:DescribeRepositories',
      status: err.name === 'AccessDeniedException' ? 'denied' : 'error',
      message: err.name === 'AccessDeniedException'
        ? 'Missing ECR permissions - add AmazonEC2ContainerRegistryFullAccess to task role'
        : err.message,
    });
  }

  // Check IAM permissions
  try {
    const iamClient = getIAMClient();
    await iamClient.send(new ListRolesCommand({ MaxItems: 1 }));
    permissions.push({
      service: 'IAM',
      permission: 'iam:ListRoles',
      status: 'granted',
      message: 'Can manage IAM roles',
    });
  } catch (err: any) {
    permissions.push({
      service: 'IAM',
      permission: 'iam:ListRoles',
      status: err.name === 'AccessDeniedException' ? 'denied' : 'error',
      message: err.name === 'AccessDeniedException'
        ? 'Missing IAM permissions (optional - only needed for automated setup)'
        : err.message,
    });
  }

  // Check CloudWatch Logs permissions
  try {
    const cwLogsClient = getCloudWatchLogsClient();
    await cwLogsClient.send(new DescribeLogGroupsCommand({ limit: 1 }));
    permissions.push({
      service: 'CloudWatch Logs',
      permission: 'logs:DescribeLogGroups',
      status: 'granted',
      message: 'Can view container logs',
    });
  } catch (err: any) {
    permissions.push({
      service: 'CloudWatch Logs',
      permission: 'logs:DescribeLogGroups',
      status: err.name === 'AccessDeniedException' ? 'denied' : 'error',
      message: err.name === 'AccessDeniedException'
        ? 'Missing CloudWatch Logs permissions - add CloudWatchLogsFullAccess to task role'
        : err.message,
    });
  }

  // Check CloudFront permissions
  try {
    const cfClient = getCloudFrontClient();
    await cfClient.send(new ListDistributionsCommand({ MaxItems: 1 }));
    permissions.push({
      service: 'CloudFront',
      permission: 'cloudfront:ListDistributions',
      status: 'granted',
      message: 'Can manage CloudFront for HTTPS',
    });
  } catch (err: any) {
    permissions.push({
      service: 'CloudFront',
      permission: 'cloudfront:ListDistributions',
      status: err.name === 'AccessDeniedException' ? 'denied' : 'error',
      message: err.name === 'AccessDeniedException'
        ? 'Missing CloudFront permissions - add CloudFrontFullAccess to task role'
        : err.message,
    });
  }

  const deniedCount = permissions.filter(p => p.status === 'denied').length;
  const grantedCount = permissions.filter(p => p.status === 'granted').length;

  const corePermissions = permissions.filter(p =>
    p.service === 'ECS' || p.service === 'EC2' || p.service === 'ECR'
  );
  const coreGranted = corePermissions.every(p => p.status === 'granted');

  if (coreGranted) {
    return {
      valid: true,
      message: deniedCount === 0
        ? `All ${grantedCount} permissions granted`
        : `Core permissions OK. ${deniedCount} optional permission(s) missing.`,
      accountId,
      region: AWS_REGION,
      permissions,
    };
  }

  return {
    valid: false,
    message: `Missing ${deniedCount} required permission(s). Add policies to the ecsTaskRole.`,
    accountId,
    region: AWS_REGION,
    permissions,
  };
}
