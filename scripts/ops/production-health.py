"""Small read-only production monitor. Its private config supplies an expiry."""

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import urllib.parse
from pathlib import Path

MARKER = 'jungle-prod-health-20261007'
NAMES = [
    'jungle-server-demo-1', 'jungle-server-app-observed-1',
    'jungle-server-postgres-1', 'jungle-server-localstack-1',
    'jungle-server-grafana-1', 'jungle-server-prometheus-1',
    'jungle-server-loki-1', 'jungle-server-tempo-1',
    'jungle-server-alloy-1', 'jungle-server-log-gateway-1',
    'subiu-traefik-1', 'subiu-cloudflared-1',
]


def run(args, timeout=20):
    return subprocess.run(args, check=True, capture_output=True, text=True,
                          timeout=timeout).stdout.strip()


def save(path, content):
    temporary = path.with_suffix(path.suffix + '.next')
    with temporary.open('w', encoding='utf-8') as output:
        output.write(content)
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def probe(url, expected, as_json=False):
    start = time.monotonic()
    try:
        request = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 SubiuDemoHealth/1.0',
            'Cache-Control': 'no-cache',
        })
        with urllib.request.urlopen(request, timeout=12) as response:
            body = response.read()
            result = {'status': response.status,
                      'milliseconds': round((time.monotonic() - start) * 1000),
                      'ok': response.status == expected}
            return result, json.loads(body) if as_json else body.decode('utf-8', errors='replace')
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        return {'ok': False, 'error': str(error)[:250],
                'milliseconds': round((time.monotonic() - start) * 1000)}, None


parser = argparse.ArgumentParser()
parser.add_argument('--state-dir', type=Path, required=True)
args = parser.parse_args()
directory = args.state_dir.resolve()
config = json.loads((directory / 'monitor-config.json').read_text())
now = dt.datetime.now(dt.timezone.utc)
if now >= dt.datetime.fromisoformat(config['expiresAt']):
    cron = run(['crontab', '-l'])
    retained = '\n'.join(line for line in cron.splitlines()
                         if not line.rstrip().endswith('# ' + MARKER)) + '\n'
    subprocess.run(['crontab', '-'], input=retained, text=True, check=True)
    save(directory / 'latest.json', json.dumps({
        'capturedAt': now.isoformat(), 'status': 'expired', 'expiresAt': config['expiresAt'],
    }, indent=2) + '\n')
    raise SystemExit(0)

report = {'capturedAt': now.isoformat(), 'expiresAt': config['expiresAt'],
          'errors': [], 'warnings': [], 'checks': {}, 'containers': [], 'resources': []}
try:
    previous = json.loads((directory / 'latest.json').read_text())
except (OSError, ValueError):
    previous = {}
try:
    containers = json.loads(run(['docker', 'inspect', *NAMES]))
    for item in containers:
        name = item['Name'].lstrip('/')
        state = item['State']
        healthy = state['Running'] and state.get('Health', {}).get('Status', 'healthy') == 'healthy'
        record = {'name': name, 'id': item['Id'], 'running': state['Running'],
                  'health': state.get('Health', {}).get('Status'),
                  'restarts': item['RestartCount'], 'oomKilled': state['OOMKilled']}
        report['containers'].append(record)
        if not healthy or state['OOMKilled']:
            report['errors'].append(name + ': unhealthy or stopped')
        baseline = config['containers'].get(name, {})
        if item['Id'] == baseline.get('id') and item['RestartCount'] > baseline.get('restarts', 0):
            report['warnings'].append(name + ': new restart since baseline')
        if item['Id'] != baseline.get('id'):
            report['warnings'].append(name + ': container changed since baseline')
    stats = run(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *NAMES])
    for line in stats.splitlines():
        sample = json.loads(line)
        report['resources'].append({k: sample[k] for k in ['Name', 'CPUPerc', 'MemPerc', 'MemUsage']})
        if float(sample['MemPerc'].rstrip('%')) >= 85:
            report['warnings'].append(sample['Name'] + ': memory at or above 85%')
except (subprocess.SubprocessError, ValueError, KeyError) as error:
    report['errors'].append('container inspection: ' + str(error)[:200])

for label, url, status in [
    ('publicPage', 'https://jungle.subiu.dev/', 200),
    ('publicDemoHealth', 'https://jungle.subiu.dev/demo/health', 204),
    ('publicApiReady', 'https://jungle.subiu.dev/health/ready', 200),
    ('javascript', 'https://jungle.subiu.dev/client.js', 200),
    ('stylesheet', 'https://jungle.subiu.dev/style.css', 200),
    ('localApiReady', 'http://127.0.0.1:39320/health/ready', 200),
    ('grafana', 'http://127.0.0.1:39323/api/health', 200),
    ('prometheus', 'http://127.0.0.1:39321/-/ready', 200),
    ('tempo', 'http://127.0.0.1:39322/ready', 200),
]:
    check, _ = probe(url, status)
    report['checks'][label] = check
    if not check['ok']:
        report['errors'].append(label + ': failed')
    elif check['milliseconds'] > 3000:
        report['warnings'].append(label + ': took more than 3 seconds')

try:
    check, dashboard = probe('https://jungle.subiu.dev/demo/dashboard', 200, True)
    report['checks']['dashboard'] = check
    if dashboard is None or not check['ok']:
        report['errors'].append('dashboard: failed')
    else:
        state = dashboard['state']
        report['demo'] = {'peerCount': state['peerCount'], 'roundNumber': state['roundNumber'],
                          'autoplay': state['autoplay']['enabled'], 'blocked': dashboard['blocked'],
                          'pendingOperations': dashboard['pendingOperationCount'],
                          'replayOptions': len(state['operations']), 'sessionId': state['sessionId'],
                          'completedOperations': dashboard['completedOperationCount'],
                          'phase': state['phase']}
        if dashboard.get('operationError'):
            report['errors'].append('demo: unresolved operation error')
            report['demo']['operationError'] = str(dashboard['operationError'])[:250]
        prior = previous.get('demo', {})
        if (state['autoplay']['enabled'] and prior.get('autoplay')
                and prior.get('sessionId') == state['sessionId']
                and prior.get('roundNumber') == state['roundNumber']
                and prior.get('completedOperations') == dashboard['completedOperationCount']):
            since = prior.get('unchangedSince', previous['capturedAt'])
            report['demo']['unchangedSince'] = since
            if (now - dt.datetime.fromisoformat(since)).total_seconds() >= 600:
                report['errors'].append('demo: autoplay has made no progress for 10 minutes')
        if (state['autoplay']['enabled'] and state['phase'] in {'flying', 'crashed'}
                and dashboard['roundSummary']['planned'] == 0):
            report['warnings'].append('demo: automatic round has no eligible bets')
        check, peers = probe('https://jungle.subiu.dev/demo/peer-options', 200, True)
        report['checks']['peerOptions'] = check
        if peers is None or not check['ok'] or (state['peerCount'] and not peers['peerOptions']):
            report['errors'].append('peer options: failed or empty')
        if state['peers']:
            peer = state['peers'][0]
            query = urllib.parse.urlencode({'peerId': peer['id']})
            check, evidence = probe('https://jungle.subiu.dev/demo/evidence?' + query, 200, True)
            report['checks']['reconciliation'] = check
            if evidence is None or not check['ok']:
                report['errors'].append('reconciliation: failed')
            else:
                rec = evidence['reconciliation']
                report['reconciliation'] = {
                    'consistent': rec['consistent'], 'entries': rec['checkedEntries'],
                    'difference': rec['difference']['amount'],
                }
                if not rec['consistent'] or rec['difference']['amount'] != '0.00':
                    report['errors'].append('reconciliation: mismatch')
except (KeyError, TypeError, IndexError) as error:
    report['errors'].append('demo response contract: ' + str(error)[:150])

try:
    check, targets = probe('http://127.0.0.1:39321/api/v1/targets', 200, True)
    report['checks']['prometheusTargets'] = check
    if targets is None or not check['ok'] or targets['status'] != 'success':
        report['errors'].append('prometheus targets: failed')
    else:
        active = targets['data']['activeTargets']
        report['scrapeTargets'] = [{'job': target['labels'].get('job'),
                                   'health': target['health'],
                                   'lastError': target['lastError']} for target in active]
        if not active or any(target['health'] != 'up' for target in active):
            report['errors'].append('prometheus: missing or unhealthy scrape target')
except (KeyError, TypeError) as error:
    report['errors'].append('prometheus response contract: ' + str(error)[:150])

try:
    # Use the existing private network; Loki stays unexposed on the host.
    script = """
const query = new URL('http://loki:3100/loki/api/v1/query_range');
query.searchParams.set('query', '{service_name="distributed-wagering-processor"}');
query.searchParams.set('start', String(BigInt(Date.now() - 600000) * 1000000n));
query.searchParams.set('limit', '1');
for (const [name, url] of [['lokiReady', 'http://loki:3100/ready'], ['lokiLogs', query.href]]) {
  const start = Date.now();
  const response = await fetch(url, {signal: AbortSignal.timeout(12000)});
  const body = await response.text();
  const result = {name, status: response.status, ok: response.ok, milliseconds: Date.now() - start};
  if (name === 'lokiLogs' && response.ok) {
    const data = JSON.parse(body);
    result.ok = data.status === 'success' && data.data.result.length > 0;
    result.streams = data.data.result.length;
  }
  console.log(JSON.stringify(result));
}
"""
    output = run(['docker', 'exec', 'jungle-server-app-observed-1', 'bun', '-e', script], timeout=30)
    for line in output.splitlines():
        result = json.loads(line)
        label = result.pop('name')
        report['checks'][label] = result
        if not result['ok']:
            report['errors'].append(label + ': failed or no recent application logs')
except (subprocess.SubprocessError, ValueError, KeyError) as error:
    report['errors'].append('loki inspection: ' + str(error)[:200])

check, metrics = probe('http://127.0.0.1:39320/metrics', 200)
report['checks']['messagingMetrics'] = check
if metrics is None or not check['ok']:
    report['errors'].append('messaging metrics: failed')
else:
    selected = {}
    for line in metrics.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] in {
                'wager_outbox_pending', 'wager_outbox_lag_seconds',
                'wager_event_queue_depth', 'wager_telemetry_timestamp_seconds'}:
            try:
                selected[parts[0]] = float(parts[1])
            except ValueError:
                report['errors'].append('messaging metrics: invalid sample')
    report['messaging'] = selected
    timestamp = selected.get('wager_telemetry_timestamp_seconds', 0)
    if time.time() - timestamp > 180:
        report['warnings'].append('messaging telemetry: older than 3 minutes')
    if selected.get('wager_outbox_lag_seconds', 0) > 300:
        report['warnings'].append('outbox: oldest pending event older than 5 minutes')
    if selected.get('wager_event_queue_depth', 0) >= 10000:
        report['warnings'].append('event queue: at or above backpressure threshold')

for label, check in report['checks'].items():
    if check.get('ok') and check['milliseconds'] > 3000 and not any(
            warning.startswith(label + ':') for warning in report['warnings']):
        report['warnings'].append(label + ': took more than 3 seconds')

disk = shutil.disk_usage(directory)
report['disk'] = {'freeBytes': disk.free, 'usedPercent': round(disk.used / disk.total * 100, 1)}
if disk.free < 10 * 1024 ** 3:
    report['warnings'].append('host disk: less than 10 GiB free')
report['status'] = 'error' if report['errors'] else 'warning' if report['warnings'] else 'ok'
serialized = json.dumps(report, ensure_ascii=False)
save(directory / 'latest.json', json.dumps(report, ensure_ascii=False, indent=2) + '\n')
with (directory / 'history.jsonl').open('a', encoding='utf-8') as history:
    history.write(serialized + '\n')
os.chmod(directory / 'history.jsonl', 0o600)
print(json.dumps({'capturedAt': report['capturedAt'], 'status': report['status'],
                  'errors': report['errors'], 'warnings': report['warnings']}))
