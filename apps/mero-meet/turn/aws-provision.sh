#!/usr/bin/env bash
# Provision the TURN box on AWS. Creates ONLY NEW resources (security group,
# elastic IP, instance) — it never reads or modifies the existing relayer.
#
# Prereqs: `aws sso login` (or creds), and the env vars below. Run with DRY_RUN=1
# first to print what it would create.
#
#   AWS_REGION   e.g. eu-central-1
#   VPC_ID       VPC to launch in (the default VPC is fine; must NOT be required
#                to be the relayer's — any VPC with internet access works)
#   SUBNET_ID    a public subnet in that VPC
#   KEY_NAME     existing EC2 key pair for SSH
#   MY_IP        your public IP for SSH lockdown, e.g. 203.0.113.7
#   AMI_ID       Ubuntu 22.04 AMI for the region (see note below)
#   INSTANCE_TYPE (optional, default t3.small)
set -euo pipefail

: "${AWS_REGION:?}"; : "${VPC_ID:?}"; : "${SUBNET_ID:?}"; : "${KEY_NAME:?}"; : "${MY_IP:?}"; : "${AMI_ID:?}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
NAME="mero-meet-turn"
run() { echo "+ aws $*"; [ "${DRY_RUN:-0}" = "1" ] || aws "$@"; }

echo "== 1. security group =="
SG_ID=$(run ec2 create-security-group --region "$AWS_REGION" \
  --group-name "$NAME" --description "Mero Meet TURN relay (independent)" \
  --vpc-id "$VPC_ID" --query GroupId --output text)
echo "SG_ID=$SG_ID"

echo "== 2. ingress rules =="
run ec2 authorize-security-group-ingress --region "$AWS_REGION" --group-id "$SG_ID" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${MY_IP}/32,Description=ssh}]" \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=letsencrypt}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=cred-endpoint}]" \
    "IpProtocol=tcp,FromPort=3478,ToPort=3478,IpRanges=[{CidrIp=0.0.0.0/0,Description=turn-tcp}]" \
    "IpProtocol=udp,FromPort=3478,ToPort=3478,IpRanges=[{CidrIp=0.0.0.0/0,Description=turn-udp}]" \
    "IpProtocol=udp,FromPort=49152,ToPort=65535,IpRanges=[{CidrIp=0.0.0.0/0,Description=turn-relay-range}]"

echo "== 3. launch instance =="
IID=$(run ec2 run-instances --region "$AWS_REGION" \
  --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" --key-name "$KEY_NAME" \
  --subnet-id "$SUBNET_ID" --security-group-ids "$SG_ID" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
  --query 'Instances[0].InstanceId' --output text)
echo "INSTANCE_ID=$IID"

echo "== 4. elastic ip =="
ALLOC=$(run ec2 allocate-address --region "$AWS_REGION" --domain vpc \
  --query AllocationId --output text)
run ec2 wait instance-running --region "$AWS_REGION" --instance-ids "$IID"
run ec2 associate-address --region "$AWS_REGION" --instance-id "$IID" --allocation-id "$ALLOC"
EIP=$(run ec2 describe-addresses --region "$AWS_REGION" --allocation-ids "$ALLOC" \
  --query 'Addresses[0].PublicIp' --output text)

echo
echo "done. Elastic IP = $EIP"
echo "next: point DNS  turn.<your-domain> A $EIP, then SSH in and follow SETUP.md step 1+"
echo "(.env PUBLIC_IP=$EIP ; PRIVATE_IP = the instance private ip from \`ip -4 addr\`)"

# AMI note: get the current Ubuntu 22.04 AMI for your region with —
#   aws ec2 describe-images --region "$AWS_REGION" --owners 099720109477 \
#     --filters 'Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*' \
#               'Name=state,Values=available' \
#     --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text
