import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';

export class ShockglobeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- VPC ---
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // --- ECR Repository (created out-of-band, imported here) ---
    const repository = ecr.Repository.fromRepositoryName(
      this,
      'Repo',
      'shockglobe-backend',
    );

    // --- ECS Cluster ---
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'shockglobe',
    });

    // --- Secrets Manager ---
    const apiKeys = secretsmanager.Secret.fromSecretNameV2(
      this,
      'ApiKeys',
      'shockglobe/api-keys',
    );

    // --- CloudWatch Logs ---
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/shockglobe-backend',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- ECS Fargate Service with ALB ---
    const fargateService =
      new ecsPatterns.ApplicationLoadBalancedFargateService(
        this,
        'FargateService',
        {
          cluster,
          serviceName: 'shockglobe-backend',
          cpu: 512,
          memoryLimitMiB: 1024,
          desiredCount: 1,
          circuitBreaker: { enable: true, rollback: true },
          taskImageOptions: {
            image: ecs.ContainerImage.fromEcrRepository(repository),
            containerPort: 3000,
            logDriver: ecs.LogDrivers.awsLogs({
              logGroup,
              streamPrefix: 'ecs',
            }),
            environment: {
              PORT: '3000',
              NODE_ENV: 'production',
            },
            secrets: {
              OPENAI_API_KEY: ecs.Secret.fromSecretsManager(
                apiKeys,
                'OPENAI_API_KEY',
              ),
              POLYGON_API_KEY: ecs.Secret.fromSecretsManager(
                apiKeys,
                'POLYGON_API_KEY',
              ),
              NEWS_API_KEY: ecs.Secret.fromSecretsManager(
                apiKeys,
                'NEWS_API_KEY',
              ),
            },
          },
          publicLoadBalancer: true,
        },
      );

    // Health check
    fargateService.targetGroup.configureHealthCheck({
      path: '/api/health',
      healthyHttpCodes: '200',
    });

    // Sticky sessions for Socket.io
    fargateService.targetGroup.enableCookieStickiness(cdk.Duration.hours(1));

    // --- Auto-scaling ---
    const scaling = fargateService.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 4,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'ALB DNS name',
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR repository URI',
    });
  }
}
