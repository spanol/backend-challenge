"""Run only an owned, disposable Compose project; the Bun runner owns DB/queue cleanup."""
import argparse
import base64
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--project', required=True)
parser.add_argument('--image', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--profile', choices=['smoke', 'heavy', 'game-smoke', 'game-scale'], default='heavy')
parser.add_argument('--peers', type=int, default=None)
parser.add_argument('--concurrency', type=int, default=None)
parser.add_argument('--stage-seconds', type=int, default=None)
parser.add_argument('--max-wait-ms', type=int, default=None)
parser.add_argument('--connection-reuse', choices=['true', 'false'], default='true')
parser.add_argument('--guard-subiu', action='store_true')
args = parser.parse_args()
if not re.fullmatch(r'jungle-distributed-[a-z0-9-]+', args.project):
    raise SystemExit('Project must use the exclusive jungle-distributed- prefix')
out = (ROOT / args.output).resolve()
if not out.is_relative_to((ROOT / 'test-results').resolve()):
    raise SystemExit('Output must be within test-results')
out.mkdir(parents=True, exist_ok=False)
out.chmod(0o777)
env = dict(os.environ, DISTRIBUTED_IMAGE=args.image, DISTRIBUTED_OUTPUT=str(out),
           DISTRIBUTED_LOAD_PROFILE=args.profile)
for option, variable, minimum, maximum in [
    (args.peers, 'GAME_LOAD_PEERS', 3, 100000),
    (args.concurrency, 'GAME_LOAD_CONCURRENCY', 1, 4096),
    (args.stage_seconds, 'GAME_LOAD_STAGE_SECONDS', 6, 600),
    (args.max_wait_ms, 'GAME_LOAD_MAX_WAIT_MS', 100, 60000),
]:
    if option is not None:
        if not minimum <= option <= maximum:
            raise SystemExit(f'Invalid {variable}')
        env[variable] = str(option)
env['GAME_LOAD_CONNECTION_REUSE'] = args.connection_reuse
compose = ['docker', 'compose', '-f', str(ROOT / 'compose.distributed-load.yaml'), '-p', args.project]


def now():
    return datetime.now(timezone.utc).isoformat()


def run(command, check=True):
    result = subprocess.run(command, env=env, cwd=ROOT, capture_output=True, text=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result


def inspect(names):
    return json.loads(run(['docker', 'inspect', *names]).stdout) if names else []


def owned(name):
    info = inspect([name])[0]
    if info['Config']['Labels'].get('com.docker.compose.project') != args.project:
        raise RuntimeError('Container ownership mismatch')
    return info


def get_json(url, auth=False):
    req = urllib.request.Request(url)
    if auth:
        req.add_header('Authorization', 'Basic ' + base64.b64encode(b'admin:distributed-test-only').decode())
    deadline = time.monotonic() + 120
    while True:
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                return json.load(response)
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
            with (out / 'collection-retries.jsonl').open('a') as stream:
                stream.write(json.dumps({'at': now(), 'url': url, 'error': str(error)}) + '\n')
            if time.monotonic() >= deadline:
                raise
            time.sleep(2)


existing_names = run(['docker', 'ps', '-q']).stdout.split()
baseline = inspect(existing_names)
baseline_summary = [{'name': c['Name'], 'id': c['Id'], 'restarts': c['RestartCount'],
                     'health': c['State'].get('Health', {}).get('Status')} for c in baseline]
(out / 'existing-baseline.json').write_text(json.dumps(baseline_summary, indent=2))
project_label = f'label=com.docker.compose.project={args.project}'
for command in [['docker', 'ps', '-aq', '--filter', project_label],
                ['docker', 'volume', 'ls', '-q', '--filter', project_label],
                ['docker', 'network', 'ls', '-q', '--filter', project_label]]:
    if run(command).stdout.strip():
        raise SystemExit('Project resources already exist; refusing reuse')
started = time.time()
summary = {'project': args.project, 'image': args.image, 'profile': args.profile, 'startedAt': now(),
           'passed': False, 'guardTriggered': False, 'error': None}
crash = None
stopped = False
replicas_started = False
last_sample = 0
issues_in_a_row = 0
runner_name = f'{args.project}-runner-1'
services = [f'{args.project}-replica-{i}-1' for i in range(1, 4)]

try:
    run(compose + ['config', '--quiet'])
    run(compose + ['up', '-d', '--wait', 'postgres', 'localstack', 'tempo', 'prometheus', 'grafana'])
    run(compose + ['up', '-d', '--no-deps', 'runner'])
    deadline = time.monotonic() + 7200
    while time.monotonic() < deadline:
        marker = out / 'distributed-resource.json'
        if marker.exists() and not replicas_started:
            resource = json.loads(marker.read_text())['resourceId']
            if not re.fullmatch(r'wagering_test_[0-9]+_[a-f0-9]{8}', resource):
                raise RuntimeError('Unsafe resource identity from runner')
            env['TEST_RESOURCE_ID'] = resource
            run(compose + ['up', '-d', '--no-deps', 'replica-1', 'replica-2', 'replica-3'])
            replicas_started = True
            topology = [{'name': c['Name'], 'id': c['Id'], 'imageId': c['Image'], 'pid': c['State']['Pid'],
                         'nanoCpus': c['HostConfig']['NanoCpus'], 'memory': c['HostConfig']['Memory'],
                         'ip': list(c['NetworkSettings']['Networks'].values())[0]['IPAddress']} for c in inspect(services)]
            (out / 'topology.json').write_text(json.dumps(topology, indent=2))
        control_file = out / 'distributed-control.json'
        control = json.loads(control_file.read_text()) if control_file.exists() else {}
        if control.get('action') == 'kill-replica-1' and crash is None:
            before = owned(services[0])
            run(['docker', 'kill', '--signal=SIGKILL', services[0]])
            crash = {'killedAt': now(), 'beforePid': before['State']['Pid'], 'containerId': before['Id'],
                     'restartAtMonotonic': time.monotonic() + 5, 'restarted': False}
            (out / 'distributed-crash.json').write_text(json.dumps(crash, indent=2))
        if crash and not crash['restarted'] and time.monotonic() >= crash['restartAtMonotonic']:
            owned(services[0])
            run(compose + ['start', 'replica-1'])
            after = owned(services[0])
            crash.update(restarted=True, restartedAt=now(), afterPid=after['State']['Pid'])
            (out / 'distributed-crash.json').write_text(json.dumps(crash, indent=2))
        if control.get('action') == 'stop-replicas' and not stopped:
            run(compose + ['stop', 'replica-1', 'replica-2', 'replica-3'])
            (out / 'distributed-replicas-stopped').write_text(now())
            stopped = True
        if time.monotonic() - last_sample >= 5:
            last_sample = time.monotonic()
            sample = {'at': now(), 'existing': [], 'issues': [], 'http': {}}
            for c in inspect(existing_names):
                original = next(b for b in baseline if b['Id'] == c['Id'])
                health = c['State'].get('Health', {}).get('Status')
                sample['existing'].append({'name': c['Name'], 'id': c['Id'], 'running': c['State']['Running'],
                                          'health': health, 'restarts': c['RestartCount'], 'oomKilled': c['State']['OOMKilled']})
                if not c['State']['Running'] or c['State']['OOMKilled'] or c['RestartCount'] != original['RestartCount'] or (original['State'].get('Health', {}).get('Status') == 'healthy' and health != 'healthy'):
                    sample['issues'].append(c['Name'])
            if Path('/proc/meminfo').exists():
                memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
                sample['availableMiB'] = int(memory['MemAvailable'].split()[0]) / 1024
                sample['loadAverage'] = list(os.getloadavg())
                if sample['availableMiB'] < 1536:
                    sample['issues'].append('memory-headroom')
            if args.guard_subiu:
                urls = {'subway': 'http://127.0.0.1:8091/', 'betaki': 'http://100.76.148.42:8100/',
                        'superbet': 'http://100.76.148.42:8101/', 'aurabet': 'http://100.76.148.42:8102/'}
                for name, url in urls.items():
                    at = time.monotonic()
                    try:
                        with urllib.request.urlopen(url, timeout=3) as response:
                            sample['http'][name] = {'status': response.status, 'elapsedSeconds': time.monotonic() - at}
                    except Exception as error:
                        sample['http'][name] = {'error': type(error).__name__}
                        sample['issues'].append(name + '-http')
            names = run(compose + ['ps', '-q']).stdout.split()
            if names:
                sample['stats'] = [json.loads(line) for line in run(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *names]).stdout.splitlines()]
                sample['loadContainers'] = [{'name': c['Name'], 'id': c['Id'], 'imageId': c['Image'],
                                            'pid': c['State']['Pid'], 'oomKilled': c['State']['OOMKilled'],
                                            'restarts': c['RestartCount']} for c in inspect(names)]
                if any(c['oomKilled'] for c in sample['loadContainers']):
                    sample['issues'].append('load-oom')
            with (out / 'host-samples.jsonl').open('a') as stream:
                stream.write(json.dumps(sample) + '\n')
            issues_in_a_row = issues_in_a_row + 1 if sample['issues'] else 0
            if issues_in_a_row >= 3:
                summary['guardTriggered'] = True
                raise RuntimeError('Host guard: ' + ', '.join(sample['issues']))
        state = owned(runner_name)['State']
        if not state['Running']:
            summary['runnerExitCode'] = state['ExitCode']
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Distributed load exceeded 7200 seconds')
    result = json.loads((out / 'distributed-load.json').read_text())
    cleanup = json.loads((out / 'resources-distributed-load.json').read_text())
    summary['passed'] = result['passed'] and summary['runnerExitCode'] == 0 and cleanup['cleanupComplete']
    queries = ['up', 'rate(process_cpu_seconds_total[30s])*100', 'process_resident_memory_bytes',
               'nodejs_eventloop_lag_p99_seconds', 'wager_outbox_pending', 'wager_outbox_lag_seconds',
               'wager_request_queue_visible', 'wager_request_queue_inflight', 'wager_http_responses_total',
               'wager_processing_seconds_count', 'load_outbox_accepted_total', 'wager_lock_conflicts_total',
               'load_wager_inflight']
    for i, query in enumerate(queries):
        params = urllib.parse.urlencode({'query': query, 'start': started, 'end': time.time(), 'step': 5})
        data = get_json('http://127.0.0.1:39471/api/v1/query_range?' + params)
        (out / f'prometheus-{i:02d}.json').write_text(json.dumps({'query': query, 'response': data}))
    for replica in range(1, 4):
        params = urllib.parse.urlencode({'tags': f'service.name=distributed-load-replica-{replica}',
                                        'start': int(started), 'end': int(time.time()), 'limit': 10})
        data = get_json('http://127.0.0.1:39472/api/search?' + params)
        (out / f'tempo-replica-{replica}.json').write_text(json.dumps(data))
        if data.get('traces'):
            trace_id = data['traces'][0]['traceID']
            (out / f'trace-replica-{replica}.json').write_text(json.dumps(get_json(f'http://127.0.0.1:39472/api/traces/{trace_id}')))
    (out / 'grafana-dashboard.json').write_text(json.dumps(get_json('http://127.0.0.1:39473/api/dashboards/uid/distributed-load', True)))
except Exception as error:
    summary['error'] = str(error)
    try:
        if owned(runner_name)['State']['Running']:
            run(['docker', 'kill', '--signal=SIGTERM', runner_name], check=False)
            time.sleep(3)
    except Exception:
        pass
finally:
    for service in ['runner', 'replica-1', 'replica-2', 'replica-3', 'postgres', 'localstack', 'tempo', 'prometheus', 'grafana']:
        result = run(compose + ['logs', '--no-color', service], check=False)
        (out / f'{service}.log').write_text(result.stdout + result.stderr)
    cleanup_result = run(compose + ['down', '--volumes', '--remove-orphans'], check=False)
    summary['stackCleanupExitCode'] = cleanup_result.returncode
    remaining = run(['docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={args.project}']).stdout.split()
    summary['remainingContainers'] = remaining
    summary['completedAt'] = now()
    summary['passed'] = summary['passed'] and not summary['error'] and cleanup_result.returncode == 0 and not remaining
    (out / 'stack-summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary), flush=True)
raise SystemExit(0 if summary['passed'] else 1)
