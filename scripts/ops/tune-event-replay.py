"""Run over SSH on subiu-sm to tune only the historical demo replay worker."""

import hashlib
import json
import os
import socket
import subprocess
from pathlib import Path

ROOT = Path('/home/subiu-sm/apps/jungle-challenge')
OLD = 'jungle-event-replay-20261006'
NEW = 'jungle-event-replay-indexed-20261007'
DIRECTORY = ROOT / 'operations/prod-health-20261007'


def command(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True,
                          timeout=kwargs.pop('timeout', 40), **kwargs).stdout.strip()


def private_file(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
        output.write(content)


if socket.gethostname() != 'subiu-sm' or Path.cwd().resolve() != ROOT:
    raise SystemExit('Run only in the dedicated challenge directory on subiu-sm.')
if command(['docker', 'ps', '-aq', '--filter', f'name=^{NEW}$']):
    raise SystemExit('Tuned worker already exists; inspect its checkpoint before acting.')

DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
config = json.loads(command(['docker', 'inspect', OLD]))[0]
private_file(DIRECTORY / 'replay-container.before.private.json', json.dumps(config))
environment = dict(value.split('=', 1) for value in config['Config']['Env'] if '=' in value)
checkpoint_path = environment['EVENT_REPLAY_CHECKPOINT']
source = command(['docker', 'exec', OLD, 'cat', '/app/scripts/replay-demo-events.ts'])
needle = 'const db = await connectDatabase();'
if source.count(needle) != 1:
    raise SystemExit('Unexpected source; no worker has been stopped.')

options = ('-c enable_hashjoin=off -c enable_mergejoin=off -c enable_seqscan=off '
           '-c enable_bitmapscan=off -c max_parallel_workers_per_gather=0 -c jit=off '
           '-c statement_timeout=10000 -c application_name=jungle-event-replay-indexed')
replacement = (
    "const initial = await connectDatabase();\n"
    "const base = initial.config.getAll();\n"
    "await initial.close(true);\n"
    "const { MikroORM } = await import('@mikro-orm/postgresql');\n"
    "const db = await MikroORM.init({ ...base, pool: { min: 0, max: 1 }, "
    f"driverOptions: {{ connection: {{ options: {json.dumps(options)} }} }} }});"
)
source = source.replace(needle, replacement)
progress_line = "console.log(JSON.stringify({ event: 'demo_event_replay_progress', sent, done }));"
if source.count(progress_line) != 1:
    raise SystemExit('Unexpected checkpoint loop; no worker has been stopped.')
source = source.replace(progress_line, progress_line + '\n      await Bun.sleep(250);')
launcher = DIRECTORY / 'replay-demo-events-indexed.ts'
private_file(launcher, source + '\n')
env_file = DIRECTORY / 'replay.env.private'
private_file(env_file, '\n'.join(config['Config']['Env']) + '\n')

# SIGTERM finishes the current page and saves its checkpoint before closing SQL/SQS.
command(['docker', 'stop', '--time', '30', OLD])
mount = next(item for item in config['Mounts'] if item['Destination'] == '/app/.tmp')
checkpoint_backup = DIRECTORY / 'replay-checkpoint.before.json'
command(['docker', 'cp', f'{OLD}:{checkpoint_path}', str(checkpoint_backup)])
os.chmod(checkpoint_backup, 0o600)
checkpoint = json.loads(checkpoint_backup.read_text())
new_command = list(config['Config']['Cmd'])
new_command[-1] = new_command[-1].replace('./scripts/replay-demo-events', './scripts/replay-demo-events-indexed')
network = next(iter(config['NetworkSettings']['Networks']))
identifier = command([
    'docker', 'run', '-d', '--name', NEW, '--network', network,
    '--restart', 'on-failure:3', '--cpus', '0.5', '--memory', '256m', '--pids-limit', '128',
    '--log-driver', 'json-file', '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2',
    '--env-file', str(env_file),
    '--mount', f'type=volume,source={mount["Name"]},target=/app/.tmp',
    '--mount', f'type=bind,source={launcher},target=/app/scripts/replay-demo-events-indexed.ts,readonly',
    config['Image'], *new_command,
])
report = {
    'oldWorker': OLD, 'newWorker': NEW, 'newId': identifier,
    'imageId': config['Image'], 'checkpointBefore': checkpoint,
    'launcherSha256': hashlib.sha256(source.encode()).hexdigest(),
    'scope': 'Worker connections only; same archived events, cutoff, checkpoint and receipt algorithm.',
}
private_file(DIRECTORY / 'replay-tuning.json', json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
