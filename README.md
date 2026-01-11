
<!-- Cline Set Up -->

cd vibe-coding-lab

docker build -t vibe-coding-lab:latest .

docker run -d -p 8080:8080 -p 3000:3000 --name vibe-test vibe-coding-lab:latest

<!-- Push to ECR -->
# Replace with your AWS Account ID and Region
<!-- 8517 2550 0507 -->

docker tag vibe-coding-lab:latest <aws_account_id>.dkr.ecr.us-east-1.amazonaws.com/vibe-coding-lab:latest

aws login

<!-- If ecr does not exist -->
aws ecr create-repository --repository-name vibe-coding-lab --region us-east-1

aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <aws_account_id>.dkr.ecr.us-east-1.amazonaws.com

docker push <aws_account_id>.dkr.ecr.us-east-1.amazonaws.com/vibe-coding-lab:latest