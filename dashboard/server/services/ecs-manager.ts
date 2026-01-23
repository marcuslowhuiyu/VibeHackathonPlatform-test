import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  ListClustersCommand,
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
import { getCredentials, getConfig, getAllConfig } from '../db/database.js';

// Validates AWS credentials and checks permissions for ECS, ECR, EC2, IAM, CloudWatch Logs

export interface TaskInfo {
  taskArn: string;
  status: string;
  privateIp?: string;
  publicIp?: string;
}

function getECSClient(): ECSClient {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  return new ECSClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  });
}

function getEC2Client(): EC2Client {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  return new EC2Client({
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  });
}

function getECRClient(): ECRClient {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  return new ECRClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  });
}

function getIAMClient(): IAMClient {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  return new IAMClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  });
}

function getCloudWatchLogsClient(): CloudWatchLogsClient {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  return new CloudWatchLogsClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  });
}

function getCloudFrontClient(): CloudFrontClient {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  // CloudFront is a global service
  return new CloudFrontClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  });
}

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

function getSTSClient(): STSClient {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  return new STSClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  });
}

export async function runTask(instanceId: string, extension: string = 'continue'): Promise<TaskInfo> {
  const client = getECSClient();
  const creds = getCredentials();
  const config = getAllConfig();

  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  const clusterName = config.cluster_name || 'vibe-cluster';
  const taskDefinition = config.task_definition || 'vibe-coding-lab';
  const subnetIds = config.subnet_ids?.split(',').filter(Boolean) || [];
  const securityGroupId = config.security_group_id;

  if (subnetIds.length === 0) {
    throw new Error('Subnet IDs not configured. Please set up AWS config first.');
  }

  if (!securityGroupId) {
    throw new Error('Security group ID not configured. Please set up AWS config first.');
  }

  // Get AWS account ID to construct ECR image URI
  const stsClient = getSTSClient();
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account;

  // Construct image URI with extension tag
  const imageUri = `${accountId}.dkr.ecr.${creds.region}.amazonaws.com/vibe-coding-lab:${extension}`;

  const response = await client.send(
    new RunTaskCommand({
      cluster: clusterName,
      taskDefinition: taskDefinition,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: subnetIds,
          securityGroups: [securityGroupId],
          assignPublicIp: 'ENABLED', // Enable for direct access (simpler setup)
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'vibe-container',
            // Override the image to use the extension-specific tag
            image: imageUri,
            environment: [
              { name: 'INSTANCE_ID', value: instanceId },
              // Pass AWS credentials for AI extension/Bedrock access
              { name: 'AWS_ACCESS_KEY_ID', value: creds.access_key_id },
              { name: 'AWS_SECRET_ACCESS_KEY', value: creds.secret_access_key },
              { name: 'AWS_REGION', value: creds.region },
              // Pass selected AI extension (continue, cline, or roo-code)
              { name: 'AI_EXTENSION', value: extension },
            ],
          },
        ],
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

    // Get the ENI attachment to find the IP
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

export interface PermissionCheck {
  service: string;
  permission: string;
  status: 'granted' | 'denied' | 'error';
  message: string;
}

export interface ValidateCredentialsResult {
  valid: boolean;
  message: string;
  permissions?: PermissionCheck[];
}

export async function validateCredentials(): Promise<ValidateCredentialsResult> {
  const permissions: PermissionCheck[] = [];

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
    if (err.name === 'AccessDeniedException' || err.message?.includes('not authorized')) {
      permissions.push({
        service: 'ECS',
        permission: 'ecs:ListClusters',
        status: 'denied',
        message: 'Missing ECS permissions - need AmazonECS_FullAccess policy',
      });
    } else {
      permissions.push({
        service: 'ECS',
        permission: 'ecs:ListClusters',
        status: 'error',
        message: err.message || 'Unknown error checking ECS',
      });
    }
  }

  // Check EC2 permissions (VPC/networking)
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
    if (err.name === 'UnauthorizedOperation' || err.message?.includes('not authorized')) {
      permissions.push({
        service: 'EC2',
        permission: 'ec2:DescribeVpcs',
        status: 'denied',
        message: 'Missing EC2 permissions - need AmazonEC2ReadOnlyAccess policy',
      });
    } else {
      permissions.push({
        service: 'EC2',
        permission: 'ec2:DescribeVpcs',
        status: 'error',
        message: err.message || 'Unknown error checking EC2',
      });
    }
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
    if (err.name === 'AccessDeniedException' || err.message?.includes('not authorized')) {
      permissions.push({
        service: 'ECR',
        permission: 'ecr:DescribeRepositories',
        status: 'denied',
        message: 'Missing ECR permissions - need AmazonEC2ContainerRegistryFullAccess policy',
      });
    } else {
      permissions.push({
        service: 'ECR',
        permission: 'ecr:DescribeRepositories',
        status: 'error',
        message: err.message || 'Unknown error checking ECR',
      });
    }
  }

  // Check IAM permissions (needed for role creation during setup)
  try {
    const iamClient = getIAMClient();
    await iamClient.send(new ListRolesCommand({ MaxItems: 1 }));
    permissions.push({
      service: 'IAM',
      permission: 'iam:ListRoles',
      status: 'granted',
      message: 'Can manage IAM roles for ECS tasks',
    });
  } catch (err: any) {
    if (err.name === 'AccessDeniedException' || err.message?.includes('not authorized')) {
      permissions.push({
        service: 'IAM',
        permission: 'iam:ListRoles',
        status: 'denied',
        message: 'Missing IAM permissions - need IAMFullAccess policy (only for automated setup)',
      });
    } else {
      permissions.push({
        service: 'IAM',
        permission: 'iam:ListRoles',
        status: 'error',
        message: err.message || 'Unknown error checking IAM',
      });
    }
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
    if (err.name === 'AccessDeniedException' || err.message?.includes('not authorized')) {
      permissions.push({
        service: 'CloudWatch Logs',
        permission: 'logs:DescribeLogGroups',
        status: 'denied',
        message: 'Missing CloudWatch Logs permissions - need CloudWatchLogsFullAccess policy',
      });
    } else {
      permissions.push({
        service: 'CloudWatch Logs',
        permission: 'logs:DescribeLogGroups',
        status: 'error',
        message: err.message || 'Unknown error checking CloudWatch Logs',
      });
    }
  }

  // Check CloudFront permissions (needed for HTTPS access)
  try {
    const cfClient = getCloudFrontClient();
    await cfClient.send(new ListDistributionsCommand({ MaxItems: 1 }));
    permissions.push({
      service: 'CloudFront',
      permission: 'cloudfront:ListDistributions',
      status: 'granted',
      message: 'Can manage CloudFront distributions for HTTPS',
    });
  } catch (err: any) {
    if (err.name === 'AccessDeniedException' || err.message?.includes('not authorized')) {
      permissions.push({
        service: 'CloudFront',
        permission: 'cloudfront:ListDistributions',
        status: 'denied',
        message: 'Missing CloudFront permissions - need CloudFrontFullAccess policy for HTTPS',
      });
    } else {
      permissions.push({
        service: 'CloudFront',
        permission: 'cloudfront:ListDistributions',
        status: 'error',
        message: err.message || 'Unknown error checking CloudFront',
      });
    }
  }

  // Determine overall validity
  const deniedCount = permissions.filter(p => p.status === 'denied').length;
  const errorCount = permissions.filter(p => p.status === 'error').length;
  const grantedCount = permissions.filter(p => p.status === 'granted').length;

  // Consider valid if at least ECS, EC2, and ECR are granted (IAM only needed for setup)
  const corePermissions = permissions.filter(p =>
    p.service === 'ECS' || p.service === 'EC2' || p.service === 'ECR'
  );
  const coreGranted = corePermissions.every(p => p.status === 'granted');

  if (errorCount > 0 && grantedCount === 0) {
    return {
      valid: false,
      message: 'Invalid credentials or unable to connect to AWS',
      permissions,
    };
  }

  if (coreGranted) {
    if (deniedCount === 0) {
      return {
        valid: true,
        message: `All ${grantedCount} permission checks passed`,
        permissions,
      };
    } else {
      return {
        valid: true,
        message: `Core permissions OK. ${deniedCount} optional permission(s) missing.`,
        permissions,
      };
    }
  }

  return {
    valid: false,
    message: `Missing ${deniedCount} required permission(s). See details below.`,
    permissions,
  };
}
