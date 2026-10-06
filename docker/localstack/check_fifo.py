"""Exercise the actual patched FIFO model in a disposable image, not production."""

from uuid import uuid4
from unittest.mock import patch
from localstack.services.sqs.models import FifoQueue


def put(queue, dedup='stable-id'):
    return queue.put(
        {'MessageId': str(uuid4()), 'Body': 'x' * 5000},
        message_deduplication_id=dedup,
        message_group_id='group',
    )


queue = FifoQueue('jungle-ttl-check.fifo', 'us-east-1', '000000000000')
original = put(queue)
received = queue.receive(num_messages=1, wait_time_seconds=0)
queue.remove(received.receipt_handles[0])
duplicate = put(queue)
assert duplicate.message_id == original.message_id
assert queue.approx_number_of_messages == 0
assert len(queue.deduplication) == 1
cached = queue.deduplication['stable-id']
assert 'Body' not in cached.message
assert not hasattr(cached, 'receipt_handles')
queue.expire_deduplication()
assert len(queue.deduplication) == 1
cached.cached_at -= 301
queue.expire_deduplication()
assert not queue.deduplication
assert not queue.message_groups
assert put(queue).message_id != original.message_id
assert queue.approx_number_of_messages == 1
assert len(queue.message_groups) == 1
# Expiring only dedup references leaves an unacknowledged message untouched.
queue.deduplication['stable-id'].cached_at -= 301
queue.expire_deduplication()
assert queue.approx_number_of_messages == 1
queue.clear()
assert not queue.deduplication
assert queue.approx_number_of_messages == 0
print('PASS: compact cache, dedup after ACK, five-minute expiry, retained messages, purge')

# Extending a one-second visibility window by another second must permit an ACK
# after the original deadline, while rejecting an actually expired handle.
queue = FifoQueue('jungle-visibility-check.fifo', 'us-east-1', '000000000000')
message = put(queue)
received = queue.receive(num_messages=1, wait_time_seconds=0, visibility_timeout=1)
started = message.last_received
with patch('localstack.services.sqs.models.time.time', return_value=started + 0.5):
    message.update_visibility_timeout(1)
with patch('localstack.services.sqs.models.time.time', return_value=started + 1.1):
    queue.remove(received.receipt_handles[0])
assert queue.approx_number_of_messages == 0
message = put(queue, 'expired-id')
received = queue.receive(num_messages=1, wait_time_seconds=0, visibility_timeout=1)
with patch('localstack.services.sqs.models.time.time', return_value=message.last_received + 1.1):
    try:
        queue.remove(received.receipt_handles[0])
    except Exception as error:
        assert 'expired' in str(error)
    else:
        raise AssertionError('Expired handle must not be acknowledged')
print('PASS: ACK respects extended visibility and rejects expired handles')
