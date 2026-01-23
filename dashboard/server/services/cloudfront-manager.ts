import {
  CloudFrontClient,
  CreateDistributionCommand,
  DeleteDistributionCommand,
  GetDistributionCommand,
  UpdateDistributionCommand,
  ListDistributionsCommand,
} from '@aws-sdk/client-cloudfront';
import { getCredentials } from '../db/database.js';

export interface CloudFrontDistribution {
  distributionId: string;
  domainName: string;
  status: string;
  originDomain: string;
}

function getCloudFrontClient(): CloudFrontClient {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  // CloudFront is a global service, but we use us-east-1 for API calls
  return new CloudFrontClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  });
}

/**
 * Convert IP address to nip.io domain name
 * nip.io is a wildcard DNS service that maps IP addresses to domain names
 * e.g., 18.215.165.84 becomes 18-215-165-84.nip.io
 */
function ipToNipDomain(ip: string): string {
  return `${ip.replace(/\./g, '-')}.nip.io`;
}

/**
 * Create a CloudFront distribution for an ECS instance
 * This provides HTTPS access to the VS Code server and React app
 */
export async function createDistribution(
  instanceId: string,
  publicIp: string
): Promise<CloudFrontDistribution> {
  const client = getCloudFrontClient();
  const callerReference = `vibe-${instanceId}-${Date.now()}`;

  // CloudFront requires a domain name, not an IP address
  // We use nip.io to convert IP to domain (e.g., 18.215.165.84 -> 18-215-165-84.nip.io)
  const originDomain = ipToNipDomain(publicIp);
  console.log(`[CloudFront] Converting IP ${publicIp} to domain: ${originDomain}`);

  const response = await client.send(
    new CreateDistributionCommand({
      DistributionConfig: {
        CallerReference: callerReference,
        Comment: `Vibe Hackathon Instance: ${instanceId}`,
        Enabled: true,
        Origins: {
          Quantity: 1,
          Items: [
            {
              Id: `vibe-origin-${instanceId}`,
              DomainName: originDomain,
              CustomOriginConfig: {
                HTTPPort: 8080,
                HTTPSPort: 443,
                OriginProtocolPolicy: 'http-only', // ECS task serves HTTP, CloudFront adds HTTPS
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
          TargetOriginId: `vibe-origin-${instanceId}`,
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: {
            Quantity: 7,
            Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD'],
            },
          },
          // Disable caching for dynamic content (VS Code server)
          CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CachingDisabled managed policy
          OriginRequestPolicyId: '216adef6-5c7f-47e4-b989-5492eafa07d3', // AllViewer managed policy
          Compress: true,
        },
        // Handle WebSocket connections for VS Code
        CacheBehaviors: {
          Quantity: 0,
          Items: [],
        },
        PriceClass: 'PriceClass_100', // Use only North America and Europe for cost savings
        ViewerCertificate: {
          CloudFrontDefaultCertificate: true, // Use *.cloudfront.net SSL
        },
        HttpVersion: 'http2and3',
        IsIPV6Enabled: true,
      },
    })
  );

  const distribution = response.Distribution;
  if (!distribution) {
    throw new Error('Failed to create CloudFront distribution');
  }

  return {
    distributionId: distribution.Id!,
    domainName: distribution.DomainName!,
    status: distribution.Status!,
    originDomain: originDomain,
  };
}

/**
 * Get the current status of a CloudFront distribution
 */
export async function getDistributionStatus(
  distributionId: string
): Promise<CloudFrontDistribution | null> {
  const client = getCloudFrontClient();

  try {
    const response = await client.send(
      new GetDistributionCommand({
        Id: distributionId,
      })
    );

    const distribution = response.Distribution;
    if (!distribution) {
      return null;
    }

    const originDomain = distribution.DistributionConfig?.Origins?.Items?.[0]?.DomainName || '';

    return {
      distributionId: distribution.Id!,
      domainName: distribution.DomainName!,
      status: distribution.Status!,
      originDomain,
    };
  } catch (err: any) {
    if (err.name === 'NoSuchDistribution') {
      return null;
    }
    throw err;
  }
}

/**
 * Update the origin IP of an existing distribution (in case ECS task gets new IP)
 */
export async function updateDistributionOrigin(
  distributionId: string,
  newPublicIp: string
): Promise<void> {
  const client = getCloudFrontClient();

  // First get the current distribution config and ETag
  const getResponse = await client.send(
    new GetDistributionCommand({
      Id: distributionId,
    })
  );

  const distribution = getResponse.Distribution;
  const etag = getResponse.ETag;

  if (!distribution || !etag) {
    throw new Error('Distribution not found');
  }

  const config = distribution.DistributionConfig!;

  // Update the origin domain (convert IP to nip.io domain)
  if (config.Origins?.Items?.[0]) {
    config.Origins.Items[0].DomainName = ipToNipDomain(newPublicIp);
  }

  await client.send(
    new UpdateDistributionCommand({
      Id: distributionId,
      IfMatch: etag,
      DistributionConfig: config,
    })
  );
}

/**
 * Disable a CloudFront distribution (required before deletion)
 */
export async function disableDistribution(distributionId: string): Promise<string> {
  const client = getCloudFrontClient();

  // First get the current distribution config and ETag
  const getResponse = await client.send(
    new GetDistributionCommand({
      Id: distributionId,
    })
  );

  const distribution = getResponse.Distribution;
  const etag = getResponse.ETag;

  if (!distribution || !etag) {
    throw new Error('Distribution not found');
  }

  // If already disabled, return current ETag
  if (!distribution.DistributionConfig?.Enabled) {
    return etag;
  }

  const config = distribution.DistributionConfig!;
  config.Enabled = false;

  const updateResponse = await client.send(
    new UpdateDistributionCommand({
      Id: distributionId,
      IfMatch: etag,
      DistributionConfig: config,
    })
  );

  return updateResponse.ETag || etag;
}

/**
 * Delete a CloudFront distribution (must be disabled first and status must be 'Deployed')
 */
export async function deleteDistribution(distributionId: string): Promise<void> {
  const client = getCloudFrontClient();

  try {
    // Get current status
    const status = await getDistributionStatus(distributionId);
    if (!status) {
      return; // Already deleted
    }

    // If still enabled, disable it first
    if (status.status !== 'Deployed') {
      // Distribution is still being deployed/updated, can't delete yet
      console.log(`Distribution ${distributionId} is ${status.status}, will retry deletion later`);
      return;
    }

    // Disable if needed, then delete
    const etag = await disableDistribution(distributionId);

    // Wait a moment for the disable to propagate
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get fresh ETag after disable
    const freshResponse = await client.send(
      new GetDistributionCommand({
        Id: distributionId,
      })
    );

    if (freshResponse.Distribution?.Status === 'Deployed') {
      await client.send(
        new DeleteDistributionCommand({
          Id: distributionId,
          IfMatch: freshResponse.ETag,
        })
      );
    }
  } catch (err: any) {
    // If distribution is not in 'Deployed' state, we can't delete it yet
    if (err.name === 'DistributionNotDisabled' || err.name === 'PreconditionFailed') {
      console.log(`Distribution ${distributionId} not ready for deletion, will retry later`);
      return;
    }
    if (err.name === 'NoSuchDistribution') {
      return; // Already deleted
    }
    throw err;
  }
}

/**
 * List all Vibe-related CloudFront distributions
 */
export async function listVibeDistributions(): Promise<CloudFrontDistribution[]> {
  const client = getCloudFrontClient();

  const response = await client.send(new ListDistributionsCommand({}));

  const vibeDistributions: CloudFrontDistribution[] = [];

  for (const dist of response.DistributionList?.Items || []) {
    if (dist.Comment?.startsWith('Vibe Hackathon Instance:')) {
      vibeDistributions.push({
        distributionId: dist.Id!,
        domainName: dist.DomainName!,
        status: dist.Status!,
        originDomain: dist.Origins?.Items?.[0]?.DomainName || '',
      });
    }
  }

  return vibeDistributions;
}
