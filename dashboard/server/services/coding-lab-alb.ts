import {
  ElasticLoadBalancingV2Client,
  CreateLoadBalancerCommand,
  CreateTargetGroupCommand,
  CreateListenerCommand,
  RegisterTargetsCommand,
  DeregisterTargetsCommand,
  DeleteTargetGroupCommand,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeListenersCommand,
  CreateRuleCommand,
  DeleteRuleCommand,
  DescribeRulesCommand,
  ModifyTargetGroupAttributesCommand,
  ModifyTargetGroupCommand,
  DescribeTargetHealthCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  CloudFrontClient,
  CreateDistributionCommand,
  GetDistributionCommand,
  ListDistributionsCommand,
} from '@aws-sdk/client-cloudfront';
import { getConfig, setConfig } from '../db/database.js';

const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-southeast-1';

function getELBClient(): ElasticLoadBalancingV2Client {
  return new ElasticLoadBalancingV2Client({ region: AWS_REGION });
}

function getCloudFrontClient(): CloudFrontClient {
  return new CloudFrontClient({ region: 'us-east-1' });
}

export interface CodingLabALBConfig {
  albArn: string;
  albDnsName: string;
  listenerArn: string;
  cloudfrontDistributionId?: string;
  cloudfrontDomain?: string;
}

/**
 * Get or create the shared coding lab ALB
 */
export async function ensureCodingLabALB(
  vpcId: string,
  subnetIds: string[],
  securityGroupId: string
): Promise<CodingLabALBConfig> {
  const client = getELBClient();
  const albName = 'vibe-coding-lab-alb';

  // Check if ALB already exists
  try {
    const describeResponse = await client.send(
      new DescribeLoadBalancersCommand({
        Names: [albName],
      })
    );

    const existingAlb = describeResponse.LoadBalancers?.[0];
    if (existingAlb) {
      console.log(`[CodingLabALB] Found existing ALB: ${existingAlb.LoadBalancerArn}`);

      // Get the listener
      const listenersResponse = await client.send(
        new DescribeListenersCommand({
          LoadBalancerArn: existingAlb.LoadBalancerArn,
        })
      );

      const listener = listenersResponse.Listeners?.find(l => l.Port === 80);

      return {
        albArn: existingAlb.LoadBalancerArn!,
        albDnsName: existingAlb.DNSName!,
        listenerArn: listener?.ListenerArn || '',
      };
    }
  } catch (err: any) {
    if (err.name !== 'LoadBalancerNotFoundException') {
      throw err;
    }
  }

  // Create new ALB
  console.log(`[CodingLabALB] Creating new ALB: ${albName}`);

  const createAlbResponse = await client.send(
    new CreateLoadBalancerCommand({
      Name: albName,
      Subnets: subnetIds,
      SecurityGroups: [securityGroupId],
      Scheme: 'internet-facing',
      Type: 'application',
      IpAddressType: 'ipv4',
      Tags: [
        { Key: 'Name', Value: 'Vibe Coding Lab ALB' },
        { Key: 'Purpose', Value: 'Shared ALB for coding lab instances' },
      ],
    })
  );

  const alb = createAlbResponse.LoadBalancers?.[0];
  if (!alb) {
    throw new Error('Failed to create ALB');
  }

  console.log(`[CodingLabALB] ALB created: ${alb.LoadBalancerArn}`);

  // Create a default target group (for the default action)
  const defaultTgResponse = await client.send(
    new CreateTargetGroupCommand({
      Name: 'vibe-coding-default-tg',
      Protocol: 'HTTP',
      Port: 8080,
      VpcId: vpcId,
      TargetType: 'ip',
      HealthCheckPath: '/',
      HealthCheckIntervalSeconds: 30,
      HealthCheckTimeoutSeconds: 5,
      HealthyThresholdCount: 2,
      UnhealthyThresholdCount: 3,
    })
  );

  const defaultTgArn = defaultTgResponse.TargetGroups?.[0]?.TargetGroupArn;

  // Create listener with default action (returns 404 for unmatched paths)
  const listenerResponse = await client.send(
    new CreateListenerCommand({
      LoadBalancerArn: alb.LoadBalancerArn,
      Protocol: 'HTTP',
      Port: 80,
      DefaultActions: [
        {
          Type: 'fixed-response',
          FixedResponseConfig: {
            StatusCode: '404',
            ContentType: 'text/plain',
            MessageBody: 'Instance not found. Please check your instance ID.',
          },
        },
      ],
    })
  );

  const listenerArn = listenerResponse.Listeners?.[0]?.ListenerArn;
  if (!listenerArn) {
    throw new Error('Failed to create listener');
  }

  console.log(`[CodingLabALB] Listener created: ${listenerArn}`);

  return {
    albArn: alb.LoadBalancerArn!,
    albDnsName: alb.DNSName!,
    listenerArn,
  };
}

/**
 * Create a target group and listener rule for a specific coding instance
 */
export async function registerCodingInstance(
  instanceId: string,
  targetIp: string,
  vpcId: string,
  listenerArn: string
): Promise<{ targetGroupArn: string; ruleArn: string; accessPath: string }> {
  const client = getELBClient();

  // Create a target group for this instance
  // Target group names have a 32 char limit
  const tgName = `vibe-${instanceId}`.replace(/[^A-Za-z0-9-]/g, '-').substring(0, 32);

  console.log(`[CodingLabALB] Creating target group for instance ${instanceId}`);

  const tgResponse = await client.send(
    new CreateTargetGroupCommand({
      Name: tgName,
      Protocol: 'HTTP',
      Port: 8080,
      VpcId: vpcId,
      TargetType: 'ip',
      HealthCheckPath: `/i/${instanceId}/`,
      HealthCheckIntervalSeconds: 30,
      HealthCheckTimeoutSeconds: 10,
      HealthyThresholdCount: 2,
      UnhealthyThresholdCount: 3,
      Matcher: { HttpCode: '200-399' },  // Accept redirects from OpenVSCode Server
      Tags: [
        { Key: 'InstanceId', Value: instanceId },
        { Key: 'Purpose', Value: 'Coding Lab Instance' },
      ],
    })
  );

  const targetGroupArn = tgResponse.TargetGroups?.[0]?.TargetGroupArn;
  if (!targetGroupArn) {
    throw new Error('Failed to create target group');
  }

  // Register the instance IP with the target group
  await client.send(
    new RegisterTargetsCommand({
      TargetGroupArn: targetGroupArn,
      Targets: [
        {
          Id: targetIp,
          Port: 8080,
        },
      ],
    })
  );

  console.log(`[CodingLabALB] Registered IP ${targetIp} with target group`);

  // Get existing rules to determine priority
  const rulesResponse = await client.send(
    new DescribeRulesCommand({
      ListenerArn: listenerArn,
    })
  );

  // Find the highest priority (excluding default which has no priority number)
  const existingPriorities = (rulesResponse.Rules || [])
    .filter(r => r.Priority !== 'default')
    .map(r => parseInt(r.Priority || '0', 10));

  const nextPriority = existingPriorities.length > 0
    ? Math.max(...existingPriorities) + 1
    : 1;

  // Create a listener rule for this instance
  // Path pattern: /i/{instanceId}/*
  const accessPath = `/i/${instanceId}`;

  const ruleResponse = await client.send(
    new CreateRuleCommand({
      ListenerArn: listenerArn,
      Priority: nextPriority,
      Conditions: [
        {
          Field: 'path-pattern',
          PathPatternConfig: {
            Values: [`${accessPath}`, `${accessPath}/*`],
          },
        },
      ],
      Actions: [
        {
          Type: 'forward',
          TargetGroupArn: targetGroupArn,
        },
      ],
      Tags: [
        { Key: 'InstanceId', Value: instanceId },
      ],
    })
  );

  const ruleArn = ruleResponse.Rules?.[0]?.RuleArn;
  if (!ruleArn) {
    throw new Error('Failed to create listener rule');
  }

  console.log(`[CodingLabALB] Created listener rule for path ${accessPath}`);

  return {
    targetGroupArn,
    ruleArn,
    accessPath,
  };
}

/**
 * Deregister a coding instance from the ALB
 */
export async function deregisterCodingInstance(
  targetGroupArn: string,
  ruleArn: string
): Promise<void> {
  const client = getELBClient();

  try {
    // Delete the listener rule first
    if (ruleArn) {
      console.log(`[CodingLabALB] Deleting listener rule: ${ruleArn}`);
      await client.send(
        new DeleteRuleCommand({
          RuleArn: ruleArn,
        })
      );
    }

    // Delete the target group
    if (targetGroupArn) {
      console.log(`[CodingLabALB] Deleting target group: ${targetGroupArn}`);
      await client.send(
        new DeleteTargetGroupCommand({
          TargetGroupArn: targetGroupArn,
        })
      );
    }
  } catch (err: any) {
    console.error(`[CodingLabALB] Error deregistering instance:`, err.message);
    // Don't throw - cleanup should be best-effort
  }
}

/**
 * Get or create the shared CloudFront distribution for the coding lab ALB
 */
export async function ensureCodingLabCloudFront(
  albDnsName: string
): Promise<{ distributionId: string; domain: string }> {
  const client = getCloudFrontClient();

  // Check if we already have a CloudFront distribution for coding labs
  const existingDistId = getConfig('coding_lab_cloudfront_id');
  if (existingDistId) {
    try {
      const getResponse = await client.send(
        new GetDistributionCommand({
          Id: existingDistId,
        })
      );

      if (getResponse.Distribution) {
        console.log(`[CodingLabCloudFront] Found existing distribution: ${existingDistId}`);
        return {
          distributionId: existingDistId,
          domain: getResponse.Distribution.DomainName!,
        };
      }
    } catch (err: any) {
      if (err.name !== 'NoSuchDistribution') {
        throw err;
      }
      // Distribution was deleted, create a new one
    }
  }

  // Check if there's already a distribution pointing to our ALB
  const listResponse = await client.send(new ListDistributionsCommand({}));
  for (const dist of listResponse.DistributionList?.Items || []) {
    if (dist.Comment === 'Vibe Coding Lab - Shared CloudFront') {
      console.log(`[CodingLabCloudFront] Found existing distribution by comment: ${dist.Id}`);
      setConfig('coding_lab_cloudfront_id', dist.Id!);
      setConfig('coding_lab_cloudfront_domain', dist.DomainName!);
      return {
        distributionId: dist.Id!,
        domain: dist.DomainName!,
      };
    }
  }

  // Create new CloudFront distribution
  console.log(`[CodingLabCloudFront] Creating new distribution for ALB: ${albDnsName}`);

  const createResponse = await client.send(
    new CreateDistributionCommand({
      DistributionConfig: {
        CallerReference: `vibe-coding-lab-${Date.now()}`,
        Comment: 'Vibe Coding Lab - Shared CloudFront',
        Enabled: true,
        Origins: {
          Quantity: 1,
          Items: [
            {
              Id: 'vibe-coding-lab-alb',
              DomainName: albDnsName,
              CustomOriginConfig: {
                HTTPPort: 80,
                HTTPSPort: 443,
                OriginProtocolPolicy: 'http-only',
                OriginSslProtocols: {
                  Quantity: 1,
                  Items: ['TLSv1.2'],
                },
                OriginReadTimeout: 60,
                OriginKeepaliveTimeout: 60,
              },
            },
          ],
        },
        DefaultCacheBehavior: {
          TargetOriginId: 'vibe-coding-lab-alb',
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: {
            Quantity: 7,
            Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD'],
            },
          },
          CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CachingDisabled
          OriginRequestPolicyId: '216adef6-5c7f-47e4-b989-5492eafa07d3', // AllViewer
          Compress: true,
        },
        PriceClass: 'PriceClass_100',
        ViewerCertificate: {
          CloudFrontDefaultCertificate: true,
        },
        HttpVersion: 'http2and3',
        IsIPV6Enabled: true,
      },
    })
  );

  const distribution = createResponse.Distribution;
  if (!distribution) {
    throw new Error('Failed to create CloudFront distribution');
  }

  // Save to config
  setConfig('coding_lab_cloudfront_id', distribution.Id!);
  setConfig('coding_lab_cloudfront_domain', distribution.DomainName!);

  console.log(`[CodingLabCloudFront] Created distribution: ${distribution.Id} (${distribution.DomainName})`);

  return {
    distributionId: distribution.Id!,
    domain: distribution.DomainName!,
  };
}

/**
 * Get the shared CloudFront domain for coding labs
 */
export function getCodingLabCloudFrontDomain(): string | null {
  return getConfig('coding_lab_cloudfront_domain') || null;
}

/**
 * Get the coding lab ALB config from database
 */
export function getCodingLabALBConfig(): CodingLabALBConfig | null {
  const albArn = getConfig('coding_lab_alb_arn');
  const albDnsName = getConfig('coding_lab_alb_dns');
  const listenerArn = getConfig('coding_lab_listener_arn');

  if (!albArn || !albDnsName || !listenerArn) {
    return null;
  }

  return {
    albArn,
    albDnsName,
    listenerArn,
    cloudfrontDistributionId: getConfig('coding_lab_cloudfront_id') || undefined,
    cloudfrontDomain: getConfig('coding_lab_cloudfront_domain') || undefined,
  };
}

/**
 * Check the health of targets in a target group.
 * Returns the health state of the first target, or 'unavailable' if none found.
 */
export async function checkTargetHealth(
  targetGroupArn: string
): Promise<string> {
  const client = getELBClient();
  const response = await client.send(
    new DescribeTargetHealthCommand({
      TargetGroupArn: targetGroupArn,
    })
  );

  const descriptions = response.TargetHealthDescriptions || [];
  if (descriptions.length === 0) {
    return 'unavailable';
  }

  return descriptions[0].TargetHealth?.State || 'unavailable';
}

/**
 * Ensure a target group has the correct Matcher set to accept redirects.
 * Fixes old target groups created before the Matcher was added.
 */
export async function ensureTargetGroupMatcher(
  targetGroupArn: string
): Promise<void> {
  const client = getELBClient();
  console.log(`[CodingLabALB] Updating Matcher for target group: ${targetGroupArn}`);
  await client.send(
    new ModifyTargetGroupCommand({
      TargetGroupArn: targetGroupArn,
      Matcher: { HttpCode: '200-399' },
    })
  );
}

/**
 * Save coding lab ALB config to database
 */
export function saveCodingLabALBConfig(config: CodingLabALBConfig): void {
  setConfig('coding_lab_alb_arn', config.albArn);
  setConfig('coding_lab_alb_dns', config.albDnsName);
  setConfig('coding_lab_listener_arn', config.listenerArn);
  if (config.cloudfrontDistributionId) {
    setConfig('coding_lab_cloudfront_id', config.cloudfrontDistributionId);
  }
  if (config.cloudfrontDomain) {
    setConfig('coding_lab_cloudfront_domain', config.cloudfrontDomain);
  }
}
