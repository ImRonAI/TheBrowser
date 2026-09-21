#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

set -a
source .env
set +a

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text --region "$REGION")"
PUBLIC_IP="$(curl -s https://checkip.amazonaws.com | tr -d '\n')"
CIDR="${PUBLIC_IP}/32"
BUCKET="ron-agent-desktop-${ACCOUNT_ID}-${REGION}"
KEY="desktop/ron-agent-desktop.tar.gz"
ROLE_NAME="RonAgentDesktopSsmRole"
PROFILE_NAME="RonAgentDesktopInstanceProfile"
SG_NAME="ron-agent-desktop-sg"
INSTANCE_NAME="ron-agent-desktop"
INSTANCE_TYPE="${RON_AGENT_DESKTOP_INSTANCE_TYPE:-t3.xlarge}"
TARBALL="/tmp/ron-agent-desktop.tar.gz"

tar -czf "$TARBALL" -C "$SCRIPT_DIR" .

if ! aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1; then
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  fi
fi
aws s3 cp "$TARBALL" "s3://${BUCKET}/${KEY}" --region "$REGION" >/dev/null

if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null || true
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name RonAgentDesktopS3Read \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\"],\"Resource\":\"arn:aws:s3:::${BUCKET}/${KEY}\"}]}" >/dev/null

if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
fi
if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" \
  --query "InstanceProfile.Roles[?RoleName=='${ROLE_NAME}'].RoleName" --output text | grep -q "$ROLE_NAME"; then
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" >/dev/null
  sleep 12
fi

VPC_ID="$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text --region "$REGION")"
SUBNET_ID=""
for AZ in $(aws ec2 describe-instance-type-offerings \
  --location-type availability-zone \
  --filters Name=instance-type,Values="$INSTANCE_TYPE" \
  --query 'InstanceTypeOfferings[].Location' \
  --output text \
  --region "$REGION"); do
  CANDIDATE_SUBNET_ID="$(aws ec2 describe-subnets \
    --filters Name=vpc-id,Values="$VPC_ID" Name=availability-zone,Values="$AZ" Name=default-for-az,Values=true \
    --query 'Subnets[0].SubnetId' \
    --output text \
    --region "$REGION")"
  if [[ -n "$CANDIDATE_SUBNET_ID" && "$CANDIDATE_SUBNET_ID" != "None" ]]; then
    SUBNET_ID="$CANDIDATE_SUBNET_ID"
    break
  fi
done
if [[ -z "$SUBNET_ID" ]]; then
  echo "No default subnet in ${REGION} supports ${INSTANCE_TYPE}" >&2
  exit 1
fi
SG_ID="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text --region "$REGION")"
if [[ "$SG_ID" == "None" ]]; then
  SG_ID="$(aws ec2 create-security-group --group-name "$SG_NAME" --description "Ron agent desktop noVNC" --vpc-id "$VPC_ID" --query GroupId --output text --region "$REGION")"
fi
for PORT in 6080; do
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=${PORT},ToPort=${PORT},IpRanges=[{CidrIp=${CIDR},Description=RonBrowserRebuild}]" \
    --region "$REGION" >/dev/null 2>&1 || true
done

AMI_ID="$(aws ssm get-parameter --name /aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id --query Parameter.Value --output text --region "$REGION")"
USER_DATA_FILE="$(mktemp)"
cat > "$USER_DATA_FILE" <<USERDATA
#!/bin/bash
set -euxo pipefail
dnf install -y awscli amazon-ssm-agent tar
systemctl enable --now amazon-ssm-agent || true
systemctl enable --now docker
mkdir -p /opt/ron-agent-desktop
aws s3 cp s3://${BUCKET}/${KEY} /tmp/ron-agent-desktop.tar.gz --region ${REGION}
tar -xzf /tmp/ron-agent-desktop.tar.gz -C /opt/ron-agent-desktop
cd /opt/ron-agent-desktop
docker build -t ron-agent-desktop .
docker rm -f ron-agent-desktop || true
docker run -d --restart unless-stopped --name ron-agent-desktop \
  -p 6080:6080 \
  -e STRANDS_NON_INTERACTIVE=true \
  ron-agent-desktop
USERDATA

INSTANCE_ID="$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --iam-instance-profile Name="$PROFILE_NAME" \
  --subnet-id "$SUBNET_ID" \
  --security-group-ids "$SG_ID" \
  --associate-public-ip-address \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}},{Key=Project,Value=RonBrowserRebuild}]" \
  --user-data "file://${USER_DATA_FILE}" \
  --query 'Instances[0].InstanceId' \
  --output text \
  --region "$REGION")"
rm -f "$USER_DATA_FILE"

aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
PUBLIC_DNS="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicDnsName' --output text --region "$REGION")"

python3 - "$REPO_ROOT/.env" "$REGION" "$INSTANCE_ID" "$PUBLIC_DNS" "$INSTANCE_TYPE" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
updates = {
    "RON_AGENT_DESKTOP_BACKEND": "aws_ssm",
    "RON_AGENT_DESKTOP_REGION": sys.argv[2],
    "RON_AGENT_DESKTOP_INSTANCE_ID": sys.argv[3],
    "RON_AGENT_DESKTOP_CONTAINER": "ron-agent-desktop",
    "RON_AGENT_DESKTOP_INSTANCE_TYPE": sys.argv[5],
    "RON_AGENT_DESKTOP_NOVNC_URL": f"http://{sys.argv[4]}:6080/vnc.html",
}
lines = env_path.read_text().splitlines()
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else None
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
env_path.write_text("\n".join(out) + "\n")
PY

cat <<EOF
INSTANCE_ID=${INSTANCE_ID}
PUBLIC_DNS=${PUBLIC_DNS}
NOVNC_URL=http://${PUBLIC_DNS}:6080/vnc.html
EOF
