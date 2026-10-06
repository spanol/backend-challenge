"""Version-specific FIFO cache and visibility fixes. Preserves queued message bodies."""

from pathlib import Path

root = Path('/opt/code/localstack/localstack-core/localstack/services/sqs')


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('LocalStack 4.9.2 source did not match the pinned patch')
    return text.replace(old, new, 1)


models = (root / 'models.py').read_text()
models = replace_once(models, '''        _, _, _, last_received = extract_receipt_handle_info(receipt_handle)
        if time.time() - float(last_received) > message.visibility_timeout:''', '''        if message.is_visible:''')
models = replace_once(models, 'import copy\n', 'import copy\nfrom collections import OrderedDict\n')
models = replace_once(models, 'class FifoQueue(SqsQueue):', '''class FifoDeduplication:
    # put() only needs these fields for a duplicate. Do not retain the message body,
    # receipt handles or the whole SqsMessage after it has been acknowledged.
    __slots__ = ('priority', 'message', 'message_group_id', 'cached_at')

    def __init__(self, message):
        self.priority = message.priority
        self.message = {'MessageId': message.message_id}
        self.message_group_id = message.message_group_id
        self.cached_at = time.monotonic()


class FifoQueue(SqsQueue):''')
models = replace_once(models, '        self.deduplication = {}\n', '        self.deduplication = OrderedDict()\n')
models = replace_once(models, '''        message_group = self.get_message_group(message.message_group_id)

        with self.mutex:
            previously_empty = message_group.empty()''', '''        with self.mutex:
            message_group = self.get_message_group(message.message_group_id)
            previously_empty = message_group.empty()''')
models = replace_once(models, '            self.deduplication[dedup_id] = fifo_message\n', '''            self.deduplication.pop(dedup_id, None)
            self.deduplication[dedup_id] = FifoDeduplication(fifo_message)
''')
# Protect the cache and put together with the queue's existing reentrant mutex.
start = models.index('        original_message = self.deduplication.get(dedup_id)')
end = models.index('        return fifo_message', start)
models = models[:start] + '        with self.mutex:\n' + ''.join(
    '    ' + line if line.strip() else line for line in models[start:end].splitlines(keepends=True)
) + models[end:]
models = replace_once(models, '    def next_sequence_number(self):', '''    def expire_deduplication(self):
        # Ordered by insertion under mutex; monotonic time prevents early eviction
        # when the system clock changes. This is independent of message retention.
        cutoff = time.monotonic() - sqs_constants.DEDUPLICATION_INTERVAL_IN_SEC
        with self.mutex:
            while self.deduplication:
                first = next(iter(self.deduplication.values()))
                if first.cached_at > cutoff:
                    break
                _, expired = self.deduplication.popitem(last=False)
                group = self.message_groups.get(expired.message_group_id)
                if group is not None and group.empty() and group not in self.inflight_groups:
                    del self.message_groups[expired.message_group_id]

    def next_sequence_number(self):''')
(root / 'models.py').write_text(models)

provider = (root / 'provider.py').read_text()
provider = replace_once(provider, '        for queue in self.iter_queues():\n', '''        for queue in self.iter_queues():
            if isinstance(queue, FifoQueue):
                queue.expire_deduplication()
''')
(root / 'provider.py').write_text(provider)
print('Applied compact FIFO deduplication and five-minute expiry to LocalStack 4.9.2')
