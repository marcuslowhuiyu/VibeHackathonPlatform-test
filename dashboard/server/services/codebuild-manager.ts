import {
  CodeBuildClient,
  StartBuildCommand,
  BatchGetBuildsCommand,
  BatchGetProjectsCommand,
  CreateProjectCommand,
} from '@aws-sdk/client-codebuild';
import { getCredentials } from '../db/database.js';

function getClient(): CodeBuildClient {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('AWS credentials not configured');
  }

  return new CodeBuildClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    },
  });
}

const PROJECT_NAME = 'vibe-coding-lab-builder';

export interface BuildStatus {
  id: string;
  status: string;
  phase: string;
  startTime?: Date;
  endTime?: Date;
  logs?: string;
}

// Check if CodeBuild project exists
export async function checkProjectExists(): Promise<boolean> {
  const client = getClient();
  try {
    const response = await client.send(
      new BatchGetProjectsCommand({ names: [PROJECT_NAME] })
    );
    return (response.projects?.length ?? 0) > 0;
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      return false;
    }
    throw err;
  }
}

// Create CodeBuild project
export async function createProject(
  accountId: string,
  githubRepo: string
): Promise<void> {
  const client = getClient();
  const creds = getCredentials();
  if (!creds) throw new Error('AWS credentials not configured');

  // Create the buildspec inline - builds both Continue and Cline extensions
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
      - echo Build completed on \`date\`
`;

  await client.send(
    new CreateProjectCommand({
      name: PROJECT_NAME,
      description: 'Builds the Vibe Coding Lab Docker image',
      source: {
        type: 'GITHUB',
        location: githubRepo,
        buildspec: buildspec,
      },
      artifacts: {
        type: 'NO_ARTIFACTS',
      },
      environment: {
        type: 'LINUX_CONTAINER',
        computeType: 'BUILD_GENERAL1_MEDIUM',
        image: 'aws/codebuild/standard:7.0', // Ubuntu - works in all regions
        privilegedMode: true, // Required for Docker builds
        environmentVariables: [
          {
            name: 'AWS_ACCOUNT_ID',
            value: accountId,
          },
          {
            name: 'AWS_DEFAULT_REGION',
            value: creds.region,
          },
        ],
      },
      serviceRole: `arn:aws:iam::${accountId}:role/codebuild-vibe-service-role`,
    })
  );
}

// Start a build
export async function startBuild(): Promise<string> {
  const client = getClient();

  const response = await client.send(
    new StartBuildCommand({
      projectName: PROJECT_NAME,
    })
  );

  if (!response.build?.id) {
    throw new Error('Failed to start build');
  }

  return response.build.id;
}

// Get build status
export async function getBuildStatus(buildId: string): Promise<BuildStatus> {
  const client = getClient();

  const response = await client.send(
    new BatchGetBuildsCommand({
      ids: [buildId],
    })
  );

  const build = response.builds?.[0];
  if (!build) {
    throw new Error('Build not found');
  }

  return {
    id: build.id || buildId,
    status: build.buildStatus || 'UNKNOWN',
    phase: build.currentPhase || 'UNKNOWN',
    startTime: build.startTime,
    endTime: build.endTime,
  };
}
