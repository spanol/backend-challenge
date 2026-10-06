"""Restore topology on demo broker startup; this does not restore message bodies."""

import json
import boto3

client = boto3.client(
    'sqs', endpoint_url='http://localhost:4566', region_name='us-east-1',
    aws_access_key_id='test', aws_secret_access_key='test',
)
dlq = client.create_queue(
    QueueName='wager-transactions-dlq.fifo',
    Attributes={'FifoQueue': 'true', 'ContentBasedDeduplication': 'false', 'MessageRetentionPeriod': '1209600'},
)['QueueUrl']
arn = client.get_queue_attributes(QueueUrl=dlq, AttributeNames=['QueueArn'])['Attributes']['QueueArn']
policy = json.dumps({'deadLetterTargetArn': arn, 'maxReceiveCount': '5'})
requests = client.create_queue(
    QueueName='wager-transactions.fifo',
    Attributes={'FifoQueue': 'true', 'ContentBasedDeduplication': 'false', 'VisibilityTimeout': '30', 'RedrivePolicy': policy},
)['QueueUrl']
client.set_queue_attributes(QueueUrl=requests, Attributes={'RedrivePolicy': policy})
client.create_queue(
    QueueName='wager-events.fifo',
    Attributes={'FifoQueue': 'true', 'ContentBasedDeduplication': 'false'},
)
print('Demo SQS topology ready; durable envelopes and receipts remain in PostgreSQL')
