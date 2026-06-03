#!/usr/bin/env bash
# Provision the Kanon DEV box on AWS (us-east-1, default VPC, shared account).
# Idempotent-ish: re-running creates duplicates, so run once. Requires aws CLI
# configured for the target account.
#
# Set these before running:
#   export KEY_NAME=your-existing-ec2-keypair    # for SSH (must already exist)
#   export MY_IP=$(curl -s https://checkip.amazonaws.com)   # your public IP
# Optional:
#   export REGION=us-east-1
#   export INSTANCE_TYPE=t4g.small               # arm64; bump to t4g.medium if builds OOM
#   export NAME=kanon-dev
set -euo pipefail

REGION="${REGION:-us-east-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.small}"
NAME="${NAME:-kanon-dev}"
: "${KEY_NAME:?Set KEY_NAME to an existing EC2 key pair name}"
: "${MY_IP:?Set MY_IP to your public IP (e.g. export MY_IP=\$(curl -s https://checkip.amazonaws.com))}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "Region=$REGION  Type=$INSTANCE_TYPE  Name=$NAME  SSH-from=$MY_IP/32"

# Latest Ubuntu 24.04 arm64 AMI via SSM public parameter.
AMI_ID="$(aws ssm get-parameter --region "$REGION" \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id \
  --query 'Parameter.Value' --output text)"
echo "AMI=$AMI_ID"

VPC_ID="$(aws ec2 describe-vpcs --region "$REGION" \
  --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
echo "VPC=$VPC_ID"

# Security group: SSH from you only; 80/443 open for Caddy + Let's Encrypt.
SG_ID="$(aws ec2 create-security-group --region "$REGION" \
  --group-name "${NAME}-sg" --description "Kanon dev box" \
  --vpc-id "$VPC_ID" --query 'GroupId' --output text)"
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${MY_IP}/32,Description=ssh}]" \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=http-le}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=https}]" >/dev/null
echo "SG=$SG_ID"

# Launch instance (30 GB gp3 root, user-data bootstrap).
INSTANCE_ID="$(aws ec2 run-instances --region "$REGION" \
  --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3}' \
  --user-data "file://${HERE}/user-data.sh" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NAME}}]" \
  --query 'Instances[0].InstanceId' --output text)"
echo "Instance=$INSTANCE_ID  (waiting until running…)"
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"

# Elastic IP → stable address for sslip.io + MCP installer target.
ALLOC_ID="$(aws ec2 allocate-address --region "$REGION" --domain vpc \
  --query 'AllocationId' --output text)"
aws ec2 associate-address --region "$REGION" \
  --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
EIP="$(aws ec2 describe-addresses --region "$REGION" --allocation-ids "$ALLOC_ID" \
  --query 'Addresses[0].PublicIp' --output text)"

cat <<EOF

──────────────────────────────────────────────────────────────────────────
  Kanon dev box provisioned.
    Instance:  $INSTANCE_ID
    Elastic IP: $EIP
    SITE_ADDRESS to use: ${EIP}.sslip.io

  Next:
    ssh ubuntu@${EIP}
    git clone <repo> /opt/kanon            # or rsync your checkout
    cd /opt/kanon/deploy/dev
    cp env.template .env
    # set SITE_ADDRESS/CORS_ORIGIN/APP_URL/BASE_URL using ${EIP}.sslip.io
    # generate secrets: openssl rand -hex 32
    docker compose up -d --build

  Then open: https://${EIP}.sslip.io
──────────────────────────────────────────────────────────────────────────
EOF
