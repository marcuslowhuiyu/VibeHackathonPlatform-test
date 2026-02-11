import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track all send() calls
const mockSend = vi.fn();

// Mock the AWS ELB SDK with proper class constructor
vi.mock('@aws-sdk/client-elastic-load-balancing-v2', () => {
  class MockELBClient {
    send = mockSend;
  }
  return {
    ElasticLoadBalancingV2Client: MockELBClient,
    CreateTargetGroupCommand: class { input: any; constructor(input: any) { this.input = input; } },
    RegisterTargetsCommand: class { input: any; constructor(input: any) { this.input = input; } },
    DescribeRulesCommand: class { input: any; constructor(input: any) { this.input = input; } },
    CreateRuleCommand: class { input: any; constructor(input: any) { this.input = input; } },
    CreateLoadBalancerCommand: class {},
    CreateListenerCommand: class {},
    DescribeLoadBalancersCommand: class {},
    DescribeTargetGroupsCommand: class {},
    DescribeListenersCommand: class {},
    DeleteTargetGroupCommand: class {},
    DeleteRuleCommand: class {},
    DeregisterTargetsCommand: class {},
    ModifyTargetGroupAttributesCommand: class {},
    DescribeTargetHealthCommand: class { input: any; constructor(input: any) { this.input = input; } },
  };
});

// Mock CloudFront SDK
vi.mock('@aws-sdk/client-cloudfront', () => {
  class MockCFClient {
    send = vi.fn();
  }
  return {
    CloudFrontClient: MockCFClient,
    CreateDistributionCommand: class {},
    GetDistributionCommand: class {},
    ListDistributionsCommand: class {},
  };
});

// Mock the database module
vi.mock('../db/database.js', () => ({
  getConfig: vi.fn().mockReturnValue(undefined),
  setConfig: vi.fn(),
}));

import { registerCodingInstance, checkTargetHealth } from './coding-lab-alb.js';

describe('checkTargetHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "healthy" when target health state is healthy', async () => {
    mockSend.mockResolvedValueOnce({
      TargetHealthDescriptions: [
        {
          Target: { Id: '10.0.0.1', Port: 8080 },
          TargetHealth: { State: 'healthy' },
        },
      ],
    });

    const result = await checkTargetHealth('arn:aws:tg/test-tg');
    expect(result).toBe('healthy');
  });

  it('returns "unhealthy" when target health state is unhealthy', async () => {
    mockSend.mockResolvedValueOnce({
      TargetHealthDescriptions: [
        {
          Target: { Id: '10.0.0.1', Port: 8080 },
          TargetHealth: { State: 'unhealthy' },
        },
      ],
    });

    const result = await checkTargetHealth('arn:aws:tg/test-tg');
    expect(result).toBe('unhealthy');
  });

  it('returns "initial" when target is still initializing', async () => {
    mockSend.mockResolvedValueOnce({
      TargetHealthDescriptions: [
        {
          Target: { Id: '10.0.0.1', Port: 8080 },
          TargetHealth: { State: 'initial' },
        },
      ],
    });

    const result = await checkTargetHealth('arn:aws:tg/test-tg');
    expect(result).toBe('initial');
  });

  it('returns "unavailable" when no targets are found', async () => {
    mockSend.mockResolvedValueOnce({
      TargetHealthDescriptions: [],
    });

    const result = await checkTargetHealth('arn:aws:tg/test-tg');
    expect(result).toBe('unavailable');
  });
});

describe('registerCodingInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock responses for the 4 AWS calls
    mockSend
      .mockResolvedValueOnce({
        TargetGroups: [{ TargetGroupArn: 'arn:aws:tg/test-tg' }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Rules: [{ Priority: 'default' }],
      })
      .mockResolvedValueOnce({
        Rules: [{ RuleArn: 'arn:aws:rule/test-rule' }],
      });
  });

  it('uses instance-specific health check path /i/{instanceId}/', async () => {
    const instanceId = 'test-abc123';

    await registerCodingInstance(
      instanceId,
      '10.0.0.1',
      'vpc-123',
      'arn:aws:listener/test'
    );

    // The first call to send() is CreateTargetGroupCommand
    const createTgCall = mockSend.mock.calls[0][0];
    expect(createTgCall.input.HealthCheckPath).toBe(`/i/${instanceId}/`);
  });

  it('registers target on port 8080 with the provided IP', async () => {
    await registerCodingInstance(
      'test-abc123',
      '10.0.0.5',
      'vpc-123',
      'arn:aws:listener/test'
    );

    // The second call to send() is RegisterTargetsCommand
    const registerCall = mockSend.mock.calls[1][0];
    expect(registerCall.input.Targets[0].Id).toBe('10.0.0.5');
    expect(registerCall.input.Targets[0].Port).toBe(8080);
  });

  it('creates listener rule with correct path patterns', async () => {
    const instanceId = 'test-abc123';

    await registerCodingInstance(
      instanceId,
      '10.0.0.1',
      'vpc-123',
      'arn:aws:listener/test'
    );

    // The fourth call to send() is CreateRuleCommand
    const ruleCall = mockSend.mock.calls[3][0];
    const pathValues = ruleCall.input.Conditions[0].PathPatternConfig.Values;
    expect(pathValues).toContain(`/i/${instanceId}`);
    expect(pathValues).toContain(`/i/${instanceId}/*`);
  });
});
