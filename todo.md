# ShockGlobe — Post-Deployment TODO

## AWS Infrastructure (Live)
- **API URL**: `http://Shockg-Farga-mhfWuvjcg019-295050755.us-east-1.elb.amazonaws.com`
- **Swagger**: `/api/docs`
- **Health**: `/api/health`

## Remaining Setup

### 1. Populate real API keys in Secrets Manager
```bash
aws secretsmanager put-secret-value \
  --secret-id shockglobe/api-keys \
  --secret-string '{"OPENAI_API_KEY":"<real-key>","POLYGON_API_KEY":"<real-key>","NEWS_API_KEY":"<real-key>"}'
```
Then force a new ECS deployment to pick up the new values:
```bash
aws ecs update-service --cluster shockglobe --service shockglobe-backend --force-new-deployment
```

### 2. Set up GitHub Actions CI/CD (OIDC)
- [ ] Create an IAM OIDC identity provider for `token.actions.githubusercontent.com`
- [ ] Create an IAM role with ECR push + ECS deploy permissions, trusting the OIDC provider
- [ ] Add `AWS_ROLE_ARN` as a GitHub repository secret
- [ ] Push to `main` to trigger the first automated deploy

### 3. Update CORS for production frontend
- [ ] Set `CORS_ORIGIN` environment variable in the CDK stack to the real frontend URL
- [ ] Redeploy: `cd infra && npx cdk deploy`

### 4. Custom domain + HTTPS
- [ ] Register or configure a domain in Route 53
- [ ] Request an ACM certificate
- [ ] Add HTTPS listener to the ALB (port 443)
- [ ] Create a Route 53 alias record pointing to the ALB

### 5. Database
- [ ] Swap in-memory mock data for a real database (RDS/Aurora or DynamoDB)
- [ ] Add DB connection string to Secrets Manager and CDK task definition

### 6. Monitoring & Alerts
- [ ] Set up CloudWatch alarms (CPU, memory, 5xx errors)
- [ ] Configure SNS notifications for alarm triggers
